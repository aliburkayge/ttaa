import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { findInkRegions, inkShare, markMask, sweepResidue } from "../lib/ceviri/ink-marks.ts";

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

/**
 * A dark navy signature on a phone photo: saturation is low in absolute terms
 * (≈ 44) but far above black print (≈ 8). The signature line cuts the "J" in
 * two; "c Hoi" is letter-sized and the flourish is long and flat.
 */
async function navyPage(): Promise<{ w: number; h: number; rgb: Uint8Array }> {
  const navy = "#1c2248";
  const stroke = `fill="none" stroke="${navy}" stroke-width="3"`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#e9e7e2"/>
    ${letters(40, 30, 40)}${letters(40, 60, 35)}${letters(40, 90, 38)}
    <path d="M 70 290 C 60 270, 110 280, 95 330 C 90 362, 60 360, 75 345" ${stroke}/>
    <path d="M 125 320 C 112 316, 112 332, 126 330" ${stroke}/>
    <path d="M 140 305 L 140 330 M 140 318 L 155 318 M 155 305 L 155 330" ${stroke}/>
    <circle cx="168" cy="324" r="6" ${stroke}/>
    <path d="M 182 316 L 182 330" ${stroke}/>
    <path d="M 190 326 C 230 318, 270 318, 300 322" ${stroke}/>
    <line x1="40" y1="335" x2="330" y2="335" stroke="#000" stroke-width="1.5"/>
    ${letters(40, 362, 12)}
  </svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, rgb: new Uint8Array(data) };
}

test("a dark navy signature is one coloured region, loop, letters and flourish together", async () => {
  const { regions } = findInkRegions(await navyPage(), PPP);
  const signature = regions.find((r) => contains(r, 70, 300));
  assert.ok(signature, "signature missed");
  assert.equal(signature.colored, true, "navy ink was taken for black");
  for (const [x, y, part] of [[168, 324, "the o"], [290, 321, "the flourish"], [72, 350, "the loop under the line"]] as const) {
    assert.ok(contains(signature, x, y), `${part} is not part of the signature region`);
  }
  assert.ok(signature.y1 < 362, "the printed name under the signature was taken in");
});

test("the navy signature's mask takes its flourish but leaves the black signature line", async () => {
  const raster = await navyPage();
  const map = findInkRegions(raster, PPP);
  const signature = map.regions.find((r) => contains(r, 70, 300))!;
  const margin = 4;
  const { box, bits } = markMask(
    raster,
    map,
    { x0: signature.x0 - margin, y0: signature.y0 - margin, x1: signature.x1 + margin, y1: signature.y1 + margin },
    { colored: true, protect: [], shortRule: 100 },
  );
  const bit = (x: number, y: number) => bits[(y - box.y0) * (box.x1 - box.x0 + 1) + (x - box.x0)];
  assert.equal(bit(250, 319), 1, "the flourish is left on the page");
  assert.equal(bit(168, 318), 1, "the o is left on the page");
  assert.equal(bit(120, 335), 0, "the signature line is erased");
});

// ---------- BASF Almanya formu, NJ mektubu 3. sayfa ----------

