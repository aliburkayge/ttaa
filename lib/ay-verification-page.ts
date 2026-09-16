export type AyVerificationDocument = {
  documentNumber: string;
  customer: string;
  documentDate: string;
  documentType: string;
  fileUrl?: string;
};

export const AY_VERIFICATION_LANDING_SLUG = "belge-dogrulama";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function displayDate(value: string) {
  return value.split("-").reverse().join(".");
}

const style = `<style>
.ayv,.ayv *{box-sizing:border-box}.ayv{--mint:#43cc9b;--blue:#009fe4;--ink:#0f0b08;--text:#40544d;--muted:#71857e;--border:#d8ebe4;max-width:1060px;margin:0 auto 64px;color:var(--text);font-family:inherit;line-height:1.6}.ayv a{color:#007eaf;text-underline-offset:3px}.ayv-hero{position:relative;overflow:hidden;padding:clamp(26px,5vw,60px);border:1px solid var(--border);border-radius:24px;background:linear-gradient(135deg,#fff 28%,#e9faf4)}.ayv-hero:after{position:absolute;right:-74px;bottom:-120px;width:270px;height:270px;border:42px solid rgba(67,204,155,.15);border-radius:50%;content:"";pointer-events:none}.ayv-kicker{position:relative;z-index:1;display:block;margin-bottom:14px;color:#007eaf;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.ayv-check{position:relative;z-index:1;display:grid;place-items:center;width:58px;height:58px;margin-bottom:24px;border-radius:17px;background:#07946a;color:#fff;font-size:34px;font-weight:800;box-shadow:0 12px 26px #08795729}.ayv h1,.ayv h2,.ayv h3{color:var(--ink);text-transform:none;letter-spacing:-.035em}.ayv h1{position:relative;z-index:1;max-width:780px;margin:0;font-size:clamp(30px,4.3vw,52px);font-weight:800;line-height:1.12}.ayv-lead{position:relative;z-index:1;max-width:690px;margin:20px 0 0;font-size:16px;line-height:1.75}.ayv-status{position:relative;z-index:1;display:inline-flex;align-items:center;gap:8px;margin-top:24px;padding:7px 12px;border:1px solid #b7e6d0;border-radius:999px;background:#fff;color:#087957;font-size:12px;font-weight:750}.ayv-status:before{width:7px;height:7px;border-radius:50%;background:#0caa77;content:""}.ayv-details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:20px 0 0}.ayv-detail,.ayv-file,.ayv-office,.ayv-note{border:1px solid var(--border);border-radius:16px;background:#fff}.ayv-detail{padding:19px 21px}.ayv-detail span{display:block;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.ayv-detail strong{display:block;margin-top:8px;color:var(--ink);font-size:18px;overflow-wrap:anywhere}.ayv-file{margin-top:20px;padding:24px}.ayv-file.ayv-pending{border-color:#f0dba7;background:#fffaf0}.ayv-pending h2{color:#8b5b13}.ayv-section-label{display:block;color:#007eaf;font-size:10px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}.ayv-file h2,.ayv-contact h2{margin:7px 0 8px;font-size:clamp(23px,3vw,31px)}.ayv-file p,.ayv-contact>p{margin:0;color:var(--muted);font-size:13px}.ayv-pdf{width:100%;min-height:610px;margin-top:20px;border:1px solid var(--border);border-radius:10px;background:#f7faf9}.ayv-open{display:inline-flex;align-items:center;justify-content:center;min-height:42px;margin-top:14px;padding:10px 16px;border-radius:8px;background:#0f0b08;color:#fff!important;font-size:13px;font-weight:700;text-decoration:none}.ayv-contact{margin-top:34px}.ayv-offices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:18px}.ayv-office{padding:24px}.ayv-office h3{margin:0 0 15px;font-size:19px}.ayv-office dl{margin:0}.ayv-office dt{margin-top:14px;color:var(--muted);font-size:10px;font-weight:750;letter-spacing:.09em;text-transform:uppercase}.ayv-office dd{margin:4px 0 0;font-size:13px;line-height:1.65}.ayv-note{margin-top:18px;padding:17px 20px;background:#f8fbfa;color:var(--muted);font-size:12px}.ayv-note p{margin:0}@media(max-width:700px){.ayv-offices{grid-template-columns:1fr}.ayv-pdf{min-height:480px}.ayv-file,.ayv-office{padding:19px}}@media(max-width:480px){.ayv-details{grid-template-columns:1fr}.ayv-pdf{min-height:380px}.ayv-check{width:51px;height:51px;font-size:30px}}
</style>`;

