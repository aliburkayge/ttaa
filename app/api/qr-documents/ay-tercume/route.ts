import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/auth";
import { attachAyVerificationPdf, findAyVerificationDocument, findAyVerificationMediaId, listAyVerificationDocuments, publishAyVerificationDocument, setAyVerificationPdf } from "../../../../lib/ay-verification-wordpress";
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
    const params = new URL(request.url).searchParams;
    if (params.get("list") === "1") {
      const query = (params.get("q") || "").trim().slice(0, 120);
      const page = Math.max(1, Math.min(1000, Number(params.get("page") || "1") || 1));
      return json(await listAyVerificationDocuments(query, page));
    }
    const token = documentToken(params.get("documentNumber") || "");
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
    if (mode !== "create" && mode !== "attach" && mode !== "replace" && mode !== "remove") return json({ error: "Geçersiz belge işlemi." }, 400);
    if (data.get("confirmed") !== "true") return json({ error: "Belgenin doğrulandığını ve herkese açık bilgileri onaylayın." }, 400);
    const fileEntry = data.get("file");
    const file = fileEntry instanceof File && (fileEntry.name || fileEntry.size) ? fileEntry : null;

    if (mode !== "create") {
      const number = String(data.get("documentNumber") || "").trim();
      const token = documentToken(number);
      const previous = await findAyVerificationDocument(token);
      if (!previous || previous.status !== "publish") return json({ error: "Bu belge numarasıyla yayımlanmış doğrulama sayfası bulunamadı." }, 404);
      if (mode === "attach" && previous.hasFile) return json({ error: "Bu sayfada PDF zaten mevcut; dosya değiştirilmedi.", url: previous.url }, 409);
      if (mode !== "attach" && !previous.hasFile) return json({ error: "Bu sayfada kaldırılacak PDF yok." }, 409);
      if (mode === "remove") {
        const page = await setAyVerificationPdf(token);
        const oldId = previous.document.fileUrl ? await findAyVerificationMediaId(previous.document.fileUrl, previous.id, previous.document.mediaId).catch(() => undefined) : undefined;
        let warning: string | null = null;
        if (oldId) {
          try { await deleteWordPressMedia(oldId, "ay-tercume"); }
          catch { warning = "PDF sayfadan kaldırıldı ancak WordPress ortam dosyası silinemedi. Ortam kitaplığını kontrol edin."; }
        } else warning = "PDF sayfadan kaldırıldı ancak eski ortam dosyası otomatik bulunamadı. Ortam kitaplığını kontrol edin.";
        return json({ pageId: page.id, url: page.url, hasFile: false, details: page.document, warning });
      }
      if (!file) return json({ error: "PDF dosyasını seçin." }, 400);
      let media;
      try { media = await uploadPdf(file, token, previous.document.documentNumber); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "PDF yüklenemedi." }, 400); }
      let page;
      try { page = mode === "attach" ? await attachAyVerificationPdf(token, media.url, media.id) : await setAyVerificationPdf(token, { url: media.url, mediaId: media.id }); }
      catch (error) {
        const current = await findAyVerificationDocument(token).catch(() => undefined);
        if (current === null || (current && current.document.fileUrl !== media.url)) await deleteWordPressMedia(media.id, "ay-tercume").catch(() => undefined);
        throw error;
      }
      const attachment = await attachWordPressMedia([media.id], page.id, "ay-tercume");
      let warning = attachment.warning || null;
      if (mode === "replace" && previous.document.fileUrl) {
        const oldId = await findAyVerificationMediaId(previous.document.fileUrl, previous.id, previous.document.mediaId).catch(() => undefined);
        if (oldId && oldId !== media.id) {
          try { await deleteWordPressMedia(oldId, "ay-tercume"); }
          catch { warning = "Yeni PDF yayımlandı ancak eski WordPress ortam dosyası silinemedi. Ortam kitaplığını kontrol edin."; }
        } else if (!oldId) warning = "Yeni PDF yayımlandı ancak eski ortam dosyası otomatik bulunamadı. Ortam kitaplığını kontrol edin.";
      }
      return json({ pageId: page.id, url: page.url, mediaId: media.id, hasFile: true, details: page.document, warning });
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
        mediaId: media?.id,
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
