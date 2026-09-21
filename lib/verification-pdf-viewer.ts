import { VERIFICATION_WIDGET_ORIGIN } from "./verification-landing-widget";
import type { VerificationPdfBrand } from "./verification-pdf-storage";

export function verificationPdfViewerUrl(brand: VerificationPdfBrand, token: string) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error("Geçersiz PDF görüntüleme kimliği.");
  const configured = process.env.PUBLIC_APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : VERIFICATION_WIDGET_ORIGIN);
  const origin = new URL(configured);
  if (origin.protocol !== "https:" && origin.hostname !== "localhost") throw new Error("PDF görüntüleyici HTTPS kullanmalıdır.");
  const url = new URL("/api/public-verification/viewer", origin);
  url.searchParams.set("brand", brand);
  url.searchParams.set("token", token);
  return url.toString();
}
