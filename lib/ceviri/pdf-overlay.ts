import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { degrees, PDFDocument, rgb, type PDFFont } from "pdf-lib";
import sharp from "sharp";
import type { Box, LayoutBlock, OcrLine } from "./ocr-layout";
import { displayToPage, loadScanPages, type ScanPage } from "./pdf-scan";

/**
 * Çeviriyi taranmış PDF'in üstüne, İngilizce yazının tam yerine yazar.
 *
 * Kural (müşteri): yüklenen belge görsel olarak ve tablo düzeni olarak hiç
 * değişmez. Sayfanın kendisi aynen kalır; yalnızca çevrilen satırın kendi
 * harfleri silinir ve çeviri aynı konuma, ölçülen punto, kalınlık, mürekkep
 * rengi ve eğiklikle yazılır. Logo, çizgi, fotoğraf, imza ve mühür
 * piksellerine dokunulmaz — hangi renkte olurlarsa olsunlar.
 *
 *  - planOverlay (yüklemede): taramayı ölçer, her satırın nereye yazılacağını
 *    ve hangi piksellerin silineceğini kaydeder; yerleştirilemeyen satırları
 *    nedeniyle bildirir.
 *  - renderOverlay (indirmede): plana göre çeviriyi orijinal PDF'e yazar.
 *
 * Neyin "yazı" olduğu renge değil şekle bakılarak bulunur (bağlı bileşen
 * analizi). Mühür siyah da olabilir, imza da; renk yalnızca ek bir ipucudur.
 * Ayrıntı: `survey`.
 *
 * Ölçümler "düz" koordinatlarda yapılır: taramalar hafif eğiktir (DELAN SC:
 * 0,07–0,25°). Eğik bir çizgi tek bir piksel satırına düşmediği için
 * düzeltmeden ölçülen tabloda 10 çizginin yalnızca 3'ü bulunuyordu.
 */

export type Rect = { u0: number; v0: number; u1: number; v1: number };
export type Color = [number, number, number];

/**
 * Silinecek pikseller: `rect` üzerinde tarama çözünürlüğünde bir ızgara,
 * satır satır, bit başına bir piksel (base64). Yalnızca satırın yakınında
 * başka bir işaret (mühür, imza, çizgi) varken kullanılır; o zaman düz bir
 * kutu o işareti de silerdi.
 */
export type Mask = {
  rect: Rect;
  w: number;
  h: number;
  bits: string;
  /** Silinen piksellerin boyanacağı renk: maskenin çevresindeki kağıt. */
  paper: Color;
};

export type OverlayItem = {
  /** 1'den başlar. */
  page: number;
  lineIds: string[];
  /** Çevirinin yazılabileceği alan (düzeltilmiş koordinat, punto). */
  area: Rect;
  /** Düz renkle kapatılacak şeritler (yakında başka işaret yoksa). */
  erase: Rect[];
  /** Piksel piksel silinecek şeritler (yakında mühür/imza/çizgi varsa). */
  masks: Mask[];
  /** İnceleyene gösterilecek uyarı (ör. harfe değen aynı renkte mühür). */
  caution: string | null;
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
  /**
   * Sayfanın yazı rengi: tüm sayfadaki koyu piksellerin ortancası. Bölgeden
   * değil sayfadan ölçülür; mühür bölgesinde mürekkebin çoğu mühürdür.
   */
  textColor: Color;
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

// ---------- örnekleme ----------

/** Bundan yüksek bir parça yazı değildir (fotoğraf, logo, mühür). */
const MAX_TEXT_BAND_PT = 20;

type Grid = {
  p0: number;
  q0: number;
  step: number;
  w: number;
  h: number;
  lum: Float32Array;
  rgb: Uint8Array;
};

function sample(frame: Frame, rect: Rect): Grid {
  const step = 1 / frame.page.pixelsPerPoint;
  const w = Math.max(1, Math.ceil((rect.u1 - rect.u0) / step));
  const h = Math.max(1, Math.ceil((rect.v1 - rect.v0) / step));
  const lum = new Float32Array(w * h);
  const colorsOut = new Uint8Array(w * h * 3).fill(255);
  for (let y = 0; y < h; y++) {
    const q = rect.v0 + (y + 0.5) * step;
    for (let x = 0; x < w; x++) {
      const { u, v } = frame.toDisplay(rect.u0 + (x + 0.5) * step, q);
      const color = frame.page.rgb(u, v);
      const index = y * w + x;
      if (color) {
        colorsOut.set(color, index * 3);
        lum[index] = 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2];
      } else lum[index] = 255;
    }
  }
  return { p0: rect.u0, q0: rect.v0, step, w, h, lum, rgb: colorsOut };
}

function pixelColor(grid: Grid, index: number): Color {
  return [grid.rgb[index * 3], grid.rgb[index * 3 + 1], grid.rgb[index * 3 + 2]];
}

/** İki rengin en büyük kanal farkı. */
function colorDistance(a: Color, b: Color): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
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

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// ---------- tablo ----------

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

// ---------- yazı mı, işaret mi ----------

/**
 * Mürekkep tonu, sayfanın yazı rengine göre: 0 yazı renginde, 1 belirgin
 * şekilde farklı (mavi mühür, kırmızı paraf), 2 arada (iki rengin değdiği
 * kenar pikselleri).
 */
type Tone = 0 | 1 | 2;

type Component = { x0: number; y0: number; x1: number; y1: number; count: number; color: Color; tone: Tone };