function contactSection() {
  return `<section class="ayv-contact" aria-labelledby="ayv-contact-title"><span class="ayv-section-label">AY TERCÜME · İLETİŞİM</span><h2 id="ayv-contact-title">Bir sorunuz mu var?</h2><p>Ankara ve İstanbul ofislerimizle günün her saati iletişime geçebilirsiniz.</p><div class="ayv-offices">
    <div class="ayv-office"><h3>Ankara Şubesi</h3><dl><dt>Adres</dt><dd>Mustafa Kemal Mah., 2127. Cad. No: 22/1 Kat 1, 06530 Çankaya/Ankara, Türkiye</dd><dt>Telefon / WhatsApp</dt><dd><a href="tel:+905431850655">+90 543 185 06 55</a></dd><dt>İletişim</dt><dd>24 saat açık</dd></dl></div>
    <div class="ayv-office"><h3>İstanbul Şubesi</h3><dl><dt>Adres</dt><dd>Gülbahar Mah., Büyükdere Cad. No: 95/12, 34394 Şişli/İstanbul, Türkiye</dd><dt>Telefon / WhatsApp</dt><dd><a href="tel:+905447619687">+90 544 761 96 87</a></dd><dt>İletişim</dt><dd>24 saat açık</dd></dl></div>
  </div><p class="ayv-note">Resmî iletişim sayfamız: <a href="https://aytercume.com/iletisim/">aytercume.com/iletisim/</a></p></section>`;
}

export function ayVerificationSeo(documentNumber?: string, hasFile = true) {
  if (!documentNumber) return {
    title: "Belge Doğrulama | AY Tercüme",
    description: "AY Tercüme QR belge doğrulama alanı. Belge bilgilerini ve dosyayı görüntüleyin; Ankara ve İstanbul ofislerimize ulaşın.",
  };
  return {
    title: `Belge ${documentNumber.slice(0, 28)} Doğrulama | AY Tercüme`,
    description: hasFile
      ? `AY Tercüme tarafından doğrulanan ${documentNumber.slice(0, 30)} numaralı belgeyi ve dosyayı görüntüleyin. Ankara ve İstanbul ofislerimize ulaşın.`
      : `AY Tercüme tarafından doğrulanan ${documentNumber.slice(0, 30)} numaralı belgenin bilgilerini görüntüleyin. Evraklar henüz yüklenmemiştir.`,
  };
}

export function ayVerificationLandingHtml() {
  return `${style}<main class="ayv"><header class="ayv-hero"><span class="ayv-kicker">AY TERCÜME · BELGE GÜVENLİĞİ</span><h1>Belge doğrulama</h1><p class="ayv-lead">AY Tercüme tarafından hazırlanan QR kodlu belgelerde kodu okutarak belgeye özel doğrulama sayfasını açabilirsiniz. Sayfada belge numarası, müşteri adı, tarih ve dosya gösterilir.</p></header>${contactSection()}</main>`;
}

