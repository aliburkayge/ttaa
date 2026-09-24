import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../../lib/auth";
import { getCeviriSupabase } from "../../../../../../lib/ceviri/supabase";
import { getClient } from "../../../../../../lib/ceviri/clients";
import { parseTermbase } from "../../../../../../lib/ceviri/termbase";
import { importTermRows } from "../../../../../../lib/ceviri/term-store";
import { parseTmxUnits } from "../../../../../../lib/ceviri/tmx";
import { insertTmRows, toTmRow, type TmRow } from "../../../../../../lib/ceviri/tm-store";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 60 * 1024 * 1024;

/**
 * Firmanın kütüphanesine terimce (xlsx) ya da çeviri belleği (TMX). İçerik
 * yalnızca bu firma için geçerli olur. TMX'te var olan bir cümle çifti
 * (başka firmanın ya da genelin) firması değişmeden kalır: aynı çift ortaktır.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const client = await getClient(decodeURIComponent((await context.params).id));
    if (!client) return NextResponse.json({ error: "Firma bulunamadı." }, { status: 404 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Dosya gerekli." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "Dosya 60 MB sınırını aşıyor." }, { status: 400 });
    const name = file.name.toLowerCase();
    const kind = name.endsWith(".xlsx") ? "termbase-xlsx" : name.endsWith(".tmx") ? "tmx" : null;
    if (!kind) {
      return NextResponse.json({ error: "Yalnızca terimce (.xlsx) ve çeviri belleği (.tmx) kabul ediliyor." }, { status: 415 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const supabase = getCeviriSupabase();
    const { data: imp, error: impError } = await supabase
      .from("imports")
      .insert({ kind, filename: file.name, file_hash: createHash("sha256").update(bytes).digest("hex"), client_id: client.id })
      .select("id")
      .single();
    if (impError) throw new Error(impError.message);
    const importId = imp.id as string;

    try {
      let stats: Record<string, number>;
      if (kind === "termbase-xlsx") {
        const parsed = parseTermbase(bytes);
        const result = await importTermRows(parsed.rows, { scope: { scopeType: "client", scopeId: client.id }, importId });
        stats = { rows: parsed.rows.length, concepts: result.concepts, variants: result.variants };
      } else {
        const text = new TextDecoder("utf-8").decode(bytes);
        async function* chunks() {
          for (let i = 0; i < text.length; i += 1 << 20) yield text.slice(i, i + (1 << 20));
        }
        let seen = 0;
        let inserted = 0;
        let merged = 0;
        let batch: TmRow[] = [];
        const flush = async () => {
          if (!batch.length) return;
          const result = await insertTmRows(batch, { importId, clientId: client.id, sectorId: client.default_sector_id });
          inserted += result.inserted;
          merged += result.merged;
          batch = [];
        };
        for await (const unit of parseTmxUnits(chunks())) {
          seen += 1;
          const row = toTmRow(unit);
          if (row) batch.push(row);
          if (batch.length >= 500) await flush();
        }
        await flush();
        stats = { units: seen, inserted, merged };
      }
      await supabase.from("imports").update({ status: "succeeded", stats, finished_at: new Date().toISOString() }).eq("id", importId);
      return NextResponse.json({ kind, stats });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await supabase.from("imports").update({ status: "failed", error: message, finished_at: new Date().toISOString() }).eq("id", importId);
      throw cause;
    }
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "İçe aktarılamadı." }, { status: 500 });
  }
}
