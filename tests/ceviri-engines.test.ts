import assert from "node:assert/strict";
import test from "node:test";
import {
  arbitrate,
  configuredEngines,
  DEEPL_ENGINE,
  deeplEndpoint,
  deeplRequest,
  deeplLang,
  engineStatus,
  GEMINI_ENGINE,
} from "../lib/ceviri/engines.ts";
import type { EngineCandidate } from "../lib/ceviri/engines.ts";
import type { TermHit } from "../lib/ceviri/term-store.ts";

function candidate(engine: string, text: string, error: string | null = null): EngineCandidate {
  return { engine, text, error };
}

function withEnv(values: Record<string, string | undefined>, body: () => void) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    body();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function term(targetText: string): TermHit {
  return {
    conceptId: `t-${targetText}`,
    scopeType: "global",
    sourceText: targetText,
    targetText,
    isForbidden: false,
    notes: null,
  };
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

test("reports no configured engines when no keys are set", () => {
  withEnv({ DEEPL_API_KEY: undefined, GEMINI_API_KEY: undefined }, () => {
    assert.equal(DEEPL_ENGINE.configured, false);
    assert.equal(GEMINI_ENGINE.configured, false);
    assert.deepEqual(configuredEngines(), []);
  });
});

test("picks up a key added after the module loaded", () => {
  // configured is a getter, so adding a key to .env.local needs only a
  // restart, never a code change.
  withEnv({ DEEPL_API_KEY: "abc:fx", GEMINI_API_KEY: undefined }, () => {
    assert.deepEqual(configuredEngines().map((engine) => engine.id), ["deepl"]);
  });
});

test("reports engine status without exposing any key", () => {
  withEnv({ OPENAI_API_KEY: "sk-secret", DEEPL_API_KEY: "secret:fx", GEMINI_API_KEY: undefined }, () => {
    const status = engineStatus();
    assert.deepEqual(status.map((engine) => [engine.id, engine.on]), [
      ["openai", true],
      ["deepl", true],
      ["gemini", false],
    ]);
    assert.equal(JSON.stringify(status).includes("secret"), false);
  });
});

test("an unimplemented engine refuses loudly rather than returning empty text", async () => {
  await assert.rejects(
    () => GEMINI_ENGINE.translate("x", {
      sourceLang: "en-US", targetLang: "tr-TR", terms: [], forbidden: [], similar: [],
    }),
    /uygulanmadı/,
  );
});

test("DeepL refuses clearly when its key is missing", async () => {
  const saved = process.env.DEEPL_API_KEY;
  delete process.env.DEEPL_API_KEY;
  try {
    await assert.rejects(
      () => DEEPL_ENGINE.translate("x", {
        sourceLang: "en-US", targetLang: "tr-TR", terms: [], forbidden: [], similar: [],
      }),
      /DEEPL_API_KEY/,
    );
  } finally {
    if (saved !== undefined) process.env.DEEPL_API_KEY = saved;
  }
});

test("maps language tags to DeepL's codes", () => {
  assert.equal(deeplLang("en-US", "source"), "EN");
  assert.equal(deeplLang("en-US", "target"), "EN-US");
  assert.equal(deeplLang("en-GB", "target"), "EN-GB");
  assert.equal(deeplLang("tr-TR", "target"), "TR");
  assert.equal(deeplLang("el-GR", "target"), "EL");
  assert.equal(deeplLang("pt-PT", "target"), "PT-PT");
  assert.equal(deeplLang("pt", "target"), "PT-BR");
});

test("sends a free-plan key to the free endpoint", () => {
  assert.equal(deeplEndpoint("0000:fx"), "https://api-free.deepl.com/v2/translate");
  assert.equal(deeplEndpoint("0000"), "https://api.deepl.com/v2/translate");
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

test("does not flag every wording difference for a human", () => {
  // Two engines almost never produce identical text. Escalating on mere
  // disagreement would flag nearly every segment and make the flag worthless.
  const verdict = arbitrate(
    "trade name",
    [candidate("openai", "ticari ad"), candidate("deepl", "ticari isim")],
    [],
  );
  assert.equal(verdict.needsHuman, false);
  assert.equal(verdict.chosen?.engine, "openai");
  assert.match(verdict.reason, /öncelikli motor/);
  assert.deepEqual(verdict.alternatives.map((c) => c.text), ["ticari isim"]);
});

test("prefers the candidate that uses more of the required terms", () => {
  const verdict = arbitrate(
    "trade name of the plant protection product",
    [
      candidate("openai", "bitki koruma ürününün ticari ismi"),
      candidate("deepl", "bitki koruma ürününün ticari adı"),
    ],
    [],
    [term("ticari ad"), term("bitki koruma ürünü")],
  );
  assert.equal(verdict.chosen?.engine, "deepl");
  assert.match(verdict.reason, /2 zorunlu terimden 2 tanesini/);
});

test("counts a term even when Turkish suffixes follow it", () => {
  const verdict = arbitrate(
    "trade name",
    [candidate("openai", "ticari unvan"), candidate("deepl", "ticari adı")],
    [],
    [term("ticari ad")],
  );
  assert.equal(verdict.chosen?.engine, "deepl");
});

test("agreement still outranks term count", () => {
  const verdict = arbitrate(
    "trade name",
    [candidate("openai", "ticari isim"), candidate("deepl", "ticari isim"), candidate("gemini", "ticari ad")],
    [],
    [term("ticari ad")],
  );
  assert.equal(verdict.chosen?.text, "ticari isim");
});

test("a forbidden term loses even if it matches more required terms", () => {
  const verdict = arbitrate(
    "trade name",
    [candidate("openai", "ticari ad, geleneksel adı"), candidate("deepl", "ticari isim")],
    [forbid("geleneksel adı")],
    [term("ticari ad")],
  );
  assert.equal(verdict.chosen?.engine, "deepl");
  assert.equal(verdict.alternatives.length, 0);
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

test("DeepL gets the surrounding text as context, which it neither translates nor bills", () => {
  const body = deeplRequest("Dithianon Pure", {
    sourceLang: "en-US",
    targetLang: "tr-TR",
    terms: [],
    forbidden: [],
    similar: [],
    context: "Chemical Name\n3347-22-6",
  });
  assert.equal(body.context, "Chemical Name\n3347-22-6");
  assert.deepEqual(body.text, ["Dithianon Pure"]);
  assert.equal("context" in deeplRequest("x", { sourceLang: "en", targetLang: "tr", terms: [], forbidden: [], similar: [] }), false);
});
