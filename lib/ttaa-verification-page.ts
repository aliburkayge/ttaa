import { verificationStyle } from "./ay-verification-page";
import { ayVerificationArticleStyle } from "./ay-verification-article";
import { verificationLandingWidget } from "./verification-landing-widget";
import { ttaaVerificationArticleHtml } from "./ttaa-verification-article";

const ttaaLayoutStyle = `<style>
body:has(main.ttaa-verification) .content_wrap:has(main.ttaa-verification) > .sidebar{display:none!important}
body:has(main.ttaa-verification) .content_wrap:has(main.ttaa-verification) > .content{float:none!important;width:100%!important}
</style>`;

export type TtaaVerificationDocument = {
  documentNumber: string;
  customer: string;
  documentDate: string;
  documentType: string;
  fileUrl?: string;
  mediaId?: number;
};

export const TTAA_VERIFICATION_LANDING_SLUG = "document-verification";
export const TTAA_VERIFICATION_DESIGN = "TTAA_VERIFICATION_DESIGN:2";

const siteHosts = ["turkishtranslation.com.tr", "www.turkishtranslation.com.tr"];

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function displayDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function contactSection() {
  return `<section class="ayv-contact" aria-labelledby="ttaa-contact-title"><div class="ayv-contact-intro"><span class="ayv-section-label">TTAA · CONTACT</span><h2 id="ttaa-contact-title">Questions about this document?</h2><p>Contact Turkish Translation & Attestation Agency using the details published on our official website.</p></div><div class="ayv-offices">
    <div class="ayv-office"><div class="ayv-office-head"><div><span>01 · ANKARA</span><h3>Ankara Office</h3></div></div><dl><dt>Address</dt><dd>Mustafa Kemal Mah. 2127 Cad. No: 22/1, Çankaya 06530, Ankara, Türkiye</dd><dt>Phone / WhatsApp</dt><dd><a href="tel:+905305196099">+90 530 519 60 99</a></dd></dl></div>
    <div class="ayv-office"><div class="ayv-office-head"><div><span>02 · ISTANBUL</span><h3>Istanbul Office</h3></div></div><dl><dt>Address</dt><dd>Mecidiyeköy Mah. Büyükdere Cad. No: 95/12, Şişli, Istanbul, Türkiye</dd><dt>Email</dt><dd><a href="mailto:info@turkishtranslation.com.tr">info@turkishtranslation.com.tr</a></dd></dl></div>
  </div><p class="ayv-note">Official contact page: <a href="https://turkishtranslation.com.tr/contacts/">turkishtranslation.com.tr/contacts/</a></p></section>`;
}

export function ttaaVerificationSeo(documentNumber?: string, hasFile = true) {
  if (!documentNumber) return {
    title: "Official Document Verification | TTAA",
    description: "Verify a TTAA translation or document record by QR code or document number. Compare details and any available PDF, with guidance on attestation and apostille files.",
  };
  return {
    title: `Document ${documentNumber.slice(0, 24)} Verification | TTAA`,
    description: hasFile
      ? `Check document ${documentNumber.slice(0, 30)} verified by TTAA and view its PDF.`
      : `Check document ${documentNumber.slice(0, 30)} verified by TTAA. The PDF has not been uploaded yet.`,
  };
}

export function ttaaVerificationLandingHtml() {
  return `${verificationStyle}${ayVerificationArticleStyle}${ttaaLayoutStyle}<main class="ayv ttaa-verification" lang="en"><header class="ayv-hero"><div class="ayv-hero-top"><div class="ayv-brand"><span>TTAA</span><strong>Document security</strong></div></div><div class="ayv-hero-body"><span class="ayv-kicker">OFFICIAL VERIFICATION AREA</span><h1>Document verification</h1><p class="ayv-lead">Verify a document prepared by Turkish Translation & Attestation Agency with its QR code or document number.</p></div></header>${verificationLandingWidget("ttaa")}${ttaaVerificationArticleHtml}${contactSection()}</main>`;
}

