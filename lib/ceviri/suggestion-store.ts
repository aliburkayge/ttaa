import { getCeviriSupabase } from "./supabase";
import { addClientTerm } from "./clients";
import { termForm, termKey, type EditObservation } from "./edit-learning";
import { normalizeForMatch } from "./normalize";
import { generalCheck, mineTerms, type TermPair } from "./term-mining";

/**
 * Firmanın terim önerileri (spec 5.5, 5.6): bellekten çıkarılanlar ve
 * inceleme düzeltmelerinden gözlenenler. Kabul edilen öneri firmanın
 * terimcesine girer; reddedilen bir daha önerilmez (tekil anahtar).
 */
export type Suggestion = {
  id: string;
  source_lang: string;
  target_lang: string;
  source_text: string;
  target_text: string;
  kind: "extracted" | "edit" | "conflict";
  score: number;
  evidence: Array<{ source: string; target: string; from?: string; document?: string }>;
  status: string;
};

const PAGE = 1000;
const MAX_ROWS = 20000;

/** PostgREST en çok 1000 satır döndürür; sayfa sayfa okunur. */
async function readAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

type TermRow = { scope_type: string; scope_id: string | null; source_text: string; target_text: string; is_forbidden: boolean };

/**
 * Firma belleğinden terim çıkarır. Firmanın terimcesinde zaten olan atlanır;
 * firma genel terimcenin karşılığını kullanıyorsa atlanır (`generalCheck`),
 * gerçekten başka çeviriyorsa "firma farkı" (conflict) olur.
 */
