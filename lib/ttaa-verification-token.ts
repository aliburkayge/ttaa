import { createHmac } from "node:crypto";

export function ttaaVerificationToken(documentNumber: string) {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Doğrulama bağlantısı için sunucu sırrı yapılandırılmamış.");
  const hex = createHmac("sha256", secret).update(`ttaa:${documentNumber.trim().toLocaleLowerCase("tr-TR")}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