/**
 * Renk tonu farkı: parlaklık çıkarıldıktan sonra kalan renk sapmasının farkı.
 * Siyah bir çizginin gri kenarı siyahla aynı tondadır (ikisi de renksiz);
 * yalnızca parlaklığa bakan bir ölçü kenarı "başka renk" sayıp siyah bir
 * mühür halkasını küçük parçalara bölüyor, o parçalar da harf sanılıyordu.
 */
function hueDistance(a: Color, b: Color): number {
  // Sapma parlaklığa oranlanır: koyu lacivert (20,30,70) mutlak olarak küçük
  // ama oransal olarak açık mavi kadar mavidir. Mutlak fark, bir imzanın
  // koyu mürekkebini "siyah yazı" sayıp karalamayı satır sanıyordu (DELAN SC).
  const lumA = Math.max(30, (a[0] + a[1] + a[2]) / 3);
  const lumB = Math.max(30, (b[0] + b[1] + b[2]) / 3);
  const meanA = (a[0] + a[1] + a[2]) / 3;
  const meanB = (b[0] + b[1] + b[2]) / 3;
  return Math.max(
    Math.abs((a[0] - meanA) / lumA - (b[0] - meanB) / lumB),
    Math.abs((a[1] - meanA) / lumA - (b[1] - meanB) / lumB),
    Math.abs((a[2] - meanA) / lumA - (b[2] - meanB) / lumB),
  );
}

function toneOf(color: Color, textColor: Color): Tone {
  const distance = hueDistance(color, textColor);
  return distance < 0.2 ? 0 : distance > 0.35 ? 1 : 2;
}

/** Sayfanın yazı rengi: sayfadaki koyu piksellerin ortancası (yazı mürekkebin çoğunu oluşturur). */
function pageInk(page: ScanPage): Color {
  const samples: Color[] = [];
  for (let v = 0; v < page.height; v += 1) {
    for (let u = 0; u < page.width; u += 1) {
      const color = page.rgb(u, v);
      if (color && 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2] < DARK) samples.push(color);
    }
  }
  if (!samples.length) return [0, 0, 0];
  return [0, 1, 2].map((i) => median(samples.map((c) => c[i]))) as Color;
}

/**
 * Bir satır: aynı hizadaki harf bileşenleri. Koordinatlar punto, `members`
 * bileşen dizinleri.
 */
export type Row = { v0: number; v1: number; u0: number; u1: number; members: number[]; stroke: number };

type Survey = {
  grid: Grid;
  /** Piksel → bileşen dizini; koyu olmayan piksel −1. */
  labels: Int32Array;
  comps: Component[];
  /** Harf mi? false ise işarettir: mühür, imza, çizgi, fotoğraf. */
  glyph: boolean[];
  textColor: Color;
  paper: Color;
  rows: Row[];
};

/**
 * Bağlı bileşenler, iki adımda:
 *
 * 1. Net tondaki koyu pikseller (yazı renginde ya da belirgin şekilde başka
 *    renkte) yalnızca kendi tonlarıyla bağlanır. Mavi halkaya değen siyah bir
 *    harf halkayla tek parça olmaz, kendi başına bir harf olarak kalır.
 * 2. Arada kalan pikseller iki rengin değdiği kenardır; renkçe daha yakın
 *    oldukları komşu parçaya katılırlar (mavimsi kenar halkaya, grimsi kenar
 *    harfe). Ayrı sınıf sayıldıklarında halkanın kenarı yüzlerce tek piksellik
 *    "harfe" bölünüyordu.
 *
 * Aynı tonda değen iki şey (siyah mühür ve siyah harf) yine tek parçadır;
 * onları hiçbir şey kesin ayıramaz.
 */
function components(grid: Grid, textColor: Color): { labels: Int32Array; comps: Component[] } {
  const { w, h, lum } = grid;
  const labels = new Int32Array(w * h).fill(-1);
  const tones = new Uint8Array(w * h);
  for (let index = 0; index < w * h; index++) tones[index] = toneOf(pixelColor(grid, index), textColor);
  const compTones: Tone[] = [];
  const stack = new Int32Array(w * h);

  const flood = (start: number, id: number, accepts: (next: number) => boolean) => {
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    while (top) {
      const index = stack[--top];
      const x = index % w;
      const y = (index - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w || (dx === 0 && dy === 0)) continue;
          const next = ny * w + nx;
          if (labels[next] === -1 && lum[next] < DARK && accepts(next)) {
            labels[next] = id;
            stack[top++] = next;
          }
        }
      }
    }
  };

  // 1. Net tonlar.
  for (let start = 0; start < w * h; start++) {
    if (labels[start] !== -1 || lum[start] >= DARK || tones[start] === 2) continue;
    const tone = tones[start] as Tone;
    compTones.push(tone);
    flood(start, compTones.length - 1, (next) => tones[next] === tone);
  }

  // 2. Kenar pikselleri: komşu parçalardan renkçe yakın olana, katman katman.
  const lean = (index: number): Tone =>
    hueDistance(pixelColor(grid, index), textColor) >= 0.275 ? 1 : 0;
  let frontier: number[] = [];
  for (let index = 0; index < w * h; index++) {
    if (labels[index] === -1 && lum[index] < DARK && tones[index] === 2) frontier.push(index);
  }
  for (let changed = true; changed && frontier.length; ) {
    changed = false;
    const assigned: Array<[number, number]> = [];
    const waiting: number[] = [];
    for (const index of frontier) {
      const x = index % w;
      const y = (index - x) / w;
      let preferred = -1;
      let fallback = -1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const label = labels[ny * w + nx];
          if (label < 0) continue;
          if (compTones[label] === lean(index)) preferred = label;
          else fallback = label;
        }
      }
      const chosen = preferred >= 0 ? preferred : fallback;
      if (chosen >= 0) assigned.push([index, chosen]);
      else waiting.push(index);
    }
    for (const [index, label] of assigned) labels[index] = label;
    changed = assigned.length > 0;
    frontier = waiting;
  }
  // Hiçbir parçaya değmeyen kenar tonu pikselleri kendi başına bir parça.
  for (const start of frontier) {
    if (labels[start] !== -1) continue;
    compTones.push(2);
    flood(start, compTones.length - 1, (next) => tones[next] === 2);
  }

  // Parça özellikleri, son etiketlerden.
  const comps: Component[] = compTones.map((tone) => ({
    x0: w,
    y0: h,
    x1: -1,
    y1: -1,
    count: 0,
    color: [0, 0, 0],
    tone,
  }));
  const sums = new Float64Array(comps.length * 3);
  for (let index = 0; index < w * h; index++) {
    const label = labels[index];
    if (label < 0) continue;
    const comp = comps[label];
    const x = index % w;
    const y = (index - x) / w;
    comp.count++;
    if (x < comp.x0) comp.x0 = x;
    if (x > comp.x1) comp.x1 = x;
    if (y < comp.y0) comp.y0 = y;
    if (y > comp.y1) comp.y1 = y;
    sums[label * 3] += grid.rgb[index * 3];
    sums[label * 3 + 1] += grid.rgb[index * 3 + 1];
    sums[label * 3 + 2] += grid.rgb[index * 3 + 2];
  }
  comps.forEach((comp, label) => {
    comp.color = [sums[label * 3] / comp.count, sums[label * 3 + 1] / comp.count, sums[label * 3 + 2] / comp.count];
  });
  return { labels, comps };
}

