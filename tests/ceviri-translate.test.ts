import assert from "node:assert/strict";
import test from "node:test";
import {
  missingProtected,
  protectedSpans,
  suspiciousTarget,
  violatedTerms,
} from "../lib/ceviri/translate.ts";
import type { TermHit } from "../lib/ceviri/term-store.ts";

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
