import path from "node:path";
import { inflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  type PDFPage,
} from "pdf-lib";
import { packageDir } from "./app-files";

/**
 * Bir PDF sayfasının piksel görüntüsü ve koordinat dönüşümleri.
 *
 * Kural: yüklenen belge görsel olarak değişmez. Çeviriyi orijinal sayfanın
 * üstüne, kaynak yazının tam yerine yazarız. Bunun için üç koordinat sistemi
 * arasında kesin dönüşüm gerekir:
 *
 *  - Görüntü düzlemi ("display"): sayfanın ekranda göründüğü hâli, sol üst
 *    köşe başlangıç, birim punto. OCR koordinatları buna ölçeklenir.
 *  - PDF sayfa düzlemi: sol alt başlangıç. Müşterinin taramalarında sayfa
 *    yatay saklanıp /Rotate 270 ile dik gösteriliyor — dönüşüm tahmin
 *    edilmez, sayfanın kendi değerinden hesaplanır.
 *  - Piksel: sayfa, görüntü düzleminde sabit çözünürlükte render edilir.
 *
 * Sayfa, içindeki görselin sıkıştırmasından bağımsız olarak pdf.js ile
 * render edilir: JPEG, JBIG2, CCITT faks, JPEG 2000, düz Flate, birden çok
 * görselden oluşan sayfa ya da hiç taranmamış (dijital) PDF aynı yoldan geçer.
 * pdf.js kullanılamazsa sayfadaki en büyük JPEG/Flate görseli doğrudan okunur.
 */

export type Matrix = [number, number, number, number, number, number];

export type ScanPage = {
  /** Görüntü düzleminde sayfa boyutu (punto). */
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  /** Görüntü düzlemi → PDF sayfa düzlemi. */
  toPage(u: number, v: number): { x: number; y: number };
  /** Görüntü düzlemindeki noktanın parlaklığı (0 siyah – 255 beyaz); dışarıdaysa null. */
  luminance(u: number, v: number): number | null;
  rgb(u: number, v: number): [number, number, number] | null;
  /** Bir puntoya düşen piksel. */
  pixelsPerPoint: number;
};

/** Varsayılan çözünürlük: 300 DPI. Taramalar genelde bu çözünürlükte gelir. */
export const DEFAULT_PIXELS_PER_POINT = 300 / 72;
/** Tek sayfanın en fazla piksel sayısı; poster boyu sayfada bellek taşmasın. */
const MAX_PAGE_PIXELS = 40_000_000;

// ---------- sayfa geometrisi ----------

type Box = { x: number; y: number; width: number; height: number };

export type PageGeometry = {
  rotation: 0 | 90 | 180 | 270;
  /** Görünür alan (PDF birimi): CropBox ∩ MediaBox — pdf.js ve görüntüleyiciler böyle gösterir. */
  box: Box;
  /** Görüntü düzleminde boyut (punto). */
  width: number;
  height: number;
  toPage(u: number, v: number): { x: number; y: number };
};

function normalize(box: Box): Box {
  const x0 = Math.min(box.x, box.x + box.width);
  const y0 = Math.min(box.y, box.y + box.height);
  return { x: x0, y: y0, width: Math.abs(box.width), height: Math.abs(box.height) };
}

export function pageGeometry(page: PDFPage): PageGeometry {
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  const rotation = (angle === 90 || angle === 180 || angle === 270 ? angle : 0) as PageGeometry["rotation"];
  const media = normalize(page.getMediaBox());
  const crop = normalize(page.getCropBox());
  const x0 = Math.max(media.x, crop.x);
  const y0 = Math.max(media.y, crop.y);
  const x1 = Math.min(media.x + media.width, crop.x + crop.width);
  const y1 = Math.min(media.y + media.height, crop.y + crop.height);
  const box = x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : media;
  const sideways = rotation === 90 || rotation === 270;
  return {
    rotation,
    box,
    width: sideways ? box.height : box.width,
    height: sideways ? box.width : box.height,
    toPage: displayToPage(rotation, box),
  };
}

