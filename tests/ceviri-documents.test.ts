import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import fontkit from "@pdf-lib/fontkit";
import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import { imageFormat, imageToPdf, overlayImage } from "../lib/ceviri/image-doc.ts";
import type { LayoutBlock, OcrLine } from "../lib/ceviri/ocr-layout.ts";
import { planOverlay, renderOverlay } from "../lib/ceviri/pdf-overlay.ts";
import { loadScanPages, renderPdfPage } from "../lib/ceviri/pdf-scan.ts";

/**
 * Her dosya türü aynı yoldan geçer: sayfa render edilir, çeviri orijinalin
 * üstüne yazılır. Bu testler taranmış JPEG dışındaki türleri kapsar: dijital
 * PDF (gömülü olmayan standart yazı tipiyle), döndürülmüş ve kırpılmış
 * sayfalar, görsel belgeler.
 */

let nextId = 0;
function line(text: string): OcrLine {
  return { id: `d${++nextId}`, text, confidence: 0.99, ocrWarning: null };
}

/** OCR kutusu: görüntü düzleminde punto (OCR ölçeği 1). */
function frame(page: { width: number; height: number }, x0: number, y0: number, x1: number, y1: number) {
  return { box: { x0, y0, x1, y1 }, pageWidth: page.width, pageHeight: page.height };
}

const PAGE = { width: 420, height: 300 };
const SIGNATORY = ["Christine Keating", "Head of Global Regulatory Affairs", "BASF Agricultural Solutions LLC"];

/** Dijital (taranmamış) PDF: vektör yazı, verilen yazı tipiyle. Satır başları üstten 60, 76, 92 punto. */
async function digitalPdf(family: "Tinos" | "Arimo" | "Helvetica"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font =
    family === "Helvetica"
      ? await doc.embedFont(StandardFonts.Helvetica)
      : await doc.embedFont(readFileSync(`lib/ceviri/fonts/${family}-Regular.ttf`));
  const page = doc.addPage([PAGE.width, PAGE.height]);
  SIGNATORY.forEach((text, index) => {
    page.drawText(text, { x: 40, y: PAGE.height - 60 - index * 16 - 11, size: 12, font, color: rgb(0, 0, 0) });
  });
  // Başka bir paragraf: aile oyu için daha çok harf.
  const body = [
    "All labels will be reissued following the regulatory schedule.",
    "Please retain the original files until the final approval is filed.",
    "Local rules apply in all listed territories and sales channels.",
  ];
  body.forEach((text, index) => {
    page.drawText(text, { x: 40, y: PAGE.height - 150 - index * 16 - 11, size: 12, font, color: rgb(0, 0, 0) });
  });
  return doc.save();
}

function signatoryBlock(lines: OcrLine[]): LayoutBlock {
  return { kind: "paragraph", role: "text", page: 1, lines, frame: frame(PAGE, 38, 56, 330, 106) };
}

function bodyBlocks(): LayoutBlock[] {
  return [0, 1, 2].map((index) => ({
    kind: "paragraph" as const,
    role: "text" as const,
    page: 1,
    lines: [line(["All labels will be reissued following the regulatory schedule.", "Please retain the original files until the final approval is filed.", "Local rules apply in all listed territories and sales channels."][index])],
    frame: frame(PAGE, 38, 146 + index * 16, 400, 162 + index * 16),
  }));
}

test("reads a born-digital PDF whose font is not embedded", async () => {
  const { pages } = await loadScanPages(await digitalPdf("Helvetica"));
  let dark = 0;
  for (let u = 40; u < 140; u += 0.5) if ((pages[0].luminance(u, 66) ?? 255) < 128) dark++;
  assert.ok(dark > 10, "standart yazı tipi çizilmedi (pdf.js yazı tipi dosyaları bulunamadı)");
  assert.ok((pages[0].luminance(200, 30) ?? 0) > 240, "boş alan koyu okunuyor");
});

test("writes only the line whose translation changed in a multi-line block", async () => {
  const lines = SIGNATORY.map((text) => line(text));
  const plan = await planOverlay(await digitalPdf("Tinos"), [signatoryBlock(lines)]);
  assert.equal(plan.unplaced.length, 0, JSON.stringify(plan.unplaced));
  // Her OCR satırı kendi öğesi: yalnızca çevrilen satır yeniden yazılır.
  for (const ocrLine of lines) {
    const owners = plan.items.filter((item) => item.lineIds.includes(ocrLine.id));
    assert.equal(owners.length, 1);
    assert.deepEqual(owners[0].lineIds, [ocrLine.id]);
  }
  const sizes = plan.items.map((item) => item.fontSize);
  for (const size of sizes) assert.ok(Math.abs(size - 12) <= 1.25, `punto ${size}, beklenen 12`);
});

