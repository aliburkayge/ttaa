import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrompt,
  keepUntranslated,
  tidyTarget,
  missingProtected,
  protectedSpans,
  suspiciousTarget,
  translateSegment,
  violatedTerms,
} from "../lib/ceviri/translate.ts";
import type { TermHit } from "../lib/ceviri/term-store.ts";
import { mergeMatches, type TmMatch } from "../lib/ceviri/tm-store.ts";

function hit(targetText: string): TermHit {
  return {
    conceptId: "c1",
    scopeType: "global",
    sourceText: "source",
    targetText,
    isForbidden: true,
    notes: null,
  };
}

test("finds registration codes that must survive translation", () => {
  const spans = protectedSpans("Delan® SC (BAS 216 17 F) formülasyonu");
  assert.ok(spans.includes("BAS 216 17 F"), `bulunanlar: ${spans.join(" | ")}`);
});

test("finds quantities with their units", () => {
  const spans = protectedSpans("500 g/l Dithianon, 0.25 L ambalaj, 127 mm çap");
  assert.ok(spans.some((s) => s.includes("500") && s.includes("g/l")));
  assert.ok(spans.some((s) => s.includes("127") && s.includes("mm")));
});

test("finds CAS numbers, emails, links and dates", () => {
  const spans = protectedSpans(
    "CAS 123-45-6 · lukas@basf.com · https://basf.com/x · 07.09.2026",
  );
  assert.ok(spans.includes("123-45-6"));
  assert.ok(spans.includes("lukas@basf.com"));
  assert.ok(spans.some((s) => s.startsWith("https://")));
  assert.ok(spans.includes("07.09.2026"));
});

test("reports nothing to protect in ordinary prose", () => {
  assert.deepEqual(protectedSpans("Bitki koruma ürününün ticari adı"), []);
});

test("flags a protected span the translation dropped", () => {
  const missing = missingProtected(
    "Active ingredient: 500 g/l Dithianon",
    "Aktif madde: Dithianon",
  );
  assert.ok(missing.some((s) => s.includes("500")));
});

test("accepts a translation that carried every protected span across", () => {
  assert.deepEqual(
    missingProtected("BAS 216 17 F, 500 g/l", "BAS 216 17 F, 500 g/l Dithianon"),
    [],
  );
});

test("catches a forbidden term regardless of its casing", () => {
  const violations = violatedTerms("Ürünün REJİSTRASYON belgesi", [hit("rejistrasyon")]);
  assert.equal(violations.length, 1);
});

test("does not report a forbidden term that never appears", () => {
  assert.deepEqual(violatedTerms("Ürünün ruhsat belgesi", [hit("rejistrasyon")]), []);
});

test("flags a memory entry whose target is only punctuation", () => {
  // The customer's own memory holds rows like "CONTROL" -> "." from headings
  // their CAT tool split across two lines. Reused blindly these delete text.
  const warning = suspiciousTarget("CONTROL", ".");
  assert.match(String(warning), /noktalama/);
});

test("flags a translation far shorter than its source", () => {
  const warning = suspiciousTarget(
    "General Directorate of Food and Control of the Ministry",
    "Genel",
  );
  assert.match(String(warning), /daha kısa/);
});

test("accepts a translation of a reasonable length", () => {
  assert.equal(
    suspiciousTarget("Trade name of the product", "Ürünün ticari adı"),
    null,
  );
});

test("does not flag a short source translated to a short target", () => {
  // A one-word heading legitimately becomes one word; only long sources are checked.
  assert.equal(suspiciousTarget("Registration", "Ruhsat"), null);
});

test("treats an empty source as nothing to judge", () => {
  assert.equal(suspiciousTarget("", ""), null);
});

test("flags a memory entry that starts with punctuation the source does not have", () => {
  // Real entry from the customer's memory: a table label's colon slid into the
  // next cell when the CAT tool split the row.
  const warning = suspiciousTarget("Suspension concentrate (SC)", ": Süspansiyon Konsantresi (SC)");
  assert.match(String(warning), /":" işaretiyle başlıyor/);
});

test("does not flag leading punctuation that is already in the source", () => {
  assert.equal(suspiciousTarget(": see annex", ": eke bakınız"), null);
  assert.equal(suspiciousTarget("Yellow", "Sarı"), null);
});

