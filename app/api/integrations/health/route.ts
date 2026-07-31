import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { ensureContentBucket, ensureImageBucket } from "../../../../lib/supabase";
import { verifyWordPressConnection, type WordPressScope } from "../../../../lib/wordpress";
import { verifyOpenAIConnection } from "../../../../lib/openai";
import { verifyOpenAIImageConnection } from "../../../../lib/openai-images";

function scopeFrom(request: Request): WordPressScope {
  return new URL(request.url).searchParams.get("brand") === "ay-tercume" ? "ay-tercume" : "ttaa";
}

export async function GET(request: Request) {
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scope = scopeFrom(request);
  const result: Record<string, unknown> = {
    wordpress: { connected: false },
    supabase: { connected: false, storageReady: false },
    openai: { connected: false },
  };

  try {
    const [text, image] = await Promise.all([verifyOpenAIConnection(), verifyOpenAIImageConnection()]);
    result.openai = { ...text, image };
  } catch (error) {
    result.openai = { connected: false, error: error instanceof Error ? error.message : "Connection failed." };
  }

  try {
    const user = await verifyWordPressConnection(scope);
    result.wordpress = { connected: true, user };
  } catch (error) {
    result.wordpress = { connected: false, error: error instanceof Error ? error.message : "Connection failed." };
  }

  try {
    const [bucket, imageBucket] = await Promise.all([ensureContentBucket(), ensureImageBucket()]);
    result.supabase = { connected: true, storageReady: true, bucket: bucket.bucket, imageBucket: imageBucket.bucket };
  } catch (error) {
    result.supabase = { connected: false, storageReady: false, error: error instanceof Error ? error.message : "Connection failed." };
  }

  if (scope === "ay-tercume") {
    const phone = (process.env.AY_WHATSAPP_PHONE || "").trim();
    result.whatsapp = phone
      ? { connected: true, phone }
      : { connected: false, error: "AY_WHATSAPP_PHONE is not configured." };
  }

  return NextResponse.json(result);
}
