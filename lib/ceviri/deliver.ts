import { rebuildDocx } from "./docx";
import { imageFormat, imageToPdf, overlayImage } from "./image-doc";
import { isPdf } from "./ocr";
import { PLAN_VERSION, planOverlay, renderOverlay, type OverlayPlan, type ScanLayout } from "./pdf-overlay";
import { tidyTarget } from "./qa";

/**
 * Çeviri, yüklenen dosyanın kendisine yazılır: Word gelirse Word, PDF gelirse
 * PDF, görsel gelirse aynı biçimde görsel döner. Müşteri kuralı: belge görsel
 * olarak ve tablo düzeni olarak hiç değişmez, yalnızca yazılar hedef dilde olur.
 */

export type StoredDocument = {
  filename: string;
  segments: Array<{ id: string; text: string; translation: string | null } & Record<string, unknown>>;
  layout: unknown;
};

export type Delivery =
  | { ok: true; bytes: Uint8Array; mime: string; filename: string; refreshed: Refreshed | null }
  | { ok: false; status: number; error: string; refreshed: Refreshed | null };

/** İndirme sırasında yeniden ölçülen sayfa planı; çağıran kaydeder ki bir dahaki sefer tekrar ölçülmesin. */
export type Refreshed = { layout: ScanLayout; segments: StoredDocument["segments"] };

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Planın satırlara yansıması: yerleşemeyen ve dikkat isteyen satırlar. */
export function withPlacement(segments: StoredDocument["segments"], overlay: OverlayPlan): StoredDocument["segments"] {
  const unplaced = new Map(overlay.unplaced.map((entry) => [entry.id, entry.reason]));
  const cautions = new Map(
    overlay.items.flatMap((item) => (item.caution ? item.lineIds.map((lineId) => [lineId, item.caution]) : [])),
  );
  return segments.map((segment) => ({
    ...segment,
    placement: unplaced.get(segment.id) ?? null,
    caution: cautions.get(segment.id) ?? null,
  }));
}

export async function deliver(doc: StoredDocument, original: Uint8Array): Promise<Delivery> {
  const image = imageFormat(original);

  if (!isPdf(original) && !image) {
    const translations = new Map<string, string>();
    for (const segment of doc.segments) {
      if (segment.translation) translations.set(segment.id, tidyTarget(segment.text, segment.translation));
    }
    // Aynı dosya adı: müşterinin teslim alışkanlığı.
    return { ok: true, bytes: rebuildDocx(original, translations), mime: DOCX_MIME, filename: doc.filename, refreshed: null };
  }

  let layout = doc.layout as ScanLayout | null;
  if (!layout || layout.version !== 2) {
    return { ok: false, status: 409, error: "Bu belge eski bir sürümle yüklenmiş; yeniden yükleyin.", refreshed: null };
  }

  const pdfBytes = image ? await imageToPdf(original) : original;
  let refreshed: Refreshed | null = null;
  if (!layout.overlay || (layout.overlay.version ?? 0) < PLAN_VERSION) {
    // Sayfa düzeni yüklemede ölçülememiş ya da eski bir algoritmayla ölçülmüş.
    // Yeniden ölçülemezse eski plan kullanılır. OCR blokları kayıtlı
    // olduğundan yeniden yüklemeye ve OCR'a gerek yok: plan şimdi çıkarılır.
    try {
      const overlay = await planOverlay(pdfBytes, layout.blocks);
      layout = { ...layout, overlay, overlayError: null };
      refreshed = { layout, segments: withPlacement(doc.segments, overlay) };
    } catch (cause) {
      layout = { ...layout, overlayError: cause instanceof Error ? cause.message : null };
    }
  }
  if (!layout.overlay) {
    return {
      ok: false,
      status: 422,
      error: layout.overlayError ?? "Sayfa düzeni ölçülemediği için çeviri belgeye yazılamıyor.",
      refreshed,
    };
  }

  const texts = new Map(
    doc.segments.map((segment) => [segment.id, { source: segment.text, translation: segment.translation }]),
  );
  if (image) {
    const out = await overlayImage(original, layout.overlay, texts);
    return { ok: true, bytes: out.bytes, mime: out.mime, filename: doc.filename, refreshed };
  }
  return {
    ok: true,
    bytes: await renderOverlay(original, layout.overlay, texts),
    mime: "application/pdf",
    filename: doc.filename,
    refreshed,
  };
}
