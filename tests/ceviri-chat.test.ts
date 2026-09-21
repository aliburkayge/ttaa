import assert from "node:assert/strict";
import test from "node:test";
import { buildChatPrompt, parseChatDecision, type DocumentContext } from "../lib/ceviri/chat.ts";

function context(overrides: Partial<DocumentContext> = {}): DocumentContext {
  return {
    engines: [
      { id: "openai", label: "OpenAI", on: true },
      { id: "deepl", label: "DeepL", on: true },
      { id: "gemini", label: "Gemini", on: false },
    ],
    filename: "Privest-EN.docx",
    sourceLang: "en-US",
    targetLang: "tr-TR",
    instructions: null,
    segments: [
      { order: 1, text: "Trade name", translation: "Ticari ad", source: "tm-exact", warning: null },
      { order: 2, text: "BAS 216 17 F", translation: null, source: null, warning: null },
    ],
    ...overrides,
  };
}

test("puts the document's own segments in the prompt so answers are not invented", () => {
  const prompt = buildChatPrompt(context(), [], "2. segment ne durumda?");
  assert.match(prompt, /1\. "Trade name" -> "Ticari ad" \[tm-exact\]/);
  assert.match(prompt, /2\. "BAS 216 17 F" -> "\(henüz çevrilmedi\)"/);
  assert.match(prompt, /Segments: 2, translated: 1/);
});

test("tells the model exactly which engines are running", () => {
  // The user asked exactly this; an assistant that claims otherwise is lying
  // about which engine produced an official document.
  const prompt = buildChatPrompt(context(), [], "hangi motorları kullanıyorsun?");
  assert.match(prompt, /DeepL also translate the same segments in parallel/);
  assert.match(prompt, /Gemini: adapter exists but no API key/);
  assert.match(prompt, /rule-based referee/);
});

test("does not mention a referee when OpenAI is the only engine", () => {
  const prompt = buildChatPrompt(
    context({
      engines: [
        { id: "openai", label: "OpenAI", on: true },
        { id: "deepl", label: "DeepL", on: false },
        { id: "gemini", label: "Gemini", on: false },
      ],
    }),
    [],
    "?",
  );
  assert.equal(prompt.includes("referee"), false);
  assert.match(prompt, /DeepL and Gemini: adapter exists but no API key/);
});

test("carries the standing instructions already in force", () => {
  const prompt = buildChatPrompt(context({ instructions: "Başlıkları çevirme." }), [], "peki");
  assert.match(prompt, /already in force: Başlıkları çevirme\./);
});

test("truncates a long document rather than sending every segment", () => {
  const many = Array.from({ length: 200 }, (_, index) => ({
    order: index + 1,
    text: `line ${index + 1}`,
    translation: null,
    source: null,
    warning: null,
  }));
  const prompt = buildChatPrompt(context({ segments: many }), [], "özetle");
  assert.match(prompt, /ve 140 segment daha/);
  assert.equal(prompt.includes('61. "line 61"'), false);
});

test("keeps only the last turns of a long conversation", () => {
  const history = Array.from({ length: 30 }, (_, index) => ({
    role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `mesaj ${index + 1}`,
    at: "2026-09-20T00:00:00.000Z",
  }));
  const prompt = buildChatPrompt(context(), history, "devam");
  assert.match(prompt, /mesaj 30/);
  assert.equal(prompt.includes("mesaj 1\n"), false);
});

test("reads a clean JSON decision", () => {
  const decision = parseChatDecision(
    '{"reply":"Tamam.","instructions":"Resmi dil kullan.","retranslate":true}',
  );
  assert.deepEqual(decision, {
    reply: "Tamam.",
    instructions: "Resmi dil kullan.",
    retranslate: true,
  });
});

test("reads JSON the model wrapped in a code fence", () => {
  const decision = parseChatDecision('```json\n{"reply":"Olur.","instructions":null,"retranslate":false}\n```');
  assert.equal(decision.reply, "Olur.");
  assert.equal(decision.instructions, null);
});

test("treats an empty instruction string as no instruction", () => {
  const decision = parseChatDecision('{"reply":"Soru cevaplandı.","instructions":"   ","retranslate":false}');
  assert.equal(decision.instructions, null);
});

test("never silently applies an instruction when the reply is not JSON", () => {
  // A parse failure must degrade to "answered, changed nothing" — not to a
  // half-applied instruction the user cannot see.
  const decision = parseChatDecision("Bu belgede 14 segment var.");
  assert.equal(decision.reply, "Bu belgede 14 segment var.");
  assert.equal(decision.instructions, null);
  assert.equal(decision.retranslate, false);
});

test("retranslate is true only when the model says exactly true", () => {
  assert.equal(parseChatDecision('{"reply":"x","retranslate":"true"}').retranslate, false);
  assert.equal(parseChatDecision('{"reply":"x","retranslate":1}').retranslate, false);
  assert.equal(parseChatDecision('{"reply":"x","retranslate":true}').retranslate, true);
});
