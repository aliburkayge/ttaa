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
  assert.doesNotMatch(landing, /AY TERCÜME|aytercume\.com/);
  assert.match(ttaaVerificationSeo().title, /Document Verification \| TTAA/);
});

test("TTAA page escapes document data and changes from pending to embedded PDF", () => {
  const marker = "TTAA_VERIFICATION:record";
  const pending = ttaaVerificationDocumentHtml({ ...record, customer: "A & B <script>" }, marker);
  assert.match(pending, /The supporting PDF has not been uploaded yet/);
  assert.match(pending, /A &amp; B &lt;script&gt;/);
  assert.doesNotMatch(pending, /<iframe/);
  assert.match(pending, /\.ayv-seal:before\{[^}]*border-left:5px solid #fff/);
  assert.equal(readTtaaVerificationDocument(pending, marker).customer, "A & B <script>");
  const withPdf = ttaaVerificationDocumentHtml({ ...record, fileUrl: "https://turkishtranslation.com.tr/wp-content/uploads/document.pdf" }, marker);
  assert.match(withPdf, /<iframe[^>]+document\.pdf#toolbar=0/);
  assert.throws(() => ttaaVerificationDocumentHtml({ ...record, fileUrl: "https://example.com/private.pdf" }, marker), /TTAA website/);
});

test("TTAA production QR contains the official document URL", async () => {
  const url = "https://turkishtranslation.com.tr/document-verification-11111111-2222-3333-4444-555555555555/";
  const label = await createTtaaVerificationLabel(record, url);
  assert.equal(label.qrText, url);
  assert.match(label.labelSvg, /VERIFICATION: TURKISHTRANSLATION\.COM\.TR/);
  assert.doesNotMatch(label.qrText, /PROTOTIP/);
  await assert.rejects(createTtaaVerificationLabel(record, "https://aytercume.com/document/"), /turkishtranslation.com.tr/);
});
