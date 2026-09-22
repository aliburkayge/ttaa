import assert from "node:assert/strict";
import test from "node:test";
import { isMark, markLabels, markNote, markText } from "../lib/ceviri/marks.ts";

test("a Turkish translation says [İMZA] and [MÜHÜR]", () => {
  assert.deepEqual(markText("signature", "tr-TR", []), ["[İMZA]"]);
  assert.deepEqual(markText("stamp", "tr-TR", []), ["[MÜHÜR]"]);
});

test("the stamp's own text goes inside the bracket", () => {
  assert.deepEqual(markText("stamp", "tr-TR", ["BASF SE", "Ludwigshafen,"]), ["[MÜHÜR: BASF SE, Ludwigshafen]"]);
});

test("printed name and title under a signature stay as their own lines", () => {
  assert.deepEqual(markText("signature", "tr-TR", ["Dirk Schmitz", " Müdür "]), ["[İMZA]", "Dirk Schmitz", "Müdür"]);
});

test("a signature on top of a stamp gets both labels, printed lines below", () => {
  assert.deepEqual(markText("signature_stamp", "tr-TR", ["Dirk Schmitz", ""]), ["[İMZA] [MÜHÜR]", "Dirk Schmitz"]);
});

test("the label follows the target language", () => {
  const cases: Array<[string, string, string]> = [
    ["en-GB", "SIGNATURE", "SEAL"],
    ["de-DE", "UNTERSCHRIFT", "STEMPEL"],
    ["ru-RU", "ПОДПИСЬ", "ПЕЧАТЬ"],
    ["es-ES", "FIRMA", "SELLO"],
    ["it-IT", "FIRMA", "TIMBRO"],
    ["el-GR", "ΥΠΟΓΡΑΦΗ", "ΣΦΡΑΓΙΔΑ"],
    ["pl-PL", "PODPIS", "PIECZĘĆ"],
  ];
  for (const [lang, signature, stamp] of cases) assert.deepEqual(markLabels(lang), { signature, stamp }, lang);
});

test("an unlisted target language falls back to English", () => {
  assert.deepEqual(markText("stamp", "ja-JP", []), ["[SEAL]"]);
});

test("only signatures and stamps are marks", () => {
  for (const kind of ["signature", "stamp", "signature_stamp"] as const) assert.equal(isMark(kind), true);
  for (const kind of ["logo", "photo", "barcode", "unknown"] as const) assert.equal(isMark(kind), false);
});

test("the review note names the label the output will carry", () => {
  assert.match(markNote("stamp", "tr-TR"), /\[MÜHÜR: …\]/);
  assert.match(markNote("signature", "en-US"), /\[SIGNATURE\]/);
});
