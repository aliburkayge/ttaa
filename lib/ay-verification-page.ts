export type AyVerificationDocument = {
  documentNumber: string;
  customer: string;
  documentDate: string;
  documentType: string;
  fileUrl?: string;
  mediaId?: number;
};

export const AY_VERIFICATION_LANDING_SLUG = "belge-dogrulama";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function displayDate(value: string) {
  return value.split("-").reverse().join(".");
}

export const verificationStyle = `<style>
.ayv,.ayv *{box-sizing:border-box}
.ayv{--blue:#0878d2;--blue-dark:#065ba8;--navy:#102c49;--text:#3b5268;--muted:#6b8194;--border:#d9e7f2;width:min(100%,1100px);margin:0 auto 72px;padding:0 12px;color:var(--text);font-family:inherit;line-height:1.65}
.ayv a{color:var(--blue-dark);text-underline-offset:3px}
.ayv h1,.ayv h2,.ayv h3{margin-top:0;color:var(--navy);text-transform:none;letter-spacing:-.035em}
.ayv-hero{position:relative;overflow:hidden;padding:clamp(26px,5vw,58px);border:1px solid #cde2f3;border-radius:25px;background:radial-gradient(circle at 92% 8%,#ddecff 0,transparent 32%),linear-gradient(133deg,#fff 34%,#f1f8ff);box-shadow:0 20px 55px #164e8010}
.ayv-hero:before{position:absolute;top:0;left:0;right:0;height:5px;background:linear-gradient(90deg,#0878d2,#47b1ec,#b5e5ff);content:""}
.ayv-hero:after{position:absolute;right:-62px;bottom:-165px;width:315px;height:315px;border:32px solid #d7ecfd66;border-radius:50%;content:"";pointer-events:none}
.ayv-hero-top,.ayv-hero-foot{position:relative;z-index:1;display:flex;align-items:center;gap:17px}
.ayv-hero-top{flex-wrap:wrap}
.ayv-seal{position:relative;display:inline-grid;flex:none;place-items:center;width:76px;height:76px;border:6px solid #fff;border-radius:23px;background:linear-gradient(145deg,#0aa4ee,#0769c7 75%);box-shadow:0 0 0 1px #cbe6fb,0 12px 27px #0878d23b}
.ayv-seal:before{position:absolute;width:25px;height:13px;border-left:5px solid #fff;border-bottom:5px solid #fff;border-radius:1px;content:"";transform:translate(1px,-3px) rotate(-45deg)}
.ayv-brand{display:grid;gap:2px}.ayv-brand span{color:var(--blue-dark);font-size:10px;font-weight:850;letter-spacing:.16em}.ayv-brand strong{color:var(--navy);font-size:18px;line-height:1.2}
.ayv-verified{display:inline-flex;align-items:center;gap:7px;margin-left:auto;padding:8px 12px;border:1px solid #bbdaf2;border-radius:999px;background:#fff;color:var(--blue-dark);font-size:10px;font-weight:800;letter-spacing:.035em;white-space:nowrap}
.ayv-verified:before{width:7px;height:7px;border-radius:50%;background:var(--blue);box-shadow:0 0 0 3px #e1f3ff;content:""}
.ayv-hero-body{position:relative;z-index:1;margin-top:31px}
.ayv-kicker,.ayv-section-label{display:block;color:var(--blue-dark);font-size:10px;font-weight:850;letter-spacing:.16em;text-transform:uppercase}
.ayv h1{max-width:810px;margin:13px 0 0;font-size:clamp(29px,4.5vw,49px);font-weight:800;line-height:1.13}
.ayv-lead{max-width:700px;margin:16px 0 0;color:#47657e;font-size:15px;line-height:1.8}
.ayv-hero-foot{flex-wrap:wrap;margin-top:25px;padding-top:19px;border-top:1px solid #d6e7f5}
.ayv-status{display:inline-flex;align-items:center;gap:9px;padding:8px 12px;border:1px solid #bedff7;border-radius:8px;background:#fff;color:var(--blue-dark);font-size:11px;font-weight:800}
.ayv-status:before{display:block;width:7px;height:7px;border-radius:50%;background:var(--blue);content:""}
.ayv-hero-foot-note{color:var(--muted);font-size:11px}
.ayv-details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:20px 0 0}
.ayv-detail,.ayv-file,.ayv-office,.ayv-note{border:1px solid var(--border);border-radius:16px;background:#fff;box-shadow:0 7px 25px #164e8009}
.ayv-detail{position:relative;display:flex;align-items:flex-start;gap:15px;min-height:111px;padding:22px 23px;overflow:hidden}
.ayv-detail:after{position:absolute;top:0;right:0;width:72px;height:72px;border-top:1px solid #e6f2fa;border-right:1px solid #e6f2fa;border-radius:0 16px 0 100%;content:"";pointer-events:none}
.ayv-detail-index{display:grid!important;flex:none;place-items:center;width:34px;height:34px;border:1px solid #d7eafa;border-radius:10px;background:#f0f8ff;color:var(--blue-dark)!important;font-size:10px!important;font-weight:850!important;letter-spacing:0!important}
.ayv-detail-body{min-width:0}.ayv-detail-body>span{display:block;color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.10em;text-transform:uppercase}.ayv-detail strong{display:block;margin-top:6px;color:var(--navy);font-size:17px;font-weight:750;line-height:1.35;overflow-wrap:anywhere}
.ayv-file{margin-top:20px;padding:clamp(22px,3vw,32px)}
.ayv-file-head{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:18px}.ayv-file-head>div{max-width:690px}
.ayv-file h2,.ayv-contact h2{margin:6px 0 7px;font-size:clamp(24px,3vw,31px);line-height:1.2}
.ayv-file p,.ayv-contact-intro>p{margin:0;color:var(--muted);font-size:13px;line-height:1.7}
.ayv-open{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:43px;padding:10px 16px;border-radius:9px;background:var(--navy);color:#fff!important;font-size:12px;font-weight:750;text-decoration:none;box-shadow:0 9px 20px #102c4920;white-space:nowrap}.ayv-open:hover{background:#174b72}
.ayv-pdf-frame{margin-top:23px;overflow:hidden;border:1px solid #cfdfea;border-radius:13px;background:#f4f8fb;box-shadow:0 12px 28px #163e5910}
.ayv-pdf-bar{display:flex;align-items:center;gap:9px;height:43px;padding:0 15px;border-bottom:1px solid #dce8f0;background:#f9fcff;color:#456079;font-size:11px;font-weight:700}
.ayv-pdf-bar:before{width:8px;height:8px;border-radius:50%;background:#238ed8;content:""}.ayv-pdf-bar small{margin-left:auto;padding:3px 6px;border-radius:4px;background:#e7f2fb;color:var(--blue-dark);font-size:9px;font-weight:800;letter-spacing:.08em}
.ayv-pdf{display:block;width:100%;height:690px;border:0;background:#eef3f6}
.ayv-pending{border-color:#cce2f4;background:linear-gradient(125deg,#fff 20%,#f4faff)}
.ayv-pending-icon{position:relative;display:block;width:47px;height:55px;margin-bottom:18px;border:2px solid #81b9e4;border-radius:7px;background:#fff;box-shadow:0 8px 20px #0e75c220}
.ayv-pending-icon:before,.ayv-pending-icon:after{position:absolute;left:10px;width:23px;height:2px;border-radius:2px;background:#98c3e4;content:""}.ayv-pending-icon:before{top:21px}.ayv-pending-icon:after{top:31px}
.ayv-contact{margin-top:38px}.ayv-contact-intro{max-width:720px}.ayv-contact-intro h2{margin:7px 0 6px}
.ayv-offices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:20px}
.ayv-office{position:relative;min-width:0;padding:25px 27px;overflow:hidden}.ayv-office:before{position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#0878d2,#a8dafb);content:""}
.ayv-office-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding-bottom:18px;border-bottom:1px solid #e5eef5}.ayv-office-head span{color:var(--blue-dark);font-size:10px;font-weight:850;letter-spacing:.14em}.ayv-office h3{margin:3px 0 0;font-size:20px;line-height:1.2}.ayv-hours{padding:5px 8px;border-radius:999px;background:#eef7ff;color:var(--blue-dark);font-size:9px;font-weight:800;white-space:nowrap}
.ayv-office dl{margin:0}.ayv-office dt{margin-top:17px;color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.10em;text-transform:uppercase}.ayv-office dd{margin:5px 0 0;color:var(--text);font-size:13px;line-height:1.65;overflow-wrap:anywhere}.ayv-office dd a{font-size:14px;font-weight:750;text-decoration:none}
.ayv-note{margin-top:16px;padding:16px 20px;background:#f6faff;color:var(--muted);font-size:11px}.ayv-note p{margin:0}
@media(max-width:700px){.ayv-offices{grid-template-columns:1fr}.ayv-pdf{height:500px}.ayv-office{padding:22px}}
@media(max-width:560px){.ayv{padding:0 8px}.ayv-hero{border-radius:18px}.ayv-seal{width:61px;height:61px;border-radius:19px}.ayv-brand strong{font-size:16px}.ayv-verified{margin-left:0}.ayv-hero-body{margin-top:25px}.ayv-details{gap:10px}.ayv-detail{min-height:94px;padding:17px;gap:11px}.ayv-detail:nth-child(-n+2){grid-column:1/-1}.ayv-detail-index{width:30px;height:30px}.ayv-detail strong{font-size:15px}.ayv-file{padding:20px}.ayv-pdf{height:430px}.ayv-open{width:100%}}
</style>`;