export function ttaaVerificationDocumentHtml(document: TtaaVerificationDocument, marker: string) {
  const url = document.fileUrl ? new URL(document.fileUrl) : null;
  if (url && (url.protocol !== "https:" || !siteHosts.includes(url.hostname))) throw new Error("The document PDF must be hosted on the TTAA website over HTTPS.");
  const number = escapeHtml(document.documentNumber);
  const fileUrl = url ? escapeHtml(url.toString()) : "";
  const fileSection = url
    ? `<section class="ayv-file" aria-labelledby="ttaa-file-title"><div class="ayv-file-head"><div><span class="ayv-section-label">03 · DOCUMENT FILE</span><h2 id="ttaa-file-title">Verified document</h2><p>Review the PDF below. If your browser cannot display it, open the file in a separate tab.</p></div><a class="ayv-open" href="${fileUrl}" target="_blank" rel="noopener noreferrer">Open PDF <span aria-hidden="true">↗</span></a></div><div class="ayv-pdf-frame"><div class="ayv-pdf-bar">Document preview <small>PDF</small></div><iframe class="ayv-pdf" src="${fileUrl}#toolbar=0" title="Verified document ${number}" loading="lazy" referrerpolicy="no-referrer"></iframe></div></section>`
    : `<section class="ayv-file ayv-pending" aria-labelledby="ttaa-file-title"><span class="ayv-pending-icon" aria-hidden="true"></span><span class="ayv-section-label">03 · FILE STATUS</span><h2 id="ttaa-file-title">The supporting PDF has not been uploaded yet.</h2><p>Please check again soon. When the file is added, it will appear at this same QR address.</p></section>`;
  const encoded = Buffer.from(JSON.stringify(document), "utf8").toString("base64url");
  return `${verificationStyle}${ttaaLayoutStyle}<main class="ayv ttaa-verification" lang="en"><header class="ayv-hero"><div class="ayv-hero-top"><span class="ayv-seal" aria-hidden="true"></span><div class="ayv-brand"><span>TTAA</span><strong>Document verification</strong></div><span class="ayv-verified">VERIFIED RECORD</span></div><div class="ayv-hero-body"><span class="ayv-kicker">DOCUMENT VERIFICATION</span><h1>This document was prepared and verified by Turkish Translation & Attestation Agency.</h1><p class="ayv-lead">${url ? "Review the document details and PDF below." : "The document details are shown below. The PDF will appear here once uploaded."}</p></div><div class="ayv-hero-foot"><span class="ayv-status">Verified document</span><span class="ayv-hero-foot-note">TTAA document record</span></div></header>
  <section class="ayv-details" aria-label="Document details"><div class="ayv-detail"><span class="ayv-detail-index" aria-hidden="true">01</span><div class="ayv-detail-body"><span>Document number</span><strong>${number}</strong></div></div><div class="ayv-detail"><span class="ayv-detail-index" aria-hidden="true">02</span><div class="ayv-detail-body"><span>Customer</span><strong>${escapeHtml(document.customer)}</strong></div></div><div class="ayv-detail"><span class="ayv-detail-index" aria-hidden="true">03</span><div class="ayv-detail-body"><span>Document date</span><strong>${escapeHtml(displayDate(document.documentDate))}</strong></div></div><div class="ayv-detail"><span class="ayv-detail-index" aria-hidden="true">04</span><div class="ayv-detail-body"><span>Document type</span><strong>${escapeHtml(document.documentType)}</strong></div></div></section>
  ${fileSection}${contactSection()}</main><!-- ${escapeHtml(marker)} --><!-- ${TTAA_VERIFICATION_DESIGN} --><!-- TTAA_VERIFICATION_DATA:${encoded} -->`;
}

export function readTtaaVerificationDocument(html: string, marker: string): TtaaVerificationDocument {
  if (!html.includes(`<!-- ${marker} -->`)) throw new Error("The verification page does not belong to this TTAA record.");
  const encoded = /<!-- TTAA_VERIFICATION_DATA:([A-Za-z0-9_-]+) -->/.exec(html)?.[1];
  if (!encoded) throw new Error("The verification page metadata is missing.");
  let value: TtaaVerificationDocument;
  try { value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as TtaaVerificationDocument; }
  catch { throw new Error("The verification page metadata could not be read."); }
  if (!value || typeof value.documentNumber !== "string" || typeof value.customer !== "string" || typeof value.documentDate !== "string" || typeof value.documentType !== "string" || (value.fileUrl !== undefined && typeof value.fileUrl !== "string") || (value.mediaId !== undefined && (!Number.isSafeInteger(value.mediaId) || value.mediaId <= 0))) throw new Error("The verification page metadata is invalid.");
  return value;
}