function weightedMedianColor(items: Array<{ color: Color; weight: number }>): Color {
  if (!items.length) return [0, 0, 0];
  return [0, 1, 2].map((channel) => {
    const sorted = [...items].sort((a, b) => a.color[channel] - b.color[channel]);
    const total = sorted.reduce((sum, item) => sum + item.weight, 0);
    let seen = 0;
    for (const item of sorted) {
      seen += item.weight;
      if (seen >= total / 2) return item.color[channel];
    }
    return sorted[sorted.length - 1].color[channel];
  }) as Color;
}

/**
 * Bölgedeki mürekkebi birbirine değen parçalara (bağlı bileşenlere) ayırır
 * ve her parçanın yazı harfi mi yoksa başka bir işaret mi olduğuna karar
 * verir. Karar renge değil şekle dayanır:
 *
 *  - Harfler aynı boyda küçük parçalardır; yükseklikleri bölgedeki harflerin
 *    ortancasından belirgin şekilde büyük olamaz.
 *  - Mühür halkası, imza karalaması ve fotoğraf çok daha yüksektir.
 *  - İmza çizgisi ve alt çizgi çok uzun ve incedir.
 *
 * Renk ek bir ipucudur: harf boyunda ama yazının renginden belirgin şekilde
 * farklı bir parça (mavi mührün kenarındaki harfler, kırmızı paraf) da
 * işarettir. Siyah bir mühürde bu ipucu yoktur; şekil kuralları yine işler.
 *
 * `rowRegion`: satırlar yalnızca merkezi bu dikdörtgende olan harflerden
 * kurulur. Izgara bundan daha geniş örneklenir ki kenardan kesilen bir mühür
 * halkası küçük yaylara bölünüp harf sanılmasın.
 */
