import { parseResilientJson } from "./json";
import { fetchWithRetry, integerEnv } from "./upstream";

const fetch = (input: string | URL | Request, init?: RequestInit) => fetchWithRetry(input, init, {
  upstream: "WordPress",
  timeoutMs: integerEnv("WORDPRESS_TIMEOUT_MS", 60_000),
  maxAttempts: 3,
});

export type WordPressScope = "ttaa" | "ay-tercume";

export type WordPressDraftInput = {
  postTitle: string;
  seoTitle: string;
  html: string;
  schema: string;
  metaDescription: string;
  slug: string;
  focusKeyword: string;
  secondaryKeywords: string[];
  featuredMedia?: number;
  jobId?: string;
};

export type WordPressMedia = { id: number; url: string; fileName: string; alt: string };

async function readWordPressJson<T>(response: Response, operation: string) {
  return parseResilientJson<T>(await response.text(), `WordPress ${operation}`);
}

export type WordPressDraftMediaSnapshot = {
  postId: number;
  html: string;
  featured: { id: number; url: string; alt: string; width: number; height: number };
  inline: { id: number; url: string; alt: string; width: number; height: number };
};

type WordPressDraft = {
  id: number;
  status: string;
  link: string;
  slug: string;
  title: { rendered: string };
  message?: string;
};

type WordPressDraftLookup = WordPressDraft & {
  content?: { raw?: string };
  featured_media?: number;
};

type AioseoKeyphrase = {
  keyphrase?: string;
  score?: number;
  analysis?: Record<string, unknown>;
};

type AioseoKeyphrases = {
  focus?: AioseoKeyphrase;
  additional?: AioseoKeyphrase[];
};

type AioseoMeta = {
  title?: string;
  description?: string;
  canonical_url?: string;
  keyphrases?: AioseoKeyphrases | string;
};

function wordpressConfig(scope: WordPressScope = "ttaa") {
  const prefix = scope === "ay-tercume" ? "AY_" : "";
  const baseUrl = process.env[`${prefix}WP_URL`]?.replace(/\/+$/, "");
  const username = process.env[`${prefix}WP_USERNAME`];
  const applicationPassword = process.env[`${prefix}WP_APP_PASSWORD`];
  if (!baseUrl || !username || !applicationPassword) throw new Error(`${scope === "ay-tercume" ? "Ay Tercüme" : "TTAA"} WordPress credentials are not configured.`);
  return { baseUrl, username, applicationPassword };
}

