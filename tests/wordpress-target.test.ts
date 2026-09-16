import assert from "node:assert/strict";
import { test, beforeEach, afterEach, type TestContext } from "node:test";
import { wordpressTarget, wordpressCollection, packageWordPressTarget, requireNewWordPressTarget, wordpressPagesEnabled, withoutWordPressTarget } from "../lib/wordpress-target";
import { createWordPressDraft, getWordPressDraftStatus, getWordPressDraftMedia, attachWordPressMedia, type WordPressDraftInput } from "../lib/wordpress";
import { classifyJobError } from "../lib/job-errors";
import { runContentJob } from "../lib/job-pipeline";
import type { ContentJob } from "../lib/jobs";
import { syncProjectToWordPress, type ContentProject } from "../lib/projects";

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.WP_URL = "https://ttaa.test";
  process.env.WP_USERNAME = "test";
  process.env.WP_APP_PASSWORD = "test";
  process.env.AY_WP_URL = "https://ay.test";
  process.env.AY_WP_USERNAME = "test-ay";
  process.env.AY_WP_APP_PASSWORD = "test-ay";
  delete process.env.WORDPRESS_PAGES_ENABLED;
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

const input: WordPressDraftInput = {
  postTitle: "Translation services", seoTitle: "Translation services | TTAA",
  html: '<article class="ttaa-article"><p>Content</p></article>',
  schema: JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "FAQPage" }] }),
  metaDescription: "Description", slug: "translation-services", focusKeyword: "translation",
  secondaryKeywords: ["documents", "attestation", "services"], featuredMedia: 12,
};
type Call = { url: URL; method: string; body: Record<string, unknown> };
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }

/** No requests may leave the process, including unexpected discovery requests. */
function fakeWordPress(t: TestContext, options: { plugin?: string; failCreate?: boolean; lookupFailure?: boolean; dropKeyphrases?: boolean } = {}) {
  const calls: Call[] = [];
  const records = new Map<string, Record<string, unknown>>();
  let nextId = 100;
  t.mock.method(globalThis, "fetch", async (raw: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(raw instanceof Request ? raw.url : raw.toString());
    assert.ok(["ttaa.test", "ay.test"].includes(url.hostname), `Unexpected network destination ${url.hostname}`);
    const method = init.method || "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
    calls.push({ url, method, body });
    if (url.pathname.endsWith(".css")) return new Response(".ttaa-article{} .ayc-article{}");
    if (url.pathname === "/wp-json/") return json({ namespaces: options.plugin ? [`${options.plugin}/v1`] : [] });
    if (url.pathname === "/wp-json/aioseo/v1/keyphrases") {
      const entry = [...records.values()].find((r) => r.id === body.postId)!;
      entry.aioseo_meta_data = { ...(entry.aioseo_meta_data as object), keyphrases: body.keyphrases };
      return json({ success: true });
    }
    if (url.pathname === "/wp-json/rankmath/v1/updateMeta") return json({ success: true });
    const media = /\/wp\/v2\/media\/(\d+)$/.exec(url.pathname);
    if (media) return json({ id: Number(media[1]), source_url: `${url.origin}/image.webp`, alt_text: "Alt", media_details: { width: 1536, height: 864 } });
    const match = /\/wp\/v2\/(posts|pages)(?:\/(\d+))?$/.exec(url.pathname);
    assert.ok(match, `Unexpected WordPress request ${method} ${url}`);
    const [, collection, id] = match;
    const key = `${url.origin}/${collection}/${id}`;
    if (method === "GET") {
      if (options.lookupFailure) return json({ message: "Forbidden" }, 403);
      if (id) return records.has(key) ? json(records.get(key)) : json({ message: "Not found" }, 404);
      return json([...records.entries()].filter(([k]) => k.startsWith(`${url.origin}/${collection}/`)).map(([, r]) => r));
    }
    if (options.failCreate) return json({ message: "Sorry, you are not allowed to create pages." }, 403);
    if (id) {
      const record = records.get(key)!;
      assert.ok(record, "Update must reference an existing record");
      if (body.aioseo_meta_data) {
        const metadata = { ...(body.aioseo_meta_data as Record<string, unknown>) };
        if (options.dropKeyphrases) delete metadata.keyphrases;
        record.aioseo_meta_data = metadata;
      } else {
        Object.assign(record, body, { content: { raw: body.content }, title: { rendered: body.title } });
      }
      return json(record);
    }
    const recordId = nextId++;
    const record = { ...body, id: recordId, status: body.status, link: `${url.origin}/?${collection === "pages" ? "page_id" : "p"}=${recordId}`, content: { raw: body.content }, title: { rendered: body.title } };
    records.set(`${url.origin}/${collection}/${recordId}`, record);
    return json(record, 201);
  });
  return { calls, records };
}

