import QRCode from "qrcode";

export type QrBrand = "ttaa" | "ay-tercume";
export type PrototypeDetails = {
  documentNumber: string;
  customer: string;
  documentType: string;
  documentDate: string;
  driveLink: string;
};

export function qrCompany(brand: QrBrand) {
  return brand === "ay-tercume" ? "AY TERCÜME" : "TTAA";
}

export function validatePrototypeDetails(details: PrototypeDetails): PrototypeDetails {
  const cleaned = Object.fromEntries(Object.entries(details).map(([key, value]) => [key, value.trim()])) as PrototypeDetails;
  if (!cleaned.documentNumber || cleaned.documentNumber.length > 64 || /[\r\n\x00-\x1f]/.test(cleaned.documentNumber)) throw new Error("Belge numarasını en fazla 64 karakter olarak girin.");
  if (!cleaned.customer || cleaned.customer.length > 120) throw new Error("Müşteri adını en fazla 120 karakter olarak girin.");
  if (!cleaned.documentType || cleaned.documentType.length > 80) throw new Error("Belge türünü girin.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned.documentDate) || !Number.isFinite(Date.parse(cleaned.documentDate)) || new Date(cleaned.documentDate).toISOString().slice(0, 10) !== cleaned.documentDate) throw new Error("Geçerli bir belge tarihi seçin.");
  if (cleaned.driveLink) {
    let url: URL;
    try { url = new URL(cleaned.driveLink); } catch { throw new Error("Geçerli bir Google Drive bağlantısı girin."); }
    if (cleaned.driveLink.length > 2000 || url.protocol !== "https:" || url.hostname !== "drive.google.com" || url.username || url.password) throw new Error("Drive bağlantısı https://drive.google.com/ ile başlamalıdır.");
  }
  return cleaned;
}

export function prototypeQrText(brand: QrBrand, documentNumber: string) {
  return `PROTOTIP - RESMI DOGRULAMA DEGILDIR\nFirma: ${qrCompany(brand)}\nBelge No: ${documentNumber}`;
}

export function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// The downloadable/printable asset is intentionally the QR itself; document fields stay in the panel.
async function createLabel(brand: QrBrand, details: Pick<PrototypeDetails, "documentNumber" | "documentDate">, qrText: string, live: boolean) {
  void brand; void details; void live;
  const qrSvg = await QRCode.toString(qrText, { type: "svg", errorCorrectionLevel: "M", margin: 4, width: 1200, color: { dark: "#000000", light: "#ffffff" } });
  const labelSvg = qrSvg;
  return { qrText, qrSvg, labelSvg, labelUrl: svgDataUrl(labelSvg) };
}

export async function createPrototypeLabel(brand: QrBrand, details: Pick<PrototypeDetails, "documentNumber" | "documentDate">) {
  return createLabel(brand, details, prototypeQrText(brand, details.documentNumber), false);
}

export async function createAyVerificationLabel(details: Pick<PrototypeDetails, "documentNumber" | "documentDate">, pageUrl: string) {
  const url = new URL(pageUrl);
  if (url.protocol !== "https:" || !["aytercume.com", "www.aytercume.com"].includes(url.hostname)) throw new Error("QR hedefi aytercume.com olmalıdır.");
  return createLabel("ay-tercume", details, url.toString(), true);
}

export async function createTtaaVerificationLabel(details: Pick<PrototypeDetails, "documentNumber" | "documentDate">, pageUrl: string) {
  const url = new URL(pageUrl);
  if (url.protocol !== "https:" || !["turkishtranslation.com.tr", "www.turkishtranslation.com.tr"].includes(url.hostname)) throw new Error("QR hedefi turkishtranslation.com.tr olmalıdır.");
  return createLabel("ttaa", details, url.toString(), true);
}
