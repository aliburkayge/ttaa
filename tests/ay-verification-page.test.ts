import assert from "node:assert/strict";
import test from "node:test";
import { ayVerificationDocumentHtml, ayVerificationLandingHtml, ayVerificationSeo, readAyVerificationDocument } from "../lib/ay-verification-page.ts";

test("landing has a distinct title, description and both offices", () => {
  const seo = ayVerificationSeo();
  const html = ayVerificationLandingHtml();
  assert.match(seo.title, /Belge Doğrulama.*AY Tercüme/);
  assert.match(seo.description, /QR belge doğrulama/);
  assert.match(html, /Ankara Şubesi/);
  assert.match(html, /İstanbul Şubesi/);
  assert.match(html, /\+90 543 185 06 55/);
  assert.match(html, /\+90 544 761 96 87/);
  assert.ok(!html.includes("Bu dosya AY Tercüme tarafından doğrulanmıştır"));
});

test("verified page embeds its PDF but escapes supplied fields", () => {
  const html = ayVerificationDocumentHtml({
    documentNumber: 'A&B<7>"',
    customer: "Firma <İstanbul>",
    documentDate: "2026-09-16",
    documentType: "Sözleşme <ek>",
    fileUrl: "https://aytercume.com/wp-content/uploads/example.pdf",
  }, "AY_VERIFICATION:test-marker");
  assert.match(html, /Bu dosya AY Tercüme tarafından oluşturulup doğrulanmıştır/);
  assert.match(html, /A&amp;B&lt;7&gt;&quot;/);
  assert.match(html, /Sözleşme &lt;ek&gt;/);
  assert.match(html, /Firma &lt;İstanbul&gt;/);
  assert.match(html, /16\.09\.2026/);
  assert.match(html, /<iframe[^>]+example\.pdf#toolbar=0/);
  assert.match(html, /AY_VERIFICATION:test-marker/);
  assert.equal(readAyVerificationDocument(html, "AY_VERIFICATION:test-marker").customer, "Firma <İstanbul>");
  assert.ok(!html.includes("<ek>"));
  assert.throws(() => ayVerificationDocumentHtml({ documentNumber: "1", customer: "A", documentDate: "2026-09-16", documentType: "PDF", fileUrl: "http://example.com/file.pdf" }, "x"), /HTTPS/);
});

test("a page without a PDF shows the pending message and preserves record metadata", () => {
  const document = { documentNumber: "AYT22006", customer: "AY TERCUME DENEME", documentDate: "2026-09-16", documentType: "Diploma / eğitim belgesi" };
  const html = ayVerificationDocumentHtml(document, "AY_VERIFICATION:token");
  assert.match(html, /Bu dosya AY Tercüme tarafından oluşturulup doğrulanmıştır/);
  assert.match(html, /Gerekli evraklar şu anda yüklenmemiştir/);
  assert.match(html, /En yakın zamanda tekrar kontrol edin/);
  assert.ok(!html.includes("<iframe"));
  assert.deepEqual(readAyVerificationDocument(html, "AY_VERIFICATION:token"), document);
  assert.match(ayVerificationSeo(document.documentNumber, false).description, /henüz yüklenmemiştir/);
});
