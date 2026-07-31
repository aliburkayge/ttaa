import { buildAyContentPackage, type AyContentPackage } from "./ay-render";
import type { JobBrand } from "./jobs";
import type { GeneratedArticle } from "./openai";
import { getSupabaseAdmin } from "./supabase";
import { buildTtaaContentPackage, type TtaaContentPackage } from "./ttaa-render";
import { validatePackageLinks } from "./internal-links";
import { createWordPressDraft, getWordPressDraftStatus, type WordPressScope } from "./wordpress";

export type ContentPackage = TtaaContentPackage | AyContentPackage;

type EditableImage = {
  alt: string;
  width: number;
  height: number;
  caption?: string;
  wordpress?: { id: number; url: string };
};

export type ContentProject = {
  id: string;
  brand: JobBrand;
  title: string;
  slug: string;
  status: string;
  brief: Record<string, unknown>;
  content_package: ContentPackage;
  wordpress_post_id: number | null;
  wordpress_post_url: string | null;
  wordpress_status: "draft" | null;
  source_job_id: string | null;
  revision: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_synced_at: string | null;
};

const PROJECT_FIELDS = "id,brand,title,slug,status,brief,content_package,wordpress_post_id,wordpress_post_url,wordpress_status,source_job_id,revision,created_by,created_at,updated_at,last_synced_at";

function plainText(value: unknown, label: string, max = 20_000) {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const text = value.trim();
  if (!text || text.length > max) throw new Error(`${label} is empty or too long.`);
  if (/<\/?[a-z][\s\S]*>/i.test(text)) throw new Error(`${label} cannot contain HTML.`);
  return text;
}

function cleanList(value: unknown, label: string, min: number, max: number) {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  const result = value.map((item, index) => plainText(item, `${label} ${index + 1}`, 2_000));
  if (result.length < min || result.length > max) throw new Error(`${label} must contain ${min}-${max} items.`);
  return [...new Set(result)];
}

export function validateEditableArticle(value: unknown): GeneratedArticle {
  if (!value || typeof value !== "object") throw new Error("Structured article is required.");
  const input = value as GeneratedArticle;
  const title = plainText(input.title, "H1", 180);
  const intro = plainText(input.intro, "Introduction", 5_000);
  const tldr = cleanList(input.tldr, "TL;DR", 2, 8);
  if (!Array.isArray(input.sections) || input.sections.length < 1 || input.sections.length > 14) {
    throw new Error("The article must contain 1-14 sections.");
  }
  const sections = input.sections.map((section, index) => ({
    title: plainText(section?.title, `Section ${index + 1} title`, 180),
    body: plainText(section?.body, `Section ${index + 1} body`, 20_000),
    items: Array.isArray(section?.items)
      ? section.items.map((item, itemIndex) => plainText(item, `Section ${index + 1} item ${itemIndex + 1}`, 2_000))
      : [],
  }));
  if (!Array.isArray(input.faqs) || input.faqs.length > 20) throw new Error("FAQ list is invalid.");
  const faqs = input.faqs.map((faq, index) => ({
    question: plainText(faq?.question, `FAQ ${index + 1} question`, 300),
    answer: plainText(faq?.answer, `FAQ ${index + 1} answer`, 3_000),
  }));
  const seoTitle = plainText(input.seoTitle, "SEO title", 80);
  const metaDescription = plainText(input.metaDescription, "Meta description", 200);
  if (seoTitle.length < 45 || seoTitle.length > 65) throw new Error("SEO title must be 45-65 characters.");
  if (metaDescription.length < 120 || metaDescription.length > 160) throw new Error("Meta description must be 120-160 characters.");
  const focusKeyword = plainText(input.focusKeyword, "Focus keyword", 80);
  const secondaryKeywords = cleanList(input.secondaryKeywords, "Secondary keywords", 1, 5)
    .filter((item) => item.toLocaleLowerCase("en-US") !== focusKeyword.toLocaleLowerCase("en-US"));
  if (!secondaryKeywords.length) throw new Error("At least one distinct secondary keyword is required.");
  const slug = plainText(input.slug, "Slug", 180)
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  if (!slug) throw new Error("Slug is invalid.");
  return {
    ...input,
    eyebrow: plainText(input.eyebrow, "Eyebrow", 120),
    title,
    intro,
    tldr,
    sections,
    faqs,
    cta: {
      title: plainText(input.cta?.title, "CTA title", 180),
      body: plainText(input.cta?.body, "CTA body", 2_000),
      buttonLabel: plainText(input.cta?.buttonLabel, "CTA button", 100),
    },
    seoTitle,
    metaDescription,
    focusKeyword,
    secondaryKeywords,
    slug,
    imagePrompt: plainText(input.imagePrompt, "Image prompt", 5_000),
    imageSuggestions: Array.isArray(input.imageSuggestions) ? input.imageSuggestions : [],
    internalLinkSuggestions: Array.isArray(input.internalLinkSuggestions) ? input.internalLinkSuggestions : [],
  };
}

