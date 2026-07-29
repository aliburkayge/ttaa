import { dedupeAyLinks, getAyCuratedLinks } from "./ay-link-catalog";
import { generateAyArticle, type AyGenerationBrief } from "./ay-openai";
import { generateAyBlogImage, type AyGeneratedImageBinary, type AyImageRole } from "./ay-openai-images";
import { buildAyContentPackage, type AyContentPackage, type AyRenderOptions } from "./ay-render";
import { classifyJobError } from "./job-errors";
import { getContentJob, updateJobCheckpoint, type ContentJob } from "./jobs";
import { canonicalLinkHost, dedupeLinks, type ResearchedLink } from "./link-catalog";
import { logEvent } from "./observability";
import { generateAndEditArticle, type GenerationBrief } from "./openai";
import { generateBlogImage, type GeneratedImageBinary, type ImageRole } from "./openai-images";
import { researchBrief } from "./research";
import { loadGeneratedImage, storeContentPackage, storeGeneratedImage } from "./supabase";
import { buildTtaaContentPackage, type TtaaContentPackage, type TtaaRenderOptions } from "./ttaa-render";
import { integerEnv } from "./upstream";
import { attachWordPressMedia, createWordPressDraft, deleteWordPressMedia, uploadWordPressMedia, type WordPressMedia, type WordPressScope } from "./wordpress";

type BinaryImage = GeneratedImageBinary | AyGeneratedImageBinary;
type ImageRoleValue = ImageRole | AyImageRole;

type StoredImage = {
  role: ImageRoleValue;
  storage?: { bucket: string; path: string };
  storageWarning?: string;
  fileName: string;
  contentType: BinaryImage["contentType"];
  prompt: string;
  revisedPrompt?: string;
  alt: string;
  titleText?: string;
  caption?: string;
  description?: string;
  width: number;
  height: number;
  format: string;
  model: string;
  quality: string;
  branding: BinaryImage["branding"];
};

type PipelineCheckpoint = {
  research?: { links: ResearchedLink[]; mode: string; researchedAt: string };
  package?: TtaaContentPackage | AyContentPackage;
  responseIds?: Record<string, string>;
  images?: Partial<Record<ImageRoleValue, StoredImage>>;
  wordpressMedia?: Partial<Record<ImageRoleValue, WordPressMedia>>;
  wordpress?: Record<string, unknown>;
  warnings?: string[];
};

function isAy(job: ContentJob) {
  return job.brand === "ay-tercume";
}

function jobOrigin() {
  const value = process.env.PUBLIC_APP_URL || process.env.RAILWAY_PUBLIC_DOMAIN;
  if (!value) throw new Error("PUBLIC_APP_URL is required by the Railway worker to load protected brand assets.");
  return /^https?:\/\//.test(value) ? value.replace(/\/$/, "") : `https://${value.replace(/\/$/, "")}`;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function injectInlineImage(html: string, media: WordPressMedia, image: StoredImage, brand: ContentJob["brand"]) {
  const className = brand === "ay-tercume" ? "ayc-inline-image" : "ttaa-inline-image";
  const caption = brand === "ay-tercume" && image.caption ? `<figcaption>${escapeHtml(image.caption)}</figcaption>` : "";
  const figure = `<figure class="${className}"><img class="wp-image-${media.id}" src="${escapeHtml(media.url)}" alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async">${caption}</figure>`;
  const marker = brand === "ay-tercume" ? "<!-- AY_INLINE_IMAGE -->" : "<!-- TTAA_INLINE_IMAGE -->";
  if (html.includes(marker)) return html.replace(marker, figure);
  const resourceMarker = brand === "ay-tercume" ? '<aside class="ayc-resources"' : '<aside class="ttaa-resources"';
  const position = html.indexOf(resourceMarker);
  return position >= 0 ? `${html.slice(0, position)}${figure}\n${html.slice(position)}` : `${html}\n${figure}`;
}

