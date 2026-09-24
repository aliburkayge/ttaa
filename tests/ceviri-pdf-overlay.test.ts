import assert from "node:assert/strict";
import test from "node:test";
import { degrees, PDFArray, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import sharp from "sharp";
import { inflateSync } from "node:zlib";
import type { LayoutBlock, OcrLine } from "../lib/ceviri/ocr-layout.ts";
import { inkPatch, insideMark, itemAction, rulePatchCuts, layoutItemText, markObstacles, planOverlay, renderOverlay, ruleCuts, snapSizes, subtractRects, type OverlayPlan, type Rect } from "../lib/ceviri/pdf-overlay.ts";
import { fontsFor } from "../lib/ceviri/fonts.ts";
import { displayToPage, imagePlacement, loadScanPages, renderPdfPage, unpackGray1bpp } from "../lib/ceviri/pdf-scan.ts";

/**
 * A synthetic "scan": a page image with a two-column table, black bars
 * standing in for lines of text, and a photo inside one cell — the same
 * structure as the customer's packaging forms. Coordinates are page points.
 */
const PAGE = { width: 300, height: 220 };
const PX = 4; // scan pixels per point, like the real 4.17
const OCR = 1.2; // OCR pixels per point

const TABLE = { x0: 20, y0: 60, x1: 280, y1: 200, split: 130, rows: [60, 90, 120, 200] };
const TITLE = { x0: 100, y0: 25, x1: 200, y1: 33 };
const PHOTO = { x0: 150, y0: 150, x1: 250, y1: 195 };

/** A line of "text": thin vertical strokes like glyph stems, not a solid block. */
function bar(x0: number, y0: number, x1: number, y1: number) {
  const strokes: string[] = [];
  for (let x = x0; x + 0.7 <= x1; x += 1.6) {
    strokes.push(`<rect x="${x * PX}" y="${y0 * PX}" width="${0.7 * PX}" height="${(y1 - y0) * PX}" fill="#111"/>`);
  }
  return strokes.join("");
}

function scanSvg(skewDegrees: number, extra = "", bare = false): string {
  const line = (x0: number, y0: number, x1: number, y1: number) =>
    `<line x1="${x0 * PX}" y1="${y0 * PX}" x2="${x1 * PX}" y2="${y1 * PX}" stroke="#000" stroke-width="${0.8 * PX}"/>`;
  const t = TABLE;
  const parts = [
    bar(TITLE.x0, TITLE.y0, TITLE.x1, TITLE.y1),
    ...t.rows.map((y) => line(t.x0, y, t.x1, y)),
    line(t.x0, t.y0, t.x0, t.y1),
    line(t.x1, t.y0, t.x1, t.y1),
    line(t.split, t.y0, t.split, 120), // last row spans both columns
    // row 1: label | value
    bar(25, 71, 100, 78),
    bar(135, 71, 190, 78),
    // row 2: label | two-line value
    bar(25, 101, 90, 108),
    bar(135, 96, 270, 103),
    bar(135, 108, 230, 115),
    // row 3 (spanning): label, then a tall photo below it
    bar(25, 125, 110, 132),
    `<rect x="${PHOTO.x0 * PX}" y="${PHOTO.y0 * PX}" width="${(PHOTO.x1 - PHOTO.x0) * PX}" height="${(PHOTO.y1 - PHOTO.y0) * PX}" fill="#444"/>`,
  ];
  const cx = (PAGE.width * PX) / 2;
  const cy = (PAGE.height * PX) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.width * PX}" height="${PAGE.height * PX}">
<rect width="100%" height="100%" fill="#fbfaf7"/>
<g transform="rotate(${skewDegrees} ${cx} ${cy})">${bare ? "" : parts.join("")}${extra}</g></svg>`;
}

/** `rotated`: stored landscape and shown upright through /Rotate 270, like the customer's scans. */
async function scannedPdf(options: { skew?: number; rotated?: boolean; extra?: string; bare?: boolean } = {}): Promise<Uint8Array> {
  let image = sharp(Buffer.from(scanSvg(options.skew ?? 0, options.extra, options.bare)));
  if (options.rotated) image = image.rotate(90);
  const jpeg = await image.jpeg({ quality: 92 }).toBuffer();

  const doc = await PDFDocument.create();
  const embedded = await doc.embedJpg(jpeg);
  if (options.rotated) {
    const page = doc.addPage([PAGE.height, PAGE.width]);
    page.drawImage(embedded, { x: 0, y: 0, width: PAGE.height, height: PAGE.width });
    page.setRotation(degrees(270));
  } else {
    const page = doc.addPage([PAGE.width, PAGE.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: PAGE.width, height: PAGE.height });
  }
  return doc.save();
}

/**
 * The same scan as a black-and-white page: 1 bit per pixel, DeviceGray, the way
 * fax-style scanners store it (the customer's JBIG2 files decode to exactly this).
 * Flate instead of JBIG2 because no JBIG2 encoder is at hand; both end up as
 * packed bits that must be unpacked, not read as bytes.
 */
async function bilevelPdf(): Promise<Uint8Array> {
  const { data, info } = await sharp(Buffer.from(scanSvg(0)))
    .greyscale()
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stride = Math.ceil(info.width / 8);
  const packed = Buffer.alloc(stride * info.height);
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] > 127) packed[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }

  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.width, PAGE.height]);
  const ref = doc.context.register(
    doc.context.flateStream(packed, {
      Type: "XObject",
      Subtype: "Image",
      Width: info.width,
      Height: info.height,
      ColorSpace: "DeviceGray",
      BitsPerComponent: 1,
    }),
  );
  page.node.setXObject(PDFName.of("Im0"), ref);
  const content = doc.context.flateStream(`q ${PAGE.width} 0 0 ${PAGE.height} 0 0 cm /Im0 Do Q`);
  page.node.set(PDFName.of("Contents"), doc.context.register(content));
  return doc.save();
}

let nextId = 0;
function line(text: string): OcrLine {
  return { id: `l${++nextId}`, text, confidence: 0.99, ocrWarning: null };
}

function frame(x0: number, y0: number, x1: number, y1: number) {
  return {
    box: { x0: x0 * OCR, y0: y0 * OCR, x1: x1 * OCR, y1: y1 * OCR },
    pageWidth: PAGE.width * OCR,
    pageHeight: PAGE.height * OCR,
  };
}

const LINES = {
  title: line("PACKAGING FORM"),
  name: line("1. Trade name"),
  nameValue: line("Examplo SC"),
  weight: line("2. Weight"),
  weightValue: line("0.25 L: 30 g bottle"),
  image: line("3. Packaging image"),
  stampText: line("Head of Supply"),
};

const BLOCKS: LayoutBlock[] = [
  { kind: "paragraph", role: "title", page: 1, lines: [LINES.title], frame: frame(TITLE.x0, TITLE.y0, TITLE.x1, TITLE.y1) },
  {
    kind: "table",
    page: 1,
    rows: [
      [{ colspan: 1, lines: [LINES.name] }, { colspan: 1, lines: [LINES.nameValue] }],
      [{ colspan: 1, lines: [LINES.weight] }, { colspan: 1, lines: [LINES.weightValue] }],
      [{ colspan: 2, lines: [LINES.image] }],
    ],
    frame: frame(TABLE.x0, TABLE.y0, TABLE.x1, TABLE.y1),
  },
  { kind: "image", page: 1, image: "signature_stamp", lines: [LINES.stampText], frame: frame(200, 205, 280, 218) },
];

function inside(inner: Rect, outer: { x0: number; y0: number; x1: number; y1: number }) {
  return inner.u0 >= outer.x0 && inner.u1 <= outer.x1 && inner.v0 >= outer.y0 && inner.v1 <= outer.y1;
}

function overlaps(a: Rect, b: { x0: number; y0: number; x1: number; y1: number }) {
  return a.u0 < b.x1 && a.u1 > b.x0 && a.v0 < b.y1 && a.v1 > b.y0;
}

function itemFor(plan: OverlayPlan, id: string) {
  return plan.items.find((item) => item.lineIds.includes(id));
}

test("reads the image placement matrix from the page content", () => {
  assert.deepEqual(
    imagePlacement("q\n1 0 0 1 3.12 2.82 cm\n844.80 0 0 589.44 0 0 cm\n/x2 Do\nQ", "/x2"),
    [844.8, 0, 0, 589.44, 3.12, 2.82],
  );
  assert.equal(imagePlacement("q 10 0 0 10 0 0 cm /Other Do Q", "/x2"), null);
});

test("maps upright display coordinates onto a page stored sideways", () => {
  // /Rotate 270: the display's top-left corner is the stored page's top-right.
  const toPage = displayToPage(270, { x: 0, y: 0, width: 842, height: 595 });
  assert.deepEqual(toPage(0, 0), { x: 842, y: 595 });
  assert.deepEqual(toPage(595, 842), { x: 0, y: 0 });
});

test("sees a sideways-stored scan upright", async () => {
  const { pages } = await loadScanPages(await scannedPdf({ rotated: true }));
  assert.equal(pages[0].rotation, 270);
  assert.equal(Math.round(pages[0].width), PAGE.width);
  assert.ok((pages[0].luminance(150, 29) ?? 255) < 100, "title bar is not where it should be");
  assert.ok((pages[0].luminance(150, 45) ?? 0) > 200, "blank area reads dark");
});

for (const rotated of [false, true]) {
  test(`places every line of the table into its own cell${rotated ? " (sideways scan)" : ""}`, async () => {
    const plan = await planOverlay(await scannedPdf({ rotated }), BLOCKS);
    assert.deepEqual(plan.unplaced, []);
    const mark = plan.items.find((item) => item.mark);
    assert.equal(mark?.mark, "signature_stamp");
    assert.deepEqual(mark?.lineIds, [LINES.stampText.id]);

    const t = TABLE;
    const cells = {
      [LINES.name.id]: { x0: t.x0, y0: t.rows[0], x1: t.split, y1: t.rows[1] },
      [LINES.nameValue.id]: { x0: t.split, y0: t.rows[0], x1: t.x1, y1: t.rows[1] },
      [LINES.weight.id]: { x0: t.x0, y0: t.rows[1], x1: t.split, y1: t.rows[2] },
      [LINES.weightValue.id]: { x0: t.split, y0: t.rows[1], x1: t.x1, y1: t.rows[2] },
      [LINES.image.id]: { x0: t.x0, y0: t.rows[2], x1: t.x1, y1: t.rows[3] },
    };
    for (const [id, cell] of Object.entries(cells)) {
      const item = itemFor(plan, id);
      assert.ok(item, `${id} yerleşmedi`);
      for (const rect of item.erase) assert.ok(inside(rect, cell), `${id} hücresinin dışını siliyor`);
      assert.ok(inside(item.area, cell), `${id} hücresinin dışına yazacak`);
    }
  });
}

test("never erases the photo inside a cell, only the label above it", async () => {
  const plan = await planOverlay(await scannedPdf(), BLOCKS);
  const item = itemFor(plan, LINES.image.id)!;
  assert.equal(item.erase.length, 1);
  for (const rect of item.erase) assert.equal(overlaps(rect, PHOTO), false);
  assert.ok(item.area.v1 <= PHOTO.y0, "translation could be written over the photo");
});

test("erases each line of a two-line cell and measures the line spacing", async () => {
  const plan = await planOverlay(await scannedPdf(), BLOCKS);
  const item = itemFor(plan, LINES.weightValue.id)!;
  assert.equal(item.erase.length, 2);
  assert.ok(Math.abs(item.leading - 12) < 0.6, `leading ${item.leading}`);
  assert.equal(item.align, "left");
});

test("centres a title that sits alone in the middle of the page", async () => {
  const plan = await planOverlay(await scannedPdf(), BLOCKS);
  assert.equal(itemFor(plan, LINES.title.id)?.align, "center");
});

test("picks up the scan's own paper colour for the patch", async () => {
  const plan = await planOverlay(await scannedPdf(), BLOCKS);
  const [r, g, b] = itemFor(plan, LINES.nameValue.id)!.background;
  assert.ok(r >= 245 && g >= 243 && b >= 238 && r - b >= 2, `paper ${r},${g},${b}`);
});

test("measures a skewed scan and still finds every table cell", async () => {
  const plan = await planOverlay(await scannedPdf({ skew: 0.3 }), BLOCKS);
  const measured = (plan.pages[0].skew * 180) / Math.PI;
  assert.ok(Math.abs(measured - 0.3) < 0.05, `skew ${measured.toFixed(3)}°`);
  assert.deepEqual(plan.unplaced, []);
});

test("reports a table whose lines do not match the OCR instead of guessing", async () => {
  const wrong: LayoutBlock[] = [
    {
      kind: "table",
      page: 1,
      rows: [[{ colspan: 1, lines: [line("only row")] }]],
      frame: frame(TABLE.x0, TABLE.y0, TABLE.x1, TABLE.y1),
    },
  ];
  const plan = await planOverlay(await scannedPdf(), wrong);
  assert.equal(plan.items.length, 0);
  assert.match(plan.unplaced[0].reason, /eşleşmedi/);
});

function contentStreams(doc: PDFDocument): number {
  const contents = doc.getPages()[0].node.Contents();
  return contents instanceof PDFArray ? contents.size() : contents instanceof PDFRawStream ? 1 : 0;
}

test("leaves the page untouched when nothing changes and there is no signature or stamp", async () => {
  const pdf = await scannedPdf();
  const plan = await planOverlay(pdf, BLOCKS.filter((block) => block.kind !== "image"));
  const texts = new Map(
    Object.values(LINES).map((l) => [l.id, { source: l.text, translation: l.text }]),
  );
  const before = contentStreams(await PDFDocument.load(pdf));
  const after = contentStreams(await PDFDocument.load(await renderOverlay(pdf, plan, texts)));
  assert.equal(after, before);
});

test("writes a translation onto the page, keeping page count and size", async () => {
  const pdf = await scannedPdf({ rotated: true });
  const plan = await planOverlay(pdf, BLOCKS);
  const texts = new Map(Object.values(LINES).map((l) => [l.id, { source: l.text, translation: null as string | null }]));
  texts.set(LINES.weightValue.id, { source: LINES.weightValue.text, translation: "0,25 L: 30 g şişe — İğdır" });

  const out = await PDFDocument.load(await renderOverlay(pdf, plan, texts));
  const original = await PDFDocument.load(pdf);
  assert.equal(out.getPageCount(), original.getPageCount());
  assert.deepEqual(out.getPages()[0].getSize(), original.getPages()[0].getSize());
  assert.equal(out.getPages()[0].getRotation().angle, 270);
  assert.ok(contentStreams(out) > contentStreams(original), "nothing was drawn");
});

/**
 * The signatory block from the customer's form: a blue stamp, and printed
 * black name/title lines whose first letters touch the stamp's ring.
 *
 * Customer rule: a translation never copies a signature or a stamp. The
 * whole region is cleared and a bracketed label is written in its place.
 */
const STAMP = { cx: 40, cy: 212, r: 16 };
const SIGNATORY = { x0: 52, name: [203, 209], title: [211, 217] };
const STAMP_BOX = { x0: 22, y0: 196, x1: 125, y1: 219 };

function stampSvg(): string {
  const px = (value: number) => value * PX;
  return [
    `<circle cx="${px(STAMP.cx)}" cy="${px(STAMP.cy)}" r="${px(STAMP.r)}" fill="none" stroke="#3a64d8" stroke-width="${px(2)}"/>`,
    `<rect x="${px(34)}" y="${px(211)}" width="${px(6)}" height="${px(4)}" fill="#40424a"/>`,
    bar(SIGNATORY.x0, SIGNATORY.name[0], 90, SIGNATORY.name[1]),
    bar(SIGNATORY.x0, SIGNATORY.title[0], 120, SIGNATORY.title[1]),
  ].join("");
}

const NAME = line("Jane Example");
const TITLE_LINE = line("Head of Supply");
const STAMP_BLOCKS: LayoutBlock[] = [
  {
    kind: "image",
    page: 1,
    image: "signature_stamp",
    lines: [NAME, TITLE_LINE],
    frame: frame(STAMP_BOX.x0, STAMP_BOX.y0, STAMP_BOX.x1, STAMP_BOX.y1),
  },
];

test("cuts the holes out of a rectangle and keeps the rest", () => {
  const rect: Rect = { u0: 0, v0: 0, u1: 10, v1: 10 };
  assert.deepEqual(subtractRects(rect, []), [rect]);
  assert.deepEqual(subtractRects(rect, [{ u0: 20, v0: 20, u1: 30, v1: 30 }]), [rect]);
  const pieces = subtractRects(rect, [{ u0: 4, v0: 4, u1: 6, v1: 6 }]);
  assert.equal(pieces.length, 4);
  const area = pieces.reduce((sum, p) => sum + (p.u1 - p.u0) * (p.v1 - p.v0), 0);
  assert.equal(area, 100 - 4);
  assert.deepEqual(subtractRects(rect, [{ u0: -1, v0: -1, u1: 11, v1: 11 }]), []);
});

test("turns a signed stamp into one mark that clears the whole region", async () => {
  const plan = await planOverlay(await scannedPdf({ extra: stampSvg() }), STAMP_BLOCKS);
  assert.deepEqual(plan.unplaced, []);
  assert.equal(plan.items.length, 1, "printed lines must not be placed on their own");
  const [mark] = plan.items;
  assert.equal(mark.mark, "signature_stamp");
  assert.deepEqual(mark.lineIds, [NAME.id, TITLE_LINE.id]);
  assert.equal(mark.align, "center");
  assert.equal(mark.erase.length, 1);
  const [rect] = mark.erase;
  assert.ok(rect.u0 <= STAMP_BOX.x0 && rect.u1 >= STAMP_BOX.x1, "does not reach across the region");
  assert.ok(rect.v0 <= STAMP_BOX.y0 && rect.v1 >= STAMP_BOX.y1, "does not reach across the region");
  assert.equal(mark.caution, null);
});

test("a signature with no printed text still becomes a mark", async () => {
  const blocks: LayoutBlock[] = [{ kind: "image", page: 1, image: "signature", lines: [], frame: frame(30, 150, 110, 180) }];
  const plan = await planOverlay(await scannedPdf(), blocks);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].mark, "signature");
  assert.deepEqual(plan.items[0].lineIds, []);
});

test("leaves a logo and an unidentified image alone", async () => {
  const blocks: LayoutBlock[] = [
    { kind: "image", page: 1, image: "logo", lines: [], frame: frame(30, 150, 110, 180) },
    { kind: "image", page: 1, image: "unknown", lines: [], frame: frame(150, 150, 250, 195) },
  ];
  const plan = await planOverlay(await scannedPdf(), blocks);
  assert.equal(plan.items.length, 0);
});

test("removes the stamp's ink and writes the label in its place", async () => {
  const pdf = await scannedPdf({ extra: stampSvg() });
  const plan = await planOverlay(pdf, STAMP_BLOCKS);
  const texts = new Map([
    [NAME.id, { source: NAME.text, translation: NAME.text }],
    [TITLE_LINE.id, { source: TITLE_LINE.text, translation: "Tedarik Müdürü" }],
  ]);
  const out = await renderOverlay(pdf, plan, texts, { targetLang: "tr-TR" });
  const scale = 2;
  const width = PAGE.width * scale;
  const height = PAGE.height * scale;
  const rgba = await renderPdfPage(out, 0, { width, height });
  const at = (u: number, v: number) => {
    const offset = (Math.round(v * scale) * width + Math.round(u * scale)) * 4;
    return [rgba[offset], rgba[offset + 1], rgba[offset + 2]];
  };
  // The ring's left edge sits outside where the centred label can reach.
  const [r, g, b] = at(STAMP.cx - STAMP.r, STAMP.cy);
  assert.ok(b - r < 25 && r > 200 && g > 200, `ring still there: ${r},${g},${b}`);
  let ink = 0;
  for (let v = STAMP_BOX.y0; v < STAMP_BOX.y1; v += 0.5) {
    for (let u = STAMP_BOX.x0; u < STAMP_BOX.x1; u += 0.5) {
      const [lr, lg, lb] = at(u, v);
      if (lr + lg + lb < 300) ink++;
    }
  }
  assert.ok(ink > 30, "no label was written");
});

test("redraws a line the cleared region runs into, even when it does not change", async () => {
  const blocks: LayoutBlock[] = [
    { kind: "paragraph", role: "title", page: 1, lines: [LINES.title], frame: frame(TITLE.x0, TITLE.y0, TITLE.x1, TITLE.y1) },
    { kind: "image", page: 1, image: "stamp", lines: [], frame: frame(180, 18, 230, 45) },
  ];
  const plan = await planOverlay(await scannedPdf(), blocks);
  const title = itemFor(plan, LINES.title.id)!;
  assert.equal(title.redraw, true);
  assert.equal(plan.items[0].mark, "stamp", "marks are drawn first");
});

test("does not clear the part of a mark that covers a line it could not place", async () => {
  const wrongTable: LayoutBlock = {
    kind: "table",
    page: 1,
    rows: [[{ colspan: 1, lines: [line("only row")] }]],
    frame: frame(TABLE.x0, TABLE.y0, TABLE.x1, TABLE.y1),
  };
  const stamp: LayoutBlock = { kind: "image", page: 1, image: "stamp", lines: [], frame: frame(240, 40, 295, 80) };
  const plan = await planOverlay(await scannedPdf(), [wrongTable, stamp]);
  const mark = plan.items.find((item) => item.mark)!;
  for (const rect of mark.erase) assert.equal(overlaps(rect, TABLE), false, "erases into a line that stays as it is");
  assert.match(String(mark.caution), /silinmedi/);
});

test("erases a printed line but not the red initials written over it", async () => {
  const px = (value: number) => value * PX;
  const initials = `<rect x="${px(62)}" y="${px(22)}" width="${px(5)}" height="${px(6)}" fill="#c8202a"/>`;
  const plan = await planOverlay(await scannedPdf({ extra: initials }), BLOCKS);
  const title = itemFor(plan, LINES.title.id)!;
  assert.equal(title.caution, null);
  // The red mark sits beside the title's line: the title must be cut out
  // pixel by pixel, never with a box that would take the initials too.
  for (const rect of title.erase) assert.ok(rect.u1 < 62 || rect.u0 > 67 || rect.v1 < 22 || rect.v0 > 28);
});

test("unpacks 1-bit gray rows, padded to whole bytes, with 1 as white", () => {
  // 10 pixels wide → 2 bytes per row. Row 0: black,white,black,white,... ; row 1: all white.
  const bits = Uint8Array.from([0b01010101, 0b01000000, 0xff, 0xff]);
  const gray = unpackGray1bpp(bits, 10, 2);
  assert.deepEqual(Array.from(gray.slice(0, 10)), [0, 255, 0, 255, 0, 255, 0, 255, 0, 255]);
  assert.ok(gray.slice(10).every((value) => value === 255));
});

test("reads a black-and-white scan and finds the table cells in it", async () => {
  const pdf = await bilevelPdf();
  const { pages } = await loadScanPages(pdf);
  assert.equal(Math.round(pages[0].width), PAGE.width);
  assert.ok((pages[0].luminance(150, 29) ?? 255) < 100, "title bar is not where it should be");
  assert.ok((pages[0].luminance(150, 45) ?? 0) > 200, "blank area reads dark");

  const plan = await planOverlay(pdf, BLOCKS);
  assert.deepEqual(plan.unplaced, []);
  assert.ok(itemFor(plan, LINES.weightValue.id), "two-line cell was not placed");
});

// ---------- OCR'ın ayırmadığı imza (BASF mektubu gibi) ----------

/** A blue signature scribble whose tail runs into the title's last letters. */
function scribbleSvg(): string {
  const px = (value: number) => value * PX;
  return `<path d="M ${px(181)} ${px(36)} C ${px(196)} ${px(2)}, ${px(212)} ${px(30)}, ${px(228)} ${px(14)} S ${px(255)} ${px(4)}, ${px(282)} ${px(18)}" fill="none" stroke="#2f5bd0" stroke-width="${px(1.1)}"/>`;
}
const TITLE_BLOCK: LayoutBlock = {
  kind: "paragraph",
  role: "title",
  page: 1,
  lines: [LINES.title],
  frame: frame(TITLE.x0, TITLE.y0, TITLE.x1, TITLE.y1),
};

test("finds a signature the OCR did not separate and masks only its ink", async () => {
  const seen: string[] = [];
  const plan = await planOverlay(await scannedPdf({ extra: scribbleSvg() }), [TITLE_BLOCK], {
    classify: async (dataUrl) => {
      seen.push(dataUrl);
      return "signature";
    },
  });
  assert.ok(seen.length >= 1 && seen.every((url) => url.startsWith("data:image/jpeg;base64,")));
  const mark = plan.items.find((item) => item.mark);
  assert.ok(mark, "signature was not found");
  assert.equal(mark.mark, "signature");
  assert.equal(mark.erase.length, 0, "a box would take the printed text around the signature");
  assert.equal(mark.masks.length, 1);
  assert.ok(mark.masks[0].rect.u1 >= 280 && mark.masks[0].rect.u0 <= 188, "mask does not span the signature");
  // The label sits in the free paper above the title, not over it.
  assert.ok(mark.area.v1 <= TITLE.y0 + 0.5, `label area ends at ${mark.area.v1.toFixed(1)}`);
  // The printed title the blue ink crosses keeps its own black pixels: only the
  // blue stroke where it passes is masked, and an untranslated title is never
  // retyped from the OCR's reading.
  const title = itemFor(plan, LINES.title.id)!;
  assert.notEqual(itemAction(title, [{ source: LINES.title.text, translation: LINES.title.text }]), "rewrite");
  const [mask] = mark.masks;
  const bits = Buffer.from(mask.bits, "base64");
  const du = (mask.rect.u1 - mask.rect.u0) / mask.w;
  const dv = (mask.rect.v1 - mask.rect.v0) / mask.h;
  let total = 0;
  let inTitle = 0;
  for (let y = 0; y < mask.h; y++) {
    for (let x = 0; x < mask.w; x++) {
      const index = y * mask.w + x;
      if (!((bits[index >> 3] >> (index & 7)) & 1)) continue;
      total++;
      const u = mask.rect.u0 + (x + 0.5) * du;
      const v = mask.rect.v0 + (y + 0.5) * dv;
      if (u > TITLE.x0 && u < TITLE.x1 && v > TITLE.y0 && v < TITLE.y1) inTitle++;
    }
  }
  assert.ok(inTitle < total * 0.15, `${inTitle} of ${total} mask pixels sit on the title`);
});

test("leaves ink alone when the classifier says it is a logo or text", async () => {
  for (const kind of ["logo", "text", "unknown"] as const) {
    const plan = await planOverlay(await scannedPdf({ extra: scribbleSvg() }), [TITLE_BLOCK], { classify: async () => kind });
    assert.equal(plan.items.some((item) => item.mark), false, kind);
  }
});

test("takes a line the OCR read out of the signature itself off the page", async () => {
  const misread = line("Jill Hollman");
  const blocks: LayoutBlock[] = [
    TITLE_BLOCK,
    { kind: "paragraph", role: "text", page: 1, lines: [misread], frame: frame(214, 4, 284, 22) },
  ];
  const plan = await planOverlay(await scannedPdf({ extra: scribbleSvg() }), blocks, { classify: async () => "signature" });
  assert.equal(itemFor(plan, misread.id), undefined, "the misread signature would be written as text");
  assert.match(plan.unplaced.find((entry) => entry.id === misread.id)?.reason ?? "", /İmzanın kendisi/);
  assert.ok(itemFor(plan, LINES.title.id), "the printed title was taken with it");
});

// ---------- sıkı satır aralıklı paragraf (BASF 6. sayfa) ----------

/**
 * A line of lowercase text with ascenders and descenders: in single-spaced
 * text the descenders of one line reach the ascenders of the next, so there is
 * no blank pixel row between the lines at all.
 */
function textLine(x0: number, x1: number, top: number, xHeight: number, reach: number): string {
  const strokes: string[] = [];
  let i = 0;
  for (let x = x0; x + 0.7 <= x1; x += 1.6, i++) {
    const y0 = i % 4 === 0 ? top - reach : top;
    const y1 = i % 5 === 0 ? top + xHeight + reach : top + xHeight;
    strokes.push(`<rect x="${x * PX}" y="${y0 * PX}" width="${0.7 * PX}" height="${(y1 - y0) * PX}" fill="#111"/>`);
  }
  return strokes.join("");
}

test("tells apart the lines of a single-spaced paragraph whose descenders touch the next line", async () => {
  const tops = [38, 45, 52];
  const extra = tops.map((top) => textLine(30, 270, top, 4.2, 1.9)).join("");
  const paragraph = line("The United States Postal Service recently changed the zip code for the address");
  const blocks: LayoutBlock[] = [{ kind: "paragraph", role: "text", page: 1, lines: [paragraph], frame: frame(28, 35, 272, 58.5) }];
  const plan = await planOverlay(await scannedPdf({ extra }), blocks);
  const item = itemFor(plan, paragraph.id);
  assert.ok(item, "paragraph was not placed");
  assert.ok(Math.abs(item.leading - 7) < 0.7, `line spacing ${item.leading.toFixed(2)}, the lines are 7 pt apart`);
  assert.ok(item.fontSize > 5 && item.fontSize < 7.5, `font size ${item.fontSize}`);
  assert.equal(item.erase.length + item.masks.length >= 3, true, "each line should be erased on its own");
});

function streamText(stream: PDFRawStream): string {
  const raw = Buffer.from(stream.getContents());
  const filter = String(stream.dict.get(PDFName.of("Filter")) ?? "");
  return (filter.includes("FlateDecode") ? inflateSync(raw) : raw).toString("latin1");
}

test("writes a longer translation at the original size, running on into the blank paper below", async () => {
  const tops = [38, 45, 52];
  const extra = tops.map((top) => textLine(30, 270, top, 4.2, 1.9)).join("");
  const paragraph = line("The United States Postal Service recently changed the zip code for the address");
  const blocks: LayoutBlock[] = [{ kind: "paragraph", role: "text", page: 1, lines: [paragraph], frame: frame(28, 35, 272, 58.5) }];
  // Nothing below the paragraph but paper.
  const pdf = await scannedPdf({ extra, bare: true });
  const plan = await planOverlay(pdf, blocks);
  const item = itemFor(plan, paragraph.id)!;
  assert.ok((item.room ?? 0) > 20, `room below ${item.room}`);
  // Four lines' worth of translation into a three-line paragraph.
  const long = "Amerika Birleşik Devletleri Posta Servisi kısa süre önce adresin posta kodunu değiştirmiştir; ".repeat(4).trim();
  const out = await renderOverlay(pdf, plan, new Map([[paragraph.id, { source: paragraph.text, translation: long }]]));
  const doc = await PDFDocument.load(out);
  const content = contentStreams(doc);
  assert.ok(content > 0);
  // The size the text was drawn at is in the content stream as "<size> Tf".
  const streams = [...doc.context.enumerateIndirectObjects()]
    .filter(([, object]) => object instanceof PDFRawStream)
    .map(([, object]) => streamText(object as PDFRawStream));
  const sizes = streams.flatMap((text) => [...text.matchAll(/([\d.]+) Tf/g)].map((match) => Number(match[1])));
  assert.ok(sizes.length > 0, "no text drawn");
  for (const size of sizes) assert.ok(Math.abs(size - item.fontSize) < 0.01, `drawn at ${size}, measured ${item.fontSize}`);
});

test("draws every patch before any text, so a patch never cuts through a neighbour's letters", async () => {
  const pdf = await scannedPdf();
  const plan = await planOverlay(pdf, BLOCKS.filter((block) => block.kind !== "image"));
  const texts = new Map(Object.values(LINES).map((l) => [l.id, { source: l.text, translation: `${l.text} çeviri` }]));
  const doc = await PDFDocument.load(await renderOverlay(pdf, plan, texts));
  const contents = doc.getPages()[0].node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  const ops = streams
    .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
    .map(streamText)
    .join("\n");
  const lastImage = ops.lastIndexOf(" Do");
  const firstText = ops.indexOf("BT");
  assert.ok(firstText > 0 && lastImage > 0);
  assert.ok(lastImage < firstText, "a paper patch is drawn after some text");
});

test("brings stray single-line measurements back to the page's own text size", () => {
  const body = { page: 1, weight: 100 };
  const items = [
    { ...body, size: 11.25 },
    { ...body, size: 11.25 },
    { ...body, size: 11.0 },
    { ...body, size: 12.75 }, // measurement noise
    { ...body, size: 10.25 },
    { page: 1, size: 8.75, weight: 90 }, // footer: a real, smaller size
    { page: 1, size: 8.75, weight: 90 },
    { page: 1, size: 16, weight: 20 }, // heading: really larger
    { page: 2, size: 12.75, weight: 100 }, // another page, its own sizes
  ];
  const snapped = snapSizes(items);
  assert.deepEqual(snapped.slice(0, 5), [11.25, 11.25, 11.25, 11.25, 11.25]);
  assert.deepEqual(snapped.slice(5, 7), [8.75, 8.75]);
  assert.equal(snapped[7], 16);
  assert.equal(snapped[8], 12.75);
});

test("a line the OCR read with confidence is never taken for the signature crossing it", async () => {
  const name = { id: "name1", text: "Christine Keating", confidence: 0.99, ocrWarning: null };
  // The scribble crosses a printed line drawn right under it.
  const extra = scribbleSvg() + bar(186, 30, 250, 36);
  const blocks: LayoutBlock[] = [
    TITLE_BLOCK,
    { kind: "paragraph", role: "text", page: 1, lines: [name], frame: frame(184, 29, 252, 37) },
  ];
  const plan = await planOverlay(await scannedPdf({ extra }), blocks, { classify: async () => "signature" });
  assert.equal(
    plan.unplaced.some((entry) => entry.id === name.id && /İmzanın kendisi/.test(entry.reason)),
    false,
    "a printed name read at 99% was dropped as a signature",
  );
});

test("a block does not take over the line of the block above it", async () => {
  // Two single lines 7 pt apart whose ascenders and descenders touch; the
  // second OCR box is a little too tall and reaches into the first line.
  const extra = textLine(30, 150, 38, 4.2, 1.9) + textLine(30, 200, 45, 4.2, 1.9);
  const first = line("Christine Keating");
  const second = line("Head of US Crop Protection Regulatory Affairs");
  const blocks: LayoutBlock[] = [
    { kind: "paragraph", role: "text", page: 1, lines: [first], frame: frame(28, 35, 152, 44) },
    { kind: "paragraph", role: "text", page: 1, lines: [second], frame: frame(28, 39, 202, 52) },
  ];
  const plan = await planOverlay(await scannedPdf({ extra, bare: true }), blocks);
  const top = itemFor(plan, first.id);
  const below = itemFor(plan, second.id);
  assert.ok(top && below, "a line was not placed");
  assert.ok(below.area.v0 > 42, `second line starts at ${below.area.v0.toFixed(1)}, inside the first line`);
});

test("bluish bits of a signature above the name are not taken for the name's line", async () => {
  // The OCR gives name, title and company as one block whose box also covers
  // the signature. Where the blue ink meets the black signature line the
  // scan blends it into small grey-blue bits, a short row above the name.
  const debris: string[] = [];
  for (let x = 182; x < 280; x += 4.5) {
    debris.push(`<rect x="${x * PX}" y="${43.5 * PX}" width="${1.2 * PX}" height="${3 * PX}" fill="#6a7a92"/>`);
  }
  const extra =
    debris.join("") +
    `<rect x="${180 * PX}" y="${47.6 * PX}" width="${110 * PX}" height="${0.6 * PX}" fill="#111"/>` +
    textLine(180, 212, 51, 4.2, 1.9) +
    textLine(180, 252, 61, 4.2, 1.9) +
    textLine(180, 234, 71, 4.2, 1.9);
  const name = line("Christine Keating");
  const title = line("Head of US Crop Protection Regulatory Affairs");
  const company = line("BASF Agricultural Solutions US LLC");
  const blocks: LayoutBlock[] = [
    { kind: "paragraph", role: "text", page: 1, lines: [name, title, company], frame: frame(178, 30, 292, 80) },
  ];
  const plan = await planOverlay(await scannedPdf({ extra, bare: true }), blocks);
  const top = itemFor(plan, name.id);
  const below = itemFor(plan, title.id);
  assert.ok(top && below, "a line was not placed");
  const rect = (item: NonNullable<typeof top>) => [...item.erase, ...item.masks.map((mask) => mask.rect)];
  assert.ok(Math.min(...rect(top).map((r) => r.v0)) > 47, "the name was placed on the signature's bits");
  assert.ok(Math.min(...rect(below).map((r) => r.v0)) > 57, "the title took over the name's line");
});

test("a translation running on into the paper below keeps a gap before the next line", async () => {
  const NEXT = 76;
  const tops = [30, 42, 54];
  const extra = tops.map((top) => textLine(30, 270, top, 7, 3)).join("") + textLine(30, 200, NEXT, 7, 3);
  const paragraph = line("The United States Postal Service recently changed the zip code for the address");
  const next = line("Registration Division");
  const blocks: LayoutBlock[] = [
    { kind: "paragraph", role: "text", page: 1, lines: [paragraph], frame: frame(28, 26, 272, 65) },
    { kind: "paragraph", role: "text", page: 1, lines: [next], frame: frame(28, NEXT - 3.5, 202, NEXT + 10.5) },
  ];
  const pdf = await scannedPdf({ extra, bare: true });
  const plan = await planOverlay(pdf, blocks);
  const item = itemFor(plan, paragraph.id)!;
  const below = itemFor(plan, next.id)!;
  // Two lines more than the original three: it shrinks and also runs on below.
  const long = "posta kodu değişti ".repeat(15).trim();
  const out = await renderOverlay(
    pdf,
    plan,
    new Map([
      [paragraph.id, { source: paragraph.text, translation: long }],
      [next.id, { source: next.text, translation: "Tescil Bölümü" }],
    ]),
  );
  const doc = await PDFDocument.load(out);
  const drawn = [...doc.context.enumerateIndirectObjects()]
    .filter(([, object]) => object instanceof PDFRawStream)
    .map(([, object]) => streamText(object as PDFRawStream))
    .flatMap((text) => [...text.matchAll(/([\d.]+) Tf[\s\S]*?([\d.-]+) ([\d.-]+) Tm/g)])
    .map((match) => ({ size: Number(match[1]), v: PAGE.height - Number(match[3]) }))
    .sort((a, b) => a.v - b.v);
  const last = drawn.filter((entry) => entry.v < below.area.v0).at(-1)!;
  assert.ok(last, "the paragraph was not drawn");
  const bottom = last.v + last.size * 0.22;
  const gap = below.area.v0 + 1 - bottom;
  assert.ok(gap >= item.leading * 0.2 - 0.25, `only ${gap.toFixed(2)} pt left before the next line (leading ${item.leading.toFixed(2)})`);
});

// ---------- imza ile mühür yan yana; mühür OCR kutusundan taşıyor (Priaxor 2. sayfa) ----------

/** Classifier stand-in that looks at the crop's ink colour: blue → signature, teal → stamp. */
async function byColour(dataUrl: string): Promise<"signature" | "stamp" | "text"> {
  const { data, info } = await sharp(Buffer.from(dataUrl.split(",")[1], "base64")).raw().toBuffer({ resolveWithObject: true });
  let blue = 0;
  let teal = 0;
  for (let i = 0; i < info.width * info.height; i++) {
    const [r, g, b] = [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
    if (Math.max(r, g, b) - Math.min(r, g, b) < 60) continue;
    if (b > g + 40 && b > r + 40) blue++;
    else if (g > r + 40 && Math.abs(g - b) < 70) teal++;
  }
  if (!blue && !teal) return "text";
  return blue >= teal ? "signature" : "stamp";
}

function maskBit(mask: { rect: Rect; w: number; h: number; bits: string }, u: number, v: number): boolean {
  const x = Math.floor(((u - mask.rect.u0) / (mask.rect.u1 - mask.rect.u0)) * mask.w);
  const y = Math.floor(((v - mask.rect.v0) / (mask.rect.v1 - mask.rect.v0)) * mask.h);
  if (x < 0 || y < 0 || x >= mask.w || y >= mask.h) return false;
  const index = y * mask.w + x;
  return ((Buffer.from(mask.bits, "base64")[index >> 3] >> (index & 7)) & 1) === 1;
}

const RING = { cx: 190, cy: 150, r: 28 };
function signatureAndStampSvg(): string {
  const px = (value: number) => value * PX;
  return [
    bar(20, 20, 150, 27),
    bar(20, 35, 140, 42),
    `<path d="M ${px(40)} ${px(160)} C ${px(55)} ${px(120)}, ${px(75)} ${px(175)}, ${px(95)} ${px(140)} S ${px(130)} ${px(130)}, ${px(150)} ${px(150)}" fill="none" stroke="#2438b8" stroke-width="${px(1.2)}"/>`,
    `<circle cx="${px(RING.cx)}" cy="${px(RING.cy)}" r="${px(RING.r)}" fill="none" stroke="#1f9a7a" stroke-width="${px(1.6)}"/>`,
    `<circle cx="${px(RING.cx)}" cy="${px(RING.cy)}" r="${px(RING.r - 9)}" fill="none" stroke="#1f9a7a" stroke-width="${px(1.2)}"/>`,
  ].join("");
}
const TEXT_ROWS = line("BASF Agricultural Solutions Deutschland GmbH");
const SIDE_BY_SIDE: LayoutBlock[] = [
  { kind: "paragraph", role: "text", page: 1, lines: [TEXT_ROWS], frame: frame(18, 18, 152, 44) },
  // The OCR's stamp box covers only the middle of the ring.
  { kind: "image", page: 1, image: "stamp", lines: [], frame: frame(175, 135, 205, 165) },
];

test("a signature beside the OCR's stamp is still found and gets its own label", async () => {
  const plan = await planOverlay(await scannedPdf({ extra: signatureAndStampSvg(), bare: true }), SIDE_BY_SIDE, { classify: byColour });
  const signature = plan.items.find((item) => item.mark === "signature");
  assert.ok(signature, "the signature next to the stamp was left on the page");
  assert.ok(signature.masks.some((mask) => maskBit(mask, 95, 140)), "the signature's ink is not erased");
  assert.equal(plan.items.filter((item) => item.mark === "stamp").length, 1, "the stamp got a second label");
});

test("ink wholly inside the OCR's stamp is that stamp, whatever the classifier calls it: one label, not two", async () => {
  // DELAN SC garanti mektubu 6. sayfa: mavi mührün mürekkebine "imza" denince
  // mührün ortasına "[MÜHÜR]" ile "[İMZA]" üst üste yazılıyordu.
  const px = (value: number) => value * PX;
  const extra =
    `<circle cx="${px(190)}" cy="${px(150)}" r="${px(22)}" fill="none" stroke="#2f5bd0" stroke-width="${px(1.4)}"/>` +
    `<circle cx="${px(190)}" cy="${px(150)}" r="${px(12)}" fill="none" stroke="#2f5bd0" stroke-width="${px(1)}"/>`;
  const blocks: LayoutBlock[] = [{ kind: "image", page: 1, image: "stamp", lines: [], frame: frame(164, 124, 216, 176) }];
  // Sayfada basılı yazı olmalı: yazı rengi ölçülemeyen sayfada mühür aday bile olmuyordu.
  const printed = bar(20, 20, 150, 27) + bar(20, 35, 140, 42);
  const plan = await planOverlay(await scannedPdf({ extra: printed + extra, bare: true }), blocks, { classify: byColour });
  assert.deepEqual(plan.items.filter((item) => item.mark).map((item) => item.mark), ["stamp"]);
});

test("the OCR's stamp region is left as clean paper: no faint ring of the stamp comes back", async () => {
  // DELAN SC garanti mektubu 6. sayfa: bölge temizlendikten sonra birleştirilen
  // mürekkep maskesinin yaması üstüne çiziliyor, mührün soluk halesini geri getiriyordu.
  const px = (value: number) => value * PX;
  // Mührün çevresinde kağıda yakın soluk bir hale (taramadaki gibi).
  const extra =
    bar(20, 20, 150, 27) +
    bar(20, 35, 140, 42) +
    `<circle cx="${px(190)}" cy="${px(150)}" r="${px(22)}" fill="none" stroke="#dfe4f0" stroke-width="${px(5)}"/>` +
    `<circle cx="${px(190)}" cy="${px(150)}" r="${px(22)}" fill="none" stroke="#2f5bd0" stroke-width="${px(1.4)}"/>`;
  const blocks: LayoutBlock[] = [{ kind: "image", page: 1, image: "stamp", lines: [], frame: frame(160, 120, 220, 180) }];
  const pdf = await scannedPdf({ extra, bare: true });
  const plan = await planOverlay(pdf, blocks, { classify: byColour });
  const stamp = plan.items.find((item) => item.mark === "stamp");
  assert.ok(stamp && stamp.masks.length > 0, "the stamp's ink was not merged into the OCR's stamp");
  const out = await renderOverlay(pdf, { ...plan, items: [stamp] }, new Map(), { targetLang: "tr-TR" });
  const scale = 4;
  const width = PAGE.width * scale;
  const after = await renderPdfPage(out, 0, { width, height: PAGE.height * scale });
  const lum = (i: number) => 0.299 * after[i * 4] + 0.587 * after[i * 4 + 1] + 0.114 * after[i * 4 + 2];
  // Halkanın geçtiği şerit (etiketin yazıldığı orta hariç): kağıttan belirgin koyu piksel kalmamalı.
  let faint = 0;
  let total = 0;
  for (let y = 124 * scale; y < 176 * scale; y++) {
    for (let x = 164 * scale; x < 216 * scale; x++) {
      const r = Math.hypot(x / scale - 190, y / scale - 150);
      if (r < 18 || r > 26 || Math.abs(y / scale - 150) < 9) continue;
      total++;
      if (lum(y * width + x) < 236) faint++;
    }
  }
  assert.ok(faint / total < 0.01, `${((faint / total) * 100).toFixed(1)}% of the stamp's ring is still visible`);
});

