import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { getCeviriSupabase, CEVIRI_DOCS_BUCKET } from "../../../../lib/ceviri/supabase";
import { parseDocx } from "../../../../lib/ceviri/docx";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    await requireAdminSession();

    const form = await request.formData();
    const file = form.get("file");
    const sourceLang = String(form.get("sourceLang") ?? "en-US");
    const targetLang = String(form.get("targetLang") ?? "tr-TR");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Dosya gerekli." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Dosya 25 MB sınırını aşıyor." }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".docx")) {
      return NextResponse.json(
        { error: "Şimdilik yalnızca .docx destekleniyor. PDF ve taranmış belgeler için OCR servisi henüz bağlanmadı." },
        { status: 415 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileHash = createHash("sha256").update(bytes).digest("hex");

    let parsed;
    try {
      parsed = parseDocx(bytes);
    } catch (cause) {
      return NextResponse.json(
        { error: cause instanceof Error ? cause.message : "Belge okunamadı." },
        { status: 422 },
      );
    }
    if (parsed.segments.length === 0) {
      return NextResponse.json({ error: "Belgede çevrilecek metin bulunamadı." }, { status: 422 });
    }

    const supabase = getCeviriSupabase();
    const storagePath = `${fileHash.slice(0, 2)}/${fileHash}.docx`;
    const { error: uploadError } = await supabase.storage
      .from(CEVIRI_DOCS_BUCKET)
      .upload(storagePath, bytes, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });
    if (uploadError) throw new Error(`Depolama hatası: ${uploadError.message}`);

    const segments = parsed.segments.map((segment) => ({
      ...segment,
      translation: null,
      source: null,
      score: null,
      note: null,
      warning: null,
    }));

    const { data, error } = await supabase
      .from("ceviri_documents")
      .insert({
        filename: file.name,
        file_hash: fileHash,
        storage_path: storagePath,
        source_lang: sourceLang,
        target_lang: targetLang,
        stats: parsed.stats,
        segments,
      })
      .select("id, filename, stats, segments, source_lang, target_lang, status")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ document: data });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Yükleme başarısız." },
      { status: 500 },
    );
  }
}