test("keepUntranslated keeps the source when only punctuation or case changed", () => {
  assert.equal(keepUntranslated("BASF", "BASF."), "BASF");
  assert.equal(
    keepUntranslated("BASF Agro B.V. Arnhem (NL) - Freienbach Branch", "BASF AGRO B.V. Arnhem (NL) Freienbach Branch"),
    "BASF Agro B.V. Arnhem (NL) - Freienbach Branch",
  );
  assert.equal(
    keepUntranslated("BASF AGRO B.V. ARNHEM (NL) FREIENBACH BRANCH", "BASF AGRO B.V. Arnhem (NL) Freienbach Branch"),
    "BASF AGRO B.V. ARNHEM (NL) FREIENBACH BRANCH",
  );
  assert.equal(keepUntranslated("Switzerland", "İsviçre"), "İsviçre");
  assert.equal(keepUntranslated("Page 1", "Sayfa 1"), "Sayfa 1");
});

test("tidyTarget drops punctuation shifted in from a split memory row", () => {
  assert.equal(tidyTarget("Suspension concentrate (SC)", ": Süspansiyon Konsantresi (SC)"), "Süspansiyon Konsantresi (SC)");
  assert.equal(tidyTarget("BASF", "BASF."), "BASF");
  assert.equal(tidyTarget(": note", ": not"), ": not");
});

test("the prompt names the company term and the general word it replaces", () => {
  const firm: TermHit = { conceptId: "f", scopeType: "client", scopeId: "basf", sourceText: "registration", targetText: "ruhsat", isForbidden: false, notes: null };
  const general: TermHit = { ...firm, conceptId: "g", scopeType: "global", scopeId: null, targetText: "tescil" };
  const prompt = buildPrompt({
    text: "The registration expires.",
    sourceLang: "en-US",
    targetLang: "tr-TR",
    terms: [firm],
    forbidden: [],
    replaced: [{ term: general, by: firm }],
    similar: [],
    instructions: null,
    firmInstructions: "Adresler çevrilmez.",
  });
  assert.match(prompt, /"registration" must become "ruhsat" \(company term — do NOT use "tescil"\)/);
  assert.match(prompt, /Company rules for this client[\s\S]*Adresler çevrilmez\./);
  assert.ok(prompt.indexOf("Company rules") < prompt.indexOf("Segment:"));
});

test("the prompt shows the surrounding text as context, marked not to be translated", () => {
  const prompt = buildPrompt({
    text: "Dithianon Pure",
    sourceLang: "en-US",
    targetLang: "tr-TR",
    terms: [],
    forbidden: [],
    replaced: [],
    similar: [],
    instructions: null,
    firmInstructions: null,
    context: { document: "DELAN SC GIZLI RECETE.pdf", before: ["No", "Chemical Name"], after: ["3347-22-6", "active ingredient"] },
  });
  const context = prompt.indexOf("do NOT translate");
  assert.ok(context > 0, prompt);
  assert.ok(context < prompt.indexOf("Segment:"));
  assert.match(prompt, /Document: DELAN SC GIZLI RECETE\.pdf/);
  assert.match(prompt, /Before the segment:\nNo\nChemical Name/);
  assert.match(prompt, /After the segment:\n3347-22-6\nactive ingredient/);
  assert.equal(prompt.trim().split("\n").at(-1), "Dithianon Pure");
});

test("without context the prompt has no context section", () => {
  const prompt = buildPrompt({
    text: "Colour",
    sourceLang: "en-US",
    targetLang: "tr-TR",
    terms: [],
    forbidden: [],
    replaced: [],
    similar: [],
    instructions: null,
    firmInstructions: null,
  });
  assert.doesNotMatch(prompt, /Before the segment|After the segment|Document:/);
});

test("an OCR image reference is not text: kept as is, no engine asked", async () => {
  // Motor sorulsaydı "Görüntüye erişemiyorum…" gibi bir cevap çeviri yerine yazılıyordu.
  const result = await translateSegment(
    { id: "s1", text: "![img-7.jpeg](img-7.jpeg)" },
    { sourceLang: "en-US", targetLang: "tr-TR", model: "unused" },
  );
  assert.equal(result.translation, "![img-7.jpeg](img-7.jpeg)");
  assert.equal(result.source, "rule");
});

test("memory matches merge by adjusted score, falling back to the raw score", () => {
  const row = (id: string, score: number, adjusted?: number): TmMatch => ({ id, source_text: id, target_text: id, score, adjusted, origin: "tmx-import", quality: "draft", project_names: [] });
  const merged = mergeMatches([[row("stranger", 1, 1)], [row("own", 0.95, 1.01)], [row("plain", 0.97)]], 3);
  assert.deepEqual(merged.map((m) => m.id), ["own", "stranger", "plain"]);
});
