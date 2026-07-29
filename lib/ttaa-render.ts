import { buildTtaaWhatsAppUrl, type ResearchedLink } from "./link-catalog";
import type { GeneratedArticle, GenerationTrace } from "./openai";

export type TtaaRenderOptions = {
  includeH1?: boolean;
  visibleBreadcrumb?: boolean;
  articleSchema?: boolean;
  faqSchema?: boolean;
};

export type TtaaContentPackage = {
  title: string;
  meta: string;
  slug: string;
  canonical: string;
  focusKeyword: string;
  secondaryKeywords: string[];
  head: string;
  html: string;
  schema: string;
  preview: GeneratedArticle;
  imagePrompt: string;
  imageSuggestions: GeneratedArticle["imageSuggestions"];
  links: ResearchedLink[];
  generation: GenerationTrace;
  research: { mode: string; researchedAt: string };
  images?: Record<string, unknown>;
  wordpress?: Record<string, unknown>;
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
    const pattern = new RegExp(escapeRegExp(escapeHtml(link.anchor)), "i");
    if (!pattern.test(html)) continue;
    const external = link.source === "official" || /^https:\/\/(?:api\.)?whatsapp\.com/.test(link.url);
    html = html.replace(pattern, (match) => `<a class="ttaa-context-link ttaa-link-${link.source}" href="${escapeHtml(link.url)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${match}</a>`);
    used.add(link.url);
  }
  return html;
}

function buildHead(article: GeneratedArticle, canonical: string) {
  return `<title>${escapeHtml(article.seoTitle)}</title>
<meta name="description" content="${escapeHtml(article.metaDescription)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta name="robots" content="index, follow, max-image-preview:large">`;
}

