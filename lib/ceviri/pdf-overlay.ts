import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { degrees, PDFDocument, rgb, type PDFFont } from "pdf-lib";
import type { Box, LayoutBlock, OcrLine } from "./ocr-layout";
import { displayToPage, loadScanPages, type ScanPage } from "./pdf-scan";

/**
 * Çeviriyi taranmış PDF'in üstüne, İngilizce yazının tam yerine yazar.
 *
 * Kural (müşteri): yüklenen belge görsel olarak ve tablo düzeni olarak hiç
 * değişmez. Sayfanın kendisi aynen kalır; yalnızca yazının bulunduğu şerit
 * taramanın kendi zemin rengiyle kapatılır ve çeviri aynı konuma, ölçülen
 * punto, kalınlık, mürekkep rengi ve eğiklikle yazılır. Logo, çizgi,
 * fotoğraf, imza ve mühür piksellerine dokunulmaz.
 *
 *  - planOverlay (yüklemede): taramayı ölçer, her satırın nereye yazılacağını
 *    kaydeder; yerleştirilemeyen satırları nedeniyle bildirir.
 *  - renderOverlay (indirmede): plana göre çeviriyi orijinal PDF'e yazar.
 *
 * Ölçümler "düz" koordinatlarda yapılır: taramalar hafif eğiktir (DELAN SC:
 * 0,16°, tablonun üst çizgisi 470 punto boyunca 1,2 punto iniyor). Eğik bir
 * çizgi tek bir piksel satırına düşmediği için düzeltmeden ölçülen tabloda 10
 * çizginin yalnızca 3'ü bulunuyordu.
 */

export type Rect = { u0: number; v0: number; u1: number; v1: number };
export type Color = [number, number, number];

export type OverlayItem = {
  /** 1'den başlar. */
  page: number;
  lineIds: string[];
  /** Çevirinin yazılabileceği alan (düzeltilmiş koordinat, punto). */
  area: Rect;
  /** Kapatılacak orijinal yazı şeritleri. */
  erase: Rect[];
  align: "left" | "center" | "right";
  fontSize: number;
  leading: number;
  bold: boolean;
  /** Ölçülen harf gövdesi kalınlığı (punto); `bold` buna göre verilir. */
  weight: number;
  background: Color;
  ink: Color;
};

export type OverlayPlan = {
  /** Sayfa başına tarama eğikliği (radyan); düzeltilmiş koordinatların dönüşü. */
  pages: Array<{ skew: number }>;
  items: OverlayItem[];
  /** Orijinal konumuna yazılamayacak satırlar ve nedeni. */
  unplaced: Array<{ id: string; reason: string }>;
};

/** Taranmış PDF için veritabanında saklanan düzen (`ceviri_documents.layout`). */
export type ScanLayout = {
  version: 2;
  blocks: LayoutBlock[];
  /** null ise sayfa ölçülemedi; neden `overlayError`da. */
  overlay: OverlayPlan | null;
  overlayError: string | null;
};

// ---------- düzeltilmiş koordinat ----------

type Frame = {
  page: ScanPage;
  skew: number;
  /** Düzeltilmiş (p,q) → görüntü düzlemi (u,v). */
  toDisplay(p: number, q: number): { u: number; v: number };
  fromDisplay(u: number, v: number): { p: number; q: number };
};

function frameFor(page: { width: number; height: number }, skew: number) {
  const cx = page.width / 2;
  const cy = page.height / 2;
  const cos = Math.cos(skew);
  const sin = Math.sin(skew);
  return {
    toDisplay: (p: number, q: number) => ({
      u: cx + (p - cx) * cos - (q - cy) * sin,
      v: cy + (p - cx) * sin + (q - cy) * cos,
    }),
    fromDisplay: (u: number, v: number) => ({
      p: cx + (u - cx) * cos + (v - cy) * sin,
      q: cy - (u - cx) * sin + (v - cy) * cos,
    }),
  };
}

const DARK = 140;

/**
 * Sayfanın eğikliği: yatay izdüşümün en keskin olduğu açı. Yazı satırları ve
 * tablo çizgileri doğru açıda tek bir satıra toplanır.
 */
