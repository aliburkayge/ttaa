import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { ensureContentBucket, ensureImageBucket } from "../../../../lib/supabase";
import { verifyWordPressConnection } from "../../../../lib/wordpress";
import { verifyOpenAIConnection } from "../../../../lib/openai";
import { verifyOpenAIImageConnection } from "../../../../lib/openai-images";

export async function GET() {
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    const user = await verifyWordPressConnection();
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

  return NextResponse.json(result);
}
