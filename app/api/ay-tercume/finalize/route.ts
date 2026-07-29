import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import type { AyContentPackage, AyGeneratedImageAsset } from "../../../../lib/ay-render";
import { attachWordPressMedia, createWordPressDraft, deleteWordPressMedia, uploadWordPressMedia, type WordPressMedia } from "../../../../lib/wordpress";
import { classifyJobError } from "../../../../lib/job-errors";
import { newRequestId } from "../../../../lib/observability";
import { withDeadline } from "../../../../lib/deadline";

export const runtime = "nodejs";
export const maxDuration = 840;

type FinalizeRequest = { brief?: Record<string, unknown>; package?: AyContentPackage };

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function decodeDataUrl(image: AyGeneratedImageAsset) {
  const match = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(image.dataUrl);
  if (!match) throw new Error(`${image.role} görsel verisi geçersiz.`);
  const binary = atob(match[2]);
  if (!binary.length || binary.length > 15_000_000) throw new Error(`${image.role} görsel boyutu izin verilen sınırda değil.`);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { bytes, contentType: match[1] };
}

async function uploadPair(images: { featured: AyGeneratedImageAsset; inline: AyGeneratedImageAsset }, postTitle: string) {
  const items = [images.featured, images.inline];
  const results = await Promise.allSettled(items.map((image) => {
    const decoded = decodeDataUrl(image);
    return uploadWordPressMedia({
      bytes: decoded.bytes,
      fileName: image.fileName,
      contentType: decoded.contentType,
      alt: image.alt,
      title: image.titleText || `${postTitle} - ${image.role === "featured" ? "Öne Çıkan Görsel" : "İçerik Görseli"}`,
      caption: image.caption,
      description: image.description,
    }, "ay-tercume");
  }));
  const uploaded = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) {
    await Promise.allSettled(uploaded.map((media) => deleteWordPressMedia(media.id, "ay-tercume")));
    throw failed.reason instanceof Error ? failed.reason : new Error("Ay Tercüme WordPress medya aktarımı başarısız oldu.");
  }
  return { featured: (results[0] as PromiseFulfilledResult<WordPressMedia>).value, inline: (results[1] as PromiseFulfilledResult<WordPressMedia>).value };
}

function inlineFigure(media: WordPressMedia, image: AyGeneratedImageAsset) {
  return `<figure class="ayc-inline-image"><img class="wp-image-${media.id}" src="${escapeHtml(media.url)}" alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async"><figcaption>${escapeHtml(image.caption)}</figcaption></figure>`;
}

function injectInlineImage(html: string, media: WordPressMedia, image: AyGeneratedImageAsset) {
  const figure = inlineFigure(media, image);
  if (html.includes("<!-- AY_INLINE_IMAGE -->")) return html.replace("<!-- AY_INLINE_IMAGE -->", figure);
  const resources = html.indexOf('<aside class="ayc-resources"');
  return resources >= 0 ? `${html.slice(0, resources)}${figure}\n${html.slice(resources)}` : `${html}\n${figure}`;
}

function addFeaturedImageToSchema(schema: string, media: WordPressMedia, image: AyGeneratedImageAsset) {
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

export async function POST(request: Request) {
  const requestId = newRequestId(request);
  let phase: "request" | "wordpress-media" | "wordpress-draft" | "media-attach" = "request";
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "Oturum süresi doldu." }, { status: 401 });
  }

  try {
    return await withDeadline(async () => {
    const body = (await request.json()) as FinalizeRequest;
    const contentPackage = body.package;
    if (!contentPackage?.html || !contentPackage.schema || !contentPackage.slug || !contentPackage.focusKeyword || !contentPackage.images) {
      throw new Error("WordPress taslağı için içerik veya görsel paketi eksik.");
    }
    if (contentPackage.html.length > 1_500_000 || contentPackage.schema.length > 250_000) throw new Error("İçerik paketi izin verilen boyutu aşıyor.");

    const postTitle = contentPackage.preview?.title || contentPackage.title;
    phase = "wordpress-media";
    const media = await uploadPair(contentPackage.images, postTitle);
    const finalHtml = injectInlineImage(contentPackage.html, media.inline, contentPackage.images.inline);
    const finalSchema = addFeaturedImageToSchema(contentPackage.schema, media.featured, contentPackage.images.featured);

    phase = "wordpress-draft";
    let wordpress;
    try {
      wordpress = await createWordPressDraft({
        postTitle,
        seoTitle: contentPackage.title,
        html: finalHtml,
        schema: finalSchema,
        metaDescription: contentPackage.meta,
        slug: contentPackage.slug,
        focusKeyword: contentPackage.focusKeyword,
        secondaryKeywords: contentPackage.secondaryKeywords,
        featuredMedia: media.featured.id,
      }, "ay-tercume");
    } catch (error) {
      await Promise.allSettled([deleteWordPressMedia(media.featured.id, "ay-tercume"), deleteWordPressMedia(media.inline.id, "ay-tercume")]);
      throw error;
    }

    phase = "media-attach";
    const attachment = await attachWordPressMedia([media.featured.id, media.inline.id], wordpress.id, "ay-tercume");
    const images = {
      featured: { ...contentPackage.images.featured, wordpress: { id: media.featured.id, url: media.featured.url } },
      inline: { ...contentPackage.images.inline, wordpress: { id: media.inline.id, url: media.inline.url } },
    };
    const completedPackage: AyContentPackage = {
      ...contentPackage,
      html: finalHtml,
      schema: finalSchema,
      canonical: wordpress.canonical,
      canonicalReady: true,
      images,
      wordpress: { id: wordpress.id, status: "draft", editUrl: wordpress.editUrl, canonical: wordpress.canonical, seo: wordpress.seo, design: wordpress.design },
    };
    const warnings = [attachment.warning, wordpress.seo.warning, wordpress.design.warning].filter(Boolean);
    return NextResponse.json({ success: true, package: completedPackage, wordpress: completedPackage.wordpress, warning: warnings.join(" ") || undefined }, { status: 201 });
    });
  } catch (error) {
    const retryable = ["wordpress-media"].includes(phase as string);
    const safe = classifyJobError(error, phase, requestId);
    return NextResponse.json({ error: safe.message, code: safe.code, phase, retryable: retryable && safe.retryable, requestId }, { status: safe.httpStatus });
  }
}
