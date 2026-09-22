import assert from "node:assert/strict";
import test from "node:test";
import { degrees, PDFArray, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import sharp from "sharp";
import { inflateSync } from "node:zlib";
import type { LayoutBlock, OcrLine } from "../lib/ceviri/ocr-layout.ts";
import { planOverlay, renderOverlay, snapSizes, subtractRects, type OverlayPlan, type Rect } from "../lib/ceviri/pdf-overlay.ts";
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
  // blue stroke where it passes is masked, so the title is not rewritten.
  const title = itemFor(plan, LINES.title.id)!;
  assert.notEqual(title.redraw, true);
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
