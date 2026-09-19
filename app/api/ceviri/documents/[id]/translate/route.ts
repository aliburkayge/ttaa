import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../../lib/auth";
import { getCeviriSupabase } from "../../../../../../lib/ceviri/supabase";
import { translateSegment, type TranslatedSegment } from "../../../../../../lib/ceviri/translate";

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
      .select("id, source_lang, target_lang, segments, status")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) return NextResponse.json({ error: "Belge bulunamadı." }, { status: 404 });

    const segments = doc.segments as StoredSegment[];
    const pending = segments.filter((segment) => segment.translation === null);
    if (pending.length === 0) {
      return NextResponse.json({ done: true, remaining: 0, segments });
    }

    const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.5-2026-04-23";
    const batch = pending.slice(0, CHUNK);
    const results = await Promise.all(
      batch.map((segment) =>
        translateSegment(segment, {
          sourceLang: doc.source_lang,
          targetLang: doc.target_lang,
          model,
        }).catch((cause): TranslatedSegment => ({
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
      ),
    );

    const byId = new Map(results.map((result) => [result.id, result]));
    const merged = segments.map((segment) => {
      const result = byId.get(segment.id);
      if (!result) return segment;
      return {
        ...segment,
        translation: result.translation,
        source: result.source,
        score: result.score,
        note: result.note,
        warning: result.warning,
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

    return NextResponse.json({ done: remaining === 0, remaining, segments: merged });
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
