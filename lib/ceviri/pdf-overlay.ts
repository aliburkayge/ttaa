import { degrees, PDFDocument, rgb, type PDFFont } from "pdf-lib";
import { classifyFamily, fontsFor, type Family } from "./fonts";
import { reconstructPaper } from "./inpaint";
import { findInkRegions, inkShare, markMask, signatureShare, type InkMap, type InkRegion } from "./ink-marks";
import { isMark, markText, type MarkKind } from "./marks";
import { LOW_CONFIDENCE, type Box, type ImageKind, type LayoutBlock, type OcrLine } from "./ocr-layout";
import { openScan, pageGeometry, type ScanPage } from "./pdf-scan";
import { tidyTarget } from "./qa";

/**
 * Çeviriyi taranmış PDF'in üstüne, İngilizce yazının tam yerine yazar.
 *
 * Kural (müşteri): yüklenen belge görsel olarak ve tablo düzeni olarak hiç
 * değişmez. Sayfanın kendisi aynen kalır; yalnızca çevrilen satırın kendi
 * harfleri silinir ve çeviri aynı konuma, ölçülen punto, kalınlık, mürekkep
 * rengi ve eğiklikle yazılır. Logo, çizgi ve fotoğraf piksellerine
 * dokunulmaz — hangi renkte olurlarsa olsunlar.
 *
 * İmza ve mühür istisnadır (müşteri kuralı, 2026-09-22): çeviride kopyalanmaz.
 * Bölgenin tamamı silinir ve yerine köşeli parantez içinde hedef dilde etiket
 * yazılır: [İMZA], [MÜHÜR: mührün çevrilmiş yazısı]. Bkz. marks.ts.
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
  /** Yazı tipi ailesi, belge boyunca ölçülür. Eski planlarda yoktur: serif. */
  family?: Family;
  /**
   * Orijinal satırın altı çiziliyse: çizginin taban çizgisinden uzaklığı ve
   * kalınlığı (punto, ölçülen puntoya göre). Eski çizgi silinir, çevirinin
   * altına kendi uzunluğunda yeniden çizilir.
   */
  underline?: { offset: number; thickness: number };
  /** Yazım alanının altındaki boş kağıt (punto): uzun çeviri önce buraya taşar, sonra küçülür. */
  room?: number;
  background: Color;
  ink: Color;
  /**
   * İmza/mühür bölgesi: bölgenin tamamı silinir, yerine hedef dilde etiket
   * yazılır (bkz. marks.ts). `lineIds` bölgenin içinden okunan satırlardır.
   */
  mark?: MarkKind;
  /** Bir işaret bölgesi bu satırın üstünü de sildi: çevirisi değişmese de yeniden yazılır. */
  redraw?: boolean;
};

export type OverlayPlan = {
  /**
   * Planı çıkaran algoritmanın sürümü. Kayıtlı plan bundan eskiyse indirmede
   * yeniden çıkarılır: iyileştirmeler eski belgelere de yeniden yükleme ve
   * OCR gerekmeden yansır.
   */
  version?: number;
  /** Sayfa başına tarama eğikliği (radyan); düzeltilmiş koordinatların dönüşü. */
  pages: Array<{ skew: number }>;
  items: OverlayItem[];
  /** Orijinal konumuna yazılamayacak satırlar ve nedeni. */
  unplaced: Array<{ id: string; reason: string }>;
};

/** Planlama algoritmasının sürümü; planlamayı değiştiren her iyileştirmede artırılır. */
export const PLAN_VERSION = 4;