export function estimateSkew(page: ScanPage): number {
  const step = 0.75;
  const points: Array<[number, number]> = [];
  for (let v = 0; v < page.height; v += step) {
    for (let u = 0; u < page.width; u += step) {
      const lum = page.luminance(u, v);
      if (lum !== null && lum < DARK) points.push([u, v]);
    }
  }
  if (points.length < 100) return 0;

  const score = (angle: number) => {
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const bins = new Map<number, number>();
    for (const [u, v] of points) {
      const key = Math.round((v * cos - u * sin) / step);
      bins.set(key, (bins.get(key) ?? 0) + 1);
    }
    let sum = 0;
    for (const count of bins.values()) sum += count * count;
    return sum;
  };

  const search = (from: number, to: number, by: number) => {
    let best = 0;
    let bestScore = -1;
    for (let deg = from; deg <= to + 1e-9; deg += by) {
      const s = score((deg * Math.PI) / 180);
      if (s > bestScore) {
        bestScore = s;
        best = deg;
      }
    }
    return best;
  };
  const coarse = search(-2, 2, 0.1);
  return (search(coarse - 0.1, coarse + 0.1, 0.01) * Math.PI) / 180;
}

// ---------- ölçüm ----------

/** Bundan yüksek şerit yazı değil görseldir (fotoğraf, logo); asla silinmez. */
const MAX_TEXT_BAND_PT = 20;

type Grid = { p0: number; q0: number; step: number; w: number; h: number; lum: Float32Array };

function sample(frame: Frame, rect: Rect): Grid {
  const step = 1 / frame.page.pixelsPerPoint;
  const w = Math.max(1, Math.ceil((rect.u1 - rect.u0) / step));
  const h = Math.max(1, Math.ceil((rect.v1 - rect.v0) / step));
  const lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const q = rect.v0 + (y + 0.5) * step;
    for (let x = 0; x < w; x++) {
      const { u, v } = frame.toDisplay(rect.u0 + (x + 0.5) * step, q);
      lum[y * w + x] = frame.page.luminance(u, v) ?? 255;
    }
  }
  return { p0: rect.u0, q0: rect.v0, step, w, h, lum };
}

type Run = { from: number; to: number };

function runs(flags: boolean[], maxGap: number): Run[] {
  const found: Run[] = [];
  let start = -1;
  let last = -1;
  flags.forEach((on, index) => {
    if (!on) return;
    if (start === -1) start = index;
    else if (index - last - 1 > maxGap) {
      found.push({ from: start, to: last });
      start = index;
    }
    last = index;
  });
  if (start !== -1) found.push({ from: start, to: last });
  return found;
}

export type Band = {
  v0: number;
  v1: number;
  u0: number;
  u1: number;
  /** Ortalama yatay mürekkep koşusu (piksel) — harf gövdesi kalınlığı. */
  stroke: number;
};

