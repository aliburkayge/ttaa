import { getCeviriSupabase } from "./supabase";
import { normalizeForMatch } from "./normalize";
import type { TermRow } from "./termbase";

export type ConceptScope = { scopeType: "global" | "sector" | "client"; scopeId: string | null };

export type VariantInsert = {
  lang: string;
  text: string;
  normalized: string;
  is_preferred: boolean;
  is_forbidden: boolean;
  notes: string | null;
  example: string | null;
};

export function toVariantInserts(row: TermRow): VariantInsert[] {
  return row.entries.map((entry) => ({
    lang: entry.lang,
    text: entry.text,
    normalized: normalizeForMatch(entry.text, entry.lang),
    is_preferred: !row.forbidden,
    is_forbidden: row.forbidden,
    notes: entry.notes,
    example: entry.example,
  }));
}

export async function importTermRows(
  rows: TermRow[],
  context: { scope: ConceptScope; importId: string },
): Promise<{ concepts: number; variants: number }> {
  if (rows.length === 0) return { concepts: 0, variants: 0 };
  const supabase = getCeviriSupabase();

  const { data: concepts, error: conceptError } = await supabase
    .from("term_concepts")
    .insert(rows.map((row) => ({
      scope_type: context.scope.scopeType,
      scope_id: context.scope.scopeId,
      domain: row.domain,
      subdomain: row.subdomain,
      definition: row.definition,
      import_id: context.importId,
    })))
    .select("id");

  if (conceptError) throw new Error(`term_concepts insert failed: ${conceptError.message}`);
  if (!concepts || concepts.length !== rows.length) {
    throw new Error(`Expected ${rows.length} concepts, got ${concepts?.length ?? 0}.`);
  }

  const variants = rows.flatMap((row, index) =>
    toVariantInserts(row).map((variant) => ({ ...variant, concept_id: concepts[index].id })));

  const { error: variantError } = await supabase.from("term_variants").insert(variants);
  if (variantError) throw new Error(`term_variants insert failed: ${variantError.message}`);

  return { concepts: concepts.length, variants: variants.length };
}

export type TermHit = {
  conceptId: string;
  scopeType: string;
  sourceText: string;
  targetText: string;
  isForbidden: boolean;
  notes: string | null;
};

/** client beats sector beats global (spec 5.1). */
export function scopeRank(scopeType: string): number {
  if (scopeType === "client") return 3;
  if (scopeType === "sector") return 2;
  return 1;
}

/**
 * Forbidden terms are never suppressed - every one of them must reach QA.
 * Preferred terms compete per source word, and the narrowest scope wins.
 */
export function pickWinners(hits: TermHit[]): { preferred: TermHit[]; forbidden: TermHit[] } {
  const forbidden = hits.filter((hit) => hit.isForbidden);
  const best = new Map<string, TermHit>();

  for (const hit of hits) {
    if (hit.isForbidden) continue;
    const key = hit.sourceText.toLowerCase();
    const current = best.get(key);
    if (!current || scopeRank(hit.scopeType) > scopeRank(current.scopeType)) best.set(key, hit);
  }

  return { preferred: [...best.values()], forbidden };
}

export async function lookupTerms(query: {
  sourceText: string;
  sourceLang: string;
  targetLang: string;
  clientId?: string | null;
  sectorId?: string | null;
}): Promise<{ preferred: TermHit[]; forbidden: TermHit[] }> {
  const { data, error } = await getCeviriSupabase().rpc("lookup_terms", {
    p_text: normalizeForMatch(query.sourceText, query.sourceLang),
    p_source_lang: query.sourceLang,
    p_target_lang: query.targetLang,
    p_client_id: query.clientId ?? null,
    p_sector_id: query.sectorId ?? null,
  });

  if (error) throw new Error(`lookup_terms failed: ${error.message}`);

  const hits: TermHit[] = (data ?? []).map((row: Record<string, unknown>) => ({
    conceptId: row.concept_id as string,
    scopeType: row.scope_type as string,
    sourceText: row.source_text as string,
    targetText: row.target_text as string,
    isForbidden: row.is_forbidden as boolean,
    notes: (row.notes as string | null) ?? null,
  }));

  return pickWinners(hits);
}