test("old data defaults to posts; only explicit post/page values are accepted", () => {
  assert.equal(wordpressTarget(undefined), "post");
  assert.equal(wordpressCollection(undefined), "posts");
  for (const invalid of [null, "pages", "product", "", {}, 1]) assert.throws(() => wordpressTarget(invalid));
  assert.equal(packageWordPressTarget({}), "post");
  assert.equal(packageWordPressTarget({ wordpressTarget: "page" }), "page");
  assert.equal(packageWordPressTarget({ wordpress: { wordpressTarget: "page" } }), "page");
  assert.throws(() => packageWordPressTarget({ wordpressTarget: "page" }, { wordpressTarget: "post" }));
});

test("page rollout is off by default and errors are actionable, not retryable", () => {
  assert.equal(wordpressPagesEnabled(), false);
  assert.equal(requireNewWordPressTarget(undefined), "post");
  try { requireNewWordPressTarget("page"); assert.fail("Must reject"); }
  catch (error) { assert.equal(classifyJobError(error).httpStatus, 409); assert.equal(classifyJobError(error).retryable, false); }
  process.env.WORDPRESS_PAGES_ENABLED = "true";
  assert.equal(requireNewWordPressTarget("page"), "page");
});

test("delivery selection never changes the writer/editor input", () => {
  const original = { topic: "Translation", sourceText: "Notes", includeH1: true };
  for (const wordpressTarget of ["post", "page"] as const) {
    const brief = { ...original, wordpressTarget };
    assert.deepEqual(withoutWordPressTarget(brief), original);
    assert.equal(brief.wordpressTarget, wordpressTarget);
  }
});

for (const brand of ["ttaa", "ay-tercume"] as const) {
  for (const target of [undefined, "post", "page"] as const) {
    test(`${brand}: ${target ?? "legacy"} creates one draft, keeps media and SEO on the same target`, async (t) => {
      const wp = fakeWordPress(t, { plugin: "aioseo" });
      const draft = await createWordPressDraft({ ...input, wordpressTarget: target, jobId: "job-123" }, brand);
      const collection = target === "page" ? "pages" : "posts";
      assert.equal(draft.wordpressTarget, target || "post");
      assert.equal(draft.status, "draft");
      assert.equal(draft.seo.applied, true);
      assert.equal(draft.canonical, `https://${brand === "ttaa" ? "ttaa" : "ay"}.test/translation-services/`);
      assert.ok(draft.editUrl.includes(`post=${draft.id}`));
      const create = wp.calls.find((c) => c.method === "POST" && c.url.pathname.endsWith(`/${collection}`))!;
      assert.equal(create.body.featured_media, 12);
      assert.ok(String(create.body.content).includes('TTAA_CONTENT_JOB:job-123'));
      assert.ok(String(create.body.content).includes("<style"));
      assert.equal(wp.calls.some((c) => c.url.pathname.includes(collection === "pages" ? "/posts" : "/pages")), false);
      assert.equal(await getWordPressDraftStatus(draft.id, brand, target), "draft");
      await attachWordPressMedia([12, 13], draft.id, brand);
      assert.deepEqual(wp.calls.filter((c) => c.url.pathname.includes("/media/")).map((c) => c.body.post), [draft.id, draft.id]);
    });
  }
}

test("page AIOSEO keyphrase fallback reads back from pages", async (t) => {
  const wp = fakeWordPress(t, { plugin: "aioseo", dropKeyphrases: true });
  const draft = await createWordPressDraft({ ...input, wordpressTarget: "page" });
  assert.equal(draft.seo.applied, true);
  assert.ok(wp.calls.some((c) => c.url.pathname === "/wp-json/aioseo/v1/keyphrases"));
  assert.equal(wp.calls.some((c) => c.url.pathname.includes("/posts")), false);
});