test("the stamp's ink outside the OCR's box is erased with it", async () => {
  const plan = await planOverlay(await scannedPdf({ extra: signatureAndStampSvg(), bare: true }), SIDE_BY_SIDE, { classify: byColour });
  const stamp = plan.items.find((item) => item.mark === "stamp")!;
  const left = RING.cx - RING.r;
  const top = RING.cy - RING.r;
  assert.ok(stamp.masks.some((mask) => maskBit(mask, left, RING.cy)), "the ring's left edge is left on the page");
  assert.ok(stamp.masks.some((mask) => maskBit(mask, RING.cx, top)), "the ring's top edge is left on the page");
});

// ---------- siyah imza basılı satırın üstünden geçiyor (NJ mektubu 3. sayfa) ----------

test("a black signature crossing a printed line is erased there too, and the line is rewritten", async () => {
  const px = (value: number) => value * PX;
  // "Sincerely," above, the signature's loop reaching up through it.
  const closing = line("Sincerely,");
  const extra =
    textLine(30, 80, 40, 4.2, 1.9) +
    `<path d="M ${px(50)} ${px(36)} C ${px(80)} ${px(30)}, ${px(78)} ${px(55)}, ${px(58)} ${px(75)} C ${px(45)} ${px(88)}, ${px(35)} ${px(80)}, ${px(50)} ${px(68)} S ${px(120)} ${px(60)}, ${px(170)} ${px(66)}" fill="none" stroke="#111" stroke-width="${px(0.9)}"/>`;
  const blocks: LayoutBlock[] = [{ kind: "paragraph", role: "text", page: 1, lines: [closing], frame: frame(28, 37, 82, 48) }];
  const plan = await planOverlay(await scannedPdf({ extra, bare: true }), blocks, { classify: async () => "signature" });
  const mark = plan.items.find((item) => item.mark === "signature");
  assert.ok(mark, "signature missed");
  // Where the stroke passes through the printed line (u≈67, v≈41.5) its ink goes too.
  assert.ok(mark.masks.some((mask) => maskBit(mask, 67, 41.4)), "the stroke is left where it crosses the printed line");
  const printed = itemFor(plan, closing.id);
  assert.ok(printed, "the printed line was not placed");
  assert.equal(printed.redraw, true, "the printed line under the erased stroke is not rewritten");
});

