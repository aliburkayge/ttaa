/**
 * Referans çiftlerinin hizalanması (spec 5.4): bir firmanın eski kaynak
 * belgesi ile çevirisinin paragrafları eşlenir, eşlenen çiftler firmanın
 * belleğine girer.
 *
 * Gale-Church (1993) dinamik programlaması: paragrafların karakter
 * uzunlukları çevirinin uzunluk oranıyla karşılaştırılır; izin verilen
 * eşleşmeler 1-1, 1-0, 0-1, 2-1, 1-2. Buna çapa eklenir: sayılar, kodlar,
 * e-posta ve bağlantılar çeviride aynen kalır; iki tarafta aynı çapayı
 * taşıyan paragraflar birbirine çekilir, çapası tutmayan itilir.
 */

export type Bead = { source: number[]; target: number[]; cost: number; confidence: "high" | "medium" | "low" };

const PRIORS: Record<string, number> = { "1-1": 0.89, "1-0": 0.0099, "0-1": 0.0099, "2-1": 0.0445, "1-2": 0.0445 };
const MOVES: Array<[number, number]> = [
  [1, 1],
  [1, 0],
  [0, 1],
  [2, 1],
  [1, 2],
];
/** Çapa başına maliyet (nats): ortak çapa çeker, eşsiz çapa iter. */
const SHARED = -1.2;
const MISSING = 0.9;

function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Uzunluk uyumsuzluğunun maliyeti: -log P(|δ|). */
export function lengthCost(l1: number, l2: number, ratio: number, variance: number): number {
  if (l1 === 0 && l2 === 0) return 0;
  const mean = (l1 + l2 / ratio) / 2;
  const delta = (l2 - l1 * ratio) / Math.sqrt(Math.max(mean, 1) * variance);
  const p = 2 * (1 - normalCdf(Math.abs(delta)));
  return -Math.log(Math.max(p, 1e-12));
}

const ANCHOR = /https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.-]+|\b[A-Z]{1,4}[\s-]?\d{2,}(?:[\s-]\d{2,3}){0,2}(?:\s?[A-Z]\b)?|\d+(?:[.,]\d+)*/g;

/** Çeviride aynen kalması gereken parçalar; ondalık işareti ve boşluklar birleştirilir. */
export function anchors(text: string): string[] {
  return (text.match(ANCHOR) ?? []).map((raw) => {
    if (/^https?:|@/.test(raw)) return raw.replace(/[.,;:)]+$/, "");
    if (/^\d/.test(raw)) return raw.replace(/,/g, ".");
    return raw.replace(/[\s-]/g, "");
  });
}

function anchorCost(a: string[], b: string[]): { cost: number; missing: number } {
  if (!a.length && !b.length) return { cost: 0, missing: 0 };
  const left = new Map<string, number>();
  for (const item of a) left.set(item, (left.get(item) ?? 0) + 1);
  let shared = 0;
  for (const item of b) {
    const n = left.get(item) ?? 0;
    if (n > 0) {
      shared += 1;
      left.set(item, n - 1);
    }
  }
  const missing = a.length + b.length - 2 * shared;
  return { cost: SHARED * shared + MISSING * missing, missing };
}

export function align(source: string[], target: string[], options: { ratio?: number; variance?: number } = {}): Bead[] {
  const n = source.length;
  const m = target.length;
  const totalSource = source.reduce((sum, s) => sum + s.length, 0);
  const totalTarget = target.reduce((sum, s) => sum + s.length, 0);
  const ratio = options.ratio ?? ((totalSource ? totalTarget / totalSource : 1) || 1);
  const variance = options.variance ?? 6.8;
  const sourceAnchors = source.map(anchors);
  const targetAnchors = target.map(anchors);

  const width = m + 1;
  const cost = new Float64Array((n + 1) * width).fill(Infinity);
  const back = new Int8Array((n + 1) * width).fill(-1);
  cost[0] = 0;

  const beadCost = (i: number, j: number, di: number, dj: number) => {
    let l1 = 0;
    let l2 = 0;
    const a: string[] = [];
    const b: string[] = [];
    for (let k = i - di; k < i; k++) {
      l1 += source[k].length;
      a.push(...sourceAnchors[k]);
    }
    for (let k = j - dj; k < j; k++) {
      l2 += target[k].length;
      b.push(...targetAnchors[k]);
    }
    const anchor = anchorCost(a, b);
    const lc = lengthCost(l1, l2, ratio, variance);
    return { total: lc - Math.log(PRIORS[`${di}-${dj}`]) + anchor.cost, length: lc, missing: anchor.missing };
  };

  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (i === 0 && j === 0) continue;
      let best = Infinity;
      let move = -1;
      MOVES.forEach(([di, dj], index) => {
        if (i < di || j < dj) return;
        const previous = cost[(i - di) * width + (j - dj)];
        if (!Number.isFinite(previous)) return;
        const total = previous + beadCost(i, j, di, dj).total;
        if (total < best) {
          best = total;
          move = index;
        }
      });
      cost[i * width + j] = best;
      back[i * width + j] = move;
    }
  }

  const beads: Bead[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const [di, dj] = MOVES[back[i * width + j]];
    const detail = beadCost(i, j, di, dj);
    const paired = di > 0 && dj > 0;
    // Birleştirme (2-1, 1-2) kısa paragraflarda yanıltıcıdır: çeviriye eklenmiş
    // bir not ya da "[İMZA]" satırı komşu paragrafa yapıştırılabiliyor. Bu
    // eşleşmeler en çok orta güvenlidir; belleğe girmeden önce doğrulatılır.
    const merged = di > 1 || dj > 1;
    const confidence: Bead["confidence"] = !paired
      ? "low"
      : detail.length < 2.5 && detail.missing === 0 && !merged
        ? "high"
        : detail.length < 6 && detail.missing <= 1
          ? "medium"
          : "low";
    beads.push({
      source: Array.from({ length: di }, (_, k) => i - di + k),
      target: Array.from({ length: dj }, (_, k) => j - dj + k),
      cost: detail.total,
      confidence,
    });
    i -= di;
    j -= dj;
  }
  return beads.reverse();
}

/** Belleğe girmeye aday çiftler: düşük güvenli ve tek taraflı eşleşmeler atılır. */
export function alignedPairs(
  beads: Bead[],
  source: string[],
  target: string[],
): Array<{ source: string; target: string; confidence: "high" | "medium" }> {
  return beads
    .filter((bead) => bead.confidence !== "low" && bead.source.length && bead.target.length)
    .map((bead) => ({
      source: bead.source.map((k) => source[k]).join(" "),
      target: bead.target.map((k) => target[k]).join(" "),
      confidence: bead.confidence as "high" | "medium",
    }));
}