/** Görüntü düzlemi (sol üst başlangıç) → sayfa düzlemi, sayfanın /Rotate değerine göre. */
export function displayToPage(
  rotation: 0 | 90 | 180 | 270,
  box: { x: number; y: number; width: number; height: number },
): (u: number, v: number) => { x: number; y: number } {
  const { x: x0, y: y0, width: W, height: H } = box;
  switch (rotation) {
    case 90:
      return (u, v) => ({ x: x0 + v, y: y0 + u });
    case 180:
      return (u, v) => ({ x: x0 + W - u, y: y0 + v });
    case 270:
      return (u, v) => ({ x: x0 + W - v, y: y0 + H - u });
    default:
      return (u, v) => ({ x: x0 + u, y: y0 + H - v });
  }
}

/** Görüntü düzlemindeki boyutu verilen sayfa için çözünürlük: 300 DPI, bellek sınırı içinde. */
export function renderScale(width: number, height: number, wanted = DEFAULT_PIXELS_PER_POINT): number {
  const limit = Math.sqrt(MAX_PAGE_PIXELS / Math.max(1, width * height));
  return Math.max(0.5, Math.min(wanted, limit));
}

function rasterPage(geometry: PageGeometry, pixelsPerPoint: number, width: number, height: number, rgb: Uint8Array): ScanPage {
  const color = (u: number, v: number): [number, number, number] | null => {
    const x = Math.floor(u * pixelsPerPoint);
    const y = Math.floor(v * pixelsPerPoint);
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const offset = (y * width + x) * 3;
    return [rgb[offset], rgb[offset + 1], rgb[offset + 2]];
  };
  return {
    width: geometry.width,
    height: geometry.height,
    rotation: geometry.rotation,
    toPage: geometry.toPage,
    rgb: color,
    luminance(u, v) {
      const c = color(u, v);
      return c ? 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] : null;
    },
    pixelsPerPoint,
  };
}

// ---------- pdf.js ----------

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfjsDocument = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;
type CanvasAndContext = {
  canvas: { width: number; height: number };
  context: {
    fillStyle: string;
    fillRect(x: number, y: number, w: number, h: number): void;
    getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
  };
};
type CanvasFactory = {
  create(width: number, height: number): CanvasAndContext;
  destroy(canvasAndContext: CanvasAndContext): void;
};

type Assets = { wasm: string; fonts: string; cmaps: string };

/**
 * pdf.js'in çalışma anında okuduğu dosyalar (JBIG2/JPEG 2000 çözücüleri,
 * standart yazı tipleri, karakter eşlemeleri). Yol, paketleyiciden bağımsız
 * bulunur (bkz. app-files.ts) ve dosyanın varlığı önceden doğrulanır: pdf.js
 * çözücüyü bulamazsa hata vermeyip sayfayı sessizce boş çizer.
 */
function locateAssets(): Assets {
  const root = packageDir("pdfjs-dist");
  const fs = process.getBuiltinModule("node:fs");
  if (!fs.existsSync(path.join(root, "wasm", "jbig2.wasm"))) {
    throw new Error("pdf.js dosyaları eksik (pdfjs-dist/wasm bulunamadı).");
  }
  // pdf.js dosya adını bu önekin sonuna ekleyip fs ile okur: sonda "/" şart.
  const dir = (name: string) => path.join(root, name).split(path.sep).join("/") + "/";
  return { wasm: dir("wasm"), fonts: dir("standard_fonts"), cmaps: dir("cmaps") };
}

let runtime: Promise<{ pdfjs: Pdfjs; assets: Assets }> | null = null;

function pdfRuntime() {
  runtime ??= (async () => {
    const assets = locateAssets();
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // İşçi, aynı iş parçacığında çalışır; yolunu pdf.js'e bulduruyoruz yerine
    // modülü kendimiz veriyoruz — paketleyiciden bağımsız.
    const scope = globalThis as { pdfjsWorker?: unknown };
    scope.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    return { pdfjs, assets };
  })();
  // Başarısız bir yükleme kalıcı olmasın; bir sonraki istek yeniden denesin.
  runtime.catch(() => {
    runtime = null;
  });
  return runtime;
}

