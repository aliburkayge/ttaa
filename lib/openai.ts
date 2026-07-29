import type { ResearchedLink } from "./link-catalog";
import { parseResilientJson } from "./json";
import { auditKeywordPolicy } from "./keyword-policy";

export type GenerationBrief = {
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

export type ImageSuggestion = {
  placement: string;
  altText: string;
  imagePrompt: string;
  titleText?: string;
  caption?: string;
  description?: string;
};

export type GeneratedArticle = {
  eyebrow: string;
  title: string;
  intro: string;
  tldr: string[];
  sections: Array<{ title: string; body: string; items: string[] }>;
  faqs: Array<{ question: string; answer: string }>;
  cta: { title: string; body: string; buttonLabel: string };
  focusKeyword: string;
  secondaryKeywords: string[];
  seoTitle: string;
  metaDescription: string;
  slug: string;
  imagePrompt: string;
  imageSuggestions: ImageSuggestion[];
  internalLinkSuggestions: string[];
};

export type GenerationTrace = {
  provider: "openai";
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
  languagePair: string;
  translationDirections: string[];
  countryOrJurisdiction: string;
  documentType: string;
  formalProcess: string;
  searchIntent: "service" | "informational" | "transactional" | "document-use";
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

type ModelArticlePackage = Omit<GeneratedArticle, "imagePrompt"> & {
  topicLock: TopicLock;
  audit: TopicAudit;
};

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

const ARTICLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["topicLock", "eyebrow", "title", "intro", "tldr", "sections", "faqs", "cta", "focusKeyword", "secondaryKeywords", "seoTitle", "metaDescription", "slug", "internalLinkSuggestions", "imageSuggestions", "audit"],
  properties: {
    topicLock: {
      type: "object",
      additionalProperties: false,
      required: ["centralSubject", "primaryModifier", "supportingSubjects", "languagePair", "translationDirections", "countryOrJurisdiction", "documentType", "formalProcess", "searchIntent", "mainAction", "primaryKeyword"],
      properties: {
        centralSubject: { type: "string" },
        primaryModifier: { type: "string" },
        supportingSubjects: stringArray,
        languagePair: { type: "string" },
        translationDirections: stringArray,
        countryOrJurisdiction: { type: "string" },
        documentType: { type: "string" },
        formalProcess: { type: "string" },
        searchIntent: { type: "string", enum: ["service", "informational", "transactional", "document-use"] },
        mainAction: { type: "string" },
        primaryKeyword: { type: "string" },
      },
    },
    eyebrow: { type: "string", description: "Short uppercase topic-specific content label." },
    title: { type: "string", description: "Natural H1 tightly matching the title. For a language-pair page, clearly express both translation directions or use a natural bidirectional pair construction." },
    intro: { type: "string", description: "Direct, topic-locked introduction of approximately 120-180 words." },
    tldr: { ...stringArray, description: "Four to six concise points totaling approximately 70-130 words." },
    sections: {
      type: "array",
      description: "Seven to ten non-overlapping, dynamically selected H2 sections that expand the central topic vertically.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "body", "items"],
        properties: {
          title: { type: "string" },
          body: { type: "string", description: "Plain prose with paragraphs separated by newline characters; no HTML or Markdown." },
          items: { ...stringArray, description: "Zero to six concrete items only when a list improves comprehension." },
        },
      },
    },
    faqs: {
      type: "array",
      minItems: 7,
      maxItems: 10,
      description: "Seven to ten customer-intent FAQs specific to the exact service, language pair, document or formal process. Answers are normally 45-90 words.",
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
        title: { type: "string", description: "Must be Send Your Document for Review." },
        body: { type: "string", description: "Concise, topic-specific document review request without pressure or guarantees." },
        buttonLabel: { type: "string" },
      },
    },
    focusKeyword: { type: "string", description: "The single dominant 1-7 word search keyphrase. If the brief supplies a primary keyword, copy it exactly." },
    secondaryKeywords: { ...stringArray, minItems: 3, maxItems: 5, description: "Three to five unique, natural close variants of the focus keyword; never repeat the exact focus keyword." },
    seoTitle: { type: "string", description: "Topic-locked SEO title containing the exact focus keyword and totaling 50-60 characters including the TTAA brand suffix." },
    metaDescription: { type: "string", description: "Specific 120-160 character meta description containing the focus keyword or one declared secondary variation." },
    slug: { type: "string", description: "Short lowercase ASCII hyphenated slug containing the meaningful focus-keyword terms, without leading or trailing slashes." },
    internalLinkSuggestions: { ...stringArray, description: "Three to six exact anchor phrases selected only from the approved TTAA inventory." },
    imageSuggestions: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      description: "Exactly two topic-specific TTAA corporate banner concepts: a featured banner and a distinct inline banner. Each must specify the right-side document cluster appropriate to the exact service; the rendering pipeline reserves the left side for deterministic TTAA logo and headline placement.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["placement", "altText", "imagePrompt"],
        properties: {
          placement: { type: "string" },
          altText: { type: "string" },
          imagePrompt: { type: "string" },
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

export async function verifyOpenAIConnection() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing from .env.local.");
  const model = modelName();
  const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = parseResilientJson<{ id?: string; error?: { message?: string } }>(await response.text(), "OpenAI model check");
  if (!response.ok) throw new Error(body.error?.message || `OpenAI model check failed with HTTP ${response.status}.`);
  return { connected: true, model: body.id || model };
}

function extractOutputText(response: OpenAIResponse) {
  if (response.output_text?.trim()) return response.output_text.trim();
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.refusal) throw new Error(`OpenAI refused the content request: ${content.refusal}`);
      if (content.type === "output_text" && content.text?.trim()) return content.text.trim();
    }
  }
  const reason = response.error?.message || response.incomplete_details?.reason || response.status || "empty model response";
  throw new Error(`OpenAI returned no article output (${reason}).`);
}

