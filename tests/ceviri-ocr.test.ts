import assert from "node:assert/strict";
import test from "node:test";
import { activeOcrProvider, countPdfPages, isPdf, ocrToSegments, OCR_PROVIDERS } from "../lib/ceviri/ocr.ts";

function bytes(text: string): Uint8Array {
  return new Uint8Array([...text].map((char) => char.charCodeAt(0)));
}

function withoutKeys<T>(body: () => T): T {
  const saved = {
    azure: process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY,
    mistral: process.env.MISTRAL_API_KEY,
  };
  delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  delete process.env.MISTRAL_API_KEY;
  try {
    return body();
  } finally {
    if (saved.azure !== undefined) process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = saved.azure;
    if (saved.mistral !== undefined) process.env.MISTRAL_API_KEY = saved.mistral;
  }
}

const demo = () => OCR_PROVIDERS.find((provider) => provider.id === "demo")!;

test("recognises a PDF by its magic bytes", () => {
  assert.equal(isPdf(bytes("%PDF-1.7\n...")), true);
  assert.equal(isPdf(bytes("PK")), false);
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
  withoutKeys(() => {
    const provider = activeOcrProvider();
    assert.equal(provider.configured, false);
    assert.equal(provider.id, "demo");
  });
});

test("uses Mistral once its key is present", () => {
  withoutKeys(() => {
    process.env.MISTRAL_API_KEY = "test";
    try {
      assert.equal(activeOcrProvider().id, "mistral");
    } finally {
      delete process.env.MISTRAL_API_KEY;
    }
  });
});

test("lists the real providers ahead of the demo one", () => {
  assert.deepEqual(OCR_PROVIDERS.map((provider) => provider.id), ["azure", "mistral", "demo"]);
});

test("the demo provider extracts no text and says so", async () => {
  const result = await demo().run(bytes("%PDF /Type /Page\n"), { lang: "en-US" });
  assert.equal(result.demo, true);
  assert.match(String(result.warning), /ÇIKARILMADI/);
  const segments = ocrToSegments(result);
  assert.ok(segments.every((segment) => segment.text.startsWith("[")), "yer tutucu olmayan satır var");
  assert.ok(segments.every((segment) => segment.confidence === 0));
});

test("the demo provider admits when it could not even count the pages", async () => {
  const result = await demo().run(bytes("%PDF no markers here"), { lang: "en-US" });
  assert.equal(result.pages, null);
  assert.match(String(result.warning), /belirlenemedi/);
  assert.equal(result.blocks.length, 1);
});

test("an unimplemented real provider refuses loudly instead of returning nothing", async () => {
  const azure = OCR_PROVIDERS.find((provider) => provider.id === "azure");
  await assert.rejects(() => azure!.run(bytes("%PDF"), { lang: "en-US" }), /uygulanmadı/);
});

test("Mistral refuses clearly when its key is missing", async () => {
  await withoutKeys(async () => {
    const mistral = OCR_PROVIDERS.find((provider) => provider.id === "mistral");
    await assert.rejects(() => mistral!.run(bytes("%PDF"), { lang: "en-US" }), /MISTRAL_API_KEY/);
  });
});

test("turns layout blocks into numbered segments", () => {
  const line = (id: string, text: string, confidence: number) => ({ id, text, confidence, ocrWarning: null });
  const segments = ocrToSegments({
    provider: "mistral",
    demo: false,
    pages: 2,
    warning: null,
    blocks: [
      { kind: "paragraph", role: "title", page: 1, lines: [line("o1", "Başlık", 0.9)] },
      { kind: "table", page: 2, rows: [[{ colspan: 1, lines: [line("o2", "Hücre", 0.4)] }]] },
    ],
  });
  assert.deepEqual(segments.map((segment) => [segment.id, segment.kind, segment.order, segment.page]), [
    ["o1", "paragraph", 1, 1],
    ["o2", "table-cell", 2, 2],
  ]);
  assert.equal(segments[1].confidence, 0.4);
});
