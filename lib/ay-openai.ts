import { parseResilientJson } from "./json";
import { auditKeywordPolicy } from "./keyword-policy";
import type { ResearchedLink } from "./link-catalog";
import type { GeneratedArticle } from "./openai";
import { requestOpenAIResponse, type OpenAIResponseOptions } from "./openai-background";

export type AyGenerationBrief = {
  topic: string;
  primaryKeyword?: string;
  desiredWordCount?: number | string;
  audience: string;
  country: string;
  documentType: string;
  sourceText?: string;
  mode?: "new" | "update";
  length?: "standard" | "guide" | "service";
};

export type AyGenerationTrace = {
  provider: "openai";
  brand: "ay-tercume";
  model: string;
  writerResponseId: string;
  editorResponseId: string;
  repairResponseId?: string;
  webSearchUsed: boolean;
  topicLockEnforced: true;
  generatedAt: string;
  usage: {
    writerInputTokens: number;
    writerOutputTokens: number;
    editorInputTokens: number;
    editorOutputTokens: number;
    repairInputTokens?: number;
    repairOutputTokens?: number;
  };
};

type TopicLock = {
  centralSubject: string;
  primaryModifier: string;
  supportingSubjects: string[];
  cityOrJurisdiction: string;
  documentType: string;
  formalProcess: string;
  searchIntent: "hizmet" | "bilgilendirici" | "işlemsel" | "yerel" | "belge-kullanımı";
  mainAction: string;
  primaryKeyword: string;
};

type TopicAudit = {
  topicMatch: number;
  primaryTopicCoverage: number;
  topicDrift: number;
  searchIntentMatch: number;
  repetition: number;
  legalClaimSafety: number;
};

type ModelPackage = Omit<GeneratedArticle, "imagePrompt"> & { topicLock: TopicLock; audit: TopicAudit };

