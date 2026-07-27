import { dedupeLinks, getCuratedLinks, type LinkBrief, type ResearchedLink } from "./link-catalog";

export type ResearchResult = {
  mode: "live-wordpress-plus-curated-official";
  links: ResearchedLink[];
  researchedAt: string;
};

function plainText(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "’")
    .replace(/&#038;/g, "&")
    .trim();
}

function sameTopic(url: string, topic: string) {
  const normalizedUrl = url.toLowerCase().replace(/^https?:\/\/[^/]+/, "").replace(/[^a-z0-9]+/g, "-");
  const normalizedTopic = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return normalizedUrl.includes(normalizedTopic);
}

export async function researchBrief(brief: LinkBrief): Promise<ResearchResult> {
  const curated = getCuratedLinks(brief);
  const wordpressUrl = process.env.WP_URL?.replace(/\/$/, "");
  const liveLinks: ResearchedLink[] = [];

  if (wordpressUrl) {
    const query = new URLSearchParams({
      search: `${brief.topic} ${brief.country}`.trim(),
      per_page: "8",
      type: "post",
    });
    const response = await fetch(`${wordpressUrl}/wp-json/wp/v2/search?${query}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const results = (await response.json()) as Array<{ title?: string; url?: string; subtype?: string }>;
      for (const result of results) {
        if (!result.url || !result.title || !result.url.startsWith(wordpressUrl) || sameTopic(result.url, brief.topic)) continue;
        liveLinks.push({
          anchor: plainText(result.title),
          url: result.url,
          reason: `Related TTAA ${result.subtype || "content"} page`,
          source: "internal",
        });
      }
    }
  }

  return {
    mode: "live-wordpress-plus-curated-official",
    links: dedupeLinks([...curated, ...liveLinks]).slice(0, 14),
    researchedAt: new Date().toISOString(),
  };
}
