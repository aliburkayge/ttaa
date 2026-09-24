import assert from "node:assert/strict";
import test from "node:test";
import { auditPage, type AuditZones } from "../lib/ceviri/pdf-audit.ts";

/** 3 px/pt synthetic scans: grey paper with a fine mottled texture. */
const PPP = 3;
const W = 600;
const H = 300;

function paper(seed = 7) {
  const rgb = new Uint8Array(W * H * 3);
  let state = seed;
  const next = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < W * H; i++) {
    const tone = 205 + Math.round((next() - 0.5) * 16);
    rgb[i * 3] = tone;
    rgb[i * 3 + 1] = tone - 2;
    rgb[i * 3 + 2] = tone - 6;
  }
  return { w: W, h: H, rgb };
}

function fill(raster: { rgb: Uint8Array }, x0: number, y0: number, x1: number, y1: number, color: [number, number, number]) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * W + x) * 3;
      raster.rgb[i] = color[0];
      raster.rgb[i + 1] = color[1];
      raster.rgb[i + 2] = color[2];
    }
  }
}

/** Page: a signature line (y 150–152, x 40–560), a blue scribble over it, a kept name below. */
function original() {
  const page = paper();
  fill(page, 40, 150, 560, 152, [20, 20, 20]);
  for (let x = 150; x <= 300; x++) {
    const y = Math.round(135 + 20 * Math.sin(x / 12));
    fill(page, x, y, x + 1, y + 4, [40, 70, 190]);
  }
  for (let i = 0; i < 12; i++) fill(page, 60 + i * 20, 180, 72 + i * 20, 205, [18, 18, 18]);
  return page;
}

const ZONES: AuditZones = {
  marks: [{ box: { x0: 145, y0: 110, x1: 310, y1: 165 }, kind: "signature" }],
  labels: [{ x0: 200, y0: 120, x1: 260, y1: 140 }],
  protect: [{ x0: 55, y0: 176, x1: 305, y1: 209 }],
  markPatches: [{ x0: 145, y0: 110, x1: 310, y1: 165 }],
  editable: [],
  exempt: [],
  drawn: [],
};

/** What a perfect eraser leaves: the scribble gone, paper texture from the same paper, line intact. */
function perfect() {
  const clean = paper();
  fill(clean, 40, 150, 560, 152, [20, 20, 20]);
  for (let i = 0; i < 12; i++) fill(clean, 60 + i * 20, 180, 72 + i * 20, 205, [18, 18, 18]);
  return clean;
}

const kinds = (defects: Array<{ kind: string }>) => defects.map((d) => d.kind).sort();

test("a clean erase has no defects", () => {
  assert.deepEqual(kinds(auditPage(original(), perfect(), PPP, ZONES)), []);
});

test("a signature line cut where the signature was erased is a rule defect", () => {
  const after = perfect();
  fill(after, 180, 148, 215, 154, [205, 203, 199]);
  const defects = auditPage(original(), after, PPP, ZONES).filter((d) => d.kind === "rule");
  assert.equal(defects.length, 1, JSON.stringify(defects));
  assert.ok(defects[0].amount >= 10 && defects[0].amount <= 14, `missing ${defects[0].amount} pt`);
});

test("blue specks left in the signature area are residue", () => {
  const after = perfect();
  fill(after, 170, 130, 172, 132, [40, 70, 190]);
  fill(after, 280, 125, 283, 126, [50, 80, 180]);
  const defects = auditPage(original(), after, PPP, ZONES).filter((d) => d.kind === "residue");
  assert.equal(defects.length, 1, JSON.stringify(defects));
  assert.match(defects[0].note, /2 parça/);
});

test("a flat bright patch on textured paper is a visible patch", () => {
  const after = perfect();
  fill(after, 148, 112, 305, 146, [228, 226, 222]);
  const defects = auditPage(original(), after, PPP, ZONES).filter((d) => d.kind === "patch");
  assert.equal(defects.length, 1, JSON.stringify(defects));
});

test("holes in a kept line are text damage", () => {
  const after = perfect();
  fill(after, 100, 185, 112, 195, [205, 203, 199]);
  const defects = auditPage(original(), after, PPP, ZONES).filter((d) => d.kind === "text");
  assert.equal(defects.length, 1, JSON.stringify(defects));
});

test("a label on top of the signature line is a label defect", () => {
  const zones = { ...ZONES, labels: [{ x0: 200, y0: 140, x1: 260, y1: 158 }] };
  const defects = auditPage(original(), perfect(), PPP, zones).filter((d) => d.kind === "label");
  assert.equal(defects.length, 1, JSON.stringify(defects));
});

