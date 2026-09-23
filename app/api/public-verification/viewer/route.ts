import { parseVerificationPdfReference, privateDocumentHeaders, publicVerificationPdfDocument, verificationPdfResponseHeaders } from "../../../../lib/public-verification-pdf";
import { loadVerificationPdf } from "../../../../lib/verification-pdf-storage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const reference = parseVerificationPdfReference(new URL(request.url));
  if (!reference) return new Response("Belge bulunamadı.", { status: 404, headers: privateDocumentHeaders });
  try {
    const document = await publicVerificationPdfDocument(reference.brand, reference.token);
    if (!document) return new Response("Belge bulunamadı.", { status: 404, headers: privateDocumentHeaders });
    let bytes: Uint8Array;
    if (document.fileKey) bytes = await loadVerificationPdf(reference.brand, reference.token, document.fileKey);
    else if (document.fileUrl) {
      const response = await fetch(document.fileUrl, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("Eski PDF okunamadı.");
      bytes = new Uint8Array(await response.arrayBuffer());
    } else return new Response("Belge bulunamadı.", { status: 404, headers: privateDocumentHeaders });
    return new Response(new Blob([bytes.slice().buffer], { type: "application/pdf" }), {
      headers: verificationPdfResponseHeaders(reference.brand),
    });
  } catch {
    return new Response("Belge görüntüleme geçici olarak kullanılamıyor.", { status: 503, headers: privateDocumentHeaders });
  }
}