function auditPasses(audit: TopicAudit) {
  return audit.topicMatch >= 90 && audit.primaryTopicCoverage >= 70 && audit.topicDrift <= 15 && audit.searchIntentMatch >= 90 && audit.repetition <= 10 && audit.legalClaimSafety >= 95;
}

function auditOperationallyPasses(audit: TopicAudit) {
  return audit.topicMatch >= 85 && audit.primaryTopicCoverage >= 65 && audit.topicDrift <= 20 && audit.searchIntentMatch >= 85 && audit.repetition <= 15 && audit.legalClaimSafety >= 90;
}

function auditDiagnostics(audit: TopicAudit) {
  return `topicMatch=${audit.topicMatch}, coverage=${audit.primaryTopicCoverage}, drift=${audit.topicDrift}, intent=${audit.searchIntentMatch}, repetition=${audit.repetition}, legalSafety=${audit.legalClaimSafety}`;
}

function normalizedWords(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function visibleArticleText(article: GeneratedArticle) {
  return [
    article.title,
    article.intro,
    ...article.tldr,
    ...article.sections.flatMap((section) => [section.title, section.body, ...section.items]),
    ...article.faqs.flatMap((faq) => [faq.question, faq.answer]),
    article.cta.title,
    article.cta.body,
  ].join(" ");
}

function phraseOccurrences(text: string, phrase: string) {
  const haystack = ` ${normalizedWords(text)} `;
  const needle = normalizedWords(phrase);
  if (!needle || needle.split(" ").length < 2) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = haystack.indexOf(` ${needle} `, offset)) !== -1) {
    count += 1;
    offset += needle.length + 2;
  }
  return count;
}

function keywordGate(articlePackage: { article: GeneratedArticle }, brief: GenerationBrief) {
  return auditKeywordPolicy(articlePackage.article, brief);
}

function repetitionGate(articlePackage: { article: GeneratedArticle; topicLock: TopicLock }, brief: GenerationBrief) {
  const text = visibleArticleText(articlePackage.article);
  const words = normalizedWords(text).split(/\s+/).filter(Boolean).length;
  const keyword = articlePackage.article.focusKeyword || brief.primaryKeyword?.trim() || articlePackage.topicLock.primaryKeyword || brief.topic;
  const exactKeywordCount = phraseOccurrences(text, keyword);
  const keywordLimit = Math.min(8, Math.max(4, Math.ceil(words / 350)));
  const brandCount = (text.match(/\bTTAA\b/gi) || []).length;
  const brandLimit = Math.max(6, Math.ceil(words / 180) + 2);
  return { passes: exactKeywordCount <= keywordLimit && brandCount <= brandLimit, keyword, exactKeywordCount, keywordLimit, brandCount, brandLimit };
}

