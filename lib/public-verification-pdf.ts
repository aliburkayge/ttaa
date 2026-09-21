import { findAyVerificationDocument } from "./ay-verification-wordpress";
import { findTtaaVerificationDocument } from "./ttaa-verification-wordpress";
import type { VerificationPdfBrand } from "./verification-pdf-storage";

export function parseVerificationPdfReference(url: URL) {
  const brand = url.searchParams.get("brand");
  const token = url.searchParams.get("token") || "";
  if ((brand !== "ttaa" && brand !== "ay-tercume") || !/^[a-f0-9-]{36}$/.test(token)) return null;
  return { brand: brand as VerificationPdfBrand, token };
}

export async function publicVerificationPdfDocument(brand: VerificationPdfBrand, token: string) {
  const record = brand === "ttaa" ? await findTtaaVerificationDocument(token) : await findAyVerificationDocument(token);
  if (!record || record.status !== "publish" || !record.hasFile) return null;
  return record.document;
}

export function verificationFrameAncestors(brand: VerificationPdfBrand, includeSelf = true) {
  const sites = brand === "ttaa"
    ? ["https://turkishtranslation.com.tr", "https://www.turkishtranslation.com.tr"]
    : ["https://aytercume.com", "https://www.aytercume.com"];
  return [includeSelf ? "'self'" : "", ...sites].filter(Boolean).join(" ");
}

export const privateDocumentHeaders = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