export function ayVerificationDocumentHtml(document: AyVerificationDocument, marker: string) {
  const url = document.fileUrl ? new URL(document.fileUrl) : null;
  if (url && (url.protocol !== "https:" || !["aytercume.com", "www.aytercume.com"].includes(url.hostname))) throw new Error("Belge bağlantısı aytercume.com üzerinde HTTPS olmalıdır.");
  const number = escapeHtml(document.documentNumber);
  const kind = escapeHtml(document.documentType);
  const fileUrl = url ? escapeHtml(url.toString()) : "";
  const fileSection = url
    ? `<section class="ayv-file" aria-labelledby="ayv-file-title"><span class="ayv-section-label">BELGE GÖRÜNTÜSÜ</span><h2 id="ayv-file-title">Doğrulanan dosya</h2><p>Dosya aşağıda doğrudan görüntülenir. Tarayıcınız PDF göstermiyorsa dosyayı ayrı sekmede açabilirsiniz.</p><iframe class="ayv-pdf" src="${fileUrl}#toolbar=0" title="${number} numaralı doğrulanmış belge" loading="lazy" referrerpolicy="no-referrer"></iframe><a class="ayv-open" href="${fileUrl}" target="_blank" rel="noopener noreferrer">Dosyayı aç ↗</a></section>`
    : `<section class="ayv-file ayv-pending" aria-labelledby="ayv-file-title"><span class="ayv-section-label">EVRAK DURUMU</span><h2 id="ayv-file-title">Gerekli evraklar şu anda yüklenmemiştir.</h2><p>En yakın zamanda tekrar kontrol edin. Bu sayfa güncellendiğinde aynı QR kodu üzerinden dosyayı görüntüleyebilirsiniz.</p></section>`;
  const encoded = Buffer.from(JSON.stringify(document), "utf8").toString("base64url");
  return `${style}<main class="ayv"><header class="ayv-hero"><span class="ayv-kicker">AY TERCÜME · BELGE DOĞRULAMA</span><span class="ayv-check" aria-hidden="true">✓</span><h1>Bu dosya AY Tercüme tarafından oluşturulup doğrulanmıştır.</h1><p class="ayv-lead">${url ? "Aşağıdaki belge bilgilerini ve dosyanın kendisini inceleyebilirsiniz." : "Belge bilgileri aşağıdadır. Dosya hazır olduğunda bu sayfada görüntülenecektir."}</p><span class="ayv-status">Doğrulanmış belge</span></header>
  <section class="ayv-details" aria-label="Belge bilgileri"><div class="ayv-detail"><span>Belge numarası</span><strong>${number}</strong></div><div class="ayv-detail"><span>Müşteri</span><strong>${escapeHtml(document.customer)}</strong></div><div class="ayv-detail"><span>Belge tarihi</span><strong>${escapeHtml(displayDate(document.documentDate))}</strong></div><div class="ayv-detail"><span>Belge türü</span><strong>${kind}</strong></div></section>
  ${fileSection}${contactSection()}</main><!-- ${escapeHtml(marker)} --><!-- AY_VERIFICATION_DATA:${encoded} -->`;
}

export function readAyVerificationDocument(html: string, marker: string): AyVerificationDocument {
  if (!html.includes(`<!-- ${marker} -->`)) throw new Error("Doğrulama sayfası işareti uyuşmuyor.");
  const encoded = /<!-- AY_VERIFICATION_DATA:([A-Za-z0-9_-]+) -->/.exec(html)?.[1];
  if (!encoded) throw new Error("Bu eski doğrulama kaydının bilgileri otomatik güncelleme için uygun değil.");
  let value: AyVerificationDocument;
  try { value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AyVerificationDocument; }
  catch { throw new Error("Doğrulama sayfası belge bilgileri okunamadı."); }
  if (!value || typeof value.documentNumber !== "string" || typeof value.customer !== "string" || typeof value.documentDate !== "string" || typeof value.documentType !== "string" || (value.fileUrl !== undefined && typeof value.fileUrl !== "string")) throw new Error("Doğrulama sayfası belge bilgileri geçersiz.");
  return value;
}