/** Blank paper with a few rows of text for the glyph size. */
function sheet(inner: string, paper = "#fbfaf7"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="${paper}"/>
    ${letters(40, 30, 40)}${letters(40, 60, 35)}${letters(40, 90, 38)}
    ${inner}
  </svg>`;
}

async function raster(svg: string): Promise<{ w: number; h: number; rgb: Uint8Array }> {
  const { data, info } = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, rgb: new Uint8Array(data) };
}

function maskOf(r: Awaited<ReturnType<typeof raster>>, map: ReturnType<typeof findInkRegions>, region: { x0: number; y0: number; x1: number; y1: number; colored: boolean }) {
  const margin = 4;
  const { box, bits } = markMask(
    r,
    map,
    { x0: region.x0 - margin, y0: region.y0 - margin, x1: region.x1 + margin, y1: region.y1 + margin },
    { colored: region.colored, protect: [], shortRule: 100 },
  );
  return (x: number, y: number) =>
    x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1 ? 0 : bits[(y - box.y0) * (box.x1 - box.x0 + 1) + (x - box.x0)];
}

test("a blue signature beside a green stamp is two regions, not one", async () => {
  // Priaxor: "i.A. R. Ficht" in blue, the company stamp in teal a little to its right.
  const svg = sheet(`
    <path d="M 60 230 C 80 180, 100 260, 120 215 S 160 190, 190 225" fill="none" stroke="#2438b8" stroke-width="3"/>
    <circle cx="300" cy="225" r="45" fill="none" stroke="#1f9a7a" stroke-width="4"/>
    <circle cx="300" cy="225" r="28" fill="none" stroke="#1f9a7a" stroke-width="3"/>`);
  const { regions } = findInkRegions(await raster(svg), PPP);
  const signature = regions.find((r) => contains(r, 120, 215));
  const stamp = regions.find((r) => contains(r, 300 - 45, 225));
  assert.ok(signature && stamp, "signature or stamp missed");
  assert.notEqual(signature, stamp, "the signature and the stamp were merged into one region");
  assert.ok(signature.x1 < 255, "the signature region reaches into the stamp");
});

test("a black signature's long wavy tail is part of the signature, to its very end", async () => {
  // NJ mektubu 3. sayfa: "Jill C Holihan" ends in a long, slightly wavy stroke
  // that was taken for a printed rule; its curled end stayed on the page.
  const svg = sheet(`
    <path d="M 60 200 C 120 170, 125 215, 90 250 C 70 280, 45 262, 70 240 L 85 230" fill="none" stroke="#111" stroke-width="3"/>
    <path d="M 85 230 C 130 235, 170 222, 210 227 S 290 232, 330 225 C 345 222, 350 215, 340 211" fill="none" stroke="#111" stroke-width="2.5"/>`);
  const r = await raster(svg);
  const map = findInkRegions(r, PPP);
  const signature = map.regions.find((region) => contains(region, 100, 215));
  assert.ok(signature, "signature missed");
  const bit = maskOf(r, map, signature);
  assert.equal(bit(250, 229), 1, "the middle of the tail is left on the page");
  assert.equal(bit(344, 216), 1, "the curled end of the tail is left on the page");
});

test("a straight printed rule the signature touches is still left alone", async () => {
  const svg = sheet(`
    <path d="M 60 200 C 120 170, 125 215, 90 250 C 70 280, 45 262, 70 240 L 85 230" fill="none" stroke="#111" stroke-width="3"/>
    <line x1="40" y1="245" x2="400" y2="245" stroke="#000" stroke-width="1.5"/>`);
  const r = await raster(svg);
  const map = findInkRegions(r, PPP);
  const signature = map.regions.find((region) => contains(region, 100, 215))!;
  const bit = maskOf(r, map, signature);
  assert.equal(bit(300, 245), 0, "the printed rule is erased");
});

test("the soft grey halo around a signature's strokes is erased with them", async () => {
  // Scanned signatures are blurred and JPEG-ringed: a pale fringe several
  // pixels wide runs along each stroke. Left on the page it drew the signature back as a grey ghost.
  const svg = sheet(`
    <path d="M 70 230 C 90 170, 110 270, 140 215 S 190 180, 260 225" fill="none" stroke="#ebebeb" stroke-width="15" stroke-linecap="round"/>
    <path d="M 70 230 C 90 170, 110 270, 140 215 S 190 180, 260 225" fill="none" stroke="#1d3a9a" stroke-width="3"/>`, "#ffffff");
  const r = await raster(svg);
  const map = findInkRegions(r, PPP);
  const signature = map.regions.find((region) => contains(region, 140, 215));
  assert.ok(signature, "signature missed");
  const bit = maskOf(r, map, signature);
  let ghost = 0;
  for (let y = signature.y0 - 4; y <= signature.y1 + 4; y++) {
    for (let x = signature.x0 - 4; x <= signature.x1 + 4; x++) {
      const i = (y * r.w + x) * 3;
      const lum = 0.299 * r.rgb[i] + 0.587 * r.rgb[i + 1] + 0.114 * r.rgb[i + 2];
      if (lum < 247 && !bit(x, y)) ghost++;
    }
  }
  assert.ok(ghost < 15, `${ghost} halo pixels are left around the erased signature`);
});

test("where a blue signature crosses the signature line, the line stays whole", async () => {
  const svg = sheet(`
    <line x1="40" y1="250" x2="400" y2="250" stroke="#000" stroke-width="2"/>
    <path d="M 70 220 C 90 200, 110 300, 140 235 S 190 220, 260 240" fill="none" stroke="#3a62d6" stroke-width="3" stroke-opacity="0.85"/>`);
  const r = await raster(svg);
  const map = findInkRegions(r, PPP);
  const signature = map.regions.find((region) => contains(region, 140, 235))!;
  const bit = maskOf(r, map, signature);
  // Every column of the line under the signature keeps at least one line pixel.
  const gaps: number[] = [];
  for (let x = signature.x0; x <= signature.x1; x++) {
    let kept = false;
    for (let y = 248; y <= 252; y++) {
      const i = (y * r.w + x) * 3;
      const lum = 0.299 * r.rgb[i] + 0.587 * r.rgb[i + 1] + 0.114 * r.rgb[i + 2];
      if (lum < 150 && !bit(x, y)) kept = true;
    }
    if (!kept) gaps.push(x);
  }
  assert.deepEqual(gaps, [], "the signature line has gaps where the signature crossed it");
});

// ---------- kalıntı süpürmesi (Mfg mektubu: silinen imzanın çevresinde noktalar) ----------

test("the sweep takes the signature's loose dots and specks, never a kept line's full stop", async () => {
  const navy = "#1c2248";
  const page = await raster(
    sheet(`<path d="M 70 290 C 60 270, 110 280, 95 330 C 90 362, 60 360, 75 345 S 200 300, 260 320" fill="none" stroke="${navy}" stroke-width="3"/>
      <circle cx="150" cy="282" r="2" fill="${navy}"/>
      <circle cx="210" cy="296" r="1.6" fill="${navy}"/>
      <rect x="120" y="345" width="2" height="2" fill="#222"/>
      ${letters(40, 372, 6)}<rect x="180" y="398" width="3" height="3" fill="#151515"/>`),
  );
  const map = findInkRegions(page, PPP);
  const signature = map.regions.find((r) => contains(r, 70, 300))!;
  const margin = 4;
  const masked = markMask(
    page,
    map,
    { x0: signature.x0 - margin, y0: signature.y0 - margin, x1: signature.x1 + margin, y1: signature.y1 + margin },
    { colored: true, protect: [], shortRule: 100 },
  );
  const kept = { x0: 36, y0: 368, x1: 190, y1: 404 };
  const { box, bits } = sweepResidue(page, map, masked, { reach: 20, protect: [kept], maxPiece: 12, colored: true });
  const bit = (x: number, y: number) =>
    x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1 ? bits[(y - box.y0) * (box.x1 - box.x0 + 1) + (x - box.x0)] : 0;
  assert.equal(bit(150, 282), 1, "the dot above the signature is left");
  assert.equal(bit(210, 296), 1, "the second dot is left");
  assert.equal(bit(121, 346), 1, "the small black speck is left");
  assert.equal(bit(181, 399), 0, "the kept line's full stop was swept");
  assert.equal(bit(60, 380), 0, "a kept letter was swept");
});

test("inside the signature's own box every loose piece goes, however large or grey, but kept lines stay", async () => {
  const page = await raster(
    sheet(`<path d="M 70 290 C 60 270, 110 280, 95 330 S 200 300, 260 320" fill="none" stroke="#1c2248" stroke-width="3"/>
      <path d="M 200 280 L 230 272" fill="none" stroke="#2a2a2e" stroke-width="3"/>
      ${letters(40, 372, 6)}`),
  );
  const map = findInkRegions(page, PPP);
  const signature = map.regions.find((r) => contains(r, 70, 300))!;
  const inner = { x0: signature.x0 - 4, y0: 268, x1: signature.x1 + 4, y1: signature.y1 + 4 };
  const masked = markMask(page, map, inner, { colored: true, protect: [], shortRule: 100 });
  const kept = { x0: 36, y0: 368, x1: 190, y1: 404 };
  const { box, bits } = sweepResidue(page, map, masked, { reach: 20, protect: [kept], maxPiece: 12, colored: true, inner });
  const bit = (x: number, y: number) =>
    x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1 ? bits[(y - box.y0) * (box.x1 - box.x0 + 1) + (x - box.x0)] : 0;
  assert.equal(bit(215, 276), 1, "the grey stroke inside the signature's box is left");
  assert.equal(bit(60, 380), 0, "a kept letter was swept");
});
