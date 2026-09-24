/**
 * Çeviri birimi: cümle. OCR taranmış belgede paragrafı satır satır verir;
 * satırlar ayrı çevrilince cümle bölünür, Türkçede öğe dizilişi değiştiği için
 * her parça yarım kalır (DELAN SC garanti mektubu: "Rue" bir satırda,
 * "Jacquard" ötekinde; "…Fransa'da, ortak reçete ve Ürün Spesifikasyonları
 * uyarınca, bunlar"). Aynı paragrafın satırı bitmeyen cümleyle bitiyorsa
 * sonraki satır aynı cümledir: cümle bütün olarak bellekte aranır ve çevrilir,
 * çeviri kaynağın satır uzunluklarına göre satırlara geri dağıtılır.
 * Katman her satırı kendi yerine yazar; paragraf yeniden akar.
 */

export type UnitSegment = {
  id: string;
  text: string;
  kind?: string;
  page?: number | null;
  /** OCR bloğunun sırası; yalnızca taranmış belgede ve bu alan eklendikten sonra yüklenenlerde var. */
  block?: number | null;
  mark?: unknown;
};

/** Paragrafın en uzun satırı bundan kısaysa düz yazı değildir (imza bloğu, unvan, başlık). */
const PROSE_LINE = 50;
/** Satır, paragrafın en uzun satırının bu payından kısaysa orada bitmiştir. */
const FULL_LINE = 0.6;
/** Bir cümle en fazla bu kadar satır: tespit yanılırsa zarar sınırlı kalır. */
const MAX_LINES = 10;
const SENTENCE_END = /[.!?:;]["'”’»)\]]*$/;
const LIST_ITEM = /^(?:[-–•·*]\s|\(?\d{1,2}[.)]\s|\(?[a-z][.)]\s)/i;

export function sentenceUnits<T extends UnitSegment>(segments: T[]): T[][] {
  const longest = new Map<string, number>();
  const blockKey = (segment: T) => `${segment.page ?? ""}:${segment.block}`;
  for (const segment of segments) {
    if (segment.block == null) continue;
    longest.set(blockKey(segment), Math.max(longest.get(blockKey(segment)) ?? 0, segment.text.trim().length));
  }
  const continues = (previous: T, next: T, size: number) => {
    if (size >= MAX_LINES || previous.block == null || next.block == null) return false;
    if (previous.block !== next.block || previous.page !== next.page) return false;
    if (previous.kind !== "paragraph" || next.kind !== "paragraph" || previous.mark || next.mark) return false;
    const text = previous.text.trim();
    const widest = longest.get(blockKey(previous)) ?? 0;
    if (widest < PROSE_LINE || text.length < widest * FULL_LINE) return false;
    return !SENTENCE_END.test(text) && !LIST_ITEM.test(next.text.trim());
  };

  const units: T[][] = [];
  for (const segment of segments) {
    const current = units[units.length - 1];
    if (current && continues(current[current.length - 1], segment, current.length)) current.push(segment);
    else units.push([segment]);
  }
  return units;
}

/** Birimin kaynak metni: satırlar tek boşlukla, satır sonu tirelemesi korunmadan. */
export function unitText(unit: UnitSegment[]): string {
  return unit.map((segment) => segment.text.trim()).join(" ");
}

/**
 * Çeviriyi satırlara böler: her satıra kaynaktaki payı kadar, sözcük
 * sınırında. Sayı ile birimi ("500 g/l") ayrı satıra düşmez. Hiçbir satır boş
 * kalmaz; sözcük satırdan azsa null (çağıran satırları ayrı çevirir).
 */
export function splitAcross(translation: string, sources: string[]): string[] | null {
  const words = translation.trim().split(/\s+/).filter(Boolean);
  if (sources.length <= 1) return [translation.trim()];
  if (words.length < sources.length) return null;

  const starts: number[] = [];
  let offset = 0;
  for (const word of words) {
    starts.push(offset);
    offset += word.length + 1;
  }
  const length = offset - 1;
  const weights = sources.map((source) => Math.max(1, source.trim().length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  // Çeviride aynen kalan sözcük (ad, kod, sayı): kaynak satır onunla bitiyor
  // ya da sonraki onunla başlıyorsa kırılma oraya oturur. "İsviçre"
  // "Switzerland"dan kısa; orantılı bölme "SZ,"yi alt satıra itiyordu.
  const bare = (word: string) => word.replace(/[^\p{L}\p{N}]/gu, "");
  const anchor = (word: string | undefined) => {
    const core = bare(word ?? "");
    return core.length >= 2 && /[\p{Lu}\p{N}]/u.test(core) ? core : null;
  };
  const lineWords = sources.map((source) => source.trim().split(/\s+/));

  const breaks: number[] = [];
  let share = 0;
  for (let k = 1; k < sources.length; k++) {
    share += weights[k - 1];
    const target = (length * share) / total;
    const low = (breaks[breaks.length - 1] ?? 0) + 1;
    const high = words.length - (sources.length - k);
    const ends = anchor(lineWords[k - 1].at(-1));
    const opens = anchor(lineWords[k][0]);
    let best = low;
    let bestCost = Infinity;
    for (let b = low; b <= high; b++) {
      // Sayıdan sonra kırılmaz: "500 | g/l Dithianon" yerine bir sözcük öte.
      const pinned = (ends !== null && bare(words[b - 1]) === ends) || (opens !== null && bare(words[b]) === opens);
      const cost = Math.abs(starts[b] - target) + (/^[\d.,%/]+$/.test(words[b - 1]) ? 12 : 0) - (pinned ? 15 : 0);
      if (cost < bestCost) {
        best = b;
        bestCost = cost;
      }
    }
    breaks.push(best);
  }
  const edges = [0, ...breaks, words.length];
  return edges.slice(1).map((end, index) => words.slice(edges[index], end).join(" "));
}

/**
 * Düzeltilen satırın belleğe yazılacak çifti. Satır bir cümlenin parçasıysa
 * cümlenin tamamı: satır parçası kaynağın o satırına karşılık gelmez
 * (Türkçede dizilişi farklı), belleğe yarım çift yazılmamalı.
 */
export function memoryPair(
  segments: Array<{ id: string; text: string; translation: string | null; unit?: string | null }>,
  id: string,
  translation: string,
): { source: string; target: string } {
  const target = segments.find((segment) => segment.id === id);
  if (!target) throw new Error(`Segment yok: ${id}`);
  if (!target.unit) return { source: target.text, target: translation };
  const members = segments.filter((segment) => segment.unit === target.unit);
  return {
    source: members.map((segment) => segment.text.trim()).join(" "),
    target: members.map((segment) => (segment.id === id ? translation : (segment.translation ?? "")).trim()).filter(Boolean).join(" "),
  };
}

/** Birimin çevresindeki metin (çeviri bağlamı): önceki iki ve sonraki iki birim. */
export function neighbours(units: UnitSegment[][], index: number): { before: string[]; after: string[] } {
  return {
    before: units.slice(Math.max(0, index - 2), index).map(unitText),
    after: units.slice(index + 1, index + 3).map(unitText),
  };
}
