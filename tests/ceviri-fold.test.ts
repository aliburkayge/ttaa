import assert from "node:assert/strict";
import test from "node:test";
import { countCase, fold, isProper, tokensOf } from "../lib/ceviri/fold.ts";

test("folds Turkish capitals onto the lower-case word", () => {
  assert.equal(fold("GEREKLİLİK"), fold("gereklilik"));
  assert.equal(fold("DEPOLANMASI"), fold("depolanması"));
  assert.equal(fold("İzmir"), "izmir");
});

test("collects words and product codes", () => {
  const tokens = tokensOf("Product BAS 703 07 F and A20570A, see RP-0420.");
  assert.ok(tokens.includes("bas 703 07 f"));
  assert.ok(tokens.includes("a20570a"));
  assert.ok(tokens.includes("rp-0420"));
  assert.ok(tokens.includes("product"));
  assert.equal(tokens.includes("and"), false, "words shorter than four letters are skipped");
});

test("a product name is proper, an everyday word is not", () => {
  const counts = countCase([
    "We apply Touchdown here.",
    "Always use Touchdown carefully.",
    "The workplace is safe.",
    "A clean workplace matters.",
    "WORKPLACE RULES",
  ]);
  assert.equal(isProper("touchdown", counts), true);
  assert.equal(isProper("workplace", counts), false);
  assert.equal(isProper("bas 703 07 f", counts), true, "codes are always proper");
});

test("a product name after a short word is still mid-sentence", () => {
  // "The" dört harften kısa olduğu için kelime listesine girmez; "Revysol" yine de cümle başı değildir.
  const counts = countCase(["The Revysol label is stable.", "We apply Revysol.", "Revysol works. Then Revysol dries."]);
  assert.equal(isProper("revysol", counts), true, `${counts.proper.get("revysol")}/${counts.all.get("revysol")}`);
});
