import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../lib/auth";
import { ensureAyVerificationLanding } from "../../../../../lib/ay-verification-wordpress";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "Oturum açmanız gerekiyor." }, { status: 401 });
  }
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Geçersiz istek kaynağı." }, { status: 403 });
  try {
    return NextResponse.json(await ensureAyVerificationLanding(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Giriş sayfası oluşturulamadı." }, { status: 500 });
  }
}