function addFeaturedImageToSchema(schema: string, media: WordPressMedia, image: StoredImage) {
  try {
    const parsed = JSON.parse(schema) as { "@graph"?: Array<Record<string, unknown>> };
    for (const item of parsed["@graph"] || []) {
      if (item["@type"] === "BlogPosting" || item["@type"] === "Article") {
        item.image = { "@type": "ImageObject", url: media.url, width: image.width, height: image.height };
      }
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return schema;
  }
}

async function liveAyLinks(brief: AyGenerationBrief): Promise<ResearchedLink[]> {
  const base = process.env.AY_WP_URL?.trim().replace(/\/$/, "");
  if (!base) return [];
  try {
    const query = new URLSearchParams({ search: `${brief.topic} ${brief.country}`.trim(), per_page: "8", type: "post" });
    const response = await fetch(`${base}/wp-json/wp/v2/search?${query}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return [];
    const items = await response.json() as Array<{ title?: string; url?: string; subtype?: string }>;
    return items
      .filter((item) => item.url?.startsWith(base) && item.title)
      .map((item) => ({
        anchor: (item.title || "").replace(/<[^>]+>/g, "").trim(),
        url: item.url || "",
        reason: `Related AY Tercüme ${item.subtype || "content"} page`,
        source: "internal" as const,
      }));
  } catch {
    return [];
  }
}

async function ensureNotCancelled(jobId: string) {
  const latest = await getContentJob(jobId);
  if (!latest) throw new Error("The active job no longer exists.");
  if (latest.cancel_requested) throw new Error("The content job was cancelled.");
  return latest;
}

async function checkpoint(
  job: ContentJob,
  workerId: string,
  stage: string,
  progress: number,
  value: PipelineCheckpoint,
) {
  const updated = await updateJobCheckpoint(job, workerId, { stage, progress, checkpoint: value as Record<string, unknown> });
  logEvent("job.checkpoint", { jobId: job.id, brand: job.brand, stage, progress });
  return updated;
}

function storedImage(image: BinaryImage, storage?: { bucket: string; path: string }, storageWarning?: string): StoredImage {
  const ay = "titleText" in image;
  return {
    role: image.role,
    storage,
    storageWarning,
    fileName: image.fileName,
    contentType: image.contentType,
    prompt: image.prompt,
    revisedPrompt: image.revisedPrompt,
    alt: image.alt,
    ...(ay ? {
      titleText: image.titleText,
      caption: image.caption,
      description: image.description,
    } : {}),
    width: image.width,
    height: image.height,
    format: image.format,
    model: image.model,
    quality: image.quality,
    branding: image.branding,
  };
}

async function bytesForImage(image: StoredImage, cache: Map<ImageRoleValue, BinaryImage>) {
  const cached = cache.get(image.role);
  if (cached) return cached.bytes;
  if (!image.storage?.path) throw new Error(`${image.role} image has no durable storage checkpoint.`);
  return loadGeneratedImage(image.storage.path);
}

function finalImage(image: StoredImage, media: WordPressMedia, brand: ContentJob["brand"]) {
  const common = {
    role: image.role,
    wordpress: { id: media.id, url: media.url },
    supabase: image.storage || null,
    fileName: image.fileName,
    contentType: image.contentType,
    prompt: image.prompt,
    revisedPrompt: image.revisedPrompt,
    alt: image.alt,
    width: image.width,
    height: image.height,
    format: image.format,
    model: image.model,
    quality: image.quality,
    branding: image.branding,
    origin: "new-generation",
  };
  return brand === "ay-tercume"
    ? { ...common, dataUrl: media.url, titleText: image.titleText || "", caption: image.caption || image.alt, description: image.description || image.alt }
    : common;
}

export async function runContentJob(initialJob: ContentJob, workerId: string) {
  const startedAt = Date.now();
  const maxRuntime = integerEnv("JOB_MAX_RUNTIME_MS", 2_700_000, 60_000);
  let job = initialJob;
  const cp = { ...(job.checkpoint || {}) } as PipelineCheckpoint;
  cp.responseIds = { ...(cp.responseIds || {}) };
  cp.images = { ...(cp.images || {}) };
  cp.wordpressMedia = { ...(cp.wordpressMedia || {}) };
  cp.warnings = [...(cp.warnings || [])];
  const imageCache = new Map<ImageRoleValue, BinaryImage>();

  const deadlineCheck = () => {
    if (Date.now() - startedAt > maxRuntime) throw new Error(`Job deadline exceeded after ${maxRuntime}ms.`);
  };

  if (!cp.research) {
    job = await checkpoint(job, workerId, "research", 8, cp);
    deadlineCheck();
    if (isAy(job)) {
      const brief = job.brief as unknown as AyGenerationBrief;
      const links = dedupeAyLinks([...getAyCuratedLinks(brief), ...await liveAyLinks(brief)]).slice(0, 14);
      cp.research = { links, mode: process.env.AY_WP_URL ? "live-ay-wordpress-plus-official-web-search" : "curated-ay-links-plus-official-web-search", researchedAt: new Date().toISOString() };
    } else {
      const research = await researchBrief(job.brief as unknown as GenerationBrief);
      cp.research = research;
    }
    job = await checkpoint(job, workerId, "research", 18, cp);
  }

  await ensureNotCancelled(job.id);
  if (!cp.package) {
    job = await checkpoint(job, workerId, "writing", 24, cp);
    const onResponseId = async (stage: string, responseId: string) => {
      cp.responseIds = { ...(cp.responseIds || {}), [stage]: responseId };
      job = await checkpoint(job, workerId, stage.startsWith("repair") ? "quality-control" : stage, stage === "writer" ? 32 : 48, cp);
    };
    if (isAy(job)) {
      const brief = job.brief as unknown as AyGenerationBrief & AyRenderOptions;
      const generated = await generateAyArticle(brief, cp.research.links, { jobId: job.id, responseIds: cp.responseIds, onResponseId });
      const selected = new Set(generated.article.internalLinkSuggestions.map((anchor) => anchor.toLocaleLowerCase("tr-TR")));
      const internal = cp.research.links.filter((link) => link.source === "internal" && selected.has(link.anchor.toLocaleLowerCase("tr-TR"))).slice(0, 6);
      const official = cp.research.links.filter((link) => link.source === "official");
      const known = new Set(official.map((link) => canonicalLinkHost(link.url)));
      const discovered = generated.discoveredSources.filter((link) => !known.has(canonicalLinkHost(link.url)));
      const links = dedupeAyLinks([...internal, ...official, ...discovered]).slice(0, 14);
      cp.package = buildAyContentPackage(generated.article, links, {
        includeH1: brief.includeH1 ?? true,
        visibleBreadcrumb: brief.visibleBreadcrumb ?? true,
        articleSchema: brief.articleSchema ?? true,
        faqSchema: brief.faqSchema ?? true,
      }, generated.trace, { mode: cp.research.mode, researchedAt: cp.research.researchedAt });
    } else {
      const brief = job.brief as unknown as GenerationBrief & TtaaRenderOptions;
      const generated = await generateAndEditArticle(brief, cp.research.links, { jobId: job.id, responseIds: cp.responseIds, onResponseId });
      const selected = new Set(generated.article.internalLinkSuggestions.map((anchor) => anchor.toLowerCase()));
      const internal = cp.research.links.filter((link) => link.source === "internal" && selected.has(link.anchor.toLowerCase())).slice(0, 6);
      const official = cp.research.links.filter((link) => link.source === "official");
      const known = new Set(official.map((link) => canonicalLinkHost(link.url)));
      const discoveredHosts = new Set<string>();
      const discovered = generated.discoveredSources.filter((link) => {
        const host = canonicalLinkHost(link.url);
        if (known.has(host) || discoveredHosts.has(host)) return false;
        discoveredHosts.add(host);
        return true;
      });
      const links = dedupeLinks([...internal, ...official, ...discovered]).slice(0, 14);
      cp.package = buildTtaaContentPackage(generated.article, links, {
        includeH1: brief.includeH1 ?? true,
        visibleBreadcrumb: brief.visibleBreadcrumb ?? true,
        articleSchema: brief.articleSchema ?? true,
        faqSchema: brief.faqSchema ?? true,
      }, generated.trace, { mode: cp.research.mode, researchedAt: cp.research.researchedAt });
    }
    job = await checkpoint(job, workerId, "quality-control", 58, cp);
  }

  await ensureNotCancelled(job.id);
  deadlineCheck();
  if (!cp.images.featured || !cp.images.inline) {
    job = await checkpoint(job, workerId, "images", 62, cp);
    const pkg = cp.package;
    const missing = (["featured", "inline"] as ImageRoleValue[]).filter((role) => !cp.images?.[role]);
    let writes = Promise.resolve();
    const tasks = missing.map(async (role) => {
      const image = isAy(job)
        ? await generateAyBlogImage({
            title: pkg.preview.title,
            slug: pkg.slug,
            primaryPrompt: pkg.imagePrompt,
            suggestions: pkg.imageSuggestions,
            assetOrigin: jobOrigin(),
          }, role as AyImageRole)
        : await generateBlogImage({
            title: pkg.preview.title,
            slug: pkg.slug,
            primaryPrompt: pkg.imagePrompt,
            suggestions: pkg.imageSuggestions,
            assetOrigin: jobOrigin(),
          }, role as ImageRole);
      imageCache.set(role, image);
      let storage: { bucket: string; path: string } | undefined;
      let storageWarning: string | undefined;
      try {
        storage = await storeGeneratedImage({ bytes: image.bytes, fileName: image.fileName, contentType: image.contentType, slug: pkg.slug, role });
      } catch (error) {
        storageWarning = error instanceof Error ? error.message : "Supabase image backup failed.";
        cp.warnings?.push(`${role}: ${storageWarning}`);
      }
      cp.images = { ...(cp.images || {}), [role]: storedImage(image, storage, storageWarning) };
      writes = writes.then(async () => {
        job = await checkpoint(job, workerId, "images", role === "featured" ? 68 : 74, cp);
      });
      await writes;
    });
    const settled = await Promise.allSettled(tasks);
    const failed = settled.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    if (!cp.images.featured || !cp.images.inline) throw new Error("Both generated images are required.");
  }

  await ensureNotCancelled(job.id);
  deadlineCheck();
  const scope: WordPressScope = isAy(job) ? "ay-tercume" : "ttaa";
  job = await checkpoint(job, workerId, "wordpress-media", 78, cp);
  for (const role of ["featured", "inline"] as ImageRoleValue[]) {
    if (cp.wordpressMedia?.[role]) continue;
    const image = cp.images[role];
    if (!image) throw new Error(`${role} image checkpoint is missing.`);
    const bytes = await bytesForImage(image, imageCache);
    const media = await uploadWordPressMedia({
      bytes,
      fileName: image.fileName,
      contentType: image.contentType,
      alt: image.alt,
      title: image.titleText || `${cp.package.preview.title} - ${role === "featured" ? "Featured Image" : "Article Image"}`,
      caption: image.caption,
      description: image.description,
    }, scope);
    cp.wordpressMedia = { ...(cp.wordpressMedia || {}), [role]: media };
    job = await checkpoint(job, workerId, "wordpress-media", role === "featured" ? 82 : 86, cp);
  }

  await ensureNotCancelled(job.id);
  deadlineCheck();
  const featuredImage = cp.images.featured;
  const inlineImage = cp.images.inline;
  const featuredMedia = cp.wordpressMedia.featured;
  const inlineMedia = cp.wordpressMedia.inline;
  if (!featuredImage || !inlineImage || !featuredMedia || !inlineMedia) throw new Error("WordPress media reconciliation is incomplete.");
  const finalHtml = injectInlineImage(cp.package.html, inlineMedia, inlineImage, job.brand);
  const finalSchema = addFeaturedImageToSchema(cp.package.schema, featuredMedia, featuredImage);

  if (!cp.wordpress) {
    job = await checkpoint(job, workerId, "wordpress-draft", 90, cp);
    try {
      cp.wordpress = await createWordPressDraft({
        postTitle: cp.package.preview.title,
        seoTitle: cp.package.title,
        html: finalHtml,
        schema: finalSchema,
        metaDescription: cp.package.meta,
        slug: cp.package.slug,
        focusKeyword: cp.package.focusKeyword,
        secondaryKeywords: cp.package.secondaryKeywords,
        featuredMedia: featuredMedia.id,
        jobId: job.id,
      }, scope);
    } catch (error) {
      const createdIds = [featuredMedia.id, inlineMedia.id];
      await Promise.allSettled(createdIds.map((id) => deleteWordPressMedia(id, scope)));
      cp.wordpressMedia = {};
      await checkpoint(job, workerId, "wordpress-draft", 88, cp);
      throw error;
    }
    job = await checkpoint(job, workerId, "wordpress-draft", 94, cp);
  }

  const wordpress = cp.wordpress as { id: number; canonical?: string };
  const attachment = await attachWordPressMedia([featuredMedia.id, inlineMedia.id], wordpress.id, scope);
  if (attachment.warning) cp.warnings?.push(attachment.warning);
  const images = {
    featured: finalImage(featuredImage, featuredMedia, job.brand),
    inline: finalImage(inlineImage, inlineMedia, job.brand),
  };
  const completedPackage = {
    ...cp.package,
    html: finalHtml,
    schema: finalSchema,
    canonical: wordpress.canonical || cp.package.canonical,
    canonicalReady: true,
    images,
    wordpress: cp.wordpress,
  } as Record<string, unknown>;
  try {
    const storage = await storeContentPackage({
      jobId: job.id,
      brand: job.brand,
      status: "complete",
      contentPackage: completedPackage,
      wordpress: cp.wordpress,
      createdBy: job.owner_email,
      createdAt: new Date().toISOString(),
    }, cp.package.slug);
    completedPackage.storage = storage;
  } catch (error) {
    cp.warnings?.push(error instanceof Error ? error.message : "Supabase package backup failed.");
  }
  if (cp.warnings?.length) completedPackage.warning = cp.warnings.join(" ");
  job = await checkpoint(job, workerId, "persistence", 98, cp);
  return {
    package: completedPackage,
    wordpress: cp.wordpress,
    images,
    warning: cp.warnings?.join(" ") || undefined,
  };
}

export function safePipelineError(error: unknown, job: ContentJob) {
  return classifyJobError(error, job.stage || "worker", job.id);
}

