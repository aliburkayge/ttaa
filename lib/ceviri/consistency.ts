import { isAddressLine, localizeCountries } from "./address";
import { missingProtected } from "./qa";
import { languagePrompt } from "./languages";
import { ADDRESS_NOTE } from "./translate";

/**
 * Belge içi tutarlılık (müşteri geri bildirimi, BASF): aynı ifade ve aynı
 * terim bir belgede hep aynı çevrilir. "Notification to and Confirmation
 * from the US EPA of…" 1. sayfada iki, 2. sayfada üçüncü bir biçimde;
 * "name" 3. sayfada hem "ad" hem "isim" olmuştu.
 *
 * Çeviri bittikten sonra belge bir bütün olarak gözden geçirilir:
 *  1. Adres satırları kurala döndürülür (bkz. address.ts).
 *  2. Birebir aynı kaynak cümle aynı çeviriyi alır.
 *  3. Kaynakta ortak ifade paylaşan satırlar gruplanır; her grup ayrı sorulur
 *     ve ortak ifade gruptaki her satırda aynı çevrilir (bkz. alignPhrases).
 *  4. Bir dil modeli bütün belgeyi görür ve aynı ifadenin/terimin farklı
 *     çevrildiği yerleri tek biçime getirir. Önerisi denetlenir: kilitli satıra
 *     (elle düzeltilmiş, adres) dokunamaz, sayıları ve korunan ifadeleri
 *     kaybedemez, metni yeniden yazamaz.
 */

export type ReviewSegment = {
  id: string;
  text: string;
  translation: string | null;
  source: string | null;
  note?: string | null;
} & Record<string, unknown>;

export type Change = { id: string; translation: string; reason: string };

type Options = { sourceLang: string; targetLang: string; ask: (prompt: string) => Promise<string> };

const LOCKED = new Set(["human", "rule"]);
const RANK: Record<string, number> = { human: 0, rule: 1, "tm-exact": 2, "tm-fuzzy": 3 };

/** Büyük/küçük harfe duyarlı: "BASF AGRICULTURAL…" başka yerdeki "BASF Agricultural…" ile birleşmez. */
function key(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function unifyRepeats(segments: ReviewSegment[]): Change[] {
  const groups = new Map<string, ReviewSegment[]>();
  for (const segment of segments) {
    if (!segment.translation?.trim()) continue;
    const group = groups.get(key(segment.text));
    if (group) group.push(segment);
    else groups.set(key(segment.text), [segment]);
  }

  const changes: Change[] = [];
  for (const group of groups.values()) {
    if (new Set(group.map((segment) => segment.translation)).size < 2) continue;
    const count = (translation: string | null) => group.filter((segment) => segment.translation === translation).length;
    const canonical = [...group].sort(
      (a, b) =>
        (RANK[a.source ?? ""] ?? 9) - (RANK[b.source ?? ""] ?? 9) ||
        count(b.translation) - count(a.translation) ||
        group.indexOf(a) - group.indexOf(b),
    )[0].translation as string;
    for (const segment of group) {
      if (segment.source === "human" || segment.translation === canonical) continue;
      changes.push({ id: segment.id, translation: canonical, reason: "aynı cümle belgede başka yerde böyle çevrildi" });
    }
  }
  return changes;
}

/**
 * Karşılaştırma için sözcükler: küçük harf, baştaki/sondaki noktalama ve
 * kesme işaretinden sonraki ek atılmış ("LLC’ye" → "llc", "BASF's" → "basf").
 */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+/u, "").replace(/['’].*$/u, "").replace(/[^\p{L}\p{N}]+$/u, ""))
    .filter(Boolean);
}

/** İki sözcük dizisinin ortak en uzun kesintisiz parçası. */
function longestRun(a: string[], b: string[]): string[] {
  let best = 0;
  let end = 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== b[j - 1]) continue;
      row[j] = previous[j - 1] + 1;
      if (row[j] > best) {
        best = row[j];
        end = i;
      }
    }
    previous = row;
  }
  return a.slice(end - best, end);
}

function contains(haystack: string[], run: string[]): boolean {
  outer: for (let i = 0; i + run.length <= haystack.length; i++) {
    for (let k = 0; k < run.length; k++) if (haystack[i + k] !== run[k]) continue outer;
    return true;
  }
  return false;
}

/**
 * Çevirilerin birbirine ne kadar benzediği: her satır çiftinin ortak en uzun
 * sözcük dizisinin toplamı. Gruptaki her satır aynı kalıbı taşımayabilir
 * ("- Confirmation from the US EPA to BASF"); ölçü bu yüzden çift çift.
 */
