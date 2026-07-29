import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { auditKeywordPolicy } from "../lib/keyword-policy.ts";

function sizedText(prefix, length) {
  if (prefix.length > length) throw new Error("Prefix exceeds requested test length.");
  return prefix.length === length ? prefix : `${prefix} ${"x".repeat(length - prefix.length - 1)}`;
}

function keywordArticle(overrides = {}) {
  const focusKeyword = "Chinese Turkish Translation";
  return {
    title: "Chinese Turkish Translation Services",
    intro: "Chinese Turkish Translation requires careful terminology and document review for official use.",
    sections: [{ title: "Documents and Requirements" }, { title: "How the Process Works" }],
    focusKeyword,
    secondaryKeywords: ["Chinese to Turkish translation", "Turkish to Chinese translation", "Chinese–Turkish translation services", "Chinese document translation"],
    seoTitle: sizedText(focusKeyword, 50),
    metaDescription: sizedText(`Professional ${focusKeyword} services`, 120),
    slug: "chinese-turkish-translation",
    ...overrides,
  };
}

test("enforces focus keyword title and meta boundaries", () => {
  for (const length of [50, 60]) {
    const result = auditKeywordPolicy(keywordArticle({ seoTitle: sizedText("Chinese Turkish Translation", length) }), { topic: "Chinese Turkish Translation", primaryKeyword: "Chinese Turkish Translation" });
    assert.equal(result.passes, true, `SEO title length ${length} should pass`);
  }
  for (const length of [49, 61]) {
    const result = auditKeywordPolicy(keywordArticle({ seoTitle: sizedText("Chinese Turkish Translation", length) }), { topic: "Chinese Turkish Translation", primaryKeyword: "Chinese Turkish Translation" });
    assert.equal(result.passes, false, `SEO title length ${length} should fail`);
  }
  for (const length of [120, 160]) {
    const result = auditKeywordPolicy(keywordArticle({ metaDescription: sizedText("Professional Chinese Turkish Translation services", length) }), { topic: "Chinese Turkish Translation", primaryKeyword: "Chinese Turkish Translation" });
    assert.equal(result.passes, true, `Meta description length ${length} should pass`);
  }
  for (const length of [119, 161]) {
    const result = auditKeywordPolicy(keywordArticle({ metaDescription: sizedText("Professional Chinese Turkish Translation services", length) }), { topic: "Chinese Turkish Translation", primaryKeyword: "Chinese Turkish Translation" });
    assert.equal(result.passes, false, `Meta description length ${length} should fail`);
  }
});

test("enforces one manual focus keyword and unique secondary keyphrases", () => {
  const exact = auditKeywordPolicy(keywordArticle(), { topic: "Translation", primaryKeyword: "Chinese Turkish Translation" });
  assert.equal(exact.passes, true);
  assert.equal(exact.focusKeyword, "Chinese Turkish Translation");

  const changedManual = auditKeywordPolicy(keywordArticle({ focusKeyword: "Chinese Translation" }), { topic: "Translation", primaryKeyword: "Chinese Turkish Translation" });
  assert.equal(changedManual.passes, false);
  assert.match(changedManual.issues.join(" "), /exactly match the supplied Primary keyword/);

  const duplicates = auditKeywordPolicy(keywordArticle({ secondaryKeywords: ["Chinese document translation", "Chinese document translation", "Turkish to Chinese translation"] }), { topic: "Chinese Turkish Translation" });
  assert.equal(duplicates.passes, false);
  assert.match(duplicates.issues.join(" "), /unique and different/);
});

test("preserves Turkish focus-keyword terms in ASCII slugs", () => {
  const focusKeyword = "Dışişleri Bakanlığı tasdiki";
  const result = auditKeywordPolicy({
    title: "Dışişleri Bakanlığı tasdiki için belge rehberi",
    intro: "Dışişleri Bakanlığı tasdiki, belgenin türüne ve kullanılacağı kuruma göre değerlendirilmesi gereken resmî bir süreçtir.",
    sections: [{ title: "Süreç nasıl ilerler?" }, { title: "Belge kontrolü" }],
    focusKeyword,
    secondaryKeywords: ["Dışişleri belge tasdiki", "belge tasdik işlemleri", "resmî belge onayı"],
    seoTitle: sizedText(focusKeyword, 50),
    metaDescription: sizedText(`${focusKeyword} için belge türü ve alıcı kuruma göre gerekli adımları öğrenin.`, 120),
    slug: "disisleri-bakanligi-tasdiki",
  }, { topic: focusKeyword, primaryKeyword: focusKeyword });
  assert.equal(result.passes, true, result.issues.join("; "));
});

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the secured TTAA studio shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>TTAA Content Studio<\/title>/i);
  assert.match(html, /TTAA Content Studio hazırlanıyor/);
  assert.match(html, /class="auth-loading"/);
  assert.doesNotMatch(html, /OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|WP_APP_PASSWORD/);
});

