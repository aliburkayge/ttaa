import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../../lib/auth";
import { getCeviriSupabase } from "../../../../../../lib/ceviri/supabase";
import { normalizeForMatch, segmentHash } from "../../../../../../lib/ceviri/normalize";
import { observeEdits } from "../../../../../../lib/ceviri/edit-learning";
import { recordEdit } from "../../../../../../lib/ceviri/suggestion-store";
import { memoryPair } from "../../../../../../lib/ceviri/units";

export const runtime = "nodejs";
export const maxDuration = 30;

type StoredSegment = {
  id: string;
  text: string;
  translation: string | null;
  source: string | null;
  score: number | null;
  note: string | null;
  warning: string | null;
  /** Çeviride zorunlu tutulan terimler (düzeltmeden öğrenme için). */
  terms?: Array<{ sourceText: string; targetText: string }>;
  /** Birlikte çevrildiği cümlenin ilk satırı: belleğe cümlenin tamamı yazılır. */
  unit?: string | null;
};

/**
 * A reviewer's correction is the most authoritative translation we have, so it
 * goes into the memory as `human-approved` and outranks anything imported from
 * the CAT exports the next time the same sentence appears. The row belongs to
 * the document's firm, and when the reviewer replaced a required term the
 * change is recorded as an observation for that firm (spec 5.6).
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    const { id } = await context.params;

    const body = (await request.json().catch(() => null)) as
      | { segmentId?: unknown; translation?: unknown }
      | null;
    const segmentId = typeof body?.segmentId === "string" ? body.segmentId : "";
    const translation = typeof body?.translation === "string" ? body.translation.trim() : "";
    if (!segmentId) return NextResponse.json({ error: "segmentId gerekli." }, { status: 400 });
    if (!translation) return NextResponse.json({ error: "Çeviri boş olamaz." }, { status: 400 });

    const supabase = getCeviriSupabase();
    const { data: doc, error } = await supabase
      .from("ceviri_documents")
      .select("id, source_lang, target_lang, segments, client_id")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) return NextResponse.json({ error: "Belge bulunamadı." }, { status: 404 });

    const segments = doc.segments as StoredSegment[];
    const target = segments.find((segment) => segment.id === segmentId);
    if (!target) return NextResponse.json({ error: "Segment bulunamadı." }, { status: 404 });

    const updated = segments.map((segment) =>
      segment.id === segmentId
        ? { ...segment, translation, source: "human", warning: null, note: "Çevirmen düzeltmesi" }
        : segment,
    );

    const { error: saveError } = await supabase
      .from("ceviri_documents")
      .update({ segments: updated, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (saveError) throw new Error(saveError.message);

    // Satır bir cümlenin parçasıysa belleğe cümlenin tamamı gider (bkz. units.ts).
    const pair = memoryPair(segments, segmentId, translation);
    const { error: tmError } = await supabase.rpc("upsert_tm_segments", {
      p_rows: [
        {
          source_lang: doc.source_lang,
          target_lang: doc.target_lang,
          source_text: pair.source,
          target_text: pair.target,
          source_hash: segmentHash(pair.source, doc.source_lang),
          target_hash: segmentHash(pair.target, doc.target_lang),
          source_normalized: normalizeForMatch(pair.source, doc.source_lang),
          project_names: ["lingua-düzeltme"],
          origin: "human-approved",
          context_pre: null,
          context_post: null,
          import_id: null,
          client_id: (doc as { client_id?: string | null }).client_id ?? null,
          sector_id: null,
        },
      ],
    });
    if (tmError) throw new Error(`Belleğe yazılamadı: ${tmError.message}`);

    // Düzeltmeden öğrenme: zorunlu terimin karşılığı değiştirildiyse firmaya gözlem.
    // Öğrenme yan iştir; hatası kaydı bozmaz.
    const clientId = (doc as { client_id?: string | null }).client_id ?? null;
    if (clientId && target.translation && target.terms?.length) {
      const observations = observeEdits({
        source: target.text,
        before: target.translation,
        after: translation,
        terms: target.terms,
        lang: doc.target_lang,
      });
      for (const observation of observations) {
        await recordEdit({
          clientId,
          sourceLang: doc.source_lang,
          targetLang: doc.target_lang,
          observation,
          source: target.text,
          after: translation,
          documentId: id,
        }).catch((cause) => console.warn("Düzeltme gözlemi kaydedilemedi:", cause));
      }
    }

    return NextResponse.json({ saved: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Oturumunuz sona erdi." }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kaydedilemedi." },
      { status: 500 },
    );
  }
}
