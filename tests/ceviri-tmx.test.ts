import assert from "node:assert/strict";
import test from "node:test";
import { parseTmxUnits, segText, TMX_MAX_UNIT_BYTES } from "../lib/ceviri/tmx.ts";

const TMX = `<?xml version="1.0" ?><tmx version="1.4"><header srclang="en-US"/><body>` +
  `<tu tuid="1" srclang="en-US">` +
  `<prop type="x-project_name">basf 11-08</prop>` +
  `<prop type="X-Lara-Engine-Translation-Origin">TM</prop>` +
  `<prop type="x-context-pre">% w/w</prop>` +
  `<prop type="x-context-post">Active Ingredient</prop>` +
  `<tuv xml:lang="en-US"><seg>Trade name</seg></tuv>` +
  `<tuv xml:lang="tr-TR"><seg>Ticari ad&#305;</seg></tuv>` +
  `</tu>` +
  `<tu tuid="2">` +
  `<tuv xml:lang="en-US"><seg>2-chloro- <g id="1">N</g>-(4'-chlorobiphenyl)</seg></tuv>` +
  `<tuv xml:lang="tr-TR"><seg>2-kloro- <g id="1">N</g>-(4'-klorobifenil)</seg></tuv>` +
  `</tu></body></tmx>`;

async function* feed(text: string, size: number) {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

async function collect(text: string, size = 7) {
  const out = [];
  for await (const unit of parseTmxUnits(feed(text, size))) out.push(unit);
  return out;
}

test("strips inline tags but keeps their text content", () => {
  assert.equal(segText(`<seg>2-chloro- <g id="1">N</g>-yl</seg>`), "2-chloro- N-yl");
});

test("decodes numeric and named XML entities", () => {
  assert.equal(segText("<seg>Ticari ad&#305; &amp; kod</seg>"), "Ticari adı & kod");
});

test("extracts both language variants with metadata", async () => {
  const units = await collect(TMX);
  assert.equal(units.length, 2);
  assert.equal(units[0].sourceLang, "en-US");
  assert.equal(units[0].targetLang, "tr-TR");
  assert.equal(units[0].sourceText, "Trade name");
  assert.equal(units[0].targetText, "Ticari adı");
  assert.equal(units[0].projectName, "basf 11-08");
  assert.equal(units[0].origin, "TM");
  assert.equal(units[0].contextPre, "% w/w");
  assert.equal(units[0].contextPost, "Active Ingredient");
});

test("falls back to the header srclang when the tu has none", async () => {
  const units = await collect(TMX);
  assert.equal(units[1].sourceLang, "en-US");
  assert.equal(units[1].sourceText, "2-chloro- N-(4'-chlorobiphenyl)");
});

test("produces identical results regardless of chunk boundaries", async () => {
  const tiny = await collect(TMX, 3);
  const huge = await collect(TMX, 100000);
  assert.deepEqual(tiny, huge);
});

test("skips units that lack two language variants", async () => {
  const broken = `<tmx><header srclang="en-US"/><body><tu><tuv xml:lang="en-US"><seg>only</seg></tuv></tu></body></tmx>`;
  assert.deepEqual(await collect(broken), []);
});

test("yields correct units despite large trailing content after the last </tu> (buffer trimming)", async () => {
  const trailing = "z".repeat(50_000);
  const units = await collect(TMX + trailing, 11);
  assert.equal(units.length, 2);
  assert.equal(units[0].sourceText, "Trade name");
  assert.equal(units[1].sourceText, "2-chloro- N-(4'-chlorobiphenyl)");
});

test("throws when a <tu> exceeds the size limit without a closing tag", async () => {
  const oversized = "x".repeat(TMX_MAX_UNIT_BYTES + 1);
  const broken =
    `<tmx><header srclang="en-US"/><body>` +
    `<tu tuid="1"><tuv xml:lang="en-US"><seg>${oversized}</seg></tuv>`;

  async function* oneChunk() {
    yield broken;
  }

  await assert.rejects(async () => {
    const iterator = parseTmxUnits(oneChunk());
    // Drain without binding a per-item variable — reaching the guard is all
    // this test needs; the rejection itself is the assertion.
    while (!(await iterator.next()).done);
  }, /exceeds 4 MB without a closing <\/tu>/);
});

test("reports a skip reason via onSkip instead of silently dropping a unit", async () => {
  const broken = `<tmx><header srclang="en-US"/><body><tu><tuv xml:lang="en-US"><seg>only</seg></tuv></tu></body></tmx>`;
  const reasons: string[] = [];
  const units = [];
  for await (const unit of parseTmxUnits(feed(broken, 5), "", { onSkip: (reason) => reasons.push(reason) })) {
    units.push(unit);
  }
  assert.deepEqual(units, []);
  assert.deepEqual(reasons, ["too-few-variants"]);
});

test("keeps a unit whose two tuv blocks are byte-identical (index-based target selection)", async () => {
  // Content equality would make these two tuvs look like "the same one" and
  // silently drop the unit; index-based exclusion keeps it.
  const doc =
    `<tmx><header srclang="en-US"/><body><tu>` +
    `<tuv xml:lang="en-US"><seg>same</seg></tuv>` +
    `<tuv xml:lang="en-US"><seg>same</seg></tuv>` +
    `</tu></body></tmx>`;
  const units = await collect(doc, 5);
  assert.equal(units.length, 1);
  assert.equal(units[0].sourceText, "same");
  assert.equal(units[0].targetText, "same");
});
