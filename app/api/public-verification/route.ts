import { NextResponse } from "next/server";
import { ayVerificationToken } from "../../../lib/ay-verification-token";
import { findAyVerificationDocument } from "../../../lib/ay-verification-wordpress";
import { isVerificationBrand, validDocumentNumber, verificationTokenFromUrl, verifiedPageUrl } from "../../../lib/public-verification";
import { ttaaVerificationToken } from "../../../lib/ttaa-verification-token";
import { findTtaaVerificationDocument } from "../../../lib/ttaa-verification-wordpress";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 1024) return NextResponse.json({ error: "Invalid request." }, { status: 413, headers });
  let input: unknown;
  try { input = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request." }, { status: 400, headers }); }
  if (!input || typeof input !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400, headers });
  const { brand, documentNumber, qrUrl } = input as Record<string, unknown>;
  if (typeof brand !== "string" || !isVerificationBrand(brand)) return NextResponse.json({ error: "Invalid brand." }, { status: 400, headers });
  const fromQr = typeof qrUrl === "string";
  if (fromQr ? !verificationTokenFromUrl(brand, qrUrl) : !validDocumentNumber(documentNumber)) return NextResponse.json({ error: "Invalid document reference." }, { status: 400, headers });
  try {
    const token = fromQr ? verificationTokenFromUrl(brand, qrUrl as string)! : brand === "ttaa" ? ttaaVerificationToken((documentNumber as string).trim()) : ayVerificationToken((documentNumber as string).trim());
    const page = brand === "ttaa"
      ? await findTtaaVerificationDocument(token)
      : await findAyVerificationDocument(token);
    const url = page?.status === "publish" ? verifiedPageUrl(brand, page.url) : null;
    if (!page || !url || (fromQr ? url !== qrUrl : page.document.documentNumber.toLocaleLowerCase("tr-TR") !== (documentNumber as string).trim().toLocaleLowerCase("tr-TR"))) return NextResponse.json({ found: false }, { status: 404, headers });
    return NextResponse.json({ found: true, url, documentNumber: page.document.documentNumber, hasFile: page.hasFile }, { headers });
  } catch {
    return NextResponse.json({ error: "Verification is temporarily unavailable." }, { status: 503, headers });
  }
}