test("picks the typeface family from the letter shapes", async () => {
  for (const [font, family] of [
    ["Tinos", "serif"],
    ["Arimo", "sans"],
  ] as const) {
    const plan = await planOverlay(await digitalPdf(font), [signatoryBlock(SIGNATORY.map((text) => line(text))), ...bodyBlocks()]);
    const families = new Set(plan.items.map((item) => item.family));
    assert.deepEqual([...families], [family], `${font} → ${[...families].join(",")}`);
  }
});

test("sees a page rotated by 90 degrees upright", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  // Saklanan sayfanın sol alt köşesi, 90° döndürülünce görüntünün sol üst köşesidir.
  page.drawRectangle({ x: 0, y: 0, width: 20, height: 20, color: rgb(0, 0, 0) });
  page.setRotation(degrees(90));
  const { pages } = await loadScanPages(await doc.save());
  assert.equal(Math.round(pages[0].width), 200);
  assert.equal(Math.round(pages[0].height), 300);
  assert.ok((pages[0].luminance(10, 10) ?? 255) < 60, "sol üst köşe koyu olmalı");
  assert.ok((pages[0].luminance(190, 290) ?? 0) > 240, "sağ alt köşe açık olmalı");
});

test("measures a page through its crop box", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  page.setCropBox(50, 50, 300, 200);
  page.drawRectangle({ x: 60, y: 230, width: 20, height: 15, color: rgb(0, 0, 0) });
  const { pages } = await loadScanPages(await doc.save());
  assert.equal(Math.round(pages[0].width), 300);
  assert.equal(Math.round(pages[0].height), 200);
  // Kırpma kutusunun sol üstü (50, 250): kare görüntüde (10–30, 5–20) aralığında.
  assert.ok((pages[0].luminance(20, 12) ?? 255) < 60);
  assert.ok((pages[0].toPage(20, 12).x - 70) ** 2 < 0.01);
});