function likeness(texts: string[][]): number {
  let total = 0;
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) total += longestRun(texts[i], texts[j]).length;
  return total;
}

/** Ortak ifade bu kadar sözcükse aynı çevrilmelidir. */
const PHRASE_WORDS = 5;
/** Kısa satırlarda (etiketler: "Current name and address:") daha kısa ortak ifade de sayılır. */
const SHORT_LINE_WORDS = 10;
const SHORT_PHRASE_WORDS = 3;
/** Bir belgede en fazla bu kadar grup sorulur. */
const MAX_GROUPS = 12;

/** `phrases`: üyelerin kaynakta paylaştığı ifadeler, en önemlisi başta. */
export type PhraseGroup = { phrases: string[]; ids: string[] };

/**
 * Kaynakta ortak bir ifadeyi paylaşan satır grupları. "1) Notification to and
 * Confirmation from the US EPA of …" ile "2) Notification to and Confirmation
 * from the US EPA of …" ve ekteki başlıkları tek grup olur. Birebir aynı
 * satırlardan yalnızca ilki gruba girer (kopyaları sonra aynısını alır). Ortak
 * ifade her çeviride aynen geçiyorsa (şirket adı gibi) grup sorulmaz.
 */
export function sharedPhrases(segments: ReviewSegment[]): PhraseGroup[] {
  const seen = new Set<string>();
  const unique = segments.filter((segment) => {
    if (!segment.translation?.trim() || seen.has(key(segment.text))) return false;
    seen.add(key(segment.text));
    return true;
  });
  const tokens = unique.map((segment) => words(segment.text));

  // Aday çiftler: en az bir ortak kısa sözcük üçlüsü olanlar.
  const index = new Map<string, number[]>();
  tokens.forEach((list, i) => {
    const grams = new Set<string>();
    for (let k = 0; k + SHORT_PHRASE_WORDS <= list.length; k++) grams.add(list.slice(k, k + SHORT_PHRASE_WORDS).join(" "));
    for (const gram of grams) index.set(gram, [...(index.get(gram) ?? []), i]);
  });
  const pairs = new Set<string>();
  for (const members of index.values()) {
    for (let x = 0; x < members.length; x++) for (let y = x + 1; y < members.length; y++) pairs.add(`${members[x]},${members[y]}`);
  }

  const phrases = new Map<string, string[]>();
  for (const pair of pairs) {
    const [i, j] = pair.split(",").map(Number);
    const run = longestRun(tokens[i], tokens[j]);
    const short = tokens[i].length <= SHORT_LINE_WORDS && tokens[j].length <= SHORT_LINE_WORDS;
    if (run.length < (short ? SHORT_PHRASE_WORDS : PHRASE_WORDS)) continue;
    phrases.set(run.join(" "), run);
  }

  const groups: Array<{ phrase: string; ids: string[]; score: number }> = [];
  for (const [phrase, run] of phrases) {
    // Kısa ortak ifade ("the US EPA") yalnızca kısa satırları bağlar; uzun
    // cümlelerde üç sözcüklük ortaklık tesadüftür.
    const short = run.length < PHRASE_WORDS;
    const members = unique.filter((_, i) => contains(tokens[i], run) && (!short || tokens[i].length <= SHORT_LINE_WORDS));
    if (members.length < 2 || members.every((segment) => LOCKED.has(segment.source ?? ""))) continue;
    // Ortak ifade çeviride de aynen duruyorsa (özel ad, kod) tutarsızlık yoktur.
    if (members.every((segment) => contains(words(segment.translation as string), run))) continue;
    groups.push({ phrase, ids: members.map((segment) => segment.id), score: run.length * members.length });
  }
  // Başka bir grubun içinde kalan grup ayrıca sorulmaz; ifadesi o grubun
  // sorusuna eklenir ("1) Notification … in the USA" ile "Attachment #1: …"
  // ikilisi, dört başlığın hepsini içeren grubun parçası olur).
  groups.sort((a, b) => b.ids.length - a.ids.length || b.score - a.score);
  const kept: Array<PhraseGroup & { score: number }> = [];
  for (const group of groups) {
    const container = kept.find((other) => group.ids.every((id) => other.ids.includes(id)));
    if (!container) kept.push({ phrases: [group.phrase], ids: group.ids, score: group.score });
    else {
      container.phrases.push(group.phrase);
      container.score = Math.max(container.score, group.score);
    }
  }
  for (const group of kept) group.phrases.sort((a, b) => b.split(" ").length - a.split(" ").length);
  return kept
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_GROUPS)
    .map(({ phrases, ids }) => ({ phrases, ids }));
}