test("a line whose black letters the stamp's mask takes with it is rewritten", async () => {
  // Priaxor 2. sayfa: the stamp's arc runs through "Deutschland GmbH". Where
  // teal ink sits on a black letter the scan shows a dark, nearly colourless
  // blend; the colour mask takes it and the letters were left half erased.
  const px = (value: number) => value * PX;
  const rows = textLine(120, 230, 31, 4.2, 1.9);
  const heading = line("BASF Agricultural Solutions Deutschland GmbH");
  const ring = (colour: string, clip = "") =>
    `<circle cx="${px(222)}" cy="${px(61)}" r="${px(26)}" fill="none" stroke="${colour}" stroke-width="${px(0.8)}"${clip}/>`;
  const extra =
    rows +
    ring("#1f9a7a") +
    `<clipPath id="letters">${rows}</clipPath>` +
    ring("#1b3a31", ` clip-path="url(#letters)"`);
  const blocks: LayoutBlock[] = [{ kind: "paragraph", role: "title", page: 1, lines: [heading], frame: frame(118, 28, 232, 39) }];
  const plan = await planOverlay(await scannedPdf({ extra, bare: true }), blocks, { classify: byColour });
  assert.ok(plan.items.some((item) => item.mark === "stamp"), "stamp missed");
  assert.equal(itemFor(plan, heading.id)?.redraw, true, "the heading the stamp's mask cut into is not rewritten");
});

