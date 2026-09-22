import { requireAdminSession } from "../../../../../../lib/auth";
import { getCeviriSupabase, CEVIRI_DOCS_BUCKET } from "../../../../../../lib/ceviri/supabase";
import { makeThumbnail } from "../../../../../../lib/ceviri/thumbnail";

export const runtime = "nodejs";

const WIDTHS = [240, 360, 720];
/** Yüklenen dosya değişmez; önizleme bir kez çizilip bellekte tutulur. */
const cache = new Map<string, { bytes: Buffer; mime: string } | null>();
const CACHE_SIZE = 300;

/** Kütüphane kartının önizlemesi: belgenin ilk sayfası. Word belgesinde 204 (resim yok). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const { id } = await context.params;
    const wanted = Number(new URL(request.url).searchParams.get("w") ?? 360);
    const width = WIDTHS.find((candidate) => candidate >= wanted) ?? WIDTHS[WIDTHS.length - 1];
    const key = `${id}:${width}`;

    let thumb = cache.get(key);
    if (thumb === undefined) {
      const supabase = getCeviriSupabase();
      const { data: doc, error } = await supabase
        .from("ceviri_documents")
        .select("filename, storage_path")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!doc) return Response.json({ error: "Belge bulunamadı." }, { status: 404 });
      const { data: blob, error: downloadError } = await supabase.storage
        .from(CEVIRI_DOCS_BUCKET)
        .download(doc.storage_path);
      if (downloadError || !blob) throw new Error(downloadError?.message ?? "Kaynak dosya bulunamadı.");
      thumb = await makeThumbnail(new Uint8Array(await blob.arrayBuffer()), doc.filename, width);
      if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
      cache.set(key, thumb);
    }

    if (!thumb) return new Response(null, { status: 204 });
    return new Response(new Uint8Array(thumb.bytes), {
      headers: { "Content-Type": thumb.mime, "Cache-Control": "private, max-age=604800, immutable" },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return Response.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Önizleme çizilemedi." },
      { status: 500 },
    );
  }
}