test("Rank Math keeps its object API while the content is created as a page", async (t) => {
  const wp = fakeWordPress(t, { plugin: "rankmath" });
  const draft = await createWordPressDraft({ ...input, wordpressTarget: "page" });
  assert.equal(draft.seo.applied, true);
  assert.equal(wp.calls.find((c) => c.url.pathname.includes("updateMeta"))?.body.objectID, draft.id);
});

test("retry reconciles the same page, never creates a post or second page", async (t) => {
  const wp = fakeWordPress(t);
  const first = await createWordPressDraft({ ...input, wordpressTarget: "page", jobId: "retry-job" });
  const retry = await createWordPressDraft({ ...input, wordpressTarget: "page", jobId: "retry-job" });
  assert.equal(first.id, retry.id);
  assert.equal(wp.records.size, 1);
});

test("managed page synchronization stays on its ID even after title/slug change", async (t) => {
  const wp = fakeWordPress(t);
  const first = await createWordPressDraft({ ...input, wordpressTarget: "page", jobId: "sync-job" });
  const synced = await createWordPressDraft({ ...input, wordpressTarget: "page", jobId: "sync-job", managedDraftId: first.id, slug: "new-slug", postTitle: "New title" });
  assert.equal(synced.id, first.id);
  assert.equal(wp.records.size, 1);
  assert.equal(synced.canonical, "https://ttaa.test/new-slug/");
});

test("published managed content and wrong ownership markers are never overwritten", async (t) => {
  const wp = fakeWordPress(t);
  const first = await createWordPressDraft({ ...input, wordpressTarget: "page", jobId: "sync-job" });
  const record = [...wp.records.values()][0];
  const writes = wp.calls.filter((c) => c.method === "POST").length;
  record.status = "publish";
  await assert.rejects(createWordPressDraft({ ...input, wordpressTarget: "page", jobId: "sync-job", managedDraftId: first.id }), /WORDPRESS_NOT_DRAFT/);
  record.status = "draft";
  await assert.rejects(createWordPressDraft({ ...input, wordpressTarget: "page", jobId: "wrong-job", managedDraftId: first.id }), /marker mismatch/);
  assert.equal(wp.calls.filter((c) => c.method === "POST").length, writes);
});

test("page permission denial never falls back to posts", async (t) => {
  const wp = fakeWordPress(t, { failCreate: true });
  await assert.rejects(createWordPressDraft({ ...input, wordpressTarget: "page" }), /sayfa.*yetkisini/);
  assert.equal(wp.calls.filter((c) => c.method === "POST").length, 1);
  assert.equal(wp.calls.some((c) => c.url.pathname.includes("/posts")), false);
});

test("failed reconciliation lookup stops before creating a duplicate", async (t) => {
  const wp = fakeWordPress(t, { lookupFailure: true });
  await assert.rejects(createWordPressDraft({ ...input, wordpressTarget: "page", jobId: "retry-job" }), /taslak kontrolü/);
  assert.equal(wp.calls.filter((c) => c.method === "POST").length, 0);
});

test("page media recovery only searches pages", async (t) => {
  const wp = fakeWordPress(t);
  wp.records.set("https://ttaa.test/pages/123", {
    id: 123, slug: input.slug, featured_media: 12, content: { raw: '<figure class="ttaa-inline-image"><img class="wp-image-13" src="/inline.webp" alt="Inline" width="1536" height="864"></figure>' },
  });
  const media = await getWordPressDraftMedia(input.slug, "page");
  assert.equal(media?.postId, 123);
  assert.equal(media?.inline.id, 13);
  assert.equal(wp.calls.some((c) => c.url.pathname.includes("/posts")), false);
});

test("worker rejects disabled page jobs before any research or external request", async (t) => {
  const calls: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (...args: unknown[]) => { calls.push(args); throw new Error("No network allowed"); });
  await assert.rejects(runContentJob({ brief: { wordpressTarget: "page" }, checkpoint: {} } as ContentJob, "test-worker"), /henüz etkin değil/);
  assert.equal(calls.length, 0);
});