// ---------- çevrilmeyen satır OCR'dan yeniden yazılmaz (NJ mektubu: "Jill Hollman") ----------

test("an unchanged name the signature crosses keeps its own printed pixels, not the OCR's reading", async () => {
  const px = (value: number) => value * PX;
  // Printed name at v 60–64 (u 40–120), the signature line just above it, a
  // blue signature looping down through both.
  const extra =
    textLine(40, 120, 60, 4.2, 1.9) +
    `<rect x="${px(30)}" y="${px(55)}" width="${px(120)}" height="${px(0.6)}" fill="#111"/>` +
    `<path d="M ${px(45)} ${px(40)} C ${px(70)} ${px(75)}, ${px(90)} ${px(30)}, ${px(105)} ${px(66)} S ${px(125)} ${px(45)}, ${px(140)} ${px(50)}" fill="none" stroke="#2f5bd0" stroke-width="${px(0.9)}"/>`;
  // The OCR misread the printed name; the name is not translated.
  const name = line("Jill Hollman");
  const blocks: LayoutBlock[] = [{ kind: "paragraph", role: "text", page: 1, lines: [name], frame: frame(38, 56, 122, 68) }];
  const pdf = await scannedPdf({ extra, bare: true });
  const plan = await planOverlay(pdf, blocks, { classify: byColour });
  assert.ok(plan.items.some((item) => item.mark === "signature"), "signature missed");
  const out = await renderOverlay(pdf, plan, new Map([[name.id, { source: name.text, translation: name.text }]]), { targetLang: "tr-TR" });

  const scale = 4;
  const width = PAGE.width * scale;
  const height = PAGE.height * scale;
  const before = await renderPdfPage(pdf, 0, { width, height });
  const after = await renderPdfPage(out, 0, { width, height });
  const dark = (rgba: Uint8ClampedArray, i: number) => rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2] < 330 && Math.abs(rgba[i * 4 + 2] - rgba[i * 4]) < 40;
  // The name's own strokes (v 58–66): the same pixels are dark before and after.
  let both = 0;
  let either = 0;
  for (let v = 58 * scale; v < 66 * scale; v++) {
    for (let u = 40 * scale; u < 120 * scale; u++) {
      const i = v * width + u;
      const b = dark(before, i);
      const a = dark(after, i);
      if (a && b) both++;
      if (a || b) either++;
    }
  }
  assert.ok(both / either > 0.8, `the name was retyped or damaged: overlap ${(both / either).toFixed(2)}`);
  // The blue ink is gone.
  let blue = 0;
  for (let i = 0; i < width * height; i++) if (after[i * 4 + 2] - after[i * 4] > 60 && after[i * 4] < 150) blue++;
  assert.ok(blue < 20, `${blue} blue pixels left`);
  // The signature line runs on unbroken where the signature crossed it.
  let gaps = 0;
  for (let u = 32 * scale; u < 148 * scale; u++) {
    let covered = false;
    for (let v = Math.floor(54.3 * scale); v <= Math.ceil(56.3 * scale) && !covered; v++) covered = dark(after, v * width + u);
    if (!covered) gaps++;
  }
  assert.ok(gaps <= 2, `the signature line is broken in ${gaps} columns`);
});