/** Yatay yazı şeritleri: her biri bir satır yazının dikey ve yatay kapsamı. */
function bands(grid: Grid): Band[] {
  const counts: number[] = [];
  for (let y = 0; y < grid.h; y++) {
    let dark = 0;
    for (let x = 0; x < grid.w; x++) if (grid.lum[y * grid.w + x] < DARK) dark++;
    counts.push(dark);
  }
  // "i" noktası gövdesinden ~0,1 em ayrıktır; 0,6 puntoya kadar boşluk aynı satır sayılır.
  const gap = Math.round(0.6 / grid.step);
  return runs(counts.map((count) => count >= 2), gap).map((run) => {
    let minX = grid.w;
    let maxX = -1;
    let runCount = 0;
    let runTotal = 0;
    for (let y = run.from; y <= run.to; y++) {
      let length = 0;
      for (let x = 0; x <= grid.w; x++) {
        const dark = x < grid.w && grid.lum[y * grid.w + x] < DARK;
        if (dark) {
          length++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        } else if (length) {
          runCount++;
          runTotal += length;
          length = 0;
        }
      }
    }
    return {
      v0: grid.q0 + run.from * grid.step,
      v1: grid.q0 + (run.to + 1) * grid.step,
      u0: grid.p0 + minX * grid.step,
      u1: grid.p0 + (maxX + 1) * grid.step,
      stroke: runCount ? runTotal / runCount : 0,
    };
  });
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function colors(grid: Grid, frame: Frame): { background: Color; ink: Color } {
  const light: Color[] = [];
  const dark: Color[] = [];
  const stride = 3;
  for (let y = 0; y < grid.h; y += stride) {
    for (let x = 0; x < grid.w; x += stride) {
      const lum = grid.lum[y * grid.w + x];
      if (lum > 200 || lum < 110) {
        const { u, v } = frame.toDisplay(grid.p0 + (x + 0.5) * grid.step, grid.q0 + (y + 0.5) * grid.step);
        const color = frame.page.rgb(u, v);
        if (color) (lum > 200 ? light : dark).push(color);
      }
    }
  }
  const pick = (list: Color[], fallback: Color): Color =>
    list.length ? ([0, 1, 2].map((i) => median(list.map((c) => c[i]))) as Color) : fallback;
  return { background: pick(light, [255, 255, 255]), ink: pick(dark, [0, 0, 0]) };
}

/** Tablo çizgileri: yatay çizgilerle satırlar, her satırda dikey çizgilerle hücreler. */
export function tableCells(grid: Grid): Rect[][] | null {
  const rowDark: boolean[] = [];
  for (let y = 0; y < grid.h; y++) {
    let dark = 0;
    for (let x = 0; x < grid.w; x++) if (grid.lum[y * grid.w + x] < DARK) dark++;
    rowDark.push(dark / grid.w >= 0.5);
  }
  // Tablo çizgisi incedir; iki sütunda aynı hizaya denk gelen yoğun (kalın)
  // yazı satırı da yarıdan fazla karanlık olabilir, ama birkaç punto kalındır.
  const maxThickness = Math.round(3 / grid.step);
  const lines = runs(rowDark, 1).filter((line) => line.to - line.from + 1 <= maxThickness);
  if (lines.length < 2) return null;

  const minSize = Math.round(5 / grid.step);
  const rows: Rect[][] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const top = lines[i].to + 1;
    const bottom = lines[i + 1].from - 1;
    if (bottom - top < minSize) continue;

    const colDark: boolean[] = [];
    for (let x = 0; x < grid.w; x++) {
      let dark = 0;
      for (let y = top; y <= bottom; y++) if (grid.lum[y * grid.w + x] < DARK) dark++;
      colDark.push(dark / (bottom - top + 1) >= 0.85);
    }
    const dividers = runs(colDark, 1);
    const cells: Rect[] = [];
    for (let j = 0; j + 1 < dividers.length; j++) {
      const left = dividers[j].to + 1;
      const right = dividers[j + 1].from - 1;
      if (right - left < minSize) continue;
      cells.push({
        u0: grid.p0 + left * grid.step,
        v0: grid.q0 + top * grid.step,
        u1: grid.p0 + (right + 1) * grid.step,
        v1: grid.q0 + (bottom + 1) * grid.step,
      });
    }
    if (cells.length) rows.push(cells);
  }
  return rows.length ? rows : null;
}

/** OCR kutusu (görüntü düzlemi, OCR pikseli) → düzeltilmiş koordinatta onu saran dikdörtgen. */
function toFrame(box: Box, size: { pageWidth: number; pageHeight: number }, frame: Frame): Rect {
  const kx = frame.page.width / size.pageWidth;
  const ky = frame.page.height / size.pageHeight;
  const corners = [
    frame.fromDisplay(box.x0 * kx, box.y0 * ky),
    frame.fromDisplay(box.x1 * kx, box.y0 * ky),
    frame.fromDisplay(box.x0 * kx, box.y1 * ky),
    frame.fromDisplay(box.x1 * kx, box.y1 * ky),
  ];
  return {
    u0: Math.min(...corners.map((c) => c.p)),
    v0: Math.min(...corners.map((c) => c.q)),
    u1: Math.max(...corners.map((c) => c.p)),
    v1: Math.max(...corners.map((c) => c.q)),
  };
}

