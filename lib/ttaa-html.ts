const LEGACY_TTAA_CLASS_MAP: Readonly<Record<string, string>> = {
  "article-title": "ttaa-title",
  "article-hero": "ttaa-hero",
  eyebrow: "ttaa-eyebrow",
  lead: "ttaa-lead",
  tldr: "ttaa-tldr",
  "tldr-mark": "ttaa-tldr-mark",
  "article-section": "ttaa-section",
  "section-heading": "ttaa-section-heading",
  "section-line": "ttaa-section-line",
  "section-label": "ttaa-section-label",
  "content-card": "ttaa-content-card",
  "check-list": "ttaa-list",
  "check-icon": "ttaa-check",
  "context-link": "ttaa-context-link",
  "link-internal": "ttaa-link-internal",
  "link-official": "ttaa-link-official",
  "resources-intro": "ttaa-resources-intro",
  "resource-grid": "ttaa-resource-grid",
  "resource-column": "ttaa-resource-column",
  "resource-title": "ttaa-resource-title",
  "resource-link": "ttaa-resource-link",
  "resource-badge": "ttaa-resource-badge",
  "resource-copy": "ttaa-resource-copy",
  "resource-arrow": "ttaa-resource-arrow",
  "faq-list": "ttaa-faq-list",
  "faq-item": "ttaa-faq-item",
  "article-cta": "ttaa-cta",
};

export function normalizeTtaaArticleHtml(html: string) {
  return html.replace(/\bclass=(["'])(.*?)\1/g, (attribute, quote: string, value: string) => {
    const normalized = value
      .split(/\s+/)
      .filter(Boolean)
      .map((className) => LEGACY_TTAA_CLASS_MAP[className] || className)
      .join(" ");
    return normalized === value ? attribute : `class=${quote}${normalized}${quote}`;
  });
}
