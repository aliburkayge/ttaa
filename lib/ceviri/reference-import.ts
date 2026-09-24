import { align, alignedPairs } from "./align";
import { parseDocx } from "./docx";
import { imageFormat, imageToPdf } from "./image-doc";
import { activeOcrProvider, isPdf, ocrToSegments } from "./ocr";
import { askOpenAI } from "./translate";
import { insertTmRows, toTmRow, type TmRow } from "./tm-store";

/**
 * Referans çiftini firmanın belleğine alır (spec 5.4): kaynak ve çeviri
 * metinleri çıkarılır, Gale-Church ile hizalanır, orta güvenli eşleşmeler
 * yapay zekâya doğrulatılır, doğrulanan ve yüksek güvenli çiftler
 * `origin = reference` olarak yazılır.
 */

/**
 * Hizalamaya girecek paragraf: en az üç harf. Word çevirilerinde yalnızca
 * noktadan ya da numaradan oluşan paragraflar var; gerçek bir BASF çiftinde
 * "CONTROL → ." yüksek güvenle eşleniyordu (müşterinin eski belleğindeki
 * hatalı satırlar da böyle oluşmuş).
 */
export function meaningful(text: string): boolean {
  return (text.match(/\p{L}/gu) ?? []).length >= 3;
}

const same = (a: string, b: string) => a.toLocaleLowerCase("tr").replace(/\s+/g, " ").trim() === b.toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();

/**
 * Kişisel veri belleğe alınmaz: çeviride hiç değişmeyen kısa satır (isim,
 * adres, firma unvanı) ve uzun sayı dizisi taşıyan kısa satır (T.C. kimlik,
 * pasaport, hesap no). Çevrilmiş terimler ("Switzerland → İsviçre") kalır.
 */
export function looksPersonal(pair: { source: string; target: string }): boolean {
  const words = pair.source.trim().split(/\s+/).filter(Boolean).length;
  if (words > 6) return false;
  return same(pair.source, pair.target) || /\d{6,}/.test(pair.source.replace(/[\s.-]/g, ""));
}

export async function extractTexts(name: string, bytes: Uint8Array, lang: string): Promise<string[]> {
  if (/\.docx$/i.test(name)) return parseDocx(bytes).segments.map((segment) => segment.text);
  const image = imageFormat(bytes);
  if (!isPdf(bytes) && !image) throw new Error(`${name}: PDF, görsel ya da Word değil.`);
  const pdf = image ? await imageToPdf(bytes) : bytes;
  const result = await activeOcrProvider().run(pdf, { lang });
  if (result.demo) throw new Error("OCR sağlayıcısı bağlı değil; taranmış kaynak okunamıyor.");
  return ocrToSegments(result).map((segment) => segment.text);
}

/**
 * Orta güvenli eşleşmeleri tek istekte doğrulatır. Çeviriye eklenmiş ya da
 * çeviride düşmüş içerik varsa eşleşme reddedilir. Yanıt okunamazsa hiçbiri
 * kabul edilmez: belleğe şüpheli çift girmez.
 */
async function verify(pairs: Array<{ source: string; target: string }>, sourceLang: string, targetLang: string): Promise<boolean[]> {
  if (!pairs.length) return [];
  const prompt = [
    `Each item is a ${sourceLang} text and a ${targetLang} text taken from a document and its translation.`,
    "Answer true only if the second text is a complete and faithful translation of the first:",
    "false if either text contains content the other lacks (an extra sentence, a note, a heading, a missing clause).",
    "Punctuation, formatting and word order differences do not matter.",
    'Reply with JSON only: {"answers": [true, false, ...]} in the same order.',
    "",
    ...pairs.map((pair, index) => `${index + 1}. ${JSON.stringify(pair.source)} => ${JSON.stringify(pair.target)}`),
  ].join("\n");
  try {
    const reply = await askOpenAI(prompt, process.env.OPENAI_MODEL?.trim() || "gpt-5.5-2026-04-23");
    const match = /\{[\s\S]*\}/.exec(reply);
    const answers = match ? ((JSON.parse(match[0]) as { answers?: unknown[] }).answers ?? []) : [];
    return pairs.map((_, index) => answers[index] === true);
  } catch {
    return pairs.map(() => false);
  }
}

export type ReferenceStats = { aligned: number; verified: number; dropped: number; stored: number };

export async function importReferencePair(input: {
  clientId: string | null;
  sectorId: string | null;
  importId: string;
  sourceName: string;
  sourceBytes: Uint8Array;
  targetBytes: Uint8Array;
  sourceLang: string;
  targetLang: string;
}): Promise<ReferenceStats> {
  const source = (await extractTexts(input.sourceName, input.sourceBytes, input.sourceLang)).filter(meaningful);
  const target = parseDocx(input.targetBytes)
    .segments.map((segment) => segment.text)
    .filter(meaningful);
  const beads = align(source, target);
  const candidates = alignedPairs(beads, source, target).filter((pair) => !looksPersonal(pair));
  const high = candidates.filter((pair) => pair.confidence === "high");
  const medium = candidates.filter((pair) => pair.confidence === "medium");
  const verdicts: boolean[] = [];
  for (let i = 0; i < medium.length; i += 40) verdicts.push(...(await verify(medium.slice(i, i + 40), input.sourceLang, input.targetLang)));
  const accepted = [...high, ...medium.filter((_, index) => verdicts[index])];

  const rows: TmRow[] = [];
  for (const pair of accepted) {
    const row = toTmRow({
      sourceLang: input.sourceLang,
      targetLang: input.targetLang,
      sourceText: pair.source,
      targetText: pair.target,
      projectName: `referans:${input.sourceName.split("/").pop()}`,
      contextPre: null,
      contextPost: null,
      origin: null,
    });
    if (row) rows.push({ ...row, origin: "reference" });
  }
  const result = rows.length
    ? await insertTmRows(rows, { importId: input.importId, clientId: input.clientId, sectorId: input.sectorId })
    : { inserted: 0, merged: 0 };
  const paired = beads.filter((bead) => bead.source.length && bead.target.length).length;
  return {
    aligned: paired,
    verified: verdicts.filter(Boolean).length,
    dropped: paired - accepted.length,
    stored: result.inserted + result.merged,
  };
}
