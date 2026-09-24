import { fold } from "./fold";
import { localeLower } from "./normalize";
import { stem } from "./term-mining";

/**
 * İnceleme ekranındaki düzeltmeden öğrenme (spec 5.6). Makine çevirisi ile
 * çevirmenin son hâli kelime düzeyinde karşılaştırılır; değişen aralık,
 * cümlede zorunlu tutulan bir terimin karşılığıysa "(terim → yeni karşılık)"
 * gözlemi çıkar. Aynı gözlem bir firmada ikinci kez görülünce öneri olur;
 * "Ruhsatı" ve "ruhsat" aynı gözlemdir (`termKey`).
 */

export type WordOp = { op: "same" | "del" | "ins"; text: string };
export type EditObservation = { sourceTerm: string; from: string; to: string };

const EDGE_PUNCT = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const bare = (word: string) => fold(word).replace(EDGE_PUNCT, "");

/** En uzun ortak altdiziyle kelime farkı; noktalama ve büyük/küçük harf karşılaştırmada yok sayılır. */
export function diffWords(a: string, b: string): WordOp[] {
  const x = a.split(/\s+/).filter(Boolean);
  const y = b.split(/\s+/).filter(Boolean);
  const lcs = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i][j] = bare(x[i]) === bare(y[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: WordOp[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (bare(x[i]) === bare(y[j])) {
      ops.push({ op: "same", text: y[j] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) ops.push({ op: "del", text: x[i++] });
    else ops.push({ op: "ins", text: y[j++] });
  }
  while (i < x.length) ops.push({ op: "del", text: x[i++] });
  while (j < y.length) ops.push({ op: "ins", text: y[j++] });
  return ops;
}

/** Silinip yerine yazılan aralıklar; salt ekleme ya da salt silme değişim sayılmaz. */
export function replacedSpans(before: string, after: string): Array<{ from: string; to: string }> {
  const spans: Array<{ from: string; to: string }> = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flush = () => {
    if (removed.length && added.length) {
      spans.push({ from: removed.map(bare).join(" "), to: added.join(" ").replace(EDGE_PUNCT, "") });
    }
    removed = [];
    added = [];
  };
  for (const op of diffWords(before, after)) {
    if (op.op === "same") flush();
    else if (op.op === "del") removed.push(op.text);
    else added.push(op.text);
  }
  flush();
  return spans;
}

/** Kök anahtarı: çekim ekleri ve büyük/küçük harf farkı yok sayılır ("Ruhsatı" ~ "ruhsat"). */
export function termKey(text: string, lang: string): string {
  return text
    .split(/\s+/)
    .map(bare)
    .filter(Boolean)
    .map((word) => stem(word, lang))
    .join(" ");
}

/**
 * Sözlük yazılışı: kenar noktalaması atılır, kelimeler küçük harfe iner;
 * kısaltma (≤5 harf, tümü büyük: "CIPAC") ve iç büyük harfli kelime ("pH")
 * olduğu gibi kalır.
 */
export function termForm(text: string, lang: string): string {
  return text
    .replace(EDGE_PUNCT, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const letters = word.match(/\p{L}/gu) ?? [];
      const allCaps = word === word.toLocaleUpperCase(lang) && letters.length >= 2;
      if ((allCaps && letters.length <= 5) || (!allCaps && /\p{Lu}/u.test(word.slice(1)))) return word;
      return localeLower(word, lang);
    })
    .join(" ");
}

/** Zorunlu terimin cümledeki karşılığı değiştirildiyse gözlem. `lang` hedef dildir. */
export function observeEdits(input: {
  source: string;
  before: string;
  after: string;
  terms: Array<{ sourceText: string; targetText: string }>;
  lang: string;
}): EditObservation[] {
  const source = ` ${fold(input.source).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const observations: EditObservation[] = [];
  for (const span of replacedSpans(input.before, input.after)) {
    const fromStems = termKey(span.from, input.lang).split(" ");
    for (const term of input.terms) {
      const sourceTerm = fold(term.sourceText).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      if (!sourceTerm || !source.includes(` ${sourceTerm} `)) continue;
      const termStems = termKey(term.targetText, input.lang).split(" ");
      if (!termStems.every((each) => fromStems.includes(each))) continue;
      observations.push({ sourceTerm: term.sourceText, from: term.targetText, to: span.to });
    }
  }
  return observations;
}
