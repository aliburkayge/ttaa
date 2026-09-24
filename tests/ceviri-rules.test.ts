import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { findRules, ruleAt } from "../lib/ceviri/rules.ts";

/**
 * A synthetic scan at 3 px per point: a slightly skewed signature line with a
 * blue signature over it, a table (two horizontal, two vertical rules), a row
 * of glyph-sized letters and a short blue straight tail.
 */
const PPP = 3;
const W = 900;
const H = 600;

async function raster(svgBody: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#ecebe6"/>${svgBody}</svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, rgb: new Uint8Array(data) };
}

const letters = (x0: number, y: number, count: number) =>
  Array.from({ length: count }, (_, i) => `<rect x="${x0 + i * 22}" y="${y}" width="14" height="30" fill="#141414"/>`).join("");

const PAGE = `
  <line x1="60" y1="200" x2="560" y2="206" stroke="#111" stroke-width="4"/>
  <path d="M 150 230 C 200 120, 260 280, 320 170 S 400 150, 450 215" fill="none" stroke="#2a4fc4" stroke-width="7"/>
  <line x1="600" y1="80" x2="860" y2="80" stroke="#222" stroke-width="3"/>
  <line x1="600" y1="160" x2="860" y2="160" stroke="#222" stroke-width="3"/>
  <line x1="600" y1="80" x2="600" y2="160" stroke="#222" stroke-width="3"/>
  <line x1="860" y1="80" x2="860" y2="160" stroke="#222" stroke-width="3"/>
  ${letters(60, 400, 20)}
  <line x1="620" y1="400" x2="700" y2="400" stroke="#2a4fc4" stroke-width="5"/>
`;

test("finds a skewed signature line as one rule even where a signature crosses it", async () => {
  const rules = findRules(await raster(PAGE), PPP);
  const line = rules.find((rule) => rule.orientation === "h" && ruleAt(rule, 300) > 195 && ruleAt(rule, 300) < 210);
  assert.ok(line, JSON.stringify(rules));
  assert.ok(line.start <= 64 && line.end >= 556, `spans ${line.start}–${line.end}`);
  assert.ok(Math.abs(ruleAt(line, 60) - 200) <= 1.5 && Math.abs(ruleAt(line, 560) - 206) <= 1.5, "follows the skew");
  assert.ok(line.thickness >= 3 && line.thickness <= 6, `thickness ${line.thickness}`);
  assert.ok(Math.max(...line.color) < 80, `rule colour ${line.color}`);
});

test("finds table rules in both directions", async () => {
  const rules = findRules(await raster(PAGE), PPP);
  const horizontal = rules.filter((rule) => rule.orientation === "h" && rule.start >= 595 && rule.end <= 865);
  const vertical = rules.filter((rule) => rule.orientation === "v" && rule.start >= 75 && rule.end <= 165);
  assert.equal(horizontal.length, 2, JSON.stringify(horizontal));
  assert.equal(vertical.length, 2, JSON.stringify(vertical));
});

test("letters and a short coloured signature tail are not rules", async () => {
  const rules = findRules(await raster(PAGE), PPP);
  assert.equal(
    rules.some((rule) => rule.orientation === "h" && ruleAt(rule, 300) > 390 && ruleAt(rule, 300) < 440),
    false,
    "a letter row was taken for a rule",
  );
  assert.equal(
    rules.some((rule) => rule.orientation === "h" && rule.start >= 615 && rule.end <= 705),
    false,
    "the blue tail was taken for a rule",
  );
});

test("two signature lines side by side stay two rules", async () => {
  const rules = findRules(
    await raster(`<line x1="40" y1="300" x2="400" y2="300" stroke="#111" stroke-width="3"/>
      <line x1="500" y1="300" x2="860" y2="300" stroke="#111" stroke-width="3"/>`),
    PPP,
  );
  assert.equal(rules.filter((rule) => rule.orientation === "h").length, 2, JSON.stringify(rules));
});

test("a bold capital row whose letters touch is not a rule", async () => {
  // Bold caps on a coarse raster: each letter is a full-height stroke and the
  // letters join at mid-height, so the middle rows read as one long run.
  const letters = Array.from({ length: 24 }, (_, i) => `<rect x="${60 + i * 22}" y="300" width="16" height="30" fill="#111"/>`).join("");
  const rules = findRules(await raster(`${letters}<rect x="60" y="311" width="522" height="9" fill="#111"/>`), PPP);
  assert.equal(
    rules.some((rule) => rule.orientation === "h" && ruleAt(rule, 300) > 295 && ruleAt(rule, 300) < 335),
    false,
    JSON.stringify(rules),
  );
});

test("an underline under a word is still a rule", async () => {
  const letters = Array.from({ length: 12 }, (_, i) => `<rect x="${60 + i * 22}" y="300" width="14" height="24" fill="#111"/>`).join("");
  const rules = findRules(await raster(`${letters}<rect x="58" y="330" width="270" height="3" fill="#111"/>`), PPP);
  assert.ok(rules.some((rule) => rule.orientation === "h" && Math.abs(ruleAt(rule, 200) - 331.5) < 2), JSON.stringify(rules));
});

test("a signature line a long blue signature runs over is still a rule", async () => {
  // The blue name crosses the line again and again along most of its length.
  const loops = Array.from({ length: 14 }, (_, i) => `<ellipse cx="${120 + i * 40}" cy="300" rx="16" ry="22" fill="none" stroke="#2a4fc4" stroke-width="5"/>`).join("");
  const rules = findRules(await raster(`<line x1="80" y1="300" x2="720" y2="300" stroke="#111" stroke-width="3"/>${loops}`), PPP);
  assert.ok(rules.some((rule) => rule.orientation === "h" && Math.abs(ruleAt(rule, 400) - 300) < 2 && rule.end - rule.start > 500), JSON.stringify(rules));
});
