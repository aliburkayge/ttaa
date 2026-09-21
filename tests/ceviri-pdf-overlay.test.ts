import assert from "node:assert/strict";
import test from "node:test";
import { degrees, PDFArray, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import sharp from "sharp";
import type { LayoutBlock, OcrLine } from "../lib/ceviri/ocr-layout.ts";
import { planOverlay, renderOverlay, type OverlayPlan, type Rect } from "../lib/ceviri/pdf-overlay.ts";
import { displayToPage, imagePlacement, loadScanPages } from "../lib/ceviri/pdf-scan.ts";

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

function scanSvg(skewDegrees: number, extra = ""): string {
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
<g transform="rotate(${skewDegrees} ${cx} ${cy})">${parts.join("")}${extra}</g></svg>`;
}

/** `rotated`: stored landscape and shown upright through /Rotate 270, like the customer's scans. */
async function scannedPdf(options: { skew?: number; rotated?: boolean; extra?: string } = {}): Promise<Uint8Array> {
  let image = sharp(Buffer.from(scanSvg(options.skew ?? 0, options.extra)));
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
    const unplaced = plan.unplaced.map((entry) => entry.id);
    assert.deepEqual(unplaced, [LINES.stampText.id]);

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
  assert.deepEqual(plan.unplaced.map((entry) => entry.id), [LINES.stampText.id]);
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

test("leaves the page untouched when nothing changes", async () => {
  const pdf = await scannedPdf();
  const plan = await planOverlay(pdf, BLOCKS);
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
 * black name/title lines whose first letters touch the stamp's ring. Inside
 * the ring sits a small dark patch whose blue JPEG has faded towards grey.
 */
const STAMP = { cx: 40, cy: 212, r: 16 };
const SIGNATORY = { x0: 52, name: [203, 209], title: [211, 217] };

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
  { kind: "image", page: 1, image: "signature_stamp", lines: [NAME, TITLE_LINE], frame: frame(22, 196, 125, 219) },
];

test("finds the printed lines inside a stamp block and ignores the blue ink", async () => {
  const plan = await planOverlay(await scannedPdf({ extra: stampSvg() }), STAMP_BLOCKS);
  assert.deepEqual(plan.unplaced, []);
  const name = itemFor(plan, NAME.id)!;
  const title = itemFor(plan, TITLE_LINE.id)!;
  assert.ok(name.area.v0 < title.area.v0, "lines out of order");
  for (const item of [name, title]) {
    assert.ok(item.masks.length > 0, "a solid box would erase the stamp's ring");
    assert.equal(item.erase.length, 0);
    assert.equal(item.caution, null, "blue stamp and black text are separable by colour");
    assert.ok(Math.abs(item.area.u0 - SIGNATORY.x0) < 1.5, `starts at ${item.area.u0.toFixed(1)}, text starts at ${SIGNATORY.x0}`);
    for (const rect of item.erase) assert.ok(rect.u0 > STAMP.cx, "erases into the stamp");
  }
});

test("lets a longer translation run on into blank space to the right", async () => {
  const plan = await planOverlay(await scannedPdf({ extra: stampSvg() }), STAMP_BLOCKS);
  const title = itemFor(plan, TITLE_LINE.id)!;
  assert.ok(title.area.u1 > 200, `area ends at ${title.area.u1.toFixed(1)}`);
  assert.ok(title.area.u1 <= PAGE.width - 25);
});

test("draws a pixel patch, not a box, over text inside a stamp", async () => {
  const pdf = await scannedPdf({ extra: stampSvg() });
  const plan = await planOverlay(pdf, STAMP_BLOCKS);
  const texts = new Map([
    [NAME.id, { source: NAME.text, translation: NAME.text }],
    [TITLE_LINE.id, { source: TITLE_LINE.text, translation: "Tedarik Müdürü" }],
  ]);
  const out = await PDFDocument.load(await renderOverlay(pdf, plan, texts));
  const patches = [...out.context.enumerateIndirectObjects()].filter(
    ([, object]) => object instanceof PDFRawStream && object.dict.has(PDFName.of("SMask")),
  );
  // Exactly one see-through patch, for the one changed line; the unchanged
  // name line and the stamp get nothing.
  assert.equal(patches.length, 1);
});

/**
 * Colour is not the rule, it is a hint: a stamp can be black like the text.
 * A black ring with small black letters around it, next to a black
 * signatory line — once clear of the text, once touching it.
 */
function blackStampSvg(textStart: number): string {
  const px = (value: number) => value * PX;
  const ringLetters = [0, 40, 80, 120, 160, 200, 240, 280, 320]
    .map((deg) => {
      const rad = (deg * Math.PI) / 180;
      const x = STAMP.cx + (STAMP.r - 4) * Math.cos(rad);
      const y = STAMP.cy + (STAMP.r - 4) * Math.sin(rad);
      return `<rect x="${px(x - 1)}" y="${px(y - 1.5)}" width="${px(2)}" height="${px(3)}" fill="#141414"/>`;
    })
    .join("");
  return [
    `<circle cx="${px(STAMP.cx)}" cy="${px(STAMP.cy)}" r="${px(STAMP.r)}" fill="none" stroke="#141414" stroke-width="${px(1.6)}"/>`,
    ringLetters,
    bar(textStart, SIGNATORY.name[0], 90, SIGNATORY.name[1]),
    bar(textStart, SIGNATORY.title[0], 120, SIGNATORY.title[1]),
  ].join("");
}

function overlapsRing(rect: Rect): boolean {
  // Does the rectangle reach the ring's stroke (radius ±1 pt)?
  const nearest = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
  const x = nearest(STAMP.cx, rect.u0, rect.u1);
  const y = nearest(STAMP.cy, rect.v0, rect.v1);
  const closest = Math.hypot(x - STAMP.cx, y - STAMP.cy);
  const corners = [
    [rect.u0, rect.v0], [rect.u1, rect.v0], [rect.u0, rect.v1], [rect.u1, rect.v1],
  ].map(([u, v]) => Math.hypot(u - STAMP.cx, v - STAMP.cy));
  return closest <= STAMP.r + 1 && Math.max(...corners) >= STAMP.r - 1;
}

test("keeps a black stamp and its black letters when the text stands clear of it", async () => {
  const start = STAMP.cx + STAMP.r + 3; // 3 pt clear of the ring
  const plan = await planOverlay(await scannedPdf({ extra: blackStampSvg(start) }), STAMP_BLOCKS);
  assert.deepEqual(plan.unplaced, []);
  for (const id of [NAME.id, TITLE_LINE.id]) {
    const item = itemFor(plan, id)!;
    assert.ok(Math.abs(item.area.u0 - start) < 1.5, `starts at ${item.area.u0.toFixed(1)}, text at ${start}`);
    assert.equal(item.caution, null);
    for (const rect of item.erase) assert.equal(overlapsRing(rect), false, "box reaches the black ring");
    for (const mask of item.masks) assert.ok(mask.rect.u0 > STAMP.cx, "mask reaches into the stamp");
  }
});

test("protects a black stamp that touches the text and says so", async () => {
  const start = STAMP.cx + STAMP.r - 1; // first strokes run into the ring
  const plan = await planOverlay(await scannedPdf({ extra: blackStampSvg(start) }), STAMP_BLOCKS);
  const title = itemFor(plan, TITLE_LINE.id);
  assert.ok(title, "line was not placed");
  assert.match(String(title.caution), /aynı renkte/);
  // Whatever is erased must stay off the ring: the letters fused with it are
  // left in place (hence the caution), the ring itself is never cut.
  for (const rect of title.erase) assert.equal(overlapsRing(rect), false, "box cuts the black ring");
  for (const mask of title.masks) assert.ok(mask.rect.u0 > STAMP.cx, "mask reaches into the stamp");
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