function faqGate(articlePackage: { article: GeneratedArticle; topicLock: TopicLock }, brief: GenerationBrief) {
  const faqs = articlePackage.article.faqs;
  const questions = faqs.map((faq) => normalizedWords(faq.question));
  const issues: string[] = [];
  if (faqs.length < 7 || faqs.length > 10) issues.push(`FAQ count is ${faqs.length}; required range is 7-10.`);
  if (!/\bttaa\b/.test(questions[0] || "") || !/\bhelp\b|\bassist\b|\bhandle\b|\bprovide\b/.test(questions[0] || "")) {
    issues.push("The first FAQ must explain how TTAA helps with the exact service.");
  }
  const ttaaQuestionCount = questions.filter((question) => /\bttaa\b/.test(question)).length;
  if (ttaaQuestionCount < 2) issues.push("At least two FAQ questions must explicitly mention TTAA.");
  if (!questions.some((question) => /\bscan\b|\bquotation\b|\bquote\b|\bsend\b.*\bdocument\b|\bwhat\b.*\bsend\b/.test(question))) {
    issues.push("At least one FAQ must explain what to send for review or quotation.");
  }
  const banned = [
    "is translation always required", "why is translation important", "which source should i trust",
    "is professional translation necessary", "what is the best translation", "why should documents be translated",
    "is translation legally valid", "can i trust a translation agency", "what is the purpose of translation",
    "is this service useful", "what is the difference between languages", "how long will the process take",
  ];
  if (questions.some((question) => banned.some((item) => question.includes(item)))) issues.push("The FAQ contains a generic or prohibited default question.");
  if (new Set(questions).size !== questions.length) issues.push("FAQ questions must be unique.");

  const answerLengths = faqs.map((faq) => normalizedWords(faq.answer).split(/\s+/).filter(Boolean).length);
  const wellSizedAnswers = answerLengths.filter((words) => words >= 35 && words <= 110).length;
  if (wellSizedAnswers < Math.ceil(faqs.length * 0.6)) issues.push("At least 60% of FAQ answers should contain 35-110 words.");

  const formalTerms = /\bapostille\b|\blegalization\b|\blegalisation\b|\bnotari[sz]/i;
  const formalTopic = formalTerms.test(`${brief.topic} ${articlePackage.topicLock.formalProcess}`) || /\battestation\b|\bsworn\b|\bcertified translation\b/i.test(brief.topic);
  const formalQuestions = questions.filter((question) => formalTerms.test(question)).length;
  if (!formalTopic && formalQuestions / Math.max(faqs.length, 1) > 0.3) issues.push("Formal-process questions exceed 30% of a non-formal FAQ section.");

  const topicTokens = normalizedWords(`${articlePackage.topicLock.languagePair} ${articlePackage.topicLock.documentType} ${articlePackage.topicLock.centralSubject}`)
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !["translation", "services", "document", "service"].includes(word));
  const topicSpecificQuestions = questions.filter((question) => topicTokens.some((token) => question.includes(token))).length;
  if (topicTokens.length && topicSpecificQuestions < 2) issues.push("At least two FAQ questions must be unique to the exact language pair, document or process.");

  return { passes: issues.length === 0, issues };
}

