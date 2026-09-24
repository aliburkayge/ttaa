import { fold } from "./fold";

/**
 * Belgenin firmasını tahmin eder (spec 5.2). Üç ipucu: firmanın adı ve tüzel
 * adları, firma parmak izi (özgü ürün adları ve kodlar) ve belgenin
 * cümlelerinin firmanın belleğinde bulunması. Müşteriyi en iyi bellek
 * yakalar: Nase'nin belgesi Nase'nin eski belgelerine benzer, ama içinde
 * Syngenta'nın ürünü geçer. Üretici ayrıca ad eşleşmesinden bulunur.
 */

export type ClientRef = { id: string; name: string; aliases: string[] };
export type ScoredClient = {
  clientId: string;
  score: number;
  reasons: string[];
  /** Belgenin firmanın belleğinde birebir bulunan uzun cümle sayısı. */
  memory: number;
};
export type Detection = {
  decision: "auto" | "suggest" | "ask" | "manual";
  clientId: string | null;
  makerId: string | null;
  candidates: ScoredClient[];
};

/**
 * Karar eşikleri, eski arşivde 5 katlı çapraz doğrulamayla seçildi
 * (scripts/ceviri-eval-detection.ts, 23 Eylül 2026): proje adından
 * etiketlenmiş 217 projede otomatik kararların %95,7'si doğru, sor %27,6.
 * Daha düşük eşiklerde (6/2) otomatik oran %61'e çıkıyor ama doğruluk %90'a
 * iniyor; kalan hatalar dağıtıcının (Nase) üretici belgeleri.
 */
export const DETECTION = {
  auto: 20,
  autoMargin: 2,
  suggest: 3,
  suggestMargin: 1.5,
  makerHits: 2,
  /**
   * Belgenin hiçbir cümlesi firmanın belleğinde yoksa otomatik karar için
   * gereken puan. Müşteriyi en iyi bellek gösterir; yalnızca ad ve ürün
   * izine dayanan karar dağıtıcının (Nase) belgesini üreticiye yazabiliyor.
   */
  autoWithoutMemory: Infinity,
};

const flat = (text: string) => fold(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Firma adı ve takma adları, katlanmış metinde kelime sınırıyla. */
export function nameHits(text: string, clients: ClientRef[]): Map<string, number> {
  const hay = ` ${flat(text)} `;
  const hits = new Map<string, number>();
  for (const client of clients) {
    const needles = [...new Set([client.name, ...client.aliases].map(flat))].filter((needle) => needle.length >= 3);
    // Uzun ad önce sayılır ve metinden çıkarılır: "BASF Agricultural Solutions"
    // hem tam adı hem "BASF"yi saymasın.
    let rest = hay;
    let n = 0;
    for (const needle of needles.sort((a, b) => b.length - a.length)) {
      const pattern = new RegExp(`(?<=\\s)${escape(needle)}(?=\\s)`, "gu");
      n += rest.match(pattern)?.length ?? 0;
      rest = rest.replace(pattern, " ");
    }
    if (n) hits.set(client.id, n);
  }
  return hits;
}

export function signatureHits(
  tokens: string[],
  rows: Array<{ client_id: string; token: string; weight: number }>,
): Map<string, { weight: number; tokens: string[] }> {
  const present = new Set(tokens);
  const out = new Map<string, { weight: number; tokens: string[] }>();
  for (const row of rows) {
    if (!present.has(row.token)) continue;
    const entry = out.get(row.client_id) ?? { weight: 0, tokens: [] };
    entry.weight += row.weight;
    entry.tokens.push(row.token);
    out.set(row.client_id, entry);
  }
  return out;
}

export function scoreClients(evidence: {
  names: Map<string, number>;
  signature: Map<string, { weight: number; tokens: string[] }>;
  memory: Map<string, number>;
  /**
   * Firmanın adı geçtiğinde firmanın gerçekten müşteri olma oranı (0–1;
   * bkz. nameReliability). Verilmezse 1. Bayer'in adı çoğunlukla Nase'nin
   * belgelerinde geçer: ad orada müşteriyi değil üreticiyi gösterir.
   */
  nameWeight?: Map<string, number>;
}): ScoredClient[] {
  const ids = new Set([...evidence.names.keys(), ...evidence.signature.keys(), ...evidence.memory.keys()]);
  return [...ids]
    .map((clientId) => {
      const names = evidence.names.get(clientId) ?? 0;
      const signature = evidence.signature.get(clientId);
      const memory = evidence.memory.get(clientId) ?? 0;
      const reasons: string[] = [];
      if (names) reasons.push(`adı ${names} kez geçiyor`);
      if (signature?.tokens.length) reasons.push(`özgü ifade: ${signature.tokens.slice(0, 4).join(", ")}`);
      if (memory) reasons.push(`${memory} cümle firmanın belleğinde`);
      const weight = evidence.nameWeight?.get(clientId) ?? 1;
      return {
        clientId,
        score: 3 * weight * Math.min(names, 3) + Math.min(signature?.weight ?? 0, 10) + 2 * Math.min(memory, 15),
        reasons,
        memory,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Her firmanın adının "müşteri" göstergesi olarak güvenilirliği, firması
 * bilinen belgelerden: adı en az iki kez geçen belgelerin kaçı gerçekten o
 * firmanın. Az veride (Laplace) 0,5'e çekilir.
 */
export function nameReliability(
  docs: Array<{ clientId: string | null; names: Map<string, number> }>,
  minHits = DETECTION.makerHits,
): Map<string, number> {
  const seen = new Map<string, { right: number; total: number }>();
  for (const doc of docs) {
    if (!doc.clientId) continue;
    for (const [id, count] of doc.names) {
      if (count < minHits) continue;
      const entry = seen.get(id) ?? { right: 0, total: 0 };
      entry.total += 1;
      if (id === doc.clientId) entry.right += 1;
      seen.set(id, entry);
    }
  }
  return new Map([...seen].map(([id, entry]) => [id, (entry.right + 1) / (entry.total + 2)]));
}

/** Müşteri dışında adı en çok geçen firma (en az `makerHits` kez): belgedeki ürünün sahibi. */
export function makerFor(names: Map<string, number>, clientId: string | null, rules = DETECTION): string | null {
  if (!clientId) return null;
  const maker = [...names]
    .filter(([id, count]) => id !== clientId && count >= rules.makerHits)
    .sort((a, b) => b[1] - a[1])[0];
  return maker ? maker[0] : null;
}

export function decide(scored: ScoredClient[], names: Map<string, number>, rules = DETECTION): Detection {
  const [top, second] = scored;
  let decision: Detection["decision"] = "ask";
  const autoAt = top && top.memory > 0 ? rules.auto : rules.autoWithoutMemory;
  if (top && top.score >= autoAt && (!second || top.score >= rules.autoMargin * second.score)) decision = "auto";
  else if (top && top.score >= rules.suggest && (!second || top.score >= rules.suggestMargin * second.score)) decision = "suggest";
  const clientId = decision === "ask" ? null : top.clientId;
  return { decision, clientId, makerId: makerFor(names, clientId, rules), candidates: scored.slice(0, 5) };
}
