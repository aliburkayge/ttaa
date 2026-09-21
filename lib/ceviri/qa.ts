import type { TermHit } from "./term-store";

/**
 * Kalite kuralları. Hem tek motorlu kademe (translate.ts) hem çok motorlu hakem
 * (engines.ts) aynı kuralları kullanır; ayrı dosyada durmaları ikisinin birbirini
 * içe aktarmasını önler.
 */

const PUNCTUATION_ONLY = /^[\s.,;:!?·•\-–—_/\\()[\]{}'"]*$/;

/**
 * Catches translation-memory entries that are not real translations. Their CAT
 * tool split headings across lines, so the memory contains rows like
 * "CONTROL" -> "." where a translator folded two source lines into one target
 * phrase. Reused blindly, those rows silently delete text from a document.
 */
export function suspiciousTarget(source: string, target: string): string | null {
  const sourceWords = (source.match(/\S+/g) ?? []).length;
  if (sourceWords === 0) return null;

  if (PUNCTUATION_ONLY.test(target)) {
    return "Bellekteki karşılık yalnızca noktalama içeriyor — bu kayıt büyük ihtimalle hatalı.";
  }
  // Aynı CAT bölme artığının başka bir yüzü: gerçek bellekte
  // "Suspension concentrate (SC)" -> ": Süspansiyon Konsantresi (SC)".
  // Tablo etiketinin iki noktası bir sonraki hücreye kaymış.
  const leading = /^\s*([:;,.])/.exec(target);
  if (leading && !/^\s*[:;,.]/.test(source)) {
    return `Çeviri kaynakta olmayan "${leading[1]}" işaretiyle başlıyor — bellek kaydı büyük ihtimalle bölünmüş bir satırdan kalma.`;
  }
  const targetWords = (target.match(/\S+/g) ?? []).length;
  if (sourceWords >= 3 && targetWords * 4 <= sourceWords) {
    return `Çeviri kaynaktan çok daha kısa (${sourceWords} kelime → ${targetWords}). Kontrol edin.`;
  }
  return null;
}

/**
 * Text that must survive a translation byte for byte: product and registration
 * codes, quantities with units, dates, CAS numbers, emails, URLs. A single
 * altered digit in a registration code invalidates an official document, so
 * these are listed for the model and checked again afterwards.
 */
const PROTECTED = [
  // Registration codes as they appear in the customer's own files:
  // "BAS 216 17 F", "BAS 555 00 F", "BASF 216 17 F", "BAS 480 031".
  /\b[A-Z]{2,4}\s+\d{2,4}(?:\s+\d{1,3}){1,2}(?:\s+[A-Z])?\b/g,
  /\b\d+[.,]?\d*\s?(?:g\/l|g\/kg|mg\/kg|ml|L|kg|g|mm|cm|%)\b/gi,
  /\b\d{1,3}-\d{2,3}-\d\b/g, // CAS
  /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g,
  /\bhttps?:\/\/\S+/g,
  /\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g,
];

export function protectedSpans(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of PROTECTED) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) found.add(match[0]);
  }
  return [...found];
}

/** Every protected span in the source must reappear untouched in the target. */
export function missingProtected(source: string, target: string): string[] {
  return protectedSpans(source).filter((span) => !target.includes(span));
}

export function violatedTerms(target: string, forbidden: TermHit[]): TermHit[] {
  const lower = target.toLocaleLowerCase("tr");
  return forbidden.filter((hit) => lower.includes(hit.targetText.toLocaleLowerCase("tr")));
}


/**
 * Zorunlu terimlerden hangileri çeviride geçiyor. Alt dize karşılaştırması
 * bilerek seçildi: Türkçe ekler terimin sonuna gelir, "ticari ad" terimi
 * "ticari adı" içinde de bulunur.
 */
export function presentTerms(target: string, required: TermHit[]): TermHit[] {
  const lower = target.toLocaleLowerCase("tr");
  return required.filter((hit) => lower.includes(hit.targetText.toLocaleLowerCase("tr")));
}
