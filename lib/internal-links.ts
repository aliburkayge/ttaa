import type { JobBrand } from "./jobs";
import type { ResearchedLink } from "./link-catalog";

type WordPressSearchItem = {
  id?: number;
  title?: string;
  url?: string;
  subtype?: string;
};

export type InternalLinkBrief = {
  topic: string;
  country?: string;
  documentType?: string;
};

export type VerifiedLink = ResearchedLink & {
  validation?: {
    status: "verified" | "redirected" | "rejected";
    checkedAt: string;
    finalUrl?: string;
    httpStatus?: number;
    reason?: string;
  };
};

function brandBaseUrl(brand: JobBrand) {
  const value = brand === "ay-tercume"
    ? process.env.AY_WP_URL || process.env.AY_SITE_URL || "https://aytercume.com"
    : process.env.WP_URL || "https://turkishtranslation.com.tr";
  return value.trim().replace(/\/+$/, "");
}

function decodeTitle(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replaceAll("&#8217;", "’")
    .replaceAll("&#038;", "&")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .trim();
}

function normalizedPath(url: URL) {
  return url.pathname.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function sameHost(left: URL, right: URL) {
  return left.hostname.replace(/^www\./, "").toLowerCase() === right.hostname.replace(/^www\./, "").toLowerCase();
}

const SEARCH_STOP_WORDS = new Set([
  "about", "after", "and", "before", "for", "from", "guide", "into", "need", "one", "service", "services", "the", "translation", "what", "which", "with", "you", "your",
  "bir", "bu", "hangi", "hakkinda", "icin", "ile", "nasil", "nedir", "rehberi", "sureci", "tercume", "ceviri", "hizmeti", "hizmetleri",
]);

function searchTokens(value: string) {
  return value.toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !SEARCH_STOP_WORDS.has(token));
}

export function wordpressSearchQueries(brief: InternalLinkBrief) {
  const topic = brief.topic.trim();
  const tokens = searchTokens(`${brief.topic} ${brief.country || ""} ${brief.documentType || ""}`);
  const values = [
    topic,
    brief.documentType?.trim() || "",
    brief.country?.trim() || "",
    ...tokens.slice(0, 6),
  ].filter(Boolean);
  return [...new Set(values.map((value) => value.toLocaleLowerCase("tr-TR")))].slice(0, 8);
}

function relevanceScore(item: WordPressSearchItem, brief: InternalLinkBrief, rank: number) {
  let path = item.url || "";
  try { path = new URL(path).pathname; } catch { /* Keep the supplied path. */ }
  const target = searchTokens(`${item.title || ""} ${path}`);
  const wanted = searchTokens(`${brief.topic} ${brief.country || ""} ${brief.documentType || ""}`);
  const targetSet = new Set(target);
  const overlap = wanted.reduce((score, token) => score + (targetSet.has(token) ? 6 : 0), 0);
  const topicPhrase = searchTokens(brief.topic).join(" ");
  const targetPhrase = target.join(" ");
  return overlap + (topicPhrase && targetPhrase.includes(topicPhrase) ? 18 : 0) + Math.max(0, 5 - rank);
}

export function selectInternalLinks(links: ResearchedLink[], suggestions: string[], minimum = 3, maximum = 6) {
  const internal = links.filter((link) => link.source === "internal" && !/^https:\/\/(?:api\.)?whatsapp\.com/i.test(link.url));
  const requested = new Set(suggestions.map((anchor) => anchor.toLocaleLowerCase("tr-TR")));
  const selected = internal.filter((link) => requested.has(link.anchor.toLocaleLowerCase("tr-TR")));
  const live = internal.filter((link) => /^Published |^Yayımlanmış /i.test(link.reason));
  const curated = internal.filter((link) => !live.includes(link));
  const candidates = [...live.slice(0, 2), ...curated, ...live.slice(2)];
  for (const link of candidates) {
    if (selected.length >= Math.max(minimum, Math.min(maximum, internal.length))) break;
    if (!selected.some((item) => item.url === link.url)) selected.push(link);
  }
  return selected.slice(0, maximum);
}

export function assertPackageLinkCoverage(brand: JobBrand, links: ResearchedLink[]) {
  const internalCount = links.filter((link) => link.source === "internal" && !/^https:\/\/(?:api\.)?whatsapp\.com/i.test(link.url)).length;
  const officialCount = links.filter((link) => link.source === "official").length;
  if (internalCount < 3 || officialCount < 1) {
    const label = brand === "ay-tercume" ? "AY Tercüme" : "TTAA";
    throw new Error(`${label} link denetimi başarısız: en az 3 doğrulanmış site içi bağlantı ve 1 resmî dış kaynak gerekir.`);
  }
}

