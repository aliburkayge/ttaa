import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { getCeviriSupabase, CEVIRI_DOCS_BUCKET } from "../../../../lib/ceviri/supabase";
import { parseDocx } from "../../../../lib/ceviri/docx";
import { activeOcrProvider, isPdf, ocrToSegments } from "../../../../lib/ceviri/ocr";
import { layoutStats } from "../../../../lib/ceviri/ocr-layout";
import { planOverlay, type OverlayPlan, type ScanLayout } from "../../../../lib/ceviri/pdf-overlay";

export const runtime = "nodejs";
// Taranmış PDF: tüm belgenin OCR'ı, ardından her görsel için ikinci geçiş.
export const maxDuration = 300;

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
    const name = file.name.toLowerCase();
    if (!name.endsWith(".docx") && !name.endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Yalnızca .docx ve .pdf kabul ediliyor." },
        { status: 415 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileHash = createHash("sha256").update(bytes).digest("hex");

    let parsed: {
      segments: Array<{
        id: string;
        text: string;
        kind: "paragraph" | "table-cell";
        order: number;
        page?: number;
        ocrWarning?: string | null;
        /** Çeviri orijinal konumuna yazılamayacaksa nedeni. */
        placement?: string | null;
        /** Yazılabilir ama çıktıya bakılmalı (ör. harfe değen aynı renkte mühür). */
        caution?: string | null;
      }>;
      stats: Record<string, number>;
    };
    let layout: ScanLayout | null = null;
    let ocrWarning: string | null = null;
    let ocrProvider: string | null = null;
    let ocrDemo = false;

    if (isPdf(bytes)) {
      // PDF yolu OCR sağlayıcısına bağlıdır. Hiçbiri yapılandırılmamışsa demo
      // sağlayıcı devreye girer ve METİN ÇIKARMAZ — yer tutucu döner, uyarı
      // arayüzde gösterilir. Uydurulmuş metin gerçek sanılmasın diye böyle.
      const provider = activeOcrProvider();
      const result = await provider.run(bytes, { lang: sourceLang });

      // Çeviri orijinal PDF'in üstüne yazılacak; her satırın yeri şimdi ölçülür
      // ki yerleşemeyen satır inceleme ekranında önceden görünsün.
      let overlay: OverlayPlan | null = null;
      let overlayError: string | null = null;
      if (!result.demo) {
        try {
          overlay = await planOverlay(bytes, result.blocks);
        } catch (cause) {
          overlayError = cause instanceof Error ? cause.message : "Sayfa düzeni ölçülemedi.";
        }
      }
      const unplaced = new Map(overlay?.unplaced.map((entry) => [entry.id, entry.reason]) ?? []);
      const cautions = new Map(
        overlay?.items.flatMap((item) => (item.caution ? item.lineIds.map((id) => [id, item.caution]) : [])) ?? [],
      );

      const segments = ocrToSegments(result);
      parsed = {
        segments: segments.map(({ id, text, kind, order, page, ocrWarning: warning }) => ({
          id,
          text,
          kind,
          order,
          page,
          ocrWarning: warning,
          placement: unplaced.get(id) ?? overlayError,
          caution: cautions.get(id) ?? null,
        })),
        stats: layoutStats(result.blocks, result.pages),
      };
      layout = { version: 2, blocks: result.blocks, overlay, overlayError };
      ocrWarning = result.warning;
      ocrProvider = provider.label;
      ocrDemo = result.demo;
    } else {
      try {
        parsed = parseDocx(bytes);
      } catch (cause) {
        return NextResponse.json(
          { error: cause instanceof Error ? cause.message : "Belge okunamadı." },
          { status: 422 },
        );
      }
    }

    if (parsed.segments.length === 0) {
      return NextResponse.json({ error: "Belgede çevrilecek metin bulunamadı." }, { status: 422 });
    }

    const supabase = getCeviriSupabase();
    const storagePath = `${fileHash.slice(0, 2)}/${fileHash}${isPdf(bytes) ? ".pdf" : ".docx"}`;
    const { error: uploadError } = await supabase.storage
      .from(CEVIRI_DOCS_BUCKET)
      .upload(storagePath, bytes, {
        contentType: isPdf(bytes)
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
        layout,
      })
      .select("id, filename, stats, segments, source_lang, target_lang, status, instructions, chat")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ document: data, ocrWarning, ocrProvider, ocrDemo });
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
