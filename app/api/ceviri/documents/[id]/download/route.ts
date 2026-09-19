import { requireAdminSession } from "../../../../../../lib/auth";
import { getCeviriSupabase, CEVIRI_DOCS_BUCKET } from "../../../../../../lib/ceviri/supabase";
import { rebuildDocx } from "../../../../../../lib/ceviri/docx";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const { id } = await context.params;
    const supabase = getCeviriSupabase();

    const { data: doc, error } = await supabase
      .from("ceviri_documents")
      .select("filename, storage_path, segments")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) return Response.json({ error: "Belge bulunamadı." }, { status: 404 });

    const { data: blob, error: downloadError } = await supabase.storage
      .from(CEVIRI_DOCS_BUCKET)
      .download(doc.storage_path);
    if (downloadError || !blob) throw new Error(downloadError?.message ?? "Kaynak dosya bulunamadı.");

    const segments = doc.segments as Array<{ id: string; translation: string | null }>;
    const translations = new Map<string, string>();
    for (const segment of segments) {
      if (segment.translation) translations.set(segment.id, segment.translation);
    }

    const rebuilt = rebuildDocx(new Uint8Array(await blob.arrayBuffer()), translations);
    // Same filename as the source, per the customer's own delivery convention.
    const name = doc.filename.replace(/\.docx$/i, "") + ".docx";

    return new Response(rebuilt as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
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
