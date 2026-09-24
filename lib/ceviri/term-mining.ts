import { fold } from "./fold";
import { localeLower } from "./normalize";

/**
 * Referans çiftlerinden ve firmanın belleğinden terim çıkarma (spec 5.5).
 *
 * 1. Aday kaynak ifade: firmada sık, genel derlemde nadir 1–4 kelimelik ifade
 *    (Dunning log-olabilirlik, G² ≥ 10,83 → p < 0,001).
 * 2. Karşılık: adayı içeren hizalı cümlelerin hedef tarafındaki ifadeler,
 *    birlikte görülme sıklığına göre Dice katsayısıyla. Sayım kaba kök
 *    üzerinden (`stem`): "partiden", "partilerin" ve "parti" aynı karşılık.
 * 3. Rekabetçi eşleme: güçlü terim karşılığının kelimelerini sahiplenir,
 *    zayıf olan sahiplenilmemiş ilk karşılığına iner.
 * Elenenler: çevrilmeden kalan adlar/kodlar, sayılı ifadeler, işlev
 * kelimeli cümle parçaları; kalıp cümleler bir kez sayılır.
 */

export type TermPair = { source: string; target: string };
export type MinedTerm = { source: string; target: string; g2: number; dice: number; together: number; examples: TermPair[] };

export const MINING = { minCount: 3, minG2: 10.83, minDice: 0.5, maxCandidates: 150, maxSourceN: 4, maxTargetN: 5 };

const STOP = new Set(
  (
    "a an the and or of to in on at for from by with as is are was were be been being it its this that these those " +
    "not no into than then there their they he she we you your our his her which who whom whose what when where how " +
    "all any each other such only own same so too very can will shall may must should would could has have had do does " +
    "after before during under over between within without about above below per via upon onto through against among " +
    "also both more most some again once here if but nor up out off please kindly " +
    "ve veya ile için bu şu o bir da de ki ya ise gibi daha en çok olan olarak ilgili üzere göre kadar sonra önce her lütfen " +
    "der die das und oder mit von zu den dem des ein eine"
  ).split(" "),
);

/** Terimin içinde durabilen tek işlev kelimesi ("mode of action"); öbürleri cümle parçası demek. */
const INNER = new Set(["of"]);

/** Ölçü birimleri terimin hiçbir yerinde olmaz ("mg ml test item" kalıbın ölçüsü). */
const UNITS = new Set(
  (
    "mg ml µl μl ul ng µg μg kg mm cm nm µm μm km ppm ppb ppt min sec hr hrs mol mmol µmol kda rpm psi bar mbar kpa mpa hz khz " +
    "mw kw cp cps mpas meq iu dk sn sa lt"
  ).split(" "),
);

const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

export function words(text: string, lang: string): string[] {
  return localeLower(text, lang).match(TOKEN) ?? [];
}

