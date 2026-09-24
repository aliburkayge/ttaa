import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../../lib/auth";
import { CEVIRI_DOCS_BUCKET, getCeviriSupabase } from "../../../../../../lib/ceviri/supabase";
import { getClient } from "../../../../../../lib/ceviri/clients";
import { importReferencePair } from "../../../../../../lib/ceviri/reference-import";

export const runtime = "nodejs";
export const maxDuration = 300;

async function download(path: string): Promise<Uint8Array> {
  const { data, error } = await getCeviriSupabase().storage.from(CEVIRI_DOCS_BUCKET).download(path);
  if (error || !data) throw new Error(`Dosya okunamadı: ${path}`);
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Tek referans çifti: ya iki dosya (multipart `source`, `target`) ya da zip
 * yüklemesinin depoya koyduğu yollar (JSON). Aynı `importId` ile gelen çiftler
 * tek içe aktarım kaydında toplanır.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const client = await getClient(decodeURIComponent((await context.params).id));
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const supabase = getCeviriSupabase();

    let sourceName: string;
    let sourceBytes: Uint8Array;
    let targetBytes: Uint8Array;
    let sourceLang: string;
    let targetLang: string;
    let importId: string | null = null;
    let filename: string;

    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      const body = (await request.json()) as Record<string, string | undefined>;
      if (!body.sourcePath || !body.targetPath || !body.sourceName) {
        return NextResponse.json({ error: "sourcePath, targetPath ve sourceName gerekli." }, { status: 400 });
      }
      sourceName = body.sourceName;
      sourceBytes = await download(body.sourcePath);
      targetBytes = await download(body.targetPath);
      sourceLang = body.sourceLang ?? "en-US";
      targetLang = body.targetLang ?? "tr-TR";
      importId = body.importId ?? null;
      filename = sourceName;
    } else {
      const form = await request.formData();
      const source = form.get("source");
      const target = form.get("target");
      if (!(source instanceof File) || !(target instanceof File)) {
        return NextResponse.json({ error: "Kaynak ve çeviri dosyası gerekli." }, { status: 400 });
      }
      if (!target.name.toLowerCase().endsWith(".docx")) {
        return NextResponse.json({ error: "Çeviri Word (.docx) olmalı." }, { status: 415 });
      }
      sourceName = source.name;
      sourceBytes = new Uint8Array(await source.arrayBuffer());
      targetBytes = new Uint8Array(await target.arrayBuffer());
      sourceLang = String(form.get("sourceLang") ?? "en-US");
      targetLang = String(form.get("targetLang") ?? "tr-TR");
      filename = `${source.name} ↔ ${target.name}`;
    }

    if (!importId) {
      const { data, error } = await supabase
        .from("imports")
        .insert({
          kind: "reference-pair",
          filename,
          file_hash: createHash("sha256").update(sourceBytes).digest("hex"),
          client_id: client.id,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      importId = data.id as string;
    }

    const stats = await importReferencePair({
      clientId: client.id,
      sectorId: client.default_sector_id,
      importId,
      sourceName,
      sourceBytes,
      targetBytes,
      sourceLang,
      targetLang,
    });

    const { data: current } = await supabase.from("imports").select("stats").eq("id", importId).single();
    const previous = (current?.stats as Record<string, number> | null) ?? {};
    const merged = {
      ...previous,
      pairs: (previous.pairs ?? 0) + 1,
      aligned: (previous.aligned ?? 0) + stats.aligned,
      verified: (previous.verified ?? 0) + stats.verified,
      dropped: (previous.dropped ?? 0) + stats.dropped,
      stored: (previous.stored ?? 0) + stats.stored,
    };
    await supabase.from("imports").update({ stats: merged, status: "succeeded", finished_at: new Date().toISOString() }).eq("id", importId);
    return NextResponse.json({ importId, stats });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Referans işlenemedi." }, { status: 500 });
  }
}
