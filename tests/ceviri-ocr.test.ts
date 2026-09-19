import assert from "node:assert/strict";
import test from "node:test";
import { activeOcrProvider, countPdfPages, isPdf, ocrToSegments, OCR_PROVIDERS } from "../lib/ceviri/ocr.ts";

function bytes(text: string): Uint8Array {
  return new Uint8Array([...text].map((char) => char.charCodeAt(0)));
}

test("recognises a PDF by its magic bytes", () => {
  assert.equal(isPdf(bytes("%PDF-1.7\n...")), true);
  assert.equal(isPdf(bytes("PK")), false);
});

test("counts pages when the page tree is not compressed", () => {
  assert.equal(countPdfPages(bytes("%PDF /Type /Page\n /Type /Page\n /Type /Pages")), 2);
});

test("returns null rather than guessing when no page marker is readable", () => {
  // The customer's scanned PDFs compress their object streams, so the marker
  // is absent. Reporting 1 there would be a confident wrong answer.
  assert.equal(countPdfPages(bytes("%PDF-1.7 binary junk with no markers")), null);
});

test("falls back to the demo provider while no OCR account is configured", () => {
  const provider = activeOcrProvider();
  assert.equal(provider.configured, false);
  assert.equal(provider.id, "demo");
});

test("lists the real providers ahead of the demo one", () => {
  assert.deepEqual(OCR_PROVIDERS.map((provider) => provider.id), ["azure", "mistral", "demo"]);
});

test("the demo provider extracts no text and says so", async () => {
  const result = await activeOcrProvider().run(bytes("%PDF /Type /Page\n"), { lang: "en-US" });
  assert.equal(result.demo, true);
  assert.match(String(result.warning), /ÇIKARILMADI/);
  assert.ok(result.blocks.every((block) => block.text.startsWith("[")), "yer tutucu olmayan blok var");
  assert.ok(result.blocks.every((block) => block.confidence === 0));
});

test("the demo provider admits when it could not even count the pages", async () => {
  const result = await activeOcrProvider().run(bytes("%PDF no markers here"), { lang: "en-US" });
  assert.equal(result.pages, null);
  assert.match(String(result.warning), /belirlenemedi/);
  assert.equal(result.blocks.length, 1);
});

test("an unimplemented real provider refuses loudly instead of returning nothing", async () => {
  const azure = OCR_PROVIDERS.find((provider) => provider.id === "azure");
  await assert.rejects(() => azure!.run(bytes("%PDF"), { lang: "en-US" }), /uygulanmadı/);
});

test("turns OCR blocks into numbered segments", () => {
  const segments = ocrToSegments({
    provider: "demo",
    demo: true,
    pages: 2,
    warning: null,
    blocks: [
      { kind: "heading", text: "Başlık", page: 1, confidence: 0.9 },
      { kind: "table-cell", text: "Hücre", page: 1, confidence: 0.4 },
    ],
  });
  assert.deepEqual(segments.map((segment) => [segment.id, segment.kind, segment.order]), [
    ["o1", "paragraph", 1],
    ["o2", "table-cell", 2],
  ]);
  assert.equal(segments[1].confidence, 0.4);
});