test("keeps AI generation server-side and WordPress draft-only", async () => {
  const [page, openai, openaiBackground, generateRoute, finalizeRoute, wordpress, gitignore] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/openai.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/openai-background.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/generate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/finalize/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/wordpress.ts", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
  ]);

  assert.match(page, /fetch\("\/api\/generate"/);
  assert.doesNotMatch(page, /process\.env\.OPENAI_API_KEY|sk-proj-/);
  assert.match(openai, /process\.env\.OPENAI_API_KEY/);
  assert.match(openaiBackground, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(openaiBackground, /background:\s*true/);
  assert.match(openaiBackground, /resumeResponseId/);
  assert.match(openai, /type:\s*"json_schema"/);
  assert.match(openai, /type:\s*"web_search"/);
  assert.match(openai, /TOPIC-LOCK OPERATING RULES/);
  assert.match(openai, /primaryTopicCoverage/);
  assert.match(openai, /topicDrift/);
  assert.match(openai, /repairResponseId/);
  assert.match(openai, /focusKeyword/);
  assert.match(openai, /secondaryKeywords/);
  assert.match(openai, /auditKeywordPolicy/);
  assert.match(generateRoute, /requireAdminSession/);
  assert.match(generateRoute, /maxDuration = 840/);
  assert.match(generateRoute, /withDeadline/);
  assert.match(finalizeRoute, /createWordPressDraft/);
  assert.match(finalizeRoute, /maxDuration = 840/);
  assert.match(finalizeRoute, /focusKeyword: body\.package\.focusKeyword/);
  assert.match(finalizeRoute, /secondaryKeywords: body\.package\.secondaryKeywords/);
  assert.match(wordpress, /status:\s*"draft"/);
  assert.match(gitignore, /^\.env\*/m);
});

