import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../../../lib/auth";
import { ensureTtaaVerificationLanding } from "../../../../../../lib/ttaa-verification-wordpress";
import { isSameOriginPanelRequest } from "../../../../../../lib/qr-request-origin";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "Oturum açmanız gerekiyor." }, { status: 401 });
  }
  if (!isSameOriginPanelRequest(request)) return NextResponse.json({ error: "Geçersiz istek kaynağı." }, { status: 403 });
  try {
    return NextResponse.json(await ensureTtaaVerificationLanding(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Giriş sayfası oluşturulamadı." }, { status: 500 });
  }
}
