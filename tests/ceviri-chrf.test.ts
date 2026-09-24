import { test } from "node:test";
import assert from "node:assert/strict";
import { chrf, chrfStats, chrfScore } from "../lib/ceviri/chrf.ts";

test("identical text scores 100, disjoint text 0", () => {
  assert.equal(chrf("Ambalaj ağırlığı", "Ambalaj ağırlığı"), 100);
  assert.equal(chrf("xyz", "abc"), 0);
});

test("averages the F2 of every character order both sides have", () => {
  // Tekli: 2/3 · 2/3; ikili: 1/2 · 1/2; üçlü: 0. 4-6 hiçbir tarafta yok.
  assert.equal(chrf("abc", "abd").toFixed(2), "38.89");
});

test("whitespace does not count", () => {
  assert.equal(chrf("a b c", "abc"), 100);
});

test("recall weighs more than precision (beta 2)", () => {
  // Eksik çeviri, fazlalıktan daha çok puan kaybettirir.
  assert.ok(chrf("abcd", "abcdefgh") < chrf("abcdefgh", "abcd"));
});

test("corpus score sums the statistics of all pairs", () => {
  const stats = chrfStats("abc", "abd");
  const again = chrfStats("abc", "abc");
  const sum = stats.map((value, index) => value + again[index]);
  assert.ok(chrfScore(sum) > chrf("abc", "abd"));
  assert.ok(chrfScore(sum) < 100);
});
