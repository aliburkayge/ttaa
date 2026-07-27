import { createClient } from "@supabase/supabase-js";

export const CONTENT_BUCKET = "ttaa-content-packages";
export const IMAGE_BUCKET = "ttaa-blog-images";

export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Supabase server credentials are not configured.");
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "ttaa-content-studio" } },
  });
}

export async function ensureContentBucket() {
  const supabase = getSupabaseAdmin();
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw new Error(listError.message);
  const exists = buckets.some((bucket) => bucket.id === CONTENT_BUCKET || bucket.name === CONTENT_BUCKET);
  if (!exists) {
    const { error: createError } = await supabase.storage.createBucket(CONTENT_BUCKET, {
      public: false,
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: ["application/json"],
    });
    if (createError) throw new Error(createError.message);
  }
  return { bucket: CONTENT_BUCKET, created: !exists };
}

export async function ensureImageBucket() {
  const supabase = getSupabaseAdmin();
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw new Error(listError.message);
  const exists = buckets.some((bucket) => bucket.id === IMAGE_BUCKET || bucket.name === IMAGE_BUCKET);
  if (!exists) {
    const { error: createError } = await supabase.storage.createBucket(IMAGE_BUCKET, {
      public: false,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ["image/webp", "image/jpeg", "image/png"],
    });
    if (createError) throw new Error(createError.message);
  }
  return { bucket: IMAGE_BUCKET, created: !exists };
}

export async function storeGeneratedImage(input: { bytes: Uint8Array; fileName: string; contentType: string; slug: string; role: string }) {
  const supabase = getSupabaseAdmin();
  await ensureImageBucket();
  const date = new Date();
  const safeSlug = input.slug.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9-]/gi, "-") || "article";
  const safeFile = input.fileName.replace(/[^a-z0-9._-]/gi, "-");
  const path = `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${safeSlug}/${crypto.randomUUID()}-${input.role}-${safeFile}`;
  const file = new Blob([input.bytes.slice().buffer], { type: input.contentType });
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: input.contentType, upsert: false });
  if (error) throw new Error(error.message);
  return { bucket: IMAGE_BUCKET, path };
}

export async function storeContentPackage(payload: Record<string, unknown>, slug: string) {
  const supabase = getSupabaseAdmin();
  await ensureContentBucket();
  const date = new Date();
  const safeSlug = slug.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9-]/gi, "-") || "article";
  const path = `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.toISOString().replaceAll(":", "-")}-${safeSlug}-${crypto.randomUUID()}.json`;
  const file = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const { error } = await supabase.storage.from(CONTENT_BUCKET).upload(path, file, { contentType: "application/json", upsert: false });
  if (error) throw new Error(error.message);
  return { bucket: CONTENT_BUCKET, path };
}
