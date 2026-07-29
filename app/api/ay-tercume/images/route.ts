import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { generateAyBlogImages, type AyGeneratedImageBinary, type AyImageSuggestionInput } from "../../../../lib/ay-openai-images";

type ImageRequest = {
  title?: string;
  slug?: string;
  primaryPrompt?: string;
  suggestions?: AyImageSuggestionInput[];
};

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function serializeImage(image: AyGeneratedImageBinary) {
  return {
    role: image.role,
    dataUrl: `data:${image.contentType};base64,${toBase64(image.bytes)}`,
    fileName: image.fileName,
    contentType: image.contentType,
    alt: image.alt,
    titleText: image.titleText,
    caption: image.caption,
    description: image.description,
    prompt: image.prompt,
    revisedPrompt: image.revisedPrompt,
    width: image.width,
    height: image.height,
    format: image.format,
    model: image.model,
    quality: image.quality,
    branding: image.branding,
  };
}

export async function POST(request: Request) {
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "Oturum süresi doldu." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ImageRequest;
    const title = body.title?.trim();
    const slug = body.slug?.trim();
    if (!title || !slug) return NextResponse.json({ error: "Görsel üretimi için başlık ve slug gereklidir." }, { status: 400 });
    if (title.length > 240 || slug.length > 180 || (body.primaryPrompt?.length || 0) > 8_000) {
      return NextResponse.json({ error: "Görsel brief alanlarından biri izin verilenden uzun." }, { status: 400 });
    }
    const images = await generateAyBlogImages({
      title,
      slug,
      primaryPrompt: body.primaryPrompt?.trim() || title,
      suggestions: body.suggestions?.slice(0, 2),
      assetOrigin: new URL(request.url).origin,
    });
    return NextResponse.json({ images: { featured: serializeImage(images.featured), inline: serializeImage(images.inline) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ay Tercüme görselleri üretilemedi.";
    return NextResponse.json({ error: `OpenAI görsel üretimi durdu: ${message}` }, { status: 502 });
  }
}
