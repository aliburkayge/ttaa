import { buildAyContactUrl, getAyCanonical } from "./ay-link-catalog";
import type { AyGenerationTrace } from "./ay-openai";
import type { ResearchedLink } from "./link-catalog";
import type { GeneratedArticle, ImageSuggestion } from "./openai";

export type AyRenderOptions = {
  includeH1: boolean;
  visibleBreadcrumb: boolean;
  articleSchema: boolean;
  faqSchema: boolean;
};

export type AyGeneratedImageAsset = {
  role: "featured" | "inline";
  dataUrl: string;
  fileName: string;
  contentType: "image/webp" | "image/jpeg" | "image/png";
  alt: string;
  titleText: string;
  caption: string;
  description: string;
  prompt: string;
  revisedPrompt?: string;
  width: number;
  height: number;
  format: "webp" | "jpeg" | "png";
  model: string;
  quality: "low" | "medium" | "high";
  branding: { brand: "ay-tercume"; logoReferenceApplied: true; logoPlacement: "top-left"; headlineRequested: true; method: "gpt-image-2-edit" };
  wordpress?: { id: number; url: string };
};

export type AyContentPackage = {
  title: string;
  meta: string;
  slug: string;
  canonical: string;
  canonicalReady: boolean;
  focusKeyword: string;
  secondaryKeywords: string[];
  head: string;
  html: string;
  schema: string;
  preview: GeneratedArticle;
  imagePrompt: string;
  imageSuggestions: ImageSuggestion[];
  images?: { featured: AyGeneratedImageAsset; inline: AyGeneratedImageAsset };
  wordpress?: {
    id: number;
    status: "draft";
    editUrl: string;
    canonical: string;
    seo: { plugin: string; applied: boolean; focusKeywordApplied: boolean; secondaryKeywordsApplied: boolean; warning?: string };
    design: { sharedStylesheetReady: boolean; inlineFallbackEmbedded: boolean; warning?: string };
  };
  links: ResearchedLink[];
  generation: AyGenerationTrace;
  research: { mode: string; researchedAt: string };
};

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function linkedText(value: string, links: ResearchedLink[], used: Set<string>) {
  let html = escapeHtml(value);
  for (const link of [...links].sort((a, b) => b.anchor.length - a.anchor.length)) {
    if (used.has(link.url)) continue;
    const anchor = escapeHtml(link.anchor);
    const pattern = new RegExp(escapeRegExp(anchor), "i");
    if (!pattern.test(html)) continue;
    const external = link.source === "official" || /^https:\/\/(?:api\.)?whatsapp\.com/.test(link.url);
    html = html.replace(pattern, (match) => `<a class="ayc-context-link ayc-link-${link.source}" href="${escapeHtml(link.url)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${match}</a>`);
    used.add(link.url);
  }
  return html;
}

function buildHead(article: GeneratedArticle, canonical: string) {
  const canonicalTag = /^https:\/\//.test(canonical)
    ? `<link rel="canonical" href="${escapeHtml(canonical)}">`
    : "<!-- Canonical, AY_WP_URL tanımlandığında AIOSEO üzerinden uygulanacaktır. -->";
  return `<title>${escapeHtml(article.seoTitle)}</title>\n<meta name="description" content="${escapeHtml(article.metaDescription)}">\n${canonicalTag}\n<meta name="robots" content="index, follow, max-image-preview:large">`;
}

