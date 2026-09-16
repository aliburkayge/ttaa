import assert from "node:assert/strict";
import test from "node:test";
import { createAyVerificationLabel, createPrototypeLabel, prototypeQrText, validatePrototypeDetails, type PrototypeDetails } from "../lib/qr-prototype.ts";

const details: PrototypeDetails = {
  documentNumber: "TEST-001",
  customer: "Özel Müşteri",
  documentType: "Tercüme belgesi",
  documentDate: "2026-09-16",
  driveLink: "https://drive.google.com/file/d/private-file/view",
};

test("QR and printable label include only the company, number and date", async () => {
  for (const [brand, company] of [["ttaa", "TTAA"], ["ay-tercume", "AY TERCÜME"]] as const) {
    const result = await createPrototypeLabel(brand, details);
    assert.match(result.qrText, /^PROTOTIP - RESMI DOGRULAMA DEGILDIR/);
    assert.match(result.qrText, new RegExp(`Firma: ${company}`));
    assert.match(result.qrText, /Belge No: TEST-001/);
    assert.match(result.labelSvg, /70mm.*45mm/);
    assert.match(result.labelSvg, /16\.09\.2026/);
    assert.match(result.labelSvg, /RESMÎ DOĞRULAMA DEĞİLDİR/);
    for (const privateValue of [details.customer, details.driveLink, "private-file"]) {
      assert.ok(!result.qrText.includes(privateValue));
      assert.ok(!result.labelSvg.includes(privateValue));
      assert.ok(!result.labelUrl.includes(privateValue));
    }
    assert.ok(!result.qrText.includes("https://"));
  }
  assert.notEqual(prototypeQrText("ttaa", details.documentNumber), prototypeQrText("ay-tercume", details.documentNumber));
});

test("document number is escaped in the printable SVG", async () => {
  const result = await createPrototypeLabel("ttaa", { documentNumber: "A&B<12>", documentDate: details.documentDate });
  assert.match(result.labelSvg, /A&amp;B&lt;12&gt;/);
  assert.ok(!result.labelSvg.includes("<12>"));
});

test("live Ay label points only to aytercume.com and is clearly distinct from a prototype", async () => {
  const label = await createAyVerificationLabel(details, "https://aytercume.com/belge-dogrulama-123/");
  assert.equal(label.qrText, "https://aytercume.com/belge-dogrulama-123/");
  assert.match(label.labelSvg, /DOĞRULAMA: AYTERCUME.COM/);
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
