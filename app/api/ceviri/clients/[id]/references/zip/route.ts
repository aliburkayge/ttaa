import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../../../lib/auth";
import { CEVIRI_DOCS_BUCKET, getCeviriSupabase } from "../../../../../../../lib/ceviri/supabase";
import { getClient } from "../../../../../../../lib/ceviri/clients";
import { decodeZipName, pairReferenceFiles } from "../../../../../../../lib/ceviri/pair-files";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 200 * 1024 * 1024;

/**
 * Zip'i açar, kaynak/çeviri dosyalarını eşler, eşlenen dosyaları depoya
 * koyar. Çiftler tek tek `/references`'a gönderilir: her çift OCR ve
 * hizalamayla bir dakikayı bulabilir, tek istekte hepsi zaman aşımına düşerdi.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const client = await getClient(decodeURIComponent((await context.params).id));
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Zip dosyası gerekli." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "Zip 200 MB sınırını aşıyor." }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const files = new Map<string, Uint8Array>();
    for (const [name, data] of Object.entries(unzipSync(bytes))) {
      if (data.length && !name.endsWith("/")) files.set(decodeZipName(name), data);
    }
    const { pairs, unmatched, unsupported } = pairReferenceFiles([...files.keys()]);

    const supabase = getCeviriSupabase();
    const { data: imp, error } = await supabase
      .from("imports")
      .insert({
        kind: "reference-archive",
        filename: file.name,
        file_hash: createHash("sha256").update(bytes).digest("hex"),
        client_id: client.id,
        stats: { found: pairs.length, unmatched: unmatched.length, unsupported: unsupported.length },
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const importId = imp.id as string;

    const staged: Array<{ source: string; target: string; sourcePath: string; targetPath: string }> = [];
    for (const [index, pair] of pairs.entries()) {
      const paths = [pair.source, pair.target].map((name, side) => {
        const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
        return `references/${importId}/${index}-${side}-${createHash("sha1").update(name).digest("hex").slice(0, 10)}${extension}`;
      });
      for (const [side, name] of [pair.source, pair.target].entries()) {
        const { error: uploadError } = await supabase.storage.from(CEVIRI_DOCS_BUCKET).upload(paths[side], files.get(name)!, { upsert: true });
        if (uploadError) throw new Error(`Depolama hatası: ${uploadError.message}`);
      }
      staged.push({ source: pair.source, target: pair.target, sourcePath: paths[0], targetPath: paths[1] });
    }
    return NextResponse.json({ importId, pairs: staged, unmatched, unsupported });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Zip işlenemedi." }, { status: 500 });
  }
}
