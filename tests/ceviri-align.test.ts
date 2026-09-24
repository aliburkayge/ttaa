import assert from "node:assert/strict";
import test from "node:test";
import { align, alignedPairs, anchors, lengthCost } from "../lib/ceviri/align.ts";

test("anchors are numbers, codes, e-mails and links; decimal marks are unified", () => {
  const found = anchors("Dose 1,5 L/ha of BAS 703 07 F, see info@basf.com and https://basf.com/tr");
  assert.ok(found.includes("1.5"));
  assert.ok(found.includes("BAS70307F"));
  assert.ok(found.includes("info@basf.com"));
  assert.ok(found.includes("https://basf.com/tr"));
  assert.deepEqual(anchors("1,5 kg"), anchors("1.5 kg"));
});

test("similar lengths are cheap, very different lengths are expensive", () => {
  assert.ok(lengthCost(100, 110, 1.1, 6.8) < lengthCost(100, 300, 1.1, 6.8));
});

test("parallel paragraphs align one to one with high confidence", () => {
  const source = ["Trade name of the product", "Active ingredient: 250 g/L azoxystrobin", "Store below 30 °C in the original container."];
  const target = ["Ürünün ticari adı", "Etken madde: 250 g/L azoksistrobin", "Orijinal ambalajında 30 °C altında saklayın."];
  const beads = align(source, target);
  assert.deepEqual(
    beads.map((b) => [b.source, b.target]),
    [
      [[0], [0]],
      [[1], [1]],
      [[2], [2]],
    ],
  );
  assert.ok(beads.every((b) => b.confidence !== "low"));
});

test("two source sentences joined into one translation become a 2-1 bead", () => {
  const source = [
    "Registration number 12345.",
    "The product is stable.",
    "It must be stored in a cool and dry place away from children.",
    "Signed 14 July 2025.",
  ];
  const target = [
    "Ruhsat numarası 12345.",
    "Ürün kararlıdır ve çocuklardan uzakta, serin ve kuru bir yerde saklanmalıdır.",
    "İmza 14 Temmuz 2025.",
  ];
  const beads = align(source, target);
  const joined = beads.find((b) => b.source.join() === "1,2" && b.target.join() === "1");
  assert.ok(joined, JSON.stringify(beads));
  assert.equal(joined.confidence, "medium", "a merge is never accepted without verification");
});

test("a line added in the translation never reaches the memory unverified", () => {
  const source = ["Dose: 250 g/ha", "Store below 30 °C", "Keep away from children"];
  const target = ["Doz: 250 g/ha", "Çeviri notu", "30 °C altında saklayın", "Çocuklardan uzak tutun"];
  const pairs = alignedPairs(align(source, target), source, target);
  const trusted = pairs.filter((p) => p.confidence === "high");
  assert.equal(trusted.some((p) => p.target.includes("Çeviri notu")), false);
  assert.deepEqual(
    trusted.map((p) => [p.source, p.target]),
    [
      ["Store below 30 °C", "30 °C altında saklayın"],
      ["Keep away from children", "Çocuklardan uzak tutun"],
    ],
  );
});