test("a kept line bitten inside the signature area is still text damage", () => {
  const zones = { ...ZONES, marks: [{ box: { x0: 55, y0: 110, x1: 310, y1: 209 }, kind: "signature" }] };
  const after = perfect();
  fill(after, 100, 185, 112, 195, [205, 203, 199]);
  const defects = auditPage(original(), after, PPP, zones).filter((d) => d.kind === "text");
  assert.equal(defects.length, 1, JSON.stringify(defects));
});

test("a faint grey ghost of the erased signature is a patch defect", () => {
  const after = perfect();
  for (let x = 150; x <= 300; x++) {
    const y = Math.round(135 + 20 * Math.sin(x / 12));
    if (y + 4 < 148) fill(after, x, y, x + 1, y + 4, [178, 176, 172]);
  }
  const defects = auditPage(original(), after, PPP, ZONES).filter((d) => d.kind === "patch");
  assert.equal(defects.length, 1, JSON.stringify(defects));
  assert.match(defects[0].note, /hayalet/);
});

test("ink left behind where a translated row was erased is residue", () => {
  const before = original();
  fill(before, 350, 60, 540, 72, [60, 110, 200]);
  const after = perfect();
  fill(after, 350, 62, 450, 72, [25, 25, 25]);
  fill(after, 500, 70, 512, 72, [60, 110, 200]);
  const zones = { ...ZONES, editable: [{ x0: 345, y0: 55, x1: 545, y1: 77 }], drawn: [{ x0: 350, y0: 58, x1: 452, y1: 74 }] };
  const defects = auditPage(before, after, PPP, zones).filter((d) => d.kind === "residue");
  assert.equal(defects.length, 1, JSON.stringify(defects));
  assert.match(defects[0].note, /yazı silme/);
});

test("removing a stamp's dark blend from a kept heading is not text damage", () => {
  const before = original();
  // A teal stamp stroke crosses the kept line; where it overlaps a letter the scan shows a dark, nearly colourless blend.
  for (let x = 90; x <= 140; x++) {
    fill(before, x, 188, x, 190, [30, 150, 120]);
  }
  // Just past the letter's edge the stroke's dark core reads as a colourless blend.
  fill(before, 113, 188, 117, 190, [40, 48, 46]);
  const after = perfect();
  const defects = auditPage(before, after, PPP, ZONES).filter((d) => d.kind === "text");
  assert.equal(defects.length, 0, JSON.stringify(defects));
});

test("a black signature stroke erased where it dips into a kept line is not text damage", () => {
  const before = original();
  // A black loop comes down from above the kept line and ends inside it.
  for (let y = 150; y <= 186; y++) fill(before, 160, y, 161, y, [22, 22, 22]);
  const after = perfect();
  const zones = { ...ZONES, marks: [{ box: { x0: 145, y0: 110, x1: 310, y1: 190 }, kind: "signature" }] };
  const defects = auditPage(before, after, PPP, zones).filter((d) => d.kind === "text");
  assert.equal(defects.length, 0, JSON.stringify(defects));
});

test("a one-pixel sliver along a letter's edge is not text damage", () => {
  const after = perfect();
  fill(after, 72, 181, 72, 204, [205, 203, 199]);
  const defects = auditPage(original(), after, PPP, ZONES).filter((d) => d.kind === "text");
  assert.equal(defects.length, 0, JSON.stringify(defects));
});

test("on speckled paper the speckle left in the signature area is paper, not residue", () => {
  const speckle = (raster: { rgb: Uint8Array }) => {
    let state = 3;
    const next = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 900; i++) {
      const x = Math.floor(next() * (W - 2));
      const y = Math.floor(next() * (H - 2));
      fill(raster, x, y, x, y, [40, 40, 40]);
    }
  };
  const before = original();
  speckle(before);
  const after = perfect();
  speckle(after);
  const defects = auditPage(before, after, PPP, ZONES).filter((d) => d.kind === "residue");
  assert.equal(defects.length, 0, JSON.stringify(defects));
});

test("a translated row's own underline going with it is not a broken rule", () => {
  const before = original();
  fill(before, 350, 60, 520, 72, [30, 30, 30]);
  fill(before, 350, 75, 520, 76, [60, 110, 200]);
  const after = perfect();
  fill(after, 350, 62, 470, 72, [25, 25, 25]);
  const zones = { ...ZONES, editable: [{ x0: 345, y0: 55, x1: 525, y1: 80 }], drawn: [{ x0: 350, y0: 58, x1: 472, y1: 74 }] };
  const defects = auditPage(before, after, PPP, zones).filter((d) => d.kind === "rule");
  assert.equal(defects.length, 0, JSON.stringify(defects));
});