/** Görsel belge: beyaz kağıtta üç yazı satırı gibi dikey çizgiler (piksel). */
function scanSvg(width: number, height: number): string {
  const strokes: string[] = [];
  for (const [y, x1] of [
    [80, 900],
    [140, 780],
  ]) {
    for (let x = 100; x < x1; x += 7) strokes.push(`<rect x="${x}" y="${y}" width="3" height="34" fill="#141414"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#faf8f2"/>${strokes.join("")}<rect x="100" y="400" width="200" height="120" fill="#2b62c9"/></svg>`;
}

test("recognises image files by their content", async () => {
  const png = await sharp(Buffer.from(scanSvg(200, 100))).png().toBuffer();
  const jpeg = await sharp(png).jpeg().toBuffer();
  const webp = await sharp(png).webp().toBuffer();
  const tiff = await sharp(png).tiff().toBuffer();
  assert.equal(imageFormat(new Uint8Array(png)), "png");
  assert.equal(imageFormat(new Uint8Array(jpeg)), "jpeg");
  assert.equal(imageFormat(new Uint8Array(webp)), "webp");
  assert.equal(imageFormat(new Uint8Array(tiff)), "tiff");
  assert.equal(imageFormat(new TextEncoder().encode("%PDF-1.7")), null);
});

for (const format of ["png", "jpeg"] as const) {
  test(`translates an image and returns the same format and size (${format})`, async () => {
    const width = 1200;
    const height = 700;
    const base = sharp(Buffer.from(scanSvg(width, height)));
    const original = new Uint8Array(await (format === "png" ? base.png() : base.jpeg({ quality: 95 })).toBuffer());

    const pdf = await imageToPdf(original);
    const pt = 72 / 300; // bir pikselin punto karşılığı
    const first = line("x".repeat(115));
    const blocks: LayoutBlock[] = [
      {
        kind: "paragraph",
        role: "text",
        page: 1,
        lines: [first],
        frame: { box: { x0: 95 * pt, y0: 75 * pt, x1: 905 * pt, y1: 118 * pt }, pageWidth: width * pt, pageHeight: height * pt },
      },
    ];
    const plan = await planOverlay(pdf, blocks);
    assert.equal(plan.unplaced.length, 0, JSON.stringify(plan.unplaced));

    const texts = new Map([[first.id, { source: first.text, translation: "Çeviri satırı" }]]);
    const out = await overlayImage(original, plan, texts);
    assert.equal(out.mime, format === "png" ? "image/png" : "image/jpeg");
    assert.equal(imageFormat(out.bytes), format);

    const before = await sharp(original).raw().toBuffer({ resolveWithObject: true });
    const after = await sharp(out.bytes).raw().toBuffer({ resolveWithObject: true });
    assert.equal(after.info.width, width);
    assert.equal(after.info.height, height);

    const at = (buffer: { data: Buffer; info: { width: number; channels: number } }, x: number, y: number) =>
      buffer.data[(y * buffer.info.width + x) * buffer.info.channels];
    // Dokunulmayan satır ve mavi kutu aynı kalır (JPEG'de yeniden sıkıştırma payı).
    const tolerance = format === "png" ? 0 : 12;
    for (const [x, y] of [
      [101, 150],
      [200, 460],
      [1100, 650],
    ]) {
      assert.ok(Math.abs(at(after, x, y) - at(before, x, y)) <= tolerance, `(${x},${y}) değişmiş`);
    }
    // Çevrilen satırın ilk harfleri silinip yerine yeni yazı geldi: çizgilerin düzeni bozulmuş olmalı.
    let differing = 0;
    for (let x = 100; x < 900; x++) if (Math.abs(at(after, x, 97) - at(before, x, 97)) > 60) differing++;
    assert.ok(differing > 50, `çevrilen satır değişmemiş (${differing})`);
  });
}

test("rebuilds shaded, textured paper under erased text instead of a flat patch", async () => {
  // Telefonla çekilmiş sayfa gibi: kağıt soldan sağa koyulaşıyor ve dokulu.
  const width = 1200;
  const height = 400;
  const strokes: string[] = [];
  for (let x = 100; x < 1000; x += 7) strokes.push(`<rect x="${x}" y="180" width="3" height="34" fill="#1a1a1a"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="shade" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#e6e4dc"/><stop offset="1" stop-color="#a9a79f"/></linearGradient>
      <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves="2" seed="4"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.12"/></feComponentTransfer><feComposite in2="SourceGraphic" operator="in"/></filter>
    </defs>
    <rect width="100%" height="100%" fill="url(#shade)"/>
    <rect width="100%" height="100%" fill="url(#shade)" filter="url(#grain)"/>
    ${strokes.join("")}</svg>`;
  const original = new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
  const pdf = await imageToPdf(original);
  const pt = 72 / 300;
  const only = line("x".repeat(129));
  const plan = await planOverlay(pdf, [
    {
      kind: "paragraph",
      role: "text",
      page: 1,
      lines: [only],
      frame: { box: { x0: 95 * pt, y0: 175 * pt, x1: 1005 * pt, y1: 218 * pt }, pageWidth: width * pt, pageHeight: height * pt },
    },
  ]);
  assert.equal(plan.unplaced.length, 0, JSON.stringify(plan.unplaced));
  // Çeviri tek bir nokta: silinen bandın neredeyse tamamı yeniden kurulmuş kağıt olarak kalır.
  const out = await overlayImage(original, plan, new Map([[only.id, { source: only.text, translation: "." }]]));
  const after = await sharp(out.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const mean = (x0: number, x1: number, y0: number, y1: number) => {
    let sum = 0;
    let count = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        sum += after.data[(y * width + x) * 3];
        count++;
      }
    }
    return sum / count;
  };
  // Silinen bant (yazının olduğu yer) ile hemen üstündeki kağıt, sol ve sağ uçta ayrı ayrı.
  for (const [x0, x1] of [
    [300, 400],
    [850, 950],
  ]) {
    const erased = mean(x0, x1, 185, 210);
    const paper = mean(x0, x1, 140, 165);
    assert.ok(Math.abs(erased - paper) <= 5, `x ${x0}-${x1}: silinen ${erased.toFixed(1)}, kağıt ${paper.toFixed(1)}`);
  }
  // Işığın eğimi yama içinde de sürer: sağ taraf soldan belirgin koyu.
  assert.ok(mean(300, 400, 185, 210) - mean(850, 950, 185, 210) > 20, "yama düz tek renk");
  // Doku var: silinen bandın pikselleri tek renk değil.
  let min = 255;
  let max = 0;
  for (let x = 500; x < 600; x++) {
    const value = after.data[(195 * width + x) * 3];
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  assert.ok(max - min >= 4, `yama pürüzsüz (${min}-${max})`);
});

test("renders the overlay layer alone on a transparent page", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([100, 50]);
  const rgba = await renderPdfPage(await doc.save(), 0, { width: 200, height: 100 }, { transparent: true });
  assert.equal(rgba.length, 200 * 100 * 4);
  assert.ok(rgba.every((value, index) => index % 4 !== 3 || value === 0), "boş sayfa saydam olmalı");
});

test("leaves an unchanged document untouched", async () => {
  const pdf = await digitalPdf("Arimo");
  const lines = SIGNATORY.map((text) => line(text));
  const plan = await planOverlay(pdf, [signatoryBlock(lines)]);
  const texts = new Map(lines.map((ocrLine) => [ocrLine.id, { source: ocrLine.text, translation: ocrLine.text }]));
  const out = await renderOverlay(pdf, plan, texts);
  const reread = await PDFDocument.load(out);
  assert.equal(reread.getPageCount(), 1);
  const a = await renderPdfPage(pdf, 0, { width: 420, height: 300 });
  const b = await renderPdfPage(out, 0, { width: 420, height: 300 });
  let differing = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differing++;
  assert.equal(differing, 0);
});
