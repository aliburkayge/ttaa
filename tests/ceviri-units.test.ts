import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryPair, neighbours, sentenceUnits, splitAcross } from "../lib/ceviri/units.ts";

const line = (id: string, text: string, block: number | null = 7, extra: Record<string, unknown> = {}) => ({
  id,
  text,
  kind: "paragraph",
  page: 1,
  block,
  ...extra,
});

// DELAN SC garanti mektubu: OCR paragrafı beş satıra böldü, cümle tek.
const letter = [
  line("o14", "We, BASF AGRO B.V. Arnhem (NL) Freienbach Branch, having its principle place of business at 8088 Pfaffikon,"),
  line("o15", "SWITZERLAND do hereby guarantee that our brand name product DELAN SC containing 500 g/l Dithianon,"),
  line("o16", "SC will be manufactured at BASF Agri-Production S.A.S's production plant located at Z.I. Lyon Nord, Rue"),
  line("o17", "Jacquard 69727 Genay, France in accordance with the common recipe and product specifications which are"),
  line("o18", "identical to those filed with the Ministry of Agriculture Forestry in Turkey for the registration of DELAN SC."),
];

test("wrapped prose lines of one paragraph form one sentence", () => {
  const units = sentenceUnits(letter);
  assert.deepEqual(units.map((unit) => unit.map((segment) => segment.id)), [["o14", "o15", "o16", "o17", "o18"]]);
});

test("a sentence ends at its full stop; the next one starts a new unit", () => {
  const units = sentenceUnits([
    line("a", "We hereby confirm that the specification and the secret receipe for this product have not changed since"),
    line("b", "that were last submitted, and will continue to be in line with the specification hereby submitted."),
    line("c", "This authorization is valid for 10 years from the date of signature of this letter by both parties"),
    line("d", "and may be renewed."),
  ]);
  assert.deepEqual(units.map((unit) => unit.map((segment) => segment.id)), [["a", "b"], ["c", "d"]]);
});

test("short lines of a block stay apart: name, title and e-mail are not one sentence", () => {
  const units = sentenceUnits([line("n", "Dirk Schmitz"), line("t", "Head of Product Supply"), line("e", "dirk.schmitz@basf.com")]);
  assert.equal(units.length, 3);
});

test("list items, other blocks, table cells, marks and old documents are never joined", () => {
  const long = "Notification to and Confirmation from the US EPA of the change of the product name and the registrant";
  const cases = [
    [line("a", long), line("b", `- ${long}`)],
    [line("a", long), line("b", long, 8)],
    [line("a", long, 7, { kind: "table-cell" }), line("b", long, 7, { kind: "table-cell" })],
    [line("a", long), line("b", long, 7, { mark: "stamp" })],
    [line("a", long, null), line("b", long, null)],
    [line("a", long), line("b", long, 7, { page: 2 })],
  ];
  for (const segments of cases) assert.equal(sentenceUnits(segments).length, 2, JSON.stringify(segments.map((s) => s.id)));
});

test("the translation is spread over the lines in proportion to the source, at word boundaries", () => {
  const sources = ["aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa", "bbbb bbbb bbbb bbbb"];
  const pieces = splitAcross("bir iki üç dört beş altı yedi sekiz dokuz on on bir", sources);
  assert.ok(pieces);
  assert.equal(pieces.length, 2);
  assert.equal(pieces.join(" "), "bir iki üç dört beş altı yedi sekiz dokuz on on bir");
  // İlk satır kaynağın ~2/3'ü: çevirinin de yaklaşık 2/3'ü.
  const share = pieces[0].length / (pieces[0].length + pieces[1].length);
  assert.ok(share > 0.55 && share < 0.78, `${share}`);
});

test("a number stays with its unit when the line break falls between them", () => {
  // Kaynağın payına göre en yakın kırılma tam "500"ün arkası.
  const pieces = splitAcross("içeren 500 g/l Dithianonlu ürünümüzün", ["x".repeat(11), "x".repeat(27)]);
  assert.ok(pieces);
  assert.ok(!pieces[0].endsWith("500"), pieces.join(" | "));
  assert.equal(pieces.join(" "), "içeren 500 g/l Dithianonlu ürünümüzün");
});

test("a word both languages keep (name, code) pins the line break", () => {
  // "İsviçre" "Switzerland"dan kısa: orantılı bölme "SZ,"yi alt satıra itiyordu.
  const pieces = splitAcross("BASF Agro B.V. Arnhem (NL) Freienbach Branch, 8808 Pfäffikon SZ, İsviçre", [
    "BASF Agro B.V. Arnhem (NL) Freienbach Branch, 8808 Pfäffikon SZ,",
    "Switzerland",
  ]);
  assert.deepEqual(pieces, ["BASF Agro B.V. Arnhem (NL) Freienbach Branch, 8808 Pfäffikon SZ,", "İsviçre"]);
});

test("no line is left empty: too few words for the lines means no split", () => {
  assert.equal(splitAcross("Evet.", ["Yes it is", "so."]), null);
  assert.deepEqual(splitAcross("Tek satır", ["One line"]), ["Tek satır"]);
});

test("a corrected line goes to memory as the whole sentence", () => {
  const segments = [
    { id: "a", text: "We confirm that the", translation: "Ürünün değişmediğini", unit: "a" },
    { id: "b", text: "product has not changed.", translation: "teyit ederiz.", unit: "a" },
    { id: "c", text: "Page 1/2", translation: "Sayfa 1/2" },
  ];
  assert.deepEqual(memoryPair(segments, "b", "onaylarız."), {
    source: "We confirm that the product has not changed.",
    target: "Ürünün değişmediğini onaylarız.",
  });
  assert.deepEqual(memoryPair(segments, "c", "Sayfa 1 / 2"), { source: "Page 1/2", target: "Sayfa 1 / 2" });
});

test("neighbours give the text around a unit, nearest last before and first after", () => {
  const units = [[line("a", "one")], [line("b", "two")], [line("c", "three"), line("d", "four")], [line("e", "five")]];
  assert.deepEqual(neighbours(units, 2), { before: ["one", "two"], after: ["five"] });
  assert.deepEqual(neighbours(units, 0), { before: [], after: ["two", "three four"] });
});
