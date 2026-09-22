import { PDFDocument } from "pdf-lib";
import { fileKind } from "./library";
import { pageGeometry, renderPdfPage } from "./pdf-scan";

/**
 * Kütüphane kartındaki önizleme: belgenin ilk sayfası, küçük bir WebP olarak.
 * PDF pdf.js ile çizilir, görsel küçültülür. Word belgesinin görüntüsü
 * çizilemez; kart onun yerine ilk satırlarını gösterir (bkz. library.ts).
 */
export async function makeThumbnail(
  bytes: Uint8Array,
  filename: string,
  width: number,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const kind = fileKind(filename);
  if (kind === "word") return null;
  const { default: sharp } = await import("sharp");

  if (kind === "image") {
    const out = await sharp(bytes).rotate().resize({ width, withoutEnlargement: false }).webp({ quality: 80 }).toBuffer();
    return { bytes: out, mime: "image/webp" };
  }

  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  if (!doc.getPageCount()) return null;
  const geometry = pageGeometry(doc.getPage(0));
  const height = Math.max(1, Math.round((width * geometry.height) / geometry.width));
  const rgba = await renderPdfPage(bytes, 0, { width, height });
  const out = await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
    raw: { width, height, channels: 4 },
  })
    .flatten({ background: "#ffffff" })
    .webp({ quality: 80 })
    .toBuffer();
  return { bytes: out, mime: "image/webp" };
}