function survey(frame: Frame, context: Rect, rowRegion: Rect, options: { cluster: boolean }): Survey {
  const grid = sample(frame, context);
  const { labels, comps } = components(grid, frame.textColor);
  const step = grid.step;
  const heightPt = (c: Component) => (c.y1 - c.y0 + 1) * step;
  const widthPt = (c: Component) => (c.x1 - c.x0 + 1) * step;

  const toX = (u: number) => Math.round((u - grid.p0) / step);
  const toY = (v: number) => Math.round((v - grid.q0) / step);
  const inRegion = (c: Component) => {
    const cx = (c.x0 + c.x1 + 1) / 2;
    const cy = (c.y0 + c.y1 + 1) / 2;
    return cx >= toX(rowRegion.u0) && cx <= toX(rowRegion.u1) && cy >= toY(rowRegion.v0) && cy <= toY(rowRegion.v1);
  };

  // Tipik harf yüksekliği: satırların arandığı bölgedeki yazı tonundaki
  // parçalardan. Çevredeki imza ve mühür kırıntıları ortancayı küçültüp
  // kelime boşluğu eşiğini düşürüyor, satırı ortadan bölüyordu (DELAN SC).
  const plausible = (c: Component) => heightPt(c) >= 1.5 && heightPt(c) <= MAX_TEXT_BAND_PT && widthPt(c) <= 40;
  const textPool = comps.filter((c) => plausible(c) && c.tone === 0 && inRegion(c));
  const pool = textPool.length >= 3 ? textPool : comps.filter(plausible);
  const typical = median(pool.map(heightPt)) || 6;
  const maxGlyph = Math.min(MAX_TEXT_BAND_PT, Math.max(2.6 * typical, typical + 4));
  const sized = comps.map((c) => {
    const height = heightPt(c);
    const width = widthPt(c);
    const rule = width > 12 && width > 10 * height;
    return height <= maxGlyph && !rule;
  });

  // Harf: yazı boyunda ve yazı renginde (ya da iki rengin değdiği kenar).
  // Harf boyunda ama belirgin şekilde başka renkteki parça (mavi mührün
  // halkasındaki harfler, kırmızı paraf) işarettir.
  const glyph = comps.map((c, i) => sized[i] && c.tone !== 1);
  // Yazının çizim rengi: bu bölgedeki harflerin gerçek rengi.
  const textColor = weightedMedianColor(
    comps.filter((c, i) => glyph[i] && c.tone === 0).map((c) => ({ color: c.color, weight: c.count })),
  );

  // Kağıt: açık ve renksiz pikseller (mührün açık mavisi kağıt değildir).
  const paperSamples: Color[] = [];
  for (let index = 0; index < grid.w * grid.h; index += 5) {
    const color = pixelColor(grid, index);
    if (grid.lum[index] > 200 && colorDistance(color, [color[1], color[1], color[1]]) < 25) paperSamples.push(color);
  }
  const paper: Color = paperSamples.length
    ? ([0, 1, 2].map((i) => median(paperSamples.map((c) => c[i]))) as Color)
    : [255, 255, 255];

  // Satırlar yalnızca harf piksellerinden: işaretler satır şeridini bozamaz.
  const eligible = comps.map((c, i) => glyph[i] && inRegion(c));
  const perRow = new Array<number>(grid.h).fill(0);
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index];
    if (label >= 0 && eligible[label]) perRow[Math.floor(index / grid.w)]++;
  }
  // "i" noktası gövdesinden ~0,1 em ayrıktır; 0,6 puntoya kadar boşluk aynı satır.
  const bands = runs(perRow.map((count) => count >= 2), Math.round(0.6 / step));

  const rows: Row[] = [];
  for (const band of bands) {
    let members = comps
      .map((c, i) => i)
      .filter((i) => {
        if (!eligible[i]) return false;
        const cy = (comps[i].y0 + comps[i].y1) / 2;
        return cy >= band.from && cy <= band.to;
      });
    if (!members.length) continue;

    if (options.cluster) {
      // Mühür alanında yazı satırını mührün ve imzanın kendi parçalarından
      // ayıran üç şey:
      //
      // 1. Boy. Satır, gerçek harf boyundaki parçalardan kurulur. İmzanın
      //    siyah çizgiyi kestiği yerlerde kalan küçük koyu kırıntılar satır
      //    oluşturamaz (DELAN SC: kırıntılar isim satırıyla birleşip onu
      //    imzanın üstüne kadar uzatıyordu).
      // 2. Taban çizgisi. Bir satırın harfleri aynı çizgiye oturur (kuyruklu
      //    harfler biraz aşağı iner); mühür halkasındaki harfler çember
      //    boyunca farklı yüksekliklerdedir.
      // 3. Kelime boşluğu. Satır, harf yüksekliğinden küçük boşluklarla
      //    bitişik tek kümedir; daha uzaktaki parçalar başka şeydir.
      //
      // i noktası, virgül gibi küçük parçalar yalnızca bu kümenin yatay
      // kapsamı içindeyse satıra katılır.
      const small = typical * 0.35;
      const isBig = (i: number) => (comps[i].y1 - comps[i].y0 + 1) * step >= small;
      let big = members.filter(isBig);
      if (!big.length) continue;

      const bottoms = new Map<number, number>();
      for (const i of big) bottoms.set(comps[i].y1, (bottoms.get(comps[i].y1) ?? 0) + comps[i].count);
      let baseline = -1;
      let baselineWeight = -1;
      for (const [bottom] of bottoms) {
        // Yarım puntoluk tarama titremesi aynı çizgi sayılır.
        let weight = 0;
        for (const [other, count] of bottoms) if (Math.abs(other - bottom) * step <= 0.5) weight += count;
        if (weight > baselineWeight) {
          baselineWeight = weight;
          baseline = bottom;
        }
      }
      big = big.filter((i) => {
        const offset = (comps[i].y1 - baseline) * step; // + aşağı
        return offset >= -typical * 0.2 && offset <= typical * 0.5;
      });
      if (big.length < 2) continue;

      // Sütun başına gerçek piksel sayısı: parçanın tüm sayısını kapladığı
      // her sütuna eklemek geniş bir lekeyi bütün satırdan "ağır" gösteriyordu.
      const set = new Set(big);
      const columns = new Array<number>(grid.w).fill(0);
      for (let index = 0; index < labels.length; index++) if (set.has(labels[index])) columns[index % grid.w]++;
      const wordGap = Math.min(6, Math.max(2.5, typical * 0.8));
      const clusters = runs(columns.map((count) => count > 0), Math.round(wordGap / step));
      let best = clusters[0];
      let bestInk = -1;
      for (const cluster of clusters) {
        let ink = 0;
        for (let x = cluster.from; x <= cluster.to; x++) ink += columns[x];
        if (ink > bestInk) {
          bestInk = ink;
          best = cluster;
        }
      }
      const slack = Math.round(1 / step);
      const top = Math.min(...big.map((i) => comps[i].y0));
      members = members.filter((i) => {
        const c = comps[i];
        if (c.x0 < best.from - slack || c.x1 > best.to + slack) return false;
        if (set.has(i)) return true;
        // Küçük parça: kümenin içinde ve satırın dikey kapsamına yakın.
        return !isBig(i) && c.y0 >= top - Math.round(typical * 0.4 / step);
      }).filter((i) => set.has(i) || !isBig(i));
      if (!members.length) continue;
    }
    rows.push(makeRow(grid, labels, comps, members));
  }

  return { grid, labels, comps, glyph, textColor, paper, rows: rows.sort((a, b) => a.v0 - b.v0) };
}