function contactSection() {
  return `<section class="ayv-contact" aria-labelledby="ayv-contact-title"><div class="ayv-contact-intro"><span class="ayv-section-label">AY TERCÜME · İLETİŞİM</span><h2 id="ayv-contact-title">Bir sorunuz mu var?</h2><p>Belgeyle ilgili bilgi almak için Ankara veya İstanbul şubemize ulaşabilirsiniz.</p></div><div class="ayv-offices">
    <div class="ayv-office"><div class="ayv-office-head"><div><span>01 · ANKARA</span><h3>Ankara Şubesi</h3></div><span class="ayv-hours">24 saat açık</span></div><dl><dt>Adres</dt><dd>Mustafa Kemal Mah., 2127. Cad. No: 22/1 Kat 1, 06530 Çankaya/Ankara, Türkiye</dd><dt>Telefon / WhatsApp</dt><dd><a href="tel:+905431850655">+90 543 185 06 55</a></dd></dl></div>
    <div class="ayv-office"><div class="ayv-office-head"><div><span>02 · İSTANBUL</span><h3>İstanbul Şubesi</h3></div><span class="ayv-hours">24 saat açık</span></div><dl><dt>Adres</dt><dd>Gülbahar Mah., Büyükdere Cad. No: 95/12, 34394 Şişli/İstanbul, Türkiye</dd><dt>Telefon / WhatsApp</dt><dd><a href="tel:+905447619687">+90 544 761 96 87</a></dd></dl></div>
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
  return `${verificationStyle}<main class="ayv"><header class="ayv-hero"><div class="ayv-hero-top"><div class="ayv-brand"><span>AY TERCÜME</span><strong>Belge güvenliği</strong></div></div><div class="ayv-hero-body"><span class="ayv-kicker">RESMÎ DOĞRULAMA ALANI</span><h1>Belge doğrulama</h1><p class="ayv-lead">AY Tercüme tarafından hazırlanan QR kodlu belgelerde kodu okutarak belgeye özel doğrulama sayfasını açabilirsiniz. Sayfada belge numarası, müşteri adı, tarih ve dosya gösterilir.</p></div></header>${contactSection()}</main>`;
}

export function ayVerificationDocumentHtml(document: AyVerificationDocument, marker: string) {
  const url = document.fileUrl ? new URL(document.fileUrl) : null;
  if (url && (url.protocol !== "https:" || !["aytercume.com", "www.aytercume.com"].includes(url.hostname))) throw new Error("Belge bağlantısı aytercume.com üzerinde HTTPS olmalıdır.");
  const number = escapeHtml(document.documentNumber);
  const kind = escapeHtml(document.documentType);
  const fileUrl = url ? escapeHtml(url.toString()) : "";
  const fileSection = url
    ? `<section class="ayv-file" aria-labelledby="ayv-file-title"><div class="ayv-file-head"><div><span class="ayv-section-label">03 · BELGE GÖRÜNTÜSÜ</span><h2 id="ayv-file-title">Doğrulanan dosya</h2><p>Dosyanın kendisini aşağıda inceleyebilirsiniz. Tarayıcınız önizlemeyi göstermiyorsa PDF’yi ayrı sekmede açın.</p></div><a class="ayv-open" href="${fileUrl}" target="_blank" rel="noopener noreferrer">PDF’yi aç <span aria-hidden="true">↗</span></a></div><div class="ayv-pdf-frame"><div class="ayv-pdf-bar">Belge önizlemesi <small>PDF</small></div><iframe class="ayv-pdf" src="${fileUrl}#toolbar=0" title="${number} numaralı doğrulanmış belge" loading="lazy" referrerpolicy="no-referrer"></iframe></div></section>`
    : `<section class="ayv-file ayv-pending" aria-labelledby="ayv-file-title"><span class="ayv-pending-icon" aria-hidden="true"></span><span class="ayv-section-label">03 · EVRAK DURUMU</span><h2 id="ayv-file-title">Gerekli evraklar şu anda yüklenmemiştir.</h2><p>En yakın zamanda tekrar kontrol edin. Bu sayfa güncellendiğinde aynı QR kodu üzerinden dosyayı görüntüleyebilirsiniz.</p></section>`;
  const encoded = Buffer.from(JSON.stringify(document), "utf8").toString("base64url");
  return `${verificationStyle}<main class="ayv"><header class="ayv-hero"><div class="ayv-hero-top"><span class="ayv-seal" aria-hidden="true"></span><div class="ayv-brand"><span>AY TERCÜME</span><strong>Belge doğrulama</strong></div><span class="ayv-verified">ONAYLI KAYIT</span></div><div class="ayv-hero-body"><span class="ayv-kicker">DOĞRULANMIŞ BELGE</span><h1>Bu dosya AY Tercüme tarafından oluşturulup doğrulanmıştır.</h1><p class="ayv-lead">${url ? "Aşağıdaki belge bilgilerini ve dosyanın kendisini inceleyebilirsiniz." : "Belge bilgileri aşağıdadır. Dosya hazır olduğunda bu sayfada görüntülenecektir."}</p></div><div class="ayv-hero-foot"><span class="ayv-status">Doğrulanmış belge</span><span class="ayv-hero-foot-note">AY Tercüme resmî belge kaydı</span></div></header>
  <section class="ayv-details" aria-label="Belge bilgileri"><div class="ayv-detail"><span class="ayv-detail-index" aria-hidden="true">01</span><div class="ayv-detail-body"><span>Belge numarası</span><strong>${number}</strong></div></div><div class="ayv-detail"><span class="ayv-detail-index" aria-hidden="true">02</span><div class="ayv-detail-body"><span>Müşteri</span><strong>${escapeHtml(document.customer)}</strong></div></div><div class="ayv-detail"><span class="ayv-detail-index" aria-hidden="true">03</span><div class="ayv-detail-body"><span>Belge tarihi</span><strong>${escapeHtml(displayDate(document.documentDate))}</strong></div></div><div class="ayv-detail"><span class="ayv-detail-index" aria-hidden="true">04</span><div class="ayv-detail-body"><span>Belge türü</span><strong>${kind}</strong></div></div></section>
  ${fileSection}${contactSection()}</main><!-- ${escapeHtml(marker)} --><!-- AY_VERIFICATION_DESIGN:2 --><!-- AY_VERIFICATION_DATA:${encoded} -->`;
}

export function readAyVerificationDocument(html: string, marker: string): AyVerificationDocument {
  if (!html.includes(`<!-- ${marker} -->`)) throw new Error("Doğrulama sayfası işareti uyuşmuyor.");
  const encoded = /<!-- AY_VERIFICATION_DATA:([A-Za-z0-9_-]+) -->/.exec(html)?.[1];
  if (!encoded) throw new Error("Bu eski doğrulama kaydının bilgileri otomatik güncelleme için uygun değil.");
  let value: AyVerificationDocument;
  try { value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AyVerificationDocument; }
  catch { throw new Error("Doğrulama sayfası belge bilgileri okunamadı."); }
  if (!value || typeof value.documentNumber !== "string" || typeof value.customer !== "string" || typeof value.documentDate !== "string" || typeof value.documentType !== "string" || (value.fileUrl !== undefined && typeof value.fileUrl !== "string") || (value.mediaId !== undefined && (!Number.isSafeInteger(value.mediaId) || value.mediaId <= 0))) throw new Error("Doğrulama sayfası belge bilgileri geçersiz.");
  return value;
}
