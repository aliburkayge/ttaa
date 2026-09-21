import { requireAdminSession } from "../../../../../../lib/auth";
import { getCeviriSupabase, CEVIRI_DOCS_BUCKET } from "../../../../../../lib/ceviri/supabase";
import { rebuildDocx } from "../../../../../../lib/ceviri/docx";
import { renderOverlay, type ScanLayout } from "../../../../../../lib/ceviri/pdf-overlay";
import { tidyTarget } from "../../../../../../lib/ceviri/qa";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Çeviri, yüklenen dosyanın kendisine yazılır: Word gelirse Word, PDF gelirse
 * PDF döner. Müşteri kuralı: belge görsel olarak ve tablo düzeni olarak hiç
 * değişmez, yalnızca yazılar hedef dilde olur.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const { id } = await context.params;
    const supabase = getCeviriSupabase();

    const { data: doc, error } = await supabase
      .from("ceviri_documents")
      .select("filename, storage_path, segments, layout")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) return Response.json({ error: "Belge bulunamadı." }, { status: 404 });

    const { data: blob, error: downloadError } = await supabase.storage
      .from(CEVIRI_DOCS_BUCKET)
      .download(doc.storage_path);
    if (downloadError || !blob) throw new Error(downloadError?.message ?? "Kaynak dosya bulunamadı.");
    const original = new Uint8Array(await blob.arrayBuffer());

    const segments = doc.segments as Array<{ id: string; text: string; translation: string | null }>;
    const disposition = (name: string) => `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;

    if (/\.pdf$/i.test(doc.storage_path)) {
      const layout = doc.layout as ScanLayout | null;
      if (!layout || layout.version !== 2) {
        return Response.json(
          { error: "Bu belge eski bir sürümle yüklenmiş; yeniden yükleyin." },
          { status: 409 },
        );
      }
      if (!layout.overlay) {
        return Response.json(
          { error: layout.overlayError ?? "Sayfa düzeni ölçülemediği için çeviri PDF'e yazılamıyor." },
          { status: 422 },
        );
      }
      const texts = new Map(
        segments.map((segment) => [segment.id, { source: segment.text, translation: segment.translation }]),
      );
      const pdf = await renderOverlay(original, layout.overlay, texts);
      return new Response(pdf as unknown as BodyInit, {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": disposition(doc.filename) },
      });
    }

    const translations = new Map<string, string>();
    for (const segment of segments) {
      if (segment.translation) translations.set(segment.id, tidyTarget(segment.text, segment.translation));
    }
    const rebuilt = rebuildDocx(original, translations);
    // Same filename as the source, per the customer's own delivery convention.
    return new Response(rebuilt as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": disposition(doc.filename),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return Response.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "İndirme başarısız." },
      { status: 500 },
    );
  }
}
