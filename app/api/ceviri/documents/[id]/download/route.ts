import { requireAdminSession } from "../../../../../../lib/auth";
import { getCeviriSupabase, CEVIRI_DOCS_BUCKET } from "../../../../../../lib/ceviri/supabase";
import { deliver, type StoredDocument } from "../../../../../../lib/ceviri/deliver";
import { reviewStored } from "../../../../../../lib/ceviri/review";

export const runtime = "nodejs";
// Sayfa planı yüklemede çıkarılamadıysa burada yeniden çıkarılır; uzun belgede zaman alır.
export const maxDuration = 300;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const { id } = await context.params;
    const supabase = getCeviriSupabase();

    const { data: doc, error } = await supabase
      .from("ceviri_documents")
      .select("id, filename, storage_path, segments, layout, source_lang, target_lang, stats")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) return Response.json({ error: "Belge bulunamadı." }, { status: 404 });
    // Bu kurallardan önce çevrilmiş belge de teslimden önce bir kez incelenir.
    doc.segments = await reviewStored(supabase, doc);

    const { data: blob, error: downloadError } = await supabase.storage
      .from(CEVIRI_DOCS_BUCKET)
      .download(doc.storage_path);
    if (downloadError || !blob) throw new Error(downloadError?.message ?? "Kaynak dosya bulunamadı.");
    const original = new Uint8Array(await blob.arrayBuffer());

    const result = await deliver(doc as StoredDocument, original);
    if (result.refreshed) {
      await supabase
        .from("ceviri_documents")
        .update({ layout: result.refreshed.layout, segments: result.refreshed.segments })
        .eq("id", id);
    }
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

    return new Response(result.bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": result.mime,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
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
