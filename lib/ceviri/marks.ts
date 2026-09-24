import type { ImageKind } from "./ocr-layout";

/**
 * Müşteri kuralı: çeviride imza ve mühür orijinaldeki gibi kopyalanmaz.
 * Yerlerine köşeli parantez içinde, hedef dilde ve büyük harfle etiket yazılır:
 * Türkçe çeviride [İMZA] ve [MÜHÜR]. Mühürün içindeki okunabilir yazı çevrilip
 * etiketin içine girer: [MÜHÜR: BASF SE, Ludwigshafen].
 */

export type MarkKind = "signature" | "stamp" | "signature_stamp";

export function isMark(kind: ImageKind | null | undefined): kind is MarkKind {
  return kind === "signature" || kind === "stamp" || kind === "signature_stamp";
}

/**
 * İki işaret aynı etiketin altına girer mi? İmza+mühür bölgesi imzayı da
 * mührü de kapsar; mühür bölgesinin yanındaki imza ise ayrı bir [İMZA] alır.
 */
export function sameMark(a: MarkKind, b: MarkKind): boolean {
  return a === b || a === "signature_stamp" || b === "signature_stamp";
}

const LABELS: Record<string, { signature: string; stamp: string }> = {
  tr: { signature: "İMZA", stamp: "MÜHÜR" },
  en: { signature: "SIGNATURE", stamp: "SEAL" },
  de: { signature: "UNTERSCHRIFT", stamp: "STEMPEL" },
  ru: { signature: "ПОДПИСЬ", stamp: "ПЕЧАТЬ" },
  es: { signature: "FIRMA", stamp: "SELLO" },
  it: { signature: "FIRMA", stamp: "TIMBRO" },
  el: { signature: "ΥΠΟΓΡΑΦΗ", stamp: "ΣΦΡΑΓΙΔΑ" },
  pl: { signature: "PODPIS", stamp: "PIECZĘĆ" },
};

export function markLabels(targetLang: string): { signature: string; stamp: string } {
  return LABELS[targetLang.split("-")[0].toLowerCase()] ?? LABELS.en;
}

/**
 * Bölgenin yerine yazılacak satırlar. İmza bölgesindeki basılı yazı (isim,
 * unvan) etiketin altında kendi satırlarında kalır; iç içe imza+mühürde de
 * öyle, çünkü o yazı çoğu zaman imzacının adıdır, mührün yazısı değil.
 */
export function markText(kind: MarkKind, targetLang: string, lines: string[]): string[] {
  const label = markLabels(targetLang);
  const inner = lines.map((text) => text.trim().replace(/[,;]$/, "")).filter(Boolean);
  if (kind === "stamp") return [inner.length ? `[${label.stamp}: ${inner.join(", ")}]` : `[${label.stamp}]`];
  const head = kind === "signature" ? `[${label.signature}]` : `[${label.signature}] [${label.stamp}]`;
  return [head, ...inner];
}

/** İnceleme ekranı için: bu satır çıktıda nereye yazılacak. */
export function markNote(kind: MarkKind, targetLang: string): string {
  const label = markLabels(targetLang);
  return kind === "stamp"
    ? `Mühürün yazısı: çıktıda mühür kaldırılır, yerine [${label.stamp}: …] içinde yazılır.`
    : `İmza alanındaki basılı yazı: çıktıda imza kaldırılır, [${label.signature}] etiketinin altına yazılır.`;
}
