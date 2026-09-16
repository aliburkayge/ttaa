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

function escapeXml(text: string) {
  return text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

export function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// Only public label fields cross this boundary. Customer and Drive data stay in the form.
export async function createPrototypeLabel(brand: QrBrand, details: Pick<PrototypeDetails, "documentNumber" | "documentDate">) {
  const qrText = prototypeQrText(brand, details.documentNumber);
  const qrSvg = await QRCode.toString(qrText, { type: "svg", errorCorrectionLevel: "M", margin: 4, width: 600, color: { dark: "#000000", light: "#ffffff" } });
  const numberLines = Array.from(details.documentNumber).reduce<string[]>((lines, character, index) => {
    const line = Math.floor(index / 19);
    lines[line] = (lines[line] || "") + character;
    return lines;
  }, []);
  const date = details.documentDate.split("-").reverse().join(".");
  const labelSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="70mm" height="45mm" viewBox="0 0 700 450">
  <rect x="1" y="1" width="698" height="448" rx="16" fill="white" stroke="#cbd5db" stroke-width="2"/>
  <g font-family="Arial, sans-serif" fill="#123746">
    <text x="30" y="53" font-size="30" font-weight="700">${escapeXml(qrCompany(brand))}</text>
    <text x="670" y="49" text-anchor="end" font-size="17" fill="#697b84">QR ETİKETİ · DENEME</text>
    <path d="M30 78H670" stroke="#dce5e8"/>
    <image x="20" y="95" width="280" height="280" href="${escapeXml(svgDataUrl(qrSvg))}"/>
    <text x="322" y="142" font-size="18" fill="#697b84">BELGE NO</text>
    ${numberLines.map((line, index) => `<text x="322" y="${178 + index * 29}" font-size="25" font-weight="700">${escapeXml(line)}</text>`).join("")}
    <text x="322" y="311" font-size="17" fill="#697b84">BELGE TARİHİ</text>
    <text x="322" y="340" font-size="22">${escapeXml(date)}</text>
    <path d="M30 382H670" stroke="#dce5e8"/>
    <text x="350" y="420" text-anchor="middle" font-size="19" font-weight="700">PROTOTİP · RESMÎ DOĞRULAMA DEĞİLDİR</text>
  </g></svg>`;
  return { qrText, qrSvg, labelSvg, labelUrl: svgDataUrl(labelSvg) };
}
