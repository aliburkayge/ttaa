import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { generateBlogImages, type GeneratedImageBinary, type ImageSuggestionInput } from "../../../../lib/openai-images";
import { storeContentPackage, storeGeneratedImage } from "../../../../lib/supabase";
import { attachWordPressMedia, createWordPressDraft, deleteWordPressMedia, uploadWordPressMedia, type WordPressMedia } from "../../../../lib/wordpress";

type FinalImageAsset = {
  role: "featured" | "inline";
  wordpress: { id: number; url: string };
  supabase: { bucket: string; path: string } | null;
  fileName: string;
  prompt: string;
  revisedPrompt?: string;
  alt: string;
  width: number;
  height: number;
  format: string;
  model: string;
  quality: string;
  branding: { logoReferenceApplied: true; logoPlacement: "top-left"; headlineRequested: true; method: "gpt-image-2-edit" };
  origin: "new-generation";
};

type FinalizeRequest = {
  brief: Record<string, unknown>;
  package: {
    title: string;
    meta: string;
    slug: string;
    focusKeyword: string;
    secondaryKeywords: string[];
    html: string;
    schema: string;
    preview?: Record<string, unknown>;
    imagePrompt?: string;
    imageSuggestions?: ImageSuggestionInput[];
    links?: unknown[];
    generation?: Record<string, unknown>;
    research?: Record<string, unknown>;
    images?: { featured: FinalImageAsset; inline: FinalImageAsset };
  };
};

