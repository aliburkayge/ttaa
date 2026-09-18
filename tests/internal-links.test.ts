import assert from "node:assert/strict";
import test from "node:test";
import { assertPackageLinkCoverage, fetchBrandInternalLinks, selectInternalLinks, wordpressSearchQueries } from "../lib/internal-links.ts";
import { buildTtaaContentPackage } from "../lib/ttaa-render.ts";
import { buildAyContentPackage } from "../lib/ay-render.ts";
import type { ResearchedLink } from "../lib/link-catalog.ts";

const internal: ResearchedLink[] = [
  { anchor: "Diploma Translation Services", url: "https://turkishtranslation.com.tr/diploma-translation/", reason: "Related page", source: "internal" },
  { anchor: "Apostille and Legalization", url: "https://turkishtranslation.com.tr/apostille/", reason: "Related page", source: "internal" },
  { anchor: "Certified Translation", url: "https://turkishtranslation.com.tr/certified-translation/", reason: "Related page", source: "internal" },
];

test("WordPress discovery splits a long brief into useful REST API searches", () => {
  const queries = wordpressSearchQueries({ topic: "Diploma Translation and Apostille Guide", country: "Germany", documentType: "University diploma" });
  assert.ok(queries.includes("diploma"));
  assert.ok(queries.includes("apostille"));
  assert.ok(queries.includes("germany"));
  assert.ok(queries.length > 3);
});

test("WordPress REST results are ranked and verified for both posts and pages", async (t) => {
  const old = process.env.WP_URL;
  process.env.WP_URL = "https://turkishtranslation.com.tr";
  t.after(() => { if (old === undefined) delete process.env.WP_URL; else process.env.WP_URL = old; });
  const searches: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/wp-json/wp/v2/search?")) {
      searches.push(url);
      const query = new URL(url).searchParams.get("search");
      if (query === "diploma") return Response.json([{ id: 1, title: "Diploma Translation Services", url: internal[0].url, subtype: "page" }]);
      if (query === "apostille") return Response.json([{ id: 2, title: "Apostille and Legalization", url: internal[1].url, subtype: "post" }]);
      return Response.json([]);
    }
    return new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } });
  });
  const links = await fetchBrandInternalLinks("ttaa", { topic: "Diploma Translation Apostille", country: "Germany", documentType: "Diploma" });
  assert.ok(searches.length >= 3);
  assert.deepEqual(new Set(links.map((link) => link.url)), new Set([internal[0].url, internal[1].url]));
  assert.ok(links.every((link) => link.validation?.status === "verified"));
});

test("internal link selection fills model omissions deterministically", () => {
  const selected = selectInternalLinks(internal, ["Diploma Translation Services"]);
  assert.equal(selected.length, 3);
  assert.equal(selected[0].anchor, "Diploma Translation Services");
});

test("link coverage blocks a WordPress article that would ship without useful links", () => {
  const official: ResearchedLink = { anchor: "Official source", url: "https://example.gov/source", reason: "Primary source", source: "official" };
  assert.doesNotThrow(() => assertPackageLinkCoverage("ttaa", [...internal, official]));
  assert.throws(() => assertPackageLinkCoverage("ttaa", [internal[0], official]), /en az 3 doğrulanmış site içi bağlantı/);
  assert.throws(() => assertPackageLinkCoverage("ay-tercume", internal), /1 resmî dış kaynak/);
});

function article() {
  return {
    eyebrow: "GUIDE", title: "Diploma Translation Guide", intro: "A focused introduction without any approved anchor phrase.",
    tldr: ["Review the requirements."],
    sections: Array.from({ length: 7 }, (_, index) => ({ title: `Step ${index + 1}`, body: "Prepare the complete document and check every detail.", items: [] })),
    faqs: [{ question: "What should I send?", answer: "Send a complete and legible copy for review." }],
    cta: { title: "Send Your Document for Review", body: "Share the complete file.", buttonLabel: "Request review" },
    focusKeyword: "diploma translation", secondaryKeywords: ["certified diploma translation"], seoTitle: "Diploma Translation Guide | TTAA",
    metaDescription: "A practical diploma translation guide.", slug: "diploma-translation-guide", internalLinkSuggestions: [], imagePrompt: "Documents",
    imageSuggestions: [], topicLock: {}, audit: {},
  } as never;
}

test("both WordPress renderers place internal and official links inside article sections", () => {
  const official: ResearchedLink = { anchor: "Official authority guidance", url: "https://example.gov/guidance", reason: "Primary source", source: "official" };
  const ttaa = buildTtaaContentPackage(article(), [...internal, official], {}, {} as never, { mode: "test", researchedAt: new Date(0).toISOString() });
  assert.match(ttaa.html, /class="ttaa-related-reading"/);
  assert.match(ttaa.html, /href="https:\/\/turkishtranslation\.com\.tr\/diploma-translation\/"/);
  assert.match(ttaa.html, /href="https:\/\/example\.gov\/guidance" target="_blank" rel="noopener noreferrer"/);

  const ayInternal = internal.map((link, index) => ({ ...link, anchor: `AY bağlantısı ${index + 1}`, url: `https://aytercume.com/ilgili-${index + 1}/` }));
  const ay = buildAyContentPackage(article(), [...ayInternal, official], { includeH1: true, visibleBreadcrumb: true, articleSchema: true, faqSchema: true }, {} as never, { mode: "test", researchedAt: new Date(0).toISOString() });
  assert.match(ay.html, /class="ayc-related-reading"/);
  assert.match(ay.html, /href="https:\/\/aytercume\.com\/ilgili-1\/"/);
  assert.match(ay.html, /href="https:\/\/example\.gov\/guidance" target="_blank" rel="noopener noreferrer"/);
});
