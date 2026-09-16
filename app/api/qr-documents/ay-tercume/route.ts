import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { attachAyVerificationPdf, findAyVerificationDocument, publishAyVerificationDocument } from "../../../../lib/ay-verification-wordpress";
import { ayVerificationToken } from "../../../../lib/ay-verification-token";
import { isSameOriginPanelRequest } from "../../../../lib/qr-request-origin";
import { validatePrototypeDetails } from "../../../../lib/qr-prototype";
import { attachWordPressMedia, deleteWordPressMedia, uploadWordPressMedia } from "../../../../lib/wordpress";

export const runtime = "nodejs";
export const maxDuration = 120;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function authenticated() {
  try {
    await requireAdminSession();
    return true;
  } catch {
    return false;
  }
}

function documentToken(number: string) {
  const cleaned = number.trim();
  if (!cleaned || cleaned.length > 64 || /[\r\n\x00-\x1f]/.test(cleaned)) throw new Error("Belge numarasını en fazla 64 karakter olarak girin.");
  return ayVerificationToken(cleaned);
}

async function uploadPdf(file: File, token: string, number: string) {
  if (!/\.pdf$/i.test(file.name) || !file.size || file.size > 8 * 1024 * 1024 || (file.type && !["application/pdf", "application/octet-stream"].includes(file.type))) throw new Error("En fazla 8 MB boyutunda bir PDF yükleyin.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("Seçilen dosya geçerli bir PDF değil.");
  return uploadWordPressMedia({
    bytes,
    fileName: `ay-dogrulama-${token}.pdf`,
    contentType: "application/pdf",
    alt: `${number} numaralı belge`,
    title: `Doğrulanan belge ${number}`,
  }, "ay-tercume");
}

export async function GET(request: Request) {
  if (!await authenticated()) return json({ error: "Oturum açmanız gerekiyor." }, 401);
  try {
    const token = documentToken(new URL(request.url).searchParams.get("documentNumber") || "");
    const page = await findAyVerificationDocument(token);
    if (!page || page.status !== "publish") return json({ error: "Bu belge numarasıyla yayımlanmış doğrulama sayfası bulunamadı." }, 404);
    return json({ url: page.url, details: { documentNumber: page.document.documentNumber, customer: page.document.customer, documentDate: page.document.documentDate, documentType: page.document.documentType }, hasFile: page.hasFile });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Belge aranamadı." }, 400);
  }
}

export async function POST(request: Request) {
  if (!await authenticated()) return json({ error: "Oturum açmanız gerekiyor." }, 401);
  if (!isSameOriginPanelRequest(request)) return json({ error: "Geçersiz istek kaynağı." }, 403);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 10 * 1024 * 1024) return json({ error: "PDF en fazla 8 MB olabilir." }, 413);
  try {
    const data = await request.formData();
    const mode = data.get("mode") || "create";
    if (mode !== "create" && mode !== "attach") return json({ error: "Geçersiz belge işlemi." }, 400);
    if (data.get("confirmed") !== "true") return json({ error: "Belgenin doğrulandığını ve herkese açık bilgileri onaylayın." }, 400);
    const fileEntry = data.get("file");
    const file = fileEntry instanceof File && (fileEntry.name || fileEntry.size) ? fileEntry : null;

    if (mode === "attach") {
      const number = String(data.get("documentNumber") || "").trim();
      const token = documentToken(number);
      const previous = await findAyVerificationDocument(token);
      if (!previous || previous.status !== "publish") return json({ error: "Bu belge numarasıyla yayımlanmış doğrulama sayfası bulunamadı." }, 404);
      if (previous.hasFile) return json({ error: "Bu sayfada PDF zaten mevcut; dosya değiştirilmedi.", url: previous.url }, 409);
      if (!file) return json({ error: "Eklenecek PDF dosyasını seçin." }, 400);
      let media;
      try { media = await uploadPdf(file, token, previous.document.documentNumber); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "PDF yüklenemedi." }, 400); }
      let page;
      try { page = await attachAyVerificationPdf(token, media.url); }
      catch (error) {
        const current = await findAyVerificationDocument(token).catch(() => undefined);
        if (current === null || (current && current.document.fileUrl !== media.url)) await deleteWordPressMedia(media.id, "ay-tercume").catch(() => undefined);
        throw error;
      }
      const attachment = await attachWordPressMedia([media.id], page.id, "ay-tercume");
      return json({ pageId: page.id, url: page.url, mediaId: media.id, hasFile: true, details: page.document, warning: attachment.warning || null });
    }

    const details = validatePrototypeDetails({
      documentNumber: String(data.get("documentNumber") || ""),
      customer: String(data.get("customer") || ""),
      documentType: String(data.get("documentType") || ""),
      documentDate: String(data.get("documentDate") || ""),
      driveLink: "",
    });
    const token = documentToken(details.documentNumber);
    const previous = await findAyVerificationDocument(token);
    if (previous?.status === "publish") return json({ error: previous.hasFile ? "Bu belge numarası için sayfa ve PDF zaten var." : "Bu belge numarası için sayfa hazır. Aşağıdaki ‘Mevcut belgeye PDF ekle’ alanını kullanın.", url: previous.url, hasFile: previous.hasFile }, 409);
    let media;
    if (file) {
      try { media = await uploadPdf(file, token, details.documentNumber); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "PDF yüklenemedi." }, 400); }
    }
    let page;
    try {
      page = await publishAyVerificationDocument({
        documentNumber: details.documentNumber,
        customer: details.customer,
        documentDate: details.documentDate,
        documentType: details.documentType,
        fileUrl: media?.url,
      }, token);
    } catch (error) {
      if (media) {
        const current = await findAyVerificationDocument(token).catch(() => undefined);
        if (current === null || (current && current.status !== "publish")) await deleteWordPressMedia(media.id, "ay-tercume").catch(() => undefined);
      }
      throw error;
    }
    const attachment = media ? await attachWordPressMedia([media.id], page.id, "ay-tercume") : null;
    return json({ pageId: page.id, url: page.url, mediaId: media?.id || null, hasFile: Boolean(media), reused: page.reused, warning: attachment?.warning || null }, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Ay Tercüme doğrulama sayfası oluşturulamadı." }, 500);
  }
}
