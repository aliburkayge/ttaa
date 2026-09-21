import { fetchWithRetry, integerEnv } from "../upstream";
import { searchTm, matchTier } from "./tm-store";
import { lookupTerms, type TermHit } from "./term-store";
import { keepUntranslated, missingProtected, tidyTarget, protectedSpans, suspiciousTarget, violatedTerms } from "./qa";
import { arbitrate, configuredEngines, type EngineCandidate } from "./engines";

// Testler ve eski çağıranlar kuralları buradan içe aktarıyor.
export { keepUntranslated, tidyTarget, missingProtected, protectedSpans, suspiciousTarget, violatedTerms };

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
  /** Which engine produced the text; null for memory hits. */
  engine?: string | null;
  /** Rule-compliant texts from other engines that were not chosen. */
  alternatives?: Array<{ engine: string; text: string }>;
  /** Informational provenance, shown but never counted as a problem. */
  note: string | null;
  /** A QA problem a human must look at before this document goes out. */
  warning: string | null;
};

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
      translation: tidyTarget(segment.text, best.target_text),
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

  const engineContext = {
    sourceLang: options.sourceLang,
    targetLang: options.targetLang,
    terms: termHits.preferred,
    forbidden: termHits.forbidden,
    similar: matches.slice(0, 3),
  };

  // OpenAI başta: bellek eşleşmelerini, terim listesini ve kullanıcı
  // talimatını taşıyan tek motor o. Hakem eşitlikte sırayı esas alır.
  const runners: Array<{ engine: string; run: () => Promise<string> }> = [
    { engine: "openai", run: () => askOpenAI(prompt, options.model) },
    ...configuredEngines().map((engine) => ({
      engine: engine.id,
      run: () => engine.translate(segment.text, engineContext),
    })),
  ];

  const settled = await Promise.allSettled(runners.map((runner) => runner.run()));
  const candidates: EngineCandidate[] = settled.map((outcome, index) =>
    outcome.status === "fulfilled"
      ? { engine: runners[index].engine, text: outcome.value, error: null }
      : {
          engine: runners[index].engine,
          text: "",
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        },
  );

  const verdict = arbitrate(segment.text, candidates, termHits.forbidden, termHits.preferred);

  // Hiçbir aday kurallardan geçemediyse bile inceleyene boş satır verilmez:
  // metin üreten ilk aday gösterilir, neden geçemediği uyarıda yazar.
  const fallback = candidates.find((candidate) => candidate.text.trim());
  const chosen = verdict.chosen ?? fallback;
  if (!chosen) {
    throw new Error(verdict.rejected.map((r) => `${r.engine}: ${r.reason}`).join(" · "));
  }
  const translation = tidyTarget(segment.text, chosen.text);

  const problems: string[] = [];
  if (verdict.needsHuman) {
    problems.push(
      `Hiçbir motor kurallardan geçemedi (${verdict.rejected.map((r) => `${r.engine}: ${r.reason}`).join("; ")})`,
    );
  }
  const missing = missingProtected(segment.text, translation);
  if (missing.length) problems.push(`Kaynaktaki şu ifadeler çeviride yok: ${missing.join(", ")}`);
  const violated = violatedTerms(translation, termHits.forbidden);
  if (violated.length) problems.push(`Yasaklı terim kullanılmış: ${violated.map((t) => t.targetText).join(", ")}`);
  const short = suspiciousTarget(segment.text, translation);
  if (short) problems.push(short);

  const noteParts = [verdict.chosen ? verdict.reason : null];
  if (termHits.preferred.length) noteParts.push(`${termHits.preferred.length} terim kuralı`);

  return {
    ...base,
    translation,
    source: "engine",
    engine: chosen.engine,
    alternatives: verdict.alternatives.map(({ engine, text }) => ({ engine, text })),
    score: best ? best.score : null,
    note: noteParts.filter(Boolean).join(" · ") || null,
    warning: problems.length ? problems.join(" · ") : null,
  };
}
