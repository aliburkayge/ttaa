import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { getCeviriSupabase, CEVIRI_DOCS_BUCKET } from "../../../../lib/ceviri/supabase";
import { parseDocx } from "../../../../lib/ceviri/docx";
import { findDocxMarks, type DocxLayout } from "../../../../lib/ceviri/docx-marks";
import { IMAGE_FORMATS, imageFormat, imageToPdf } from "../../../../lib/ceviri/image-doc";
import { classifyDefault } from "../../../../lib/ceviri/image-kind";
import { activeOcrProvider, isPdf, ocrToSegments } from "../../../../lib/ceviri/ocr";
import type { MarkKind } from "../../../../lib/ceviri/marks";
import { layoutStats } from "../../../../lib/ceviri/ocr-layout";
import { planOverlay, type OverlayPlan, type ScanLayout } from "../../../../lib/ceviri/pdf-overlay";

export const runtime = "nodejs";
// Taranmış PDF: tüm belgenin OCR'ı, ardından her görsel için ikinci geçiş.
export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const IMAGE_EXTENSIONS = Object.values(IMAGE_FORMATS).flatMap((format) => format.extensions);

type ParsedSegment = {
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
  /** İmza/mühür bölgesinin içinden okunan satır: çıktıda etiketle birlikte yazılır. */
  mark?: MarkKind | null;
};

/** Son belgeler: kaldığı yerden devam edebilmek için. */
export async function GET() {
  try {
    await requireAdminSession();
    const { data, error } = await getCeviriSupabase()
      .from("ceviri_documents")
      .select("id, filename, created_at, source_lang, target_lang, segments")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return NextResponse.json({
      documents: (data ?? []).map((doc) => {
        const segments = (doc.segments ?? []) as Array<{ translation: string | null }>;
        return {
          id: doc.id,
          filename: doc.filename,
          created_at: doc.created_at,
          source_lang: doc.source_lang,
          target_lang: doc.target_lang,
          total: segments.length,
          translated: segments.filter((segment) => segment.translation !== null).length,
        };
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Belgeler okunamadı." },
      { status: 500 },
    );
  }
}

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
    if (![".docx", ".pdf", ...IMAGE_EXTENSIONS].some((extension) => name.endsWith(extension))) {
      return NextResponse.json(
        { error: "Yalnızca Word (.docx), PDF ve görsel (JPG, PNG, WebP, TIFF) kabul ediliyor." },
        { status: 415 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    // Biçim uzantıdan değil içerikten: uzantısı yanlış verilmiş dosya da doğru yoldan gider.
    const image = imageFormat(bytes);
    const scanned = isPdf(bytes) || image !== null;

    let parsed: { segments: ParsedSegment[]; stats: Record<string, number> };
    let layout: ScanLayout | DocxLayout | null = null;
    let ocrWarning: string | null = null;
    let ocrProvider: string | null = null;
    let ocrDemo = false;

    if (scanned) {
      // Görsel tek sayfalık PDF'e sarılır; OCR ve sayfa planı PDF ile aynı yoldan geçer.
      let pdfBytes: Uint8Array;
      try {
        pdfBytes = image ? await imageToPdf(bytes) : bytes;
      } catch (cause) {
        return NextResponse.json(
          { error: cause instanceof Error ? cause.message : "Görsel okunamadı." },
          { status: 422 },
        );
      }

      // PDF yolu OCR sağlayıcısına bağlıdır. Hiçbiri yapılandırılmamışsa demo
      // sağlayıcı devreye girer ve METİN ÇIKARMAZ — yer tutucu döner, uyarı
      // arayüzde gösterilir. Uydurulmuş metin gerçek sanılmasın diye böyle.
      const provider = activeOcrProvider();
      const result = await provider.run(pdfBytes, { lang: sourceLang });

      // Çeviri orijinalin üstüne yazılacak; her satırın yeri şimdi ölçülür ki
      // yerleşemeyen satır inceleme ekranında önceden görünsün. Ölçülemezse
      // yükleme yine başarılı sayılır; indirme sırasında yeniden denenir.
      let overlay: OverlayPlan | null = null;
      let overlayError: string | null = null;
      if (!result.demo) {
        try {
          // Sınıflandırıcı, OCR'ın ayırmadığı imza/mühürleri bulmak için.
          overlay = await planOverlay(pdfBytes, result.blocks, { classify: classifyDefault });
        } catch (cause) {
          overlayError = cause instanceof Error ? cause.message : "Sayfa düzeni ölçülemedi.";
        }
      }
      const unplaced = new Map(overlay?.unplaced.map((entry) => [entry.id, entry.reason]) ?? []);
      const cautions = new Map(
        overlay?.items.flatMap((item) => (item.caution ? item.lineIds.map((id) => [id, item.caution]) : [])) ?? [],
      );

      parsed = {
        segments: ocrToSegments(result).map(({ id, text, kind, order, page, ocrWarning: warning, mark }) => ({
          id,
          text,
          kind,
          order,
          page,
          ocrWarning: warning,
          mark,
          placement: unplaced.get(id) ?? overlayError,
          caution: cautions.get(id) ?? null,
        })),
        stats: layoutStats(result.blocks, result.pages),
      };
      ocrWarning = result.warning;
      ocrProvider = provider.label;
      ocrDemo = result.demo;
      layout = {
        version: 2,
        blocks: result.blocks,
        overlay,
        overlayError,
        ocr: { warning: ocrWarning, provider: ocrProvider, demo: ocrDemo },
      };
    } else {
      let docx: ReturnType<typeof parseDocx>;
      try {
        docx = parseDocx(bytes);
      } catch (cause) {
        return NextResponse.json(
          { error: cause instanceof Error ? cause.message : "Belge okunamadı." },
          { status: 422 },
        );
      }
      // İmza ve mühür görselleri çeviride kopyalanmaz: şimdi sınıflandırılır,
      // mührün yazısı segment olup belgeyle birlikte çevrilir.
      const found = await findDocxMarks(bytes);
      layout = found.layout;
      parsed = {
        segments: [...docx.segments, ...found.segments],
        stats: {
          ...docx.stats,
          signatures: found.layout.marks.filter((mark) => mark.kind !== "stamp").length,
          stamps: found.layout.marks.filter((mark) => mark.kind !== "signature").length,
        },
      };
    }

    if (parsed.segments.length === 0) {
      return NextResponse.json({ error: "Belgede çevrilecek metin bulunamadı." }, { status: 422 });
    }

    const supabase = getCeviriSupabase();
    // Orijinal dosya kendi biçimiyle saklanır; çıktı her indirmede ondan üretilir.
    const extension = isPdf(bytes) ? ".pdf" : image ? IMAGE_FORMATS[image].extensions[0] : ".docx";
    const contentType = isPdf(bytes) ? "application/pdf" : image ? IMAGE_FORMATS[image].mime : DOCX_MIME;
    const storagePath = `${fileHash.slice(0, 2)}/${fileHash}${extension}`;
    const { error: uploadError } = await supabase.storage
      .from(CEVIRI_DOCS_BUCKET)
      .upload(storagePath, bytes, { contentType, upsert: true });
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
