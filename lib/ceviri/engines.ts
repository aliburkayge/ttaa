import { fetchWithRetry, integerEnv } from "../upstream";
import type { TermHit } from "./term-store";
import { missingProtected, presentTerms, protectedSpans, violatedTerms } from "./qa";

/**
 * Çeviri motorları, adaptörün arkasında (spec 6.1-6.2).
 *
 * OpenAI translate.ts içinde çağrılır, çünkü bellek eşleşmelerini ve terim
 * listesini isteminde taşıyan tek motor odur. Buradaki motorlar ona ikinci
 * görüş olarak eşlik eder; sonuçları aşağıdaki hakemden geçer.
 *
 * DeepL gerçek ve çalışıyor. Gemini için anahtar yok; çağrılırsa sessizce boş
 * metin dönmek yerine açıkça hata verir.
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
  /** Her okumada ortamdan hesaplanır; anahtar eklenince yeniden başlatma yeter. */
  readonly configured: boolean;
  translate(text: string, context: EngineContext): Promise<string>;
};

export type Verdict = {
  chosen: EngineCandidate | null;
  /** Neden bu aday seçildi; kayda yazılır (spec ilke 2: her segment izlenebilir). */
  reason: string;
  /** Yasaklı terim veya eksik korunan ifade yüzünden elenenler. */
  rejected: Array<{ engine: string; reason: string }>;
  /** Kurallardan geçen ama seçilmeyen, metni farklı adaylar — inceleyene gösterilir. */
  alternatives: EngineCandidate[];
  /** Hiçbir aday kurallardan geçemediyse true — insan bakmalı. */
  needsHuman: boolean;
};

function notImplemented(name: string, envVar: string): Engine["translate"] {
  return async () => {
    throw new Error(
      `${name} adaptörü henüz uygulanmadı. ${envVar} tanımlandıktan sonra lib/ceviri/engines.ts içinde doldurulacak.`,
    );
  };
}

/** DeepL'de ayrı varyantı olmayan, İngiliz yazımını izleyen İngilizceler. */
const BRITISH_SPELLING = new Set(["GB", "AU", "IE", "NZ", "ZA", "IN"]);

/**
 * DeepL dil kodları: kaynakta yalnızca ana dil ("EN"), hedefte İngilizce ve
 * Portekizce için bölge zorunlu ("EN-US", "PT-BR"). DeepL yalnızca ABD ve
 * İngiltere İngilizcesini bilir: Avustralya, İrlanda, Yeni Zelanda, Güney
 * Afrika ve Hindistan İngiliz yazımını, Kanada ABD yazımını izler. Diğer
 * hedefler ana dil.
 */
export function deeplLang(tag: string, role: "source" | "target"): string {
  const [primary, region] = tag.split("-");
  const base = primary.toUpperCase();
  if (role === "source") return base;
  if (base === "EN") return BRITISH_SPELLING.has(region?.toUpperCase() ?? "") ? "EN-GB" : "EN-US";
  if (base === "PT") return region?.toUpperCase() === "PT" ? "PT-PT" : "PT-BR";
  return base;
}

/** ":fx" ile biten anahtar ücretsiz plandır ve ayrı bir sunucuya gider. */
export function deeplEndpoint(key: string): string {
  return key.endsWith(":fx")
    ? "https://api-free.deepl.com/v2/translate"
    : "https://api.deepl.com/v2/translate";
}

type DeeplBody = { translations?: Array<{ text?: string }>; message?: string };

