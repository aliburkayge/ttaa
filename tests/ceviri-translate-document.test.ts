import { test } from "node:test";
import assert from "node:assert/strict";
import { translatePending } from "../lib/ceviri/translate-document.ts";
import type { TranslatedSegment, TranslationContext } from "../lib/ceviri/translate.ts";

type Call = { id: string; text: string; context: TranslationContext | null | undefined };

/** Motor yerine: çağrıları kaydeder, çeviri olarak verilen sözlükten ya da "TR(<metin>)" döner. */
function fakeEngine(answers: Record<string, string> = {}) {
  const calls: Call[] = [];
  const translate = async (segment: { id: string; text: string }, options: { context?: TranslationContext | null }): Promise<TranslatedSegment> => {
    calls.push({ id: segment.id, text: segment.text, context: options.context });
    return {
      id: segment.id,
      text: segment.text,
      translation: answers[segment.text] ?? `TR(${segment.text})`,
      source: "engine",
      score: null,
      terms: [],
      forbidden: [],
      engine: "openai",
      alternatives: [{ engine: "deepl", text: `DL ${answers[segment.text] ?? segment.text}` }],
      note: "hakem notu",
      warning: null,
    };
  };
  return { calls, translate };
}

const base = { sourceLang: "en-US", targetLang: "tr-TR", model: "m", document: "DELAN SC GARANTI MEKTUBU-EN.pdf" };
const seg = (id: string, text: string, block: number, translation: string | null = null) => ({ id, text, kind: "paragraph", page: 1, block, translation });

const L1 = "We hereby confirm that the specification and the secret receipe for this product have not changed since";
const L2 = "that were last submitted and will continue to be in line with the specification hereby submitted.";
const SENTENCE_TR = "Bu ürünün spesifikasyonunun ve gizli reçetesinin en son sunulanlardan bu yana değişmediğini ve burada sunulan spesifikasyona uygun olmaya devam edeceğini teyit ederiz.";

test("a sentence broken over lines is translated once, whole, and spread back over its lines", async () => {
  const engine = fakeEngine({ [`${L1} ${L2}`]: SENTENCE_TR });
  const segments = [seg("t", "LETTER OF GUARANTEE", 0), seg("a", L1, 1), seg("b", L2, 1)];
  const results = await translatePending(segments, { ...base, limit: 12, translate: engine.translate });

  assert.deepEqual(engine.calls.map((call) => call.text), ["LETTER OF GUARANTEE", `${L1} ${L2}`]);
  const [a, b] = [results.find((r) => r.id === "a")!, results.find((r) => r.id === "b")!];
  assert.equal(`${a.translation} ${b.translation}`, SENTENCE_TR);
  assert.ok(a.translation.length > 20 && b.translation.length > 20);
  assert.equal(a.unit, "a");
  assert.equal(b.unit, "a");
  assert.equal(b.text, L2);
  assert.match(String(a.note), /2 satır tek cümle/);
  // Seçilmeyen motorun metni de satırlara bölünür: inceleyen seçerse satır yerinde kalır.
  assert.equal(`${a.alternatives![0].text} ${b.alternatives![0].text}`, `DL ${SENTENCE_TR}`);
  assert.equal(results.find((r) => r.id === "t")!.unit, null);
});

test("every unit sees the document name and the text around it", async () => {
  const engine = fakeEngine();
  const segments = [seg("a", "Trade Name", 0), seg("b", "Dithianon Pure", 1), seg("c", "3347-22-6", 2), seg("d", "active ingredient", 3)];
  await translatePending(segments, { ...base, limit: 12, translate: engine.translate });
  const pure = engine.calls.find((call) => call.text === "Dithianon Pure")!;
  assert.deepEqual(pure.context, { document: base.document, before: ["Trade Name"], after: ["3347-22-6", "active ingredient"] });
});

test("a batch stops near the limit but never cuts a sentence in two", async () => {
  const engine = fakeEngine();
  const segments = [seg("x", "Header", 0), seg("a", L1, 1), seg("b", L2, 1), seg("y", "Footer", 2)];
  const results = await translatePending(segments, { ...base, limit: 2, translate: engine.translate });
  assert.deepEqual(results.map((r) => r.id), ["x", "a", "b"]);
});

test("already translated lines are skipped; a half-pending sentence is translated line by line", async () => {
  const engine = fakeEngine();
  const segments = [seg("a", L1, 1, "eski çeviri"), seg("b", L2, 1), seg("c", "Page 1/2", 2, "Sayfa 1/2")];
  const results = await translatePending(segments, { ...base, limit: 12, translate: engine.translate });
  assert.deepEqual(engine.calls.map((call) => call.text), [L2]);
  assert.equal(results.length, 1);
  assert.equal(results[0].unit, null);
});

test("a translation too short to spread over the lines falls back to line by line", async () => {
  const engine = fakeEngine({ [`${L1} ${L2}`]: "Evet." });
  const results = await translatePending([seg("a", L1, 1), seg("b", L2, 1)], { ...base, limit: 12, translate: engine.translate });
  assert.deepEqual(engine.calls.map((call) => call.text), [`${L1} ${L2}`, L1, L2]);
  assert.deepEqual(results.map((r) => [r.id, r.unit]), [["a", null], ["b", null]]);
});
