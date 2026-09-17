export type VerificationBrand = "ttaa" | "ay-tercume";

const settings = {
  ttaa: { hosts: ["turkishtranslation.com.tr", "www.turkishtranslation.com.tr"], slug: "document-verification" },
  "ay-tercume": { hosts: ["aytercume.com", "www.aytercume.com"], slug: "belge-dogrulama" },
} as const;

const tokenPattern = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";

export function isVerificationBrand(value: string): value is VerificationBrand {
  return value === "ttaa" || value === "ay-tercume";
}

export function validDocumentNumber(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 64 && !/[\x00-\x1f\x7f]/.test(value);
}

export function verifiedPageUrl(brand: VerificationBrand, value: string): string | null {
  try {
    const url = new URL(value.trim());
    const target = settings[brand];
    if (url.protocol !== "https:" || !(target.hosts as readonly string[]).includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash) return null;
    if (!new RegExp(`^/${target.slug}-${tokenPattern}/?$`).test(url.pathname)) return null;
    return url.toString();
  } catch { return null; }
}

export function verificationTokenFromUrl(brand: VerificationBrand, value: string): string | null {
  const url = verifiedPageUrl(brand, value);
  if (!url) return null;
  return new RegExp(`^/${settings[brand].slug}-(${tokenPattern})/?$`).exec(new URL(url).pathname)?.[1] || null;
}
