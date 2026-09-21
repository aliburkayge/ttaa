import { createHmac, timingSafeEqual } from "node:crypto";
import type { VerificationPdfBrand } from "./verification-pdf-storage";

const MAX_LIFETIME_SECONDS = 5 * 60;

function secret() {
  const value = process.env.AUTH_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("PDF görüntüleme sırrı yapılandırılmamış.");
  return value;
}

function payload(brand: VerificationPdfBrand, token: string, expires: number) {
  return `${brand}:${token}:${expires}`;
}

export function createVerificationPdfAccess(brand: VerificationPdfBrand, token: string, now = Math.floor(Date.now() / 1000)) {
  const expires = now + MAX_LIFETIME_SECONDS;
  const signature = createHmac("sha256", secret()).update(payload(brand, token, expires)).digest("base64url");
  return { expires, signature };
}

export function verifyVerificationPdfAccess(brand: VerificationPdfBrand, token: string, expires: number, signature: string, now = Math.floor(Date.now() / 1000)) {
  if (!Number.isSafeInteger(expires) || expires < now || expires > now + MAX_LIFETIME_SECONDS || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret()).update(payload(brand, token, expires)).digest();
  const received = Buffer.from(signature, "base64url");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
