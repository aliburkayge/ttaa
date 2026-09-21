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

/**
 * Taranmış bir PDF sayfasının görüntüsü ve koordinat dönüşümleri.
 *
 * Kural: yüklenen belge görsel olarak değişmez. Çeviriyi orijinal sayfanın
 * üstüne, İngilizce yazının tam yerine yazarız. Bunun için üç koordinat
 * sistemi arasında kesin dönüşüm gerekir:
 *
 *  - Görüntü düzlemi ("display"): sayfanın ekranda göründüğü hâli, sol üst
 *    köşe başlangıç, birim punto. OCR koordinatları buna ölçeklenir.
 *  - PDF sayfa düzlemi: sol alt başlangıç. Müşterinin taramalarında sayfa
 *    yatay saklanıp /Rotate 270 ile dik gösteriliyor — dönüşüm tahmin
 *    edilmez, sayfanın kendi değerinden hesaplanır.
 *  - Tarama pikseli: görüntü sayfaya bir "cm" matrisiyle yerleştirilir
 *    (ölçüm: DELAN SC'de 3,12/2,82 punto kaydırılmış, 844,8×589,44'e
 *    ölçeklenmiş — sayfa boyutuyla aynı değil). Matris içerik akışından okunur.
 */

export type Matrix = [number, number, number, number, number, number];

export type ScanPage = {
  /** Görüntü düzleminde sayfa boyutu (punto). */
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  /** Görüntü düzlemi → PDF sayfa düzlemi. */
  toPage(u: number, v: number): { x: number; y: number };
  /** Görüntü düzlemindeki noktanın tarama parlaklığı (0 siyah – 255 beyaz); dışarıdaysa null. */
  luminance(u: number, v: number): number | null;
  rgb(u: number, v: number): [number, number, number] | null;
  /** Bir puntoya düşen tarama pikseli. */
  pixelsPerPoint: number;
};

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

/** pdf.js'nin 1 bit/piksel gri görüntüsünü (satırlar bayta hizalı, 1 = beyaz) 8 bit griye açar. */
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

/**
 * JBIG2, CCITT, JPX gibi biçimleri pdf.js çözer (JBIG2 çözücüsü WASM). Yalnızca
 * gerektiğinde yüklenir; JPEG taramalar bu yola hiç girmez. Sayfadaki en büyük
 * görüntü tarama sayılır.
 */
async function decodeWithPdfjs(bytes: Uint8Array, pageNumber: number): Promise<Raster> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdf.js sonda "/" ister; Windows'ta path.sep ters eğik çizgi olduğundan
  // ayırıcılar düzeltilip sona elle eklenir.
  const wasmUrl = path.join(process.cwd(), "node_modules", "pdfjs-dist", "wasm").split(path.sep).join("/") + "/";
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    wasmUrl,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(pageNumber);
    const ops = await page.getOperatorList();
    let best: { name: string; area: number } | null = null;
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;
      const [name, width, height] = ops.argsArray[i] as [string, number, number];
      if (!best || width * height > best.area) best = { name, area: width * height };
    }
    if (!best) throw new Error("PDF sayfasında çözülebilir bir tarama görüntüsü bulunamadı.");
    const store = best.name.startsWith("g_") ? page.commonObjs : page.objs;
    const image = await new Promise<{ width: number; height: number; kind: number; data: Uint8Array } | null>(
      (resolve) => store.get(best!.name, resolve),
    );
    if (!image?.data) throw new Error("Tarama görüntüsü çözülemedi (bozuk ya da desteklenmeyen sıkıştırma).");
    const { width, height, data, kind } = image;
    // pdf.js: 1 = 1 bit gri, 2 = RGB 24, 3 = RGBA 32.
    if (kind === 1) return { width, height, channels: 1, data: unpackGray1bpp(data, width, height) };
    if (kind === 2) return { width, height, channels: 3, data: new Uint8Array(data) };
    return { width, height, channels: 4, data: new Uint8Array(data) };
  } finally {
    await doc.destroy();
  }
}

async function decodeImage(stream: PDFRawStream, fallback: () => Promise<Raster>): Promise<Raster> {
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
      return fallback();
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

export async function loadScanPages(bytes: Uint8Array): Promise<{ doc: PDFDocument; pages: ScanPage[] }> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages: ScanPage[] = [];

  for (const [pageIndex, page] of doc.getPages().entries()) {
    const angle = ((page.getRotation().angle % 360) + 360) % 360;
    const rotation = (angle === 90 || angle === 180 || angle === 270 ? angle : 0) as ScanPage["rotation"];
    const media = page.getMediaBox();
    const sideways = rotation === 90 || rotation === 270;
    const width = sideways ? media.height : media.width;
    const height = sideways ? media.width : media.height;
    const toPage = displayToPage(rotation, media);

    const found = scanImage(doc, page);
    if (!found) throw new Error("PDF sayfasında taranmış görüntü bulunamadı.");
    const placement = imagePlacement(contentBytes(doc, page), found.name);
    if (!placement) throw new Error("Taranmış görüntünün sayfadaki konumu okunamadı.");
    const raster = await decodeImage(found.stream, () => decodeWithPdfjs(bytes, pageIndex + 1));

    // Sayfa düzlemi → görüntünün birim karesi (0-1), matrisin tersiyle.
    const [a, b, c, d, e, f] = placement;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-9) throw new Error("Taranmış görüntünün yerleşim matrisi geçersiz.");

    const pixel = (u: number, v: number): number | null => {
      const { x, y } = toPage(u, v);
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

    pages.push({
      width,
      height,
      rotation,
      toPage,
      rgb,
      luminance(u, v) {
        const color = rgb(u, v);
        return color ? 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2] : null;
      },
      pixelsPerPoint: raster.width / Math.hypot(a, b),
    });
  }

  return { doc, pages };
}
