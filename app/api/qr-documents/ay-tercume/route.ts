import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { findAyVerificationDocument, publishAyVerificationDocument } from "../../../../lib/ay-verification-wordpress";
import { ayVerificationToken } from "../../../../lib/ay-verification-token";
import { validatePrototypeDetails } from "../../../../lib/qr-prototype";
import { attachWordPressMedia, deleteWordPressMedia, uploadWordPressMedia } from "../../../../lib/wordpress";

export const runtime = "nodejs";
export const maxDuration = 120;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    await requireAdminSession();
  } catch {
    return json({ error: "Oturum açmanız gerekiyor." }, 401);
  }
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Geçersiz istek kaynağı." }, 403);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 10 * 1024 * 1024) return json({ error: "PDF en fazla 8 MB olabilir." }, 413);
  try {
    const data = await request.formData();
    const details = validatePrototypeDetails({
      documentNumber: String(data.get("documentNumber") || ""),
      customer: String(data.get("customer") || ""),
      documentType: String(data.get("documentType") || ""),
      documentDate: String(data.get("documentDate") || ""),
      driveLink: "",
    });
    const token = ayVerificationToken(details.documentNumber);
    if (data.get("confirmed") !== "true") return json({ error: "Belgenin doğrulandığını ve dosyanın herkese açık gösterileceğini onaylayın." }, 400);
    const previous = await findAyVerificationDocument(token);
    if (previous?.status === "publish") return json({ error: "Bu belge numarası için doğrulama sayfası zaten var. Mevcut sayfayı açın.", url: previous.url }, 409);

    const file = data.get("file");
    if (!(file instanceof File) || !/\.pdf$/i.test(file.name) || !file.size || file.size > 8 * 1024 * 1024 || (file.type && !["application/pdf", "application/octet-stream"].includes(file.type))) {
      return json({ error: "En fazla 8 MB boyutunda bir PDF yükleyin." }, 400);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return json({ error: "Seçilen dosya geçerli bir PDF değil." }, 400);

    const media = await uploadWordPressMedia({
      bytes,
      fileName: `ay-dogrulama-${token}.pdf`,
      contentType: "application/pdf",
      alt: `${details.documentNumber} numaralı belge`,
      title: `Doğrulanan belge ${details.documentNumber}`,
    }, "ay-tercume");
    let page;
    try {
      page = await publishAyVerificationDocument({
        documentNumber: details.documentNumber,
        customer: details.customer,
        documentDate: details.documentDate,
        documentType: details.documentType,
        fileUrl: media.url,
      }, token);
    } catch (error) {
      const current = await findAyVerificationDocument(token).catch(() => undefined);
      if (current === null || (current && current.status !== "publish")) await deleteWordPressMedia(media.id, "ay-tercume").catch(() => undefined);
      throw error;
    }
    const attachment = await attachWordPressMedia([media.id], page.id, "ay-tercume");
    return json({ pageId: page.id, url: page.url, mediaId: media.id, reused: page.reused, warning: attachment.warning || null }, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Ay Tercüme doğrulama sayfası oluşturulamadı." }, 500);
  }
}