/** Kelimeler özgün yazılışlarıyla (öneride "CIPAC" "cıpac" olmasın). */
function surfaceWords(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

// Türkçe çekim ekleri (hâl, iyelik, çoğul), uzundan kısaya. Yapım eklerine dokunulmaz.
// Belirtme ekinin n'li biçimi yalnız iyelikten sonra gelir ("partisini",
// "saflığını"); tek başına "-nu" sayılsa "solüsyonu" → "solüsyo" olurdu.
const TR_SUFFIXES = [
  "ının", "inin", "unun", "ünün", "ları", "leri", "sını", "sini", "sunu", "sünü",
  "nın", "nin", "nun", "nün", "dan", "den", "tan", "ten", "yla", "yle", "lar", "ler", "ını", "ini", "unu", "ünü",
  "sı", "si", "su", "sü", "ın", "in", "un", "ün", "yı", "yi", "yu", "yü",
  "ya", "ye", "na", "ne", "da", "de", "ta", "te",
  "ı", "i", "u", "ü", "a", "e",
];
// Ek alınınca yumuşayan son ünsüz geri sertleşir: "saflığ" → "saflık", "sonuc" → "sonuç".
const HARDEN: Record<string, string> = { ğ: "k", b: "p", c: "ç", d: "t" };

/** Kaba Türkçe kök: en çok üç tur ek atılır, kök dört harfin altına inmez. */
function turkishRoot(word: string): string {
  let root = word;
  for (let pass = 0; pass < 3; pass++) {
    const suffix = TR_SUFFIXES.find((each) => root.endsWith(each) && root.length - each.length >= 4);
    if (!suffix) break;
    root = root.slice(0, -suffix.length);
  }
  if (root === word) return word;
  const last = root[root.length - 1];
  return HARDEN[last] ? root.slice(0, -1) + HARDEN[last] : root;
}

/**
 * Sayım anahtarı: Türkçede önce ekler atılır, sonra (her dilde) 7+ harfli
 * kelimenin ilk 6 harfi alınır; "ruhsatı", "ruhsatının", "ruhsat" aynı anahtar.
 */
export function stem(word: string, lang = ""): string {
  const root = rootOf(word, lang);
  return root.length >= 7 ? root.slice(0, 6) : root;
}

/** Yalnız çekim eki atılmış kök (kesme yok): karşılaştırmada "teslimat" ≠ "teslim". */
function rootOf(word: string, lang: string): string {
  return lang.toLowerCase().startsWith("tr") ? turkishRoot(word) : word;
}

const letters = (token: string) => (token.match(/\p{L}/gu) ?? []).length;

/** Uçlarda işlev kelimesi ya da tek harf yok ("water d"), içeride yalnız INNER; birim hiçbir yerde. */
const wellFormed = (tokens: string[]) =>
  tokens.every(
    (token, i) =>
      !UNITS.has(token) &&
      (i === 0 || i === tokens.length - 1 ? !STOP.has(token) && letters(token) !== 1 : !STOP.has(token) || INNER.has(token)),
  );

/**
 * Kaynak aday: rakamlı kelime içermiyor ("30 5 at 20", suş/parti kodu
 * "fzb24"), en az bir kelimesi 4+ harfli ("g l", "min" birim ya da kırıntı).
 */
const usableSource = (tokens: string[]) =>
  wellFormed(tokens) && !tokens.some((token) => /\p{N}/u.test(token)) && tokens.some((token) => letters(token) >= 4);

/**
 * Hedef karşılık: iki harfli Türkçe kelimeler de karşılık olabilir ("water" →
 * "su"); rakamlı kelime olamaz ("MT 75", "95'ten": kalıbın sayısı, terim değil).
 */
const usableTarget = (tokens: string[]) =>
  wellFormed(tokens) && !tokens.some((token) => /\p{N}/u.test(token)) && tokens.some((token) => letters(token) >= 2);

/**
 * Sözlük yazılışı: kelime bir yerde küçük harfle geçiyorsa küçük harf.
 * Kısaltma iki dilde aynıdır: büyük harfli kelime kaynak ifadede de varsa
 * ("CIPAC", "DPP") ya da iç büyük harfliyse ("pH") olduğu gibi kalır;
 * başlıktaki "ŞEKİL", cümle başındaki "Formülasyon" küçük harfe iner.
 */
function dictionaryForm(variants: Array<[string, number]>, source: string, lang: string): string {
  const split = variants.map(([form]) => form.split(" "));
  const sourceWords = new Set(plain(source).trim().split(" "));
  return split[0]
    .map((_, i) => {
      const forms = split.map((words) => words[i]);
      const lower = localeLower(forms[0], lang);
      if (forms.some((word) => word === lower)) return lower;
      const keep = forms.find((word) => {
        const upper = word === word.toLocaleUpperCase(lang);
        return (upper && sourceWords.has(fold(word))) || (!upper && /\p{Lu}/u.test(word.slice(1)));
      });
      return keep ?? lower;
    })
    .join(" ");
}

function grams(tokens: string[], maxN: number): string[] {
  const out = new Set<string>();
  for (let n = 1; n <= maxN; n++) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const slice = tokens.slice(i, i + n);
      if (usableSource(slice)) out.add(slice.join(" "));
    }
  }
  return [...out];
}

