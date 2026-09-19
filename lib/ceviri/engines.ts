import type { TermHit } from "./term-store";
import { missingProtected, protectedSpans, violatedTerms } from "./translate";

/**
 * Çeviri motorları, adaptörün arkasında (spec 6.1-6.2).
 *
 * OpenAI gerçek ve çalışıyor. DeepL ve Gemini için anahtar yok; adaptörleri
 * tanımlı ama gövdeleri bilinçli olarak boş — çağrılırlarsa sessizce boş metin
 * dönmek yerine açıkça hata veriyorlar. Anahtarlar geldiğinde yalnızca bu
 * dosya değişir; hakem ve QA katmanı aynı kalır.
 */

export type EngineCandidate = {
  engine: string;
  text: string;
  /** Motor çağrısı başarısızsa doldurulur; text boş kalır. */
  error: string | null;
};

export type EngineContext = {
  sourceLang: string;
  targetLang: string;
  terms: TermHit[];
  forbidden: TermHit[];
  similar: Array<{ source_text: string; target_text: string; score: number }>;
};

export type Engine = {
  id: string;
  label: string;
  configured: boolean;
  translate(text: string, context: EngineContext): Promise<string>;
};

export type Verdict = {
  chosen: EngineCandidate | null;
  /** Neden bu aday seçildi; kayda yazılır (spec ilke 2: her segment izlenebilir). */
  reason: string;
  /** Yasaklı terim veya eksik korunan ifade yüzünden elenenler. */
  rejected: Array<{ engine: string; reason: string }>;
  /** Hiçbir aday temiz değilse true — insan bakmalı. */
  needsHuman: boolean;
};

function notImplemented(name: string, envVar: string): Engine["translate"] {
  return async () => {
    throw new Error(
      `${name} adaptörü henüz uygulanmadı. ${envVar} tanımlandıktan sonra lib/ceviri/engines.ts içinde doldurulacak.`,
    );
  };
}

export const DEEPL_ENGINE: Engine = {
  id: "deepl",
  label: "DeepL",
  configured: Boolean(process.env.DEEPL_API_KEY?.trim()),
  translate: notImplemented("DeepL", "DEEPL_API_KEY"),
};

export const GEMINI_ENGINE: Engine = {
  id: "gemini",
  label: "Gemini",
  configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
  translate: notImplemented("Gemini", "GEMINI_API_KEY"),
};

/** Yapılandırılmış motorları döner. OpenAI çağıran tarafça eklenir. */
export function configuredEngines(): Engine[] {
  return [DEEPL_ENGINE, GEMINI_ENGINE].filter((engine) => engine.configured);
}

/**
 * Hakem (spec 6.2). Serbest değil, kısıtlı:
 *
 * 1. Yasaklı terim içeren aday, karşılaştırmaya girmeden elenir.
 * 2. Kaynaktaki korunan ifadeyi (ruhsat kodu, miktar, tarih) kaybeden aday elenir.
 * 3. Kalanlar arasından en çok motorun üzerinde uzlaştığı metin seçilir;
 *    beraberlikte motor sırası belirleyicidir.
 *
 * "Hangisi daha akıcı" diye seçim yapılmaz — resmi evrakta akıcılık değil,
 * kurallara uygunluk ve tutarlılık belirleyicidir.
 */
export function arbitrate(
  source: string,
  candidates: EngineCandidate[],
  forbidden: TermHit[],
): Verdict {
  const rejected: Verdict["rejected"] = [];
  const eligible: EngineCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.error || !candidate.text.trim()) {
      rejected.push({ engine: candidate.engine, reason: candidate.error ?? "boş yanıt" });
      continue;
    }
    const violations = violatedTerms(candidate.text, forbidden);
    if (violations.length) {
      rejected.push({
        engine: candidate.engine,
        reason: `yasaklı terim: ${violations.map((hit) => hit.targetText).join(", ")}`,
      });
      continue;
    }
    const missing = missingProtected(source, candidate.text);
    if (missing.length) {
      rejected.push({
        engine: candidate.engine,
        reason: `korunan ifade kayıp: ${missing.join(", ")}`,
      });
      continue;
    }
    eligible.push(candidate);
  }

  if (eligible.length === 0) {
    return {
      chosen: null,
      reason: "Hiçbir aday kurallardan geçemedi.",
      rejected,
      needsHuman: true,
    };
  }

  const tally = new Map<string, EngineCandidate[]>();
  for (const candidate of eligible) {
    const key = candidate.text.trim();
    const list = tally.get(key);
    if (list) list.push(candidate);
    else tally.set(key, [candidate]);
  }

  let best: EngineCandidate[] = [];
  for (const group of tally.values()) if (group.length > best.length) best = group;

  const agreed = best.length;
  const protectedCount = protectedSpans(source).length;
  const reasonParts = [
    agreed > 1
      ? `${agreed} motor aynı metinde uzlaştı (${best.map((c) => c.engine).join(", ")})`
      : `tek geçerli aday: ${best[0].engine}`,
  ];
  if (rejected.length) reasonParts.push(`${rejected.length} aday elendi`);
  if (protectedCount) reasonParts.push(`${protectedCount} korunan ifade doğrulandı`);

  return {
    chosen: best[0],
    reason: reasonParts.join(" · "),
    rejected,
    // Tek motor varken uzlaşma diye bir şey yoktur; ayrışma ancak 2+ motorda anlamlıdır.
    needsHuman: eligible.length > 1 && agreed === 1,
  };
}
