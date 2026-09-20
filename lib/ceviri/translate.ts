import { fetchWithRetry, integerEnv } from "../upstream";
import { searchTm, matchTier } from "./tm-store";
import { lookupTerms, type TermHit } from "./term-store";

type ResponsesBody = {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
};

function outputText(body: ResponsesBody): string {
  if (body.output_text?.trim()) return body.output_text.trim();
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text?.trim()) return content.text.trim();
    }
  }
  return "";
}

/**
 * Segments are one sentence long, so this calls the Responses API directly
 * rather than through the project's background-polling helper — polling a
 * job queue per sentence would take minutes for a single page.
 */
export async function askOpenAI(prompt: string, model: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY sunucu ortamında tanımlı değil.");

  const response = await fetchWithRetry(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: prompt }),
      cache: "no-store",
    },
    { upstream: "OpenAI (çeviri)", timeoutMs: integerEnv("OPENAI_RESPONSE_TIMEOUT_MS", 120_000), maxAttempts: 3 },
  );

  const body = (await response.json()) as ResponsesBody;
  if (!response.ok) throw new Error(body.error?.message ?? `OpenAI HTTP ${response.status}`);
  const text = outputText(body);
  if (!text) throw new Error("OpenAI boş yanıt döndü.");
  return text;
}

export type SegmentSource = "tm-exact" | "tm-fuzzy" | "engine" | "untouched";

export type TranslatedSegment = {
  id: string;
  text: string;
  translation: string;
  source: SegmentSource;
  score: number | null;
  terms: TermHit[];
  forbidden: TermHit[];
  /** Informational provenance, shown but never counted as a problem. */
  note: string | null;
  /** A QA problem a human must look at before this document goes out. */
  warning: string | null;
};

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

function buildPrompt(input: {
  text: string;
  sourceLang: string;
  targetLang: string;
  terms: TermHit[];
  forbidden: TermHit[];
  similar: Array<{ source_text: string; target_text: string; score: number }>;
  instructions: string | null;
}): string {
  const lines: string[] = [];
  lines.push(
    `Translate the segment from ${input.sourceLang} to ${input.targetLang}.`,
    "This is an official regulatory document. Translate faithfully; do not summarise, explain or add anything.",
    "Return ONLY the translated text, with no quotes and no commentary.",
  );

  const keep = protectedSpans(input.text);
  if (keep.length) {
    lines.push("", "Copy these EXACTLY as they appear, character for character:");
    for (const span of keep) lines.push(`- ${span}`);
  }

  if (input.terms.length) {
    lines.push("", "Required terminology:");
    for (const term of input.terms) lines.push(`- "${term.sourceText}" must become "${term.targetText}"`);
  }

  if (input.forbidden.length) {
    lines.push("", "NEVER use these words in the translation:");
    for (const term of input.forbidden) lines.push(`- ${term.targetText}`);
  }

  if (input.similar.length) {
    lines.push("", "How similar sentences were translated before (match this style):");
    for (const match of input.similar) {
      lines.push(`- "${match.source_text}" -> "${match.target_text}"`);
    }
  }

  if (input.instructions?.trim()) {
    lines.push(
      "",
      "Standing instructions the customer gave for this document. Follow them, except where they contradict the required terminology above:",
      input.instructions.trim(),
    );
  }

  lines.push("", "Segment:", input.text);
  return lines.join("\n");
}

/**
 * Cascade from spec 6.1: a high translation-memory match is reused verbatim so
 * repeat work stays identical to what was already delivered; only genuinely new
 * text reaches the engine, and it reaches it carrying the memory and glossary.
 */
export async function translateSegment(
  segment: { id: string; text: string },
  options: {
    sourceLang: string;
    targetLang: string;
    model: string;
    /**
     * Free-text instructions the customer typed for this document. They reach
     * the engine prompt only. A verbatim memory hit is text that was already
     * delivered and approved, so an instruction does not rewrite it — the chat
     * reply says so explicitly rather than letting the user assume otherwise.
     */
    instructions?: string | null;
  },
): Promise<TranslatedSegment> {
  const query = {
    sourceText: segment.text,
    sourceLang: options.sourceLang,
    targetLang: options.targetLang,
  };

  const [matches, termHits] = await Promise.all([
    searchTm({ ...query, minScore: 0.6, limit: 5 }),
    lookupTerms(query),
  ]);

  const best = matches[0];
  const base = {
    id: segment.id,
    text: segment.text,
    terms: termHits.preferred,
    forbidden: termHits.forbidden,
  };

  if (best && matchTier(best.score) === "exact") {
    return {
      ...base,
      translation: best.target_text,
      source: best.score >= 1 ? "tm-exact" : "tm-fuzzy",
      score: best.score,
      note: `Bellekten alındı — ${best.project_names.length} projede kullanılmış`,
      warning: suspiciousTarget(segment.text, best.target_text),
    };
  }

  const prompt = buildPrompt({
    text: segment.text,
    sourceLang: options.sourceLang,
    targetLang: options.targetLang,
    terms: termHits.preferred,
    forbidden: termHits.forbidden,
    similar: matches.slice(0, 3),
    instructions: options.instructions ?? null,
  });

  const translation = await askOpenAI(prompt, options.model);

  const problems: string[] = [];
  const missing = missingProtected(segment.text, translation);
  if (missing.length) problems.push(`Kaynaktaki şu ifadeler çeviride yok: ${missing.join(", ")}`);
  const violated = violatedTerms(translation, termHits.forbidden);
  if (violated.length) problems.push(`Yasaklı terim kullanılmış: ${violated.map((t) => t.targetText).join(", ")}`);
  const short = suspiciousTarget(segment.text, translation);
  if (short) problems.push(short);

  return {
    ...base,
    translation,
    source: "engine",
    score: best ? best.score : null,
    note: termHits.preferred.length
      ? `${termHits.preferred.length} terim kuralı uygulandı`
      : null,
    warning: problems.length ? problems.join(" · ") : null,
  };
}
