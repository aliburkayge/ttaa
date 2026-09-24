import { getCeviriSupabase } from "./supabase";
import { listClients } from "./clients";
import { nameHits, nameReliability } from "./detect-client";
import { buildSignatures, type SignatureDoc } from "./signatures";

/**
 * Parmak izini bütün bellekten yeniden kurar ve `client_signatures`'a yazar.
 * Belge birimi proje adıdır (eski arşiv) ya da referans/düzeltme için
 * "firma:köken" grubu. Kaynak metin yeterli: ürün adları ve kodlar iki
 * tarafta da aynıdır.
 */
export async function rebuildSignatures(): Promise<{ signatures: number; documents: number; nameWeights: Record<string, number> }> {
  const supabase = getCeviriSupabase();
  const groups = new Map<string, { texts: string[]; tally: Map<string, number> }>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("tm_segments")
      .select("source_text, project_names, client_id, origin")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{ source_text: string; project_names: string[]; client_id: string | null; origin: string }>) {
      const key = row.origin === "tmx-import" ? `p:${row.project_names[0] ?? "-"}` : `o:${row.client_id ?? "-"}:${row.origin}`;
      let group = groups.get(key);
      if (!group) groups.set(key, (group = { texts: [], tally: new Map() }));
      // Aynı projede ortak (firmasız) satırlar da olur: grubun firması firmalı satırların çoğunluğu.
      if (row.client_id) group.tally.set(row.client_id, (group.tally.get(row.client_id) ?? 0) + 1);
      group.texts.push(row.source_text);
    }
    if (!data || data.length < PAGE) break;
  }
  const docs: SignatureDoc[] = [...groups.values()].map((group) => ({
    clientId: [...group.tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    texts: group.texts,
  }));
  const signatures = buildSignatures(docs);
  const { error: clearError } = await supabase.from("client_signatures").delete().neq("token", "");
  if (clearError) throw new Error(clearError.message);
  for (let i = 0; i < signatures.length; i += 1000) {
    const { error } = await supabase
      .from("client_signatures")
      .insert(signatures.slice(i, i + 1000).map((s) => ({ client_id: s.clientId, token: s.token, weight: s.weight, rows: s.rows })));
    if (error) throw new Error(error.message);
  }

  // Adın güvenilirliği: firması bilinen belgelerde adı geçen firmanın gerçekten müşteri olma oranı.
  const clients = await listClients();
  const reliability = nameReliability(docs.map((doc) => ({ clientId: doc.clientId, names: nameHits(doc.texts.join("\n"), clients) })));
  const nameWeights: Record<string, number> = {};
  for (const client of clients) {
    const weight = reliability.get(client.id) ?? 1;
    nameWeights[client.slug] = Number(weight.toFixed(3));
    const { error } = await supabase.from("clients").update({ name_weight: weight }).eq("id", client.id);
    if (error) throw new Error(error.message);
  }
  return { signatures: signatures.length, documents: groups.size, nameWeights };
}