function grow(rect: Rect, dx: number, dy: number): Rect {
  return { u0: rect.u0 - dx, v0: rect.v0 - dy, u1: rect.u1 + dx, v1: rect.v1 + dy };
}

type Measured = Omit<OverlayItem, "fontSize" | "bold"> & {
  estimate: number;
  column: string | null;
};

/**
 * Paragrafta beklenen satır sayısı OCR'dan bilinir. Komşu satırın kuyruğu
 * kutuya taşıyorsa fazladan şerit çıkar; en yakın şeritler birleştirilir.
 */
function fitToLines(found: Band[], expected: number): Band[] {
  const list = [...found];
  while (list.length > expected) {
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i + 1 < list.length; i++) {
      const gap = list[i + 1].v0 - list[i].v1;
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    const [a, b] = [list[best], list[best + 1]];
    list.splice(best, 2, {
      v0: Math.min(a.v0, b.v0),
      v1: Math.max(a.v1, b.v1),
      u0: Math.min(a.u0, b.u0),
      u1: Math.max(a.u1, b.u1),
      stroke: (a.stroke + b.stroke) / 2,
    });
  }
  return list;
}

function measure(
  frame: Frame,
  pageNo: number,
  region: Rect,
  lines: OcrLine[],
  options: {
    align: OverlayItem["align"] | "auto";
    column: string | null;
    /** Paragraf: şeritler OCR satır sayısına uydurulur, merkezi kutu dışındakiler atılır. */
    within?: Rect;
  },
): Measured | string {
  const grid = sample(frame, region);
  const found = bands(grid);
  const tall = (band: Band) => band.v1 - band.v0 > MAX_TEXT_BAND_PT;

  // Yazı, ilk yazı şeridinden sonraki ilk görselde biter. DELAN SC 12. satır:
  // etiketin altında ambalaj fotoğrafı, onun altında da fotoğrafın parçası olan
  // "0.25 L 0.5L 1L 5L" yazıları var — onlar fotoğraftır, silinmez.
  let text: Band[] = [];
  for (const band of found) {
    if (tall(band)) {
      if (text.length) break;
      continue;
    }
    text.push(band);
  }
  // Tarama lekeleri (tek nokta, çizgi kırıntısı) yazı sayılmaz.
  const specks = (band: Band) => band.v1 - band.v0 < 1.5 || band.u1 - band.u0 < 2;
  if (text.some((band) => !specks(band))) text = text.filter((band) => !specks(band));

  // Yazı, satır yüksekliğinin 1,5 katından büyük ilk boşlukta biter. Açık
  // renkli bir fotoğraf tek bir yüksek şerit vermez; kapak, kenar ve alt
  // yazı gibi küçük parçalara bölünür (DELAN SC 12. satır). O parçalar yazı
  // sanılıp silinmesin diye etiketle fotoğraf arasındaki boşlukta durulur.
  if (!options.within) {
    const lineHeight = median(text.map((band) => band.v1 - band.v0));
    const end = text.findIndex((band, i) => i > 0 && band.v0 - text[i - 1].v1 > lineHeight * 1.5);
    if (end > 0) text = text.slice(0, end);
  }

  if (options.within) {
    const box = options.within;
    text = fitToLines(
      text.filter((band) => {
        const middle = (band.v0 + band.v1) / 2;
        return middle >= box.v0 && middle <= box.v1;
      }),
      lines.length,
    );
  }
  if (!text.length) return "Taramada bu satırın yazısı bulunamadı.";

  const first = text[0];
  // Yazının altındaki ilk görsel (ör. hücredeki ambalaj fotoğrafı) sınırdır.
  const graphic = found.find((band) => tall(band) && band.v0 > first.v0);
  const bottom = graphic ? graphic.v0 - 1 : region.v1;
  const inkLeft = Math.min(...text.map((band) => band.u0));
  const inkRight = Math.max(...text.map((band) => band.u1));

  let align: OverlayItem["align"] = options.align === "auto" ? "left" : options.align;
  if (options.align === "auto") {
    const width = region.u1 - region.u0;
    if (text.length >= 2) {
      // Birden çok satırda hizalama, hangi kenarın sabit kaldığından okunur.
      const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
      const lefts = spread(text.map((band) => band.u0));
      const centers = spread(text.map((band) => (band.u0 + band.u1) / 2));
      const rights = spread(text.map((band) => band.u1));
      // İki yana yaslı metinde iki kenar da sabittir; ilk satırda küçük bir
      // girinti olabilir (DELAN SC 9. satır). Sağa dayalı metinde ise satır
      // başları satır uzunluğu kadar oynar.
      const justified = rights <= 1.5 && lefts < width * 0.1;
      if (lefts > 1.5 && !justified) {
        if (centers < lefts && centers <= rights) align = "center";
        else if (rights < lefts && rights < centers) align = "right";
      }
    } else {
      // Tek satırda yalnızca belirgin biçimde ortadaysa ortalı sayılır: numaralı
      // uzun bir etiket ("1. Trade name of ...") iki kenara da yakın düşer.
      const leftGap = inkLeft - region.u0;
      const rightGap = region.u1 - inkRight;
      if (leftGap > width * 0.1 && Math.abs(leftGap - rightGap) < width * 0.04) align = "center";
    }
  }

  const heights = text.map((band) => band.v1 - band.v0);
  const tops = text.map((band) => band.v0);
  const steps = tops.slice(1).map((top, i) => top - tops[i]);
  const leading = steps.length ? median(steps) : Math.max(...heights) * 1.25;
  // Birden çok satır varsa satır aralığı puntoyu en güvenilir verir (≈1,15 em);
  // tek satırda şerit yüksekliği (çıkıntı + kuyruk ≈ 0,8–0,9 em).
  const estimate = steps.length ? leading / 1.15 : Math.max(...heights) / 0.8;

  const area: Rect =
    align === "left"
      ? { u0: inkLeft, v0: first.v0, u1: region.u1, v1: bottom }
      : align === "right"
        ? { u0: region.u0, v0: first.v0, u1: inkRight, v1: bottom }
        : { u0: region.u0, v0: first.v0, u1: region.u1, v1: bottom };

  const pad = 0.8;
  return {
    page: pageNo,
    lineIds: lines.map((line) => line.id),
    area,
    erase: text.map((band) => ({
      u0: Math.max(region.u0, band.u0 - pad),
      v0: Math.max(region.v0, band.v0 - pad),
      u1: Math.min(region.u1, band.u1 + pad),
      v1: Math.min(region.v1, band.v1 + pad),
    })),
    align,
    leading,
    ...colors(grid, frame),
    estimate,
    weight: median(text.map((band) => band.stroke * grid.step)),
    column: options.column,
  };
}