export async function fetchBrandInternalLinks(brand: JobBrand, brief: InternalLinkBrief, currentSlug?: string): Promise<VerifiedLink[]> {
  const base = brandBaseUrl(brand);
  try {
    const queries = wordpressSearchQueries(brief);
    const responses = await Promise.all(queries.map(async (search) => {
      const params = new URLSearchParams({ search, per_page: "20", type: "post", subtype: "post,page" });
      const response = await fetch(`${base}/wp-json/wp/v2/search?${params}`, {
        headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return [] as WordPressSearchItem[];
      return response.json() as Promise<WordPressSearchItem[]>;
    }));
    const ranked = new Map<string, { item: WordPressSearchItem; score: number }>();
    responses.flatMap((items, queryIndex) => items.map((item, rank) => ({ item, rank: rank + queryIndex }))).forEach(({ item, rank }) => {
      if (!item.url) return;
      const score = relevanceScore(item, brief, rank);
      const previous = ranked.get(item.url);
      if (!previous || score > previous.score) ranked.set(item.url, { item, score });
    });
    const candidates = [...ranked.values()]
      .filter(({ score }) => score >= 6)
      .sort((left, right) => right.score - left.score)
      .map(({ item }) => item)
      .filter((item) => item.subtype === "post" || item.subtype === "page")
      .filter((item) => Boolean(item.title && item.url))
      .map((item) => ({
        anchor: decodeTitle(item.title || ""),
        url: item.url || "",
        reason: `Published ${brand === "ay-tercume" ? "AY Tercüme" : "TTAA"} ${item.subtype}`,
        source: "internal" as const,
      }))
      .slice(0, 12);
    return validateInternalLinks(brand, candidates, currentSlug);
  } catch {
    return [];
  }
}

export async function validateInternalLinks(
  brand: JobBrand,
  links: ResearchedLink[],
  currentSlug?: string,
): Promise<VerifiedLink[]> {
  const base = new URL(`${brandBaseUrl(brand)}/`);
  const currentPath = currentSlug
    ? `/${currentSlug.replace(/^\/+|\/+$/g, "")}`
    : "";
  const unique = new Map<string, ResearchedLink>();
  for (const link of links) {
    try {
      const url = new URL(link.url);
      if (link.source !== "internal" || !sameHost(url, base)) continue;
      const key = normalizedPath(url).toLocaleLowerCase("en-US");
      if (!unique.has(key)) unique.set(key, link);
    } catch {
      // Invalid URLs never enter the prompt or rendered package.
    }
  }

  const settled = await Promise.all([...unique.values()].map(async (link): Promise<VerifiedLink | null> => {
    const checkedAt = new Date().toISOString();
    try {
      const requested = new URL(link.url);
      const response = await fetch(requested, {
        method: "GET",
        headers: { Accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
      const finalUrl = new URL(response.url || requested);
      const requestedPath = normalizedPath(requested);
      const finalPath = normalizedPath(finalUrl);
      const isSelf = Boolean(currentPath) && finalPath.toLowerCase() === currentPath.toLowerCase();
      const unexpectedHome = requestedPath !== "/" && finalPath === "/";
      if (!response.ok || !sameHost(finalUrl, base) || unexpectedHome || isSelf) return null;
      return {
        ...link,
        url: finalUrl.toString(),
        validation: {
          status: requested.toString() === finalUrl.toString() ? "verified" : "redirected",
          checkedAt,
          finalUrl: finalUrl.toString(),
          httpStatus: response.status,
        },
      };
    } catch {
      return null;
    }
  }));
  return settled.filter((link): link is VerifiedLink => Boolean(link));
}

export async function validatePackageLinks(
  brand: JobBrand,
  links: ResearchedLink[],
  currentSlug?: string,
) {
  const internal = await validateInternalLinks(brand, links.filter((link) => link.source === "internal"), currentSlug);
  const allowedHosts = brand === "ay-tercume"
    ? ["aytercume.com"]
    : ["turkishtranslation.com.tr"];
  return [
    ...internal,
    ...links.filter((link) => link.source !== "internal").filter((link) => {
      try {
        const host = new URL(link.url).hostname.replace(/^www\./, "");
        return !allowedHosts.includes(host);
      } catch {
        return false;
      }
    }),
  ];
}
