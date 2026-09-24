/**
 * Firma adı ve parmak izi karşılaştırmaları için kelime katlama.
 *
 * Küçük harfe çevirmede "İ" → "i" + U+0307 (birleşik nokta) olur; nokta atılır ve "ı" da
 * "i" sayılır. Büyük harfli Türkçe başlıklar ("GEREKLİLİK", "DEPOLANMASI")
 * böylece küçük yazılmış hâlleriyle aynı kelimeye düşer; eski arşiv
 * taramasında hiç küçük harfle görülmedikleri için özel ad sanılıyorlardı.
 */
/** Küçük "İ"nin ardındaki birleşik nokta (U+0307). */
const COMBINING_DOT = new RegExp(String.fromCharCode(0x0307), "g");

export function fold(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_DOT, "")
    .normalize("NFC")
    .replace(/ı/g, "i")
    .replace(/\s+/g, " ")
    .trim();
}

const WORD = /[\p{L}][\p{L}\p{N}-]{3,}/gu;
/** Ürün ve ruhsat kodları: "BAS 703 07 F", "EC 1107", "A20570A". */
const CODE = /\b[A-Z]{1,4}[\s-]?\d{2,5}(?:[\s-]\d{2,3}){0,2}(?:\s?[A-Z])?\b/g;

/** Metindeki kelimeler (4+ harf) ve kodlar, katlanmış ve tekil. */
export function tokensOf(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.match(WORD) ?? []) out.add(fold(match));
  for (const match of text.match(CODE) ?? []) out.add(fold(match));
  return [...out];
}

export type CaseCounts = { proper: Map<string, number>; all: Map<string, number> };

/**
 * Her kelimenin kaç kez geçtiği ve kaçında "özel ad gibi" yazıldığı: cümle
 * ortasında büyük harfle başlıyor, tamamen büyük harfli ya da rakam içeriyor.
 */
export function countCase(texts: Iterable<string>, into?: CaseCounts): CaseCounts {
  const counts = into ?? { proper: new Map(), all: new Map() };
  for (const text of texts) {
    for (const match of text.matchAll(WORD)) {
      const word = match[0];
      const key = fold(word);
      const coded = /\d/.test(word) || (word.length >= 3 && word === word.toUpperCase() && /\p{Lu}/u.test(word));
      // Cümle başı: önünde yalnızca boşluk/noktalama ya da cümle sonu işareti
      // var. Oradaki büyük harf kelime hakkında bilgi taşımaz; sayılmaz.
      const before = text.slice(0, match.index);
      const initial = !/[\p{L}\p{N}]/u.test(before) || /[.!?:;]\s*["'“(]?\s*$/u.test(before);
      if (initial && !coded) continue;
      counts.all.set(key, (counts.all.get(key) ?? 0) + 1);
      if (coded || /^\p{Lu}/u.test(word)) counts.proper.set(key, (counts.proper.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Ürün adı ve kod cümle ortasında da büyük harfle yazılır (Touchdown, AMPLIGO,
 * BAS 703 07 F); sıradan kelime ("workplace") çoğunlukla küçük harflidir.
 * Taramada bu şart olmadan "workplace", "patient" gibi kelimeler firma izi
 * sayılmış, tıbbi bir epikriz Syngenta'ya atanmıştı.
 */
export function isProper(token: string, counts: CaseCounts): boolean {
  if (/\d/.test(token)) return true;
  const all = counts.all.get(token) ?? 0;
  return all >= 2 && (counts.proper.get(token) ?? 0) >= 0.8 * all;
}
