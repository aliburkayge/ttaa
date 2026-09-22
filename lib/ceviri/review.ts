import { reviewDocument, type ReviewSegment } from "./consistency";
import { askModel } from "./llm";
import type { getCeviriSupabase } from "./supabase";

/** İnceleme kuralları değişince artırılır: eski belgeler bir sonraki indirmede yeniden incelenir. */
export const REVIEW_VERSION = 1;

type StoredDoc = {
  id: string;
  source_lang: string;
  target_lang: string;
  segments: unknown;
  stats?: unknown;
};

/**
 * Çevirisi biten belgeyi bir kez tutarlılık incelemesinden geçirir (bkz.
 * consistency.ts) ve sonucu kaydeder. Yapıldığı `stats.reviewed` alanında
 * işaretlenir; tekrar çağrılırsa bir şey yapmaz.
 */
export async function reviewStored<T extends ReviewSegment>(
  supabase: ReturnType<typeof getCeviriSupabase>,
  doc: StoredDoc,
): Promise<T[]> {
  const segments = doc.segments as T[];
  const stats = (doc.stats ?? {}) as Record<string, unknown>;
  if (stats.reviewed === REVIEW_VERSION || segments.some((segment) => segment.translation === null)) return segments;

  const result = await reviewDocument(segments, {
    sourceLang: doc.source_lang,
    targetLang: doc.target_lang,
    ask: askModel,
  });
  const { error } = await supabase
    .from("ceviri_documents")
    .update({
      segments: result.segments,
      stats: { ...stats, reviewed: REVIEW_VERSION, reviewChanges: result.changed },
      updated_at: new Date().toISOString(),
    })
    .eq("id", doc.id);
  if (error) throw new Error(error.message);
  return result.segments;
}