/**
 * Kalın mı? Harf gövdesi kalınlığı, benzer puntodaki satırların "düz"
 * olanlarıyla kıyaslanır. Sabit eşik işe yaramıyor: tarama bulanıklığı küçük
 * yazının gövdesini oransal olarak kalınlaştırıyor (DELAN SC'de 6 puntoluk düz
 * adres satırları, 12 puntoluk kalın etiketlerle aynı orana çıktı).
 */
function assignBold(items: Array<{ page: number; fontSize: number; weight: number }>): boolean[] {
  return items.map((item) => {
    const peers = items.filter(
      (other) => other.page === item.page && Math.abs(other.fontSize - item.fontSize) <= item.fontSize * 0.25,
    );
    const pool = peers.length >= 3 ? peers : items.filter((other) => other.page === item.page);
    const sorted = pool.map((other) => other.weight).sort((a, b) => a - b);
    // Alt çeyrek "düz yazı" referansı: tabloda etiketlerin yarısı kalın olabilir.
    const regular = sorted[Math.floor(sorted.length / 4)] ?? item.weight;
    return item.weight >= regular * 1.3;
  });
}

export async function planOverlay(pdfBytes: Uint8Array, blocks: LayoutBlock[]): Promise<OverlayPlan> {
  const { pages } = await loadScanPages(pdfBytes);
  const frames: Frame[] = pages.map((page) => {
    const skew = estimateSkew(page);
    return { page, skew, ...frameFor(page, skew) };
  });
  const measured: Measured[] = [];
  const unplaced: OverlayPlan["unplaced"] = [];
  const skip = (lines: OcrLine[], reason: string) =>
    unplaced.push(...lines.map((line) => ({ id: line.id, reason })));

  blocks.forEach((block, blockIndex) => {
    const frame = frames[block.page - 1];
    const allLines =
      block.kind === "table" ? block.rows.flatMap((row) => row.flatMap((cell) => cell.lines)) : block.lines;
    if (!allLines.length) return;

    if (block.kind === "image") {
      skip(allLines, "İmza/mühür görselinin içinde; mührü bozmamak için yerinde çevrilmedi.");
      return;
    }
    if (!frame || !block.frame) {
      skip(allLines, "Satırın sayfadaki konumu bilinmiyor.");
      return;
    }

    const box = toFrame(block.frame.box, block.frame, frame);

    if (block.kind === "table") {
      const cells = tableCells(sample(frame, grow(box, 8, 8)));
      const matches =
        cells !== null &&
        cells.length === block.rows.length &&
        cells.every((row, r) => row.length === block.rows[r].length);
      if (!matches) {
        skip(
          allLines,
          `Tablo çizgileri OCR'ın tablosuyla eşleşmedi (taramada ${cells?.length ?? 0} satır, OCR'da ${block.rows.length}); yerine yazılamadı.`,
        );
        return;
      }
      block.rows.forEach((row, r) =>
        row.forEach((cell, c) => {
          if (!cell.lines.length) return;
          // Hücre zaten çizgilerin içi; az içeri çekmek yeter. Fazlası, çizgiye
          // değen harf kuyruklarının silinmeden kalmasına yol açıyordu.
          const region = grow(cells[r][c], -0.4, -0.4);
          const result = measure(frame, block.page, region, cell.lines, {
            align: "auto",
            column: `${blockIndex}:${c}`,
          });
          if (typeof result === "string") skip(cell.lines, result);
          else measured.push(result);
        }),
      );
      return;
    }

    // Paragraf: sayfanın ortasındaysa ortalı, sağ kenardaysa sağa dayalı —
    // ama sol kenarını başka bir satırla paylaşıyorsa sola dayalı bir sütunun
    // parçasıdır (DELAN SC: "Postal Address" altındaki adres, sayfa ortasına
    // denk geldiği hâlde sola dayalı).
    const width = frame.page.width;
    const center = (box.u0 + box.u1) / 2;
    const sharesLeftEdge = blocks.some(
      (other) =>
        other !== block &&
        other.kind === "paragraph" &&
        other.page === block.page &&
        other.frame &&
        Math.abs(toFrame(other.frame.box, other.frame, frame).u0 - box.u0) < 1.5,
    );
    const align: OverlayItem["align"] = sharesLeftEdge
      ? "left"
      : Math.abs(center - width / 2) < width * 0.03 && box.u1 - box.u0 < width * 0.8
        ? "center"
        : box.u0 > width * 0.55 && box.u1 > width * 0.8
          ? "right"
          : "left";
    const result = measure(frame, block.page, grow(box, 1.5, 1), block.lines, {
      align,
      column: null,
      within: box,
    });
    if (typeof result === "string") skip(block.lines, result);
    else measured.push(result);
  });

  // Aynı tablo sütunundaki hücreler aynı puntoyla yazılmıştır; tek satırlık,
  // kuyruksuz bir hücre ("HDPE") tek başına punto tahminini düşürmesin.
  const byColumn = new Map<string, number[]>();
  for (const item of measured) {
    if (item.column) byColumn.set(item.column, [...(byColumn.get(item.column) ?? []), item.estimate]);
  }

  const sized = measured.map(({ estimate, column, ...item }) => ({
    ...item,
    fontSize: Math.round((column ? median(byColumn.get(column) ?? [estimate]) : estimate) * 4) / 4,
  }));
  const bold = assignBold(sized);
  const items: OverlayItem[] = sized.map((item, index) => ({ ...item, bold: bold[index] }));

  return { pages: frames.map((frame) => ({ skew: frame.skew })), items, unplaced };
}

