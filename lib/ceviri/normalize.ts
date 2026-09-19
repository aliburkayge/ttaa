import { createHash } from "node:crypto";

/** Turkish casing maps I→ı and İ→i; every other language maps I→i. */
export function localeLower(text: string, lang: string): string {
  const locale = lang.toLowerCase().startsWith("tr") ? "tr" : "en";
  return text.toLocaleLowerCase(locale);
}

/** Lowercase for the language, collapse all whitespace runs to one space, trim. */
export function normalizeForMatch(text: string, lang: string): string {
  return localeLower(text, lang).replace(/\s+/g, " ").trim();
}

/** sha256 of the normalized text, as lowercase hex. */
export function segmentHash(text: string, lang: string): string {
  return createHash("sha256").update(normalizeForMatch(text, lang), "utf8").digest("hex");
}
