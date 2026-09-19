const MAX_QUERY = 5000;

export type SearchQuery = { sourceText: string; sourceLang: string; targetLang: string };

export function parseSearchBody(body: unknown): SearchQuery | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "Body must be an object." };
  const input = body as Record<string, unknown>;

  const sourceText = typeof input.sourceText === "string" ? input.sourceText.trim() : "";
  const sourceLang = typeof input.sourceLang === "string" ? input.sourceLang.trim() : "";
  const targetLang = typeof input.targetLang === "string" ? input.targetLang.trim() : "";

  if (!sourceText) return { error: "Aranacak metin gerekli." };
  if (sourceText.length > MAX_QUERY) return { error: `Metin en fazla ${MAX_QUERY} karakter olabilir.` };
  if (!sourceLang) return { error: "Kaynak dil gerekli." };
  if (!targetLang) return { error: "Hedef dil gerekli." };

  return { sourceText, sourceLang, targetLang };
}
