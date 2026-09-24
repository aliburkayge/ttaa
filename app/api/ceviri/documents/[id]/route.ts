import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../lib/auth";
import { getCeviriSupabase } from "../../../../../lib/ceviri/supabase";

export const runtime = "nodejs";

const DOCUMENT_COLUMNS =
  "id, filename, stats, segments, source_lang, target_lang, status, instructions, chat, client_id, maker_id, detection";

function failure(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

/** Kayıtlı bir belgeyi açar: sayfa yenilense ya da geri gelinse de iş kaldığı yerden sürer. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const { id } = await context.params;
    const { data, error } = await getCeviriSupabase()
      .from("ceviri_documents")
      .select(`${DOCUMENT_COLUMNS}, ocr:layout->ocr`)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Belge bulunamadı." }, { status: 404 });

    const { ocr, ...document } = data as typeof data & {
      ocr: { warning: string | null; provider: string | null; demo: boolean } | null;
    };
    return NextResponse.json({
      document,
      ocrWarning: ocr?.warning ?? null,
      ocrProvider: ocr?.provider ?? null,
      ocrDemo: ocr?.demo === true,
    });
  } catch (error) {
    return failure(error, "Belge açılamadı.");
  }
}

/**
 * Belgenin firmasını değiştirir. `retranslate` ise çevirmenin düzeltmediği
 * bütün satırlar yeniden çevrilmek üzere boşaltılır: yeni firmanın terimcesi
 * ve belleği uygulansın. Düzeltilmiş satırlar olduğu gibi kalır.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as { clientId?: unknown; makerId?: unknown; retranslate?: unknown } | null;
    if (!body || !("clientId" in body)) return NextResponse.json({ error: "clientId gerekli." }, { status: 400 });
    const clientId = typeof body.clientId === "string" && body.clientId ? body.clientId : null;
    const supabase = getCeviriSupabase();
    const { data: doc, error } = await supabase
      .from("ceviri_documents")
      .select("id, segments, maker_id, detection")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) return NextResponse.json({ error: "Belge bulunamadı." }, { status: 404 });

    const previousMaker = (doc.maker_id as string | null) ?? null;
    const makerId =
      "makerId" in body
        ? typeof body.makerId === "string" && body.makerId
          ? body.makerId
          : null
        : previousMaker === clientId
          ? null
          : previousMaker;
    const previous = (doc.detection as Record<string, unknown> | null) ?? {};
    const update: Record<string, unknown> = {
      client_id: clientId,
      maker_id: makerId,
      detection: { ...previous, decision: "manual", clientId, makerId, at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    };
    if (body.retranslate === true) {
      update.segments = (doc.segments as Array<Record<string, unknown>>).map((segment) =>
        segment.source === "human"
          ? segment
          : { ...segment, translation: null, source: null, score: null, engine: null, alternatives: [], note: null, warning: null, terms: [] },
      );
      update.status = "parsed";
    }
    const { data, error: saveError } = await supabase
      .from("ceviri_documents")
      .update(update)
      .eq("id", id)
      .select(DOCUMENT_COLUMNS)
      .single();
    if (saveError) throw new Error(saveError.message);
    return NextResponse.json({ document: data });
  } catch (error) {
    return failure(error, "Kaydedilemedi.");
  }
}
