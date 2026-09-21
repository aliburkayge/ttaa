import { createVerificationPdfAccess } from "../../../../lib/verification-pdf-access";
import { parseVerificationPdfReference, privateDocumentHeaders, publicVerificationPdfDocument, verificationFrameAncestors } from "../../../../lib/public-verification-pdf";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const reference = parseVerificationPdfReference(new URL(request.url));
  if (!reference) return new Response("Belge bulunamadı.", { status: 404, headers: privateDocumentHeaders });
  try {
    const document = await publicVerificationPdfDocument(reference.brand, reference.token);
    if (!document) return new Response("Belge bulunamadı.", { status: 404, headers: privateDocumentHeaders });
    const access = createVerificationPdfAccess(reference.brand, reference.token);
    const fileUrl = new URL("/api/public-verification/file", request.url);
    fileUrl.searchParams.set("brand", reference.brand);
    fileUrl.searchParams.set("token", reference.token);
    fileUrl.searchParams.set("expires", String(access.expires));
    fileUrl.searchParams.set("signature", access.signature);
    const language = reference.brand === "ttaa" ? "en" : "tr";
    const title = reference.brand === "ttaa" ? "Protected document preview" : "Güvenli belge önizlemesi";
    const html = `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive,nosnippet,noimageindex"><title>${title}</title><style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#eef3f6}iframe{display:block;width:100%;height:100%;border:0;background:#eef3f6}</style></head><body oncontextmenu="return false"><iframe src="${fileUrl.toString()}#toolbar=0&navpanes=0" title="${title}" referrerpolicy="no-referrer"></iframe></body></html>`;
    return new Response(html, { headers: {
      ...privateDocumentHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; frame-src 'self'; style-src 'unsafe-inline'; frame-ancestors ${verificationFrameAncestors(reference.brand)}; base-uri 'none'; form-action 'none'`,
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    } });
  } catch {
    return new Response("Belge görüntüleme geçici olarak kullanılamıyor.", { status: 503, headers: privateDocumentHeaders });
  }
}
