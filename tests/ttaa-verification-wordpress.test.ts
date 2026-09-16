import assert from "node:assert/strict";
import { afterEach, beforeEach, test, type TestContext } from "node:test";
import { attachTtaaVerificationPdf, ensureTtaaVerificationLanding, findTtaaVerificationDocument, listTtaaVerificationDocuments, publishTtaaVerificationDocument, setTtaaVerificationPdf } from "../lib/ttaa-verification-wordpress.ts";
import { ttaaVerificationToken } from "../lib/ttaa-verification-token.ts";

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.WP_URL = "https://turkishtranslation.com.tr";
  process.env.WP_USERNAME = "test";
  process.env.WP_APP_PASSWORD = "test";
  process.env.AUTH_SESSION_SECRET = "test-secret-with-more-than-thirty-two-characters";
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

const document = { documentNumber: "TTAA2026009", customer: "Example Customer", documentDate: "2026-09-16", documentType: "Translation document" };
type RecordPage = { id: number; slug: string; status: string; link: string; content: { raw: string }; title: string; aioseo_meta_data?: Record<string, unknown> };
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "x-wp-totalpages": "1" } }); }

function fakeWordPress(t: TestContext, options: { dropSeo?: boolean; foreignSlug?: boolean } = {}) {
  const records: RecordPage[] = [];
  const calls: { pathname: string; method: string; body: Record<string, unknown> }[] = [];
  if (options.foreignSlug) records.push({ id: 9, slug: `document-verification-${ttaaVerificationToken(document.documentNumber)}`, status: "publish", link: "https://turkishtranslation.com.tr/foreign/", content: { raw: "unrelated" }, title: "Unrelated" });
  t.mock.method(globalThis, "fetch", async (raw: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(raw instanceof Request ? raw.url : raw.toString());
    assert.equal(url.hostname, "turkishtranslation.com.tr");
    const method = init.method || "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    calls.push({ pathname: url.pathname, method, body });
    const match = /^\/wp-json\/wp\/v2\/pages(?:\/(\d+))?$/.exec(url.pathname);
    assert.ok(match, `Unexpected WordPress request: ${url}`);
    const id = match[1] ? Number(match[1]) : null;
    if (method === "GET") {
      if (id) return json(records.find((record) => record.id === id) || { message: "Not found" }, records.some((record) => record.id === id) ? 200 : 404);
      if (url.searchParams.has("slug")) return json(records.filter((record) => record.slug === url.searchParams.get("slug") && (record.status === "publish" || url.searchParams.get("status") === "any")));
      return json(records.filter((record) => !url.searchParams.has("search") || `${record.title} ${record.content.raw}`.toLowerCase().includes((url.searchParams.get("search") || "").toLowerCase())));
    }
    if (!id) {
      const record = { id: records.length + 100, slug: String(body.slug), status: String(body.status), link: `https://turkishtranslation.com.tr/${String(body.slug)}/`, content: { raw: String(body.content) }, title: String(body.title) };
      records.push(record);
      return json(record, 201);
    }
    const record = records.find((item) => item.id === id);
    assert.ok(record);
    if (body.status) record.status = String(body.status);
    if (body.content) record.content.raw = String(body.content);
    if (body.title) record.title = String(body.title);
    if (body.aioseo_meta_data && !options.dropSeo) {
      const input = body.aioseo_meta_data as Record<string, unknown>;
      record.aioseo_meta_data = {
        title: input.title,
        description: input.description,
        robots_default: input.default === undefined ? true : Boolean(input.default),
        robots_noindex: Boolean(input.noindex),
      };
    }
    return json(record);
  });
  return { records, calls };
}

test("TTAA page is published only after AIOSEO title, description and noindex read-back", async (t) => {
  const wp = fakeWordPress(t);
  const token = ttaaVerificationToken(document.documentNumber);
  const first = await publishTtaaVerificationDocument(document, token);
  assert.equal(first.url, `https://turkishtranslation.com.tr/document-verification-${token}/`);
  assert.equal(wp.records[0].status, "publish");
  assert.match(wp.records[0].content.raw, /TTAA_VERIFICATION_DATA:/);
  assert.match(wp.records[0].content.raw, /supporting PDF has not been uploaded yet/);
  assert.equal(wp.records[0].aioseo_meta_data?.robots_noindex, true);
  const seoIndex = wp.calls.findIndex((call) => Boolean(call.body.aioseo_meta_data));
  assert.deepEqual(wp.calls[seoIndex].body.aioseo_meta_data, {
    title: "Document TTAA2026009 Verification | TTAA",
    description: "Check document TTAA2026009 verified by TTAA. The PDF has not been uploaded yet.",
    default: false,
    noindex: true,
  });
  const publishIndex = wp.calls.findIndex((call) => call.body.status === "publish");
  assert.ok(seoIndex > 0 && publishIndex > seoIndex);
  assert.equal((await publishTtaaVerificationDocument(document, token)).reused, true);
  assert.equal(wp.records.length, 1);
});

test("TTAA PDF add, replace and remove retain the original QR URL", async (t) => {
  const wp = fakeWordPress(t);
  const token = ttaaVerificationToken(document.documentNumber);
  const first = await publishTtaaVerificationDocument(document, token);
  const pdf1 = "https://turkishtranslation.com.tr/wp-content/uploads/first.pdf";
  const attached = await attachTtaaVerificationPdf(token, pdf1, 51);
  assert.equal(attached.url, first.url);
  assert.equal((await findTtaaVerificationDocument(token))?.hasFile, true);
  assert.match(wp.records[0].content.raw, /<iframe/);
  const pdf2 = "https://turkishtranslation.com.tr/wp-content/uploads/second.pdf";
  const replaced = await setTtaaVerificationPdf(token, { url: pdf2, mediaId: 52 });
  assert.equal(replaced.url, first.url);
  assert.equal(replaced.document.fileUrl, pdf2);
  assert.equal((await listTtaaVerificationDocuments("Example", 1)).records.length, 1);
  const removed = await setTtaaVerificationPdf(token);
  assert.equal(removed.url, first.url);
  assert.equal(removed.document.fileUrl, undefined);
  assert.doesNotMatch(wp.records[0].content.raw, /<iframe/);
});

test("SEO failure keeps a TTAA document in draft and foreign pages are untouched", async (t) => {
  const wp = fakeWordPress(t, { dropSeo: true });
  await assert.rejects(publishTtaaVerificationDocument(document, ttaaVerificationToken(document.documentNumber)), /AIOSEO/);
  assert.equal(wp.records[0].status, "draft");
  assert.ok(!wp.calls.some((call) => call.body.status === "publish"));
  await assert.rejects(publishTtaaVerificationDocument(document, ttaaVerificationToken(document.documentNumber)), /AIOSEO/);
  assert.equal(wp.records.length, 1, "a retry must reuse the failed draft");
});

test("TTAA never overwrites an unrelated page and can refresh its own landing", async (t) => {
  const wp = fakeWordPress(t, { foreignSlug: true });
  await assert.rejects(publishTtaaVerificationDocument(document, ttaaVerificationToken(document.documentNumber)), /farklı bir WordPress sayfası/);
  assert.ok(!wp.calls.some((call) => call.method === "POST"));
  const first = await ensureTtaaVerificationLanding();
  const second = await ensureTtaaVerificationLanding();
  assert.equal(first.url, "https://turkishtranslation.com.tr/document-verification/");
  assert.equal(second.reused, true);
  assert.equal(wp.records.length, 2);
});
