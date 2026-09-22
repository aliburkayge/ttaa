import assert from "node:assert/strict";
import test from "node:test";
import { LANGUAGES, languageLabel, languagePrompt, memoryLangs } from "../lib/ceviri/languages.ts";
import { deeplLang } from "../lib/ceviri/engines.ts";

test("offers every widely used English variant with its own flag", () => {
  const english = LANGUAGES.filter((lang) => lang.code.startsWith("en-")).map((lang) => lang.code);
  assert.deepEqual(english, ["en-US", "en-GB", "en-AU", "en-CA", "en-IE", "en-NZ", "en-ZA", "en-IN"]);
  for (const lang of LANGUAGES) assert.match(lang.flag, /^[a-z]{2}$/);
});

test("keeps the languages that were already offered", () => {
  const codes = LANGUAGES.map((lang) => lang.code);
  for (const code of ["tr-TR", "de-DE", "ru-RU", "es-ES", "it-IT", "el-GR", "pl-PL"]) {
    assert.ok(codes.includes(code), code);
  }
});

test("codes are unique", () => {
  const codes = LANGUAGES.map((lang) => lang.code);
  assert.equal(new Set(codes).size, codes.length);
});

test("English variants share the translation memory", () => {
  assert.deepEqual(memoryLangs("en-AU"), ["en-AU", "en-US", "en-GB"]);
  assert.deepEqual(memoryLangs("en-US"), ["en-US", "en-GB"]);
  assert.deepEqual(memoryLangs("en-GB"), ["en-GB", "en-US"]);
});

test("other languages look only at their own memory", () => {
  assert.deepEqual(memoryLangs("tr-TR"), ["tr-TR"]);
  assert.deepEqual(memoryLangs("de-DE"), ["de-DE"]);
});

test("the engine prompt names the exact variant", () => {
  assert.equal(languagePrompt("en-AU"), "English (Australia, en-AU)");
  assert.equal(languagePrompt("tr-TR"), "Turkish (tr-TR)");
  assert.equal(languagePrompt("xx-YY"), "xx-YY");
});

test("the interface shows a short Turkish label", () => {
  assert.equal(languageLabel("en-GB"), "İngilizce · Birleşik Krallık");
  assert.equal(languageLabel("de-DE"), "Almanca");
  assert.equal(languageLabel("xx-YY"), "xx-YY");
});

test("DeepL gets British English for Commonwealth variants and American for Canada", () => {
  for (const code of ["en-GB", "en-AU", "en-IE", "en-NZ", "en-ZA", "en-IN"]) {
    assert.equal(deeplLang(code, "target"), "EN-GB", code);
  }
  assert.equal(deeplLang("en-CA", "target"), "EN-US");
  assert.equal(deeplLang("en-US", "target"), "EN-US");
  assert.equal(deeplLang("en-AU", "source"), "EN");
});