function makeRow(grid: Grid, labels: Int32Array, comps: Component[], members: number[]): Row {
  const set = new Set(members);
  const x0 = Math.min(...members.map((i) => comps[i].x0));
  const x1 = Math.max(...members.map((i) => comps[i].x1));
  const y0 = Math.min(...members.map((i) => comps[i].y0));
  const y1 = Math.max(...members.map((i) => comps[i].y1));
  let runCount = 0;
  let runTotal = 0;
  for (let y = y0; y <= y1; y++) {
    let length = 0;
    for (let x = x0; x <= x1 + 1; x++) {
      const on = x <= x1 && set.has(labels[y * grid.w + x]);
      if (on) length++;
      else if (length) {
        runCount++;
        runTotal += length;
        length = 0;
      }
    }
  }
  return {
    v0: grid.q0 + y0 * grid.step,
    v1: grid.q0 + (y1 + 1) * grid.step,
    u0: grid.p0 + x0 * grid.step,
    u1: grid.p0 + (x1 + 1) * grid.step,
    members,
    // Ortalama yatay mürekkep koşusu (punto) — harf gövdesi kalınlığı.
    stroke: runCount ? (runTotal / runCount) * grid.step : 0,
  };
}

/**
 * Paragrafta beklenen satır sayısı OCR'dan bilinir. Fazladan satır çıkarsa:
 *
 *  - Çok dar olan (en geniş satırın dörtte birinden dar) bir kırıntıdır —
 *    mühür halkasındaki tek bir harf, bir leke. Birleştirilmez, atılır;
 *    birleştirilse satırın başını ya da sonunu yanlış yere taşır.
 *  - Yarım satır yüksekliğinden kısa bir satır, komşu satırın kutuya taşan
 *    kuyruğudur; en yakın satırla birleştirilir.
 *  - Tam boylu satırlar: `exact` ise (her OCR satırı tek bir satıra eşlenecek,
 *    ör. mühür bloğu) en yakınlar birleştirilir. Değilse olduğu gibi kalır:
 *    OCR'ın tek satır saydığı bir adres taramada iki satıra kırılmış olabilir
 *    ve iki satır ayrı ayrı ölçülmelidir; birleştirilince punto iki satır
 *    yüksekliğinden tahmin edilip dev çıkıyordu (DELAN SC 2. sayfa).
 */
function fitToLines(survey: Survey, found: Row[], expected: number, exact: boolean): Row[] {
  const list = [...found];
  const widest = Math.max(0, ...list.map((row) => row.u1 - row.u0));
  while (list.length > expected) {
    let narrowest = 0;
    for (let i = 1; i < list.length; i++) {
      if (list[i].u1 - list[i].u0 < list[narrowest].u1 - list[narrowest].u0) narrowest = i;
    }
    // Kırıntı: dar ve en fazla iki parça. Dar ama çok harfli bir satır
    // ("Switzerland") tek OCR satırının ikinci görsel satırıdır; atılırsa
    // silinmeden kalır.
    const debris = list[narrowest];
    if (debris.u1 - debris.u0 < widest * 0.25 && debris.members.length <= 2) {
      list.splice(narrowest, 1);
      continue;
    }
    const heights = list.map((row) => row.v1 - row.v0);
    const typicalHeight = median(heights);
    const fragment = heights.findIndex((height) => height < typicalHeight * 0.5);
    if (fragment < 0 && !exact) break;

    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i + 1 < list.length; i++) {
      if (fragment >= 0 && i !== fragment && i + 1 !== fragment) continue;
      const gap = list[i + 1].v0 - list[i].v1;
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    const merged = makeRow(survey.grid, survey.labels, survey.comps, [
      ...list[best].members,
      ...list[best + 1].members,
    ]);
    list.splice(best, 2, merged);
  }
  return list;
}

/**
 * Bir satırı silmenin yolu. Satırın yakınında başka bir işaret yoksa düz bir
 * kutu en temiz sonucu verir. Varsa (mühür halkası, imza, imza çizgisi —
 * hangi renkte olursa olsun) yalnızca satırın kendi harf pikselleri ve
 * onların yumuşak kenarları silinir.
 */
