import assert from "node:assert/strict";
import test from "node:test";
import { ayVerificationDocumentHtml, ayVerificationLandingHtml, ayVerificationSeo } from "../lib/ay-verification-page.ts";

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
  assert.match(html, /Bu dosya AY Tercüme tarafından doğrulanmıştır/);
  assert.match(html, /A&amp;B&lt;7&gt;&quot;/);
  assert.match(html, /Sözleşme &lt;ek&gt;/);
  assert.match(html, /Firma &lt;İstanbul&gt;/);
  assert.match(html, /16\.09\.2026/);
  assert.match(html, /<iframe[^>]+example\.pdf#toolbar=0/);
  assert.match(html, /AY_VERIFICATION:test-marker/);
  assert.ok(!html.includes("<ek>"));
  assert.throws(() => ayVerificationDocumentHtml({ documentNumber: "1", customer: "A", documentDate: "2026-09-16", documentType: "PDF", fileUrl: "http://example.com/file.pdf" }, "x"), /HTTPS/);
});
