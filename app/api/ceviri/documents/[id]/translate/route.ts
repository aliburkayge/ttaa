import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../../lib/auth";
import { getCeviriSupabase } from "../../../../../../lib/ceviri/supabase";
import { reviewStored } from "../../../../../../lib/ceviri/review";
import { scopeFor } from "../../../../../../lib/ceviri/clients";
import { translateSegment, type TranslatedSegment } from "../../../../../../lib/ceviri/translate";
import { translatePending } from "../../../../../../lib/ceviri/translate-document";

export const runtime = "nodejs";
export const maxDuration = 300;

type StoredSegment = {
  id: string;
  text: string;
  kind: string;
  order: number;
  translation: string | null;
  source: string | null;
  score: number | null;
  note: string | null;
  warning: string | null;
  engine?: string | null;
  alternatives?: Array<{ engine: string; text: string }>;
  /** Çeviride zorunlu tutulan terimler: düzeltmeden öğrenme bunlara bakar. */
  terms?: Array<{ sourceText: string; targetText: string }>;
  page?: number;
  /** OCR bloğu (taranmış belge): aynı paragrafın satırları cümle olarak çevrilir. */
  block?: number;
  mark?: unknown;
  /** Birlikte çevrildiği cümlenin ilk satırı (bkz. units.ts). */
  unit?: string | null;
};

/** How many segments one request translates before returning, so the UI keeps moving. */
const CHUNK = 12;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const { id } = await context.params;
    const supabase = getCeviriSupabase();

    const { data: doc, error } = await supabase
      .from("ceviri_documents")
      .select("id, filename, source_lang, target_lang, segments, status, instructions, stats, client_id, maker_id")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) return NextResponse.json({ error: "Belge bulunamadı." }, { status: 404 });

    const segments = doc.segments as StoredSegment[];
    const pending = segments.filter((segment) => segment.translation === null);
    if (pending.length === 0) {
      const reviewed = await reviewStored(supabase, doc);
      return NextResponse.json({ done: true, remaining: 0, segments: reviewed });
    }

    const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.5-2026-04-23";
    // Firmanın terimcesi ve belleği önce: müşteri → üretici → sektör → genel.
    const { chain, firmInstructions } = await scopeFor(doc as { client_id?: string | null; maker_id?: string | null });
    // Cümleler bütün olarak, çevresindeki metinle çevrilir (bkz. translate-document.ts).
    const results = await translatePending(segments, {
      sourceLang: doc.source_lang,
      targetLang: doc.target_lang,
      model,
      instructions: (doc as { instructions?: string | null }).instructions ?? null,
      scope: chain,
      firmInstructions,
      document: (doc as { filename?: string | null }).filename ?? null,
      limit: CHUNK,
      translate: (segment, options) =>
        translateSegment(segment, options).catch((cause): TranslatedSegment => ({
          id: segment.id,
          text: segment.text,
          translation: segment.text,
          source: "untouched",
          score: null,
          terms: [],
          forbidden: [],
          note: null,
          warning: cause instanceof Error ? `Çeviri başarısız: ${cause.message}` : "Çeviri başarısız.",
        })),
    });

    const byId = new Map(results.map((result) => [result.id, result]));
    const merged = segments.map((segment) => {
      const result = byId.get(segment.id);
      if (!result) return segment;
      return {
        ...segment,
        translation: result.translation,
        source: result.source,
        score: result.score,
        engine: result.engine ?? null,
        alternatives: result.alternatives ?? [],
        note: result.note,
        warning: result.warning,
        terms: result.terms.map(({ sourceText, targetText }) => ({ sourceText, targetText })),
        unit: result.unit,
      };
    });

    const remaining = merged.filter((segment) => segment.translation === null).length;
    const { error: updateError } = await supabase
      .from("ceviri_documents")
      .update({
        segments: merged,
        status: remaining === 0 ? "translated" : "translating",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updateError) throw new Error(updateError.message);

    // Son parça: belge bir bütün olarak tutarlılık incelemesinden geçer.
    const final = remaining === 0 ? await reviewStored(supabase, { ...doc, segments: merged }) : merged;
    return NextResponse.json({ done: remaining === 0, remaining, segments: final });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Çeviri başarısız." },
      { status: 500 },
    );
  }
}