function parsePackage(response: OpenAIResponse, approvedLinks: ResearchedLink[], brief: GenerationBrief) {
  const parsed = parseResilientJson<ModelArticlePackage>(extractOutputText(response), "OpenAI article generation");
  if (!parsed.title || !parsed.intro || !Array.isArray(parsed.sections) || parsed.sections.length < 7 || !Array.isArray(parsed.faqs) || parsed.faqs.length < 7 || parsed.faqs.length > 10 || !parsed.cta || !parsed.topicLock || !parsed.audit) {
    throw new Error("OpenAI returned an incomplete topic-locked article package.");
  }

  const approvedInternalAnchors = new Set(approvedLinks.filter((link) => link.source === "internal").map((link) => link.anchor.toLowerCase()));
  const selectedAnchors = parsed.internalLinkSuggestions
    .filter((anchor) => approvedInternalAnchors.has(anchor.toLowerCase()))
    .slice(0, 6);
  for (const fallback of approvedLinks.filter((link) => link.source === "internal")) {
    if (selectedAnchors.length >= 3) break;
    if (!selectedAnchors.some((anchor) => anchor.toLowerCase() === fallback.anchor.toLowerCase())) selectedAnchors.push(fallback.anchor);
  }

  const imageSuggestions = parsed.imageSuggestions.slice(0, 2);
  if (imageSuggestions.length !== 2) throw new Error("OpenAI must return one featured and one inline TTAA visual concept.");
  const focusKeyword = brief.primaryKeyword?.trim() || parsed.focusKeyword.trim();
  const normalizedFocus = normalizedWords(focusKeyword);
  const secondaryKeywords = parsed.secondaryKeywords
    .map((keyword) => keyword.trim())
    .filter((keyword, index, values) => Boolean(keyword) && normalizedWords(keyword) !== normalizedFocus && values.findIndex((candidate) => normalizedWords(candidate) === normalizedWords(keyword)) === index)
    .slice(0, 5);
  let seoTitle = parsed.seoTitle.trim();
  if (!/\bTTAA\b/i.test(seoTitle)) seoTitle = `${seoTitle.replace(/\s*[|–—-]\s*$/, "").slice(0, 58).trim()} | TTAA`;

  const article: GeneratedArticle = {
    eyebrow: parsed.eyebrow,
    title: parsed.title,
    intro: parsed.intro,
    tldr: parsed.tldr.slice(0, 6),
    sections: parsed.sections.slice(0, 10).map((section) => ({ ...section, items: section.items || [] })),
    faqs: parsed.faqs.slice(0, 10),
    cta: { ...parsed.cta, title: "Send Your Document for Review" },
    focusKeyword,
    secondaryKeywords,
    seoTitle,
    metaDescription: parsed.metaDescription.trim(),
    slug: parsed.slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 72),
    imagePrompt: imageSuggestions[0].imagePrompt,
    imageSuggestions,
    internalLinkSuggestions: selectedAnchors,
  };
  return { article, topicLock: parsed.topicLock, audit: parsed.audit };
}

async function createResponse(payload: Record<string, unknown>) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing from .env.local.");
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("OpenAI content generation exceeded the safe three-minute step limit. Please retry the request.");
    }
    throw error;
  }
  const raw = await response.text();
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      detail = parseResilientJson<OpenAIResponse>(raw, "OpenAI response service").error?.message || detail;
    } catch {
      if (/upstream error/i.test(raw)) detail = "temporary upstream service error";
    }
    throw new Error(`OpenAI generation failed: ${detail}`);
  }
  const body = parseResilientJson<OpenAIResponse>(raw, "OpenAI response service");
  return body;
}

function sourceInventory(links: ResearchedLink[]) {
  return links.map((link, index) => `${index + 1}. [${link.source}] Exact anchor: "${link.anchor}" | URL: ${link.url} | Purpose: ${link.reason}`).join("\n");
}

function officialDomains(links: ResearchedLink[]) {
  return [...new Set(links.filter((link) => link.source === "official").map((link) => new URL(link.url).hostname))];
}