async function openPdfjs(bytes: Uint8Array): Promise<{ pdfjs: Pdfjs; doc: PdfjsDocument }> {
  const { pdfjs, assets } = await pdfRuntime();
  const task = pdfjs.getDocument({
    // pdf.js veriyi işçiye aktarırken ArrayBuffer'ı boşaltır; kopya verilir.
    data: bytes.slice(),
    wasmUrl: assets.wasm,
    standardFontDataUrl: assets.fonts,
    cMapUrl: assets.cmaps,
    cMapPacked: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  try {
    return { pdfjs, doc: await task.promise };
  } catch (cause) {
    if (cause instanceof Error && cause.name === "PasswordException") {
      throw new Error("Belge parola korumalı; parolası kaldırılmış hâlini yükleyin.");
    }
    throw cause;
  }
}

/**
 * Sayfayı istenen çözünürlükte render edip RGBA pikselleri döndürür.
 * `transparent`: arka plan boyanmaz (yalnızca sayfanın çizdiği görünür).
 */
async function renderRgba(
  doc: PdfjsDocument,
  pageNumber: number,
  scale: number,
  options: { transparent?: boolean; width?: number; height?: number } = {},
): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  const page = await doc.getPage(pageNumber);
  try {
    const viewport = page.getViewport({ scale });
    const width = options.width ?? Math.max(1, Math.round(viewport.width));
    const height = options.height ?? Math.max(1, Math.round(viewport.height));
    const factory = doc.canvasFactory as CanvasFactory;
    const target = factory.create(width, height);
    try {
      if (!options.transparent) {
        target.context.fillStyle = "#ffffff";
        target.context.fillRect(0, 0, width, height);
      }
      await page.render({
        canvas: target.canvas as unknown as HTMLCanvasElement,
        canvasContext: target.context as unknown as CanvasRenderingContext2D,
        viewport,
        background: options.transparent ? "rgba(0,0,0,0)" : "#ffffff",
      }).promise;

      return { width, height, rgba: target.context.getImageData(0, 0, width, height).data };
    } finally {
      factory.destroy(target);
    }
  } finally {
    page.cleanup();
  }
}

/**
 * Çözülemeyen görsel pdf.js'te hata değil uyarıdır: sayfa o görsel olmadan,
 * sessizce boş çizilir. Planlama yalnızca OCR'ın yazı bulduğu sayfaları okur;
 * böyle bir sayfa bembeyaz çıktıysa tarama çözülememiştir.
 */
function hasInk(rgb: Uint8Array): boolean {
  for (let i = 0; i < rgb.length; i += 3 * 7) {
    if (0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2] < 160) return true;
  }
  return false;
}

function toRgb(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    // Saydam piksel beyaz kâğıttır.
    const alpha = rgba[j + 3] / 255;
    rgb[i * 3] = Math.round(rgba[j] * alpha + 255 * (1 - alpha));
    rgb[i * 3 + 1] = Math.round(rgba[j + 1] * alpha + 255 * (1 - alpha));
    rgb[i * 3 + 2] = Math.round(rgba[j + 2] * alpha + 255 * (1 - alpha));
  }
  return rgb;
}

/**
 * Bir PDF sayfasını verilen piksel boyutunda RGBA olarak render eder. Görsel
 * çıktı üretirken kullanılır: katman saydam render edilip orijinal görselin
 * üstüne bindirilir.
 */
export async function renderPdfPage(
  bytes: Uint8Array,
  pageIndex: number,
  size: { width: number; height: number },
  options: { transparent?: boolean } = {},
): Promise<Uint8ClampedArray> {
  const { doc } = await openPdfjs(bytes);
  try {
    const page = await doc.getPage(pageIndex + 1);
    const base = page.getViewport({ scale: 1 });
    page.cleanup();
    const scale = size.width / base.width;
    const { rgba } = await renderRgba(doc, pageIndex + 1, scale, { ...options, ...size });
    return rgba;
  } finally {
    await doc.destroy();
  }
}

// ---------- yedek yol: görseli doğrudan okumak ----------

