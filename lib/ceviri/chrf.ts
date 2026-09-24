/**
 * chrF (Popović 2015), sacrebleu'nun varsayılanıyla: karakter 1-6'lı, beta 2,
 * boşluklar sayılmaz. Çeviri kalitesini insan çevirisine benzerlikle ölçer
 * (scripts/ceviri-eval-context.ts). Türkçe gibi çekimli dillerde kelime
 * eşleşmesine dayanan BLEU'dan daha güvenilirdir.
 */

const ORDER = 6;
const BETA = 2;

function grams(text: string, n: number): Map<string, number> {
  const out = new Map<string, number>();
  const chars = [...text.replace(/\s+/g, "")];
  for (let i = 0; i + n <= chars.length; i++) {
    const gram = chars.slice(i, i + n).join("");
    out.set(gram, (out.get(gram) ?? 0) + 1);
  }
  return out;
}

/** Her derece için [çeviri n-gram sayısı, referans n-gram sayısı, eşleşen]; toplanabilir. */
export function chrfStats(hypothesis: string, reference: string): number[] {
  const stats: number[] = [];
  for (let n = 1; n <= ORDER; n++) {
    const hyp = grams(hypothesis, n);
    const ref = grams(reference, n);
    let match = 0;
    for (const [gram, count] of hyp) match += Math.min(count, ref.get(gram) ?? 0);
    const total = (map: Map<string, number>) => [...map.values()].reduce((sum, count) => sum + count, 0);
    stats.push(total(hyp), total(ref), match);
  }
  return stats;
}

/** Toplanmış istatistikten puan (0-100): iki tarafta da olan derecelerin F2 ortalaması. */
export function chrfScore(stats: number[]): number {
  let sum = 0;
  let orders = 0;
  for (let n = 0; n < ORDER; n++) {
    const [hyp, ref, match] = stats.slice(3 * n, 3 * n + 3);
    if (hyp === 0 || ref === 0) continue;
    orders++;
    const precision = match / hyp;
    const recall = match / ref;
    const factor = BETA * BETA;
    if (precision + recall > 0) sum += ((1 + factor) * precision * recall) / (factor * precision + recall);
  }
  return orders ? (100 * sum) / orders : 0;
}

export function chrf(hypothesis: string, reference: string): number {
  return chrfScore(chrfStats(hypothesis, reference));
}