test("the dark core of a blue signature stroke is not brought back with the unchanged name", async () => {
  // NJ mektubu 1. sayfa: isim satırının alanı imzanın kıvrımını da içine alınca
  // mavi imzanın koyu, renksiz görünen çekirdeği basılı mürekkep sayılıp isimle
  // birlikte geri konuyordu; silinen imzanın yerinde noktalar ve düz kuyruğu
  // kısa bir çizgi olarak kalıyordu. Geri koyma imzayı da kapsayan alanla sınanır.
  const px = (value: number) => value * PX;
  const path = `M ${px(45)} ${px(40)} C ${px(70)} ${px(75)}, ${px(90)} ${px(30)}, ${px(105)} ${px(66)} S ${px(125)} ${px(45)}, ${px(140)} ${px(50)}`;
  const extra =
    textLine(40, 120, 60, 4.2, 1.9) +
    `<rect x="${px(30)}" y="${px(55)}" width="${px(120)}" height="${px(0.6)}" fill="#111"/>` +
    `<path d="${path}" fill="none" stroke="#7d93d2" stroke-width="${px(1.4)}"/>` +
    `<path d="${path}" fill="none" stroke="#2b303d" stroke-width="${px(0.5)}"/>`;
  const pdf = await scannedPdf({ extra, bare: true });
  const { pages } = await loadScanPages(pdf);
  const patch = await inkPatch(pages[0], 0, { u0: 38, v0: 34, u1: 146, v1: 70 });
  assert.ok(patch, "no ink restored at all");
  const { data, info } = await sharp(Buffer.from(patch.png)).raw().toBuffer({ resolveWithObject: true });
  const scale = info.width / (patch.box.u1 - patch.box.u0);
  const before = await renderPdfPage(pdf, 0, { width: PAGE.width * 4, height: PAGE.height * 4 });
  let core = 0;
  let restored = 0;
  let letters = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const u = patch.box.u0 + (x + 0.5) / scale;
      const v = patch.box.v0 + (y + 0.5) / scale;
      // Geri konan koyu piksel; kağıt rengiyle boyanan piksel sayılmaz.
      const o = (y * info.width + x) * 4;
      const drawn = data[o + 3] > 0 && 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2] < 150;
      const onName = v >= 57 && v < 67 && u < 121;
      const onLine = v >= 54.3 && v < 56.3;
      if (onName && drawn) letters++;
      if (onName || onLine) continue;
      const i = Math.floor(v * 4) * PAGE.width * 4 + Math.floor(u * 4);
      const [r, g, b] = [before[i * 4], before[i * 4 + 1], before[i * 4 + 2]];
      if (0.299 * r + 0.587 * g + 0.114 * b > 90 || Math.max(r, g, b) - Math.min(r, g, b) > 30) continue;
      core++;
      if (drawn) restored++;
    }
  }
  assert.ok(core > 100, "the sample has no dark core to test");
  assert.ok(letters > 500, "the printed name was not restored");
  assert.ok(restored / core < 0.03, `${restored} of ${core} pixels of the signature's dark core were restored as ink`);
});

