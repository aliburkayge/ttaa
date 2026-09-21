import assert from "node:assert/strict";
import { afterEach, beforeEach, test, type TestContext } from "node:test";
import { attachAyVerificationPdf, deleteAyVerificationDocument, ensureAyVerificationLanding, findAyVerificationDocument, listAyVerificationDocuments, publishAyVerificationDocument, refreshAyVerificationDocumentDesign, setAyVerificationPdf } from "../lib/ay-verification-wordpress.ts";
import { ayVerificationToken } from "../lib/ay-verification-token.ts";

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.AY_WP_URL = "https://aytercume.com";
  process.env.AY_WP_USERNAME = "test";
  process.env.AY_WP_APP_PASSWORD = "test";
  process.env.AUTH_SESSION_SECRET = "test-secret-with-more-than-thirty-two-characters";
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

const document = {
  documentNumber: "AYT2026009",
  customer: "Örnek Müşteri",
  documentDate: "2026-09-16",
  documentType: "Tercüme belgesi",
  fileUrl: "https://aytercume.com/wp-content/uploads/2026/09/verified.pdf",
};

type RecordPage = { id: number; slug: string; status: string; link: string; content: { raw: string }; title: string; template?: string };
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }

function fakeWordPress(t: TestContext, options: { seoFails?: boolean; foreignSlug?: boolean } = {}) {
  const records: RecordPage[] = [];
  const calls: { pathname: string; method: string; body: Record<string, unknown> }[] = [];
  if (options.foreignSlug) records.push({ id: 9, slug: `belge-dogrulama-${ayVerificationToken(document.documentNumber)}`, status: "publish", link: "https://aytercume.com/foreign/", content: { raw: "unrelated" }, title: "Unrelated" });
  t.mock.method(globalThis, "fetch", async (raw: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(raw instanceof Request ? raw.url : raw.toString());
    assert.equal(url.hostname, "aytercume.com", `Unexpected network destination: ${url.hostname}`);
    const method = init.method || "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    calls.push({ pathname: url.pathname, method, body });
    if (url.pathname === "/wp-json/rankmath/v1/updateMeta") return options.seoFails ? json({ message: "SEO update denied" }, 403) : json({ success: true });
    const match = /^\/wp-json\/wp\/v2\/pages(?:\/(\d+))?$/.exec(url.pathname);
    assert.ok(match, `Unexpected WordPress request: ${url}`);
    const id = match[1] ? Number(match[1]) : null;
    if (method === "GET") return id ? json(records.find((record) => record.id === id) || { message: "Not found" }, records.some((record) => record.id === id) ? 200 : 404) : url.searchParams.has("slug") ? json(records.filter((record) => record.slug === url.searchParams.get("slug"))) : json(records.filter((record) => !url.searchParams.has("search") || record.content.raw.toLocaleLowerCase("tr-TR").includes((url.searchParams.get("search") || "").toLocaleLowerCase("tr-TR"))));
    if (method === "DELETE" && id) {
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) return json({ message: "Not found" }, 404);
      const [record] = records.splice(index, 1);
      return json({ deleted: true, previous: record });
    }
    if (!id) {
      const record = { id: records.length + 100, slug: String(body.slug), status: String(body.status), link: `https://aytercume.com/${String(body.slug)}/`, content: { raw: String(body.content) }, title: String(body.title), template: String(body.template) };
      records.push(record);
      return json(record, 201);
    }
    const record = records.find((item) => item.id === id);
    assert.ok(record);
    if (body.status) record.status = String(body.status);
    if (body.content) record.content.raw = String(body.content);
    if (body.title) record.title = String(body.title);
    if (body.template) record.template = String(body.template);
    return json(record);
  });
  return { records, calls };
}

test("document page is drafted, given SEO, then published; retry reuses it", async (t) => {
  const wp = fakeWordPress(t);
  const token = ayVerificationToken(document.documentNumber);
  const first = await publishAyVerificationDocument(document, token);
  assert.equal(first.reused, false);
  assert.equal(first.url, `https://aytercume.com/belge-dogrulama-${token}/`);
  assert.equal(wp.records[0].status, "publish");
  assert.equal(wp.records[0].template, "elementor_header_footer");
  assert.match(wp.records[0].content.raw, /Örnek Müşteri/);
  assert.match(wp.records[0].content.raw, /<iframe/);
  const seoIndex = wp.calls.findIndex((call) => call.pathname.includes("updateMeta"));
  const publishIndex = wp.calls.findIndex((call) => call.body.status === "publish");
  assert.ok(seoIndex > 0 && publishIndex > seoIndex);
  assert.deepEqual((wp.calls[seoIndex].body.meta as Record<string, unknown>).rank_math_robots, ["noindex", "follow"]);
  const second = await publishAyVerificationDocument(document, token);
  assert.equal(second.reused, true);
  assert.equal(wp.records.length, 1);
});