/** Taranmış PDF için veritabanında saklanan düzen (`ceviri_documents.layout`). */
export type ScanLayout = {
  version: 2;
  blocks: LayoutBlock[];
  /** null ise sayfa ölçülemedi; neden `overlayError`da. */
  overlay: OverlayPlan | null;
  overlayError: string | null;
  /** OCR'ın notu; belge sonradan açıldığında da gösterilsin diye saklanır. */
  ocr?: { warning: string | null; provider: string | null; demo: boolean };
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

/**
 * Sayfanın yazı rengi: ince koyu yapıların (yanı başında kağıt olan koyu
 * piksellerin) ortancası. Harf çizgisi incedir; dolu bir logonun, renkli bir
 * başlık bandının ya da fotoğrafın içi değildir. Bütün koyu piksellerin
 * ortancası alınınca büyük mavi bir kutu sayfanın "yazı rengi" oluyor, siyah
 * yazı başka renk sayılıp hiç bulunamıyordu.
 */
function pageInk(page: ScanPage): Color {
  const lum = (color: Color | null) => (color ? 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2] : 255);
  const reach = 1.5;
  const samples: Color[] = [];
  for (let v = 0; v < page.height; v += 1) {
    for (let u = 0; u < page.width; u += 1) {
      const color = page.rgb(u, v);
      if (!color || lum(color) >= DARK) continue;
      const nearPaper =
        lum(page.rgb(u - reach, v)) > 180 ||
        lum(page.rgb(u + reach, v)) > 180 ||
        lum(page.rgb(u, v - reach)) > 180 ||
        lum(page.rgb(u, v + reach)) > 180;
      if (nearPaper) samples.push(color);
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
function survey(frame: Frame, context: Rect, rowRegion: Rect): Survey {
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
    const members = comps
      .map((c, i) => i)
      .filter((i) => {
        if (!eligible[i]) return false;
        const cy = (comps[i].y0 + comps[i].y1) / 2;
        return cy >= band.from && cy <= band.to;
      });
    if (!members.length) continue;

    for (const line of splitLines(members, band, typical)) rows.push(makeRow(grid, labels, comps, line));
  }

  return { grid, labels, comps, glyph, textColor, paper, rows: rows.sort((a, b) => a.v0 - b.v0) };

  /**
   * Tek satır aralıklı metinde bir satırın kuyrukları (g, p, y) sonrakinin
   * uzun harflerine değer; satırlar arasında boş piksel satırı kalmaz ve
   * paragraf tek bir bant görünür (BASF 6. sayfa: 3 satır tek 37 puntoluk
   * "satır" ölçülüp 26 punto yazılıyordu). Satırın gövdesi (x yüksekliği)
   * izdüşümde belirgin bir tepe, satır arası belirgin bir çukurdur; çukur
   * sıfıra inmese de. Bant çukurlardan bölünür.
   */
  function splitLines(members: number[], band: { from: number; to: number }, typical: number): number[][] {
    if ((band.to - band.from + 1) * step <= typical * 1.8) return [members];
    const raw = perRow.slice(band.from, band.to + 1);
    const win = Math.max(1, Math.round((typical * 0.15) / step));
    const smooth = raw.map((_, k) => {
      let sum = 0;
      let count = 0;
      for (let d = -win; d <= win; d++) {
        const value = raw[k + d];
        if (value === undefined) continue;
        sum += value;
        count++;
      }
      return sum / count;
    });
    const highest = Math.max(...smooth);
    const minGap = Math.round((typical * 0.9) / step);
    const peaks: number[] = [];
    for (let k = 0; k < smooth.length; k++) {
      if (smooth[k] < highest * 0.45) continue;
      if (smooth[k] < (smooth[k - 1] ?? -1) || smooth[k] < (smooth[k + 1] ?? -1)) continue;
      const last = peaks[peaks.length - 1];
      if (last !== undefined && k - last < minGap) {
        if (smooth[k] > smooth[last]) peaks[peaks.length - 1] = k;
      } else {
        peaks.push(k);
      }
    }
    const cuts: number[] = [];
    for (let p = 0; p + 1 < peaks.length; p++) {
      let low = peaks[p];
      for (let k = peaks[p]; k <= peaks[p + 1]; k++) if (smooth[k] < smooth[low]) low = k;
      if (smooth[low] < Math.min(smooth[peaks[p]], smooth[peaks[p + 1]]) * 0.5) cuts.push(band.from + low);
    }
    if (!cuts.length) return [members];
    const groups: number[][] = cuts.map(() => []).concat([[]]);
    for (const i of members) {
      const cy = (comps[i].y0 + comps[i].y1) / 2;
      groups[cuts.filter((cut) => cut < cy).length].push(i);
    }
    return groups.filter((group) => group.length > 0);
  }
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
 *  - Tam boylu satırlar olduğu gibi kalır:
 *    OCR'ın tek satır saydığı bir adres taramada iki satıra kırılmış olabilir
 *    ve iki satır ayrı ayrı ölçülmelidir; birleştirilince punto iki satır
 *    yüksekliğinden tahmin edilip dev çıkıyordu (DELAN SC 2. sayfa).
 */
function fitToLines(survey: Survey, found: Row[], expected: number): Row[] {
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
    if (fragment < 0) break;

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
 * Dik ve dar harflerde (l, I, 1, |) dipteki ayağın gövdeden taşması, harf
 * yüksekliğine oranla. Times ailesinde dipte yatay bir ayak (serif) vardır,
 * gövdenin iki yanına taşar (taramada ≈ 0,13–0,16); Arial ailesinde düz bir
 * çubuktur (≈ 0). Gövdeye değil yüksekliğe oranlanır: kalın yazıda gövde
 * kalınlaşır ama ayak yine aynı kadar taşar. Puntodan bağımsızdır.
 */
function footRatios(site: Survey, row: Row): number[] {
  const { grid, comps, glyph, labels } = site;
  const bandPixels = (row.v1 - row.v0) / grid.step;
  const members = row.members.filter((index) => glyph[index]);
  if (members.length < 3) return [];
  // Taban çizgisi: harflerin çoğunun oturduğu alt kenar. Parantez, köşeli
  // parantez ve j gibi alta inen dikey harfler ayak ölçüsüne karışmasın.
  const baseline = median(members.map((index) => comps[index].y1));
  const ratios: number[] = [];
  for (const index of members) {
    const c = comps[index];
    const height = c.y1 - c.y0 + 1;
    const width = c.x1 - c.x0 + 1;
    if (height < 12 || width > height * 0.35 || height < bandPixels * 0.55) continue;
    if (Math.abs(c.y1 - baseline) > Math.max(1.5, height * 0.06)) continue;
    // Bir piksel satırında harfin sol ve sağ kenarı.
    const across = (y: number) => {
      let left = Infinity;
      let right = -Infinity;
      for (let x = c.x0; x <= c.x1; x++) {
        if (labels[y * grid.w + x] === index) {
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      }
      return { left, right, width: right >= left ? right - left + 1 : 0 };
    };
    // Yalnızca düz dikey çubuklar: gövdenin %30–70'i boyunca genişlik sabit ve
    // eksen kaymıyor. f (yatay çizgi), / (eğik) böyle elenir.
    const levels = [0.3, 0.5, 0.7].map((f) => across(c.y0 + Math.floor(height * f)));
    const stem = levels[1];
    if (stem.width < 2) continue;
    const widths = levels.map((level) => level.width);
    if (Math.max(...widths) - Math.min(...widths) > Math.max(1, stem.width * 0.25)) continue;
    const centers = levels.map((level) => (level.left + level.right) / 2);
    if (Math.abs(centers[0] - centers[2]) > stem.width) continue;
    // Ayak gövdenin İKİ yanına taşar; Arial "t" gibi yalnızca sağa kıvrılan
    // bir dip ayak değildir. Ölçü, iki yandaki taşmanın küçük olanı.
    let overhang = 0;
    for (let y = c.y1 - Math.max(0, Math.round(height * 0.1) - 1); y <= c.y1; y++) {
      const bottom = across(y);
      if (!bottom.width) continue;
      overhang = Math.max(overhang, Math.min(stem.left - bottom.left, bottom.right - stem.right));
    }
    ratios.push((2 * Math.max(0, overhang)) / height);
  }
  return ratios;
}

/**
 * Her yazım öğesinin yazı tipi ailesi. Her ayak ölçüsü bir oydur: serif
 * ayaklı harf Times'a, düz çubuk Arial'e. Önce öğenin kendi harfleri; yetmezse
 * aynı puntodaki yakın satırlar (bir adres yığını, bir alt bilgi); o da
 * yetmezse sayfa, sonra belge; hiçbiri yoksa `fallback`.
 */
function assignFamilies(
  items: Array<{ page: number; area: Rect; fontSize: number; feet: number[] }>,
  fallback: Family,
): Family[] {
  // Düşük çözünürlüklü (200 DPI, siyah-beyaz) taramada Times ayağı bir
  // piksel taşar ve bir yanı çoğu zaman pikselleşmede kaybolur: Times
  // harflerinin ancak üçte biri ayaklı ölçülür. Arial'de bu oran %0–3'tür
  // (müşteri belgelerinde ölçüldü). Eşik bu yüzden yarı değil beşte bir.
  const decide = (ratios: number[], minimum: number): Family | null => {
    if (ratios.length < minimum) return null;
    const serif = ratios.filter((ratio) => ratio >= SERIF_FOOT_RATIO).length;
    return serif >= ratios.length * SERIF_VOTE_SHARE ? "serif" : "sans";
  };
  const all = items.flatMap((item) => item.feet);
  return items.map((item) => {
    const own = decide(item.feet, 5);
    if (own) return own;
    const near = items
      .filter((other) => {
        if (other.page !== item.page) return false;
        if (Math.abs(other.fontSize - item.fontSize) > item.fontSize * 0.25) return false;
        const gap = Math.max(other.area.v0, item.area.v0) - Math.min(other.area.v1, item.area.v1);
        const overlap = Math.min(other.area.u1, item.area.u1) - Math.max(other.area.u0, item.area.u0);
        return gap <= item.fontSize * 3 && overlap > 0;
      })
      .flatMap((other) => other.feet);
    return (
      decide(near, 5) ??
      decide(items.filter((other) => other.page === item.page).flatMap((other) => other.feet), 8) ??
      decide(all, 10) ??
      fallback
    );
  });
}

/** Satırın beklenen harf parçası sayısı: boşluksuz karakterler, noktalı harflerin noktası ayrı parçadır. */
function expectedParts(text: string): number {
  const visible = text.replace(/\s+/g, "");
  return visible.length + (visible.match(/[ijİ:;!?=%"÷]/g)?.length ?? 0);
}

const HANDWRITTEN = "El yazısı ya da imza gibi görünüyor; dokunulmadı, çevirisi belgeye yazılmadı.";

/**
 * El yazısı ya da el yazısı stilinde bir imza satırı mı? Bitişik yazıda
 * harfler birbirine bağlıdır: taramadaki harf parçası sayısı metnin karakter
 * sayısının çok altında kalır ("Sylvia Dillard for": 16 karakter, ~5 parça).
 * Basılı yazıda her harf ayrı parçadır. Böyle bir satır silinip düz yazıyla
 * yeniden yazılırsa imza bozulur; yerinde bırakılır ve inceleyene bildirilir.
 */
function looksHandwritten(site: Survey, rows: Row[], lines: OcrLine[]): boolean {
  const wanted = lines.reduce((sum, line) => sum + expectedParts(line.text), 0);
  if (wanted < 6) return false;
  const parts = rows.reduce((sum, row) => sum + row.members.filter((index) => site.glyph[index]).length, 0);
  return parts < wanted * 0.45;
}

/**
 * Taramadaki satırları OCR satırlarına sırayla eşler: her OCR satırı bir ya da
 * birkaç ardışık tarama satırına (paragrafta kırılan satır) düşer, hiçbir
 * satıra ait olmayan ince kırıntılar (yazıya değen imzanın parçaları) dışarıda
 * kalır — dışarıda kalan hiçbir şey silinmez.
 *
 * Ölçü, satırın harf parçası sayısının OCR metninin karakter sayısına
 * uymasıdır (dinamik programlama). Satıra fazladan mürekkep karışması
 * (üstünden geçen imza) ucuzdur; eksik mürekkep pahalıdır ve belli bir
 * sınırın altında eşleme reddedilir — o zaman blok eskisi gibi tek parça
 * yazılır.
 */
function alignRowsToLines(site: Survey, rows: Row[], lines: OcrLine[]): Row[][] | null {
  if (rows.length < lines.length) return null;
  const parts = rows.map((row) => row.members.filter((index) => site.glyph[index]).length);
  const wanted = lines.map((line) => Math.max(1, expectedParts(line.text)));
  const densest = Math.max(...parts);
  const dense = rows.filter((_, i) => parts[i] >= densest * 0.25).map((row) => row.v1 - row.v0);
  const typical = dense.length ? median(dense) : median(rows.map((row) => row.v1 - row.v0));
  // İnce ve seyrek satır kırıntıdır; atlanması neredeyse bedava. Gerçek bir
  // yazı satırını atlamak ise pahalı: silinmeden kalırdı.
  const skip = rows.map((row, i) => (row.v1 - row.v0 < typical * 0.6 && parts[i] < densest * 0.25 ? 0.02 : 5));
  const fit = (have: number, want: number) =>
    have >= want ? 0.15 * ((have - want) / want) : 2 * ((want - have) / want);

  const R = rows.length;
  const N = lines.length;
  const MAX_GROUP = 6;
  const cost = Array.from({ length: R + 1 }, () => new Array<number>(N + 1).fill(Infinity));
  const from = Array.from({ length: R + 1 }, () => new Array<[number, number, boolean]>(N + 1));
  cost[0][0] = 0;
  for (let i = 0; i <= R; i++) {
    for (let j = 0; j <= N; j++) {
      const here = cost[i][j];
      if (!Number.isFinite(here)) continue;
      if (i < R && here + skip[i] < cost[i + 1][j]) {
        cost[i + 1][j] = here + skip[i];
        from[i + 1][j] = [i, j, false];
      }
      if (j < N) {
        let have = 0;
        for (let k = i; k < Math.min(R, i + MAX_GROUP); k++) {
          have += parts[k];
          const next = here + fit(have, wanted[j]);
          if (next < cost[k + 1][j + 1]) {
            cost[k + 1][j + 1] = next;
            from[k + 1][j + 1] = [i, j, true];
          }
        }
      }
    }
  }
  if (!Number.isFinite(cost[R][N])) return null;

  const groups: Row[][] = new Array(N);
  let i = R;
  let j = N;
  while (i > 0 || j > 0) {
    const [pi, pj, assigned] = from[i][j];
    if (assigned) groups[pj] = rows.slice(pi, i);
    i = pi;
    j = pj;
  }
  // Her satırda harflerin çoğu bulunmalı; yoksa eşleme yanlıştır.
  const trusted = groups.every((group, index) => {
    const have = group.reduce((sum, row) => sum + row.members.filter((member) => site.glyph[member]).length, 0);
    return group.length > 0 && have >= wanted[index] * 0.65;
  });
  return trusted ? groups : null;
}

/**
 * Satırın şeridindeki küçük, yazı renkli parçalar: satıra katılmamış noktalama,
 * i noktası, kağıt lekesi. Yazının arasında görünmezler, yazı silinince
 * ortada kalıp göze batarlar (telefonla çekilmiş sayfada her satırda vardı).
 * Renkli parçalar (mühür, imza) bunlardan sayılmaz.
 */
function strays(survey: Survey, row: Row): number[] {
  const { grid, comps } = survey;
  const band = row.v1 - row.v0;
  const found: number[] = [];
  const members = new Set(row.members);
  const colorful = colorMatters(survey);
  comps.forEach((c, index) => {
    if (members.has(index) || (colorful && c.tone === 1)) return;
    const height = (c.y1 - c.y0 + 1) * grid.step;
    const width = (c.x1 - c.x0 + 1) * grid.step;
    if (height > band * 0.45 || width > Math.max(2.5, band * 0.3)) return;
    const u = grid.p0 + ((c.x0 + c.x1 + 1) / 2) * grid.step;
    const v = grid.q0 + ((c.y0 + c.y1 + 1) / 2) * grid.step;
    if (u >= row.u0 - 1 && u <= row.u1 + 1 && v >= row.v0 - band * 0.25 && v <= row.v1 + band * 0.25) found.push(index);
  });
  return found;
}

/**
 * Bölgede gerçekten renkli bir işaret (mühür, imza, renkli logo) var mı?
 * Yoksa renk yalnızca gürültüdür: telefonla çekilmiş sayfada harf kenarları
 * kameranın renk saçaklanmasıyla renkli görünür. O zaman renkli küçük
 * parçalar ve harfin çevresindeki renkli pikseller de silinir; yoksa silinen
 * satırın yerinde harf parçaları kalıyordu.
 */
function colorMatters(survey: Survey): boolean {
  const { grid, comps } = survey;
  return comps.some((c) => c.tone === 1 && ((c.y1 - c.y0 + 1) * grid.step > 6 || (c.x1 - c.x0 + 1) * grid.step > 12));
}

type Underline = { comp: number; u0: number; u1: number; v1: number; center: number; thickness: number };

/**
 * Satırın altındaki çizgi (altı çizili başlık). Yazıyla aynı renkte, yatay,
 * ince; satırın genişliğine yakın uzunlukta ve hemen altında. Tablo çizgisi
 * ve imza çizgisi yazıdan çok uzundur, sayılmaz. Kuyruklu harfler (g, p)
 * çizgiyi keser ve onunla tek parça olur; eskiden bu yüzden çizgi "işaret"
 * sayılıp korunuyor, harflerin kuyrukları çizginin üstünde kalıyordu.
 */
function underlineOf(survey: Survey, row: Row): Underline | null {
  const { grid, labels, comps, glyph } = survey;
  const width = row.u1 - row.u0;
  const band = row.v1 - row.v0;
  const members = new Set(row.members);
  for (let index = 0; index < comps.length; index++) {
    const c = comps[index];
    if (members.has(index) || glyph[index] || c.tone === 1) continue;
    const u0 = grid.p0 + c.x0 * grid.step;
    const u1 = grid.p0 + (c.x1 + 1) * grid.step;
    const overlap = Math.min(u1, row.u1) - Math.max(u0, row.u0);
    if (overlap < width * 0.6 || u1 - u0 > width * 1.35 + 8) continue;
    // Çizginin kendisi: parçanın genişliğinin yarısından fazlasını kaplayan piksel satırları.
    const across = Math.max(1, c.x1 - c.x0 + 1);
    const lines: number[] = [];
    for (let y = c.y0; y <= c.y1; y++) {
      let count = 0;
      for (let x = c.x0; x <= c.x1; x++) if (labels[y * grid.w + x] === index) count++;
      if (count >= across * 0.5) lines.push(y);
    }
    if (!lines.length) continue;
    const thickness = (Math.max(...lines) - Math.min(...lines) + 1) * grid.step;
    if (thickness > 3) continue;
    const center = grid.q0 + ((Math.min(...lines) + Math.max(...lines) + 1) / 2) * grid.step;
    if (center < row.v0 + band * 0.5 || center > row.v1 + 3) continue;
    return { comp: index, u0, u1, v1: grid.q0 + (c.y1 + 1) * grid.step, center, thickness };
  }
  return null;
}

/** Satırın taban çizgisi (punto): harflerin çoğunun oturduğu alt kenar. */
function baselineOf(survey: Survey, row: Row): number {
  const { grid, comps, glyph } = survey;
  const bottoms = row.members.filter((index) => glyph[index]).map((index) => comps[index].y1 + 1);
  return bottoms.length ? grid.q0 + median(bottoms) * grid.step : row.v1;
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
  underline: Underline | null = null,
): { rect: Rect | null; mask: Mask | null; caution: string | null } {
  const { grid, labels, comps, glyph } = survey;
  // Harfin çevresindeki soluk iz de silinecek alana girsin (~2 punto).
  const pad = 2.2;
  // Alt çizgi yazının parçası sayılır: satırla birlikte silinir.
  const span = underline
    ? { u0: Math.min(row.u0, underline.u0), v0: row.v0, u1: Math.max(row.u1, underline.u1), v1: Math.max(row.v1, underline.v1) }
    : row;
  const bounds = underline ? { ...limit, v1: Math.max(limit.v1, underline.v1 + 1) } : limit;
  const rect: Rect = {
    u0: Math.max(bounds.u0, span.u0 - pad),
    v0: Math.max(bounds.v0, span.v0 - pad),
    u1: Math.min(bounds.u1, span.u1 + pad),
    v1: Math.min(bounds.v1, span.v1 + pad),
  };
  const x0 = Math.max(0, Math.floor((rect.u0 - grid.p0) / grid.step));
  const y0 = Math.max(0, Math.floor((rect.v0 - grid.q0) / grid.step));
  const x1 = Math.min(grid.w - 1, Math.ceil((rect.u1 - grid.p0) / grid.step) - 1);
  const y1 = Math.min(grid.h - 1, Math.ceil((rect.v1 - grid.q0) / grid.step) - 1);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w <= 0 || h <= 0) return { rect: null, mask: null, caution: null };

  const members = new Set([...row.members, ...(underline ? [underline.comp] : []), ...strays(survey, row)]);
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
  const colorful = colorMatters(survey);
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
        if (!colorful || Math.max(r, g, b) - Math.min(r, g, b) < 40) erase = true;
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

function intersects(a: Rect, b: Rect): boolean {
  return a.u0 < b.u1 && a.u1 > b.u0 && a.v0 < b.v1 && a.v1 > b.v0;
}

/** `rect`'ten delikler çıkarıldıktan sonra kalan dikdörtgenler. */
export function subtractRects(rect: Rect, holes: Rect[]): Rect[] {
  let pieces = [rect];
  for (const hole of holes) {
    pieces = pieces.flatMap((piece) => {
      if (!intersects(piece, hole)) return [piece];
      const v0 = Math.max(piece.v0, hole.v0);
      const v1 = Math.min(piece.v1, hole.v1);
      const out: Rect[] = [];
      if (hole.v0 > piece.v0) out.push({ ...piece, v1: hole.v0 });
      if (hole.v1 < piece.v1) out.push({ ...piece, v0: hole.v1 });
      if (hole.u0 > piece.u0) out.push({ u0: piece.u0, v0, u1: hole.u0, v1 });
      if (hole.u1 < piece.u1) out.push({ u0: hole.u1, v0, u1: piece.u1, v1 });
      return out;
    });
  }
  return pieces.filter((piece) => piece.u1 - piece.u0 > 0.5 && piece.v1 - piece.v0 > 0.5);
}

type Measured = Omit<OverlayItem, "fontSize" | "bold"> & {
  estimate: number;
  column: string | null;
  /** Satır sayısı ve en yüksek satırın şeridi (çıkıntıdan kuyruğa): tek satırın puntosu buradan kalibre edilir. */
  rows: number;
  band: number;
  /** Taban çizgisinden büyük harf/çıkıntı çizgisine (punto); inen harflerden etkilenmez. */
  core: number | null;
  /** OCR'ın satır kutusunun yüksekliği; şeride imza karışırsa punto bunu aşamaz. */
  ocrLine: number | null;
  /** Tek satırlık öğede taramadaki mürekkebin genişliği ve kaynak metin: yazı tipi ailesi bundan okunur. */
  sample: { text: string; width: number } | null;
  /** Dik ve dar harflerin (l, I, 1) dip/orta genişlik oranları: serif ayak ölçüsü. */
  feet: number[];
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
  /** OCR'ın bir satıra verdiği yükseklik (punto), biliniyorsa. */
  ocrLine?: number;
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
  const paperLum = 0.299 * site.paper[0] + 0.587 * site.paper[1] + 0.114 * site.paper[2];

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
      // Tek tük koyu piksel kağıt lekesidir (telefon fotoğrafında her yerde);
      // yazı ya da çizgi şeridin belirgin bir kısmını kaplar.
      if (inked(strip.lum, paperLum)) {
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
  let underline: OverlayItem["underline"];
  for (const row of text) {
    const rule = underlineOf(site, row);
    if (rule && !underline) underline = { offset: rule.center - baselineOf(site, row), thickness: rule.thickness };
    const result = eraseRow(site, row, region, rule);
    if (result.rect) erase.push(result.rect);
    if (result.mask) masks.push(result.mask);
    caution ??= result.caution;
  }

  // Alttaki boş kağıt: uzun bir çeviri küçülmeden önce buraya taşabilir.
  // Bir sonraki yazıya ya da işarete yapışmasın diye 1,5 punto pay bırakılır.
  let room = 0;
  const reach = Math.max(...heights) * 3;
  while (room < reach) {
    const strip = sample(frame, { u0: area.u0, v0: area.v1 + room, u1: Math.min(area.u1, area.u0 + 400), v1: area.v1 + room + 1 });
    if (area.v1 + room + 1 > frame.page.height - 20 || inked(strip.lum, paperLum)) break;
    room += 1;
  }
  room = Math.max(0, room - 1.5);

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
    rows: text.length,
    band: Math.max(...heights),
    core: medianOrNull(text.map((row) => rowCore(site, row)).filter((value): value is number => value !== null)),
    ocrLine: options.ocrLine ?? null,
    underline,
    room,
    sample: text.length === 1 && lines.length === 1 ? { text: lines[0].text, width: inkRight - inkLeft } : null,
    feet: text.flatMap((row) => footRatios(site, row)),
  };
}

/** Ayak taşması bu oranın üstündeyse harf serif ayaklıdır (Times ≈ 0,13–0,16, Arial ≈ 0). */
const SERIF_FOOT_RATIO = 0.07;
/** Ayaklı harflerin bu payı aşarsa yazı serif sayılır (bkz. assignFamilies). */
const SERIF_VOTE_SHARE = 0.2;

/** Kalibrasyon yapılamadığında oranlar: şerit ≈ 0,8 em, büyük harf yüksekliği ≈ 0,72 em. */
const SINGLE_LINE_BAND_RATIO = 1 / 0.8;
const SINGLE_LINE_CORE_RATIO = 1 / 0.72;
/** Tek satır aralıklı yazıda satır aralığı ≈ 1,15 em (Word'ün "tek" aralığı). */
const LEADING_EM = 1.15;

/**
 * Bir sayfada yazı birkaç puntoda yazılır: gövde, başlık, dipnot. Tek tek
 * ölçümler gürültülüdür (imza değen satır, kuyruksuz kısa satır); aynı
 * paragraf stilindeki satırların farklı puntoda yazılması yazıyı dalgalı
 * gösterir (müşteri: "punto ve font orijinaldeki gibi olmalı"). Sayfanın
 * ağırlıklı punto kümeleri bulunur; bir kümeye %16'dan yakın ölçüm o kümenin
 * puntosuna çekilir. Gerçekten farklı puntolar (başlık, dipnot) kalır.
 */
export function snapSizes(items: Array<{ page: number; size: number; weight: number }>): number[] {
  const result = items.map((item) => item.size);
  for (const page of new Set(items.map((item) => item.page))) {
    const onPage = items
      .map((item, index) => ({ ...item, index }))
      .filter((item) => item.page === page)
      .sort((a, b) => a.size - b.size);
    const total = onPage.reduce((sum, item) => sum + item.weight, 0);
    const clusters: Array<typeof onPage> = [];
    for (const item of onPage) {
      const last = clusters[clusters.length - 1];
      if (last && item.size <= last[last.length - 1].size * 1.06) last.push(item);
      else clusters.push([item]);
    }
    const centers = clusters
      .filter((cluster) => cluster.reduce((sum, item) => sum + item.weight, 0) >= total * 0.25)
      .map((cluster) => {
        const half = cluster.reduce((sum, item) => sum + item.weight, 0) / 2;
        let seen = 0;
        for (const item of cluster) {
          seen += item.weight;
          if (seen >= half) return item.size;
        }
        return cluster[cluster.length - 1].size;
      });
    for (const item of onPage) {
      let nearest: number | null = null;
      for (const center of centers) {
        if (nearest === null || Math.abs(center - item.size) < Math.abs(nearest - item.size)) nearest = center;
      }
      if (nearest !== null && Math.abs(item.size / nearest - 1) <= 0.16) result[item.index] = nearest;
    }
  }
  return result;
}

function medianOrNull(values: number[]): number | null {
  return values.length ? median(values) : null;
}

/**
 * Satırın taban çizgisinden büyük harf/çıkıntı çizgisine yüksekliği (punto).
 * Harflerin çoğu taban çizgisine oturur (alt kenarların ortancası); büyük
 * harfler ve çıkıntılı küçük harfler aynı üst çizgiye uzanır (üst kenarların
 * alttan onda biri). Şerit yüksekliğinin aksine satırda g/p/y olup olmamasına
 * ya da satırın tamamen büyük harf olmasına bağlı değildir.
 */
function rowCore(site: Survey, row: Row): number | null {
  const { grid, comps, glyph } = site;
  const members = row.members.filter((index) => glyph[index]);
  if (members.length < 4) return null;
  const tops = members.map((index) => grid.q0 + comps[index].y0 * grid.step).sort((x, y) => x - y);
  const bottoms = members.map((index) => grid.q0 + (comps[index].y1 + 1) * grid.step).sort((x, y) => x - y);
  const core = bottoms[Math.floor(bottoms.length / 2)] - tops[Math.floor(tops.length * 0.1)];
  return core > 0 ? core : null;
}

/**
 * Tek satırlık yazıların puntosu (tablo hücreleri sütun ortancasıyla ayrıca
 * hesaplanır).
 *
 * 1. Yığın: aynı sol kenarda, düzenli aralıkla alt alta dizilmiş tek satırlar
 *    (adres, alt bilgi) aslında tek paragraftır; OCR onları ayrı blok verir.
 *    Punto aralarındaki gerçek satır aralığından ölçülür — en güvenilir sinyal.
 * 2. Tek başına satır: büyük harf yüksekliğinden, oranı aynı belgenin çok
 *    satırlı paragraflarından (punto orada satır aralığından bilinir) ölçülür.
 *    Yazı tipi farkı (Arial ile Times arasında %15) böyle kendiliğinden kapanır.
 * 3. Şeride yazıya değen bir imza karışmışsa ölçü dev çıkar; OCR'ın satır
 *    kutusu tavandır.
 */
function sizeSingleLines(measured: Measured[]): Array<{ size: number; leading: number | null }> {
  const calibrated = measured
    .filter((item) => item.rows >= 2 && item.core)
    .map((item) => item.estimate / (item.core as number));
  const coreRatio =
    calibrated.length >= 2 ? Math.min(1.7, Math.max(1.2, median(calibrated))) : SINGLE_LINE_CORE_RATIO;
  const bandCalibrated = measured.filter((item) => item.rows >= 2 && item.band > 0).map((item) => item.estimate / item.band);
  const bandRatio =
    bandCalibrated.length >= 2 ? Math.min(1.3, Math.max(0.95, median(bandCalibrated))) : SINGLE_LINE_BAND_RATIO;

  const result = measured.map((item) => {
    if (item.rows !== 1) return { size: item.estimate, leading: null as number | null };
    let size = item.core ? item.core * coreRatio : item.band * bandRatio;
    if (item.ocrLine) size = Math.min(size, item.ocrLine * 1.15);
    return { size, leading: null as number | null };
  });

  // Yığınlar: sayfa sayfa, üstten alta.
  const singles = measured
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.rows === 1 && !item.column && item.align === "left")
    .sort((x, y) => x.item.page - y.item.page || x.item.area.v0 - y.item.area.v0);
  const next = new Map<number, number>();
  for (const { item, index } of singles) {
    const height = item.core ?? item.band * 0.8;
    const below = singles.find(({ item: other }) => {
      if (other.page !== item.page || other.area.v0 <= item.area.v0) return false;
      if (Math.abs(other.area.u0 - item.area.u0) > 3) return false;
      const otherHeight = other.core ?? other.band * 0.8;
      if (Math.max(height, otherHeight) / Math.min(height, otherHeight) > 1.35) return false;
      const pitch = (other.area.v0 - item.area.v0) / Math.min(height, otherHeight);
      return pitch >= 1.25 && pitch <= 2.1;
    });
    if (below && !next.has(index)) next.set(index, below.index);
  }
  const hasPrevious = new Set(next.values());
  for (const { index } of singles) {
    if (hasPrevious.has(index) || !next.has(index)) continue;
    const chain = [index];
    while (next.has(chain[chain.length - 1])) chain.push(next.get(chain[chain.length - 1]) as number);
    const pitches = chain.slice(1).map((member, i) => measured[member].area.v0 - measured[chain[i]].area.v0);
    const leading = median(pitches);
    // Yığının tek puntosu: satırların büyük harf yüksekliğinden ölçülenlerin
    // ortancası. Satır aralığı her zaman 1,15 em değildir (adres blokları
    // çoğu zaman daha açık yazılır); yalnızca harf ölçüsü yoksa ondan çıkarılır.
    const measuredSizes = chain.filter((member) => measured[member].core).map((member) => result[member].size);
    // Yazı kendi satır aralığından büyük olamaz: imza değen satırda harf ölçüsü şişer.
    const size = Math.min(
      measuredSizes.length * 2 >= chain.length ? median(measuredSizes) : leading / LEADING_EM,
      leading / 1.05,
    );
    for (const member of chain) result[member] = { size, leading };
  }
  return result;
}

/**
 * Şeritte yazı ya da işaret var mı. Koyuluk kağıda göre ölçülür: telefonla
 * çekilmiş sayfada kağıdın kendisi gridir ve gölgede daha da koyudur; sabit
 * bir eşik boş kağıdı "dolu" sayıp çevirinin sağa uzamasını ilk adımda
 * durduruyordu. Tek tük koyu piksel (kağıt lekesi) sayılmaz. Şeridin tamamı
 * kağıttan belirgin koyuysa (fotoğraf, koyu alan) şerit doludur.
 */
function inked(lum: Float32Array, paper: number): boolean {
  const sorted = Array.from(lum).sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)] ?? 255;
  if (middle < paper - 50) return true;
  const threshold = Math.min(middle, paper) - 45;
  let dark = 0;
  for (const value of lum) if (value < threshold) dark++;
  return dark >= Math.max(3, lum.length * 0.04);
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
/** İmza/mühür bölgesi OCR kutusundan bu kadar geniş silinir: kutular mürekkebi sıkı sarar. */
const MARK_MARGIN = 2;
/** Sayfada punto ölçülecek başka satır yoksa etiketin puntosu. */
const MARK_FONT_SIZE = 10;
const MARK_KEPT =
  "İmza/mühür bölgesi yerine yazılamayan bir satıra değiyor; o kısım silinmedi. Çıktıyı kontrol edin.";
const SIGNATURE_READ = "İmzanın kendisi yazı gibi okunmuş; çıktıda imza yerine etiket yazılır.";
/** Gevşek imza/mühür araması için sayfanın örneklendiği ızgara adımı (punto). */
const INK_STEP = 0.6;
/** Bir satırın mürekkebinin bu kadarı imza mürekkebiyse OCR imzayı yazı sanıp okumuştur. */
const SIGNATURE_SHARE = 0.6;
/** Siyah imzada: satırın mürekkebinin bu kadarı imza bölgesinin içindeyse satır imzanın kendisidir. */
const SIGNATURE_INSIDE = 0.75;
/** Siyah imzada: satırın mürekkebinin en az bu kadarı harften büyük imza çizgisi olmalı. */
const SIGNATURE_STROKES = 0.35;

export type PlanOptions = {
  /**
   * Görsel sınıflandırıcı. Verilirse OCR'ın ayrı bölge olarak vermediği imza
   * ve mühürler taramanın kendisinden aranır (bkz. ink-marks.ts); her aday
   * kırpılıp buna sorulur. Verilmezse yalnızca OCR'ın ayırdığı bölgeler işlenir.
   */
  classify?: (dataUrl: string) => Promise<ImageKind>;
};

function packBits(bits: Uint8Array): string {
  const out = Buffer.alloc(Math.ceil(bits.length / 8));
  bits.forEach((bit, index) => {
    if (bit) out[index >> 3] |= 1 << (index & 7);
  });
  return out.toString("base64");
}

/** Taramanın bir bölgesi, sınıflandırıcıya gönderilecek JPEG olarak. */
async function cropDataUrl(frame: Frame, rect: Rect): Promise<string> {
  const step = 0.35;
  const w = Math.max(1, Math.round((rect.u1 - rect.u0) / step));
  const h = Math.max(1, Math.round((rect.v1 - rect.v0) / step));
  const raw = Buffer.alloc(w * h * 3, 255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const { u, v } = frame.toDisplay(rect.u0 + (x + 0.5) * step, rect.v0 + (y + 0.5) * step);
      const color = frame.page.rgb(u, v);
      if (color) raw.set(color, (y * w + x) * 3);
    }
  }
  const { default: sharp } = await import("sharp");
  const jpeg = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

/** Sayfanın tamamı, düzeltilmiş koordinatta kaba bir ızgarada. */
function pageRaster(frame: Frame): { w: number; h: number; rgb: Uint8Array } {
  const w = Math.max(1, Math.ceil(frame.page.width / INK_STEP));
  const h = Math.max(1, Math.ceil(frame.page.height / INK_STEP));
  const rgb = new Uint8Array(w * h * 3).fill(255);
  // Hücre başına 3×3 nokta, en koyusu: 300 DPI'daki bir piksellik imza
  // çizgisi tek noktayla örneklense kaybolur, imza parçalara bölünürdü.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best: Color | null = null;
      let bestLum = Infinity;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const { u, v } = frame.toDisplay((x + (sx + 0.5) / 3) * INK_STEP, (y + (sy + 0.5) / 3) * INK_STEP);
          const color = frame.page.rgb(u, v);
          if (!color) continue;
          const lum = 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2];
          if (lum < bestLum) {
            bestLum = lum;
            best = color;
          }
        }
      }
      if (best) rgb.set(best, (y * w + x) * 3);
    }
  }
  return { w, h, rgb };
}

function regionRect(region: InkRegion): Rect {
  return { u0: region.x0 * INK_STEP, v0: region.y0 * INK_STEP, u1: (region.x1 + 1) * INK_STEP, v1: (region.y1 + 1) * INK_STEP };
}

function rasterRect(rect: Rect) {
  return { x0: rect.u0 / INK_STEP, y0: rect.v0 / INK_STEP, x1: rect.u1 / INK_STEP - 1, y1: rect.v1 / INK_STEP - 1 };
}

/** Öğenin yazısının taramadaki yeri: silinecek şeritlerin birleşimi. */
function textRect(item: { erase: Rect[]; masks: Mask[]; area: Rect }): Rect {
  const rects = [...item.erase, ...item.masks.map((mask) => mask.rect)];
  if (!rects.length) return item.area;
  return {
    u0: Math.min(...rects.map((r) => r.u0)),
    v0: Math.min(...rects.map((r) => r.v0)),
    u1: Math.max(...rects.map((r) => r.u1)),
    v1: Math.max(...rects.map((r) => r.v1)),
  };
}

function rowsRect(rows: Row[]): Rect {
  return {
    u0: Math.min(...rows.map((row) => row.u0)) - 1,
    v0: Math.min(...rows.map((row) => row.v0)) - 1,
    u1: Math.max(...rows.map((row) => row.u1)) + 1,
    v1: Math.max(...rows.map((row) => row.v1)) + 1,
  };
}

/** İşaret maskesinin bir dikdörtgenle kesişen yerinde silinecek piksel var mı? */
function maskTouches(mask: { rect: Rect; w: number; h: number; data: Uint8Array }, rect: Rect): boolean {
  if (!intersects(mask.rect, rect)) return false;
  const du = (mask.rect.u1 - mask.rect.u0) / mask.w;
  const dv = (mask.rect.v1 - mask.rect.v0) / mask.h;
  // Yalnızca merkezi dikdörtgenin içinde kalan pikseller sayılır.
  const x0 = Math.max(0, Math.ceil((rect.u0 - mask.rect.u0) / du - 0.5));
  const x1 = Math.min(mask.w - 1, Math.floor((rect.u1 - mask.rect.u0) / du - 0.5));
  const y0 = Math.max(0, Math.ceil((rect.v0 - mask.rect.v0) / dv - 0.5));
  const y1 = Math.min(mask.h - 1, Math.floor((rect.v1 - mask.rect.v0) / dv - 0.5));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (mask.data[y * mask.w + x]) return true;
  return false;
}

function isMarkBlock(block: LayoutBlock): boolean {
  return block.kind === "image" && isMark(block.image);
}

type PendingMark = {
  page: number;
  kind: MarkKind;
  region: Rect;
  lineIds: string[];
  background: Color;
  ink: Color;
  erase: Rect[];
  masks: Mask[];
  /** Taramadan bulunan işaretin pikselleri: yalnızca bunlara değen satırlar yeniden yazılır. */
  pixels: { rect: Rect; w: number; h: number; data: Uint8Array } | null;
  /** Renkli (mavi) imza: maske siyah pikselleri hiç almaz, basılı yazı yeniden yazılmaz. */
  colored: boolean;
  caution: string | null;
};

export async function planOverlay(
  pdfBytes: Uint8Array,
  blocks: LayoutBlock[],
  options: PlanOptions = {},
): Promise<OverlayPlan> {
  const measured: Measured[] = [];
  const marks: PendingMark[] = [];
  /** El yazısı gibi görünüp yerine yazılmayan satırlar: imza olabilirler. */
  const handwritten: Array<{ page: number; rect: Rect; lineIds: string[] }> = [];
  const unplaced: OverlayPlan["unplaced"] = [];
  const skip = (lines: OcrLine[], reason: string) =>
    unplaced.push(...lines.map((line) => ({ id: line.id, reason })));

  // Sayfalar tek tek okunur ve bırakılır: 300 DPI'da bir A4 sayfası ~25 MB,
  // hepsini birden tutmak uzun belgede sunucunun belleğini doldururdu.
  const scan = await openScan(pdfBytes);
  const skews = Array.from({ length: scan.pageCount }, () => 0);
  const pageErrors: string[] = [];
  let pagesRead = 0;
  try {
    for (let index = 0; index < scan.pageCount; index++) {
      const onPage = blocks
        .map((block, blockIndex) => ({ block, blockIndex }))
        .filter(({ block }) => block.page === index + 1 && (blockLines(block).length > 0 || isMarkBlock(block)));
      if (!onPage.length) continue;

      let page: ScanPage;
      try {
        page = await scan.page(index);
      } catch (cause) {
        // Okunamayan sayfa yalnızca kendi satırlarını düşürür; belgenin geri
        // kalanı yine çevrilir.
        const reason = `${index + 1}. sayfa okunamadı: ${cause instanceof Error ? cause.message : String(cause)}`;
        pageErrors.push(reason);
        for (const { block } of onPage) skip(blockLines(block), reason);
        continue;
      }
      pagesRead++;
      const skew = estimateSkew(page);
      skews[index] = skew;
      const frame: Frame = { page, skew, textColor: pageInk(page), ...frameFor(page, skew) };
      for (const { block, blockIndex } of onPage) placeBlock(block, blockIndex, frame);
      if (options.classify) await findLooseMarks(frame, index + 1, options.classify);
      settleMarks(index + 1, frame);
    }
  } finally {
    await scan.close();
  }
  for (const block of blocks) {
    if (block.page < 1 || block.page > scan.pageCount) skip(blockLines(block), "Satırın sayfadaki konumu bilinmiyor.");
  }
  // Hiçbir sayfa okunamadıysa bu satır satır bir sorun değil, belgenin sorunu.
  if (pageErrors.length && pagesRead === 0) throw new Error(pageErrors[0]);

  function placeBlock(block: LayoutBlock, blockIndex: number, frame: Frame) {
    const allLines = blockLines(block);
    if (!block.frame) {
      skip(allLines, "Satırın sayfadaki konumu bilinmiyor.");
      return;
    }
    const box = toFrame(block.frame.box, block.frame, frame);

    if (block.kind === "image") {
      if (!isMark(block.image)) {
        skip(allLines, "Görselin içindeki yazı yerinde çevrilmedi; görsel olduğu gibi kaldı.");
        return;
      }
      // İmza/mühür kopyalanmaz: bölgenin tamamı silinir, yerine etiket yazılır.
      // İçinden okunan satırlar ayrıca yerleştirilmez; etiketle birlikte yazılır.
      const page = frame.page;
      const grown = grow(box, MARK_MARGIN, MARK_MARGIN);
      const region = {
        u0: Math.max(0, grown.u0),
        v0: Math.max(0, grown.v0),
        u1: Math.min(page.width, grown.u1),
        v1: Math.min(page.height, grown.v1),
      };
      const site = survey(frame, grow(region, CONTEXT_MARGIN, CONTEXT_MARGIN), region);
      marks.push({
        page: block.page,
        kind: block.image,
        region,
        lineIds: allLines.map((line) => line.id),
        background: site.paper,
        ink: frame.textColor,
        erase: [region],
        masks: [],
        pixels: null,
        colored: false,
        caution: null,
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
          const site = survey(frame, region, region);
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
    // Birden çok satırda hizalama satırların kenarlarından okunur; blok
    // geometrisi yalnızca tek satırda tahmin için kullanılır. Asılı girintili
    // bir liste maddesi ("1) Notification … / the USA") geometriden ortalı
    // görünüyordu.
    const alignFor = (rows: Row[]): Placement["align"] => (rows.length >= 2 && align === "center" ? "auto" : align);
    const region = grow(box, 1.5, 1);
    const site = survey(frame, grow(box, CONTEXT_MARGIN, CONTEXT_MARGIN), box);
    const natural = site.rows.filter((row) => !isSpeck(row));
    const ocrLine = (box.v1 - box.v0) / block.lines.length;

    // Blok birden çok OCR satırıysa her satır kendi tarama satırlarına
    // eşlenip ayrı yazılır: yalnızca çevirisi değişen satıra dokunulur. İmza
    // bloğunda isim, unvan ve şirket tek blok gelir; unvan çevrilince üçü
    // birden silinip üstlerinden geçen imzayla birlikte yeniden yazılıyordu.
    const groups = block.lines.length > 1 ? alignRowsToLines(site, natural, block.lines) : null;
    if (groups) {
      block.lines.forEach((line, index) => {
        const rows = groups[index];
        if (looksHandwritten(site, rows, [line])) {
          skip([line], HANDWRITTEN);
          handwritten.push({ page: block.page, rect: rowsRect(rows), lineIds: [line.id] });
          return;
        }
        const lineRegion = {
          u0: region.u0,
          v0: Math.min(...rows.map((row) => row.v0)) - 1,
          u1: region.u1,
          v1: Math.max(...rows.map((row) => row.v1)) + 1,
        };
        measured.push(
          itemFrom(frame, block.page, site, rows, lineRegion, [line], { align: alignFor(rows), column: null, extend: true, ocrLine }),
        );
      });
      return;
    }

    const text = fitToLines(site, natural, block.lines.length);
    if (!text.length) {
      skip(block.lines, "Taramada bu satırın yazısı bulunamadı.");
      return;
    }
    if (looksHandwritten(site, text, block.lines)) {
      skip(block.lines, HANDWRITTEN);
      handwritten.push({ page: block.page, rect: rowsRect(text), lineIds: block.lines.map((line) => line.id) });
      return;
    }
    measured.push(
      itemFrom(frame, block.page, site, text, region, block.lines, { align: alignFor(text), column: null, extend: true, ocrLine }),
    );
  }

  // OCR'ın ayrı bölge olarak vermediği imza ve mühürler: taramada harf boyunu
  // aşan ya da renkli mürekkep kümeleri ve el yazısı gibi görünen satırlar.
  // Her aday kırpılıp sınıflandırıcıya sorulur; yalnızca imza/mühür denirse
  // işaret olur. Silme maskeyle yapılır: imzanın çevresindeki basılı yazı kalır.
  async function findLooseMarks(frame: Frame, pageNo: number, classify: NonNullable<PlanOptions["classify"]>) {
    const raster = pageRaster(frame);
    const map: InkMap = findInkRegions(raster, 1 / INK_STEP);
    const confidence = new Map(
      blocks
        .filter((block) => block.page === pageNo)
        .flatMap((block) => blockLines(block).map((line) => [line.id, line.confidence] as const)),
    );
    const absorb = (ids: string[]) => {
      for (const entry of unplaced) if (ids.includes(entry.id)) entry.reason = SIGNATURE_READ;
    };

    for (const region of map.regions) {
      const rect = regionRect(region);
      if (marks.some((mark) => mark.page === pageNo && intersects(mark.region, rect))) continue;
      const kind = await classify(await cropDataUrl(frame, grow(rect, 4, 4)));
      if (!isMark(kind)) continue;

      // OCR imzayı yazı sanıp okuduysa ("Jill Hollman") o satır çeviriye
      // girmez: mürekkebinin çoğu imzanın mürekkebidir. İmzanın üstünden
      // geçtiği basılı isimde bu oran düşüktür; o satır yerinde kalır.
      const owner = { colored: region.colored, box: { x0: region.x0, y0: region.y0, x1: region.x1, y1: region.y1 } };
      for (let i = measured.length - 1; i >= 0; i--) {
        const item = measured[i];
        if (item.page !== pageNo) continue;
        const text = textRect(item);
        if (!intersects(text, rect)) continue;
        const share = signatureShare(raster, map, rasterRect(text), owner);
        // Siyah imzada kutunun içinde olmak yetmez ("Sincerely," da içinde
        // kalabilir): satırın mürekkebinin bir kısmı imza çizgisi olmalı ve
        // OCR ondan emin olmamalı. İmzadan okunan "Jill Hollman" %54, üstünden
        // imza geçen basılı "Sincerely," %99 güvenle okunmuştu.
        const strokes = inkShare(map, rasterRect(text));
        const unsure = item.lineIds.some((id) => (confidence.get(id) ?? 1) < LOW_CONFIDENCE);
        const isSignature = region.colored
          ? share >= SIGNATURE_SHARE
          : share >= SIGNATURE_INSIDE && strokes >= SIGNATURE_STROKES && (unsure || strokes >= 0.7);
        if (!isSignature) continue;
        measured.splice(i, 1);
        for (const id of item.lineIds) {
          const entry = unplaced.find((candidate) => candidate.id === id);
          if (entry) entry.reason = SIGNATURE_READ;
          else unplaced.push({ id, reason: SIGNATURE_READ });
        }
      }
      for (const hand of handwritten) if (hand.page === pageNo && intersects(hand.rect, rect)) absorb(hand.lineIds);
      // Taramada harf olarak bulunamayan satır da ("yazısı bulunamadı"): kutusu
      // çoğunlukla imzanın içindeyse okunan şey imzanın kendisidir.
      for (const block of blocks) {
        if (block.page !== pageNo || block.kind !== "paragraph" || !block.frame) continue;
        const box = toFrame(block.frame.box, block.frame, frame);
        const overlap =
          Math.max(0, Math.min(box.u1, rect.u1) - Math.max(box.u0, rect.u0)) *
          Math.max(0, Math.min(box.v1, rect.v1) - Math.max(box.v0, rect.v0));
        if (overlap >= (box.u1 - box.u0) * (box.v1 - box.v0) * SIGNATURE_SHARE) absorb(block.lines.map((line) => line.id));
      }

      // Bölgedeki bütün imza mürekkebi silinir; yerinde kalan basılı satırlar korunur.
      const protect = measured
        .filter((item) => item.page === pageNo)
        .map((item) => rasterRect(grow(textRect(item), INK_STEP * 1.5, INK_STEP * 1.5)));
      const margin = 4;
      const { box, bits } = markMask(
        raster,
        map,
        { x0: region.x0 - margin, y0: region.y0 - margin, x1: region.x1 + margin, y1: region.y1 + margin },
        { colored: region.colored, protect: region.colored ? [] : protect, shortRule: Math.round(60 / INK_STEP) },
      );
      const maskRect = { u0: box.x0 * INK_STEP, v0: box.y0 * INK_STEP, u1: (box.x1 + 1) * INK_STEP, v1: (box.y1 + 1) * INK_STEP };
      const w = box.x1 - box.x0 + 1;
      const h = box.y1 - box.y0 + 1;
      marks.push({
        page: pageNo,
        kind,
        region: rect,
        lineIds: [],
        background: region.paper,
        ink: frame.textColor,
        erase: [],
        masks: [{ rect: maskRect, w, h, bits: packBits(bits), paper: region.paper }],
        pixels: { rect: maskRect, w, h, data: bits },
        colored: region.colored,
        caution: null,
      });
    }

    // El yazısı stilindeki imza ("Jennifer Drobish") harf boyundadır; mürekkep
    // kümesi olarak bulunmaz. OCR onu okuyup satır yaptıysa satırın yeri sorulur.
    for (const hand of handwritten) {
      if (hand.page !== pageNo) continue;
      if (marks.some((mark) => mark.page === pageNo && intersects(mark.region, hand.rect))) continue;
      const kind = await classify(await cropDataUrl(frame, grow(hand.rect, 3, 3)));
      if (!isMark(kind)) continue;
      absorb(hand.lineIds);
      marks.push({
        page: pageNo,
        kind,
        region: hand.rect,
        lineIds: [],
        background: survey(frame, grow(hand.rect, CONTEXT_MARGIN, CONTEXT_MARGIN), hand.rect).paper,
        ink: frame.textColor,
        erase: [hand.rect],
        masks: [],
        pixels: null,
        colored: false,
        caution: null,
      });
    }
  }

  // Yerine yazılamayan bir satır işaret bölgesinin altında kalıyorsa o kısım
  // silinmez: yeniden yazılamayacak bir satır silinip kaybolmamalı. İmzanın
  // kendisi olan satır (yazı gibi okunmuş imza) bundan sayılmaz.
  function settleMarks(pageNo: number, frame: Frame) {
    const lost = new Set(unplaced.filter((entry) => entry.reason !== SIGNATURE_READ).map((entry) => entry.id));
    const holes = blocks
      .filter(
        (block) =>
          block.page === pageNo &&
          block.frame &&
          !isMarkBlock(block) &&
          blockLines(block).some((line) => lost.has(line.id)),
      )
      .map((block) => toFrame(block.frame!.box, block.frame!, frame));
    for (const mark of marks) {
      if (mark.page !== pageNo || !mark.erase.length) continue;
      const touching = holes.filter((hole) => intersects(hole, mark.region));
      if (!touching.length) continue;
      mark.erase = mark.erase.flatMap((rect) => subtractRects(rect, touching));
      mark.caution = MARK_KEPT;
    }
  }

  // Aynı tablo sütunundaki hücreler aynı puntoyla yazılmıştır; tek satırlık,
  // kuyruksuz bir hücre ("HDPE") tek başına punto tahminini düşürmesin.
  const byColumn = new Map<string, number[]>();
  for (const item of measured) {
    if (item.column) byColumn.set(item.column, [...(byColumn.get(item.column) ?? []), item.estimate]);
  }

  const sizes = sizeSingleLines(measured);
  const raw = measured.map((item, index) =>
    item.column ? median(byColumn.get(item.column) ?? [item.estimate]) : sizes[index].size,
  );
  const inkWidth = (item: Measured) =>
    [...item.erase, ...item.masks.map((mask) => mask.rect)].reduce((sum, rect) => sum + (rect.u1 - rect.u0), 0);
  const snapped = snapSizes(measured.map((item, index) => ({ page: item.page, size: raw[index], weight: inkWidth(item) || 1 })));
  const sized = measured.map((item, index) => {
    const size = snapped[index];
    return {
      page: item.page,
      lineIds: item.lineIds,
      area: item.area,
      erase: item.erase,
      masks: item.masks,
      caution: item.caution,
      align: item.align,
      leading: sizes[index].leading ?? item.leading,
      background: item.background,
      ink: item.ink,
      weight: item.weight,
      underline: item.underline,
      room: item.room,
      fontSize: Math.round(size * 4) / 4,
    };
  });
  const bold = assignBold(sized);
  // Yazı tipi ailesi harf şeklinden (serif ayakları), satır satır: resmi
  // belgelerde antet ve alt bilgi çoğu zaman Arial, gövde Times'tır (DELAN SC).
  // Harf yoksa belge boyunca yazı genişliğinden.
  const fallback = (
    await classifyFamily(
      measured.flatMap((item, index) =>
        item.sample ? [{ ...item.sample, size: sized[index].fontSize, bold: bold[index] }] : [],
      ),
    )
  ).family;
  const families = assignFamilies(
    measured.map((item, index) => ({ page: item.page, area: item.area, fontSize: sized[index].fontSize, feet: item.feet })),
    fallback,
  );
  const items: OverlayItem[] = sized.map((item, index) => ({ ...item, bold: bold[index], family: families[index] }));

  // Taramadan bulunan imza çoğu zaman basılı ismin üstündedir: etiket imzanın
  // yazı olmayan kısmına (isim satırının üstüne ya da altına) yazılır.
  const labelArea = (mark: PendingMark, fontSize: number): Rect => {
    const texts = items
      .filter((item) => item.page === mark.page)
      .map(textRect)
      .filter((rect) => intersects(rect, mark.region));
    if (!texts.length) return mark.region;
    const top = Math.min(...texts.map((rect) => rect.v0));
    if (top - mark.region.v0 >= fontSize * 0.9) return { ...mark.region, v1: top };
    const bottom = Math.max(...texts.map((rect) => rect.v1));
    if (mark.region.v1 - bottom >= fontSize * 0.9) return { ...mark.region, v0: bottom };
    return mark.region;
  };

  // Etiket, sayfanın gövde yazısının puntosuyla, yazı rengiyle ve yazı tipi ailesiyle yazılır.
  const markItems: OverlayItem[] = marks.map((mark) => {
    const onPage = items.filter((item) => item.page === mark.page);
    const peers = onPage.map((item) => item.fontSize);
    const fontSize = peers.length ? Math.round(median(peers) * 4) / 4 : MARK_FONT_SIZE;
    const serif = onPage.filter((item) => item.family === "serif").length;
    const family: Family = onPage.length ? (serif * 2 >= onPage.length ? "serif" : "sans") : fallback;
    return {
      page: mark.page,
      lineIds: mark.lineIds,
      area: mark.pixels ? labelArea(mark, fontSize) : mark.region,
      erase: mark.erase,
      masks: mark.masks,
      caution: mark.caution,
      align: "center",
      fontSize,
      leading: fontSize * 1.25,
      bold: false,
      weight: 0,
      family,
      background: mark.background,
      ink: mark.ink,
      mark: mark.kind,
    };
  });
  const underMark = (item: OverlayItem) =>
    marks.some((mark) => {
      if (mark.page !== item.page || mark.colored) return false;
      const rects = [...item.erase, ...item.masks.map((mask) => mask.rect)];
      const pixels = mark.pixels;
      return pixels ? rects.some((rect) => maskTouches(pixels, rect)) : rects.some((rect) => intersects(rect, mark.region));
    });

  return {
    version: PLAN_VERSION,
    pages: skews.map((skew) => ({ skew })),
    // İşaretler önce çizilir; sildikleri alana değen satırlar sonra yeniden yazılır.
    items: [...markItems, ...items.map((item) => (underMark(item) ? { ...item, redraw: true } : item))],
    unplaced,
  };
}

function blockLines(block: LayoutBlock): OcrLine[] {
  return block.kind === "table" ? block.rows.flatMap((row) => row.flatMap((cell) => cell.lines)) : block.lines;
}

// ---------- çizim ----------


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
  const { default: sharp } = await import("sharp");
  return new Uint8Array(await sharp(raw, { raw: { width: mask.w, height: mask.h, channels: 4 } }).png().toBuffer());
}

/**
 * Silinecek bölgenin yerine konacak görsel: kağıt, sayfanın o bölgenin
 * çevresindeki gerçek pikselleri kullanılarak yeniden kurulur (bkz.
 * inpaint.ts). `bits` verilirse yalnızca işaretli pikseller opaktır.
 */
async function paperPatch(
  scan: ScanPage,
  skew: number,
  rect: Rect,
  width: number,
  height: number,
  fallback: Color,
  bits: Buffer | null,
  seed: number,
): Promise<Uint8Array> {
  const straight = frameFor(scan, skew);
  const du = (rect.u1 - rect.u0) / width;
  const dv = (rect.v1 - rect.v0) / height;
  const rgbPatch = reconstructPaper(
    (x, y) => {
      const { u, v } = straight.toDisplay(rect.u0 + (x + 0.5) * du, rect.v0 + (y + 0.5) * dv);
      return scan.rgb(u, v);
    },
    width,
    height,
    { margin: 2 / Math.max(du, dv), window: 3, seed, fallback },
  );
  const raw = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    raw[i * 4] = rgbPatch[i * 3];
    raw[i * 4 + 1] = rgbPatch[i * 3 + 1];
    raw[i * 4 + 2] = rgbPatch[i * 3 + 2];
    raw[i * 4 + 3] = bits ? ((bits[i >> 3] >> (i & 7)) & 1 ? 255 : 0) : 255;
  }
  const { default: sharp } = await import("sharp");
  return new Uint8Array(await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer());
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
  options: {
    /**
     * Kağıdın örneklendiği belge. Varsayılan `pdfBytes`'in kendisi; görsel
     * belgede çeviri katmanı boş bir sayfaya çizildiği için görselin PDF'i verilir.
     */
    source?: Uint8Array;
    /** Çevirinin dili: imza/mühür etiketi bu dilde yazılır. */
    targetLang?: string;
  } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const fontFor = fontsFor(doc);
  const pdfPages = doc.getPages();

  // Silinen yerin kağıdı sayfanın kendi piksellerinden kurulur; sayfalar
  // gerektiğinde, birer birer okunur. Okunamazsa düz kağıt rengine düşülür.
  let scan: Awaited<ReturnType<typeof openScan>> | null = null;
  let scanFailed = false;
  let current: { index: number; page: ScanPage | null } | null = null;
  const scanPage = async (index: number): Promise<ScanPage | null> => {
    if (current?.index === index) return current.page;
    if (!scan && !scanFailed) {
      try {
        scan = await openScan(options.source ?? pdfBytes);
      } catch {
        scanFailed = true;
      }
    }
    let page: ScanPage | null = null;
    try {
      page = scan ? await scan.page(index) : null;
    } catch {
      page = null;
    }
    current = { index, page };
    return page;
  };

  // Önce bütün yamalar, sonra bütün yazılar: sonraki satırın yaması, alttaki
  // boş kağıda taşan bir önceki satırın harflerini kesmesin (BASF 6. sayfa:
  // harflerin alt yarısı yamanın altında kalıyor, yazı dalgalı görünüyordu).
  const writers: Array<() => Promise<void>> = [];
  // İşaretler önce: bölgeyi silerler, üstüne değen satırlar ardından yazılır.
  const ordered = [...plan.items].sort((a, b) => Number(Boolean(b.mark)) - Number(Boolean(a.mark)));
  for (const item of ordered) {
    const page = pdfPages[item.page - 1];
    if (!page) continue;
    const lines = item.lineIds.map((id) => texts.get(id));
    const changed = lines.some(
      (line) => line?.translation && tidyTarget(line.source, line.translation).trim() !== line.source.trim(),
    );
    if (!item.mark && !changed && !item.redraw) continue;

    // Planlamayla aynı geometri: görünür alan (CropBox ∩ MediaBox) ve /Rotate.
    const geometry = pageGeometry(page);
    const toPage = geometry.toPage;
    const straight = frameFor(geometry, plan.pages[item.page - 1]?.skew ?? 0);
    const place = (p: number, q: number) => {
      const { u, v } = straight.toDisplay(p, q);
      return toPage(u, v);
    };
    // Yazı yönü: düzeltilmiş koordinatta +p, sayfada hangi açıya denk geliyorsa.
    const origin = place(0, 0);
    const ahead = place(1, 0);
    const rotate = degrees((Math.atan2(ahead.y - origin.y, ahead.x - origin.x) * 180) / Math.PI);

    const source = item.erase.length || item.masks.length ? await scanPage(item.page - 1) : null;
    const skew = plan.pages[item.page - 1]?.skew ?? 0;
    const seedOf = (rect: Rect) => Math.round(rect.u0 * 131 + rect.v0 * 7919 + item.page * 104729);

    for (const rect of item.erase) {
      const corner = place(rect.u0, rect.v1);
      const size = { width: rect.u1 - rect.u0, height: rect.v1 - rect.v0 };
      if (source) {
        const scale = Math.min(source.pixelsPerPoint, 300 / 72);
        const w = Math.max(1, Math.round(size.width * scale));
        const h = Math.max(1, Math.round(size.height * scale));
        const png = await paperPatch(source, skew, rect, w, h, item.background, null, seedOf(rect));
        page.drawImage(await doc.embedPng(png), { x: corner.x, y: corner.y, ...size, rotate });
      } else {
        page.drawRectangle({ x: corner.x, y: corner.y, ...size, rotate, color: toColor(item.background), borderWidth: 0 });
      }
    }
    for (const mask of item.masks) {
      const corner = place(mask.rect.u0, mask.rect.v1);
      const png = source
        ? await paperPatch(
            source,
            skew,
            mask.rect,
            mask.w,
            mask.h,
            mask.paper ?? item.background,
            Buffer.from(mask.bits, "base64"),
            seedOf(mask.rect),
          )
        : await maskImage(mask, mask.paper ?? item.background);
      page.drawImage(await doc.embedPng(png), {
        x: corner.x,
        y: corner.y,
        width: mask.rect.u1 - mask.rect.u0,
        height: mask.rect.v1 - mask.rect.v0,
        rotate,
      });
    }

    writers.push(async () => {
    const font = await fontFor(item.family ?? "serif", item.bold);
    const width = item.area.u1 - item.area.u0;
    const height = item.area.v1 - item.area.v0;
    const texted = lines.map((line) =>
      line?.translation?.trim() ? tidyTarget(line.source, line.translation.trim()) : line?.source || "",
    );
    const content = item.mark ? markText(item.mark, options.targetLang ?? "en", texted) : texted;

    // Punto orijinaldeki gibi kalır (müşteri): uzun çeviri önce aynı puntoyla
    // alttaki boş kağıda taşar. Küçültme yalnızca son çaredir; önce en çok %10.
    const fitWithin = (limit: number, floor: number) => {
      for (let trial = item.fontSize; trial >= floor - 1e-6; trial -= 0.25) {
        const trialLeading = item.leading * (trial / item.fontSize);
        const lines = content.flatMap((text) => wrap(text, font, trial, width));
        const fits =
          lines.every((line) => font.widthOfTextAtSize(line, trial) <= width + 0.5) &&
          (lines.length - 1) * trialLeading + trial * 0.9 <= limit + 1;
        if (fits) return { size: trial, leading: trialLeading, wrapped: lines };
      }
      return null;
    };
    const room = item.room ?? 0;
    const fitted =
      fitWithin(height, item.fontSize) ??
      fitWithin(height + room, item.fontSize) ??
      fitWithin(height + room, item.fontSize * 0.9) ??
      fitWithin(height + room, 4.5) ?? {
        size: 4.5,
        leading: item.leading * (4.5 / item.fontSize),
        wrapped: content.flatMap((text) => wrap(text, font, 4.5, width)),
      };
    const { size, leading, wrapped } = fitted;
    // Etiket bölgenin ortasına oturur; çeviri satırı orijinal şeridin üstüne.
    const block = (wrapped.length - 1) * leading + size * 0.9;
    const top = item.mark ? item.area.v0 + Math.max(0, (height - block) / 2) : item.area.v0;

    wrapped.forEach((line, index) => {
      const lineWidth = font.widthOfTextAtSize(line, size);
      const p =
        item.align === "center"
          ? item.area.u0 + (width - lineWidth) / 2
          : item.align === "right"
            ? item.area.u1 - lineWidth
            : item.area.u0;
      // Yazının üst kenarı orijinal şeridin üstüne oturur; Times'ta çıkıntı ≈ 0,72 em.
      const baseline = top + size * 0.72 + index * leading;
      const at = place(p, baseline);
      page.drawText(line, { x: at.x, y: at.y, size, font, color: toColor(item.ink), rotate });
      if (item.underline && line.trim()) {
        const y = baseline + item.underline.offset * (size / item.fontSize);
        page.drawLine({
          start: place(p, y),
          end: place(p + lineWidth, y),
          thickness: Math.max(0.3, item.underline.thickness),
          color: toColor(item.ink),
        });
      }
    });
    });
  }
  for (const write of writers) await write();

  await (scan as Awaited<ReturnType<typeof openScan>> | null)?.close();
  return doc.save();
}


