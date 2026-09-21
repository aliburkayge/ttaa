import assert from "node:assert/strict";
import test from "node:test";
import { createAyVerificationLabel, createPrototypeLabel, prototypeQrText, validatePrototypeDetails, type PrototypeDetails } from "../lib/qr-prototype.ts";
import { generateVerificationDocumentNumber } from "../lib/verification-document-number.ts";

const details: PrototypeDetails = {
  documentNumber: "TEST-001",
  customer: "Özel Müşteri",
  documentType: "Tercüme belgesi",
  documentDate: "2026-09-16",
  driveLink: "https://drive.google.com/file/d/private-file/view",
};

test("QR preview and downloads contain only the square QR image", async () => {
  for (const [brand, company] of [["ttaa", "TTAA"], ["ay-tercume", "AY TERCÜME"]] as const) {
    const result = await createPrototypeLabel(brand, details);
    assert.match(result.qrText, /^PROTOTIP - RESMI DOGRULAMA DEGILDIR/);
    assert.match(result.qrText, new RegExp(`Firma: ${company}`));
    assert.match(result.qrText, /Belge No: TEST-001/);
    assert.equal(result.labelSvg, result.qrSvg);
    assert.match(result.labelSvg, /<svg[^>]+width="1200"[^>]+height="1200"/);
    assert.ok(!result.labelSvg.includes(company));
    assert.ok(!result.labelSvg.includes(details.documentNumber));
    assert.ok(!result.labelSvg.includes(details.documentDate));
    assert.ok(!result.labelSvg.includes("<text"));
    for (const privateValue of [details.customer, details.driveLink, "private-file"]) {
      assert.ok(!result.qrText.includes(privateValue));
      assert.ok(!result.labelSvg.includes(privateValue));
      assert.ok(!result.labelUrl.includes(privateValue));
    }
    assert.ok(!result.qrText.includes("https://"));
  }
  assert.notEqual(prototypeQrText("ttaa", details.documentNumber), prototypeQrText("ay-tercume", details.documentNumber));
});

test("document details never appear in the downloadable SVG", async () => {
  const result = await createPrototypeLabel("ttaa", { documentNumber: "A&B<12>", documentDate: details.documentDate });
  assert.ok(!result.labelSvg.includes("A&amp;B&lt;12&gt;"));
  assert.ok(!result.labelSvg.includes("<12>"));
});

test("live Ay QR points only to aytercume.com without label text", async () => {
  const label = await createAyVerificationLabel(details, "https://aytercume.com/belge-dogrulama-123/");
  assert.equal(label.qrText, "https://aytercume.com/belge-dogrulama-123/");
  assert.equal(label.labelSvg, label.qrSvg);
  assert.ok(!label.labelSvg.includes("AYTERCUME.COM"));
  assert.ok(!label.labelSvg.includes(details.documentNumber));
  assert.ok(!label.labelSvg.includes(details.customer));
  await assert.rejects(() => createAyVerificationLabel(details, "https://aytercume.com.evil.test/file"), /aytercume/);
});

test("form rejects malformed dates and Drive links", () => {
  assert.deepEqual(validatePrototypeDetails({ ...details, documentNumber: " TEST-001 " }), details);
  assert.throws(() => validatePrototypeDetails({ ...details, documentDate: "2026-02-30" }), /tarih/);
  assert.throws(() => validatePrototypeDetails({ ...details, driveLink: "https://drive.google.com.evil.test/file" }), /Drive/);
  assert.throws(() => validatePrototypeDetails({ ...details, driveLink: "http://drive.google.com/file" }), /Drive/);
  assert.throws(() => validatePrototypeDetails({ ...details, documentNumber: "A\nB" }), /Belge numarası/);
});

test("new verification document numbers are branded, mixed-case and unpredictable", () => {
  const generated = Array.from({ length: 100 }, () => generateVerificationDocumentNumber("ay-tercume"));
  const ttaa = generateVerificationDocumentNumber("ttaa");
  assert.equal(new Set(generated).size, generated.length);
  for (const number of [...generated, ttaa]) {
    const randomPart = number.replace(/^(AY|TTAA)-/, "").replaceAll("-", "");
    assert.match(randomPart, /^[A-Za-z2-9]{16}$/);
    assert.match(randomPart, /[A-Z]/);
    assert.match(randomPart, /[a-z]/);
    assert.match(randomPart, /[2-9]/);
  }
  assert.match(generated[0], /^AY-/);
  assert.match(ttaa, /^TTAA-/);
});
