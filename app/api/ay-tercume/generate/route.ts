import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { dedupeAyLinks, getAyCuratedLinks, type AyLinkBrief } from "../../../../lib/ay-link-catalog";
import { generateAyArticle, type AyGenerationBrief } from "../../../../lib/ay-openai";
import { buildAyContentPackage, type AyRenderOptions } from "../../../../lib/ay-render";
import { canonicalLinkHost, type ResearchedLink } from "../../../../lib/link-catalog";
import { classifyJobError } from "../../../../lib/job-errors";
import { newRequestId } from "../../../../lib/observability";
import { withDeadline } from "../../../../lib/deadline";

export const runtime = "nodejs";
export const maxDuration = 840;

type GenerateRequest = AyLinkBrief & AyGenerationBrief & AyRenderOptions;

function validateBrief(brief: GenerateRequest) {
  if (!brief?.topic?.trim()) throw new Error("Yazı başlığı gereklidir.");
  if (brief.topic.length > 240 || (brief.audience?.length || 0) > 500 || (brief.country?.length || 0) > 160 || (brief.documentType?.length || 0) > 500) throw new Error("Bir veya daha fazla brief alanı izin verilenden uzun.");
  if ((brief.primaryKeyword?.length || 0) > 240) throw new Error("Focus keyword çok uzun.");
  const desiredWords = Number(brief.desiredWordCount);
  if (brief.desiredWordCount && (!Number.isFinite(desiredWords) || desiredWords < 800 || desiredWords > 4_000)) throw new Error("Kelime hedefi 800 ile 4.000 arasında olmalıdır.");
  if ((brief.sourceText?.length || 0) > 50_000) throw new Error("Kaynak metin 50.000 karakterden kısa olmalıdır.");
}

function plainText(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#8217;/g, "’").replace(/&#038;/g, "&").trim();
}

async function liveAyLinks(brief: GenerateRequest): Promise<ResearchedLink[]> {
  const base = process.env.AY_WP_URL?.trim().replace(/\/$/, "");
  if (!base) return [];
  try {
    const query = new URLSearchParams({ search: `${brief.topic} ${brief.country}`.trim(), per_page: "8", type: "post" });
    const response = await fetch(`${base}/wp-json/wp/v2/search?${query}`, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return [];
    const results = (await response.json()) as Array<{ title?: string; url?: string; subtype?: string }>;
    return results.filter((item) => item.url?.startsWith(base) && item.title).map((item) => ({ anchor: plainText(item.title || ""), url: item.url || "", reason: `İlgili AY Tercüme ${item.subtype || "içerik"} sayfası`, source: "internal" as const }));
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  const requestId = newRequestId(request);
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "Oturum süresi doldu." }, { status: 401 });
  }

  try {
    return await withDeadline(async () => {
    const brief = (await request.json()) as GenerateRequest;
    validateBrief(brief);
    const normalized: GenerateRequest = {
      ...brief,
      audience: brief.audience ?? "",
      country: brief.country ?? "",
      documentType: brief.documentType ?? "",
      mode: brief.mode ?? "new",
      length: brief.length ?? "guide",
      includeH1: brief.includeH1 ?? true,
      visibleBreadcrumb: brief.visibleBreadcrumb ?? true,
      articleSchema: brief.articleSchema ?? true,
      faqSchema: brief.faqSchema ?? true,
    };
    const live = await liveAyLinks(normalized);
    const researchedAt = new Date().toISOString();
    const approved = dedupeAyLinks([...getAyCuratedLinks(normalized), ...live]).slice(0, 14);
    const generated = await generateAyArticle(normalized, approved);
    const selectedAnchors = new Set(generated.article.internalLinkSuggestions.map((anchor) => anchor.toLocaleLowerCase("tr-TR")));
    const selectedInternal = approved.filter((link) => link.source === "internal" && selectedAnchors.has(link.anchor.toLocaleLowerCase("tr-TR"))).slice(0, 6);
    const official = approved.filter((link) => link.source === "official");
    const knownHosts = new Set(official.map((link) => canonicalLinkHost(link.url)));
    const discoveredHosts = new Set<string>();
    const discovered = generated.discoveredSources.filter((link) => {
      const host = canonicalLinkHost(link.url);
      if (knownHosts.has(host) || discoveredHosts.has(host)) return false;
      discoveredHosts.add(host);
      return true;
    });
    const links = dedupeAyLinks([...selectedInternal, ...official, ...discovered]).slice(0, 14);
    const research = { mode: process.env.AY_WP_URL ? "live-ay-wordpress-plus-official-web-search" : "curated-ay-links-plus-official-web-search", researchedAt };
    const contentPackage = buildAyContentPackage(generated.article, links, normalized, generated.trace, research);
    return NextResponse.json({ package: contentPackage });
    });
  } catch (error) {
    const safe = classifyJobError(error, "legacy-ay-content-generation", requestId);
    return NextResponse.json({ error: safe.message, code: safe.code, retryable: safe.retryable, requestId }, { status: safe.httpStatus });
  }
}
