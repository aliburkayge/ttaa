import assert from "node:assert/strict";
import test from "node:test";
import { arbitrate, configuredEngines, DEEPL_ENGINE, GEMINI_ENGINE } from "../lib/ceviri/engines.ts";
import type { EngineCandidate } from "../lib/ceviri/engines.ts";
import type { TermHit } from "../lib/ceviri/term-store.ts";

function candidate(engine: string, text: string, error: string | null = null): EngineCandidate {
  return { engine, text, error };
}

function forbid(targetText: string): TermHit {
  return {
    conceptId: `c-${targetText}`,
    scopeType: "global",
    sourceText: "registration",
    targetText,
    isForbidden: true,
    notes: null,
  };
}

test("reports no configured engines while DeepL and Gemini have no keys", () => {
  assert.equal(DEEPL_ENGINE.configured, false);
  assert.equal(GEMINI_ENGINE.configured, false);
  assert.deepEqual(configuredEngines(), []);
});

test("an unimplemented engine refuses loudly rather than returning empty text", async () => {
  await assert.rejects(
    () => DEEPL_ENGINE.translate("x", {
      sourceLang: "en-US", targetLang: "tr-TR", terms: [], forbidden: [], similar: [],
    }),
    /uygulanmadı/,
  );
});

test("drops a candidate that uses a forbidden term before comparing anything", () => {
  const verdict = arbitrate(
    "registration",
    [candidate("a", "rejistrasyon belgesi"), candidate("b", "ruhsat belgesi")],
    [forbid("rejistrasyon")],
  );
  assert.equal(verdict.chosen?.engine, "b");
  assert.equal(verdict.rejected.length, 1);
  assert.match(verdict.rejected[0].reason, /yasaklı terim/);
});

test("drops a candidate that lost a protected span from the source", () => {
  const verdict = arbitrate(
    "Active ingredient 500 g/l Dithianon",
    [candidate("a", "Aktif madde Dithianon"), candidate("b", "Aktif madde 500 g/l Dithianon")],
    [],
  );
  assert.equal(verdict.chosen?.engine, "b");
  assert.match(verdict.rejected[0].reason, /korunan ifade kayıp/);
});

test("drops a candidate whose engine call failed", () => {
  const verdict = arbitrate(
    "hello",
    [candidate("a", "", "HTTP 500"), candidate("b", "merhaba")],
    [],
  );
  assert.equal(verdict.chosen?.engine, "b");
  assert.equal(verdict.rejected[0].reason, "HTTP 500");
});

test("prefers the text the most engines agreed on", () => {
  const verdict = arbitrate(
    "trade name",
    [candidate("a", "ticari ad"), candidate("b", "ticari isim"), candidate("c", "ticari ad")],
    [],
  );
  assert.equal(verdict.chosen?.text, "ticari ad");
  assert.match(verdict.reason, /2 motor aynı metinde uzlaştı/);
});

test("asks for a human when several engines each said something different", () => {
  const verdict = arbitrate(
    "trade name",
    [candidate("a", "ticari ad"), candidate("b", "ticari isim")],
    [],
  );
  assert.equal(verdict.needsHuman, true);
});

test("does not ask for a human when only one engine ran", () => {
  // Disagreement is only meaningful with two or more engines; a single engine
  // never "disagrees" with itself, so today's one-engine setup stays quiet.
  const verdict = arbitrate("trade name", [candidate("openai", "ticari ad")], []);
  assert.equal(verdict.needsHuman, false);
  assert.match(verdict.reason, /tek geçerli aday/);
});

test("asks for a human when every candidate broke a rule", () => {
  const verdict = arbitrate(
    "registration",
    [candidate("a", "rejistrasyon"), candidate("b", "rejistrasyon işlemi")],
    [forbid("rejistrasyon")],
  );
  assert.equal(verdict.chosen, null);
  assert.equal(verdict.needsHuman, true);
  assert.equal(verdict.rejected.length, 2);
});

test("records why the winner won, for the audit trail", () => {
  const verdict = arbitrate(
    "BAS 216 17 F formulation",
    [candidate("a", "BAS 216 17 F formülasyonu"), candidate("b", "formülasyon")],
    [],
  );
  assert.match(verdict.reason, /korunan ifade doğrulandı/);
  assert.match(verdict.reason, /1 aday elendi/);
});