export async function runMining(clientId: string, langs: { source: string; target: string }): Promise<{ mined: number; conflicts: number }> {
  const supabase = getCeviriSupabase();
  const own = await readAll<{ source_text: string; target_text: string }>((from, to) =>
    supabase
      .from("tm_segments")
      .select("source_text, target_text")
      .eq("client_id", clientId)
      .eq("source_lang", langs.source)
      .eq("target_lang", langs.target)
      .order("id")
      .range(from, to),
  );
  const general = await readAll<{ source_text: string }>((from, to) =>
    supabase.from("tm_segments").select("source_text").is("client_id", null).eq("source_lang", langs.source).order("id").range(from, to),
  );

  const firm: TermPair[] = own.map((row) => ({ source: row.source_text, target: row.target_text }));
  const mined = mineTerms(
    firm,
    general.map((row) => row.source_text),
    langs,
  );

  const same = (a: string, b: string, lang: string) => normalizeForMatch(a, lang) === normalizeForMatch(b, lang);
  const compare = generalCheck(firm, langs);
  const rows: Array<Record<string, unknown>> = [];
  let conflicts = 0;
  for (let i = 0; i < mined.length; i += 10) {
    const batch = mined.slice(i, i + 10);
    const lookups = await Promise.all(
      batch.map(async (term) => {
        const { data, error } = await supabase.rpc("lookup_terms_scoped", {
          p_text: normalizeForMatch(term.source, langs.source),
          p_source_lang: langs.source,
          p_target_lang: langs.target,
          p_client_ids: [clientId],
          p_sector_id: null,
        });
        if (error) throw new Error(`lookup_terms_scoped failed: ${error.message}`);
        return ((data ?? []) as TermRow[]).filter((hit) => !hit.is_forbidden && same(hit.source_text, term.source, langs.source));
      }),
    );
    batch.forEach((term, index) => {
      const hits = lookups[index];
      if (hits.some((hit) => hit.scope_type === "client" && hit.scope_id === clientId)) return; // firmada zaten var
      const generalTargets = hits.filter((hit) => hit.scope_type === "global").map((hit) => hit.target_text);
      const verdict = compare(term, generalTargets);
      if (verdict === "same") return; // firma genel terimi kullanıyor
      const kind = verdict === "differs" ? "conflict" : "extracted";
      if (kind === "conflict") conflicts += 1;
      rows.push({
        client_id: clientId,
        source_lang: langs.source,
        target_lang: langs.target,
        source_text: term.source,
        target_text: term.target,
        kind,
        score: Number((term.g2 * term.dice).toFixed(2)),
        // Firma farkında genel terimcenin karşılığı da saklanır (`from`): ekranda yan yana görünür.
        evidence: kind === "conflict" ? term.examples.map((example) => ({ ...example, from: generalTargets[0] })) : term.examples,
      });
    });
  }
  if (rows.length) {
    const { error } = await supabase
      .from("term_suggestions")
      .upsert(rows, { onConflict: "client_id,source_lang,target_lang,source_text,target_text", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  return { mined: rows.length, conflicts };
}

/** Bekleyen öneriler; düzeltme gözlemleri ancak ikinci kez görülünce listelenir (spec 5.6). */
export async function listSuggestions(clientId: string): Promise<Suggestion[]> {
  const { data, error } = await getCeviriSupabase()
    .from("term_suggestions")
    .select("id, source_lang, target_lang, source_text, target_text, kind, score, evidence, status")
    .eq("client_id", clientId)
    .eq("status", "pending")
    .order("score", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Suggestion[]).filter((suggestion) => suggestion.kind !== "edit" || suggestion.evidence.length >= 2);
}

/** Kabul: terim (gerekirse düzeltilmiş karşılıkla) firmanın terimcesine girer. */
export async function decideSuggestion(clientId: string, id: string, action: "accept" | "reject", targetText?: string): Promise<void> {
  const supabase = getCeviriSupabase();
  const { data: suggestion, error } = await supabase
    .from("term_suggestions")
    .select("id, source_lang, target_lang, source_text, target_text, status")
    .eq("id", id)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!suggestion) throw new Error("Öneri bulunamadı.");
  if (suggestion.status !== "pending") return;
  if (action === "accept") {
    await addClientTerm(clientId, {
      sourceLang: suggestion.source_lang,
      targetLang: suggestion.target_lang,
      sourceText: suggestion.source_text,
      targetText: targetText?.trim() || suggestion.target_text,
    });
  }
  const { error: statusError } = await supabase
    .from("term_suggestions")
    .update({ status: action === "accept" ? "accepted" : "rejected" })
    .eq("id", id);
  if (statusError) throw new Error(statusError.message);
}

/**
 * Düzeltme gözlemini firmanın öneri kaydına ekler. Aynı kaynak terim için
 * kökü aynı karşılık ("Ruhsatı" ~ "ruhsat") tek öneride kanıt olarak birikir;
 * öneride en kısa (en az çekimli) biçim gösterilir. Bellekten çıkarılmış aynı
 * öneri varsa düzeltme ona kanıt olur.
 */
export async function recordEdit(input: {
  clientId: string;
  sourceLang: string;
  targetLang: string;
  observation: EditObservation;
  source: string;
  after: string;
  documentId: string;
}): Promise<void> {
  const supabase = getCeviriSupabase();
  const to = termForm(input.observation.to, input.targetLang);
  if (!to) return;
  const { data: rows, error } = await supabase
    .from("term_suggestions")
    .select("id, target_text, kind, evidence, status")
    .eq("client_id", input.clientId)
    .eq("source_lang", input.sourceLang)
    .eq("target_lang", input.targetLang)
    .eq("source_text", input.observation.sourceTerm);
  if (error) throw new Error(error.message);
  const key = termKey(to, input.targetLang);
  const existing = ((rows ?? []) as Array<{ id: string; target_text: string; kind: string; evidence: Suggestion["evidence"]; status: string }>).find(
    (row) => termKey(row.target_text, input.targetLang) === key,
  );
  const evidence = { source: input.source, target: input.after, from: input.observation.from, document: input.documentId };

  if (!existing) {
    const { error: insertError } = await supabase.from("term_suggestions").insert({
      client_id: input.clientId,
      source_lang: input.sourceLang,
      target_lang: input.targetLang,
      source_text: input.observation.sourceTerm,
      target_text: to,
      kind: "edit",
      score: 1,
      evidence: [evidence],
    });
    if (insertError && insertError.code !== "23505") throw new Error(insertError.message);
    return;
  }
  if (existing.status !== "pending") return;
  if (existing.evidence.some((each) => each.document === input.documentId && each.source === input.source)) return;
  const update: Record<string, unknown> = { evidence: [...existing.evidence, evidence] };
  if (existing.kind === "edit") {
    update.score = existing.evidence.length + 1;
    if (to.length < existing.target_text.length) update.target_text = to;
  }
  let { error: updateError } = await supabase.from("term_suggestions").update(update).eq("id", existing.id);
  if (updateError?.code === "23505") {
    // Kısa biçim başka bir satırda zaten var: yalnız kanıt eklenir.
    delete update.target_text;
    ({ error: updateError } = await supabase.from("term_suggestions").update(update).eq("id", existing.id));
  }
  if (updateError) throw new Error(updateError.message);
}
