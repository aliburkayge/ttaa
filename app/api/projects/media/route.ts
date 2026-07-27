import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { getWordPressDraftMedia } from "../../../../lib/wordpress";

export async function GET(request: Request) {
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const slug = new URL(request.url).searchParams.get("slug")?.trim() || "";
    if (!/^[a-z0-9][a-z0-9-]{1,120}$/.test(slug)) return NextResponse.json({ error: "A valid draft slug is required." }, { status: 400 });
    const snapshot = await getWordPressDraftMedia(slug);
    if (!snapshot) return NextResponse.json({ error: "No completed image pair was found for this WordPress draft." }, { status: 404 });
    const makeAsset = (role: "featured" | "inline", image: typeof snapshot.featured) => ({
      role,
      wordpress: { id: image.id, url: image.url },
      supabase: null,
      fileName: image.url.split("/").pop() || `${slug}-${role}.webp`,
      prompt: "Recovered from the existing WordPress draft media.",
      alt: image.alt,
      width: image.width,
      height: image.height,
      format: image.url.toLowerCase().endsWith(".png") ? "png" : image.url.toLowerCase().match(/\.jpe?g$/) ? "jpeg" : "webp",
      model: "gpt-image-2",
      quality: "medium",
      origin: "recovered-wordpress-draft",
    });
    return NextResponse.json({ postId: snapshot.postId, html: snapshot.html, images: { featured: makeAsset("featured", snapshot.featured), inline: makeAsset("inline", snapshot.inline) } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Draft media lookup failed." }, { status: 502 });
  }
}
