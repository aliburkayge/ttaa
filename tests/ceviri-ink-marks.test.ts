import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { findInkRegions, inkShare } from "../lib/ceviri/ink-marks.ts";

/**
 * A synthetic page at ~1.7 px per point: rows of glyph-sized "letters", a
 * table rule, a blue signature scribble that runs through a printed name and
 * over the signature line, and a black stamp ring.
 */
const PPP = 1.7;
const W = 600;
const H = 400;

function letters(x0: number, y: number, count: number, height = 16): string {
  return Array.from({ length: count }, (_, i) => `<rect x="${x0 + i * 12}" y="${y}" width="7" height="${height}" fill="#151515"/>`).join("");
}

const SCRIBBLE = { x0: 60, y0: 200, x1: 260, y1: 262 };
const RING = { cx: 470, cy: 300, r: 45 };

async function page(): Promise<{ w: number; h: number; rgb: Uint8Array }> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#fbfaf7"/>
    ${letters(40, 30, 40)}${letters(40, 60, 35)}${letters(40, 90, 38)}
    <line x1="30" y1="140" x2="570" y2="140" stroke="#000" stroke-width="2"/>
    <line x1="30" y1="140" x2="30" y2="180" stroke="#000" stroke-width="2"/>
    <line x1="50" y1="250" x2="300" y2="250" stroke="#000" stroke-width="1.5"/>
    ${letters(60, 256, 10)}
    <path d="M ${SCRIBBLE.x0} 240 C 90 150, 110 290, 140 225 S 190 180, 210 240 S 240 200, ${SCRIBBLE.x1} 230" fill="none" stroke="#2f5bd0" stroke-width="3"/>
    <circle cx="${RING.cx}" cy="${RING.cy}" r="${RING.r}" fill="none" stroke="#1a1a1a" stroke-width="4"/>
  </svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, rgb: new Uint8Array(data) };
}

const contains = (r: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number) =>
  x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

test("finds the signature scribble and the stamp ring, not the text or the rules", async () => {
  const { regions } = findInkRegions(await page(), PPP);
  const scribble = regions.find((r) => contains(r, 150, 225));
  const ring = regions.find((r) => contains(r, RING.cx - RING.r, RING.cy));
  assert.ok(scribble, "signature scribble missed");
  assert.ok(ring, "stamp ring missed");
  assert.equal(scribble.colored, true);
  assert.equal(ring.colored, false);
  assert.ok(scribble.x0 <= SCRIBBLE.x0 + 4 && scribble.x1 >= SCRIBBLE.x1 - 4, "scribble cut short");
  for (const r of regions) {
    assert.equal(contains(r, 200, 38), false, "a text row was taken for a mark");
    assert.equal(contains(r, 450, 140), false, "the table rule was taken for a mark");
  }
});

test("the mask covers the scribble's ink but not the signature line under it", async () => {
  const raster = await page();
  const { regions } = findInkRegions(raster, PPP);
  const scribble = regions.find((r) => contains(r, 150, 225))!;
  const bit = (x: number, y: number) => scribble.bits[(y - scribble.y0) * (scribble.x1 - scribble.x0 + 1) + (x - scribble.x0)];
  // A point on the scribble near its start.
  assert.equal(bit(SCRIBBLE.x0 + 1, 239), 1);
  // The signature line well away from the scribble's strokes.
  assert.equal(bit(250, 250), 0);
});

test("tells a line read from a signature apart from a printed name it crosses", async () => {
  const raster = await page();
  const found = findInkRegions(raster, PPP);
  // Printed "letters" at y 256–272 under the scribble: mostly glyph ink.
  assert.ok(inkShare(found, { x0: 60, y0: 256, x1: 180, y1: 272 }) < 0.5);
  // The scribble's own band: almost all of its ink belongs to the mark.
  assert.ok(inkShare(found, { x0: 100, y0: 190, x1: 250, y1: 235 }) > 0.8);
});
