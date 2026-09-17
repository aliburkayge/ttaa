import assert from "node:assert/strict";
import test from "node:test";
import { validDocumentNumber, verifiedPageUrl } from "../lib/public-verification.ts";

test("only the matching official document pages can be opened from a scanned QR", () => {
  const token = "11111111-2222-3333-4444-555555555555";
  const ttaa = `https://turkishtranslation.com.tr/document-verification-${token}/`;
  const ay = `https://aytercume.com/belge-dogrulama-${token}/`;
  assert.equal(verifiedPageUrl("ttaa", ttaa), ttaa);
  assert.equal(verifiedPageUrl("ay-tercume", ay), ay);
  assert.equal(verifiedPageUrl("ttaa", ay), null);
  assert.equal(verifiedPageUrl("ay-tercume", ttaa), null);
  assert.equal(verifiedPageUrl("ttaa", `https://turkishtranslation.com.tr.evil.test/document-verification-${token}/`), null);
  assert.equal(verifiedPageUrl("ttaa", `${ttaa}?redirect=https://evil.test`), null);
  assert.equal(verifiedPageUrl("ttaa", `javascript:alert(1)`), null);
});

test("document number input is bounded and rejects control characters", () => {
  assert.equal(validDocumentNumber(" TTAA010609 "), true);
  assert.equal(validDocumentNumber(" "), false);
  assert.equal(validDocumentNumber("x".repeat(65)), false);
  assert.equal(validDocumentNumber("TTAA\n010609"), false);
});