function webSources(response: OpenAIResponse): ResearchedLink[] {
  const links: ResearchedLink[] = [];
  for (const item of response.output || []) {
    for (const source of item.action?.sources || []) {
      if (!source.url || !/^https:\/\//.test(source.url)) continue;
      links.push({ anchor: (source.title || new URL(source.url).hostname).trim().slice(0, 120), url: source.url, reason: "Primary institutional reference relevant to this topic", source: "official" });
    }
  }
  return links;
}

function requestedWordCount(brief: GenerationBrief) {
  const exact = Number(brief.desiredWordCount);
  if (Number.isFinite(exact) && exact >= 800 && exact <= 4_000) return `approximately ${Math.round(exact)} words (stay within ±10%)`;
  return brief.length === "guide" ? "1,800-2,500 words" : brief.length === "service" ? "1,300-1,900 words" : "1,200-1,700 words";
}

const TOPIC_LOCK_RULES = `
TOPIC-LOCK OPERATING RULES
1. Analyze the supplied title internally before writing. Identify the central subject, language pair and directions, jurisdiction, document type, formal process, dominant search intent, primary modifier and the action the reader wants to complete. Store this only in topicLock; never reveal the analysis in article prose.
2. Keep at least 70% of the article directly on the exact service, language pair, document or formal process in the title. Use no more than 20% for practical support and no more than 10% for general context. Expand vertically into the central subject, not horizontally into immigration, travel, admissions, court strategy, courier networks, broad country profiles or unrelated law.
3. Give highest priority to the language pair, document type or core service; then formal service type; then country/authority; then user goal; and only then speed or convenience modifiers.
4. Select only genuinely relevant TTAA service categories. Never turn an article into a list of all TTAA services.
5. For a language-pair title, make the H1 explicitly bidirectional (for example, "Chinese to Turkish & Turkish to Chinese Translation" or a natural "Chinese–Turkish Translation Services" construction). Keep the pair visible in the introduction, TL;DR, at least two H2 sections, one FAQ and the CTA. Explain both directions and relevant document/service variants without losing the pair focus.
6. For a document-specific title, keep that document central: uses, accuracy-critical fields, language direction, certification/sworn translation, relevant notarization/apostille, submission contexts, TTAA handling and next action.
7. For a formal-process title, make that process central and clearly distinguish it from certification, sworn translation, notarization, apostille, legalization and attestation. These terms are never interchangeable.
8. Use one dominant intent—service, informational, transactional or document-use—to control the introduction, section order, FAQs and CTA.
9. Write a direct 120-180 word introduction. Never open with globalized-world, interconnected-world, language-bridges-cultures or similar filler.
10. Write a 70-130 word TL;DR with 4-6 points. Create 7-10 dynamic H2 sections. Central service sections should normally be 150-280 words; supporting sections 100-180 words and never longer than the central section.
11. If the title says fast, urgent, same-day, quick or express, cover speed in one dedicated section. Explain scope, legibility, formatting, language direction, complexity, certification, translator availability, revision and delivery. Never guarantee same-day or immediate completion.
12. Explain each idea once. Avoid repeating readable-file, authority, deadline, names/dates, notarization and delivery advice throughout the article.
13. Position TTAA with concrete process strengths: appropriate translator assignment, official-document experience, terminology consistency, translation/revision workflow, relevant certification coordination and clear delivery. Never claim best, number one, flawless, guaranteed acceptance, universal validity or world-class superiority.
14. Use cautious official-process language. The receiving institution makes the final acceptance decision. Never promise visa approval, legal recognition or application acceptance.
15. Generate 7-10 FAQs from the visitor's real intent. The first question should normally ask how TTAA can help with the exact article topic. At least two questions must explicitly mention TTAA, and their answers must describe concrete help such as document review, translation direction, specialist assignment, checking, certification coordination or delivery.
16. Balance the FAQs: 2-3 TTAA service questions, 2-3 questions unique to the exact language pair/document/process, only 1-2 formal-service questions when genuinely relevant, and 2 transaction questions. At least one question must explain what the reader should send for a review or quotation.
17. For language-pair FAQs, cover realities unique to that pair, such as names/transliteration, regional or writing-system variants, stamps, tables, terminology, dates or reference spelling. For document pages, keep most questions on that document. For formal-process pages, explain the precise process without presenting one sequence as universal.
18. FAQ answers should normally be 45-90 words, lead with a direct useful sentence, use plain professional English and avoid repeated answers. Fewer than 30% of questions may focus mainly on notarization, apostille, legalization or authority requirements unless the title itself is a formal-process topic.
19. Do not use generic default questions such as "Is translation always required?", "Why is translation important?", "Which source should I trust?", "What is translation?" or the vague "How long will the process take?". Use a topic-specific turnaround question instead. Never expose FAQ planning, categories or audit scores.
20. End with the CTA title "Send Your Document for Review". Ask concisely for the complete document, translation direction, country of use, receiving authority if known, deadline and required certification or delivery format. The rendered CTA and matching contextual conversion link open TTAA WhatsApp with a topic-specific prefilled message.
21. Select exactly one focusKeyword representing the single dominant search intent. If the brief supplies Primary keyword, copy it exactly; otherwise infer a natural 1-7 word phrase of no more than 80 characters. Generate 3-5 unique secondaryKeywords as close natural variations. Use the exact focus keyword in the H1 or first H2, the first paragraph and the 50-60 character SEO title. Write a 120-160 character meta description containing the focus keyword or one declared variation. Keep the slug short, lowercase, hyphenated and focused on the meaningful keyword terms. Use no more than three exact-match H2s and never force the keyword into every heading. Do not begin multiple sections with the same exact phrase.
22. Select only 3-6 approved internal anchor phrases and exactly two topic-specific TTAA banner concepts: one featured and one inline. Follow the TTAA visual system: corporate white/blue palette, clean modern premium layout, subtle world map and blue wave curves, quiet left side reserved for deterministic logo/headline compositing, and a service-specific document cluster on the right. For translation use bilingual documents and review cues; for apostille/attestation use certificates and abstract authentication steps; for visa/QVP use abstract travel documents and verification workflow. Never suggest people, generic office scenes, random laptops, government seals, copied official documents, readable personal data, fake passports, misleading official stamps, travel clichés, developer notes or pipeline messages.
23. Silently audit the final result. Required thresholds: topic match ≥90, primary-topic coverage ≥70, topic drift ≤15, search-intent match ≥90, repetition ≤10 and legal-claim safety ≥95. Revise before returning if any threshold or deterministic focus-keyword rule fails. Scores and research notes must never appear in the visible article.`;

export async function generateAndEditArticle(brief: GenerationBrief, links: ResearchedLink[]) {
  const model = modelName();
  const sources = sourceInventory(links);
  const domains = officialDomains(links);
  const searchTool: Record<string, unknown> = { type: "web_search", search_context_size: "high" };
  if (domains.length) searchTool.filters = { allowed_domains: domains };

  const writerSystem = `You are the senior English SEO and AEO content writer for Turkish Translation & Attestation Agency (TTAA), an ISO 17100-aligned translation and document-attestation agency serving clients worldwide since 2013 from Ankara and Istanbul. Create an original, publication-ready article from the supplied title. You have no existing article unless source material is explicitly supplied.
${TOPIC_LOCK_RULES}

Research first using primary government, convention, ministry, embassy, consulate and standards sources. Never invent requirements, fees or timelines. Use approved link anchors naturally in relevant prose, but never output HTML, Markdown, URLs, citation tokens, research notes, workflow messages or unavailable-content statements. Return only the structured object.`;

  const writerUser = `Create a ${brief.mode === "update" ? "substantially updated" : "new"} topic-locked article.
Article title: ${brief.topic}
Primary keyword: ${brief.primaryKeyword?.trim() || "Infer carefully from the title"}
Target country: ${brief.country || "Infer carefully from the title"}
Target audience: ${brief.audience || "Infer carefully from the title and TTAA service context"}
Document or service type: ${brief.documentType || "Infer carefully from the title"}
Desired word count: ${requestedWordCount(brief)}
Supplied source material: ${brief.sourceText?.trim().slice(0, 12_000) || "None"}

Approved TTAA internal links and official sources:
${sources}

Use web search to verify time-sensitive or jurisdiction-specific facts within the allowed official domains. The title is the boundary: supporting subjects may clarify it but must not take over.`;

  const writer = await createResponse({
    model,
    reasoning: { effort: "medium" },
    tools: [searchTool],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    input: [{ role: "system", content: writerSystem }, { role: "user", content: writerUser }],
    text: { format: { type: "json_schema", name: "ttaa_topic_locked_article", strict: true, schema: ARTICLE_SCHEMA } },
    max_output_tokens: 22_000,
  });
  parsePackage(writer, links, brief);

  const editorSystem = `You are TTAA's final topic-lock editor and factual-risk reviewer. Preserve useful depth but remove drift, repetition, generic filler and irrelevant services. Verify the exact title remains dominant, the primary modifier does not take over, language-pair/document/formal-process rules are followed, legal claims are cautious, approved link anchors are natural, and all silent-audit thresholds pass. Do not expose topicLock or audit values in visible prose. Return only the same structured object.\n${TOPIC_LOCK_RULES}`;
  const editorUser = `Original brief:\n${JSON.stringify({ ...brief, sourceText: brief.sourceText?.slice(0, 12_000) || "" })}\n\nApproved inventory:\n${sources}\n\nWriter draft:\n${extractOutputText(writer)}`;
  const editor = await createResponse({
    model,
    reasoning: { effort: "high" },
    input: [{ role: "system", content: editorSystem }, { role: "user", content: editorUser }],
    text: { format: { type: "json_schema", name: "ttaa_topic_locked_edited_article", strict: true, schema: ARTICLE_SCHEMA } },
    max_output_tokens: 22_000,
  });
  let finalPackage = parsePackage(editor, links, brief);
  let repair: OpenAIResponse | undefined;
  let repetition = repetitionGate(finalPackage, brief);
  let faqAudit = faqGate(finalPackage, brief);
  let keywordAudit = keywordGate(finalPackage, brief);

  if (!auditPasses(finalPackage.audit) || !repetition.passes || !faqAudit.passes || !keywordAudit.passes) {
    let articleToRepair = extractOutputText(editor);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      repair = await createResponse({
        model,
        reasoning: { effort: "high" },
        input: [
          { role: "system", content: `Perform a targeted quality repair. Preserve sections and useful facts that already work. Correct every listed deterministic issue, improve the self-audit values honestly, preserve exactly two TTAA visual suggestions, and return only the same structured object.\n${TOPIC_LOCK_RULES}` },
          { role: "user", content: `Repair attempt ${attempt} of 2.\nBrief:\n${JSON.stringify(brief)}\n\nApproved inventory:\n${sources}\n\nCurrent self-audit: ${auditDiagnostics(finalPackage.audit)}\nRequired operational minimums: topicMatch 85, coverage 65, drift maximum 20, intent 85, repetition maximum 15, legalSafety 90.\n\nDeterministic repetition check: exact phrase "${repetition.keyword}" appears ${repetition.exactKeywordCount} times (maximum ${repetition.keywordLimit}); TTAA appears ${repetition.brandCount} times (maximum ${repetition.brandLimit}).\n\nFocus keyword issues:\n${keywordAudit.issues.length ? keywordAudit.issues.map((issue) => `- ${issue}`).join("\n") : "- None"}\n\nDynamic FAQ issues:\n${faqAudit.issues.length ? faqAudit.issues.map((issue) => `- ${issue}`).join("\n") : "- None"}\n\nMake the smallest changes needed to solve these exact issues. Do not introduce generic FAQs, unrelated formalities or repeated keyword openings.\n\nArticle requiring repair:\n${articleToRepair}` },
        ],
        text: { format: { type: "json_schema", name: "ttaa_topic_locked_repaired_article", strict: true, schema: ARTICLE_SCHEMA } },
        max_output_tokens: 22_000,
      });
      articleToRepair = extractOutputText(repair);
      finalPackage = parsePackage(repair, links, brief);
      repetition = repetitionGate(finalPackage, brief);
      faqAudit = faqGate(finalPackage, brief);
      keywordAudit = keywordGate(finalPackage, brief);
      if (auditOperationallyPasses(finalPackage.audit) && repetition.passes && faqAudit.passes && keywordAudit.passes) break;
    }
    if (!auditOperationallyPasses(finalPackage.audit) || !repetition.passes || !faqAudit.passes || !keywordAudit.passes) {
      const unresolved = [
        !auditOperationallyPasses(finalPackage.audit) ? `topic audit (${auditDiagnostics(finalPackage.audit)})` : "",
        !repetition.passes ? `repetition: keyword ${repetition.exactKeywordCount}/${repetition.keywordLimit}, TTAA ${repetition.brandCount}/${repetition.brandLimit}` : "",
        ...keywordAudit.issues,
        ...faqAudit.issues,
      ].filter(Boolean).join("; ");
      throw new Error(`The content quality repair could not resolve: ${unresolved}`);
    }
  }

  return {
    article: finalPackage.article,
    discoveredSources: webSources(writer),
    trace: {
      provider: "openai",
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
    } satisfies GenerationTrace,
  };
}