type OpenAIResponse = {
  id?: string;
  status?: string;
  error?: { message?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output_text?: string;
  output?: Array<{
    type?: string;
    action?: { sources?: Array<{ title?: string; url?: string }> };
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

const stringArray = { type: "array", items: { type: "string" } } as const;

const AY_ARTICLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["topicLock", "eyebrow", "title", "intro", "tldr", "sections", "faqs", "cta", "focusKeyword", "secondaryKeywords", "seoTitle", "metaDescription", "slug", "internalLinkSuggestions", "imageSuggestions", "audit"],
  properties: {
    topicLock: {
      type: "object",
      additionalProperties: false,
      required: ["centralSubject", "primaryModifier", "supportingSubjects", "cityOrJurisdiction", "documentType", "formalProcess", "searchIntent", "mainAction", "primaryKeyword"],
      properties: {
        centralSubject: { type: "string" },
        primaryModifier: { type: "string" },
        supportingSubjects: stringArray,
        cityOrJurisdiction: { type: "string" },
        documentType: { type: "string" },
        formalProcess: { type: "string" },
        searchIntent: { type: "string", enum: ["hizmet", "bilgilendirici", "işlemsel", "yerel", "belge-kullanımı"] },
        mainAction: { type: "string" },
        primaryKeyword: { type: "string" },
      },
    },
    eyebrow: { type: "string", description: "Konuya özgü, kısa Türkçe üst etiket." },
    title: { type: "string", description: "Tek, doğal, konuya tam bağlı H1." },
    intro: { type: "string", description: "Focus keywordü doğal biçimde içeren 110-170 kelimelik doğrudan giriş." },
    tldr: { ...stringArray, minItems: 4, maxItems: 6, description: "Toplam 70-130 kelimelik 4-6 kısa özet maddesi." },
    sections: {
      type: "array",
      minItems: 7,
      maxItems: 10,
      description: "Konuya göre dinamik seçilmiş, çakışmayan H2 bölümleri.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "body", "items"],
        properties: {
          title: { type: "string" },
          body: { type: "string", description: "HTML/Markdown içermeyen Türkçe düz metin; paragraflar çift satır sonuyla ayrılır." },
          items: { ...stringArray, maxItems: 6 },
        },
      },
    },
    faqs: {
      type: "array",
      minItems: 7,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "answer"],
        properties: { question: { type: "string" }, answer: { type: "string" } },
      },
    },
    cta: {
      type: "object",
      additionalProperties: false,
      required: ["title", "body", "buttonLabel"],
      properties: {
        title: { type: "string", description: "Belgenizi İncelemeye Gönderin olmalı." },
        body: { type: "string" },
        buttonLabel: { type: "string" },
      },
    },
    focusKeyword: { type: "string", description: "Tek ana arama niyetini temsil eden 1-7 kelimelik anahtar ifade." },
    secondaryKeywords: { ...stringArray, minItems: 3, maxItems: 5 },
    seoTitle: { type: "string", description: "Focus keywordü aynen içeren, AY Tercüme marka eki dahil 50-60 karakterlik SEO başlığı." },
    metaDescription: { type: "string", description: "Focus keywordü veya tanımlı yakın varyasyonu içeren 120-160 karakterlik açıklama." },
    slug: { type: "string", description: "Kısa, Türkçe karakter içermeyen, küçük harfli ve tireli URL slug." },
    internalLinkSuggestions: { ...stringArray, minItems: 3, maxItems: 6 },
    imageSuggestions: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["placement", "altText", "imagePrompt", "titleText", "caption", "description"],
        properties: {
          placement: { type: "string" },
          altText: { type: "string", description: "Ana keywordü doğal kullanan, yaklaşık 5-10 kelimelik kısa Türkçe alt text." },
          imagePrompt: { type: "string" },
          titleText: { type: "string", description: "Hizmet veya konu başlığı - AY Tercüme biçiminde doğal medya başlığı." },
          caption: { type: "string", description: "Görselin konusunu açıklayan kısa Türkçe cümle." },
          description: { type: "string", description: "Görselin temsil ettiği hizmet, belge veya süreci açıklayan Türkçe medya açıklaması." },
        },
      },
    },
    audit: {
      type: "object",
      additionalProperties: false,
      required: ["topicMatch", "primaryTopicCoverage", "topicDrift", "searchIntentMatch", "repetition", "legalClaimSafety"],
      properties: {
        topicMatch: { type: "number" },
        primaryTopicCoverage: { type: "number" },
        topicDrift: { type: "number" },
        searchIntentMatch: { type: "number" },
        repetition: { type: "number" },
        legalClaimSafety: { type: "number" },
      },
    },
  },
} as const;

function modelName() {
  return process.env.OPENAI_MODEL?.trim() || "gpt-5.5-2026-04-23";
}

function fold(value: string) {
  return value.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function outputText(response: OpenAIResponse) {
  if (response.output_text?.trim()) return response.output_text.trim();
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.refusal) throw new Error(`OpenAI içerik isteğini reddetti: ${content.refusal}`);
      if (content.type === "output_text" && content.text?.trim()) return content.text.trim();
    }
  }
  throw new Error(`OpenAI eksik yanıt verdi: ${response.error?.message || response.incomplete_details?.reason || response.status || "boş yanıt"}`);
}

// Kept for one release as a synchronous diagnostic fallback.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function createResponseLegacy(payload: Record<string, unknown>) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY .env.local dosyasında bulunamadı.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(240_000),
  });
  const body = parseResilientJson<OpenAIResponse>(await response.text(), "AY Tercüme OpenAI yanıtı");
  if (!response.ok) throw new Error(`OpenAI içerik üretimi durdu: ${body.error?.message || `HTTP ${response.status}`}`);
  return body;
}

async function createDurableResponse(payload: Record<string, unknown>, options: OpenAIResponseOptions) {
  return await requestOpenAIResponse(payload, options) as OpenAIResponse;
}

function sourceInventory(links: ResearchedLink[]) {
  return links.map((link, index) => `${index + 1}. [${link.source}] Tam anchor: "${link.anchor}" | URL: ${link.url} | Amaç: ${link.reason}`).join("\n");
}