for (const brand of ["ttaa", "ay-tercume"] as const) {
  test(`${brand}: checkpoint resume persists page target and later sync updates the same page`, async (t) => {
    process.env.WORDPRESS_PAGES_ENABLED = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    const wp = fakeWordPress(t, { plugin: "aioseo" });
    const wordpressFetch = globalThis.fetch;
    const article = {
      title: input.postTitle, seoTitle: input.seoTitle, metaDescription: input.metaDescription,
      slug: input.slug, focusKeyword: input.focusKeyword, secondaryKeywords: input.secondaryKeywords,
      eyebrow: "Services", intro: "Translation services introduction.", tldr: ["Summary"],
      sections: [{ title: "Documents", body: "Document translation.", items: [] }], faqs: [{ question: "How?", answer: "Review documents." }],
      cta: { title: "Contact", body: "Ask us", buttonLabel: "Contact" }, imagePrompt: "Documents", imageSuggestions: [], internalLinkSuggestions: [],
    };
    const image = { fileName: "image.webp", contentType: "image/webp", prompt: "Documents", alt: "Document translation", width: 1536, height: 864, format: "webp", model: "test", quality: "medium", branding: {} };
    const job = {
      id: "job-456", brand, owner_email: "owner@test.local", brief: { wordpressTarget: "page", topic: input.postTitle },
      status: "running", stage: "wordpress-media", progress: 78, stage_attempts: {}, cancel_requested: false,
      checkpoint: {
        research: { links: [], mode: "test", researchedAt: "2026-01-01" },
        package: { wordpressTarget: "page", preview: article, title: input.seoTitle, meta: input.metaDescription, slug: input.slug,
          focusKeyword: input.focusKeyword, secondaryKeywords: input.secondaryKeywords, html: input.html,
          schema: input.schema, canonical: "https://ttaa.test/translation-services/", links: [], generation: {}, research: {} },
        images: { featured: { ...image, role: "featured" }, inline: { ...image, role: "inline" } },
        wordpressMedia: { featured: { id: 12, url: "https://ttaa.test/featured.webp" }, inline: { id: 13, url: "https://ttaa.test/inline.webp" } },
      },
    } as unknown as ContentJob;
    let project: ContentProject | undefined;
    const storedPackages: Record<string, unknown>[] = [];
    t.mock.method(globalThis, "fetch", async (raw: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(raw instanceof Request ? raw.url : raw.toString());
      if (url.hostname !== "database.test") return wordpressFetch(raw, init);
      const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
      if (url.pathname === "/rest/v1/content_jobs") {
        if (init.method === "PATCH") Object.assign(job, body);
        return json(job);
      }
      if (url.pathname === "/rest/v1/content_projects") {
        if (init.method === "POST") project = { id: "project-1", revision: 1, ...body };
        if (init.method === "PATCH") Object.assign(project!, body);
        return json(project);
      }
      if (url.pathname === "/storage/v1/bucket") return json([{ id: "ttaa-content-packages", name: "ttaa-content-packages" }]);
      if (url.pathname.startsWith("/storage/v1/object/")) {
        const data = (init.body as FormData).get("");
        assert.ok(data instanceof Blob);
        storedPackages.push(JSON.parse(await data.text()));
        return json({ Key: url.pathname });
      }
      assert.fail(`Unexpected database request ${url.pathname}`);
    });
    const completed = await runContentJob(job, "test-worker");
    assert.equal(completed.package.wordpressTarget, "page");
    assert.equal(project?.brief.wordpressTarget, "page");
    assert.equal(project?.content_package.wordpressTarget, "page");
    assert.equal(project?.content_package.wordpress?.wordpressTarget, "page");
    assert.equal(storedPackages.length, 1);
    assert.equal((storedPackages[0].contentPackage as Record<string, unknown>).wordpressTarget, "page");
    const draftId = project!.wordpress_post_id;
    const postCount = wp.calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/pages")).length;
    // The same saved checkpoint can finish again without generating content or another draft.
    await runContentJob(job, "test-worker");
    assert.equal(wp.calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/pages")).length, postCount);
    process.env.WORDPRESS_PAGES_ENABLED = "false";
    const synced = await syncProjectToWordPress("project-1", "owner@test.local");
    assert.equal(synced?.wordpress_post_id, draftId);
    assert.equal(synced?.content_package.wordpressTarget, "page");
    assert.equal(wp.records.size, 1);
    assert.equal(wp.calls.some((c) => c.url.pathname.includes("/posts")), false);
  });
}
