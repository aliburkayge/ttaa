import { getCeviriSupabase } from "./supabase";
import { listClients } from "./clients";
import { tokensOf } from "./fold";
import { memoryLangs } from "./languages";
import { segmentHash } from "./normalize";
import { decide, makerFor, nameHits, scoreClients, signatureHits, type Detection } from "./detect-client";

/**
 * Belgenin metninden kanıt toplar ve kararı verir (spec 5.2). `chosen`
 * verilirse müşteri elle seçilmiştir: karar "manual" olur, üretici yine
 * belgeden bulunur.
 */
export async function detectForDocument(texts: string[], sourceLang: string, chosen: string | null = null): Promise<Detection> {
  const supabase = getCeviriSupabase();
  const clients = await listClients();
  const names = nameHits(texts.join("\n"), clients);

  const tokens = [...new Set(texts.flatMap(tokensOf))];
  const signatureRows: Array<{ client_id: string; token: string; weight: number }> = [];
  for (let i = 0; i < tokens.length; i += 300) {
    const { data, error } = await supabase
      .from("client_signatures")
      .select("client_id, token, weight")
      .in("token", tokens.slice(i, i + 300));
    if (error) throw new Error(error.message);
    signatureRows.push(...((data ?? []) as typeof signatureRows));
  }

  // Bellek örtüşmesi: belgenin uzun cümlelerinden kaçı bir firmanın belleğinde birebir var.
  const long = texts.filter((text) => text.trim().length >= 30);
  const hashes = [...new Set(memoryLangs(sourceLang).flatMap((lang) => long.map((text) => segmentHash(text, lang))))];
  const seen = new Map<string, Set<string>>();
  for (let i = 0; i < hashes.length; i += 200) {
    const { data, error } = await supabase
      .from("tm_segments")
      .select("client_id, source_hash")
      .in("source_hash", hashes.slice(i, i + 200))
      .not("client_id", "is", null);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{ client_id: string; source_hash: string }>) {
      const set = seen.get(row.client_id) ?? new Set<string>();
      set.add(row.source_hash);
      seen.set(row.client_id, set);
    }
  }
  const memory = new Map([...seen].map(([id, set]) => [id, set.size]));

  const nameWeight = new Map(clients.map((client) => [client.id, client.name_weight ?? 1]));
  const scored = scoreClients({ names, signature: signatureHits(tokens, signatureRows), memory, nameWeight });
  if (chosen) return { decision: "manual", clientId: chosen, makerId: makerFor(names, chosen), candidates: scored.slice(0, 5) };
  return decide(scored, names);
}