test("a text row's own underline is not redrawn under its translation; a table border through the row is", () => {
  // NJ mektubu 3. sayfa: e-posta bağlantısının mavi alt çizgisi sayfanın
  // çizgisi olarak modellenmişti; satır çevrilince yamanın kenarındaki çizgi
  // sanılıp yeni yazının altına yeniden çiziliyordu.
  const underline = { orientation: "h" as const, a: 572.9, b: 0, start: 249.3, end: 371.1, thickness: 0.96, color: [133, 190, 206] as [number, number, number] };
  const row = { u0: 213.9, v0: 561.3, u1: 372.8, v1: 575.9 };
  assert.deepEqual(rulePatchCuts(underline, [{ rect: row, mark: false }]), []);
  const border = { ...underline, start: 100, end: 500, color: [20, 20, 20] as [number, number, number] };
  assert.equal(rulePatchCuts(border, [{ rect: row, mark: false }]).length, 1);
  // Bir işaretin (imza) kestiği çizgi her zaman yeniden çizilir.
  assert.equal(rulePatchCuts(underline, [{ rect: row, mark: true }]).length, 1);
});

test("a rule is redrawn only where a patch cut it, and a mark's own tail is not a rule", () => {
  const rule = { orientation: "h" as const, a: 55, b: 0, start: 30, end: 150, thickness: 0.6, color: [20, 20, 20] as [number, number, number] };
  const cuts = ruleCuts(rule, [{ u0: 40, v0: 35, u1: 145, v1: 83 }]);
  assert.equal(cuts.length, 1);
  assert.ok(cuts[0][0] <= 40 && cuts[0][0] >= 39 && cuts[0][1] >= 145 && cuts[0][1] <= 146, JSON.stringify(cuts));
  assert.deepEqual(ruleCuts(rule, [{ u0: 40, v0: 70, u1: 145, v1: 83 }]), [], "a patch beside the rule does not cut it");
  // The signature spans u 44–140: the line runs on well past it.
  assert.equal(insideMark(rule, { u0: 44, v0: 40, u1: 140, v1: 70 }), false);
  // A straight flourish drawn inside the signature itself.
  const tail = { ...rule, start: 60, end: 130 };
  assert.equal(insideMark(tail, { u0: 44, v0: 40, u1: 140, v1: 70 }), true);
  // A stamp: its teal arc crossing the heading is the stamp, the black line through it is not.
  const stamp = { u0: 230, v0: 360, u1: 346, v1: 474 };
  const arc = { orientation: "h" as const, a: 365, b: 0, start: 250, end: 340, thickness: 0.8, color: [40, 150, 120] as [number, number, number] };
  assert.equal(insideMark(arc, stamp, true), true, "the stamp's arc was kept as a rule");
  assert.equal(insideMark({ ...arc, color: [30, 30, 30], start: 100, end: 400 }, stamp, true), false);
});