function multiply(m: Matrix, n: Matrix): Matrix {
  // PDF: yeni CTM = m × n (m uygulanır, sonra n).
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function decodeStream(stream: PDFRawStream): Uint8Array {
  const filter = stream.dict.get(PDFName.of("Filter"));
  const names =
    filter instanceof PDFArray
      ? filter.asArray().map((item) => String(item))
      : filter
        ? [String(filter)]
        : [];
  let data: Uint8Array = stream.contents;
  for (const name of names) {
    if (name === "/FlateDecode") data = inflateSync(data);
    else break; // DCT ve diğerleri çağırana kalır
  }
  return data;
}

function contentBytes(doc: PDFDocument, page: PDFPage): string {
  const contents = page.node.Contents();
  const streams: PDFRawStream[] = [];
  if (contents instanceof PDFRawStream) streams.push(contents);
  else if (contents instanceof PDFArray) {
    for (const ref of contents.asArray()) {
      const stream = doc.context.lookup(ref);
      if (stream instanceof PDFRawStream) streams.push(stream);
    }
  }
  return streams.map((stream) => Buffer.from(decodeStream(stream)).toString("latin1")).join("\n");
}

/**
 * İçerik akışında görüntünün çizildiği andaki dönüşüm matrisi. Yalnızca
 * q / Q / cm / Do işlenir; taranmış belgelerin içerik akışı bundan ibarettir.
 */
export function imagePlacement(content: string, imageName: string): Matrix | null {
  const tokens = content.match(/\/[^\s/<>[\]()]+|-?\d*\.?\d+(?:[eE][-+]?\d+)?|[A-Za-z'"*]+/g) ?? [];
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;
  const operands: string[] = [];
  for (const token of tokens) {
    if (token === "q") stack.push(ctm);
    else if (token === "Q") ctm = stack.pop() ?? IDENTITY;
    else if (token === "cm") {
      const values = operands.slice(-6).map(Number);
      if (values.length === 6 && values.every(Number.isFinite)) ctm = multiply(values as Matrix, ctm);
    } else if (token === "Do") {
      if (operands[operands.length - 1] === imageName) return ctm;
    }
    if (/^[A-Za-z'"*]+$/.test(token)) operands.length = 0;
    else operands.push(token);
  }
  return null;
}

type Raster = { width: number; height: number; channels: 1 | 3 | 4; data: Uint8Array };

/** 1 bit/piksel gri görüntüyü (satırlar bayta hizalı, 1 = beyaz) 8 bit griye açar. */
export function unpackGray1bpp(bits: Uint8Array, width: number, height: number): Uint8Array {
  const stride = Math.ceil(width / 8);
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      gray[y * width + x] = (bits[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
    }
  }
  return gray;
}

async function decodeImage(stream: PDFRawStream): Promise<Raster> {
  const dict = stream.dict;
  const filter = dict.get(PDFName.of("Filter"));
  const names =
    filter instanceof PDFArray ? filter.asArray().map(String) : filter ? [String(filter)] : [];
  let data: Uint8Array = stream.contents;
  for (const name of names) {
    if (name === "/FlateDecode") data = inflateSync(data);
    else if (name === "/DCTDecode") {
      // Tarayıcı JPEG'leri yeniden başlatma işaretçileri içeriyor; saf JS
      // çözücü (jpeg-js) bunlarda "unknown JPEG marker ffd0" ile düştü.
      // sharp yerel bir paket: en üstte içe aktarılırsa Cloudflare çalışma
      // zamanında (yerel geliştirme sunucusu) tüm site açılışta çöker.
      const { default: sharp } = await import("sharp");
      const { data: pixels, info } = await sharp(data).raw().toBuffer({ resolveWithObject: true });
      const channels = info.channels >= 3 ? (info.channels === 4 ? 4 : 3) : 1;
      return { width: info.width, height: info.height, channels, data: new Uint8Array(pixels) };
    } else {
      throw new Error(`${name.slice(1)} sıkıştırması doğrudan okunamıyor.`);
    }
  }
  const width = (dict.get(PDFName.of("Width")) as PDFNumber).asNumber();
  const height = (dict.get(PDFName.of("Height")) as PDFNumber).asNumber();
  const bits = (dict.get(PDFName.of("BitsPerComponent")) as PDFNumber | undefined)?.asNumber() ?? 8;
  if (bits === 1) return { width, height, channels: 1, data: unpackGray1bpp(data, width, height) };
  const channels = data.length >= width * height * 3 ? 3 : 1;
  return { width, height, channels, data };
}

/** Sayfadaki en büyük görüntü: tarama. */
function scanImage(doc: PDFDocument, page: PDFPage): { name: string; stream: PDFRawStream } | null {
  const xobjects = page.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
  let best: { name: string; stream: PDFRawStream; area: number } | null = null;
  for (const [key, ref] of xobjects?.entries() ?? []) {
    const stream = doc.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    if (String(stream.dict.get(PDFName.of("Subtype"))) !== "/Image") continue;
    const w = (stream.dict.get(PDFName.of("Width")) as PDFNumber | undefined)?.asNumber() ?? 0;
    const h = (stream.dict.get(PDFName.of("Height")) as PDFNumber | undefined)?.asNumber() ?? 0;
    if (!best || w * h > best.area) best = { name: key.toString(), stream, area: w * h };
  }
  return best;
}

async function directPage(doc: PDFDocument, page: PDFPage, geometry: PageGeometry): Promise<ScanPage> {
  const found = scanImage(doc, page);
  if (!found) throw new Error("Sayfada taranmış görüntü yok.");
  const placement = imagePlacement(contentBytes(doc, page), found.name);
  if (!placement) throw new Error("Taranmış görüntünün sayfadaki konumu okunamadı.");
  const raster = await decodeImage(found.stream);

  // Sayfa düzlemi → görüntünün birim karesi (0-1), matrisin tersiyle.
  const [a, b, c, d, e, f] = placement;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-9) throw new Error("Taranmış görüntünün yerleşim matrisi geçersiz.");

  const pixel = (u: number, v: number): number | null => {
    const { x, y } = geometry.toPage(u, v);
    const px = x - e;
    const py = y - f;
    const s = (d * px - c * py) / det;
    const t = (-b * px + a * py) / det;
    if (s < 0 || s >= 1 || t <= 0 || t > 1) return null;
    const i = Math.floor(s * raster.width);
    const j = Math.floor((1 - t) * raster.height);
    return (j * raster.width + i) * raster.channels;
  };
  const rgb = (u: number, v: number): [number, number, number] | null => {
    const offset = pixel(u, v);
    if (offset === null) return null;
    const data = raster.data;
    return raster.channels === 1
      ? [data[offset], data[offset], data[offset]]
      : [data[offset], data[offset + 1], data[offset + 2]];
  };
  return {
    width: geometry.width,
    height: geometry.height,
    rotation: geometry.rotation,
    toPage: geometry.toPage,
    rgb,
    luminance(u, v) {
      const color = rgb(u, v);
      return color ? 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2] : null;
    },
    pixelsPerPoint: raster.width / Math.hypot(a, b),
  };
}

// ---------- belge ----------

export type ScanDocument = {
  pageCount: number;
  /** Sayfayı ihtiyaç anında okur (0'dan başlayan sıra). Sayfalar tek tek işlenir ki büyük belgede bellek taşmasın. */
  page(index: number): Promise<ScanPage>;
  close(): Promise<void>;
};

export async function openScan(bytes: Uint8Array): Promise<ScanDocument> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();

  let renderer: { pdfjs: Pdfjs; doc: PdfjsDocument } | null = null;
  let rendererError: string | null = null;
  try {
    renderer = await openPdfjs(bytes);
    if (renderer.doc.numPages !== pages.length) {
      rendererError = "pdf.js sayfa sayısı tutmadı.";
      await renderer.doc.destroy();
      renderer = null;
    }
  } catch (cause) {
    rendererError = cause instanceof Error ? cause.message : String(cause);
  }

  return {
    pageCount: pages.length,
    async page(index) {
      const page = pages[index];
      if (!page) throw new Error(`Belgede ${index + 1}. sayfa yok.`);
      const geometry = pageGeometry(page);

      let renderFailure = rendererError;
      if (renderer) {
        try {
          const scale = renderScale(geometry.width, geometry.height);
          const { width, height, rgba } = await renderRgba(renderer.doc, index + 1, scale);
          const rgb = toRgb(rgba, width, height);
          if (!hasInk(rgb)) throw new Error("Sayfadaki taranmış görüntü çözülemedi (bozuk ya da desteklenmeyen sıkıştırma).");
          return rasterPage(geometry, scale, width, height, rgb);
        } catch (cause) {
          renderFailure = cause instanceof Error ? cause.message : String(cause);
        }
      }
      try {
        return await directPage(doc, page, geometry);
      } catch {
        throw new Error(renderFailure ?? "Sayfa okunamadı.");
      }
    },
    async close() {
      await renderer?.doc.destroy();
    },
  };
}

/** Bütün sayfaları birden okur. Küçük belgeler ve testler için; planlama sayfa sayfa gider. */
export async function loadScanPages(bytes: Uint8Array): Promise<{ pages: ScanPage[] }> {
  const scan = await openScan(bytes);
  try {
    const pages: ScanPage[] = [];
    for (let index = 0; index < scan.pageCount; index++) pages.push(await scan.page(index));
    return { pages };
  } finally {
    await scan.close();
  }
}