/** Karşılaştırma biçimi: katlanmış, yalnız harf/rakam, kenarları boşluklu. */
const plain = (text: string) => ` ${fold(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

/** Çevrilmeden kalan ad ya da kod: karşılık kaynağın aynısı ya da bir parçası ("basf agro b v" → "basf agro"). */
function untranslated(source: string, target: string): boolean {
  const a = plain(source);
  const b = plain(target);
  return a.includes(b) || b.includes(a);
}

const xlogx = (observed: number, expected: number) => (observed > 0 && expected > 0 ? observed * Math.log(observed / expected) : 0);

/** Dunning G²: firmada a/c, genelde b/d oranı. */
export function logLikelihood(a: number, b: number, c: number, d: number): number {
  const e1 = (c * (a + b)) / (c + d);
  const e2 = (d * (a + b)) / (c + d);
  return 2 * (xlogx(a, e1) + xlogx(b, e2));
}

/**
 * Kaynak–karşılık bağının G²'si (2×2 tablo, N satır): kanıt miktarını da
 * tartar, kalıpta 11 kez birlikte geçen ifade 40 kez geçen terimi yenemez.
 * Beklenenden az birlikte görülme bağ değildir (0).
 */
export function association(together: number, sourceRows: number, targetRows: number, total: number): number {
  const expected = (sourceRows * targetRows) / total;
  if (together <= expected) return 0;
  const cells: Array<[number, number]> = [
    [together, expected],
    [sourceRows - together, (sourceRows * (total - targetRows)) / total],
    [targetRows - together, ((total - sourceRows) * targetRows) / total],
    [total - sourceRows - targetRows + together, ((total - sourceRows) * (total - targetRows)) / total],
  ];
  return 2 * cells.reduce((sum, [observed, e]) => sum + xlogx(observed, e), 0);
}

export function mineTerms(pairs: TermPair[], reference: string[], langs: { source: string; target: string }, rules = MINING): MinedTerm[] {
  // Kalıp cümle bellekte defalarca durur; aynı kaynak bir kez sayılır.
  const seen = new Set<string>();
  const firm = pairs.filter((pair) => {
    const key = plain(pair.source);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const sourceGrams = firm.map((pair) => grams(words(pair.source, langs.source), rules.maxSourceN));
  const df = new Map<string, number[]>();
  sourceGrams.forEach((list, index) => {
    for (const gram of list) {
      const rows = df.get(gram);
      if (rows) rows.push(index);
      else df.set(gram, [index]);
    }
  });

  const refDf = new Map<string, number>();
  for (const text of reference) {
    for (const gram of grams(words(text, langs.source), rules.maxSourceN)) {
      if (df.has(gram)) refDf.set(gram, (refDf.get(gram) ?? 0) + 1);
    }
  }
  const refTotal = Math.max(reference.length, 1);

  let candidates = [...df]
    .filter(([, rows]) => rows.length >= rules.minCount)
    .map(([gram, rows]) => {
      const a = rows.length;
      const b = refDf.get(gram) ?? 0;
      const g2 = a / firm.length > b / refTotal ? logLikelihood(a, b, firm.length, refTotal) : 0;
      return { gram, rows, g2 };
    })
    .filter((candidate) => candidate.g2 >= rules.minG2);

  // Alt ifade, kendisini içeren daha uzun ifadeyle hemen hep birlikte geçiyorsa atılır.
  candidates = candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          other.gram !== candidate.gram && ` ${other.gram} `.includes(` ${candidate.gram} `) && other.rows.length >= 0.9 * candidate.rows.length,
      ),
  );
  // Satırlarının yarısında hedefte aynen geçen ifade çevrilmeyen addır/koddur ("BASF", "CIPAC MT").
  const plainTargets = firm.map((pair) => plain(pair.target));
  candidates = candidates.filter(
    (candidate) => candidate.rows.filter((index) => plainTargets[index].includes(plain(candidate.gram))).length * 2 < candidate.rows.length,
  );
  candidates = candidates.sort((a, b) => b.g2 - a.g2).slice(0, rules.maxCandidates);

  // Hedef taraf: her çiftin kök n-gramları ve kökün yüzey biçimleri (özgün yazılış).
  const targetStems = firm.map((pair) => {
    const lower = words(pair.target, langs.target);
    const original = surfaceWords(pair.target);
    const stems = lower.map((word) => stem(word, langs.target));
    const out = new Map<string, string>();
    for (let n = 1; n <= rules.maxTargetN; n++) {
      for (let i = 0; i + n <= stems.length; i++) {
        if (!usableTarget(lower.slice(i, i + n))) continue;
        const key = stems.slice(i, i + n).join(" ");
        if (!out.has(key)) out.set(key, (original.length === lower.length ? original : lower).slice(i, i + n).join(" "));
      }
    }
    return out;
  });
  const targetDf = new Map<string, number>();
  for (const map of targetStems) for (const key of map.keys()) targetDf.set(key, (targetDf.get(key) ?? 0) + 1);

  // 1. Ham bağ: adayla her hedef ifadenin birlikte görülmesi (Dice).
  const dice = (rows: number, key: string, count: number) => (2 * count) / (rows + (targetDf.get(key) ?? 0));
  const ranked = candidates.map((candidate) => {
    const together = new Map<string, number>();
    const surfaces = new Map<string, Map<string, number>>();
    for (const index of candidate.rows) {
      for (const [key, surface] of targetStems[index]) {
        together.set(key, (together.get(key) ?? 0) + 1);
        const forms = surfaces.get(key) ?? new Map<string, number>();
        forms.set(surface, (forms.get(surface) ?? 0) + 1);
        surfaces.set(key, forms);
      }
    }
    // Bağ puanı: Dice, karşılık kaynaktan uzunsa fazla kelime başına 0,1 eksik
    // (ifade hizalamasındaki uzunluk cezası): "state" "safiyetini belirtiniz"i
    // "purity"den önce kapamaz. Eşitlikte G² (kanıtı çok olan) önde.
    // Kaynağın kopyası ("cipac purity" için "CIPAC") karşılık değildir.
    const sourceLength = candidate.gram.split(" ").length;
    const raw = new Map(
      [...together]
        .filter(([key, count]) => count >= rules.minCount && dice(candidate.rows.length, key, count) >= rules.minDice / 2)
        .filter(([key]) => ![...surfaces.get(key)!.keys()].some((surface) => untranslated(candidate.gram, surface)))
        .map(([key, count]) => {
          const length = key.split(" ").length;
          const evidence = association(count, candidate.rows.length, targetDf.get(key) ?? 0, firm.length);
          const score = dice(candidate.rows.length, key, count) - 0.1 * Math.max(0, length - sourceLength);
          return [key, { score, distance: Math.abs(length - sourceLength), evidence }] as const;
        }),
    );
    return { ...candidate, raw, surfaces };
  });

  // 2. Rekabetçi eşleme (Melamed 2000), cümle içinde: her satırda çiftler bağ
  // puanına göre sırayla bağlanır; her kaynak satırda tek karşılık alır,
  // bağlanan hedef kelimeyi iç içe olmayan ("recipe" ⊂ "secret recipe")
  // başka kaynak o satırda kullanamaz. "five representative batches ↔
  // temsili beş parti": "beş" five'ındır, "batches" o satırda "beş"i sayamaz.
  // Eş anlamlılar (state/indicate → belirtiniz) ayrı satırlarda aynı
  // karşılığı alabilir.
  const byRow = new Map<number, number[]>();
  ranked.forEach((candidate, c) => candidate.rows.forEach((row) => byRow.set(row, [...(byRow.get(row) ?? []), c])));
  const linked = ranked.map(() => new Map<string, number>());
  const nested = (small: string[], big: string[]) => small.every((word) => big.includes(word));
  for (const [row, members] of byRow) {
    const pairs = members
      .flatMap((c) => [...targetStems[row].keys()].filter((key) => ranked[c].raw.has(key)).map((key) => ({ c, key, ...ranked[c].raw.get(key)! })))
      .sort((a, b) => b.score - a.score || a.distance - b.distance || b.evidence - a.evidence);
    const taken: Array<{ source: string; stems: string[] }> = [];
    const done = new Set<number>();
    for (const { c, key } of pairs) {
      if (done.has(c)) continue;
      const source = ranked[c].gram;
      const stems = key.split(" ");
      const clash = taken.some(
        (other) =>
          other.stems.some((word) => stems.includes(word)) &&
          !(` ${source} `.includes(` ${other.source} `) && nested(other.stems, stems)) &&
          !(` ${other.source} `.includes(` ${source} `) && nested(stems, other.stems)),
      );
      if (clash) continue;
      linked[c].set(key, (linked[c].get(key) ?? 0) + 1);
      taken.push({ source, stems });
      done.add(c);
    }
  }

  // 3. Karşılık, bağlanan görülmelerle yeniden hesaplanan Dice'ın en yükseği;
  // ona 0,05 yakın olanlar arasından kaynağın kelime sayısına en yakın
  // ("water content" → "su içeriği", "içeriği" değil), o da eşitse kısa olan.
  const mined: MinedTerm[] = [];
  ranked.forEach((candidate, c) => {
    const sourceLength = candidate.gram.split(" ").length;
    const distance = (key: string) => Math.abs(key.split(" ").length - sourceLength);
    const options = [...linked[c]]
      .filter(([, count]) => count >= rules.minCount)
      .map(([key, count]) => ({ key, count, dice: dice(candidate.rows.length, key, count) }))
      .filter((option) => option.dice >= rules.minDice);
    if (!options.length) return;
    const top = Math.max(...options.map((option) => option.dice));
    const best = options
      .filter((option) => option.dice >= top - 0.05)
      .sort((a, b) => distance(a.key) - distance(b.key) || b.dice - a.dice || a.key.split(" ").length - b.key.split(" ").length)[0];
    const target = displayForm({ key: best.key, forms: candidate.surfaces.get(best.key)! }, candidate.gram, langs.target);
    if (untranslated(candidate.gram, target)) return;
    mined.push({
      source: candidate.gram,
      target,
      g2: candidate.g2,
      dice: best.dice,
      together: best.count,
      examples: candidate.rows.slice(0, 3).map((index) => firm[index]),
    });
  });
  return mined.sort((a, b) => b.g2 * b.dice - a.g2 * a.dice);
}

/**
 * Kökün gösterilecek biçimi: kökle birebir aynı biçim varsa o ("ruhsat"),
 * yoksa yeterince sık (en sığın ¼'ü) biçimlerin en kısası ("depolandıktan"
 * değil "depolama"); yazılışı `dictionaryForm`.
 */
function displayForm(option: { key: string; forms: Map<string, number> }, source: string, lang: string): string {
  const groups = new Map<string, Array<[string, number]>>();
  for (const [form, count] of option.forms) {
    const lower = localeLower(form, lang);
    groups.set(lower, [...(groups.get(lower) ?? []), [form, count]]);
  }
  const total = (lower: string) => groups.get(lower)!.reduce((sum, [, count]) => sum + count, 0);
  const lowers = [...groups.keys()];
  const top = Math.max(...lowers.map(total));
  const chosen =
    lowers.find((lower) => lower === option.key) ??
    lowers.filter((lower) => total(lower) * 4 >= top).sort((a, b) => a.length - b.length || total(b) - total(a))[0];
  return dictionaryForm(groups.get(chosen)!, source, lang);
}

/**
 * Çıkarılan terimi genel terimceyle karşılaştırır. Firmanın satırları bir kez
 * hazırlanır; kökler kesilmez ("teslimat" ≠ "teslim"). "same": genel karşılıkla
 * aynı kök ("solüsyonu" ~ "solüsyon") ya
 * da firma o terimi içeren satırlarının en az yarısında genel karşılığı
 * kullanıyor (çıkarılan "aktif" yalnız bir parça); "differs": firma gerçekten
 * başka çeviriyor (firma farkı); "none": genel terimcede yok.
 */
export function generalCheck(firm: TermPair[], langs: { source: string; target: string }) {
  const keyOf = (text: string) => words(text, langs.target).map((word) => rootOf(word, langs.target));
  const rows = firm.map((pair) => ({ source: plain(pair.source), stems: new Set(keyOf(pair.target)) }));
  return (term: { source: string; target: string }, generalTargets: string[]): "none" | "same" | "differs" => {
    if (!generalTargets.length) return "none";
    const mined = keyOf(term.target).join(" ");
    const generals = generalTargets.map(keyOf).filter((key) => key.length);
    if (generals.some((key) => key.join(" ") === mined)) return "same";
    const source = plain(term.source);
    const using = rows.filter((row) => row.source.includes(source));
    const agreeing = using.filter((row) => generals.some((key) => key.every((each) => row.stems.has(each)))).length;
    return using.length && agreeing * 2 >= using.length ? "same" : "differs";
  };
}