test("a black printed line inside the OCR's box of a blue signature is kept and redrawn; a black signature's own tail is not", async () => {
  // DELAN SC garanti mektubu 6. sayfa: OCR'ın imza görseli çizginin tamamını
  // sarıyordu, çizgi imzanın kuyruğu sayılıp silindi, yerine çizilmedi.
  const px = (value: number) => value * PX;
  const scribble = (colour: string) =>
    `<path d="M ${px(45)} ${px(40)} C ${px(70)} ${px(75)}, ${px(90)} ${px(30)}, ${px(105)} ${px(52)} S ${px(125)} ${px(45)}, ${px(140)} ${px(50)}" fill="none" stroke="${colour}" stroke-width="${px(0.9)}"/>`;
  const printed = `<rect x="${px(40)}" y="${px(55)}" width="${px(100)}" height="${px(0.6)}" fill="#111"/>`;
  const box: LayoutBlock[] = [{ kind: "image", page: 1, image: "signature", lines: [], frame: frame(35, 35, 145, 60) }];
  const lineAt = (plan: OverlayPlan) => plan.pages[0].rules?.find((r) => r.orientation === "h" && Math.abs(r.a - 55.3) < 1.5);

  const blue = await planOverlay(await scannedPdf({ extra: printed + scribble("#2f5bd0"), bare: true }), box);
  assert.ok(lineAt(blue), "the printed line under the blue signature was taken for its tail");

  const black = await planOverlay(await scannedPdf({ extra: printed + scribble("#161616"), bare: true }), box);
  assert.equal(lineAt(black), undefined, "a black signature's straight stroke must not come back as a line");
});

test("the signature label keeps off the signature line and the lines around it", async () => {
  const px = (value: number) => value * PX;
  // Signature over its line (v 55), the printed name just under the line.
  const extra =
    textLine(40, 120, 58, 4.2, 1.2) +
    `<rect x="${px(30)}" y="${px(55)}" width="${px(120)}" height="${px(0.6)}" fill="#111"/>` +
    `<path d="M ${px(45)} ${px(40)} C ${px(70)} ${px(75)}, ${px(90)} ${px(30)}, ${px(105)} ${px(66)} S ${px(125)} ${px(45)}, ${px(140)} ${px(50)}" fill="none" stroke="#2f5bd0" stroke-width="${px(0.9)}"/>`;
  const name = line("Jill Holihan");
  const blocks: LayoutBlock[] = [{ kind: "paragraph", role: "text", page: 1, lines: [name], frame: frame(38, 56, 122, 66) }];
  const pdf = await scannedPdf({ extra, bare: true });
  const plan = await planOverlay(pdf, blocks, { classify: byColour });
  const mark = plan.items.find((item) => item.mark === "signature");
  assert.ok(mark, "signature missed");
  const doc = await PDFDocument.create();
  const font = await fontsFor(doc)(mark.family ?? "serif", false);
  const laid = layoutItemText(mark, ["[İMZA]"], font, markObstacles(plan, mark));
  const top = laid.lines[0].baseline - laid.size * 0.72;
  const bottom = laid.lines[0].baseline + laid.size * 0.2;
  const rule = plan.pages[0].rules?.find((r) => r.orientation === "h" && Math.abs(r.a - 55.3) < 1.5);
  assert.ok(rule, "the signature line was not modelled");
  assert.ok(bottom <= rule.a - rule.thickness / 2 || top >= rule.a + rule.thickness / 2 + 4.5, `label ${top.toFixed(1)}–${bottom.toFixed(1)} sits on the line at ${rule.a.toFixed(1)}`);
  assert.ok(bottom <= 57 || top >= 66, "the label sits on the printed name");
});

// ---------- dolgu dokusu (NJ 3. sayfa: noktacıklı kağıtta imzanın açık hayaleti) ----------

test("an erased signature on speckled paper is filled with the same speckle, not with clean paper", async () => {
  const px = (value: number) => value * PX;
  let state = 11;
  const next = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  const dots: string[] = [];
  for (let i = 0; i < 2600; i++) {
    dots.push(`<rect x="${(next() * PAGE.width * PX).toFixed(0)}" y="${(next() * PAGE.height * PX).toFixed(0)}" width="2" height="2" fill="#333"/>`);
  }
  const extra =
    textLine(30, 250, 20, 4.2, 1.9) +
    textLine(30, 230, 30, 4.2, 1.9) +
    textLine(30, 240, 40, 4.2, 1.9) +
    dots.join("") +
    `<path d="M ${px(60)} ${px(120)} C ${px(90)} ${px(80)}, ${px(120)} ${px(160)}, ${px(150)} ${px(110)} S ${px(200)} ${px(90)}, ${px(230)} ${px(125)}" fill="none" stroke="#111" stroke-width="${px(1.2)}"/>`;
  const pdf = await scannedPdf({ extra, bare: true });
  const heading = line("Speckled page");
  const blocks: LayoutBlock[] = [{ kind: "paragraph", role: "text", page: 1, lines: [heading], frame: frame(28, 16, 252, 27) }];
  const plan = await planOverlay(pdf, blocks, { classify: async () => "signature" });
  const mark = plan.items.find((item) => item.mark === "signature");
  assert.ok(mark, "signature missed");
  const out = await renderOverlay(pdf, { ...plan, items: [mark] }, new Map(), { targetLang: "tr-TR" });
  const scale = 4;
  const width = PAGE.width * scale;
  const height = PAGE.height * scale;
  const before = await renderPdfPage(pdf, 0, { width, height });
  const after = await renderPdfPage(out, 0, { width, height });
  const lum = (rgba: Uint8ClampedArray, i: number) => 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  // Speckle density inside the erased box (above and below the label) against the paper just below it.
  const [mask] = mark.masks;
  const density = (u0: number, v0: number, u1: number, v1: number) => {
    let dark = 0;
    let total = 0;
    for (let y = Math.round(v0 * scale); y < Math.round(v1 * scale); y++) {
      for (let x = Math.round(u0 * scale); x < Math.round(u1 * scale); x++) {
        total++;
        if (lum(after, y * width + x) < 120) dark++;
      }
    }
    return dark / total;
  };
  const inside = (density(mask.rect.u0 + 2, mask.rect.v0 + 2, mask.rect.u1 - 2, mask.rect.v0 + 18) + density(mask.rect.u0 + 2, mask.rect.v1 - 18, mask.rect.u1 - 2, mask.rect.v1 - 2)) / 2;
  const around = density(mask.rect.u0, mask.rect.v1 + 4, mask.rect.u1, mask.rect.v1 + 40);
  void before;
  assert.ok(around > 0.005, "the page has no speckle to compare with");
  assert.ok(inside > around * 0.5 && inside < around * 1.6, `speckle inside the erased box ${(inside * 100).toFixed(2)}% against ${(around * 100).toFixed(2)}% around it`);
});

// ---------- mavi köprü satırı (NJ 3. sayfa: e-posta bağlantısı) ----------

test("a black label with a blue underlined link after it goes entirely, even where the link's letters touch the underline", async () => {
  // NJ mektubu 3. sayfa: "Email:" siyah, adres mavi ve altı çizili. Harflerin
  // alt uzantıları çizgiye değince bağlantı tek geniş parça oluyordu; harf
  // boyunda olmadığı için satıra katılmıyor, sağ yarısı mavi kırıntı olarak kalıyordu.
  const px = (value: number) => value * PX;
  const blue = "#2c6fc0";
  const extra =
    [20, 28, 36, 44, 175, 183, 191, 199].map((top) => textLine(30, 270, top, 4.2, 1.9)).join("") +
    textLine(60, 80, 60, 4.2, 1.9) +
    textLine(84, 170, 60, 4.2, 1.9).replaceAll("#111", blue) +
    `<rect x="${px(84)}" y="${px(65.8)}" width="${px(86)}" height="${px(0.6)}" fill="${blue}"/>` +
    `<path d="M ${px(60)} ${px(130)} C ${px(90)} ${px(90)}, ${px(120)} ${px(170)}, ${px(150)} ${px(120)} S ${px(200)} ${px(100)}, ${px(230)} ${px(135)}" fill="none" stroke="#2f5bd0" stroke-width="${px(1.2)}"/>`;
  const heading = line("Top line of text");
  const link = line("Email: someone@example.com");
  const blocks: LayoutBlock[] = [
    { kind: "paragraph", role: "text", page: 1, lines: [heading], frame: frame(28, 16, 252, 27) },
    { kind: "paragraph", role: "text", page: 1, lines: [link], frame: frame(58, 56, 172, 69) },
  ];
  const pdf = await scannedPdf({ extra, bare: true });
  const plan = await planOverlay(pdf, blocks, { classify: async (_url, where) => (where && where.rect.v0 > 80 ? "signature" : "text") });
  const item = plan.items.find((each) => each.lineIds.includes(link.id));
  assert.ok(item, "the link row was not placed");
  const scale = 4;
  const width = PAGE.width * scale;
  const before = await renderPdfPage(pdf, 0, { width, height: PAGE.height * scale });
  let oldInk = 0;
  let covered = 0;
  for (let y = 54 * scale; y < 70 * scale; y++) {
    for (let x = 55 * scale; x < 180 * scale; x++) {
      const i = y * width + x;
      if (!(before[i * 4 + 2] - before[i * 4] > 50 && before[i * 4] < 170)) continue;
      oldInk++;
      const u = (x + 0.5) / scale;
      const v = (y + 0.5) / scale;
      if (item.masks.some((mask) => maskBit(mask, u, v)) || item.erase.some((r) => u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1)) covered++;
    }
  }
  assert.ok(oldInk > 500, "the sample has no blue link");
  assert.ok(covered / oldInk > 0.97, `only ${((100 * covered) / oldInk).toFixed(1)}% of the old link is erased`);
  // Puntosu satırın bütün harflerinden ölçülür: siyah etiket kadar, bağlantı dahil.
  const heading2 = plan.items.find((each) => each.lineIds.includes(heading.id));
  assert.ok(heading2 && Math.abs(item.fontSize - heading2.fontSize) <= heading2.fontSize * 0.15, `link row ${item.fontSize}pt, body ${heading2?.fontSize}pt`);
  // Çeviriden sonra satırda mavi kalmaz: bağlantının alt çizgisi sayfanın
  // çizgisi sanılıp yeni yazının altına yeniden çiziliyordu (NJ 3. sayfa).
  const out = await renderOverlay(pdf, { ...plan, items: [item] }, new Map([[link.id, { source: link.text, translation: "E-posta: someone@example.com" }]]), { targetLang: "tr-TR" });
  const after = await renderPdfPage(out, 0, { width, height: PAGE.height * scale });
  let blueLeft = 0;
  for (let y = 54 * scale; y < 70 * scale; y++) {
    for (let x = 55 * scale; x < 180 * scale; x++) {
      const i = y * width + x;
      if (after[i * 4 + 2] - after[i * 4] > 40 && after[i * 4 + 2] > after[i * 4 + 1] + 20) blueLeft++;
    }
  }
  assert.ok(blueLeft < 60, `${blueLeft} blue pixels of the old link are left after the translation`);
});