function validatePayload(body: FinalizeRequest) {
  if (!body?.package?.title || !body.package.html || !body.package.schema || !body.package.slug || !body.package.imagePrompt || !body.package.focusKeyword) {
    throw new Error("The final content and image package is incomplete.");
  }
  if (!Array.isArray(body.package.secondaryKeywords) || body.package.secondaryKeywords.length < 3 || body.package.secondaryKeywords.length > 5) {
    throw new Error("The content package must contain three to five secondary keywords.");
  }
  if (body.package.html.length > 1_500_000 || body.package.schema.length > 250_000 || body.package.imagePrompt.length > 8_000) {
    throw new Error("The content package is too large.");
  }
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function inlineFigure(media: WordPressMedia, image: GeneratedImageBinary) {
  return `<figure class="ttaa-inline-image"><img src="${escapeHtml(media.url)}" alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async"></figure>`;
}

function injectInlineImage(html: string, media: WordPressMedia, image: GeneratedImageBinary) {
  const figure = inlineFigure(media, image);
  if (html.includes("<!-- TTAA_INLINE_IMAGE -->")) return html.replace("<!-- TTAA_INLINE_IMAGE -->", figure);
  const resources = html.indexOf('<aside class="ttaa-resources"');
  return resources >= 0 ? `${html.slice(0, resources)}${figure}\n${html.slice(resources)}` : `${html}\n${figure}`;
}

function addFeaturedImageToSchema(schema: string, media: WordPressMedia, image: GeneratedImageBinary) {
  try {
    const parsed = JSON.parse(schema) as { "@graph"?: Array<Record<string, unknown>> };
    for (const item of parsed["@graph"] || []) {
      if (item["@type"] === "BlogPosting" || item["@type"] === "Article") {
        item.image = { "@type": "ImageObject", url: media.url, width: image.width, height: image.height };
      }
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return schema;
  }
}

async function uploadMediaPair(images: { featured: GeneratedImageBinary; inline: GeneratedImageBinary }, postTitle: string) {
  const generated = [images.featured, images.inline];
  const results = await Promise.allSettled(generated.map((image) => uploadWordPressMedia({
    bytes: image.bytes,
    fileName: image.fileName,
    contentType: image.contentType,
    alt: image.alt,
    title: `${postTitle} - ${image.role === "featured" ? "Featured Image" : "Article Image"}`,
  })));
  const uploaded = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failure = results.find((result) => result.status === "rejected");
  if (failure) {
    await Promise.allSettled(uploaded.map((media) => deleteWordPressMedia(media.id)));
    throw failure.reason instanceof Error ? failure.reason : new Error("WordPress media upload failed.");
  }
  return { featured: (results[0] as PromiseFulfilledResult<WordPressMedia>).value, inline: (results[1] as PromiseFulfilledResult<WordPressMedia>).value };
}

async function backUpImages(images: { featured: GeneratedImageBinary; inline: GeneratedImageBinary }, slug: string) {
  const generated = [images.featured, images.inline];
  const results = await Promise.allSettled(generated.map((image) => storeGeneratedImage({
    bytes: image.bytes,
    fileName: image.fileName,
    contentType: image.contentType,
    slug,
    role: image.role,
  })));
  return {
    featured: results[0].status === "fulfilled" ? results[0].value : null,
    inline: results[1].status === "fulfilled" ? results[1].value : null,
    warning: results.some((result) => result.status === "rejected") ? "One or more generated images could not be backed up to Supabase Storage." : undefined,
  };
}

function finalImageAsset(image: GeneratedImageBinary, media: WordPressMedia, backup: { bucket: string; path: string } | null): FinalImageAsset {
  return {
    role: image.role,
    wordpress: { id: media.id, url: media.url },
    supabase: backup,
    fileName: image.fileName,
    prompt: image.prompt,
    revisedPrompt: image.revisedPrompt,
    alt: image.alt,
    width: image.width,
    height: image.height,
    format: image.format,
    model: image.model,
    quality: image.quality,
    branding: image.branding,
    origin: "new-generation",
  };
}

export async function POST(request: Request) {
  let phase: "request" | "image-generation" | "wordpress-media" | "wordpress-draft" | "persistence" = "request";
  let admin;
  try {
    admin = await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as FinalizeRequest;
    validatePayload(body);
    const postTitle = typeof body.package.preview?.title === "string" ? body.package.preview.title : body.package.title;

    phase = "image-generation";
    const generatedImages = await generateBlogImages({
      title: postTitle,
      slug: body.package.slug,
      primaryPrompt: body.package.imagePrompt || "",
      suggestions: body.package.imageSuggestions,
    });
    const backupPromise = backUpImages(generatedImages, body.package.slug);
    phase = "wordpress-media";
    const media = await uploadMediaPair(generatedImages, postTitle);

    const finalHtml = injectInlineImage(body.package.html, media.inline, generatedImages.inline);
    const finalSchema = addFeaturedImageToSchema(body.package.schema, media.featured, generatedImages.featured);
    let wordpress;
    phase = "wordpress-draft";
    try {
      wordpress = await createWordPressDraft({
        postTitle,
        seoTitle: body.package.title,
        html: finalHtml,
        schema: finalSchema,
        metaDescription: body.package.meta,
        slug: body.package.slug,
        focusKeyword: body.package.focusKeyword,
        secondaryKeywords: body.package.secondaryKeywords,
        featuredMedia: media.featured.id,
      });
    } catch (error) {
      await Promise.allSettled([deleteWordPressMedia(media.featured.id), deleteWordPressMedia(media.inline.id)]);
      throw error;
    }

    const backups = await backupPromise;
    phase = "persistence";
    const images = {
      featured: finalImageAsset(generatedImages.featured, media.featured, backups.featured),
      inline: finalImageAsset(generatedImages.inline, media.inline, backups.inline),
    };
    const completedPackage = { ...body.package, html: finalHtml, schema: finalSchema, images };

    const mediaAttachment = await attachWordPressMedia([media.featured.id, media.inline.id], wordpress.id);
    let storage: { bucket: string; path: string } | null = null;
    let persistenceWarning: string | null = null;
    try {
      storage = await storeContentPackage(
        {
          title: body.package.title,
          slug: body.package.slug,
          status: "complete",
          brief: body.brief,
          contentPackage: completedPackage,
          wordpress: { ...wordpress, status: "draft" },
          createdBy: admin.email,
          createdAt: new Date().toISOString(),
        },
        body.package.slug,
      );
    } catch (error) {
      persistenceWarning = error instanceof Error ? error.message : "Supabase persistence failed.";
    }

    const warnings = [backups.warning, mediaAttachment.warning, persistenceWarning].filter(Boolean);
    return NextResponse.json(
      {
        success: true,
        package: completedPackage,
        wordpress,
        storage,
        images,
        persistence: warnings.length ? { saved: false, warning: warnings.join(" ") } : { saved: true },
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Finalization failed.";
    const retryable = phase === "image-generation" || phase === "wordpress-media";
    const phaseLabel = {
      request: "request validation",
      "image-generation": "OpenAI image generation",
      "wordpress-media": "WordPress media transfer",
      "wordpress-draft": "WordPress draft creation",
      persistence: "package persistence",
    }[phase];
    return NextResponse.json({ error: `${phaseLabel} stopped: ${message}`, phase, retryable }, { status: 502 });
  }
}