test("PDF can be attached later to the same published page and QR address", async (t) => {
  const wp = fakeWordPress(t);
  const token = ayVerificationToken(document.documentNumber);
  const placeholder = await publishAyVerificationDocument({ ...document, fileUrl: undefined }, token);
  assert.equal(wp.records[0].status, "publish");
  assert.match(wp.records[0].content.raw, /Gerekli evraklar şu anda yüklenmemiştir/);
  assert.ok(!wp.records[0].content.raw.includes("<iframe"));
  const lookup = await findAyVerificationDocument(token);
  assert.equal(lookup?.hasFile, false);
  assert.equal(lookup?.document.customer, document.customer);
  const key = `ay-tercume/${token}/11111111-2222-3333-4444-555555555555.pdf`;
  const updated = await attachAyVerificationPdf(token, key);
  assert.equal(updated.id, placeholder.id);
  assert.equal(updated.url, placeholder.url);
  assert.equal(wp.records.length, 1);
  assert.match(wp.records[0].content.raw, /<iframe/);
  assert.equal((await findAyVerificationDocument(token))?.document.fileKey, key);
  await assert.rejects(attachAyVerificationPdf(token, key), /zaten eklenmiş/);
  assert.equal(wp.records.length, 1);
});

test("old published documents are listed and PDFs can be replaced then removed without changing the QR URL", async (t) => {
  const wp = fakeWordPress(t);
  const token = ayVerificationToken(document.documentNumber);
  const first = await publishAyVerificationDocument({ ...document, mediaId: 44 }, token);
  const list = await listAyVerificationDocuments("Örnek", 1);
  assert.equal(list.records.length, 1);
  assert.equal(list.records[0].details.customer, document.customer);
  const replacement = `ay-tercume/${token}/22222222-3333-4444-5555-666666666666.pdf`;
  const updated = await setAyVerificationPdf(token, { key: replacement });
  assert.equal(updated.id, first.id);
  assert.equal(updated.url, first.url);
  assert.equal(updated.document.fileKey, replacement);
  assert.equal(updated.document.fileUrl, undefined);
  assert.doesNotMatch(wp.records[0].content.raw, /wp-content\/uploads/);
  const removed = await setAyVerificationPdf(token);
  assert.equal(removed.url, first.url);
  assert.equal(removed.document.fileUrl, undefined);
  assert.equal(removed.document.mediaId, undefined);
  assert.equal(removed.document.fileKey, undefined);
  assert.doesNotMatch(wp.records[0].content.raw, /<iframe/);
  assert.match(wp.records[0].content.raw, /Gerekli evraklar şu anda yüklenmemiştir/);
  assert.equal(wp.records.length, 1);
});

test("owned verification pages can be permanently deleted", async (t) => {
  const wp = fakeWordPress(t);
  const token = ayVerificationToken(document.documentNumber);
  const published = await publishAyVerificationDocument(document, token);
  const deleted = await deleteAyVerificationDocument(token);
  assert.equal(deleted.id, published.id);
  assert.equal(wp.records.length, 0);
  assert.equal(await findAyVerificationDocument(token), null);
  assert.ok(wp.calls.some((call) => call.method === "DELETE" && call.pathname.endsWith(`/${published.id}`)));
});

test("an owned published page receives the new design without changing metadata, PDF or URL", async (t) => {
  const wp = fakeWordPress(t);
  const token = ayVerificationToken(document.documentNumber);
  const first = await publishAyVerificationDocument(document, token);
  wp.records[0].content.raw = wp.records[0].content.raw.replace("<!-- AY_VERIFICATION_DESIGN:2 -->", "");
  const refreshed = await refreshAyVerificationDocumentDesign(token);
  assert.equal(refreshed.id, first.id);
  assert.equal(refreshed.url, first.url);
  assert.equal(refreshed.reused, false);
  assert.match(wp.records[0].content.raw, /AY_VERIFICATION_DESIGN:2/);
  assert.match(wp.records[0].content.raw, /<iframe/);
  assert.deepEqual((await findAyVerificationDocument(token))?.document, document);
  const count = wp.calls.filter((call) => call.method === "POST" && call.pathname.endsWith(`/${first.id}`)).length;
  assert.equal((await refreshAyVerificationDocumentDesign(token)).reused, true);
  assert.equal(wp.calls.filter((call) => call.method === "POST" && call.pathname.endsWith(`/${first.id}`)).length, count);
});

test("SEO error leaves a document as a draft", async (t) => {
  const wp = fakeWordPress(t, { seoFails: true });
  await assert.rejects(publishAyVerificationDocument(document, ayVerificationToken(document.documentNumber)), /SEO update denied/);
  assert.equal(wp.records[0].status, "draft");
  assert.ok(!wp.calls.some((call) => call.body.status === "publish"));
});

test("an unrelated existing slug is never overwritten", async (t) => {
  const wp = fakeWordPress(t, { foreignSlug: true });
  await assert.rejects(publishAyVerificationDocument(document, ayVerificationToken(document.documentNumber)), /farklı bir WordPress sayfası/);
  assert.ok(!wp.calls.some((call) => call.method === "POST"));
});

test("owned landing page can be refreshed without creating a duplicate", async (t) => {
  const wp = fakeWordPress(t);
  const first = await ensureAyVerificationLanding();
  const second = await ensureAyVerificationLanding();
  assert.equal(first.url, "https://aytercume.com/belge-dogrulama/");
  assert.equal(second.reused, true);
  assert.equal(wp.records.length, 1);
  assert.ok(wp.calls.filter((call) => call.pathname.includes("updateMeta")).length === 2);
});

test("document token is stable and needs a configured secret", () => {
  assert.equal(ayVerificationToken("AYT2026009"), ayVerificationToken(" ayt2026009 "));
  delete process.env.AUTH_SESSION_SECRET;
  assert.throws(() => ayVerificationToken("AYT2026009"), /sunucu sırrı/);
});
