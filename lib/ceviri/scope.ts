import type { TermHit } from "./term-store";

/**
 * Bir belgenin kapsam zinciri (spec 5.1): müşteri → üretici → sektör → genel.
 * Müşteri işi getiren firmadır (Nase); üretici belgede ürünü geçen firmadır
 * (Syngenta). Eski arşivde Nase projelerinin metninde en çok Bayer ve Syngenta
 * geçiyordu: ikisi ayrı şeylerdir.
 */
export type ScopeChain = { clientId: string | null; makerId: string | null; sectorId: string | null };

export const NO_SCOPE: ScopeChain = { clientId: null, makerId: null, sectorId: null };

/** Veritabanına gidecek firma listesi, öncelik sırasıyla ve tekil. */
export function chainClientIds(chain: ScopeChain): string[] {
  return [...new Set([chain.clientId, chain.makerId].filter((id): id is string => Boolean(id)))];
}

/** 4 müşteri, 3 üretici, 2 sektör, 1 genel; zincirde olmayan firma/sektör 0. */
export function termRank(hit: { scopeType: string; scopeId?: string | null }, chain: ScopeChain): number {
  if (hit.scopeType === "client") {
    if (hit.scopeId && hit.scopeId === chain.clientId) return 4;
    if (hit.scopeId && hit.scopeId === chain.makerId) return 3;
    return 0;
  }
  if (hit.scopeType === "sector") return hit.scopeId && hit.scopeId === chain.sectorId ? 2 : 0;
  return 1;
}

export type ScopedTerms = {
  preferred: TermHit[];
  forbidden: TermHit[];
  /** Daha dar kapsamın başka karşılık seçtiği terimler: prompt'ta "X değil" diye yazılır. */
  replaced: Array<{ term: TermHit; by: TermHit }>;
};

const keyOf = (text: string) => text.toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();

/**
 * Her kaynak ifade için zincirde en üstteki kapsamın karşılığı kazanır. Kaybeden
 * farklı karşılık yasaklı sayılmaz (aynı kelime cümlenin başka yerinde doğru
 * olabilir), `replaced` olarak prompt'a "bunu değil" diye gider. Yasaklı bir
 * karşılık, daha üst kapsam tam o karşılığı tercih etmedikçe yasaklı kalır.
 */
export function pickScoped(hits: TermHit[], chain: ScopeChain): ScopedTerms {
  const usable = hits.filter((hit) => termRank(hit, chain) > 0);
  const best = new Map<string, TermHit>();
  for (const hit of usable) {
    if (hit.isForbidden) continue;
    const key = keyOf(hit.sourceText);
    const current = best.get(key);
    if (!current || termRank(hit, chain) > termRank(current, chain)) best.set(key, hit);
  }

  const replaced = new Map<string, { term: TermHit; by: TermHit }>();
  for (const hit of usable) {
    if (hit.isForbidden) continue;
    const winner = best.get(keyOf(hit.sourceText));
    if (!winner || winner === hit) continue;
    if (termRank(hit, chain) >= termRank(winner, chain)) continue;
    if (keyOf(hit.targetText) === keyOf(winner.targetText)) continue;
    replaced.set(`${keyOf(hit.sourceText)}\u0000${keyOf(hit.targetText)}`, { term: hit, by: winner });
  }

  const forbidden = usable.filter((hit) => {
    if (!hit.isForbidden) return false;
    const winner = best.get(keyOf(hit.sourceText));
    return !(winner && keyOf(winner.targetText) === keyOf(hit.targetText) && termRank(winner, chain) > termRank(hit, chain));
  });

  return { preferred: [...best.values()], forbidden, replaced: [...replaced.values()] };
}

/** Bellek sıralamasında kapsam payları (spec 5.1); SQL'deki search_tm_scoped ile aynı. */
export const SCOPE_BONUS = { client: 0.06, maker: 0.04, sector: 0.02, trusted: 0.03 };

export function adjustedScore(
  match: { score: number; client_id?: string | null; sector_id?: string | null; origin: string },
  chain: ScopeChain,
): number {
  let bonus = 0;
  if (match.client_id && match.client_id === chain.clientId) bonus += SCOPE_BONUS.client;
  else if (match.client_id && match.client_id === chain.makerId) bonus += SCOPE_BONUS.maker;
  if (chain.sectorId && match.sector_id === chain.sectorId) bonus += SCOPE_BONUS.sector;
  if (match.origin === "human-approved" || match.origin === "reference") bonus += SCOPE_BONUS.trusted;
  return match.score + bonus;
}
