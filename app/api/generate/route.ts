import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../lib/auth";
import { canonicalLinkHost, dedupeLinks, type LinkBrief } from "../../../lib/link-catalog";
import { generateAndEditArticle, type GenerationBrief } from "../../../lib/openai";
import { researchBrief } from "../../../lib/research";

type GenerateRequest = LinkBrief & GenerationBrief;

function validateBrief(brief: GenerateRequest) {
  if (!brief?.topic?.trim()) throw new Error("Topic is required.");
  if (brief.topic.length > 240 || (brief.audience?.length || 0) > 500 || (brief.country?.length || 0) > 160 || (brief.documentType?.length || 0) > 500) {
    throw new Error("One or more brief fields are too long.");
  }
  if ((brief.primaryKeyword?.length || 0) > 240) throw new Error("Primary keyword is too long.");
  const desiredWords = Number(brief.desiredWordCount);
  if (brief.desiredWordCount && (!Number.isFinite(desiredWords) || desiredWords < 800 || desiredWords > 4_000)) {
    throw new Error("Desired word count must be between 800 and 4,000.");
  }
  if ((brief.sourceText?.length || 0) > 50_000) throw new Error("Source material must be under 50,000 characters.");
}

export async function POST(request: Request) {
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const brief = (await request.json()) as GenerateRequest;
    validateBrief(brief);
    const normalizedBrief: GenerateRequest = { audience: "", country: "", documentType: "", ...brief };

    const research = await researchBrief(normalizedBrief);
    const generated = await generateAndEditArticle(normalizedBrief, research.links);
    const selectedInternalAnchors = new Set(generated.article.internalLinkSuggestions.map((anchor) => anchor.toLowerCase()));
    const selectedInternalLinks = research.links.filter((link) => link.source === "internal" && selectedInternalAnchors.has(link.anchor.toLowerCase())).slice(0, 6);
    const officialLinks = research.links.filter((link) => link.source === "official");
    const curatedOfficialHosts = new Set(officialLinks.map((link) => canonicalLinkHost(link.url)));
    const discoveredHosts = new Set<string>();
    const uniqueDiscoveredSources = generated.discoveredSources.filter((link) => {
      const host = canonicalLinkHost(link.url);
      if (curatedOfficialHosts.has(host) || discoveredHosts.has(host)) return false;
      discoveredHosts.add(host);
      return true;
    });
    const links = dedupeLinks([...selectedInternalLinks, ...officialLinks, ...uniqueDiscoveredSources]).slice(0, 14);

    return NextResponse.json({
      article: generated.article,
      links,
      research: { mode: research.mode, researchedAt: research.researchedAt },
      generation: generated.trace,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
