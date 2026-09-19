import { getCeviriSupabase } from "./supabase";
import { normalizeForMatch, segmentHash } from "./normalize";
import type { TmxUnit } from "./tmx";

export type TmRow = {
  source_lang: string;
  target_lang: string;
  source_text: string;
  target_text: string;
  source_hash: string;
  target_hash: string;
  source_normalized: string;
  project_names: string[];
  origin: string;
  context_pre: string | null;
  context_post: string | null;
};

export function toTmRow(unit: TmxUnit): TmRow | null {
  const sourceText = unit.sourceText.trim();
  const targetText = unit.targetText.trim();
  if (!sourceText || !targetText || !unit.sourceLang || !unit.targetLang) return null;

  return {
    source_lang: unit.sourceLang,
    target_lang: unit.targetLang,
    source_text: sourceText,
    target_text: targetText,
    source_hash: segmentHash(sourceText, unit.sourceLang),
    target_hash: segmentHash(targetText, unit.targetLang),
    source_normalized: normalizeForMatch(sourceText, unit.sourceLang),
    project_names: unit.projectName ? [unit.projectName] : [],
    // TMX's own origin tag (TM/MT/Lara) is a quality signal, not the row origin.
    origin: "tmx-import",
    context_pre: unit.contextPre,
    context_post: unit.contextPost,
  };
}

function dedupeKey(row: TmRow): string {
  return [row.source_lang, row.target_lang, row.source_hash, row.target_hash].join("\u0000");
}

/** Collapses duplicates inside one batch, merging their project tags. */
export function dedupeRows(rows: TmRow[]): TmRow[] {
  const byKey = new Map<string, TmRow>();
  for (const row of rows) {
    const key = dedupeKey(row);
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, { ...row, project_names: [...row.project_names] });
      continue;
    }
    for (const tag of row.project_names) {
      if (!seen.project_names.includes(tag)) seen.project_names.push(tag);
    }
    seen.context_pre ??= row.context_pre;
    seen.context_post ??= row.context_post;
  }
  return [...byKey.values()];
}

export type InsertTmRowsResult = { inserted: number; merged: number };

/**
 * Writes a batch through the `upsert_tm_segments` RPC (see
 * supabase/ceviri/migrations/202609190004_upsert_tm_segments.sql), which
 * merges `project_names` on conflict instead of discarding the incoming row.
 * A plain `.upsert(..., { ignoreDuplicates: true })` (ON CONFLICT DO NOTHING)
 * would silently drop the project tag of every row that lands on an existing
 * key — the RPC's ON CONFLICT DO UPDATE keeps the distinct union instead.
 *
 * `dedupeRows` collapsing the batch first is load-bearing here, not just an
 * efficiency nicety: ON CONFLICT DO UPDATE raises "cannot affect row a
 * second time" if one statement carries two rows with the same conflict key.
 *
 * Returns how many rows were freshly inserted vs. matched an existing row
 * (and had their project tags merged into it).
 */
export async function insertTmRows(
  rows: TmRow[],
  context: { importId: string; clientId?: string | null; sectorId?: string | null },
): Promise<InsertTmRowsResult> {
  if (rows.length === 0) return { inserted: 0, merged: 0 };
  const supabase = getCeviriSupabase();
  const payload = dedupeRows(rows).map((row) => ({
    ...row,
    import_id: context.importId,
    client_id: context.clientId ?? null,
    sector_id: context.sectorId ?? null,
  }));

  const { data, error } = await supabase.rpc("upsert_tm_segments", { p_rows: payload });
  if (error) throw new Error(`upsert_tm_segments failed: ${error.message}`);

  const result = (data as { inserted_count: number; merged_count: number }[] | null)?.[0];
  return { inserted: result?.inserted_count ?? 0, merged: result?.merged_count ?? 0 };
}
