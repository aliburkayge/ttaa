import { isAddressLine, localizeCountries } from "./address";
import { missingProtected } from "./qa";
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
 *  3. Bir dil modeli bütün belgeyi görür ve aynı ifadenin/terimin farklı
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

function prompt(segments: ReviewSegment[], options: Options): string {
  const lines = segments
    .filter((segment) => segment.translation?.trim())
    .map((segment) =>
      JSON.stringify({
        id: segment.id,
        source: segment.text,
        translation: segment.translation,
        locked: LOCKED.has(segment.source ?? ""),
      }),
    );
  return [
    `You are reviewing the finished translation of one official document from ${options.sourceLang} to ${options.targetLang}.`,
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

export async function harmonize(segments: ReviewSegment[], options: Options): Promise<Change[]> {
  const translated = segments.filter((segment) => segment.translation?.trim());
  if (translated.length < 2) return [];

  let reply: string;
  try {
    reply = await options.ask(prompt(segments, options));
  } catch {
    return [];
  }
  let proposed: Array<{ id?: unknown; translation?: unknown; reason?: unknown }>;
  try {
    const body = JSON.parse(/\{[\s\S]*\}/.exec(reply)?.[0] ?? "{}") as { changes?: unknown };
    proposed = Array.isArray(body.changes) ? body.changes : [];
  } catch {
    return [];
  }

  const byId = new Map(translated.map((segment) => [segment.id, segment]));
  const accepted: Change[] = [];
  for (const change of proposed) {
    const segment = typeof change.id === "string" ? byId.get(change.id) : undefined;
    const translation = typeof change.translation === "string" ? change.translation.trim() : "";
    if (!segment || !translation || LOCKED.has(segment.source ?? "")) continue;
    const before = (segment.translation as string).trim();
    if (translation === before) continue;
    // Yeniden yazım değil, düzeltme: uzunluk yakın kalmalı.
    if (translation.length < before.length * 0.6 || translation.length > before.length * 1.6) continue;
    // Kaynaktaki ve eski çevirideki sayılar, korunan ifadeler kaybolamaz.
    if (digitRuns(segment.text).some((run) => before.includes(run) && !translation.includes(run))) continue;
    if (missingProtected(segment.text, translation).length > missingProtected(segment.text, before).length) continue;
    accepted.push({
      id: segment.id,
      translation,
      reason: typeof change.reason === "string" && change.reason.trim() ? change.reason.trim() : "belge içi tutarlılık",
    });
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
  apply(await harmonize(current, options));
  return { segments: current, changed };
}
