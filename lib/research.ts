import { dedupeLinks, getCuratedLinks, type LinkBrief, type ResearchedLink } from "./link-catalog";
import { fetchBrandInternalLinks, validatePackageLinks } from "./internal-links";

export type ResearchResult = {
  mode: "live-wordpress-plus-curated-official";
  links: ResearchedLink[];
  researchedAt: string;
};

export async function researchBrief(brief: LinkBrief): Promise<ResearchResult> {
  const curated = getCuratedLinks(brief);
  const liveLinks = await fetchBrandInternalLinks("ttaa", brief);
  const links = await validatePackageLinks("ttaa", dedupeLinks([...liveLinks, ...curated]).slice(0, 18));

  return {
    mode: "live-wordpress-plus-curated-official",
    links,
    researchedAt: new Date().toISOString(),
  };
}