test("runs long production work through the durable Supabase worker queue", async () => {
  const [migration, jobs, pipeline, worker, railwayStart, jobsRoute, statusRoute, healthRoute, jobHook, page, ayStudio, envExample, wordpress] = await Promise.all([
    readFile(new URL("../supabase/migrations/202607290001_content_jobs.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/jobs.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/job-pipeline.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/content-worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/railway-start.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/jobs/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/jobs/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/use-content-job.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ay-tercume/studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../lib/wordpress.ts", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /create table if not exists public\.content_jobs/);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /renew_content_job_lease/);
  assert.match(migration, /content_worker_heartbeats/);
  assert.match(jobs, /idempotency_key/);
  assert.match(jobs, /claim_content_job/);
  assert.match(pipeline, /generateBlogImage/);
  assert.match(pipeline, /generateAyBlogImage/);
  assert.match(pipeline, /storeGeneratedImage/);
  assert.match(pipeline, /jobId:\s*job\.id/);
  assert.match(worker, /renewContentJobLease/);
  assert.match(worker, /concurrency:\s*1/);
  assert.doesNotMatch(worker, /import\s*\{\s*loadEnvConfig\s*\}\s*from\s*"@next\/env"/);
  assert.match(worker, /nextEnv\.loadEnvConfig/);
  assert.match(worker, /writeWorkerHeartbeat\(workerId,\s*"starting"\)/);
  assert.match(worker, /recoverWorkerUnavailableJobs/);
  assert.match(railwayStart, /serviceName\.includes\("worker"\)/);
  assert.match(jobsRoute, /status:\s*job\.status === "queued" \? 202/);
  assert.match(jobsRoute, /getWorkerAvailability/);
  assert.match(statusRoute, /elapsedMs/);
  assert.match(statusRoute, /failUnclaimedJobWithoutWorker/);
  assert.match(healthRoute, /getWorkerAvailability/);
  assert.match(jobHook, /startInFlight/);
  assert.match(jobHook, /window\.localStorage\.setItem\(storageKey/);
  assert.match(page, /useContentJob<DurableJobResult>\("ttaa"\)/);
  assert.match(ayStudio, /useContentJob<AyDurableJobResult>\("ay-tercume"\)/);
  assert.match(envExample, /JOB_MAX_RUNTIME_MS=2700000/);
  assert.match(envExample, /OPENAI_RESPONSE_TIMEOUT_MS=480000/);
  assert.match(wordpress, /TTAA_CONTENT_JOB:/);
  assert.match(wordpress, /findDraftByJobMarker/);
});

test("presents a beginner-friendly minimal content workflow", async () => {
  const [page, stylesheet, logo] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../public/ttaa-logo.png", import.meta.url)),
  ]);

  assert.match(page, /Sadece başlık zorunludur/);
  assert.match(page, /İsteğe bağlı ayrıntılar/);
  assert.match(page, /Teknik çıktı ayarları/);
  assert.match(page, /İçeriği oluştur ve taslak gönder/);
  assert.match(page, /Hiçbir içerik otomatik yayınlanmaz/);
  assert.match(page, /Yeni içeriğiniz burada görünecek/);
  assert.match(page, /hasCompletedResult/);
  assert.match(page, /src="\/ttaa-logo\.png"/);
  assert.ok(logo.byteLength > 10_000, "the supplied TTAA logo asset should be bundled");
  assert.match(stylesheet, /Minimal professional studio interface/);
  assert.match(stylesheet, /\.advanced-card/);
  assert.match(stylesheet, /\.empty-result/);
  assert.match(stylesheet, /\.workspace-heading/);
  assert.match(stylesheet, /@media \(max-width: 620px\)/);
});

test("keeps TTAA and Ay Tercume in isolated company workspaces", async () => {
  const [page, switcher, ayWorkspace, ayStudio, stylesheet, ayRoute, ayImageRoute, ayFinalizeRoute, ayImages, ayEngine, ayCatalog, ayArticleCss, ayPrompt, ayVisualPrompt, ayLogo, wordpress] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/company-switcher.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ay-tercume/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ay-tercume/studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ay-tercume/generate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ay-tercume/images/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ay-tercume/finalize/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ay-openai-images.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ay-openai.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ay-link-catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/ay-tercume-article.css", import.meta.url), "utf8"),
    readFile(new URL("../prompts/AY_Tercume_SEO_Content_Agent.md", import.meta.url), "utf8"),
    readFile(new URL("../prompts/AY_Tercume_Image_Generation_Prompt_Style.md", import.meta.url), "utf8"),
    readFile(new URL("../public/ay-tercume-logo.jpg", import.meta.url)),
    readFile(new URL("../lib/wordpress.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<CompanySwitcher current="ttaa"/);
  assert.match(switcher, /href="\/ay-tercume"/);
  assert.match(switcher, /Ay Tercüme/);
  assert.match(switcher, /src="\/ay-tercume-logo\.jpg"/);
  assert.match(switcher, /Aktif içerik ve görsel sistemi/);
  assert.match(ayWorkspace, /getAdminSession/);
  assert.match(ayWorkspace, /redirect\("\/"\)/);
  assert.match(ayWorkspace, /AyTercumeStudio/);
  assert.match(ayStudio, /TTAA promptları, linkleri ve WordPress bilgileri kullanılmaz/);
  assert.match(ayStudio, /İçerik üretin/);
  assert.match(ayStudio, /\/api\/ay-tercume\/generate/);
  assert.match(ayStudio, /İçeriği ve 2 görseli oluştur/);
  assert.match(ayStudio, /\/api\/ay-tercume\/images/);
  assert.match(ayStudio, /\/api\/ay-tercume\/finalize/);
  assert.match(ayStudio, /WordPress&apos;te aç/);
  assert.match(ayStudio, /Görselleri yeniden dene/);
  assert.match(ayStudio, /AY_INLINE_IMAGE/);
  assert.doesNotMatch(`${ayWorkspace}\n${ayStudio}`, /createWordPressDraft|generateAndEditArticle|process\.env\.WP_URL/);
  assert.match(ayRoute, /generateAyArticle/);
  assert.match(ayRoute, /AY_WP_URL/);
  assert.match(ayImageRoute, /generateAyBlogImages/);
  assert.match(ayFinalizeRoute, /status:\s*"draft"/);
  assert.match(ayFinalizeRoute, /featuredMedia:\s*media\.featured\.id/);
  assert.match(ayFinalizeRoute, /<figure class="ayc-inline-image">/);
  assert.match(ayFinalizeRoute, /"ay-tercume"/);
  assert.match(ayFinalizeRoute, /deleteWordPressMedia\(media\.featured\.id, "ay-tercume"\)/);
  assert.match(ayImages, /Promise\.all\(\[/);
  assert.match(ayImages, /ay-tercume-logo\.jpg/);
  assert.match(ayImages, /function importedAssetValue/);
  assert.match(ayImages, /new URL\("\/ay-tercume-logo\.jpg", assetOrigin\)/);
  assert.doesNotMatch(ayImages, /ayLogoDataUrl\.indexOf/);
  assert.match(ayImageRoute, /assetOrigin:\s*new URL\(request\.url\)\.origin/);
  assert.match(ayImages, /sol üst köşeye/);
  assert.match(ayImages, /#43cc9b/);
  assert.match(ayImages, /#009fe4/);
  assert.match(ayImages, /#0f0b08/);
  assert.match(ayImages, /response\.status === 429 \|\| response\.status >= 500/);
  assert.doesNotMatch(ayImages, /ttaa-brand-logo|turkishtranslation\.com\.tr/);
  assert.ok(ayLogo.byteLength > 100_000, "the supplied Ay Tercume logo asset should be bundled");
  assert.match(ayEngine, /AY TERCÜME KONU KİLİDİ/);
  assert.match(ayEngine, /deterministicGate/);
  assert.match(ayEngine, /Blog metninde ofis veya fiziksel lokasyon karşılaştırması yapılamaz/);
  assert.match(ayEngine, /Ankara ve İstanbul’daki lokasyonlardan da bahsetme/);
  assert.match(ayCatalog, /buildAyContactUrl/);
  assert.doesNotMatch(ayCatalog, /turkishtranslation\.com\.tr/);
  assert.match(ayArticleCss, /\.ayc-article/);
  assert.match(ayPrompt, /TL;DR/);
  assert.match(ayPrompt, /Deterministik kalite kapıları/);
  assert.match(ayPrompt, /fiziksel lokasyon, şube varlığı\/yokluğu veya şehirler arası lokasyon karşılaştırması yapılmaz/);
  assert.match(ayVisualPrompt, /featured/);
  assert.match(ayVisualPrompt, /inline/);
  assert.match(ayVisualPrompt, /logo.*sol üst/i);
  assert.match(wordpress, /AY_\$\{prefix\}|prefix = scope === "ay-tercume"/);
  assert.match(wordpress, /\/wp-json\/rankmath\/v1\/updateMeta/);
  assert.match(wordpress, /rank_math_focus_keyword/);
  assert.match(wordpress, /status:\s*"draft"/);
  assert.match(stylesheet, /\.company-switcher/);
  assert.match(stylesheet, /Ay Tercüme company theme/);
  assert.match(stylesheet, /--tt-blue:\s*#43cc9b/);
  assert.match(stylesheet, /--tt-blue-dark:\s*#009fe4/);
  assert.match(stylesheet, /--tt-navy:\s*#0f0b08/);
  assert.match(stylesheet, /--studio-bg:\s*#ffffff/);
});

test("deduplicates official sources and neutralizes WordPress list markers", async () => {
  const [page, linkCatalog, generateRoute, stylesheet] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/link-catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/generate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/translation-article.css", import.meta.url), "utf8"),
  ]);

  assert.match(linkCatalog, /canonicalLinkUrl/);
  assert.match(linkCatalog, /url\.hash\s*=\s*""/);
  assert.match(generateRoute, /curatedOfficialHosts/);
  assert.match(generateRoute, /discoveredHosts/);
  assert.match(page, /resource-link/);
  assert.match(stylesheet, /resource-column li::before/);
  assert.match(stylesheet, /resource-column li::marker/);
  assert.doesNotMatch(page, /RESEARCH &amp; LINK AUDIT/);
});

test("separates SEO head data, shared CSS and AIOSEO-owned schema", async () => {
  const [page, wordpress, stylesheet, plugin] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/wordpress.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/translation-article.css", import.meta.url), "utf8"),
    readFile(new URL("../wordpress/ttaa-content-studio/ttaa-content-studio.php", import.meta.url), "utf8"),
  ]);

  assert.match(page, /function buildHead/);
  assert.match(page, /<title>\$\{escapeHtml\(seoTitle\)\}<\/title>/);
  assert.match(page, /meta name="description"/);
  assert.match(page, /rel="canonical"/);
  assert.match(page, /meta name="robots"/);
  assert.match(page, /SEO Head/);
  assert.match(page, /buildTtaaWhatsAppUrl\(preview\.title\)/);
  assert.match(page, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(page, /<style>[\s\S]*<\/style>/);

  assert.match(wordpress, /aioseo_meta_data/);
  assert.match(wordpress, /canonical_url:\s*canonical/);
  assert.match(wordpress, /context=edit&_fields=aioseo_meta_data/);
  assert.match(wordpress, /\/wp-json\/aioseo\/v1\/keyphrases/);
  assert.match(wordpress, /postId: payload\.id, keyphrases/);
  assert.match(wordpress, /verifyAioseoKeyphrases/);
  assert.match(wordpress, /focusKeywordApplied/);
  assert.match(wordpress, /secondaryKeywordsApplied/);
  assert.match(wordpress, /AIOSEO focus keyword needs attention/);
  assert.match(page, /FOCUS KEYWORD/);
  assert.match(page, /SECONDARY KEYWORDS/);
  assert.match(page, /AIOSEO TRANSFER/);
  assert.match(wordpress, /schemaForContent/);
  assert.match(wordpress, /item\["@type"\]\s*===\s*"FAQPage"/);
  assert.match(wordpress, /sharedArticleCssReady/);
  assert.match(wordpress, /ttaa-content-studio-inline-fallback/);
  assert.doesNotMatch(wordpress, /ttaa-content-studio-loader/);
  assert.doesNotMatch(wordpress, /@import url/);
  assert.match(wordpress, /inlineFallbackEmbedded:\s*true/);

  assert.match(stylesheet, /\.ttaa-article/);
  assert.ok(Buffer.byteLength(stylesheet, "utf8") < 12_000, "shared article CSS should remain compact");
  assert.ok((stylesheet.match(/!important/g) || []).length <= 12, "theme-firewall overrides should stay limited");
  assert.match(plugin, /wp_enqueue_style/);
  assert.match(plugin, /translation-article\.css/);
});

test("enforces natural language-pair headings and deterministic repetition limits", async () => {
  const openai = await readFile(new URL("../lib/openai.ts", import.meta.url), "utf8");
  assert.match(openai, /make the H1 explicitly bidirectional/);
  assert.match(openai, /Do not begin multiple sections with the same exact phrase/);
  assert.match(openai, /function repetitionGate/);
  assert.match(openai, /exactKeywordCount/);
  assert.match(openai, /brandLimit/);
  assert.match(openai, /auditOperationallyPasses/);
  assert.match(openai, /for \(let attempt = 1; attempt <= 2; attempt \+= 1\)/);
  assert.match(openai, /The content quality repair could not resolve/);
});

test("routes conversion links to WhatsApp and enforces the dynamic FAQ module", async () => {
  const [page, openai, linkCatalog] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/openai.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/link-catalog.ts", import.meta.url), "utf8"),
  ]);

  assert.match(linkCatalog, /function buildTtaaWhatsAppUrl/);
  assert.match(linkCatalog, /phone=\$\{TTAA_WHATSAPP_PHONE\}/);
  assert.match(linkCatalog, /send your document for review/);
  assert.doesNotMatch(linkCatalog, /anchor: "send your document for review", url: "https:\/\/turkishtranslation\.com\.tr\/services\/order\//);
  assert.match(page, /href="\$\{escapeHtml\(whatsappUrl\)\}"/);
  assert.match(openai, /minItems:\s*7/);
  assert.match(openai, /maxItems:\s*10/);
  assert.match(openai, /function faqGate/);
  assert.match(openai, /At least two FAQ questions must explicitly mention TTAA/);
  assert.match(openai, /Dynamic FAQ issues/);
});

test("generates two protected TTAA-branded OpenAI image edits", async () => {
  const [page, images, resilientJson, logo, finalizeRoute, wordpress, supabase, envExample] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/openai-images.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/json.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/ttaa-brand-logo.png", import.meta.url)),
    readFile(new URL("../app/api/projects/finalize/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/wordpress.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(images, /https:\/\/api\.openai\.com\/v1\/images\/edits/);
  assert.match(images, /"gpt-image-2"/);
  assert.match(images, /"1536x864"/);
  assert.match(images, /"medium"/);
  assert.match(images, /"webp"/);
  assert.match(images, /Promise\.all\(\[/);
  assert.match(images, /no people, no generic office scene, no unrelated business meeting, no random laptop hero shot/i);
  assert.match(images, /subtle dotted world map/);
  assert.match(images, /image\[\]/);
  assert.match(images, /ttaa-brand-logo\.png/);
  assert.match(images, /function importedAssetValue/);
  assert.match(images, /new URL\("\/ttaa-brand-logo\.png", assetOrigin\)/);
  assert.doesNotMatch(images, /ttaaLogoDataUrl\.indexOf/);
  assert.match(images, /Preserve its spelling, proportions, globe symbol, arrows and blue\/navy colors/);
  assert.match(images, /Place it unchanged in the top-left/);
  assert.match(images, /Text \(verbatim\)/);
  assert.ok(logo.byteLength > 100_000, "the real TTAA logo asset must be included");
  assert.match(images, /response\.status === 429 \|\| response\.status >= 500/);
  assert.match(images, /parseResilientJson/);
  assert.match(images, /if \(attempt < 2\)/);
  assert.match(resilientJson, /function repairJsonStrings/);
  assert.match(resilientJson, /returned malformed JSON that could not be repaired/);
  assert.doesNotMatch(page, /process\.env\.OPENAI_API_KEY|sk-proj-/);
  assert.match(finalizeRoute, /generateBlogImages/);
  assert.match(finalizeRoute, /assetOrigin:\s*new URL\(request\.url\)\.origin/);
  assert.match(finalizeRoute, /uploadWordPressMedia/);
  assert.match(finalizeRoute, /featuredMedia:\s*media\.featured\.id/);
  assert.match(finalizeRoute, /injectInlineImage/);
  assert.match(finalizeRoute, /deleteWordPressMedia\(media\.featured\.id\)/);
  assert.match(finalizeRoute, /phase === "image-generation" \|\| phase === "wordpress-media"/);
  assert.match(page, /canRetryFinalize: Boolean\(payload\.retryable\)/);
  assert.match(wordpress, /featured_media:\s*input\.featuredMedia/);
  assert.match(wordpress, /alt_text:\s*input\.alt/);
  assert.match(supabase, /IMAGE_BUCKET = "ttaa-blog-images"/);
  assert.match(supabase, /allowedMimeTypes:\s*\["image\/webp", "image\/jpeg", "image\/png"\]/);
  assert.match(envExample, /OPENAI_IMAGE_MODEL=gpt-image-2/);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_IMAGE_FUNCTION/);
});

test("reveals only the finalized package and renders responsive inline media", async () => {
  const [page, finalizeRoute, mediaRoute, wordpress, publicCss, pluginCss] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/finalize/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/media/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/wordpress.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/translation-article.css", import.meta.url), "utf8"),
    readFile(new URL("../wordpress/ttaa-content-studio/assets/css/translation-article.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /const finalized = await finalizeProject\(next\)/);
  assert.match(page, /setResult\(finalized\)/);
  assert.match(page, /setPendingPackage\(next\)/);
  assert.match(page, /finalizeProject\(pendingPackage\)/);
  assert.match(page, /YENİ ÇALIŞMA TAMAMLANAMADI/);
  assert.match(page, /canRetryFinalize/);
  assert.match(page, /\/api\/projects\/media\?slug=/);
  assert.match(page, /TTAA_INLINE_IMAGE/);
  assert.match(page, /GENERATED MEDIA/);
  assert.match(page, /WORDPRESS FEATURED IMAGE/);
  assert.match(finalizeRoute, /<figure class="ttaa-inline-image">/);
  assert.match(finalizeRoute, /loading="lazy" decoding="async"/);
  assert.match(finalizeRoute, /status:\s*"complete"/);
  assert.match(finalizeRoute, /const backupPromise = backUpImages/);
  assert.match(mediaRoute, /getWordPressDraftMedia/);
  assert.match(wordpress, /function absoluteWordPressUrl/);
  assert.match(wordpress, /getWordPressDraftMedia/);
  assert.match(publicCss, /\.ttaa-inline-image img/);
  assert.equal(publicCss, pluginCss, "download and WordPress plugin stylesheets must stay identical");
});