function authHeader(username: string, applicationPassword: string) {
  return `Basic ${btoa(`${username}:${applicationPassword}`)}`;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeKeyphrase(value: string | undefined) {
  return (value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function parseAioseoKeyphrases(value: AioseoMeta["keyphrases"]): AioseoKeyphrases {
  if (!value) return {};
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as AioseoKeyphrases;
  } catch {
    return {};
  }
}

function buildAioseoKeyphrases(existing: AioseoMeta["keyphrases"], focusKeyword: string, secondaryKeywords: string[]): AioseoKeyphrases {
  const parsed = parseAioseoKeyphrases(existing);
  return {
    focus: {
      ...parsed.focus,
      keyphrase: focusKeyword,
      score: parsed.focus?.score || 0,
      analysis: parsed.focus?.analysis || {},
    },
    additional: secondaryKeywords.map((keyphrase) => ({ keyphrase, score: 0, analysis: {} })),
  };
}

function verifyAioseoKeyphrases(meta: AioseoMeta | undefined, focusKeyword: string, secondaryKeywords: string[]) {
  const keyphrases = parseAioseoKeyphrases(meta?.keyphrases);
  const focusKeywordApplied = normalizeKeyphrase(keyphrases.focus?.keyphrase) === normalizeKeyphrase(focusKeyword);
  const expected = secondaryKeywords.map(normalizeKeyphrase).sort();
  const actual = (keyphrases.additional || []).map((item) => normalizeKeyphrase(item.keyphrase)).filter(Boolean).sort();
  const secondaryKeywordsApplied = expected.length === actual.length && expected.every((value, index) => value === actual[index]);
  return { focusKeywordApplied, secondaryKeywordsApplied };
}

async function readAioseoMeta(baseUrl: string, authorization: string, postId: number) {
  const response = await fetch(`${baseUrl}/wp-json/wp/v2/posts/${postId}?context=edit&_fields=aioseo_meta_data`, {
    headers: { Authorization: authorization, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) return undefined;
  const payload = await readWordPressJson<{ aioseo_meta_data?: AioseoMeta }>(response, "AIOSEO read-back");
  return payload.aioseo_meta_data;
}

function sharedCssInfo(baseUrl: string, scope: WordPressScope) {
  return scope === "ay-tercume"
    ? { url: `${baseUrl}/wp-content/plugins/ay-tercume-content-studio/assets/css/ay-tercume-article.css`, marker: ".ayc-article" }
    : { url: `${baseUrl}/wp-content/plugins/ttaa-content-studio/assets/css/translation-article.css`, marker: ".ttaa-article" };
}

async function sharedArticleCssReady(baseUrl: string, scope: WordPressScope) {
  const { url, marker } = sharedCssInfo(baseUrl, scope);
  try {
    const response = await fetch(url, { method: "GET", cache: "no-store" });
    return response.ok && (await response.text()).includes(marker);
  } catch {
    return false;
  }
}

async function articleCssText(scope: WordPressScope) {
  if (process.env.CONTENT_WORKER === "true") {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const file = scope === "ay-tercume" ? "ay-tercume-article.css" : "translation-article.css";
    return readFile(resolve(process.cwd(), "public", file), "utf8");
  }
  const cssModule = scope === "ay-tercume"
    ? await import("../public/ay-tercume-article.css?raw")
    : await import("../public/translation-article.css?raw");
  return cssModule.default;
}

async function inlineStyleFallback(scope: WordPressScope) {
  const css = await articleCssText(scope);
  const safeCss = css.replace(/<\/style/gi, "<\\/style");
  const id = scope === "ay-tercume" ? "ay-tercume-content-studio-inline-fallback" : "ttaa-content-studio-inline-fallback";
  return `<style id="${id}">\n${safeCss}\n</style>`;
}

function absoluteWordPressUrl(baseUrl: string, value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  return `${baseUrl}/${value.replace(/^\/+/, "")}`;
}

function imageAttribute(tag: string, name: string) {
  const match = new RegExp(`${name}=["']([^"']*)["']`, "i").exec(tag);
  return match?.[1] || "";
}

export async function getWordPressDraftMedia(slug: string): Promise<WordPressDraftMediaSnapshot | null> {
  const { baseUrl, username, applicationPassword } = wordpressConfig();
  const authorization = authHeader(username, applicationPassword);
  const safeSlug = slug.replace(/^\/+|\/+$/g, "");
  const postFields = "id,slug,content,featured_media,modified";
  const postsResponse = await fetch(`${baseUrl}/wp-json/wp/v2/posts?status=draft&context=edit&slug=${encodeURIComponent(safeSlug)}&per_page=1&_fields=${postFields}`, {
    headers: { Authorization: authorization, Accept: "application/json" },
    cache: "no-store",
  });
  if (!postsResponse.ok) throw new Error(`WordPress draft media lookup failed (${postsResponse.status}).`);
  type DraftLookup = { id: number; slug: string; featured_media: number; modified?: string; content: { raw: string } };
  let posts = await postsResponse.json() as DraftLookup[];
  if (!posts.length) {
    const search = safeSlug.replaceAll("-", " ");
    const fallbackResponse = await fetch(`${baseUrl}/wp-json/wp/v2/posts?status=draft&context=edit&search=${encodeURIComponent(search)}&orderby=modified&order=desc&per_page=20&_fields=${postFields}`, {
      headers: { Authorization: authorization, Accept: "application/json" },
      cache: "no-store",
    });
    if (!fallbackResponse.ok) throw new Error(`WordPress draft media fallback lookup failed (${fallbackResponse.status}).`);
    const candidates = await fallbackResponse.json() as DraftLookup[];
    posts = candidates.filter((item) => item.slug === safeSlug || new RegExp(`^${safeSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+$`).test(item.slug));
  }
  const post = posts[0];
  if (!post?.featured_media || !post.content?.raw) return null;
  const figureMatch = /<figure\b[^>]*class=["'][^"']*ttaa-inline-image[^"']*["'][^>]*>[\s\S]*?<img\b[^>]*>[\s\S]*?<\/figure>/i.exec(post.content.raw);
  const imageTag = figureMatch?.[0].match(/<img\b[^>]*>/i)?.[0];
  if (!imageTag) return null;

  const mediaResponse = await fetch(`${baseUrl}/wp-json/wp/v2/media/${post.featured_media}?context=edit&_fields=id,source_url,alt_text,media_details`, {
    headers: { Authorization: authorization, Accept: "application/json" },
    cache: "no-store",
  });
  if (!mediaResponse.ok) throw new Error(`WordPress featured media lookup failed (${mediaResponse.status}).`);
  const media = await mediaResponse.json() as { id: number; source_url: string; alt_text?: string; media_details?: { width?: number; height?: number } };
  const inlineUrl = absoluteWordPressUrl(baseUrl, imageAttribute(imageTag, "src"));
  const inlineIdMatch = /wp-image-(\d+)/i.exec(figureMatch?.[0] || "");
  let inlineId = inlineIdMatch ? Number(inlineIdMatch[1]) : 0;
  if (!inlineId) {
    const childrenResponse = await fetch(`${baseUrl}/wp-json/wp/v2/media?parent=${post.id}&context=edit&per_page=20&_fields=id,source_url`, {
      headers: { Authorization: authorization, Accept: "application/json" },
      cache: "no-store",
    });
    if (childrenResponse.ok) {
      const children = await childrenResponse.json() as Array<{ id: number; source_url: string }>;
      inlineId = children.find((item) => absoluteWordPressUrl(baseUrl, item.source_url) === inlineUrl)?.id || 0;
    }
  }
  return {
    postId: post.id,
    html: post.content.raw,
    featured: {
      id: media.id,
      url: absoluteWordPressUrl(baseUrl, media.source_url),
      alt: media.alt_text || `${safeSlug.replaceAll("-", " ")} featured image`,
      width: media.media_details?.width || 1536,
      height: media.media_details?.height || 864,
    },
    inline: {
      id: inlineId,
      url: inlineUrl,
      alt: imageAttribute(imageTag, "alt") || `${safeSlug.replaceAll("-", " ")} article image`,
      width: Number(imageAttribute(imageTag, "width")) || 1536,
      height: Number(imageAttribute(imageTag, "height")) || 864,
    },
  };
}

export async function deleteWordPressMedia(mediaId: number, scope: WordPressScope = "ttaa") {
  const { baseUrl, username, applicationPassword } = wordpressConfig(scope);
  const response = await fetch(`${baseUrl}/wp-json/wp/v2/media/${mediaId}?force=true`, {
    method: "DELETE",
    headers: { Authorization: authHeader(username, applicationPassword), Accept: "application/json" },
  });
  if (!response.ok && response.status !== 404) throw new Error(`WordPress media cleanup failed (${response.status}).`);
}

export async function uploadWordPressMedia(input: { bytes: Uint8Array; fileName: string; contentType: string; alt: string; title: string; caption?: string; description?: string }, scope: WordPressScope = "ttaa"): Promise<WordPressMedia> {
  const { baseUrl, username, applicationPassword } = wordpressConfig(scope);
  const authorization = authHeader(username, applicationPassword);
  const fileName = input.fileName.replace(/[^a-z0-9._-]/gi, "-");
  let lastError = "WordPress media upload failed.";
  let uploaded: { id: number; source_url?: string; message?: string } | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${baseUrl}/wp-json/wp/v2/media`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        "Content-Type": input.contentType,
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
      body: new Blob([input.bytes.slice().buffer], { type: input.contentType }),
    });
    const payload = await readWordPressJson<{ id: number; source_url?: string; message?: string }>(response, "media upload");
    if (response.ok && payload.id && payload.source_url) {
      uploaded = payload;
      break;
    }
    lastError = payload.message || `WordPress media upload failed (${response.status}).`;
    if (!(response.status === 429 || response.status >= 500) || attempt === 2) break;
    await wait(800 * 2 ** attempt);
  }
  if (!uploaded?.id || !uploaded.source_url) throw new Error(lastError);

  const metadataResponse = await fetch(`${baseUrl}/wp-json/wp/v2/media/${uploaded.id}`, {
    method: "POST",
    headers: { Authorization: authorization, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ title: input.title, alt_text: input.alt, caption: input.caption || "", description: input.description || "" }),
  });
  if (!metadataResponse.ok) {
    await deleteWordPressMedia(uploaded.id, scope).catch(() => undefined);
    throw new Error(`WordPress media metadata update failed (${metadataResponse.status}).`);
  }
  return { id: uploaded.id, url: absoluteWordPressUrl(baseUrl, uploaded.source_url), fileName, alt: input.alt };
}

export async function attachWordPressMedia(mediaIds: number[], postId: number, scope: WordPressScope = "ttaa") {
  const { baseUrl, username, applicationPassword } = wordpressConfig(scope);
  const authorization = authHeader(username, applicationPassword);
  const results = await Promise.allSettled(mediaIds.map(async (mediaId) => {
    const response = await fetch(`${baseUrl}/wp-json/wp/v2/media/${mediaId}`, {
      method: "POST",
      headers: { Authorization: authorization, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ post: postId }),
    });
    if (!response.ok) throw new Error(`Media ${mediaId} could not be attached to post ${postId}.`);
  }));
  const failures = results.filter((result) => result.status === "rejected");
  return { attached: failures.length === 0, warning: failures.length ? `${failures.length} WordPress media item(s) could not be assigned to the draft parent.` : undefined };
}

async function detectSeoPlugin(baseUrl: string) {
  try {
    const response = await fetch(`${baseUrl}/wp-json/`, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) return "none" as const;
    const payload = await readWordPressJson<{ namespaces?: string[] }>(response, "API discovery");
    const namespaces = payload.namespaces || [];
    if (namespaces.some((namespace) => namespace.startsWith("aioseo/"))) return "aioseo" as const;
    if (namespaces.some((namespace) => /yoast/i.test(namespace))) return "yoast" as const;
    if (namespaces.some((namespace) => /rank.?math/i.test(namespace))) return "rank-math" as const;
  } catch { /* WordPress core fallback remains available. */ }
  return "none" as const;
}

function schemaForContent(schema: string, seoPlugin: "aioseo" | "yoast" | "rank-math" | "none") {
  if (seoPlugin === "none") return schema;
  try {
    const parsed = JSON.parse(schema) as { "@context"?: string; "@graph"?: Array<Record<string, unknown>> };
    const faqOnly = (parsed["@graph"] || []).filter((item) => item["@type"] === "FAQPage");
    return faqOnly.length ? JSON.stringify({ "@context": parsed["@context"] || "https://schema.org", "@graph": faqOnly }, null, 2) : "";
  } catch {
    return "";
  }
}

function canonicalFromDraft(baseUrl: string, slug: string, link: string) {
  const cleanSlug = slug.replace(/^\/+|\/+$/g, "");
  if (link && !/[?&]p=\d+/.test(link)) return link.endsWith("/") ? link : `${link}/`;
  return `${baseUrl}/${cleanSlug}/`;
}

function jobMarker(jobId: string) {
  return `<!-- TTAA_CONTENT_JOB:${jobId.replace(/[^a-zA-Z0-9-]/g, "")} -->`;
}

async function findDraftByJobMarker(
  baseUrl: string,
  authorization: string,
  requestedSlug: string,
  postTitle: string,
  marker: string,
) {
  const fields = "id,status,link,slug,title,content,featured_media";
  const endpoints = [
    `${baseUrl}/wp-json/wp/v2/posts?status=draft&context=edit&slug=${encodeURIComponent(requestedSlug)}&per_page=20&_fields=${fields}`,
    `${baseUrl}/wp-json/wp/v2/posts?status=draft&context=edit&search=${encodeURIComponent(postTitle)}&orderby=modified&order=desc&per_page=20&_fields=${fields}`,
  ];
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, { headers: { Authorization: authorization, Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) continue;
    const posts = await readWordPressJson<WordPressDraftLookup[]>(response, "idempotency lookup");
    const match = posts.find((post) => post.content?.raw?.includes(marker));
    if (match) return match;
  }
  return null;
}

export async function verifyWordPressConnection(scope: WordPressScope = "ttaa") {
  const { baseUrl, username, applicationPassword } = wordpressConfig(scope);
  const response = await fetch(`${baseUrl}/wp-json/wp/v2/users/me?context=edit`, {
    headers: { Authorization: authHeader(username, applicationPassword), Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`WordPress authentication failed (${response.status}).`);
  const user = await readWordPressJson<{ id: number; name: string; slug: string }>(response, "authentication check");
  const seoPlugin = await detectSeoPlugin(baseUrl);
  const articleCssUrl = sharedCssInfo(baseUrl, scope).url;
  let articleCssReady = false;
  try {
    const stylesheet = await fetch(articleCssUrl, { method: "GET", cache: "no-store" });
    articleCssReady = stylesheet.ok && (await stylesheet.text()).includes(sharedCssInfo(baseUrl, scope).marker);
  } catch { /* The WordPress connection itself can still be healthy. */ }
  return { id: user.id, name: user.name, slug: user.slug, seoPlugin, articleCss: { ready: articleCssReady, url: articleCssUrl } };
}

export async function createWordPressDraft(input: WordPressDraftInput, scope: WordPressScope = "ttaa") {
  const { baseUrl, username, applicationPassword } = wordpressConfig(scope);
  const authorization = authHeader(username, applicationPassword);
  const seoPlugin = await detectSeoPlugin(baseUrl);
  const contentSchema = schemaForContent(input.schema, seoPlugin);
  const safeSchema = contentSchema.replace(/<\/script/gi, "<\\/script");
  const stylesheetReady = await sharedArticleCssReady(baseUrl, scope);
  // WordPress themes and visual builders do not consistently execute a plugin
  // stylesheet in every preview/render context. Keep the shared file as the
  // canonical source, but embed its scoped contents so the draft is portable
  // and the final cascade is applied after the theme styles.
  const styledHtml = `${await inlineStyleFallback(scope)}\n${input.html}`;
  const marker = input.jobId ? jobMarker(input.jobId) : "";
  const contentBody = marker ? `${styledHtml}\n${marker}` : styledHtml;
  const content = safeSchema ? `${contentBody}\n\n<script type="application/ld+json">\n${safeSchema}\n</script>` : contentBody;
  const requestedSlug = input.slug.replace(/^\/+|\/+$/g, "");

  const existing = marker ? await findDraftByJobMarker(baseUrl, authorization, requestedSlug, input.postTitle, marker) : null;
  const endpoint = existing
    ? `${baseUrl}/wp-json/wp/v2/posts/${existing.id}`
    : `${baseUrl}/wp-json/wp/v2/posts`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      title: input.postTitle,
      content,
      excerpt: input.metaDescription,
      slug: requestedSlug,
      status: "draft",
      featured_media: input.featuredMedia || existing?.featured_media || 0,
    }),
  });
  const payload = await readWordPressJson<WordPressDraft>(response, existing ? "idempotent draft reconciliation" : "draft creation");
  if (!response.ok) throw new Error(payload.message || `WordPress draft creation failed (${response.status}).`);
  if (payload.status !== "draft") throw new Error("WordPress returned a non-draft status; the operation was stopped.");

  const canonical = canonicalFromDraft(baseUrl, payload.slug || requestedSlug, payload.link);
  let seoApplied = false;
  let focusKeywordApplied = false;
  let secondaryKeywordsApplied = false;
  let seoWarning: string | undefined;

  if (seoPlugin === "aioseo") {
    const initialMeta = await readAioseoMeta(baseUrl, authorization, payload.id);
    const keyphrases = buildAioseoKeyphrases(initialMeta?.keyphrases, input.focusKeyword, input.secondaryKeywords);
    const seoResponse = await fetch(`${baseUrl}/wp-json/wp/v2/posts/${payload.id}`, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        aioseo_meta_data: {
          title: input.seoTitle,
          description: input.metaDescription,
          canonical_url: canonical,
          keyphrases,
        },
      }),
    });
    const seoPayload = await readWordPressJson<{ message?: string }>(seoResponse, "AIOSEO metadata update");
    if (!seoResponse.ok) {
      seoWarning = seoPayload.message || `AIOSEO metadata update failed (${seoResponse.status}).`;
      const baseMetadataResponse = await fetch(`${baseUrl}/wp-json/wp/v2/posts/${payload.id}`, {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ aioseo_meta_data: { title: input.seoTitle, description: input.metaDescription, canonical_url: canonical } }),
      });
      if (!baseMetadataResponse.ok) {
        const basePayload = await readWordPressJson<{ message?: string }>(baseMetadataResponse, "AIOSEO base metadata retry");
        seoWarning = [seoWarning, basePayload.message || `AIOSEO base metadata retry failed (${baseMetadataResponse.status}).`].filter(Boolean).join(" ");
      }
    }

    let meta = await readAioseoMeta(baseUrl, authorization, payload.id);
    let keyphraseVerification = verifyAioseoKeyphrases(meta, input.focusKeyword, input.secondaryKeywords);
    if (!keyphraseVerification.focusKeywordApplied || !keyphraseVerification.secondaryKeywordsApplied) {
      const fallbackResponse = await fetch(`${baseUrl}/wp-json/aioseo/v1/keyphrases`, {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ postId: payload.id, keyphrases }),
      });
      if (fallbackResponse.ok) {
        meta = await readAioseoMeta(baseUrl, authorization, payload.id);
        keyphraseVerification = verifyAioseoKeyphrases(meta, input.focusKeyword, input.secondaryKeywords);
      } else {
        const fallbackPayload = await readWordPressJson<{ message?: string }>(fallbackResponse, "AIOSEO keyphrase fallback");
        seoWarning = [seoWarning, fallbackPayload.message || `AIOSEO focus keyword fallback failed (${fallbackResponse.status}).`].filter(Boolean).join(" ");
      }
    }

    focusKeywordApplied = keyphraseVerification.focusKeywordApplied;
    secondaryKeywordsApplied = keyphraseVerification.secondaryKeywordsApplied;
    const baseSeoApplied = Boolean(meta && meta.title === input.seoTitle && meta.description === input.metaDescription && meta.canonical_url === canonical);
    seoApplied = baseSeoApplied && focusKeywordApplied && secondaryKeywordsApplied;
    if (!focusKeywordApplied || !secondaryKeywordsApplied) {
      seoWarning = [seoWarning, "AIOSEO focus keyword needs attention: the focus or additional keyphrases could not be verified by authenticated read-back."].filter(Boolean).join(" ");
    } else if (!baseSeoApplied) {
      seoWarning = [seoWarning, "AIOSEO keyphrases were verified, but title, description or canonical could not be fully verified."].filter(Boolean).join(" ");
    }
  } else if (seoPlugin === "rank-math") {
    const rankMathMeta = {
      rank_math_title: input.seoTitle,
      rank_math_description: input.metaDescription,
      rank_math_canonical_url: canonical,
      rank_math_focus_keyword: [input.focusKeyword, ...input.secondaryKeywords].join(", "),
    };
    const rankMathResponse = await fetch(`${baseUrl}/wp-json/rankmath/v1/updateMeta`, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ objectType: "post", objectID: payload.id, meta: rankMathMeta }),
    });
    if (rankMathResponse.ok) {
      seoApplied = true;
      focusKeywordApplied = true;
      secondaryKeywordsApplied = true;
    } else {
      const rankMathPayload = await readWordPressJson<{ message?: string }>(rankMathResponse, "Rank Math metadata update");
      seoWarning = rankMathPayload.message || `Rank Math metadata update failed (${rankMathResponse.status}).`;
    }
  } else if (seoPlugin !== "none") {
    seoWarning = `${seoPlugin} was detected, but automatic metadata writing is not configured for that plugin.`;
  } else {
    seoWarning = "No supported SEO plugin was detected; WordPress title and canonical fallback remain active, but the meta description requires verification.";
  }

  return {
    id: payload.id,
    status: payload.status,
    link: payload.link,
    canonical,
    editUrl: `${baseUrl}/wp-admin/post.php?post=${payload.id}&action=edit`,
    title: payload.title.rendered,
    seo: {
      plugin: seoPlugin,
      applied: seoApplied,
      focusKeywordApplied,
      secondaryKeywordsApplied,
      focusKeyword: input.focusKeyword,
      secondaryKeywords: input.secondaryKeywords,
      warning: seoWarning,
      schemaOwner: seoPlugin === "none" ? scope : seoPlugin,
      faqSchemaEmbedded: Boolean(contentSchema && seoPlugin !== "none"),
    },
    design: {
      sharedStylesheetReady: stylesheetReady,
      inlineFallbackEmbedded: true,
      warning: stylesheetReady
        ? undefined
        : "The shared WordPress stylesheet was unavailable; the same scoped CSS was embedded in this draft.",
    },
  };
}
