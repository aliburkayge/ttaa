import { PDFDocument } from "pdf-lib";
import { renderOverlay, type OverlayPlan } from "./pdf-overlay";
import { renderPdfPage } from "./pdf-scan";

/**
 * Görsel belge (telefon fotoğrafı, taranmış JPG/PNG). Kural diğer biçimlerle
 * aynı: görsel gelirse aynı biçimde görsel döner, yalnızca yazı değişir.
 *
 * Görsel tek sayfalık bir PDF'e sarılır ki OCR, sayfa planı ve çeviri katmanı
 * PDF ile aynı yoldan geçsin. Çıktıda ise yalnızca çeviri katmanı (silme
 * yamaları ve yeni yazı) saydam olarak çizilip orijinal piksellerin üstüne
 * bindirilir; dokunulmayan hiçbir piksel yeniden sıkıştırılmaz ya da ölçeklenmez.
 */

export type ImageFormat = "jpeg" | "png" | "webp" | "tiff";

export const IMAGE_FORMATS: Record<ImageFormat, { extensions: string[]; mime: string }> = {
  jpeg: { extensions: [".jpg", ".jpeg"], mime: "image/jpeg" },
  png: { extensions: [".png"], mime: "image/png" },
  webp: { extensions: [".webp"], mime: "image/webp" },
  tiff: { extensions: [".tif", ".tiff"], mime: "image/tiff" },
};

/** Görselin kendi içeriğinden biçimi (uzantıya güvenilmez). */
export function imageFormat(bytes: Uint8Array): ImageFormat | null {
  const at = (i: number) => bytes[i];
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "png";
  if (
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return "webp";
  }
  if ((at(0) === 0x49 && at(1) === 0x49 && at(2) === 0x2a && at(3) === 0) || (at(0) === 0x4d && at(1) === 0x4d && at(2) === 0 && at(3) === 0x2a)) {
    return "tiff";
  }
  return null;
}

/** Görselin piksel boyutu 300 DPI'da sayfaya çevrilir; render da 300 DPI'da yapıldığından piksel piksel örtüşür. */
const POINTS_PER_PIXEL = 72 / 300;

type Upright = { data: Buffer; width: number; height: number; format: ImageFormat };

/**
 * Görseli dik hâline getirir. Telefon fotoğraflarında pikseller yan saklanıp
 * EXIF'le döndürülür; görüntüleyici ne gösteriyorsa çıktı da o olmalı.
 */
async function upright(bytes: Uint8Array): Promise<Upright> {
  const format = imageFormat(bytes);
  if (!format) throw new Error("Görsel biçimi tanınmadı; JPG, PNG, WebP ya da TIFF yükleyin.");
  const { default: sharp } = await import("sharp");
  const meta = await sharp(bytes).metadata();
  if ((meta.pages ?? 1) > 1) {
    throw new Error("Çok sayfalı TIFF desteklenmiyor; belgeyi PDF olarak yükleyin.");
  }
  const { data, info } = await sharp(bytes).rotate().toColourspace("srgb").png().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, format };
}

/** Görseli tek sayfalık PDF'e sarar (OCR ve sayfa planı için). */
export async function imageToPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const image = await upright(bytes);
  const doc = await PDFDocument.create();
  const embedded = await doc.embedPng(image.data);
  const width = image.width * POINTS_PER_PIXEL;
  const height = image.height * POINTS_PER_PIXEL;
  doc.addPage([width, height]).drawImage(embedded, { x: 0, y: 0, width, height });
  return doc.save();
}

/**
 * Çeviriyi orijinal görselin üstüne yazar ve aynı biçimde döndürür.
 * `plan`, `imageToPdf`'in ürettiği PDF üzerinde çıkarılmış olmalıdır.
 */
export async function overlayImage(
  original: Uint8Array,
  plan: OverlayPlan,
  texts: Map<string, { source: string; translation: string | null }>,
  targetLang?: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const image = await upright(original);
  const { default: sharp } = await import("sharp");

  // Aynı sayfa boyutunda boş bir PDF'e yalnızca çeviri katmanı çizilir.
  const blank = await PDFDocument.create();
  blank.addPage([image.width * POINTS_PER_PIXEL, image.height * POINTS_PER_PIXEL]);
  // Silinen yerin kağıdı görselin kendi piksellerinden kurulur.
  const layer = await renderOverlay(await blank.save(), plan, texts, { source: await imageToPdf(original), targetLang });
  const rgba = await renderPdfPage(layer, 0, { width: image.width, height: image.height }, { transparent: true });

  let composed = sharp(image.data).composite([
    { input: Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), raw: { width: image.width, height: image.height, channels: 4 } },
  ]);
  switch (image.format) {
    case "jpeg":
      composed = composed.flatten({ background: "#ffffff" }).jpeg({ quality: 95, chromaSubsampling: "4:4:4" });
      break;
    case "webp":
      composed = composed.webp({ quality: 95 });
      break;
    case "tiff":
      composed = composed.tiff({ compression: "lzw" });
      break;
    default:
      composed = composed.png();
  }
  return { bytes: new Uint8Array(await composed.toBuffer()), mime: IMAGE_FORMATS[image.format].mime };
}
