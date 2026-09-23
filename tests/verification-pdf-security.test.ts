import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createVerificationPdfAccess, verifyVerificationPdfAccess } from "../lib/verification-pdf-access.ts";
import { privateDocumentHeaders, verificationFrameAncestors, verificationPdfResponseHeaders } from "../lib/public-verification-pdf.ts";

const originalSecret = process.env.AUTH_SESSION_SECRET;
beforeEach(() => { process.env.AUTH_SESSION_SECRET = "test-secret-with-more-than-thirty-two-characters"; });
afterEach(() => {
  if (originalSecret === undefined) delete process.env.AUTH_SESSION_SECRET;
  else process.env.AUTH_SESSION_SECRET = originalSecret;
});

test("private PDF access is short lived, brand bound and tamper resistant", () => {
  const token = "11111111-2222-3333-4444-555555555555";
  const access = createVerificationPdfAccess("ay-tercume", token, 1_000);
  assert.equal(access.expires, 1_300);
  assert.equal(verifyVerificationPdfAccess("ay-tercume", token, access.expires, access.signature, 1_001), true);
  assert.equal(verifyVerificationPdfAccess("ttaa", token, access.expires, access.signature, 1_001), false);
  assert.equal(verifyVerificationPdfAccess("ay-tercume", token, access.expires, `${access.signature.slice(0, -1)}A`, 1_001), false);
  assert.equal(verifyVerificationPdfAccess("ay-tercume", token, access.expires, access.signature, 1_301), false);
});

test("PDF responses block indexing, caching and unrelated framing", () => {
  assert.match(privateDocumentHeaders["X-Robots-Tag"], /noindex/);
  assert.match(privateDocumentHeaders["X-Robots-Tag"], /noarchive/);
  assert.match(privateDocumentHeaders["Cache-Control"], /no-store/);
  assert.equal(privateDocumentHeaders["Referrer-Policy"], "no-referrer");
  assert.match(verificationFrameAncestors("ay-tercume"), /https:\/\/aytercume\.com/);
  assert.doesNotMatch(verificationFrameAncestors("ay-tercume"), /turkishtranslation/);
  assert.match(verificationFrameAncestors("ttaa"), /https:\/\/turkishtranslation\.com\.tr/);
});

test("PDF viewer permits the matching WordPress origin without browser-blocking resource policy", () => {
  const headers = verificationPdfResponseHeaders("ay-tercume");
  assert.equal(headers["Content-Type"], "application/pdf");
  assert.match(headers["Content-Disposition"], /^inline;/);
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'self' https:\/\/aytercume\.com/);
  assert.equal("Cross-Origin-Resource-Policy" in headers, false);
  assert.doesNotMatch(headers["Content-Security-Policy"], /default-src/);
});
