import assert from "node:assert/strict";
import test from "node:test";
import { readTtaaVerificationDocument, ttaaVerificationDocumentHtml, ttaaVerificationLandingHtml, ttaaVerificationSeo } from "../lib/ttaa-verification-page.ts";
import { createTtaaVerificationLabel } from "../lib/qr-prototype.ts";

const record = { documentNumber: "TTAA2026009", customer: "Example Customer", documentDate: "2026-09-16", documentType: "Translation document" };

test("TTAA public verification uses its own English brand and official contacts", () => {
  const landing = ttaaVerificationLandingHtml();
  assert.match(landing, /Document verification/);
  assert.match(landing, /\+90 530 519 60 99/);
  assert.match(landing, /info@turkishtranslation\.com\.tr/);
  assert.match(landing, /<iframe[^>]+\/verify\/ttaa[^>]+allow="camera"/);
  assert.match(landing, /Verify your document here/);
  assert.match(landing, /<article class="ayv-editorial"/);
  assert.match(landing, /Official Document Verification/);
  assert.match(landing, /How to verify a certified or sworn translation/);
  assert.match(landing, /Why does document verification matter/);
  assert.match(landing, /What this check covers/);
  assert.ok(landing.indexOf('class="ayv-lookup"') < landing.indexOf('class="ayv-editorial"'));
  assert.ok(landing.indexOf('class="ayv-editorial"') < landing.indexOf('class="ayv-contact"'));
  assert.doesNotMatch(landing, /AY TERCÜME|aytercume\.com/);
  assert.match(ttaaVerificationSeo().title, /Official Document Verification \| TTAA/);
});

test("TTAA page escapes document data and changes from pending to embedded PDF", () => {
  const token = "11111111-2222-3333-4444-555555555555";
  const marker = `TTAA_VERIFICATION:${token}`;
  const pending = ttaaVerificationDocumentHtml({ ...record, customer: "A & B <script>" }, marker);
  assert.match(pending, /The supporting PDF has not been uploaded yet/);
  assert.match(pending, /A &amp; B &lt;script&gt;/);
  assert.doesNotMatch(pending, /<iframe/);
  assert.match(pending, /\.ayv-seal:before\{[^}]*border-left:5px solid #fff/);
  assert.equal(readTtaaVerificationDocument(pending, marker).customer, "A & B <script>");
  const withPdf = ttaaVerificationDocumentHtml({ ...record, fileKey: `ttaa/${token}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.pdf` }, marker);
  assert.match(withPdf, /<iframe[^>]+\/api\/public-verification\/viewer\?brand=ttaa&amp;token=/);
  assert.doesNotMatch(withPdf, /wp-content\/uploads|Open PDF/);
  assert.throws(() => ttaaVerificationDocumentHtml({ ...record, fileUrl: "https://example.com/private.pdf" }, marker), /TTAA website/);
});

test("TTAA production download contains only the QR for the official document URL", async () => {
  const url = "https://turkishtranslation.com.tr/document-verification-11111111-2222-3333-4444-555555555555/";
  const label = await createTtaaVerificationLabel(record, url);
  assert.equal(label.qrText, url);
  assert.equal(label.labelSvg, label.qrSvg);
  assert.match(label.labelSvg, /<svg[^>]+width="1200"[^>]+height="1200"/);
  assert.doesNotMatch(label.labelSvg, /TTAA|VERIFICATION|TTAA2026009|<text/);
  assert.doesNotMatch(label.qrText, /PROTOTIP/);
  await assert.rejects(createTtaaVerificationLabel(record, "https://aytercume.com/document/"), /turkishtranslation.com.tr/);
});