function buildHtml(article: GeneratedArticle, links: ResearchedLink[], options: TtaaRenderOptions) {
  const used = new Set<string>();
  const paragraphs = (value: string) => value
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `<p>${linkedText(item, links, used)}</p>`)
    .join("");
  const heading = options.includeH1 === false
    ? `<div class="ttaa-title" role="heading" aria-level="2">${escapeHtml(article.title)}</div>`
    : `<h1 class="ttaa-title">${escapeHtml(article.title)}</h1>`;
  const breadcrumb = options.visibleBreadcrumb === false ? "" : `<nav class="ttaa-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">›</span><a href="/services/translation/">Translation Services</a><span aria-hidden="true">›</span><span aria-current="page">${escapeHtml(article.title)}</span></nav>`;
  const sections = article.sections.map((section, index) => `<section class="ttaa-section" aria-labelledby="ttaa-section-${index + 1}">
  <div class="ttaa-section-heading"><span class="ttaa-section-line" aria-hidden="true"></span><div><span class="ttaa-section-label">SECTION ${String(index + 1).padStart(2, "0")}</span><h2 id="ttaa-section-${index + 1}">${escapeHtml(section.title)}</h2></div></div>
  <div class="ttaa-content-card">${paragraphs(section.body)}${section.items.length ? `<ul class="ttaa-list">${section.items.map((item) => `<li><span class="ttaa-check" aria-hidden="true">✓</span><span>${linkedText(item, links, used)}</span></li>`).join("")}</ul>` : ""}</div>
</section>${index === 1 ? "\n<!-- TTAA_INLINE_IMAGE -->" : ""}`).join("\n");
  const faqs = article.faqs.map((faq) => `<article class="ttaa-faq-item"><h3>${escapeHtml(faq.question)}</h3><p>${linkedText(faq.answer, links, used)}</p></article>`).join("");
  const internal = links.filter((link) => link.source === "internal").slice(0, 6);
  const official = links.filter((link) => link.source === "official").slice(0, 5);
  const resources = (title: string, items: ResearchedLink[], badge: string) => items.length ? `<div class="ttaa-resource-column"><span class="ttaa-resource-title">${title}</span><ul>${items.map((link) => `<li><a class="ttaa-resource-link" href="${escapeHtml(link.url)}"${link.source === "official" ? ' target="_blank" rel="noopener noreferrer"' : ""}><span class="ttaa-resource-badge">${badge}</span><span class="ttaa-resource-copy"><strong>${escapeHtml(link.anchor)}</strong><small>${escapeHtml(link.reason)}</small></span><span class="ttaa-resource-arrow">→</span></a></li>`).join("")}</ul></div>` : "";
  const whatsappUrl = buildTtaaWhatsAppUrl(article.title);

  return `<article id="ttaa-article" class="ttaa-article">
${breadcrumb}
<header class="ttaa-hero"><span class="ttaa-eyebrow">${escapeHtml(article.eyebrow)}</span>${heading}<p class="ttaa-lead">${linkedText(article.intro, links, used)}</p></header>
<section class="ttaa-tldr" aria-labelledby="ttaa-tldr-title"><div class="ttaa-tldr-mark" aria-hidden="true">TL</div><div><span class="ttaa-section-label">QUICK ANSWER</span><h2 id="ttaa-tldr-title">TL;DR</h2><ul>${article.tldr.map((item) => `<li>${linkedText(item, links, used)}</li>`).join("")}</ul></div></section>
${sections}
<aside class="ttaa-resources" aria-labelledby="ttaa-resources-title"><div class="ttaa-resources-intro"><span class="ttaa-section-label">RELATED RESOURCES</span><h2 id="ttaa-resources-title">TTAA Services and Official References</h2><p>Relevant TTAA services and primary institutional sources for this topic.</p></div><div class="ttaa-resource-grid">${resources("TTAA INTERNAL GUIDANCE", internal, "TT")}${resources("OFFICIAL REFERENCES", official, "REF")}</div></aside>
<section class="ttaa-section" aria-labelledby="ttaa-faq-title"><div class="ttaa-section-heading"><span class="ttaa-section-line" aria-hidden="true"></span><div><span class="ttaa-section-label">FREQUENTLY ASKED QUESTIONS</span><h2 id="ttaa-faq-title">Frequently Asked Questions</h2></div></div><div class="ttaa-faq-list">${faqs}</div></section>
<section class="ttaa-cta"><span class="ttaa-section-label">NEXT STEP</span><h2>${escapeHtml(article.cta.title)}</h2><p>${linkedText(article.cta.body, links, used)}</p><a href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.cta.buttonLabel)}</a></section>
</article>`;
}

function buildSchema(article: GeneratedArticle, canonical: string, options: TtaaRenderOptions) {
  const graph: Record<string, unknown>[] = [];
  if (options.articleSchema !== false) {
    graph.push({
      "@type": "BlogPosting",
      "@id": `${canonical}#article`,
      mainEntityOfPage: canonical,
      headline: article.title,
      description: article.metaDescription,
      inLanguage: "en",
      author: { "@type": "Organization", name: "Turkish Translation & Attestation Agency" },
      publisher: { "@type": "Organization", name: "Turkish Translation & Attestation Agency" },
    });
  }
  if (options.faqSchema !== false) {
    graph.push({ "@type": "FAQPage", mainEntity: article.faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) });
  }
  graph.push({
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://turkishtranslation.com.tr/" },
      { "@type": "ListItem", position: 2, name: "Translation Services", item: "https://turkishtranslation.com.tr/services/translation/" },
      { "@type": "ListItem", position: 3, name: article.title, item: canonical },
    ],
  });
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2);
}

export function buildTtaaContentPackage(
  article: GeneratedArticle,
  links: ResearchedLink[],
  options: TtaaRenderOptions,
  generation: GenerationTrace,
  research: { mode: string; researchedAt: string },
): TtaaContentPackage {
  const cleanSlug = article.slug.replace(/^\/+|\/+$/g, "");
  const canonical = `https://turkishtranslation.com.tr/${cleanSlug}/`;
  return {
    title: article.seoTitle,
    meta: article.metaDescription,
    slug: `/${cleanSlug}/`,
    canonical,
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
