import type { JobBrand } from "./jobs";
import type { ResearchedLink } from "./link-catalog";

type WordPressSearchItem = {
  title?: string;
  url?: string;
  subtype?: string;
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

export async function fetchBrandInternalLinks(brand: JobBrand, topic: string): Promise<VerifiedLink[]> {
  const base = brandBaseUrl(brand);
  const params = new URLSearchParams({
    search: topic.trim(),
    per_page: "30",
    type: "post",
    subtype: "post,page",
  });
  try {
    const response = await fetch(`${base}/wp-json/wp/v2/search?${params}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return [];
    const items = await response.json() as WordPressSearchItem[];
    const candidates = items
      .filter((item) => item.subtype === "post" || item.subtype === "page")
      .filter((item) => Boolean(item.title && item.url))
      .map((item) => ({
        anchor: decodeTitle(item.title || ""),
        url: item.url || "",
        reason: `Published ${brand === "ay-tercume" ? "AY Tercüme" : "TTAA"} ${item.subtype}`,
        source: "internal" as const,
      }));
    return validateInternalLinks(brand, candidates);
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