function officialDomains(links: ResearchedLink[]) {
  return [...new Set(links.filter((link) => link.source === "official" && /^https:\/\//.test(link.url)).map((link) => new URL(link.url).hostname))];
}

function discoveredSources(response: OpenAIResponse): ResearchedLink[] {
  const links: ResearchedLink[] = [];
  for (const item of response.output || []) {
    for (const source of item.action?.sources || []) {
      if (!source.url || !/^https:\/\//.test(source.url)) continue;
      links.push({ anchor: (source.title || new URL(source.url).hostname).trim().slice(0, 120), url: source.url, reason: "Konuya ilişkin birincil kurumsal kaynak", source: "official" });
    }
  }
  return links;
}

function requestedWordCount(brief: AyGenerationBrief) {
  const exact = Number(brief.desiredWordCount);
  if (Number.isFinite(exact) && exact >= 800 && exact <= 4_000) return `yaklaşık ${Math.round(exact)} kelime (±%10)`;
  return brief.length === "guide" ? "1.800-2.500 kelime" : brief.length === "service" ? "1.300-1.900 kelime" : "1.200-1.700 kelime";
}

function visibleText(article: GeneratedArticle) {
  return [article.title, article.intro, ...article.tldr, ...article.sections.flatMap((section) => [section.title, section.body, ...section.items]), ...article.faqs.flatMap((faq) => [faq.question, faq.answer]), article.cta.title, article.cta.body].join(" ");
}

function occurrences(text: string, phrase: string) {
  const needle = fold(phrase);
  if (!needle || needle.split(" ").length < 2) return 0;
  return (` ${fold(text)} `.match(new RegExp(` ${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `, "g")) || []).length;
}

function deterministicGate(pkg: { article: GeneratedArticle; topicLock: TopicLock; audit: TopicAudit }, brief: AyGenerationBrief) {
  const issues = [...auditKeywordPolicy(pkg.article, brief).issues];
  const text = visibleText(pkg.article);
  const wordCount = fold(text).split(/\s+/).filter(Boolean).length;
  const keywordCount = occurrences(text, pkg.article.focusKeyword);
  const keywordLimit = Math.min(8, Math.max(4, Math.ceil(wordCount / 350)));
  const brandCount = (text.match(/AY Tercüme/gi) || []).length;
  const brandLimit = Math.max(7, Math.ceil(wordCount / 190) + 2);
  if (keywordCount > keywordLimit) issues.push(`Focus keyword tekrarı ${keywordCount}; üst sınır ${keywordLimit}.`);
  if (brandCount > brandLimit) issues.push(`AY Tercüme marka tekrarı ${brandCount}; üst sınır ${brandLimit}.`);
  if (pkg.article.tldr.length < 4 || pkg.article.tldr.length > 6) issues.push("TL;DR 4-6 madde olmalı.");
  if (pkg.article.sections.length < 7 || pkg.article.sections.length > 10) issues.push("İçerik 7-10 dinamik H2 bölümü içermeli.");
  if (pkg.article.faqs.length < 7 || pkg.article.faqs.length > 10) issues.push("Dinamik FAQ sayısı 7-10 olmalı.");
  const questions = pkg.article.faqs.map((faq) => fold(faq.question));
  if (!questions[0]?.includes("ay tercume") || !/(nasil|yardim|destek)/.test(questions[0])) issues.push("İlk FAQ, AY Tercüme'nin bu konuda nasıl yardımcı olduğunu açıklamalı.");
  if (questions.filter((question) => question.includes("ay tercume")).length < 2) issues.push("En az iki FAQ sorusu AY Tercüme'yi açıkça anmalı.");
  if (!questions.some((question) => /(belge|evrak).*(gonder|paylas)|(teklif|fiyat).*(icin|almak)/.test(question))) issues.push("Bir FAQ, inceleme veya teklif için ne gönderileceğini açıklamalı.");
  if (new Set(questions).size !== questions.length) issues.push("FAQ soruları benzersiz olmalı.");
  if (pkg.article.imageSuggestions.length !== 2) issues.push("Bir featured ve bir içerik görsel planı olmalı.");
  if (/\bofis/.test(fold(text))) issues.push("Blog metninde ofis veya fiziksel lokasyon karşılaştırması yapılamaz; hizmet erişimi doğrudan ve doğal anlatılmalı.");
  if (pkg.audit.topicMatch < 85 || pkg.audit.primaryTopicCoverage < 65 || pkg.audit.topicDrift > 20 || pkg.audit.searchIntentMatch < 85 || pkg.audit.repetition > 15 || pkg.audit.legalClaimSafety < 90) issues.push("Konu kilidi veya resmî iddia güvenliği eşiği geçilmedi.");
  return { passes: issues.length === 0, issues };
}

function parsePackage(response: OpenAIResponse, approvedLinks: ResearchedLink[], brief: AyGenerationBrief) {
  const parsed = parseResilientJson<ModelPackage>(outputText(response), "AY Tercüme yapılandırılmış içerik paketi");
  if (!parsed.title || !parsed.intro || !parsed.topicLock || !parsed.audit || !Array.isArray(parsed.sections) || !Array.isArray(parsed.faqs)) throw new Error("OpenAI eksik bir Ay Tercüme içerik paketi döndürdü.");
  const approvedAnchors = new Set(approvedLinks.filter((link) => link.source === "internal").map((link) => fold(link.anchor)));
  const selectedAnchors = parsed.internalLinkSuggestions.map((item) => item.trim()).filter((anchor) => approvedAnchors.has(fold(anchor))).slice(0, 6);
  for (const fallback of approvedLinks.filter((link) => link.source === "internal")) {
    if (selectedAnchors.length >= 3) break;
    if (!selectedAnchors.some((anchor) => fold(anchor) === fold(fallback.anchor))) selectedAnchors.push(fallback.anchor);
  }
  const focusKeyword = brief.primaryKeyword?.trim() || parsed.focusKeyword.trim();
  const normalizedFocus = fold(focusKeyword);
  const secondaryKeywords = parsed.secondaryKeywords.map((item) => item.trim()).filter((item, index, list) => Boolean(item) && fold(item) !== normalizedFocus && list.findIndex((candidate) => fold(candidate) === fold(item)) === index).slice(0, 5);
  const imageSuggestions = parsed.imageSuggestions.slice(0, 2);
  const article: GeneratedArticle = {
    eyebrow: parsed.eyebrow,
    title: parsed.title,
    intro: parsed.intro,
    tldr: parsed.tldr.slice(0, 6),
    sections: parsed.sections.slice(0, 10).map((section) => ({ ...section, items: section.items || [] })),
    faqs: parsed.faqs.slice(0, 10),
    cta: { ...parsed.cta, title: "Belgenizi İncelemeye Gönderin" },
    focusKeyword,
    secondaryKeywords,
    seoTitle: parsed.seoTitle.trim(),
    metaDescription: parsed.metaDescription.trim(),
    slug: parsed.slug.toLocaleLowerCase("tr-TR").replace(/[ıİ]/g, "i").replace(/[şŞ]/g, "s").replace(/[ğĞ]/g, "g").replace(/[üÜ]/g, "u").replace(/[öÖ]/g, "o").replace(/[çÇ]/g, "c").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 72),
    imagePrompt: imageSuggestions[0]?.imagePrompt || "",
    imageSuggestions,
    internalLinkSuggestions: selectedAnchors,
  };
  return { article, topicLock: parsed.topicLock, audit: parsed.audit };
}

const AY_TOPIC_LOCK_RULES = `
AY TERCÜME KONU KİLİDİ VE YAYIN KURALLARI
1. Başlığı yazmadan önce centralSubject, primaryModifier, belge/hizmet türü, şehir/ülke, resmî süreç, baskın arama niyeti ve okuyucunun ana eylemini topicLock içinde belirle. Analizi görünür metne taşıma.
2. Metnin en az %70'i başlıktaki tam hizmet, belge veya sürece doğrudan bağlı olsun. En fazla %20 pratik destek, en fazla %10 genel bağlam kullan. Göçmenlik, vize stratejisi, hukuk tavsiyesi veya ilgisiz hizmetlere kayma.
3. Varsayılan dil doğal Türkiye Türkçesidir. Kısa paragraflar, somut anlatım ve insan dili kullan. “Günümüzün küreselleşen dünyasında”, “diller arasında köprü” ve benzeri yapay girişleri kullanma.
4. Bir doğrudan giriş, 4-6 maddelik TL;DR, konuya göre dinamik 7-10 H2, 7-10 dinamik FAQ ve tek CTA üret. Her fikri yalnızca bir kez açıkla.
5. Yalnızca başlıkla gerçekten ilgili AY Tercüme hizmetlerini anlat. Bütün hizmetleri listeleyerek metni yatay genişletme.
6. Apostil, yeminli tercüme, noter onayı, Dışişleri tasdiki, elçilik/konsolosluk tasdiki ve legalizasyonu birbirinin yerine kullanma. Gerekli işlem belge, ülke ve alıcı kurumun güncel talebine göre değişebilir.
7. Kesin kabul, vize sonucu, aynı gün teslim, sabit süre/ücret, en iyi/en ucuz veya resmî kurum niteliği iddia etme. Nihai kabul kararının alıcı kuruma ait olduğunu gerektiği yerde açıkla.
8. Blog metninde “ofis”, “fiziksel ofis”, “ofis varmış gibi”, “ofisimiz yok/bulunmuyor” veya başka şehirlerle fiziksel lokasyon karşılaştırması yapma. Ankara ve İstanbul’daki lokasyonlardan da bahsetme. Yerel bir başlıkta yalnızca kullanıcının belgeyi nasıl paylaşacağını, inceleme, çeviri hazırlığı, onay sırası ve süreç planlamasının nasıl yürüdüğünü doğal biçimde anlat. Bu kural FAQ soruları, cevapları, TL;DR, madde listeleri ve CTA için de geçerlidir.
9. AY Tercüme'yi uygun tercüman seçimi, terminoloji, çeviri-kontrol süreci, belge ayrıntılarının doğrulanması, gerekirse noter/apostil/tasdik koordinasyonu ve teslim planlaması gibi somut faydalarla konumlandır.
10. FAQ'lar şablon sorular değildir. İlk soru AY Tercüme'nin tam konuda nasıl yardımcı olduğunu sorsun; en az iki soru markayı açıkça ansın. Konuya özel 2-3 soru, işlem/belgeye özel 2-3 soru ve iki işlem niyeti sorusu üret. En az biri inceleme/teklif için ne gönderileceğini açıklasın.
11. FAQ cevapları doğrudan cümleyle başlasın, çoğunlukla 40-90 kelime olsun ve birbirini tekrar etmesin. Başlık resmî süreç değilse FAQ'ların %30'undan fazlasını noter/apostil/tasdik sorularına ayırma.
12. Tek focusKeyword seç. Kullanıcı verdiyse aynen kopyala; aksi hâlde 1-7 kelimelik doğal ifade üret. H1 veya ilk H2'de ve ilk paragrafta aynen geçir. 3-5 benzersiz secondaryKeywords üret.
13. SEO title focus keywordü aynen içersin ve AY Tercüme marka eki dahil 50-60 karakter olsun. Meta description 120-160 karakter olsun ve focus keywordü veya tanımlı varyasyonu içersin. Slug kısa, küçük harfli, tireli ve focus terimlerini korusun.
14. Focus keywordü her H2'ye sıkıştırma; en fazla üç H2'de exact match kullan. Bölümlere aynı kalıpla başlama. Marka ve anahtar kelime tekrarını doğal düzeyde tut.
15. Yalnızca onaylı internal anchor ifadelerini seç. Resmî kaynak bulgularını doğal paragraf içinde anlat; URL, citation token, araştırma notu, HTML veya Markdown döndürme.
16. İki farklı görsel planı üret: featured ve inline. Her biri için prompt, 5-10 kelimelik doğal alt text, “konu - AY Tercüme” medya title'ı, kısa caption ve açıklayıcı description yaz. Beyaz, #43cc9b mint, #009fe4 mavi ve #0f0b08 koyu vurgu paleti; temiz kurumsal belge estetiği; başlıkla doğrudan ilgili belge/süreç sembolleri kullan. Sahte mühür, devlet logosu, okunabilir kişisel veri, gerçek pasaport numarası, kalabalık stok ofis fotoğrafı veya yanıltıcı resmî belge üretme.
17. CTA başlığı “Belgenizi İncelemeye Gönderin” olsun. Belge türü, dil çifti, kullanım ülkesi/kurumu, süre ve gerekli onay bilgisini istemeyi konuya göre kısa anlat.
18. Görünür metinde audit, topicLock, prompt, kaynak envanteri veya üretim süreci hakkında konuşma.
19. Sonucu sessizce denetle: konu uyumu ≥90, ana konu kapsamı ≥70, drift ≤15, arama niyeti ≥90, tekrar ≤10, resmî iddia güvenliği ≥95. Eksikse dönmeden önce düzelt.
20. Başlık eski içerik güncellemesi ise ana arama niyetini ve yararlı özgün bilgiyi koru; zayıf, yinelenen ve güncelliği doğrulanamayan iddiaları yeniden yaz.`;

export type AyGenerationRunOptions = {
  jobId?: string;
  responseIds?: Record<string, string>;
  onResponseId?: OpenAIResponseOptions["onResponseId"];
};

export async function generateAyArticle(brief: AyGenerationBrief, links: ResearchedLink[], run: AyGenerationRunOptions = {}) {
  const model = modelName();
  const domains = officialDomains(links);
  const webTool: Record<string, unknown> = { type: "web_search", search_context_size: "high" };
  if (domains.length) webTool.filters = { allowed_domains: domains };
  const inventory = sourceInventory(links);

  const writer = await createDurableResponse({
    model,
    reasoning: { effort: "medium" },
    tools: [webTool],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    input: [
      { role: "system", content: `Sen AY Tercüme için çalışan kıdemli Türkçe SEO, AEO, GEO ve dönüşüm odaklı içerik editörüsün. AY Tercüme 2013'ten beri yeminli/noter onaylı tercüme, apostil/tasdik ve uzmanlık çevirileri için destek veren profesyonel bir tercüme bürosudur. Blog yazılarında fiziksel lokasyon veya ofis açıklaması yapma. Resmî kurum gibi konuşma. Sadece yapılandırılmış nesneyi döndür.\n${AY_TOPIC_LOCK_RULES}` },
      { role: "user", content: `${brief.mode === "update" ? "Aşağıdaki mevcut içeriği esaslı biçimde geliştir" : "Yeni ve özgün bir içerik oluştur"}.\nBaşlık: ${brief.topic}\nPrimary keyword: ${brief.primaryKeyword?.trim() || "Başlıktan dikkatle belirle"}\nHedef ülke/şehir: ${brief.country || "Başlıktan gerekiyorsa belirle"}\nHedef okuyucu: ${brief.audience || "Arama niyetinden belirle"}\nBelge veya hizmet: ${brief.documentType || "Başlıktan belirle"}\nKelime hedefi: ${requestedWordCount(brief)}\nKaynak metin: ${brief.sourceText?.trim().slice(0, 12_000) || "Yok"}\n\nOnaylı AY Tercüme iç bağlantıları ve birincil resmî kaynaklar:\n${inventory}\n\nÖnce web aramasıyla yalnızca güncel, resmî ve başlıkla ilgili iddiaları doğrula. Başlık içerik sınırıdır.` },
    ],
    text: { format: { type: "json_schema", name: "ay_tercume_topic_locked_article", strict: true, schema: AY_ARTICLE_SCHEMA } },
    max_output_tokens: 22_000,
  }, { stage: "writer", idempotencyKey: run.jobId ? `${run.jobId}:writer` : undefined, resumeResponseId: run.responseIds?.writer, onResponseId: run.onResponseId });
  parsePackage(writer, links, brief);

  const editor = await createDurableResponse({
    model,
    reasoning: { effort: "high" },
    input: [
      { role: "system", content: `Sen AY Tercüme'nin son konu-kilidi, Türkçe doğallık ve resmî iddia güvenliği editörüsün. Drift, tekrar, şablon dil ve gereksiz hizmetleri sil. Focus keyword, dinamik FAQ, title/meta/slug ve marka kurallarını eksiksiz uygula. Yalnızca aynı yapılandırılmış nesneyi döndür.\n${AY_TOPIC_LOCK_RULES}` },
      { role: "user", content: `Brief:\n${JSON.stringify({ ...brief, sourceText: brief.sourceText?.slice(0, 12_000) || "" })}\n\nOnaylı link envanteri:\n${inventory}\n\nYazar paketi:\n${outputText(writer)}` },
    ],
    text: { format: { type: "json_schema", name: "ay_tercume_edited_article", strict: true, schema: AY_ARTICLE_SCHEMA } },
    max_output_tokens: 22_000,
  }, { stage: "editor", idempotencyKey: run.jobId ? `${run.jobId}:editor` : undefined, resumeResponseId: run.responseIds?.editor, onResponseId: run.onResponseId });

  let final = parsePackage(editor, links, brief);
  let gate = deterministicGate(final, brief);
  let repair: OpenAIResponse | undefined;
  let repairSource = outputText(editor);
  for (let attempt = 0; !gate.passes && attempt < 2; attempt += 1) {
    const repairStage = `repair-${attempt + 1}`;
    repair = await createDurableResponse({
      model,
      reasoning: { effort: "high" },
      input: [
        { role: "system", content: `Sen deterministik kalite kapısından dönmüş AY Tercüme içeriğini onaran son editörsün. Teşhislerin her birini düzelt, doğru olan bölümleri koru ve yalnızca aynı JSON şemasını döndür.\n${AY_TOPIC_LOCK_RULES}` },
        { role: "user", content: `Çözülmesi gereken teşhisler:\n- ${gate.issues.join("\n- ")}\n\nBrief:\n${JSON.stringify({ ...brief, sourceText: brief.sourceText?.slice(0, 12_000) || "" })}\n\nOnaylı linkler:\n${inventory}\n\nOnarılacak paket:\n${repairSource}` },
      ],
      text: { format: { type: "json_schema", name: "ay_tercume_repaired_article", strict: true, schema: AY_ARTICLE_SCHEMA } },
      max_output_tokens: 22_000,
    }, { stage: repairStage, idempotencyKey: run.jobId ? `${run.jobId}:${repairStage}` : undefined, resumeResponseId: run.responseIds?.[repairStage], onResponseId: run.onResponseId });
    repairSource = outputText(repair);
    final = parsePackage(repair, links, brief);
    gate = deterministicGate(final, brief);
  }
  if (!gate.passes) throw new Error(`İçerik kalite kapısı şu sorunları çözemedi: ${gate.issues.join("; ")}`);

  return {
    article: final.article,
    discoveredSources: discoveredSources(writer),
    trace: {
      provider: "openai",
      brand: "ay-tercume",
      model,
      writerResponseId: writer.id || "unknown",
      editorResponseId: editor.id || "unknown",
      ...(repair?.id ? { repairResponseId: repair.id } : {}),
      webSearchUsed: (writer.output || []).some((item) => item.type === "web_search_call"),
      topicLockEnforced: true,
      generatedAt: new Date().toISOString(),
      usage: {
        writerInputTokens: writer.usage?.input_tokens || 0,
        writerOutputTokens: writer.usage?.output_tokens || 0,
        editorInputTokens: editor.usage?.input_tokens || 0,
        editorOutputTokens: editor.usage?.output_tokens || 0,
        ...(repair ? { repairInputTokens: repair.usage?.input_tokens || 0, repairOutputTokens: repair.usage?.output_tokens || 0 } : {}),
      },
    } satisfies AyGenerationTrace,
  };
}