test("a pale, blurred link whose letters break into dark crumbs goes entirely with its row", async () => {
  // NJ mektubu 3. sayfa: açık mavi, JPEG'le bulanık bağlantının yalnız en koyu
  // noktaları mürekkep eşiğini geçiyor, harfler 4-40 piksellik kırıntılara
  // bölünüyordu. Kırıntılar "başka bir işaret" sayılıp korunuyor, çevrelerini
  // de koruyordu; ".com"un sağında mavi noktalar kalıyordu.
  const px = (value: number) => value * PX;
  const pale = "#8fb0e0";
  const crumbs: string[] = [];
  for (let x = 85; x < 168; x += 2.3) {
    for (const y of [61, 63.4]) crumbs.push(`<rect x="${px(x)}" y="${px(y)}" width="${px(0.35)}" height="${px(0.35)}" fill="#1d4f9e"/>`);
  }
  const extra =
    [20, 28, 36, 44, 175, 183, 191, 199].map((top) => textLine(30, 270, top, 4.2, 1.9)).join("") +
    textLine(60, 80, 60, 4.2, 1.9) +
    textLine(84, 170, 60, 4.2, 1.9).replaceAll("#111", pale) +
    crumbs.join("") +
    `<rect x="${px(84)}" y="${px(66.6)}" width="${px(86)}" height="${px(0.5)}" fill="${pale}"/>`;
  const link = line("Email: someone@example.com");
  const blocks: LayoutBlock[] = [
    { kind: "paragraph", role: "text", page: 1, lines: [line("Top line of text")], frame: frame(28, 16, 252, 27) },
    { kind: "paragraph", role: "text", page: 1, lines: [link], frame: frame(58, 56, 172, 69) },
  ];
  const pdf = await scannedPdf({ extra, bare: true });
  const plan = await planOverlay(pdf, blocks, { classify: async () => "text" });
  const item = plan.items.find((each) => each.lineIds.includes(link.id));
  assert.ok(item, "the link row was not placed");
  const out = await renderOverlay(pdf, { ...plan, items: [item] }, new Map([[link.id, { source: link.text, translation: "E-posta: someone@example.com" }]]), { targetLang: "tr-TR" });
  const scale = 4;
  const width = PAGE.width * scale;
  const after = await renderPdfPage(out, 0, { width, height: PAGE.height * scale });
  // Kırıntıların yerinde koyu mavi kalmaz.
  let crumbsLeft = 0;
  let crumbCount = 0;
  for (let x = 85; x < 168; x += 2.3) {
    for (const y of [61, 63.4]) {
      crumbCount++;
      const i = Math.floor((y + 0.17) * scale) * width + Math.floor((x + 0.17) * scale);
      const lum = 0.299 * after[i * 4] + 0.587 * after[i * 4 + 1] + 0.114 * after[i * 4 + 2];
      if (lum < 140 && after[i * 4 + 2] - after[i * 4] > 30) crumbsLeft++;
    }
  }
  // Sentetik sayfa NJ'deki korunma durumunu tam üretmiyor; gerçek belgede
  // bağlantının dışarıda kalan mavisi 966 pikselden 89'a indi (ceviri:pdf-audit).
  assert.ok(crumbsLeft <= 3, `${crumbsLeft} of ${crumbCount} dark crumbs of the old link are left after the translation`);
});

test("tiny dark crumbs among a line's letters do not shrink its measured size", async () => {
  // NJ mektubu 3. sayfa: bulanık mavi bağlantının renksiz görünen minik koyu
  // noktaları satırın harfi sayılıp taban çizgisini yukarı çekti; e-posta
  // satırı 11 yerine 7,5 puntoyla yazıldı.
  const px = (value: number) => value * PX;
  const crumbs: string[] = [];
  for (let x = 85; x < 170; x += 3.1) crumbs.push(`<rect x="${px(x)}" y="${px(61.5 + (x % 2))}" width="${px(0.4)}" height="${px(0.4)}" fill="#333"/>`);
  const extra =
    [20, 28, 36, 44].map((top) => textLine(30, 270, top, 4.2, 1.9)).join("") +
    textLine(60, 80, 60, 4.2, 1.9) +
    textLine(84, 170, 60, 4.2, 1.9).replaceAll("#111", "#8fb0e0") +
    crumbs.join("") +
    textLine(60, 170, 90, 4.2, 1.9);
  const dotted = line("Email: someone@example.com");
  const clean = line("Phone: 0123 456 789 00");
  const blocks: LayoutBlock[] = [
    { kind: "paragraph", role: "text", page: 1, lines: [line("Top line")], frame: frame(28, 16, 272, 50) },
    { kind: "paragraph", role: "text", page: 1, lines: [dotted], frame: frame(58, 56, 172, 69) },
    { kind: "paragraph", role: "text", page: 1, lines: [clean], frame: frame(58, 86, 172, 99) },
  ];
  const plan = await planOverlay(await scannedPdf({ extra, bare: true }), blocks);
  const a = plan.items.find((each) => each.lineIds.includes(dotted.id));
  const b = plan.items.find((each) => each.lineIds.includes(clean.id));
  assert.ok(a && b, "rows not placed");
  assert.ok(Math.abs(a.fontSize - b.fontSize) <= b.fontSize * 0.1, `with crumbs ${a.fontSize}pt, clean ${b.fontSize}pt`);
});

test("a translated blue link row goes entirely, underline and all, though a blue signature is on the page", async () => {
  const px = (value: number) => value * PX;
  const blue = "#2c6fc0";
  // Mostly black print, as on a real letter: the page's ink is black.
  const extra =
    [20, 28, 36, 44, 175, 183, 191, 199].map((top) => textLine(30, 270, top, 4.2, 1.9)).join("") +
    textLine(60, 170, 60, 4.2, 1.9).replaceAll("#111", blue) +
    `<rect x="${px(60)}" y="${px(67)}" width="${px(110)}" height="${px(0.6)}" fill="${blue}"/>` +
    `<path d="M ${px(60)} ${px(130)} C ${px(90)} ${px(90)}, ${px(120)} ${px(170)}, ${px(150)} ${px(120)} S ${px(200)} ${px(100)}, ${px(230)} ${px(135)}" fill="none" stroke="#2f5bd0" stroke-width="${px(1.2)}"/>`;
  const heading = line("Top line of text");
  const link = line("Email: someone@example.com");
  const blocks: LayoutBlock[] = [
    { kind: "paragraph", role: "text", page: 1, lines: [heading], frame: frame(28, 16, 252, 27) },
    { kind: "paragraph", role: "text", page: 1, lines: [link], frame: frame(58, 56, 172, 69) },
  ];
  const pdf = await scannedPdf({ extra, bare: true });
  // The classifier sees a signature only where the scribble is; the link line is text.
  const plan = await planOverlay(pdf, blocks, { classify: async (_url, where) => (where && where.rect.v0 > 80 ? "signature" : "text") });
  assert.ok(plan.items.some((item) => item.mark === "signature"), "the page needs its blue signature");
  // Every blue pixel of the old link (letters and underline) is inside the row's erase mask.
  const item = plan.items.find((each) => each.lineIds.includes(link.id));
  assert.ok(item, "the link row was not placed");
  const scale = 4;
  const width = PAGE.width * scale;
  const height = PAGE.height * scale;
  const before = await renderPdfPage(pdf, 0, { width, height });
  let oldInk = 0;
  let covered = 0;
  for (let y = 54 * scale; y < 71 * scale; y++) {
    for (let x = 55 * scale; x < 180 * scale; x++) {
      const i = y * width + x;
      if (!(before[i * 4 + 2] - before[i * 4] > 50 && before[i * 4] < 170)) continue;
      oldInk++;
      const u = (x + 0.5) / scale;
      const v = (y + 0.5) / scale;
      if (item.masks.some((mask) => maskBit(mask, u, v)) || item.erase.some((r) => u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1)) covered++;
    }
  }
  assert.ok(covered / oldInk > 0.97, `only ${((100 * covered) / oldInk).toFixed(1)}% of the old link is erased`);
});