export async function upsertProjectFromCompletedJob(input: {
  jobId: string;
  brand: JobBrand;
  ownerEmail: string;
  brief: Record<string, unknown>;
  contentPackage: ContentPackage;
}) {
  const wordpress = input.contentPackage.wordpress as { id?: number; editUrl?: string } | undefined;
  const now = new Date().toISOString();
  const payload = {
    brand: input.brand,
    source_job_id: input.jobId,
    title: input.contentPackage.preview.title,
    slug: input.contentPackage.slug,
    status: "complete",
    brief: input.brief,
    content_package: input.contentPackage,
    wordpress_post_id: wordpress?.id || null,
    wordpress_post_url: wordpress?.editUrl || null,
    wordpress_status: wordpress ? "draft" : null,
    created_by: input.ownerEmail,
    updated_at: now,
  };
  const { data, error } = await getSupabaseAdmin()
    .from("content_projects")
    .upsert(payload, { onConflict: "source_job_id" })
    .select(PROJECT_FIELDS)
    .single();
  if (error) throw new Error(`Project persistence failed: ${error.message}`);
  return data as ContentProject;
}

export async function listProjects(ownerEmail: string, brand: JobBrand) {
  const { data, error } = await getSupabaseAdmin()
    .from("content_projects")
    .select(PROJECT_FIELDS)
    .eq("created_by", ownerEmail)
    .eq("brand", brand)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Project list failed: ${error.message}`);
  return (data || []) as ContentProject[];
}

export async function getProject(id: string, ownerEmail: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("content_projects")
    .select(PROJECT_FIELDS)
    .eq("id", id)
    .eq("created_by", ownerEmail)
    .maybeSingle();
  if (error) throw new Error(`Project lookup failed: ${error.message}`);
  return data as ContentProject | null;
}

function rebuildPackage(project: ContentProject, article: GeneratedArticle, links: ContentPackage["links"]) {
  const previous = project.content_package;
  const options = {
    includeH1: true,
    visibleBreadcrumb: true,
    articleSchema: true,
    faqSchema: true,
  };
  const rebuilt = project.brand === "ay-tercume"
    ? buildAyContentPackage(article, links, options, previous.generation as AyContentPackage["generation"], previous.research)
    : buildTtaaContentPackage(article, links, options, previous.generation as TtaaContentPackage["generation"], previous.research);
  const merged = {
    ...rebuilt,
    images: previous.images,
    wordpress: previous.wordpress,
  } as ContentPackage;
  const imageRecord = previous.images as { featured?: EditableImage; inline?: EditableImage } | undefined;
  const inline = imageRecord?.inline;
  const inlineUrl = inline?.wordpress?.url;
  const inlineId = inline?.wordpress?.id;
  if (inline && inlineUrl && inlineId) {
    const figureClass = project.brand === "ay-tercume" ? "ayc-inline-image" : "ttaa-inline-image";
    const marker = project.brand === "ay-tercume" ? "<!-- AY_INLINE_IMAGE -->" : "<!-- TTAA_INLINE_IMAGE -->";
    const caption = project.brand === "ay-tercume" && "caption" in inline && inline.caption
      ? `<figcaption>${escapeHtml(String(inline.caption))}</figcaption>`
      : "";
    const figure = `<figure class="${figureClass}"><img class="wp-image-${inlineId}" src="${escapeHtml(inlineUrl)}" alt="${escapeHtml(inline.alt)}" width="${inline.width}" height="${inline.height}" loading="lazy" decoding="async">${caption}</figure>`;
    merged.html = merged.html.includes(marker) ? merged.html.replace(marker, figure) : `${merged.html}\n${figure}`;
  }
  return merged;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export async function updateProject(input: {
  id: string;
  ownerEmail: string;
  expectedRevision: number;
  article: unknown;
}) {
  const project = await getProject(input.id, input.ownerEmail);
  if (!project) return null;
  if (project.revision !== input.expectedRevision) {
    const error = new Error("REVISION_CONFLICT");
    (error as Error & { current?: ContentProject }).current = project;
    throw error;
  }
  const article = validateEditableArticle(input.article);
  const links = await validatePackageLinks(project.brand, project.content_package.links, article.slug);
  const contentPackage = rebuildPackage(project, article, links);
  const now = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("content_projects")
    .update({
      title: article.title,
      slug: contentPackage.slug,
      content_package: contentPackage,
      revision: project.revision + 1,
      updated_at: now,
    })
    .eq("id", project.id)
    .eq("created_by", input.ownerEmail)
    .eq("revision", project.revision)
    .select(PROJECT_FIELDS)
    .maybeSingle();
  if (error) throw new Error(`Project update failed: ${error.message}`);
  if (!data) throw new Error("REVISION_CONFLICT");
  return data as ContentProject;
}

export async function syncProjectToWordPress(id: string, ownerEmail: string) {
  const project = await getProject(id, ownerEmail);
  if (!project) return null;
  if (!project.wordpress_post_id || !project.source_job_id) throw new Error("This project has no managed WordPress draft.");
  const scope = project.brand as WordPressScope;
  const status = await getWordPressDraftStatus(project.wordpress_post_id, scope);
  if (status !== "draft") throw new Error("WORDPRESS_NOT_DRAFT");
  const links = await validatePackageLinks(project.brand, project.content_package.links, project.content_package.slug);
  const contentPackage = rebuildPackage(project, project.content_package.preview, links);
  const wordpress = await createWordPressDraft({
    postTitle: contentPackage.preview.title,
    seoTitle: contentPackage.title,
    html: contentPackage.html,
    schema: contentPackage.schema,
    metaDescription: contentPackage.meta,
    slug: contentPackage.slug,
    focusKeyword: contentPackage.focusKeyword,
    secondaryKeywords: contentPackage.secondaryKeywords,
    featuredMedia: (contentPackage.images as { featured?: EditableImage } | undefined)?.featured?.wordpress?.id,
    jobId: project.source_job_id,
  }, scope);
  if (wordpress.id !== project.wordpress_post_id) throw new Error("WordPress reconciliation returned a different draft.");
  const now = new Date().toISOString();
  const merged = { ...contentPackage, wordpress } as ContentPackage;
  const { data, error } = await getSupabaseAdmin()
    .from("content_projects")
    .update({
      content_package: merged,
      wordpress_post_url: wordpress.editUrl,
      wordpress_status: "draft",
      last_synced_at: now,
      updated_at: now,
    })
    .eq("id", project.id)
    .eq("created_by", ownerEmail)
    .select(PROJECT_FIELDS)
    .single();
  if (error) throw new Error(`Project sync checkpoint failed: ${error.message}`);
  return data as ContentProject;
}