async function deeplTranslate(text: string, context: EngineContext): Promise<string> {
  const key = process.env.DEEPL_API_KEY?.trim();
  if (!key) throw new Error("DEEPL_API_KEY sunucu ortamında tanımlı değil.");

  const response = await fetchWithRetry(
    deeplEndpoint(key),
    {
      method: "POST",
      headers: { Authorization: `DeepL-Auth-Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: [text],
        source_lang: deeplLang(context.sourceLang, "source"),
        target_lang: deeplLang(context.targetLang, "target"),
        // Resmi evrak: cümle bölme DeepL'e bırakılmaz, segment bizim
        // ayırdığımız gibi gider ve gelir.
        split_sentences: "0",
        preserve_formatting: true,
      }),
      cache: "no-store",
    },
    {
      upstream: "DeepL",
      timeoutMs: integerEnv("DEEPL_TIMEOUT_MS", 30_000),
      maxAttempts: 3,
      // Çeviri isteği yan etkisizdir; aynı metni ikinci kez göndermek güvenli.
      retryUnsafe: true,
    },
  );

  const body = (await response.json().catch(() => ({}))) as DeeplBody;
  if (response.status === 456) throw new Error("DeepL aylık karakter kotası doldu.");
  if (!response.ok) throw new Error(body.message ?? `DeepL HTTP ${response.status}`);
  const translated = body.translations?.[0]?.text?.trim();
  if (!translated) throw new Error("DeepL boş yanıt döndü.");
  return translated;
}

export const DEEPL_ENGINE: Engine = {
  id: "deepl",
  label: "DeepL",
  get configured() {
    return Boolean(process.env.DEEPL_API_KEY?.trim());
  },
  translate: deeplTranslate,
};

export const GEMINI_ENGINE: Engine = {
  id: "gemini",
  label: "Gemini",
  get configured() {
    return Boolean(process.env.GEMINI_API_KEY?.trim());
  },
  translate: notImplemented("Gemini", "GEMINI_API_KEY"),
};

/** Yapılandırılmış ek motorları döner. OpenAI çağıran tarafça eklenir. */
export function configuredEngines(): Engine[] {
  return [DEEPL_ENGINE, GEMINI_ENGINE].filter((engine) => engine.configured);
}

export type EngineStatus = { id: string; label: string; on: boolean };

/** Arayüz ve sohbet için: hangi motor gerçekten açık. */
export function engineStatus(): EngineStatus[] {
  return [
    { id: "openai", label: "OpenAI", on: Boolean(process.env.OPENAI_API_KEY?.trim()) },
    ...[DEEPL_ENGINE, GEMINI_ENGINE].map((engine) => ({
      id: engine.id,
      label: engine.label,
      on: engine.configured,
    })),
  ];
}

/**
 * Hakem (spec 6.2). Serbest değil, kısıtlı:
 *
 * 1. Hata veren, yasaklı terim içeren veya kaynaktaki korunan ifadeyi (ruhsat
 *    kodu, miktar, tarih) kaybeden aday, karşılaştırmaya girmeden elenir.
 * 2. Kalanlar arasından en çok motorun aynı metinde uzlaştığı seçilir.
 * 3. Uzlaşma yoksa zorunlu terimlerden daha çoğunu kullanan seçilir.
 * 4. O da eşitse aday sırası belirler — çağıran, bellek ve terim listesini
 *    istemde taşıyan motoru başa koyar.
 *
 * "Hangisi daha akıcı" diye seçim yapılmaz. İki motorun farklı ama kurallara
 * uygun metin üretmesi normaldir; bu yüzden ayrışma tek başına insana
 * yönlendirmez, seçilmeyen metin alternatif olarak inceleyene gösterilir.
 */
export function arbitrate(
  source: string,
  candidates: EngineCandidate[],
  forbidden: TermHit[],
  required: TermHit[] = [],
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
      alternatives: [],
      needsHuman: true,
    };
  }

  // Aynı metni üreten adaylar tek grupta; gruplar ilk görülme sırasını korur.
  const groups = new Map<string, EngineCandidate[]>();
  for (const candidate of eligible) {
    const key = candidate.text.trim();
    const list = groups.get(key);
    if (list) list.push(candidate);
    else groups.set(key, [candidate]);
  }

  const ranked = [...groups.values()].map((group, order) => ({
    group,
    order,
    terms: presentTerms(group[0].text, required).length,
  }));
  ranked.sort(
    (a, b) => b.group.length - a.group.length || b.terms - a.terms || a.order - b.order,
  );

  const best = ranked[0];
  const runnerUp = ranked[1];
  const reasonParts: string[] = [];
  if (best.group.length > 1) {
    reasonParts.push(
      `${best.group.length} motor aynı metinde uzlaştı (${best.group.map((c) => c.engine).join(", ")})`,
    );
  } else if (!runnerUp) {
    reasonParts.push(`tek geçerli aday: ${best.group[0].engine}`);
  } else if (best.terms > runnerUp.terms) {
    reasonParts.push(
      `${best.group[0].engine} seçildi: ${required.length} zorunlu terimden ${best.terms} tanesini kullanıyor, ${runnerUp.group[0].engine} ${runnerUp.terms}`,
    );
  } else {
    reasonParts.push(`${best.group[0].engine} seçildi: öncelikli motor`);
  }
  if (rejected.length) reasonParts.push(`${rejected.length} aday elendi`);
  const protectedCount = protectedSpans(source).length;
  if (protectedCount) reasonParts.push(`${protectedCount} korunan ifade doğrulandı`);

  return {
    chosen: best.group[0],
    reason: reasonParts.join(" · "),
    rejected,
    alternatives: ranked.slice(1).map((entry) => entry.group[0]),
    needsHuman: false,
  };
}
