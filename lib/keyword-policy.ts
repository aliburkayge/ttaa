export type KeywordPolicyArticle = {
  title: string;
  intro: string;
  sections: Array<{ title: string }>;
  focusKeyword: string;
  secondaryKeywords: string[];
  seoTitle: string;
  metaDescription: string;
  slug: string;
};

export type KeywordPolicyBrief = {
  topic: string;
  primaryKeyword?: string;
};

function foldLatin(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizedWords(value: string) {
  return foldLatin(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function containsPhrase(value: string, phrase: string) {
  const haystack = ` ${normalizedWords(value)} `;
  const needle = normalizedWords(phrase);
  return Boolean(needle) && haystack.includes(` ${needle} `);
}

function slugWords(value: string) {
  return foldLatin(value).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").split("-").filter(Boolean);
}

export function auditKeywordPolicy(article: KeywordPolicyArticle, brief: KeywordPolicyBrief) {
  const focusKeyword = article.focusKeyword.trim();
  const focusWords = normalizedWords(focusKeyword).split(/\s+/).filter(Boolean);
  const normalizedFocus = normalizedWords(focusKeyword);
  const secondaryKeywords = article.secondaryKeywords.map((keyword) => keyword.trim()).filter(Boolean);
  const normalizedSecondary = secondaryKeywords.map(normalizedWords);
  const issues: string[] = [];

  if (!focusKeyword || focusWords.length > 7 || focusKeyword.length > 80) issues.push("Focus keyword must contain 1-7 words and no more than 80 characters.");
  if (brief.primaryKeyword?.trim() && focusKeyword !== brief.primaryKeyword.trim()) issues.push(`Focus keyword must exactly match the supplied Primary keyword: "${brief.primaryKeyword.trim()}".`);
  if (!brief.primaryKeyword?.trim() && /\b(?:ttaa|ay tercume|ay tercüme)\b/i.test(focusKeyword) && !/\b(?:ttaa|ay tercume|ay tercüme)\b/i.test(brief.topic)) issues.push("A brand name must not appear in an AI-selected focus keyword unless the title has branded search intent.");
  if (secondaryKeywords.length < 3 || secondaryKeywords.length > 5) issues.push("Generate 3-5 secondary keyword variations.");
  if (new Set(normalizedSecondary).size !== normalizedSecondary.length || normalizedSecondary.includes(normalizedFocus)) issues.push("Secondary keywords must be unique and different from the focus keyword.");

  const firstH2 = article.sections[0]?.title || "";
  if (!containsPhrase(article.title, focusKeyword) && !containsPhrase(firstH2, focusKeyword)) issues.push("Use the exact focus keyword in the H1 or first H2.");
  if (!containsPhrase(article.intro, focusKeyword)) issues.push("Use the exact focus keyword naturally in the first paragraph.");
  if (article.seoTitle.length < 50 || article.seoTitle.length > 60 || !containsPhrase(article.seoTitle, focusKeyword)) issues.push("SEO title must contain the exact focus keyword and total 50-60 characters.");
  const metaHasKeyword = [focusKeyword, ...secondaryKeywords].some((keyword) => containsPhrase(article.metaDescription, keyword));
  if (article.metaDescription.length < 120 || article.metaDescription.length > 160 || !metaHasKeyword) issues.push("Meta description must total 120-160 characters and contain the focus keyword or a declared secondary variation.");

  const slug = article.slug.replace(/^\/+|\/+$/g, "");
  const focusSlugTokens = slugWords(focusKeyword);
  const slugTokens = new Set(slugWords(slug));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 72 || !focusSlugTokens.every((token) => slugTokens.has(token))) issues.push("Slug must be short, lowercase, hyphenated and preserve every focus-keyword term.");
  const focusH2Count = article.sections.filter((section) => containsPhrase(section.title, focusKeyword)).length;
  if (focusH2Count > 3 || focusH2Count === article.sections.length) issues.push("Do not force the exact focus keyword into more than three H2 headings.");

  return { passes: issues.length === 0, issues, focusKeyword, secondaryKeywords };
}
