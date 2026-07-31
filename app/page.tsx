/* Dynamic WordPress media URLs cannot be declared in a static Next image allowlist. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
import CompanySwitcher from "./company-switcher";
import ProjectLibrary from "./project-library";
import { buildTtaaWhatsAppUrl, getCuratedLinks, type ResearchedLink } from "../lib/link-catalog";
import type { GeneratedArticle, GenerationTrace, ImageSuggestion } from "../lib/openai";
import { normalizeTtaaArticleHtml } from "../lib/ttaa-html";
import { JobApiError, useContentJob } from "../lib/use-content-job";

type OutputTab = "preview" | "html" | "head" | "schema" | "seo";
type WorkspaceView = "create" | "library" | "brand" | "integrations";

type PublishState =
  | { status: "idle" }
  | { status: "publishing" }
  | { status: "created"; postId: number; editUrl: string; persistenceSaved: boolean; seoApplied: boolean; focusKeywordApplied: boolean; secondaryKeywordsApplied: boolean; seoPlugin: string; canonical: string; imagesReady: boolean; warning?: string }
  | { status: "error"; message: string; canRetryFinalize: boolean };

type IntegrationHealth = {
  wordpress?: { connected: boolean; user?: { name: string; seoPlugin?: string; articleCss?: { ready: boolean; url: string } }; error?: string };
  supabase?: { connected: boolean; storageReady: boolean; bucket?: string; imageBucket?: string; error?: string };
  openai?: { connected: boolean; model?: string; image?: { connected: boolean; model: string; size: string; quality: string; format: string }; error?: string };
};

type DurableJobResult = {
  package: Package;
  projectId?: string;
  wordpress: {
    id: number;
    editUrl: string;
    canonical: string;
    seo?: { plugin: string; applied: boolean; focusKeywordApplied?: boolean; secondaryKeywordsApplied?: boolean; warning?: string };
    design?: { sharedStylesheetReady: boolean; inlineFallbackEmbedded: boolean; warning?: string };
  };
  images?: { featured: FinalImageAsset; inline: FinalImageAsset };
  warning?: string;
};

type FinalImageAsset = {
  role: "featured" | "inline";
  wordpress: { id: number; url: string };
  supabase: { bucket: string; path: string } | null;
  fileName: string;
  prompt: string;
  revisedPrompt?: string;
  alt: string;
  width: number;
  height: number;
  format: string;
  model: string;
  quality: string;
  branding?: { logoReferenceApplied: boolean; logoPlacement: "top-left"; headlineRequested: boolean; method: "gpt-image-2-edit" };
  origin?: "new-generation" | "recovered-wordpress-draft";
};

type Brief = {
  topic: string;
  primaryKeyword: string;
  desiredWordCount: string;
  audience: string;
  country: string;
  documentType: string;
  sourceText: string;
  mode: "new" | "update";
  length: "standard" | "guide" | "service";
  includeH1: boolean;
  visibleBreadcrumb: boolean;
  articleSchema: boolean;
  faqSchema: boolean;
  breadcrumbSchema: boolean;
};

type Package = {
  title: string;
  meta: string;
  slug: string;
  focusKeyword: string;
  secondaryKeywords: string[];
  prefix: string;
  canonical: string;
  head: string;
  html: string;
  schema: string;
  preview: ArticlePreview;
  imagePrompt: string;
  imageSuggestions?: ImageSuggestion[];
  images?: { featured: FinalImageAsset; inline: FinalImageAsset };
  links: ResearchedLink[];
  generation?: GenerationTrace;
  research?: { mode: string; researchedAt: string };
};

type ArticlePreview = {
  eyebrow: string;
  title: string;
  intro: string;
  tldr: string[];
  sections: { title: string; body: string; items?: string[] }[];
  faqs: { question: string; answer: string }[];
  cta?: { title: string; body: string; buttonLabel: string };
};

function normalizePackageHtml(contentPackage: Package): Package {
  const html = normalizeTtaaArticleHtml(contentPackage.html);
  return html === contentPackage.html ? contentPackage : { ...contentPackage, html };
}

const DEFAULT_BRIEF: Brief = {
  topic: "QVP Verification for KSA Work Visa",
  primaryKeyword: "",
  desiredWordCount: "",
  audience: "",
  country: "",
  documentType: "",
  sourceText: "",
  mode: "new",
  length: "guide",
  includeH1: true,
  visibleBreadcrumb: true,
  articleSchema: true,
  faqSchema: true,
  breadcrumbSchema: true,
};

const STAGES = [
  { label: "Bilgiler", note: "Başlık ve kapsam" },
  { label: "Araştırma", note: "Resmî kaynaklar" },
  { label: "İçerik", note: "Yazı ve SEO" },
  { label: "Taslak", note: "WordPress aktarımı" },
];

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 68);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildHead(seoTitle: string, metaDescription: string, canonical: string) {
  return `<title>${escapeHtml(seoTitle)}</title>
<meta name="description" content="${escapeHtml(metaDescription)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta name="robots" content="index, follow, max-image-preview:large">`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderLinkedText(value: string, links: ResearchedLink[], usedUrls: Set<string>, prefix: string) {
  let html = escapeHtml(value);
  const candidates = [...links].sort((a, b) => b.anchor.length - a.anchor.length);
  for (const link of candidates) {
    if (usedUrls.has(link.url)) continue;
    const escapedAnchor = escapeHtml(link.anchor);
    const pattern = new RegExp(escapeRegExp(escapedAnchor), "i");
    if (!pattern.test(html)) continue;
    const attributes = link.source === "official" ? ' target="_blank" rel="noopener noreferrer"' : "";
    html = html.replace(pattern, (match) => `<a class="${prefix}-context-link ${prefix}-link-${link.source}" href="${escapeHtml(link.url)}"${attributes}>${match}</a>`);
    usedUrls.add(link.url);
  }
  return html;
}

function buildArticle(brief: Brief): ArticlePreview {
  const topic = brief.topic.trim() || "Professional Translation Services";
  const audience = brief.audience.trim() || "people preparing documents for official use";
  const country = brief.country.trim() || "the destination country";
  const document = brief.documentType.trim() || "official documents";
  const context = `${topic} ${audience} ${country} ${document}`.toLowerCase();
  const isQvp = /qvp|ksa|saudi|qualification verification|work visa/.test(context);
  const isUsApostille = /apostille/.test(context) && /usa|united states|american|federal|state-issued/.test(context);
  const isMalaysia = /malaysia|malaysian/.test(context);
  const isTranslation = /translation|translator|language/.test(context);
  const sourceContext = brief.sourceText.trim()
    ? " The supplied source material adds project context, but time-sensitive claims still require an official-source check before publication."
    : "";

  let definition = `${topic} is a document-preparation process connected to official or international use. The correct route depends on the document’s origin, the destination and the receiving authority. It does not by itself guarantee acceptance, approval or a visa result.`;
  let preparationItems = [
    document,
    "A complete, legible scan showing every page, stamp and signature",
    "The issuing country, destination country and intended use",
    "The exact name of the receiving authority",
    "The required language, format and deadline",
  ];
  let authorityCheck = "Check the receiving authority’s current instructions before acting on a general checklist.";

  if (isQvp) {
    definition = `For Saudi employment procedures, professional verification is intended to check whether an expatriate worker’s qualifications and experience align with the intended profession. The Saudi Ministry of Human Resources and Social Development describes verification of academic qualifications, specialization and experience as part of this framework. QVP completion should not be presented as a guarantee of visa issuance.`;
    preparationItems = [
      "Degree or diploma in a clear, complete format",
      "Academic transcript and field-of-study information when requested",
      "Employment or experience evidence that matches the intended profession",
      "Passport identity details with consistent name spelling",
      "Employer, occupation and Saudi application references available for review",
    ];
    authorityCheck = "Use the Saudi permanent work visa service and the relevant professional-verification channel to confirm the current application route.";
  } else if (isUsApostille) {
    definition = `U.S. apostille routing begins by identifying whether a document was issued at state or federal level and where it will be used. The USAGov authentication guide explains that state vital records normally go to the relevant state authority, while the U.S. Department of State Office of Authentications handles eligible federal documents. The Hague Apostille Convention status table helps confirm whether apostille or another authentication route is relevant.`;
    preparationItems = [
      "The complete state-issued or federal document",
      "The U.S. state or federal agency that issued the document",
      "The destination country and receiving institution",
      "Any notarization or certified-copy requirement for that document type",
      "Translation language, return-delivery method and deadline",
    ];
    authorityCheck = "Do not send a state document to a federal office, or a federal document to a state authority, without confirming jurisdiction first.";
  } else if (isMalaysia) {
    definition = `Embassy attestation is a chain of signature and seal verification, not a review of the document’s underlying truth. Malaysian Ministry of Foreign Affairs attestation guidance distinguishes public, educational, foreign and translated documents, so the preparation sequence must be checked for the document’s origin and intended use.`;
    authorityCheck = "Confirm the current embassy and ministry sequence before arranging translation, notarization or consular submission.";
  } else if (isTranslation) {
    definition = `${topic} requires more than replacing words between languages. Purpose, terminology, audience and formatting affect whether the result is fit for use. The ISO 17100 translation services standard describes core process and resource requirements for professional translation services.`;
    authorityCheck = "Confirm whether the receiving body needs a standard, certified, sworn or notarized translation before work begins.";
  }

  return {
    eyebrow: brief.mode === "update" ? "RESEARCH-AWARE UPDATED GUIDE" : "RESEARCH-AWARE DOCUMENT GUIDE",
    title: topic,
    intro: `${topic} is best handled as a document workflow rather than a single isolated formality. For ${audience.toLowerCase()}, the route can change according to where the document was issued, the receiving authority in ${country}, and whether translation, notarization, apostille or embassy legalization is required.${sourceContext}`,
    tldr: [
      "Identify the issuing authority, destination and receiving institution before choosing a process.",
      `${document} should be checked for completeness, name consistency, stamps and readable supporting details.`,
      "Use official sources for current eligibility and authority rules; use service pages for workflow and support information.",
      "Treat translation, certification and authentication as dependent stages whose order can vary.",
      "Ask for a document-specific review before paying fees or sending originals.",
    ],
    sections: [
      { title: `What Is ${topic}?`, body: definition },
      {
        title: "Who May Need This Guidance?",
        body: `This guide is written for ${audience.toLowerCase()}. It is especially relevant when a document crosses borders, supports employment or education, or must be accepted by a government, embassy, university, court or regulated organization.`,
        items: [
          `Applicants preparing ${document.toLowerCase()} for use abroad`,
          "Employers coordinating cross-border onboarding or professional files",
          "Students and professionals submitting academic credentials",
          "Individuals facing a translation, certification or authentication request",
        ],
      },
      {
        title: "Documents and Facts to Confirm First",
        body: "A useful review starts with evidence, not assumptions. Share the best available copy and the intended use, but remove unnecessary sensitive information from public drafts and screenshots.",
        items: preparationItems,
      },
      {
        title: "A Safer Step-by-Step Workflow",
        body: "Start by using send your document for review so the language pair, document type and destination can be checked together. Professional translation services should then be coordinated with checking and revision, any required apostille and legalization support, and suitable delivery options.",
        items: [
          "01 — Record the issuing authority, destination and exact receiving institution.",
          "02 — Confirm jurisdiction and the current authority sequence from an official source.",
          "03 — Prepare translation and formatting for the document’s intended use.",
          "04 — Complete certification, notarization, apostille or embassy steps only when applicable.",
          "05 — Recheck names, dates, reference numbers, stamps and every page before delivery.",
        ],
      },
      {
        title: "Common Causes of Delay or Rejection",
        body: `${authorityCheck} Requirements can change, and a process used for another applicant or another destination may not apply to this document.`,
        items: [
          "Different spellings of the same name across the passport and supporting documents",
          "Unreadable scans, missing reverse sides, cropped stamps or incomplete page sets",
          "Choosing an authority that does not have jurisdiction over the issuing signature",
          "Treating apostille, authentication and embassy legalization as interchangeable",
          "Using unverified turnaround times, fees or document lists as guaranteed facts",
        ],
      },
      {
        title: "How Turkish Translation & Attestation Agency Can Help",
        body: "TTAA can review the document scenario, explain the likely preparation route and coordinate translation-related stages. Support may include professional translation services, checking and revision, certified or notarized preparation, apostille and legalization support, and delivery options. The receiving authority retains the final decision on acceptance.",
      },
    ],
    faqs: [
      { question: `How can TTAA help with ${topic}?`, answer: `TTAA first reviews the complete file, its intended use and the required language direction. The team can then assign suitable translation expertise, coordinate checking and revision, identify any requested certification stage and explain available delivery options. Formal requirements and a realistic turnaround are confirmed after the exact document scenario has been reviewed.` },
      { question: `What parts of ${document.toLowerCase()} can TTAA review?`, answer: "TTAA can examine the complete document set, including visible stamps, signatures, tables, reverse pages and supporting references. The review identifies the translation scope, formatting needs and details that require consistent treatment. A complete file is important because cropped pages or missing attachments can change both the quotation and the preparation route." },
      { question: `How does TTAA protect names, dates and terminology in ${topic}?`, answer: "TTAA checks identity details, dates, reference numbers, institution names and subject-specific terminology during translation and revision. Passport spelling, company records or an accepted previous translation can be used as a reference when supplied. The final wording must remain faithful to the source while being clear and consistent in the target language." },
      { question: "Can TTAA assist with certified, sworn or notarized translation when relevant?", answer: "Yes, TTAA can help coordinate the requested translation format when it is relevant to the document and place of use. Certification and notarization are not interchangeable and are not automatically required for every file. The receiving institution’s current instructions should be shared or confirmed before additional formal steps are arranged." },
      { question: `How long can ${topic} take?`, answer: "Turnaround depends on document length, legibility, language direction, technical complexity, tables, handwriting, formatting and revision requirements. Certification, notarization, apostille coordination or physical delivery may add time when applicable. TTAA can provide a realistic estimate after reviewing the complete document rather than promising a fixed deadline in advance." },
      { question: "Can I send a scan to TTAA for an initial review?", answer: "A complete and readable scan is normally suitable for identifying the document type, confirming the language direction, estimating the scope and preparing a quotation. Send every relevant page, including reverse sides and visible stamps. An original or certified copy may still be requested later by the receiving institution or formal authority." },
      { question: "What should I send TTAA for an accurate quotation?", answer: "Send the complete document, required translation direction, country of use, receiving institution if known, deadline, requested certification format and preferred digital or physical delivery method. Include passport or company-name spelling references and any accepted previous translation where relevant. These details help TTAA prepare a clearer scope, price and turnaround estimate." },
    ],
  };
}

function buildHtml(preview: ArticlePreview, brief: Brief, prefix: string, links: ResearchedLink[]) {
  const p = prefix;
  const whatsappUrl = buildTtaaWhatsAppUrl(preview.title);
  const usedUrls = new Set<string>();
  const renderParagraphs = (value: string) => value
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${renderLinkedText(paragraph, links, usedUrls, p)}</p>`)
    .join("");
  const heading = brief.includeH1
    ? `<h1 class="${p}-title">${escapeHtml(preview.title)}</h1>`
    : `<div class="${p}-title" role="heading" aria-level="2">${escapeHtml(preview.title)}</div>`;
  const breadcrumb = brief.visibleBreadcrumb ? `<nav class="${p}-breadcrumb" aria-label="Breadcrumb"><a href="https://turkishtranslation.com.tr/">Home</a><span aria-hidden="true">›</span><a href="https://turkishtranslation.com.tr/services/">Services</a><span aria-hidden="true">›</span><span aria-current="page">${escapeHtml(preview.title)}</span></nav>` : "";
  const sections = preview.sections
    .map(
      (section, index) => `
  <section class="${p}-section" aria-labelledby="${p}-section-${index + 1}">
    <div class="${p}-section-heading">
      <span class="${p}-section-line" aria-hidden="true"></span>
      <div>
        <span class="${p}-section-label">SECTION ${String(index + 1).padStart(2, "0")}</span>
        <h2 id="${p}-section-${index + 1}">${escapeHtml(section.title)}</h2>
      </div>
    </div>
    <div class="${p}-content-card">
      ${renderParagraphs(section.body)}${
        section.items?.length
          ? `
      <ul class="${p}-list">${section.items
        .map(
          (item) => `
        <li><span class="${p}-check" aria-hidden="true">✓</span><span>${renderLinkedText(item, links, usedUrls, p)}</span></li>`,
        )
        .join("")}
      </ul>`
          : ""
      }
    </div>
  </section>${index === 1 ? "\n<!-- TTAA_INLINE_IMAGE -->" : ""}`,
    )
    .join("\n");

  const faqs = preview.faqs
    .map(
      (faq) => `
      <article class="${p}-faq-item">
        <h3>${escapeHtml(faq.question)}</h3>
        <p>${renderLinkedText(faq.answer, links, usedUrls, p)}</p>
      </article>`,
    )
    .join("");

  const internalResources = links.filter((link) => link.source === "internal").slice(0, 6);
  const officialResources = links.filter((link) => link.source === "official").slice(0, 5);
  const cta = preview.cta || {
    title: "Send Your Document for Review",
    body: "Share a clear scan, the issuing country, destination, receiving authority, required language and deadline. TTAA can review the document and explain the applicable service route.",
    buttonLabel: "Request a document review",
  };
  const resourceColumn = (title: string, items: ResearchedLink[]) => items.length ? `
      <div class="${p}-resource-column">
        <span class="${p}-resource-title">${title}</span>
        <ul>${items.map((link) => `<li><a class="${p}-resource-link" href="${escapeHtml(link.url)}"${link.source === "official" ? ' target="_blank" rel="noopener noreferrer"' : ""}><span class="${p}-resource-badge" aria-hidden="true">${link.source === "official" ? "REF" : "TT"}</span><span class="${p}-resource-copy"><strong>${escapeHtml(link.anchor)}</strong><small>${escapeHtml(link.reason)}</small></span><span class="${p}-resource-arrow" aria-hidden="true">→</span></a></li>`).join("")}</ul>
      </div>` : "";

  const html = `<article id="${p}-article" class="${p}-article">
  ${breadcrumb}
  <header class="${p}-hero">
    <span class="${p}-eyebrow">${escapeHtml(preview.eyebrow)}</span>
    ${heading}
    <p class="${p}-lead">${renderLinkedText(preview.intro, links, usedUrls, p)}</p>
  </header>

  <section class="${p}-tldr" aria-labelledby="${p}-tldr-title">
    <div class="${p}-tldr-mark" aria-hidden="true">TL</div>
    <div>
      <span class="${p}-section-label">QUICK ANSWER</span>
      <h2 id="${p}-tldr-title">TL;DR</h2>
      <ul>${preview.tldr.map((item) => `<li>${renderLinkedText(item, links, usedUrls, p)}</li>`).join("")}</ul>
    </div>
  </section>

${sections}

  <aside class="${p}-resources" aria-labelledby="${p}-resources-title">
    <div class="${p}-resources-intro">
      <span class="${p}-section-label">RELATED RESOURCES</span>
      <h2 id="${p}-resources-title">TTAA Services and Official References</h2>
      <p>Explore the relevant TTAA service pages and primary institutional references connected to this topic.</p>
    </div>
    <div class="${p}-resource-grid">
      ${resourceColumn("TTAA SERVICES", internalResources)}
      ${resourceColumn("OFFICIAL REFERENCES", officialResources)}
    </div>
  </aside>

  <section class="${p}-section" aria-labelledby="${p}-faq-title">
    <div class="${p}-section-heading">
      <span class="${p}-section-line" aria-hidden="true"></span>
      <div>
        <span class="${p}-section-label">COMMON QUESTIONS</span>
        <h2 id="${p}-faq-title">Frequently Asked Questions</h2>
      </div>
    </div>
    <div class="${p}-faq-list">${faqs}
    </div>
  </section>

  <section class="${p}-cta">
    <span class="${p}-section-label">NEXT STEP</span>
    <h2>${escapeHtml(cta.title)}</h2>
    <p>${renderLinkedText(cta.body, links, usedUrls, p)}</p>
    <a href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cta.buttonLabel)}</a>
  </section>
</article>
`;
  return html;
}

function buildSchema(preview: ArticlePreview, brief: Brief, slug: string) {
  const graph: Record<string, unknown>[] = [];
  if (brief.articleSchema) {
    graph.push({
      "@type": "BlogPosting",
      "@id": `https://turkishtranslation.com.tr/${slug}/#article`,
      headline: preview.title,
      description: preview.intro,
      mainEntityOfPage: `https://turkishtranslation.com.tr/${slug}/`,
      author: { "@type": "Organization", name: "Turkish Translation & Attestation Agency" },
      publisher: { "@type": "Organization", name: "Turkish Translation & Attestation Agency", url: "https://turkishtranslation.com.tr/" },
    });
  }
  if (brief.faqSchema) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: preview.faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    });
  }
  if (brief.breadcrumbSchema) {
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://turkishtranslation.com.tr/" },
        { "@type": "ListItem", position: 2, name: "Services", item: "https://turkishtranslation.com.tr/services/" },
        { "@type": "ListItem", position: 3, name: preview.title },
      ],
    });
  }
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2);
}

function buildPackage(
  brief: Brief,
  researchedLinks: ResearchedLink[] = getCuratedLinks(brief),
  generatedArticle?: GeneratedArticle,
  generation?: GenerationTrace,
  research?: { mode: string; researchedAt: string },
): Package {
  const preview = generatedArticle || buildArticle(brief);
  const slug = generatedArticle?.slug || slugify(preview.title);
  const prefix = "ttaa";
  const title = generatedArticle?.seoTitle || `${preview.title} | Complete Guide`;
  const meta = generatedArticle?.metaDescription || `Understand ${preview.title.toLowerCase()}, required document checks, official sources, common risks and TTAA translation or attestation support.`.slice(0, 158);
  const imagePrompt = generatedArticle?.imagePrompt || `Clean 16:9 corporate editorial image about ${preview.title}, white and TTAA blue palette, document workflow, subtle international context, no fake seals or personal data.`;
  const canonical = `https://turkishtranslation.com.tr/${slug}/`;
  return {
    title,
    meta,
    slug: `/${slug}/`,
    focusKeyword: generatedArticle?.focusKeyword || brief.primaryKeyword.trim() || preview.title,
    secondaryKeywords: generatedArticle?.secondaryKeywords || [],
    prefix,
    canonical,
    head: buildHead(title, meta, canonical),
    preview,
    imagePrompt,
    imageSuggestions: generatedArticle?.imageSuggestions,
    html: buildHtml(preview, brief, prefix, researchedLinks),
    schema: buildSchema(preview, brief, slug),
    links: researchedLinks,
    generation,
    research,
  };
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle-ui" aria-hidden="true"><span /></span>
    </label>
  );
}

function ArticleRenderer({ html }: { html: string }) {
  return (
    <div className="wordpress-package-preview" aria-label="Exact WordPress package preview">
      <div className="preview-fidelity-note"><span>✓</span><p><strong>Exact package preview</strong>The same HTML and scoped CSS shown here is sent to WordPress.</p></div>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

async function readApiPayload<T>(response: Response, operation: string): Promise<T> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    const requestId = response.headers.get("x-railway-request-id");
    const upstreamFailure = [502, 503, 504].includes(response.status) || /upstream error/i.test(raw);
    const message = upstreamFailure
      ? `${operation} Railway bağlantısı tarafından geçici olarak kesildi. Birkaç dakika sonra tekrar deneyin.${requestId ? ` İstek kodu: ${requestId}` : ""}`
      : `${operation} sunucudan okunamayan bir yanıt aldı (HTTP ${response.status || "unknown"}).`;
    throw Object.assign(new Error(message), {
      canRetryFinalize: upstreamFailure,
      requestId,
      status: response.status,
    });
  }
}

function LoginScreen({ onAuthenticated }: { onAuthenticated: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = await readApiPayload<{ authenticated?: boolean; email?: string; error?: string }>(response, "Giriş işlemi");
      if (!response.ok || !payload.authenticated || !payload.email) throw new Error(payload.error || "Sign-in failed.");
      onAuthenticated(payload.email);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand"><img className="brand-logo-image login-logo-image" src="/ttaa-logo.png" alt="Turkish Translation & Attestation Agency" /><div><strong>Content Studio</strong><small>İçerik yönetim paneli</small></div></div>
        <span className="login-kicker">GÜVENLİ GİRİŞ</span>
        <h1>İçerik üretmeye devam edin</h1>
        <p>Blog yazılarınızı hazırlayın, kontrol edin ve WordPress&apos;e güvenli şekilde taslak olarak aktarın.</p>
        <form onSubmit={submit}>
          <label>E-posta<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Şifre<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button type="submit" disabled={submitting}>{submitting ? "Giriş yapılıyor..." : "Giriş yap"}<b aria-hidden="true">→</b></button>
        </form>
        <small className="login-footnote">Güvenli ve yalnızca yerel oturum</small>
      </section>
      <aside className="login-aside"><span>01</span><h2>Konuyu yazın.</h2><span>02</span><h2>Sistem içeriği ve görselleri hazırlasın.</h2><span>03</span><h2>WordPress taslağını kontrol edin.</h2></aside>
    </main>
  );
}

export default function Home() {
  const asyncJob = useContentJob<DurableJobResult>("ttaa");
  const [brief, setBrief] = useState<Brief>(DEFAULT_BRIEF);
  const [activeView, setActiveView] = useState<WorkspaceView>("create");
  const [activeTab, setActiveTab] = useState<OutputTab>("preview");
  const [stage, setStage] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<Package>(() => buildPackage(DEFAULT_BRIEF));
  const [copied, setCopied] = useState(false);
  const [savedAt, setSavedAt] = useState<string>("");
  const [authState, setAuthState] = useState<"checking" | "authenticated" | "anonymous">("checking");
  const [adminEmail, setAdminEmail] = useState("");
  const [publishState, setPublishState] = useState<PublishState>({ status: "idle" });
  const [pendingPackage, setPendingPackage] = useState<Package | null>(null);
  const [resultIsCurrent, setResultIsCurrent] = useState(true);
  const [hasCompletedResult, setHasCompletedResult] = useState(false);
  const [integrationHealth, setIntegrationHealth] = useState<IntegrationHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [resultProjectId, setResultProjectId] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

  useEffect(() => {
    const current = asyncJob.job;
    if (!current) return;
    const timer = window.setTimeout(() => {
      const stages: Record<string, number> = {
        queued: 1, research: 1, writer: 2, writing: 2, editor: 2,
        "quality-control": 3, images: 3, "wordpress-media": 4,
        "wordpress-draft": 4, persistence: 4, completed: 4,
      };
      setStage(stages[current.stage] || 1);
      if (current.status === "queued" || current.status === "running") {
        setIsGenerating(true);
        setResultIsCurrent(false);
        setPublishState(current.stage.startsWith("wordpress") ? { status: "publishing" } : { status: "idle" });
        return;
      }
      setIsGenerating(false);
      if (current.status === "succeeded" && current.result?.package && current.result.wordpress) {
        const completed = normalizePackageHtml(current.result.package);
        const wordpress = current.result.wordpress;
        setResult(completed);
        setResultIsCurrent(true);
        setHasCompletedResult(true);
        setPendingPackage(null);
        setActiveTab("preview");
        setResultProjectId(current.result.projectId || null);
        setPublishState({
          status: "created",
          postId: wordpress.id,
          editUrl: wordpress.editUrl,
          persistenceSaved: true,
          seoApplied: Boolean(wordpress.seo?.applied),
          focusKeywordApplied: Boolean(wordpress.seo?.focusKeywordApplied),
          secondaryKeywordsApplied: Boolean(wordpress.seo?.secondaryKeywordsApplied),
          seoPlugin: wordpress.seo?.plugin || "none",
          canonical: wordpress.canonical,
          imagesReady: Boolean(current.result.images?.featured && current.result.images?.inline),
          warning: current.result.warning || wordpress.seo?.warning || wordpress.design?.warning,
        });
        window.localStorage.setItem("ttaa-studio-state", JSON.stringify({ result: completed }));
        setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      } else if (current.status === "failed" || current.status === "cancelled") {
        setPublishState({
          status: "error",
          message: current.error?.message || (current.status === "cancelled" ? "Çalışma güvenli şekilde iptal edildi." : "İçerik işi tamamlanamadı."),
          canRetryFinalize: Boolean(current.canRetry),
        });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [asyncJob.job]);

  useEffect(() => {
    const saved = window.localStorage.getItem("ttaa-studio-state");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as { brief?: Brief; result?: Package };
      const timer = window.setTimeout(() => {
        if (parsed.brief) {
          const restoredBrief = { ...DEFAULT_BRIEF, ...parsed.brief };
          setBrief(restoredBrief);
        }
        if (parsed.result) {
          setResult(normalizePackageHtml(parsed.result));
          setHasCompletedResult(true);
        }
      }, 0);
      return () => window.clearTimeout(timer);
    } catch { /* Ignore invalid local draft data. */ }
  }, []);

  useEffect(() => {
    void fetch("/api/auth/status", { cache: "no-store" })
      .then(async (response) => (await response.json()) as { authenticated: boolean; email: string | null })
      .then((payload) => {
        setAuthState(payload.authenticated ? "authenticated" : "anonymous");
        setAdminEmail(payload.email ?? "");
      })
      .catch(() => setAuthState("anonymous"));
  }, []);

  useEffect(() => {
    if (activeView === "integrations" && authState === "authenticated" && !integrationHealth) void checkIntegrations();
  }, [activeView, authState, integrationHealth]);

  useEffect(() => {
    if (authState !== "authenticated" || !hasCompletedResult || result.images || !result.slug) return;
    let cancelled = false;
    void fetch(`/api/projects/media?slug=${encodeURIComponent(result.slug.replace(/^\/+|\/+$/g, ""))}`, { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as { html: string; images: { featured: FinalImageAsset; inline: FinalImageAsset } } : null)
      .then((payload) => {
        if (!payload || cancelled) return;
        setResult((current) => current.slug === result.slug && !current.images
          ? normalizePackageHtml({ ...current, html: payload.html, images: payload.images })
          : current);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [authState, hasCompletedResult, result.images, result.slug]);

  const output = useMemo(() => activeTab === "schema" ? result.schema : activeTab === "head" ? result.head : result.html, [activeTab, result]);

  function updateBrief<K extends keyof Brief>(key: K, value: Brief[K]) {
    setBrief((current) => ({ ...current, [key]: value }));
  }

  async function finalizeProject(next: Package): Promise<Package> {
    setPublishState({ status: "publishing" });
    try {
      const response = await fetch("/api/projects/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief, package: next }),
      });
      const payload = await readApiPayload<{
        error?: string;
        retryable?: boolean;
        phase?: string;
        package?: Package;
        images?: { featured: FinalImageAsset; inline: FinalImageAsset };
        wordpress?: { id: number; status: string; editUrl: string; canonical: string; seo?: { plugin: string; applied: boolean; focusKeywordApplied?: boolean; secondaryKeywordsApplied?: boolean; warning?: string }; design?: { sharedStylesheetReady: boolean; inlineFallbackEmbedded: boolean; warning?: string } };
        persistence?: { saved: boolean; warning?: string };
      }>(response, "Görsel ve WordPress taslak aktarımı");
      if (response.status === 401) {
        setAuthState("anonymous");
        throw new Error("Your session expired. Sign in again to create the WordPress draft.");
      }
      if (!response.ok || !payload.wordpress) {
        const transferError = new Error(payload.error || "The WordPress draft could not be created.");
        throw Object.assign(transferError, { canRetryFinalize: Boolean(payload.retryable) });
      }
      setPublishState({
        status: "created",
        postId: payload.wordpress.id,
        editUrl: payload.wordpress.editUrl,
        persistenceSaved: Boolean(payload.persistence?.saved),
        seoApplied: Boolean(payload.wordpress.seo?.applied),
        focusKeywordApplied: Boolean(payload.wordpress.seo?.focusKeywordApplied),
        secondaryKeywordsApplied: Boolean(payload.wordpress.seo?.secondaryKeywordsApplied),
        seoPlugin: payload.wordpress.seo?.plugin || "none",
        canonical: payload.wordpress.canonical,
        imagesReady: Boolean(payload.images?.featured && payload.images?.inline),
        warning: [payload.persistence?.warning, payload.wordpress.seo?.warning, payload.wordpress.design?.warning].filter(Boolean).join(" ") || undefined,
      });
      return normalizePackageHtml(payload.package || { ...next, images: payload.images });
    } catch (publishError) {
      const error = publishError instanceof Error ? publishError : new Error("Automatic draft creation failed.");
      const canRetryFinalize = Boolean((error as Error & { canRetryFinalize?: boolean }).canRetryFinalize);
      const retryableError = Object.assign(error, { canRetryFinalize });
      setPublishState({ status: "error", message: error.message, canRetryFinalize });
      throw retryableError;
    }
  }

  async function generateLegacy() {
    setIsGenerating(true);
    setResultIsCurrent(false);
    setPublishState({ status: "idle" });
    setStage(1);
    try {
      const generationResponse = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brief),
      });
      const generationPayload = await readApiPayload<{
        error?: string;
        article?: GeneratedArticle;
        links?: ResearchedLink[];
        generation?: GenerationTrace;
        research?: { mode: string; researchedAt: string };
      }>(generationResponse, "İçerik üretimi");
      if (generationResponse.status === 401) {
        setAuthState("anonymous");
        throw new Error("Your session expired before AI research could start.");
      }
      if (!generationResponse.ok || !generationPayload.article || !generationPayload.links || !generationPayload.generation) {
        throw new Error(generationPayload.error || "OpenAI did not return a complete article package.");
      }
      setStage(2);
      const next = buildPackage(brief, generationPayload.links, generationPayload.article, generationPayload.generation, generationPayload.research);
      setPendingPackage(next);
      setStage(3);
      const finalized = await finalizeProject(next);
      setResult(finalized);
      setResultIsCurrent(true);
      setHasCompletedResult(true);
      setPendingPackage(null);
      setStage(4);
      setActiveTab("preview");
      const payload = JSON.stringify({ brief, result: finalized });
      window.localStorage.setItem("ttaa-studio-state", payload);
      setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch (generationError) {
      const error = generationError instanceof Error ? generationError : new Error("Generation failed.");
      setPublishState({ status: "error", message: error.message, canRetryFinalize: Boolean((error as Error & { canRetryFinalize?: boolean }).canRetryFinalize) });
    } finally {
      setIsGenerating(false);
    }
  }

  async function generate() {
    if (!brief.topic.trim()) return;
    setIsGenerating(true);
    setResultIsCurrent(false);
    setPublishState({ status: "idle" });
    setStage(1);
    try {
      await asyncJob.start(brief as unknown as Record<string, unknown>);
    } catch (error) {
      if (error instanceof JobApiError && error.code === "ASYNC_JOBS_DISABLED") {
        await generateLegacy();
        return;
      }
      const message = error instanceof Error ? error.message : "Dayanıklı içerik işi başlatılamadı.";
      setIsGenerating(false);
      setPublishState({ status: "error", message, canRetryFinalize: false });
    }
  }

  async function copyCurrent() {
    const text = activeTab === "schema" ? result.schema : activeTab === "head" ? result.head : activeTab === "html" ? result.html : `${result.head}\n\n${result.html}\n\n<script type="application/ld+json">\n${result.schema}\n</script>`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function downloadHtml() {
    const htmlDocument = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${result.head}<link rel="stylesheet" href="translation-article.css"></head><body>${result.html}<script type="application/ld+json">${result.schema.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
    const blob = new Blob([htmlDocument], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${result.slug.replaceAll("/", "") || "ttaa-article"}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function checkIntegrations() {
    setHealthLoading(true);
    try {
      const response = await fetch("/api/integrations/health", { cache: "no-store" });
      if (response.status === 401) {
        setAuthState("anonymous");
        return;
      }
      const payload = (await response.json()) as IntegrationHealth;
      setIntegrationHealth(payload);
    } finally {
      setHealthLoading(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthState("anonymous");
    setAdminEmail("");
  }

  if (authState === "checking") {
    return <main className="auth-loading"><span className="pulse-ring" /><strong>TTAA Content Studio hazırlanıyor...</strong></main>;
  }

  if (authState === "anonymous") {
    return <LoginScreen onAuthenticated={(email) => { setAdminEmail(email); setAuthState("authenticated"); }} />;
  }

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <CompanySwitcher current="ttaa" />
        <div className="header-actions"><span className="local-badge"><i /> WordPress: Taslak</span><span className="save-state">{savedAt ? `${savedAt} kaydedildi` : adminEmail}</span><button className="ghost-button" onClick={() => { setBrief(DEFAULT_BRIEF); setResult(buildPackage(DEFAULT_BRIEF)); setPendingPackage(null); setResultIsCurrent(true); setHasCompletedResult(false); setPublishState({ status: "idle" }); }}>Yeni içerik</button><button className="ghost-button quiet" onClick={signOut}>Çıkış</button></div>
      </header>

      <div className="studio-layout">
        <nav className="rail" aria-label="Ana menü">
          {([
            ["create", "01", "İçerik oluştur"],
            ["library", "02", "Son çalışma"],
            ["brand", "03", "Tasarım sistemi"],
            ["integrations", "04", "Bağlantılar"],
          ] as [WorkspaceView, string, string][]).map(([view, icon, label]) => (
            <button key={view} className={activeView === view ? "active" : ""} onClick={() => setActiveView(view)} aria-label={label}><span>{icon}</span><small>{label}</small></button>
          ))}
        </nav>

        <section className="workspace">
          {activeView === "create" && <>
            <div className="workspace-heading">
              <div><span className="page-kicker">YENİ ÇALIŞMA</span><h1>Blog içeriği oluştur</h1><p>Başlığı girin. Araştırma, SEO, görseller ve WordPress taslağı otomatik hazırlansın.</p></div>
              <div className="safety-note"><span>✓</span><div><strong>Güvenli çalışma</strong><small>Hiçbir içerik otomatik yayınlanmaz.</small></div></div>
            </div>
            <aside className="brief-panel">
              <div className="panel-heading"><div><small>1. ADIM</small><h2>İçerik bilgileri</h2><p>Sadece başlık zorunludur. Diğer alanları sistem doldurabilir.</p></div></div>
              <div className="form-stack">
                <label className="primary-field">Yazı başlığı<input value={brief.topic} onChange={(event) => updateBrief("topic", event.target.value)} placeholder="Örn. QVP Verification for KSA Work Visa" autoFocus /><small>Yazının ana konusu ve arama niyeti bu başlıktan belirlenir.</small></label>
                <div className="two-fields"><label>İçerik türü<select value={brief.mode} onChange={(event) => updateBrief("mode", event.target.value as Brief["mode"])}><option value="new">Yeni yazı oluştur</option><option value="update">Mevcut yazıyı geliştir</option></select></label><label>İçerik yapısı<select value={brief.length} onChange={(event) => updateBrief("length", event.target.value as Brief["length"])}><option value="standard">Standart makale</option><option value="guide">Detaylı rehber</option><option value="service">Hizmet sayfası</option></select></label></div>
              </div>
              <details className="advanced-card">
                <summary><span><strong>İsteğe bağlı ayrıntılar</strong><small>Daha fazla kontrol istiyorsanız doldurun</small></span><b>+</b></summary>
                <div className="advanced-content form-stack">
                  <div className="two-fields"><label>Focus keyword <span className="optional">isteğe bağlı</span><input value={brief.primaryKeyword} onChange={(event) => updateBrief("primaryKeyword", event.target.value)} placeholder="Boşsa otomatik belirlenir" /></label><label>Kelime hedefi <span className="optional">isteğe bağlı</span><input type="number" min="800" max="4000" step="100" value={brief.desiredWordCount} onChange={(event) => updateBrief("desiredWordCount", event.target.value)} placeholder="Örn. 2200" /></label></div>
                  <div className="two-fields"><label>Ülke / yetki alanı<input value={brief.country} onChange={(event) => updateBrief("country", event.target.value)} placeholder="Başlıktan belirlenebilir" /></label><label>Hedef okuyucu<input value={brief.audience} onChange={(event) => updateBrief("audience", event.target.value)} placeholder="Örn. work visa applicants" /></label></div>
                  <label>Belge veya hizmet türü<input value={brief.documentType} onChange={(event) => updateBrief("documentType", event.target.value)} placeholder="Örn. diploma, apostille, translation" /></label>
                  <label>Mevcut metin veya notlar<textarea value={brief.sourceText} onChange={(event) => updateBrief("sourceText", event.target.value)} placeholder="Geliştirilecek eski yazıyı veya kaynak notlarını buraya ekleyin." /></label>
                </div>
              </details>
              <details className="advanced-card output-settings">
                <summary><span><strong>Teknik çıktı ayarları</strong><small>Önerilen ayarlar hazır seçilidir</small></span><b>+</b></summary>
                <div className="settings-card"><Toggle label="İçerikte H1 kullan" checked={brief.includeH1} onChange={(value) => updateBrief("includeH1", value)} /><Toggle label="Breadcrumb göster" checked={brief.visibleBreadcrumb} onChange={(value) => updateBrief("visibleBreadcrumb", value)} /><Toggle label="Article schema" checked={brief.articleSchema} onChange={(value) => updateBrief("articleSchema", value)} /><Toggle label="FAQ schema" checked={brief.faqSchema} onChange={(value) => updateBrief("faqSchema", value)} /><Toggle label="Breadcrumb schema" checked={brief.breadcrumbSchema} onChange={(value) => updateBrief("breadcrumbSchema", value)} /></div>
              </details>
              <button className="generate-button" onClick={generate} disabled={isGenerating || !brief.topic.trim()}><span>{isGenerating ? "İçerik hazırlanıyor..." : "İçeriği oluştur ve taslak gönder"}</span><b aria-hidden="true">→</b></button>
              <p className="privacy-note"><span>✓</span> Yazı tamamlanmadan gösterilmez ve WordPress&apos;e yalnızca taslak olarak gönderilir.</p>
            </aside>

            <section className="output-panel">
              <div className="workflow-strip">
                {STAGES.map((item, index) => <div key={item.label} className={stage > index ? "done" : stage === index ? "current" : ""}><span>{stage > index ? "✓" : index + 1}</span><div><strong>{item.label}</strong><small>{item.note}</small></div></div>)}
              </div>

              {publishState.status === "created" && <div className="publish-banner success"><span>✓</span><div><strong>WordPress taslağı hazır</strong><small>Yazı #{publishState.postId} · {publishState.imagesReady ? "2 görsel yüklendi" : "Görseller kontrol edilmeli"} · {publishState.seoApplied ? `${publishState.seoPlugin.toUpperCase()} SEO alanları doğrulandı` : publishState.focusKeywordApplied ? "Anahtar kelimeler doğrulandı; diğer SEO alanlarını kontrol edin" : "AIOSEO focus keyword kontrol edilmeli"}{publishState.persistenceSaved ? " · Yedek alındı" : " · Yedekleme kontrol edilmeli"}</small>{publishState.warning ? <small>{publishState.warning}</small> : null}</div><div style={{ display: "flex", gap: 8 }}>{resultProjectId && <button type="button" onClick={() => { setEditingProjectId(resultProjectId); setActiveView("library"); }}>Düzenle ve WordPress&apos;e Gönder</button>}<a href={publishState.editUrl} target="_blank" rel="noreferrer">WordPress&apos;te aç</a></div></div>}
              {publishState.status === "error" && <div className="publish-banner error"><span>!</span><div><strong>{publishState.canRetryFinalize ? "Eksik aşama yeniden denenebilir" : "İçerik oluşturulamadı"}</strong><small>{publishState.message}</small>{asyncJob.job?.error?.requestId ? <small>Takip kodu: {asyncJob.job.error.requestId}</small> : null}</div>{asyncJob.job?.canRetry ? <button onClick={() => void asyncJob.retry()}>Kaldığı yerden yeniden dene</button> : publishState.canRetryFinalize && pendingPackage ? <button onClick={() => void finalizeProject(pendingPackage).then((finalized) => { setResult(finalized); setPendingPackage(null); setResultIsCurrent(true); setHasCompletedResult(true); }).catch(() => undefined)}>Görselleri ve taslağı yeniden dene</button> : null}</div>}

              <div className="output-toolbar">
                <div className="tab-list" role="tablist">
                  {([[
                    "preview", "Önizleme"], ["seo", "SEO özeti"], ["html", "HTML"], ["head", "SEO Head"], ["schema", "Schema"]] as [OutputTab, string][]).map(([tabName, label]) => <button role="tab" aria-selected={activeTab === tabName} className={activeTab === tabName ? "active" : ""} key={tabName} onClick={() => setActiveTab(tabName)}>{label}</button>)}
                </div>
                <div className="tool-actions"><button onClick={downloadHtml}>HTML indir</button><button className="copy-button" onClick={copyCurrent}>{copied ? "Kopyalandı ✓" : activeTab === "preview" ? "Paketi kopyala" : "Kopyala"}</button></div>
              </div>

              <div className="output-canvas">
                {isGenerating ? <div className="private-progress"><span className="pulse-ring" /><small>İÇERİK HAZIRLANIYOR</small><h2>{asyncJob.job?.stage === "research" ? "Kaynaklar araştırılıyor" : asyncJob.job?.stage === "writer" || asyncJob.job?.stage === "writing" ? "Yazı hazırlanıyor" : asyncJob.job?.stage === "editor" ? "Editör kontrolü yapılıyor" : asyncJob.job?.stage === "quality-control" ? "Kalite kapıları kontrol ediliyor" : asyncJob.job?.stage === "images" ? "İki görsel hazırlanıyor" : asyncJob.job?.stage?.startsWith("wordpress") ? "WordPress taslağı hazırlanıyor" : stage === 1 ? "Çalışma kuyruğa alındı" : "Paket güvenli şekilde tamamlanıyor"}</h2><p>Bu çalışma Railway worker üzerinde devam eder. Sayfayı kapatabilir veya yenileyebilirsiniz; tekrar girişte kaldığı yerden görünür.</p>{asyncJob.job?.canCancel ? <button className="ghost-button" onClick={() => void asyncJob.cancel()}>Çalışmayı iptal et</button> : null}<div className="progress-track"><span style={{ width: `${asyncJob.job?.progress ?? (publishState.status === "publishing" ? 94 : Math.max(18, stage * 28))}%` }} /></div></div> :
                  !resultIsCurrent && publishState.status === "error" ? <div className="stale-result-guard"><span>!</span><small>YENİ ÇALIŞMA TAMAMLANAMADI</small><h2>Sonuç güvenli şekilde bekletiliyor</h2><p>{publishState.canRetryFinalize && pendingPackage ? "Hazırlanan yazı korunuyor. Yukarıdaki yeniden dene düğmesiyle görsel ve WordPress adımına devam edebilirsiniz." : "Önceki çalışma yeni sonuçla karışmaması için gizlendi. Yukarıdaki hata bilgisini kontrol edip tekrar deneyin."}</p></div> :
                  !hasCompletedResult ? <div className="empty-result"><span>01</span><h2>Yeni içeriğiniz burada görünecek</h2><p>Soldaki alana yazı başlığını girin ve “İçeriği oluştur ve taslak gönder” düğmesine basın.</p><ul><li>Resmî kaynak araştırması</li><li>SEO ve AIOSEO alanları</li><li>İki özgün görsel</li><li>WordPress taslağı</li></ul></div> :
                  activeTab === "preview" ? <div className="complete-preview">{result.images ? <figure className="featured-image-preview"><div><small>{result.images.featured.origin === "recovered-wordpress-draft" ? "PREVIOUS WORDPRESS FEATURED IMAGE · NOT FROM A NEW RUN" : "NEW TTAA WORDPRESS FEATURED IMAGE"}</small><span>Media #{result.images.featured.wordpress.id}</span></div><img src={result.images.featured.wordpress.url} alt={result.images.featured.alt} /></figure> : null}<ArticleRenderer html={result.html} /></div> :
                  activeTab === "html" || activeTab === "head" || activeTab === "schema" ? <div className="code-view"><div className="code-bar"><span>{activeTab === "html" ? "article-body.html" : activeTab === "head" ? "seo-head.html" : "structured-data.json"}</span><small>{activeTab === "html" ? "Semantic HTML · shared CSS" : activeTab === "head" ? "Applied through AIOSEO" : "AIOSEO-aware schema policy"}</small></div><pre><code>{output}</code></pre></div> :
                  <div className="seo-view">
                    <div className="seo-score"><span>OK</span><div><strong>Topic-lock quality gate</strong><small>{result.generation?.topicLockEnforced ? "Passed before package assembly" : "Available after AI generation"}</small></div></div>
                    <div className="seo-grid"><article><small>FOCUS KEYWORD</small><h3>{result.focusKeyword}</h3><span>One primary search intent · {result.focusKeyword.split(/\s+/).filter(Boolean).length} words</span></article><article><small>SECONDARY KEYWORDS</small><p>{result.secondaryKeywords.join(" · ") || "Generated during the AI writing pass"}</p><span>{result.secondaryKeywords.length} unique additional keyphrases</span></article><article><small>SEO TITLE</small><h3>{result.title}</h3><span>{result.title.length} characters · target 50–60</span></article><article><small>META DESCRIPTION</small><p>{result.meta}</p><span>{result.meta.length} characters · target 120–160</span></article><article><small>CANONICAL URL</small><code>{result.canonical}</code><span>Written to AIOSEO after draft creation</span></article><article><small>AIOSEO TRANSFER</small><p>{publishState.status === "created" ? publishState.focusKeywordApplied && publishState.secondaryKeywordsApplied ? "Focus and additional keyphrases verified by read-back." : "Focus keyword needs attention in AIOSEO." : "Ready to write after draft creation."}</p><span>Authenticated write + read-back + endpoint fallback</span></article><article><small>PRIMARY IMAGE PROMPT</small><p>{result.imagePrompt}</p><span>Topic-specific visual concept</span></article></div>
                    {result.imageSuggestions?.length ? <div className="link-plan"><div><small>IMAGE SUGGESTIONS</small><h3>Topic-specific visual plan</h3></div>{result.imageSuggestions.map((item, index) => <article key={`${item.placement}-${index}`}><div><strong>{item.placement}</strong><code>{item.altText}</code></div><span>IMAGE {index + 1}</span></article>)}</div> : null}
                    {result.images ? <div className="generated-image-section"><div><small>GENERATED MEDIA</small><h3>WordPress-ready OpenAI images</h3></div><div className="generated-image-grid">{([result.images.featured, result.images.inline] as FinalImageAsset[]).map((image) => <article key={image.role}><img src={image.wordpress.url} alt={image.alt} /><div><strong>{image.role === "featured" ? "Featured image" : "Inline article image"}</strong><span>{image.width}×{image.height} · {image.format.toUpperCase()} · {image.quality} · {image.model}</span><code>{image.alt}</code><small>{image.branding?.logoReferenceApplied ? "TTAA LOGO REFERENCE · TOP LEFT · EXACT HEADLINE REQUESTED · " : ""}WordPress media #{image.wordpress.id}{image.supabase ? ` · Backup: ${image.supabase.bucket}` : " · Supabase backup warning"}</small></div></article>)}</div></div> : null}
                    <div className="link-plan"><div><small>CONTEXTUAL LINK AUDIT</small><h3>TTAA pages and verified official sources</h3></div>{result.links.map((link) => <article key={link.url}><div><strong>{link.anchor}</strong><code>{link.url}</code></div><span>{link.source === "official" ? "OFFICIAL SOURCE" : "INTERNAL"} · {link.reason}</span></article>)}</div>
                    <div className="publish-check"><small>FINAL CHECKS</small><ul><li><span>✓</span>One focus keyword and 3–5 unique secondary keyphrases</li><li><span>✓</span>Focus keyword placement, title, meta and slug passed the deterministic gate</li><li><span>✓</span>SEO title, meta description, canonical and keyphrases prepared for AIOSEO</li><li><span>✓</span>One H1 with ordered H2/H3 hierarchy</li><li><span>✓</span>Article/Breadcrumb schema ownership avoids plugin duplication</li><li><span>✓</span>Scoped article styles are embedded for WordPress theme compatibility</li><li><span>✓</span>Visible FAQ matches optional FAQ schema</li><li><span>!</span>Verify time-sensitive official requirements before publishing</li></ul><a className="shared-css-download" href="/translation-article.css" download>Download shared WordPress CSS</a></div>
                  </div>}
              </div>
            </section>
          </>}

          {activeView === "library" && <ProjectLibrary brand="ttaa" brandLabel="TTAA" initialProjectId={editingProjectId} onProjectClosed={() => setEditingProjectId(null)} />}
          {activeView === "brand" && <section className="utility-view"><small>TTAA DESIGN SYSTEM</small><h1>One consistent editorial language</h1><p>The generator follows both TTAA agent manuals: the SEO and AI visibility operating system plus the WordPress design system.</p><div className="brand-grid"><article><span style={{ background: "#01adf2" }} /><strong>TT Blue</strong><code>#01adf2</code></article><article><span style={{ background: "#003e5b" }} /><strong>TT Navy</strong><code>#003e5b</code></article><article><span style={{ background: "#eaf8ff" }} /><strong>TT Blue Soft</strong><code>#eaf8ff</code></article><article><span style={{ background: "#486c7d" }} /><strong>TT Text</strong><code>#486c7d</code></article></div><div className="rules-panel"><h2>Always enforced</h2><ul><li>White content background and sidebar-safe width</li><li>Scoped class prefix for every generated page</li><li>No external fonts, icon libraries or JavaScript in blog output</li><li>Responsive H1/H2, cards, lists and image blocks</li><li>Real HTML text, semantic lists and accessible labels</li></ul></div></section>}
          {activeView === "integrations" && <section className="utility-view integrations-view">
            <small>LIVE CONNECTIONS</small>
            <h1>OpenAI, WordPress and Supabase are server-connected</h1>
            <p>Sensitive keys are loaded from the server environment and never displayed in the browser. Every completed package is sent to WordPress with the immutable status <strong>draft</strong>.</p>
            <div className="health-grid">
              <article className={integrationHealth?.openai?.connected ? "healthy" : "attention"}><span>{integrationHealth?.openai?.connected ? "OK" : "…"}</span><div><small>OPENAI TEXT + IMAGE APIs</small><h3>{integrationHealth?.openai?.connected ? "Connected" : healthLoading ? "Checking…" : "Not checked"}</h3><p>{integrationHealth?.openai?.connected ? `Writer: ${integrationHealth.openai.model || "configured"} · Images: ${integrationHealth.openai.image?.model || "configured"} ${integrationHealth.openai.image ? `(${integrationHealth.openai.image.size}, ${integrationHealth.openai.image.quality} ${integrationHealth.openai.image.format.toUpperCase()})` : ""}` : integrationHealth?.openai?.error || "Server-side API key"}</p></div></article>
              <article className={integrationHealth?.wordpress?.connected ? "healthy" : "attention"}><span>{integrationHealth?.wordpress?.connected ? "✓" : "…"}</span><div><small>WORDPRESS REST API</small><h3>{integrationHealth?.wordpress?.connected ? "Connected" : healthLoading ? "Checking…" : "Not checked"}</h3><p>{integrationHealth?.wordpress?.connected ? `Authenticated as ${integrationHealth.wordpress.user?.name || "WordPress user"} · SEO: ${integrationHealth.wordpress.user?.seoPlugin?.toUpperCase() || "not detected"}` : integrationHealth?.wordpress?.error || "Server-side application password"}</p></div></article>
              <article className={integrationHealth?.wordpress?.user?.articleCss?.ready ? "healthy" : "attention"}><span>{integrationHealth?.wordpress?.user?.articleCss?.ready ? "✓" : "!"}</span><div><small>WORDPRESS ARTICLE CSS</small><h3>{integrationHealth?.wordpress?.user?.articleCss?.ready ? "Shared stylesheet ready" : "Plugin installation required"}</h3><p>{integrationHealth?.wordpress?.user?.articleCss?.ready ? "The canonical stylesheet is available and each draft embeds the same scoped rules for reliable theme compatibility." : "Install the TTAA Content Studio Styles plugin before creating the next draft."}</p></div></article>
              <article className={integrationHealth?.supabase?.connected ? "healthy" : "attention"}><span>{integrationHealth?.supabase?.connected ? "✓" : "…"}</span><div><small>SUPABASE API</small><h3>{integrationHealth?.supabase?.connected ? "Connected" : healthLoading ? "Checking…" : "Not checked"}</h3><p>Service-role access stays on the server.</p></div></article>
              <article className={integrationHealth?.supabase?.storageReady ? "healthy" : "attention"}><span>{integrationHealth?.supabase?.storageReady ? "✓" : "!"}</span><div><small>PRIVATE CONTENT + IMAGE STORAGE</small><h3>{integrationHealth?.supabase?.storageReady ? "Storage ready" : "Storage not ready"}</h3><p>{integrationHealth?.supabase?.storageReady ? `Packages: ${integrationHealth.supabase.bucket} · Images: ${integrationHealth.supabase.imageBucket}` : integrationHealth?.supabase?.error || "Check the server connection."}</p></div></article>
              <article className="healthy"><span>✓</span><div><small>WORDPRESS STATUS</small><h3>Draft only</h3><p>The server refuses non-draft post creation.</p></div></article>
            </div>
            <button className="health-button" onClick={() => void checkIntegrations()} disabled={healthLoading}>{healthLoading ? "Checking connections…" : "Check connections"}</button>
            <div className="connection-plan"><span>01</span><div><strong>Private article build</strong><p>The complete package is assembled before display.</p></div><span>02</span><div><strong>Supabase persistence</strong><p>Content package and WordPress reference are stored.</p></div><span>03</span><div><strong>WordPress draft</strong><p>The post is created automatically and never published.</p></div></div>
          </section>}
        </section>
      </div>
    </main>
  );
}