// ---------- çizim ----------

const FONT_DIR = path.join(process.cwd(), "lib", "ceviri", "fonts");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || font.widthOfTextAtSize(candidate, size) <= width) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function toColor([r, g, b]: Color) {
  return rgb(r / 255, g / 255, b / 255);
}

/**
 * @param texts satır id → { kaynak, çeviri }. Çevirisi olmayan ya da kaynakla
 *   aynı olan satırların bölgesine hiç dokunulmaz (ruhsat kodu, isim, logo).
 */
export async function renderOverlay(
  pdfBytes: Uint8Array,
  plan: OverlayPlan,
  texts: Map<string, { source: string; translation: string | null }>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(readFileSync(path.join(FONT_DIR, "Tinos-Regular.ttf")));
  const bold = await doc.embedFont(readFileSync(path.join(FONT_DIR, "Tinos-Bold.ttf")));
  const pdfPages = doc.getPages();

  for (const item of plan.items) {
    const page = pdfPages[item.page - 1];
    if (!page) continue;
    const lines = item.lineIds.map((id) => texts.get(id));
    const changed = lines.some((line) => line?.translation && line.translation.trim() !== line.source.trim());
    if (!changed) continue;

    const angle = ((page.getRotation().angle % 360) + 360) % 360;
    const rotation = (angle === 90 || angle === 180 || angle === 270 ? angle : 0) as 0 | 90 | 180 | 270;
    const media = page.getMediaBox();
    const sideways = rotation === 90 || rotation === 270;
    const display = sideways
      ? { width: media.height, height: media.width }
      : { width: media.width, height: media.height };
    const toPage = displayToPage(rotation, media);
    const straight = frameFor(display, plan.pages[item.page - 1]?.skew ?? 0);
    const place = (p: number, q: number) => {
      const { u, v } = straight.toDisplay(p, q);
      return toPage(u, v);
    };
    // Yazı yönü: düzeltilmiş koordinatta +p, sayfada hangi açıya denk geliyorsa.
    const origin = place(0, 0);
    const ahead = place(1, 0);
    const rotate = degrees((Math.atan2(ahead.y - origin.y, ahead.x - origin.x) * 180) / Math.PI);

    for (const rect of item.erase) {
      const corner = place(rect.u0, rect.v1);
      page.drawRectangle({
        x: corner.x,
        y: corner.y,
        width: rect.u1 - rect.u0,
        height: rect.v1 - rect.v0,
        rotate,
        color: toColor(item.background),
        borderWidth: 0,
      });
    }

    const font = item.bold ? bold : regular;
    const width = item.area.u1 - item.area.u0;
    const height = item.area.v1 - item.area.v0;
    const content = lines.map((line) => line?.translation?.trim() || line?.source || "");

    let size = item.fontSize;
    let leading = item.leading;
    let wrapped = content.flatMap((text) => wrap(text, font, size, width));
    while (size > 4.5) {
      const fits =
        wrapped.every((line) => font.widthOfTextAtSize(line, size) <= width + 0.5) &&
        (wrapped.length - 1) * leading + size * 0.9 <= height + 1;
      if (fits) break;
      size -= 0.25;
      leading = item.leading * (size / item.fontSize);
      wrapped = content.flatMap((text) => wrap(text, font, size, width));
    }

    wrapped.forEach((line, index) => {
      const lineWidth = font.widthOfTextAtSize(line, size);
      const p =
        item.align === "center"
          ? item.area.u0 + (width - lineWidth) / 2
          : item.align === "right"
            ? item.area.u1 - lineWidth
            : item.area.u0;
      // Yazının üst kenarı orijinal şeridin üstüne oturur; Times'ta çıkıntı ≈ 0,72 em.
      const at = place(p, item.area.v0 + size * 0.72 + index * leading);
      page.drawText(line, { x: at.x, y: at.y, size, font, color: toColor(item.ink), rotate });
    });
  }

  return doc.save();
}