function segmentLine(segment: ReviewSegment, locked: Set<string>): string {
  return JSON.stringify({
    id: segment.id,
    source: segment.text,
    translation: segment.translation,
    locked: LOCKED.has(segment.source ?? "") || locked.has(segment.id),
  });
}

function phrasePrompt(group: PhraseGroup, members: ReviewSegment[], options: Options): string {
  return [
    `You are reviewing the finished translation of one official document from ${languagePrompt(options.sourceLang)} to ${languagePrompt(options.targetLang)}.`,
    `The source segments below share wording (${group.phrases.map((phrase) => `"${phrase}"`).join(", ")}). Consistency is essential: wording that is shared in the source must be translated identically in every segment that contains it — the same words, the same structure and the same word order — while the parts that differ keep their own translation.`,
    "Pick the most accurate rendering of the shared wording (the one in a locked segment if there is one) and rewrite the other segments to use exactly that rendering. Change only what consistency requires. Keep numbers, codes, names, e-mail addresses, list markers and punctuation exactly.",
    'Never change a segment with "locked": true.',
    'Reply with JSON only: {"changes":[{"id":"...","translation":"...","reason":"short reason in Turkish"}]}. Reply {"changes":[]} if the shared wording is already translated identically.',
    "",
    "Segments, one JSON object per line:",
    ...members.map((segment) => segmentLine(segment, new Set())),
  ].join("\n");
}

type Proposal = { id?: unknown; translation?: unknown; reason?: unknown };

function parseChanges(reply: string): Proposal[] | null {
  try {
    const body = JSON.parse(/\{[\s\S]*\}/.exec(reply)?.[0] ?? "{}") as { changes?: unknown };
    return Array.isArray(body.changes) ? body.changes : [];
  } catch {
    return null;
  }
}

/** Önerilen düzeltme denetimden geçerse yeni çeviri, geçmezse null. */
function checked(segment: ReviewSegment, proposal: Proposal, locked: Set<string>): string | null {
  const translation = typeof proposal.translation === "string" ? proposal.translation.trim() : "";
  if (!translation || LOCKED.has(segment.source ?? "") || locked.has(segment.id)) return null;
  const before = (segment.translation as string).trim();
  if (translation === before) return null;
  // Yeniden yazım değil, düzeltme: uzunluk yakın kalmalı.
  if (translation.length < before.length * 0.6 || translation.length > before.length * 1.6) return null;
  // Büyük harfle yazılmış satır (antet, başlık) büyük harf kalır.
  if (/\p{Lu}/u.test(before) && !/\p{Ll}/u.test(before) && /\p{Ll}/u.test(translation)) return null;
  // Kaynaktaki ve eski çevirideki sayılar, korunan ifadeler kaybolamaz.
  if (digitRuns(segment.text).some((run) => before.includes(run) && !translation.includes(run))) return null;
  if (missingProtected(segment.text, translation).length > missingProtected(segment.text, before).length) return null;
  return translation;
}

function reasonOf(proposal: Proposal, fallback: string): string {
  return typeof proposal.reason === "string" && proposal.reason.trim() ? proposal.reason.trim() : fallback;
}

/**
 * Ortak ifadeli her grup ayrı ayrı sorulur: bütün belgeyi tek seferde gören
 * model bazı tekrarları atlıyordu (BASF: Ekler listesi 1. sayfada iki farklı
 * biçimde kaldı). Grubun düzeltmesi bütün hâlinde kabul edilir ya da hiç: her
 * öneri denetimden geçmeli ve çeviriler birbirine gerçekten yaklaşmalıdır
 * (hepsinde ortak geçen en uzun sözcük dizisi uzamalı).
 */
export async function alignPhrases(segments: ReviewSegment[], options: Options): Promise<Change[]> {
  const current = new Map(segments.filter((segment) => segment.translation?.trim()).map((segment) => [segment.id, segment]));
  const changes: Change[] = [];
  for (const group of sharedPhrases(segments)) {
    const members = group.ids.map((id) => current.get(id) as ReviewSegment);
    let reply: string;
    try {
      reply = await options.ask(phrasePrompt(group, members, options));
    } catch {
      continue;
    }
    const proposals = parseChanges(reply);
    if (!proposals?.length) continue;

    const next = new Map<string, { translation: string; reason: string }>();
    let valid = true;
    for (const proposal of proposals) {
      const segment = members.find((member) => member.id === proposal.id);
      if (!segment) continue;
      const translation = checked(segment, proposal, new Set());
      if (translation === null) {
        if (typeof proposal.translation === "string" && proposal.translation.trim() === segment.translation?.trim()) continue;
        valid = false;
        break;
      }
      next.set(segment.id, { translation, reason: reasonOf(proposal, "ortak ifade belgede tek biçimde çevrildi") });
    }
    if (!valid || !next.size) continue;
    const before = likeness(members.map((member) => words(member.translation as string)));
    const after = likeness(members.map((member) => words(next.get(member.id)?.translation ?? (member.translation as string))));
    if (after <= before) continue;

    for (const [id, change] of next) {
      const segment = current.get(id) as ReviewSegment;
      // Birebir aynı satırlar (gruba girmeyen kopyalar) da aynı çeviriyi alır.
      for (const copy of current.values()) {
        if (key(copy.text) !== key(segment.text) || LOCKED.has(copy.source ?? "")) continue;
        current.set(copy.id, { ...copy, translation: change.translation });
        changes.push({ id: copy.id, ...change });
      }
    }
  }
  return changes;
}

