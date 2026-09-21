import assert from "node:assert/strict";
import test from "node:test";
import { ayVerificationDocumentHtml, ayVerificationLandingHtml, ayVerificationSeo, readAyVerificationDocument } from "../lib/ay-verification-page.ts";

test("landing has a distinct title, description and both offices", () => {
  const seo = ayVerificationSeo();
  const html = ayVerificationLandingHtml();
  assert.match(seo.title, /Resmî Belge Doğrulama.*AY Tercüme/);
  assert.match(seo.description, /QR kod veya belge numarasıyla/);
  assert.match(html, /Ankara Şubesi/);
  assert.match(html, /İstanbul Şubesi/);
  assert.match(html, /\+90 543 185 06 55/);
  assert.match(html, /\+90 544 761 96 87/);
  assert.match(html, /<iframe[^>]+\/verify\/ay-tercume[^>]+allow="camera"/);
  assert.match(html, /Belgenizi buradan doğrulayın/);
  assert.match(html, /<article class="ayv-editorial"/);
  assert.match(html, /<h2 id="ayv-editorial-title">Resmî Belge Doğrulama<\/h2>/);
  assert.match(html, /Yeminli tercüme doğrulama nasıl yapılır/);
  assert.match(html, /Noter onaylı tercüme, apostil ve diğer belgeler/);
  assert.match(html, /Doğrulamanın kapsamı/);
  assert.ok(html.indexOf('class="ayv-lookup"') < html.indexOf('class="ayv-editorial"'));
  assert.ok(html.indexOf('class="ayv-editorial"') < html.indexOf('class="ayv-contact"'));
  assert.ok(!html.includes("Bu dosya AY Tercüme tarafından doğrulanmıştır"));
});

test("verified page embeds its PDF but escapes supplied fields", () => {
  const token = "11111111-2222-3333-4444-555555555555";
  const marker = `AY_VERIFICATION:${token}`;
  const html = ayVerificationDocumentHtml({
    documentNumber: 'A&B<7>"',
    customer: "Firma <İstanbul>",
    documentDate: "2026-09-16",
    documentType: "Sözleşme <ek>",
    fileKey: `ay-tercume/${token}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf`,
  }, marker);
  assert.match(html, /Bu dosya AY Tercüme tarafından oluşturulup doğrulanmıştır/);
  assert.match(html, /\.ayv-seal:before\{[^}]*border-left:5px solid #fff/);
  assert.match(html, /background:linear-gradient\(145deg,#0aa4ee,#0769c7/);
  assert.match(html, /AY_VERIFICATION_DESIGN:2/);
  assert.ok(!html.includes("✓"));
  assert.match(html, /A&amp;B&lt;7&gt;&quot;/);
  assert.match(html, /Sözleşme &lt;ek&gt;/);
  assert.match(html, /Firma &lt;İstanbul&gt;/);
  assert.match(html, /16\.09\.2026/);
  assert.match(html, /<iframe[^>]+\/api\/public-verification\/viewer\?brand=ay-tercume&amp;token=/);
  assert.doesNotMatch(html, /wp-content\/uploads|PDF’yi aç/);
  assert.match(html, new RegExp(marker));
  assert.equal(readAyVerificationDocument(html, marker).customer, "Firma <İstanbul>");
  assert.ok(!html.includes("<ek>"));
  assert.throws(() => ayVerificationDocumentHtml({ documentNumber: "1", customer: "A", documentDate: "2026-09-16", documentType: "PDF", fileUrl: "http://example.com/file.pdf" }, marker), /HTTPS/);
});

test("a page without a PDF shows the pending message and preserves record metadata", () => {
  const document = { documentNumber: "AYT22006", customer: "AY TERCUME DENEME", documentDate: "2026-09-16", documentType: "Diploma / eğitim belgesi" };
  const marker = "AY_VERIFICATION:11111111-2222-3333-4444-555555555555";
  const html = ayVerificationDocumentHtml(document, marker);
  assert.match(html, /Bu dosya AY Tercüme tarafından oluşturulup doğrulanmıştır/);
  assert.match(html, /Gerekli evraklar şu anda yüklenmemiştir/);
  assert.match(html, /En yakın zamanda tekrar kontrol edin/);
  assert.ok(!html.includes("<iframe"));
  assert.deepEqual(readAyVerificationDocument(html, marker), document);
  assert.match(ayVerificationSeo(document.documentNumber, false).description, /henüz yüklenmemiştir/);
});
