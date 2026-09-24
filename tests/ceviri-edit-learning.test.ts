import assert from "node:assert/strict";
import test from "node:test";
import { diffWords, observeEdits, replacedSpans, termForm, termKey } from "../lib/ceviri/edit-learning.ts";

test("word diff keeps the common words and marks the rest", () => {
  const ops = diffWords("Tescil sahibi BASF'tir.", "Ruhsat sahibi BASF'tir.");
  assert.deepEqual(
    ops.map((o) => o.op),
    ["del", "ins", "same", "same"],
  );
});

test("replaced spans pair deletions with the insertions that follow them", () => {
  assert.deepEqual(replacedSpans("Ürünün tescil numarası 123", "Ürünün ruhsat numarası 123"), [{ from: "tescil", to: "ruhsat" }]);
  assert.deepEqual(replacedSpans("A B C", "A B C D"), [], "pure insertion is not a replacement");
});

test("a required term the reviewer replaced becomes an observation", () => {
  const observations = observeEdits({
    source: "The registration holder is BASF.",
    before: "Tescil sahibi BASF'tir.",
    after: "Ruhsat sahibi BASF'tir.",
    terms: [{ sourceText: "registration", targetText: "tescil" }],
    lang: "tr-TR",
  });
  assert.deepEqual(observations, [{ sourceTerm: "registration", from: "tescil", to: "Ruhsat" }]);
});

test("the inflected form of the term still counts; unrelated edits do not", () => {
  assert.deepEqual(
    observeEdits({
      source: "Renew the registration.",
      before: "Tescili yenileyin.",
      after: "Ruhsatı yenileyin.",
      terms: [{ sourceText: "registration", targetText: "tescil" }],
      lang: "tr-TR",
    }),
    [{ sourceTerm: "registration", from: "tescil", to: "Ruhsatı" }],
  );
  assert.deepEqual(
    observeEdits({
      source: "Keep dry.",
      before: "Kuru tutun.",
      after: "Kuru yerde tutun.",
      terms: [{ sourceText: "registration", targetText: "tescil" }],
      lang: "tr-TR",
    }),
    [],
  );
});

test("a term whose source is not in the sentence is not blamed for the edit", () => {
  assert.deepEqual(
    observeEdits({
      source: "The holder is BASF.",
      before: "Tescil sahibi BASF'tir.",
      after: "Ruhsat sahibi BASF'tir.",
      terms: [{ sourceText: "registration", targetText: "tescil" }],
      lang: "tr-TR",
    }),
    [],
  );
});

test("inflected corrections of the same word collect under one key, shown in dictionary case", () => {
  assert.equal(termKey("Ruhsatı", "tr-TR"), termKey("ruhsat", "tr-TR"));
  assert.equal(termKey("sıcaklığını", "tr-TR"), termKey("Sıcaklık", "tr-TR"));
  assert.notEqual(termKey("ruhsat", "tr-TR"), termKey("tescil", "tr-TR"));
  assert.equal(termForm("Ruhsatı", "tr-TR"), "ruhsatı");
  assert.equal(termForm("CIPAC safiyeti", "tr-TR"), "CIPAC safiyeti");
  assert.equal(termForm("pH değeri,", "tr-TR"), "pH değeri");
});