function prompt(segments: ReviewSegment[], options: Options, locked: Set<string>): string {
  const lines = segments.filter((segment) => segment.translation?.trim()).map((segment) => segmentLine(segment, locked));
  return [
    `You are reviewing the finished translation of one official document from ${languagePrompt(options.sourceLang)} to ${languagePrompt(options.targetLang)}.`,
    "Consistency is essential: the same source wording and the same term must be translated identically everywhere in the document.",
    "Find segments where the same source phrase (three or more words) or the same term (for example a noun like \"name\") is rendered differently, and rewrite the affected translations so that every occurrence uses one rendering: the most accurate one, preferably the one used most often.",
    "Change only what consistency requires. Do not restyle, shorten, lengthen or otherwise improve anything else. Keep numbers, codes, names, e-mail addresses and punctuation exactly.",
    "Never change a segment with \"locked\": true; when a locked segment uses a rendering, use that rendering elsewhere.",
    'Reply with JSON only: {"changes":[{"id":"...","translation":"...","reason":"short reason in Turkish"}]}. Reply {"changes":[]} if the document is already consistent.',
    "",
    "Segments, one JSON object per line:",
    ...lines,
  ].join("\n");
}

function digitRuns(text: string): string[] {
  return text.match(/\d+/g) ?? [];
}

/** `locked`: bu satırlar da kilitli sayılır (ör. ortak ifadesi zaten hizalanmış olanlar). */
export async function harmonize(
  segments: ReviewSegment[],
  options: Options & { locked?: Set<string> },
): Promise<Change[]> {
  const translated = segments.filter((segment) => segment.translation?.trim());
  if (translated.length < 2) return [];
  const locked = options.locked ?? new Set<string>();

  let reply: string;
  try {
    reply = await options.ask(prompt(segments, options, locked));
  } catch {
    return [];
  }
  const proposed = parseChanges(reply);
  if (!proposed) return [];

  const byId = new Map(translated.map((segment) => [segment.id, segment]));
  const accepted: Change[] = [];
  for (const proposal of proposed) {
    const segment = typeof proposal.id === "string" ? byId.get(proposal.id) : undefined;
    const translation = segment ? checked(segment, proposal, locked) : null;
    if (!segment || translation === null) continue;
    accepted.push({ id: segment.id, translation, reason: reasonOf(proposal, "belge içi tutarlılık") });
  }
  return accepted;
}

/** Çevirisi biten belgenin gözden geçirilmesi. Kaç satırın değiştiğini de söyler. */
export async function reviewDocument<T extends ReviewSegment>(
  segments: T[],
  options: Options,
): Promise<{ segments: T[]; changed: number }> {
  let changed = 0;
  let current = segments.map((segment) => {
    if (segment.source === "human" || !isAddressLine(segment.text)) return segment;
    const translation = localizeCountries(segment.text, options.targetLang);
    if (translation !== segment.translation) changed++;
    return { ...segment, translation, source: "rule", note: ADDRESS_NOTE, warning: null };
  });

  const apply = (changes: Change[]) => {
    const byId = new Map(changes.map((change) => [change.id, change]));
    current = current.map((segment) => {
      const change = byId.get(segment.id);
      if (!change) return segment;
      changed++;
      const note = [segment.note, `Tutarlılık: ${change.reason}`].filter(Boolean).join(" · ");
      return { ...segment, translation: change.translation, note };
    });
  };
  apply(unifyRepeats(current));
  const aligned = await alignPhrases(current, options);
  apply(aligned);
  // Hizalanan satırlar genel incelemede kilitli: model onları yeniden
  // farklılaştıramaz, kullandıkları ifadeyi başka yerlere taşır.
  apply(await harmonize(current, { ...options, locked: new Set(aligned.map((change) => change.id)) }));
  return { segments: current, changed };
}