function eraseRow(
  survey: Survey,
  row: Row,
  limit: Rect,
): { rect: Rect | null; mask: Mask | null; caution: string | null } {
  const { grid, labels, comps, glyph } = survey;
  // Harfin çevresindeki soluk iz de silinecek alana girsin (~2 punto).
  const pad = 2.2;
  const rect: Rect = {
    u0: Math.max(limit.u0, row.u0 - pad),
    v0: Math.max(limit.v0, row.v0 - pad),
    u1: Math.min(limit.u1, row.u1 + pad),
    v1: Math.min(limit.v1, row.v1 + pad),
  };
  const x0 = Math.max(0, Math.floor((rect.u0 - grid.p0) / grid.step));
  const y0 = Math.max(0, Math.floor((rect.v0 - grid.q0) / grid.step));
  const x1 = Math.min(grid.w - 1, Math.ceil((rect.u1 - grid.p0) / grid.step) - 1);
  const y1 = Math.min(grid.h - 1, Math.ceil((rect.v1 - grid.q0) / grid.step) - 1);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w <= 0 || h <= 0) return { rect: null, mask: null, caution: null };

  const members = new Set(row.members);
  // own: satırın harf pikseli; other: başka bir parçanın (işaret ya da başka
  // satır) pikseli.
  const own = new Uint8Array(w * h);
  const other = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const label = labels[(y0 + y) * grid.w + x0 + x];
      if (members.has(label)) own[y * w + x] = 1;
      else if (label >= 0) other[y * w + x] = 1;
    }
  }
  const within = (plane: Uint8Array, x: number, y: number, radius: number) => {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && plane[ny * w + nx]) return true;
      }
    }
    return false;
  };
  const near = (x: number, y: number, radius: number) => within(own, x, y, radius);

  // Başka bir işaret var mı: koyu bir yabancı parça (başka bir satırın harfi
  // de olabilir; kutu onu da keserdi), ya da satırın harflerine yakın olmayan
  // açık bir mürekkep (açık mavi mühür, soluk imza). Açık mürekkep sayılması
  // için renkli ya da belirgin koyu olmalı ve birkaç pikselden fazla olmalı;
  // taramanın açık gri JPEG gürültüsü her hücrede maske seçtiriyordu.
  // Bakılan alan kutudan 1 punto geniştir: düz bir kutu başka bir işaretin
  // 1 punto yakınına asla girmez, girecekse piksel maskesi seçilir.
  const foreign = new Set<number>();
  let lightPixels = 0;
  const margin = Math.round(1 / grid.step);
  for (let gy = Math.max(0, y0 - margin); gy <= Math.min(grid.h - 1, y1 + margin); gy++) {
    for (let gx = Math.max(0, x0 - margin); gx <= Math.min(grid.w - 1, x1 + margin); gx++) {
      const index = gy * grid.w + gx;
      const label = labels[index];
      if (label >= 0 && !members.has(label)) foreign.add(label);
      else if (label < 0 && grid.lum[index] < 200 && !near(gx - x0, gy - y0, 2)) {
        const [r, g, b] = pixelColor(grid, index);
        if (Math.max(r, g, b) - Math.min(r, g, b) >= 40 || grid.lum[index] < 170) lightPixels++;
      }
    }
  }
  const lightInk = lightPixels >= 20;
  // Yazıyla aynı tonda bir işaret (siyah mühür, siyah imza, siyah çizgi)
  // yazının şeridine girip satıra 1,5 puntodan fazla yaklaşıyorsa harfle
  // kaynaşmış olabilir; kaynaşan ikisi tek parçadır ve kesin ayrılamaz.
  // İşareti koruruz, inceleyeni uyarırız. İmzacı adının üstündeki imza
  // çizgisi gibi şeride girmeyen işaretler sayılmaz; başka renkteki işaretler
  // zaten ayrı parçadır.
  let caution: string | null = null;
  const bandX0 = Math.max(0, Math.floor((row.u0 - 1.5 - grid.p0) / grid.step));
  const bandX1 = Math.min(grid.w - 1, Math.ceil((row.u1 + 1.5 - grid.p0) / grid.step) - 1);
  const bandY0 = Math.max(0, Math.floor((row.v0 - grid.q0) / grid.step));
  const bandY1 = Math.min(grid.h - 1, Math.ceil((row.v1 - grid.q0) / grid.step) - 1);
  search: for (let y = bandY0; y <= bandY1; y++) {
    for (let x = bandX0; x <= bandX1; x++) {
      const label = labels[y * grid.w + x];
      if (label >= 0 && !members.has(label) && !glyph[label] && comps[label].tone !== 1) {
        caution =
          "Bu satır aynı renkte bir mühür, imza ya da çizgiyle kesişiyor; işaret korundu, kesişen harfler tam silinmemiş olabilir. Çıktıyı kontrol edin.";
        break search;
      }
    }
  }

  if (!foreign.size && !lightInk) return { rect, mask: null, caution };

  // ~2 punto: harfin çevresindeki bulanıklık ve JPEG izi bu kadar sürüyor
  // (DELAN SC ölçümü: 1 puntoda 437 soluk piksel kalıyordu).
  const haloRadius = Math.max(1, Math.round(2 / grid.step));
  const bits = new Uint8Array(Math.ceil((w * h) / 8));
  // Silinen pikseller, maskenin kendi çevresindeki kağıdın tonuyla boyanır:
  // sararmış taramalarda kağıt tonu sayfa boyunca değişir.
  const paperHere: Color[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const index = (y0 + y) * grid.w + x0 + x;
      const label = labels[index];
      let erase = own[y * w + x] === 1;
      // Harfin çevresi: harfe ~2 punto yakın bütün renksiz pikseller, kağıt
      // dahil. İki ölçüm:
      //  - Tarama bulanıklığı ve JPEG'in 8×8 bloklarının soluk izi koyu
      //    yazının çevresinde birkaç piksel sürüyor (DELAN SC 2. sayfa başlığı).
      //  - Maske harfin görünür kenarına tam oturunca, görüntüleyici sayfayı
      //    küçültürken maskenin sınırı yarı saydam kalıyor ve altındaki gri
      //    kenar harfin ana hattı olarak geri çıkıyordu (1. sayfa, 5. satır).
      //    Sınır saf kağıda düşmeli.
      // Renkli pikseller (mührün açık mavisi) ve başka bir işaretin hemen
      // yanındakiler (onun kendi kenarı) korunur.
      if (!erase && label < 0 && near(x, y, haloRadius) && !within(other, x, y, 1)) {
        const [r, g, b] = pixelColor(grid, index);
        if (Math.max(r, g, b) - Math.min(r, g, b) < 40) erase = true;
      }
      if (erase) {
        const bit = y * w + x;
        bits[bit >> 3] |= 1 << (bit & 7);
      } else if (label < 0 && grid.lum[index] >= 235) {
        const color = pixelColor(grid, index);
        if (Math.max(...color) - Math.min(...color) < 25) paperHere.push(color);
      }
    }
  }

  return {
    rect: null,
    mask: {
      rect: {
        u0: grid.p0 + x0 * grid.step,
        v0: grid.q0 + y0 * grid.step,
        u1: grid.p0 + (x1 + 1) * grid.step,
        v1: grid.q0 + (y1 + 1) * grid.step,
      },
      w,
      h,
      bits: Buffer.from(bits).toString("base64"),
      paper: paperHere.length ? ([0, 1, 2].map((i) => median(paperHere.map((c) => c[i]))) as Color) : survey.paper,
    },
    caution,
  };
}