function buildHtml(article: GeneratedArticle, links: ResearchedLink[], options: AyRenderOptions) {
  const used = new Set<string>();
  const paragraphs = (value: string) => value.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean).map((item) => `<p>${linkedText(item, links, used)}</p>`).join("");
  const heading = options.includeH1 ? `<h1 class="ayc-title">${escapeHtml(article.title)}</h1>` : `<div class="ayc-title" role="heading" aria-level="2">${escapeHtml(article.title)}</div>`;
  const breadcrumb = options.visibleBreadcrumb ? `<nav class="ayc-breadcrumb" aria-label="Breadcrumb"><a href="/">Ana Sayfa</a><span aria-hidden="true">›</span><a href="/hizmetler/">Hizmetler</a><span aria-hidden="true">›</span><span aria-current="page">${escapeHtml(article.title)}</span></nav>` : "";
  const sections = article.sections.map((section, index) => `<section class="ayc-section" aria-labelledby="ayc-section-${index + 1}">
  <div class="ayc-section-heading"><span class="ayc-section-line" aria-hidden="true"></span><div><span class="ayc-section-label">BÖLÜM ${String(index + 1).padStart(2, "0")}</span><h2 id="ayc-section-${index + 1}">${escapeHtml(section.title)}</h2></div></div>
  <div class="ayc-content-card">${paragraphs(section.body)}${section.items.length ? `<ul class="ayc-list">${section.items.map((item) => `<li><span class="ayc-check" aria-hidden="true">✓</span><span>${linkedText(item, links, used)}</span></li>`).join("")}</ul>` : ""}</div>
</section>${index === 1 ? "\n<!-- AY_INLINE_IMAGE -->" : ""}`).join("\n");
  const faqs = article.faqs.map((faq) => `<article class="ayc-faq-item"><h3>${escapeHtml(faq.question)}</h3><p>${linkedText(faq.answer, links, used)}</p></article>`).join("");
  const internal = links.filter((link) => link.source === "internal").slice(0, 6);
  const official = links.filter((link) => link.source === "official").slice(0, 5);
  const resourceColumn = (title: string, items: ResearchedLink[], badge: string) => items.length ? `<div class="ayc-resource-column"><span class="ayc-resource-title">${title}</span><ul>${items.map((link) => `<li><a class="ayc-resource-link" href="${escapeHtml(link.url)}"${link.source === "official" ? ' target="_blank" rel="noopener noreferrer"' : ""}><span class="ayc-resource-badge">${badge}</span><span class="ayc-resource-copy"><strong>${escapeHtml(link.anchor)}</strong><small>${escapeHtml(link.reason)}</small></span><span class="ayc-resource-arrow">→</span></a></li>`).join("")}</ul></div>` : "";
  const contactUrl = buildAyContactUrl(article.title);
  const contactExternal = /^https:\/\//.test(contactUrl);

  return `<article id="ayc-article" class="ayc-article">
${breadcrumb}
<header class="ayc-hero"><span class="ayc-eyebrow">${escapeHtml(article.eyebrow)}</span>${heading}<p class="ayc-lead">${linkedText(article.intro, links, used)}</p></header>
<section class="ayc-tldr" aria-labelledby="ayc-tldr-title"><div class="ayc-tldr-mark" aria-hidden="true">ÖZ</div><div><span class="ayc-section-label">KISA CEVAP</span><h2 id="ayc-tldr-title">TL;DR</h2><ul>${article.tldr.map((item) => `<li>${linkedText(item, links, used)}</li>`).join("")}</ul></div></section>
${sections}
<aside class="ayc-resources" aria-labelledby="ayc-resources-title"><div class="ayc-resources-intro"><span class="ayc-section-label">İLGİLİ KAYNAKLAR</span><h2 id="ayc-resources-title">AY Tercüme Hizmetleri ve Resmî Kaynaklar</h2><p>Bu konuyla doğrudan ilgili hizmet sayfaları ve birincil kurumsal kaynaklar.</p></div><div class="ayc-resource-grid">${resourceColumn("AY TERCÜME HİZMETLERİ", internal, "AY")}${resourceColumn("RESMÎ KAYNAKLAR", official, "REF")}</div></aside>
<section class="ayc-section" aria-labelledby="ayc-faq-title"><div class="ayc-section-heading"><span class="ayc-section-line" aria-hidden="true"></span><div><span class="ayc-section-label">SIK SORULANLAR</span><h2 id="ayc-faq-title">Sık Sorulan Sorular</h2></div></div><div class="ayc-faq-list">${faqs}</div></section>
<section class="ayc-cta"><span class="ayc-section-label">SONRAKİ ADIM</span><h2>${escapeHtml(article.cta.title)}</h2><p>${linkedText(article.cta.body, links, used)}</p><a href="${escapeHtml(contactUrl)}"${contactExternal ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(article.cta.buttonLabel)}</a></section>
</article>`;
}

function buildSchema(article: GeneratedArticle, canonical: string, options: AyRenderOptions) {
  const graph: Record<string, unknown>[] = [];
  const absolute = /^https:\/\//.test(canonical);
  if (options.articleSchema) {
    graph.push({
      "@type": "BlogPosting",
      ...(absolute ? { "@id": `${canonical}#article`, mainEntityOfPage: canonical } : {}),
      headline: article.title,
      description: article.metaDescription,
      inLanguage: "tr-TR",
      author: { "@type": "Organization", name: "AY Tercüme" },
      publisher: { "@type": "Organization", name: "AY Tercüme" },
    });
  }
  if (options.faqSchema) graph.push({ "@type": "FAQPage", mainEntity: article.faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) });
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2);
}

export function buildAyContentPackage(article: GeneratedArticle, links: ResearchedLink[], options: AyRenderOptions, generation: AyGenerationTrace, research: { mode: string; researchedAt: string }): AyContentPackage {
  const canonical = getAyCanonical(article.slug);
  return {
    title: article.seoTitle,
    meta: article.metaDescription,
    slug: `/${article.slug}/`,
    canonical,
    canonicalReady: /^https:\/\//.test(canonical),
    focusKeyword: article.focusKeyword,
    secondaryKeywords: article.secondaryKeywords,
    head: buildHead(article, canonical),
    html: buildHtml(article, links, options),
    schema: buildSchema(article, canonical, options),
    preview: article,
    imagePrompt: article.imagePrompt,
    imageSuggestions: article.imageSuggestions,
    links,
    generation,
    research,
  };
}