// ---------- satırdan yazım planı ----------

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

type Placement = {
  align: OverlayItem["align"] | "auto";
  column: string | null;
  /**
   * Sola dayalı satırda çeviri, sağı boş kaldığı sürece sağa uzayabilir.
   * Türkçe çoğu zaman daha uzundur ("Head of Global Supply Chain &
   * Sourcing" → "Küresel Tedarik Zinciri ve Kaynak Kullanımı Müdürü");
   * yalnızca eski yazının genişliğine sıkıştırmak yazıyı gereksiz küçültür.
   */
  extend?: boolean;
};

/**
 * Seçilmiş satırlardan tek bir yazım planı. `region` çevirinin ve silmenin
 * sınırıdır (hücrenin içi, paragraf kutusu).
 */
function itemFrom(
  frame: Frame,
  pageNo: number,
  site: Survey,
  text: Row[],
  region: Rect,
  lines: OcrLine[],
  options: Placement,
): Measured {
  const first = text[0];
  // Yazının altındaki ilk büyük işaret (ör. hücredeki ambalaj fotoğrafı) sınırdır.
  const { grid, comps, glyph } = site;
  const below = comps
    .filter((c, i) => !glyph[i] && (c.y1 - c.y0 + 1) * grid.step > MAX_TEXT_BAND_PT)
    .map((c) => grid.q0 + c.y0 * grid.step)
    .filter((top) => top > first.v1 && top < region.v1);
  const bottom = below.length ? Math.min(...below) - 1 : region.v1;
  const inkLeft = Math.min(...text.map((row) => row.u0));
  const inkRight = Math.max(...text.map((row) => row.u1));

  let align: OverlayItem["align"] = options.align === "auto" ? "left" : options.align;
  if (options.align === "auto") {
    const width = region.u1 - region.u0;
    if (text.length >= 2) {
      // Birden çok satırda hizalama, hangi kenarın sabit kaldığından okunur.
      const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
      const lefts = spread(text.map((row) => row.u0));
      const centers = spread(text.map((row) => (row.u0 + row.u1) / 2));
      const rights = spread(text.map((row) => row.u1));
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

  const heights = text.map((row) => row.v1 - row.v0);
  const tops = text.map((row) => row.v0);
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

  // Tek satırlık sola dayalı yazı sağa uzayabilir. Birden çok satırlı bir
  // blokta sağ kenar bloğun kendi genişliğidir; uzatılırsa iki satır tek
  // satıra yayılır (DELAN SC 2. sayfa üst adresi dev boyda tek satır oldu).
  if (options.extend && align === "left" && text.length === 1) {
    // Sağdaki boşluk: herhangi bir mürekkep (her renk) görülene ya da sayfa
    // kenar payına gelene kadar. Tarama satırın kendi yazısının bittiği
    // yerden başlar; bölge kenarı yazının son harfinin üstüne denk gelebilir.
    const last = text[text.length - 1];
    const limit = frame.page.width - 25;
    const start = area.u1;
    area.u1 = Math.max(area.u1, inkRight + 1);
    while (area.u1 + 1 <= limit) {
      const strip = sample(frame, { u0: area.u1, v0: first.v0 - 0.5, u1: area.u1 + 1, v1: last.v1 + 0.5 });
      if (strip.lum.some((lum) => lum < 200)) {
        // Komşu yazıya yapışmasın: yan sütundan birkaç punto önce dur.
        area.u1 = Math.max(start, area.u1 - 4);
        break;
      }
      area.u1 += 1;
    }
  }

  const erase: Rect[] = [];
  const masks: Mask[] = [];
  let caution: string | null = null;
  for (const row of text) {
    const result = eraseRow(site, row, region);
    if (result.rect) erase.push(result.rect);
    if (result.mask) masks.push(result.mask);
    caution ??= result.caution;
  }

  return {
    page: pageNo,
    lineIds: lines.map((line) => line.id),
    area,
    erase,
    masks,
    caution,
    align,
    leading,
    background: site.paper,
    ink: site.textColor,
    estimate,
    weight: median(text.map((row) => row.stroke)),
    column: options.column,
  };
}

/** Tarama lekesi (tek nokta, çizgi kırıntısı) satır sayılmaz. */
function isSpeck(row: Row) {
  return row.v1 - row.v0 < 1.5 || row.u1 - row.u0 < 2;
}

/**
 * Hücre ya da serbest bölge: yazı, ilk satırdan sonra satır yüksekliğinin
 * 1,5 katından büyük ilk boşlukta biter. Açık renkli bir fotoğraf tek bir
 * büyük parça vermez; kapak, kenar ve alt yazı gibi küçük parçalara bölünür
 * (DELAN SC 12. satır: etiket, altında ambalaj fotoğrafı ve fotoğrafın
 * parçası olan "0.25 L 0.5L 1L 5L" yazıları). Onlar yazı sanılıp silinmesin.
 */
function leadingRows(rows: Row[]): Row[] {
  let text = rows.some((row) => !isSpeck(row)) ? rows.filter((row) => !isSpeck(row)) : rows;
  const lineHeight = median(text.map((row) => row.v1 - row.v0));
  const end = text.findIndex((row, i) => i > 0 && row.v0 - text[i - 1].v1 > lineHeight * 1.5);
  if (end > 0) text = text.slice(0, end);
  return text;
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

/** Paragraf ve mühür bölgelerinde ızgaranın çevreye taşma payı (punto). */
const CONTEXT_MARGIN = 12;

export async function planOverlay(pdfBytes: Uint8Array, blocks: LayoutBlock[]): Promise<OverlayPlan> {
  const { pages } = await loadScanPages(pdfBytes);
  const frames: Frame[] = pages.map((page) => {
    const skew = estimateSkew(page);
    return { page, skew, textColor: pageInk(page), ...frameFor(page, skew) };
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
    if (!frame || !block.frame) {
      skip(allLines, "Satırın sayfadaki konumu bilinmiyor.");
      return;
    }
    const box = toFrame(block.frame.box, block.frame, frame);

    if (block.kind === "image") {
      // Mühürlü/imzalı bloğun içindeki basılı yazı (imzacı adı, unvanı). Her
      // satır kendi başına çevrilir ki değişmeyen isim satırına dokunulmasın.
      const region = grow(box, 1, 1);
      const site = survey(frame, grow(box, CONTEXT_MARGIN, CONTEXT_MARGIN), region, { cluster: true });
      const found = fitToLines(site, site.rows.filter((row) => !isSpeck(row)), block.lines.length, true);
      if (found.length !== block.lines.length) {
        skip(allLines, "Mühür/imza alanındaki yazı satırları ayırt edilemedi; yerinde çevrilmedi.");
        return;
      }
      block.lines.forEach((line, index) => {
        const row = found[index];
        // Satırın alanı: kendi şeridi, sağa doğru bloğun kenarına kadar.
        const lineRegion = { u0: region.u0, v0: row.v0 - 1, u1: region.u1, v1: row.v1 + 1 };
        measured.push(
          itemFrom(frame, block.page, site, [row], lineRegion, [line], { align: "left", column: null, extend: true }),
        );
      });
      return;
    }

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
          // Hücre zaten çizgilerin içi; az içeri çekmek yeter. Izgara hücrenin
          // dışına taşmaz: harfe değen tablo çizgisi onunla tek parça olup
          // harfi "işaret" gösterirdi.
          const region = grow(cells[r][c], -0.4, -0.4);
          const site = survey(frame, region, region, { cluster: false });
          const text = leadingRows(site.rows);
          if (!text.length) {
            skip(cell.lines, "Taramada bu satırın yazısı bulunamadı.");
            return;
          }
          measured.push(
            itemFrom(frame, block.page, site, text, region, cell.lines, { align: "auto", column: `${blockIndex}:${c}` }),
          );
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
    const region = grow(box, 1.5, 1);
    const site = survey(frame, grow(box, CONTEXT_MARGIN, CONTEXT_MARGIN), box, { cluster: false });
    const text = fitToLines(site, site.rows.filter((row) => !isSpeck(row)), block.lines.length, false);
    if (!text.length) {
      skip(block.lines, "Taramada bu satırın yazısı bulunamadı.");
      return;
    }
    measured.push(itemFrom(frame, block.page, site, text, region, block.lines, { align, column: null, extend: true }));
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

/**
 * Maskeden saydam bir PNG: silinecek pikseller kağıt renginde ve opak, geri
 * kalan her şey tamamen saydam. Böylece altındaki taramanın hiçbir pikseli
 * (mühür, imza, kağıt dokusu) değişmez.
 *
 * Saydam piksellerin rengi de kağıt rengidir. Görüntüleyiciler görseli
 * ölçeklerken rengi ve saydamlığı ayrı ayrı karıştırır; saydam pikseller
 * siyah bırakılınca her maskenin kenarında ince gri bir çizgi oluşup silinen
 * yazının ana hatlarını geri çiziyordu (DELAN SC 1. sayfa, 5. satır).
 */
async function maskImage(mask: Mask, paper: Color): Promise<Uint8Array> {
  const bits = Buffer.from(mask.bits, "base64");
  const raw = Buffer.alloc(mask.w * mask.h * 4);
  for (let i = 0; i < mask.w * mask.h; i++) {
    raw[i * 4] = paper[0];
    raw[i * 4 + 1] = paper[1];
    raw[i * 4 + 2] = paper[2];
    raw[i * 4 + 3] = (bits[i >> 3] >> (i & 7)) & 1 ? 255 : 0;
  }
  return new Uint8Array(await sharp(raw, { raw: { width: mask.w, height: mask.h, channels: 4 } }).png().toBuffer());
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
  // Tam gömme: pdf-lib'in alt küme gömmesi bu yazı tipinde harfleri düşürüyordu.
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
    for (const mask of item.masks) {
      const corner = place(mask.rect.u0, mask.rect.v1);
      page.drawImage(await doc.embedPng(await maskImage(mask, mask.paper ?? item.background)), {
        x: corner.x,
        y: corner.y,
        width: mask.rect.u1 - mask.rect.u0,
        height: mask.rect.v1 - mask.rect.v0,
        rotate,
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


