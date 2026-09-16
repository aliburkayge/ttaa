import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminSession } from "../../../lib/auth";
import CompanySwitcher from "../../company-switcher";
import QrIcon from "../../qr-icon";
import "../qr-workspace.css";

export const metadata: Metadata = {
  title: "QR Dosya Doğrulama Sistemi",
  robots: { index: false, follow: false },
};

export default async function QrWorkspace({ params }: { params: Promise<{ brand: string }> }) {
  const { brand } = await params;
  if (brand !== "ttaa" && brand !== "ay-tercume") notFound();
  const session = await getAdminSession();
  if (!session) redirect("/");
  const isAy = brand === "ay-tercume";
  const company = isAy ? "Ay Tercüme" : "TTAA";

  return <div className={`qr-workspace${isAy ? " ay-studio" : ""}`} lang="tr">
    <header className="studio-header">
      <CompanySwitcher current={isAy ? "ay-tercume-qr" : "ttaa-qr"} />
      <div className="header-actions">
        <span className="save-state">{session.email}</span>
        <Link className="ghost-button qr-back-link" href={isAy ? "/ay-tercume" : "/"}>İçerik paneline dön</Link>
      </div>
    </header>
    <main className="qr-page">
      <nav className="qr-brand-nav" aria-label="Doğrulama çalışma alanı">
        <Link href="/qr-dosya-dogrulama/ttaa" aria-current={!isAy ? "page" : undefined}>TTAA</Link>
        <Link href="/qr-dosya-dogrulama/ay-tercume" aria-current={isAy ? "page" : undefined}>Ay Tercüme</Link>
      </nav>

      <section className="qr-hero">
        <div className="qr-hero-copy">
          <span className="qr-status"><i /> Hazırlık aşamasında</span>
          <p className="qr-eyebrow">{company} · BELGE YÖNETİMİ</p>
          <h1>QR Dosya<br />Doğrulama Sistemi</h1>
          <p className="qr-intro">Belgelerinize tek bir kodla ulaşılabilen, şirketinize özel bir doğrulama alanı.</p>
          <p className="qr-description">{company} için ayrılan bu çalışma alanı hazır. Dosya yükleme, QR oluşturma ve doğrulama özellikleri sonraki aşamada eklenecek.</p>
          <div className="qr-company-note"><span aria-hidden="true">↳</span><span>{company} belgeleri kendi çalışma alanında yönetilecek.</span></div>
        </div>
        <aside className="qr-preview" aria-label="Planlanan doğrulama görünümü">
          <div className="qr-preview-heading"><span>{company}</span><small>DOĞRULAMA</small></div>
          <div className="qr-preview-art"><QrIcon size={76} /></div>
          <h2>Bir kod.<br />Net bir doğrulama.</h2>
          <p>Belge bilgileri ve güncel durum,<br />aynı doğrulama ekranında.</p>
          <div className="qr-preview-fields"><span>Belge bilgileri <b aria-hidden="true">—</b></span><span>Doğrulama durumu <b aria-hidden="true">—</b></span></div>
          <small className="qr-preview-caption">Temsili görünüm · QR üretimi henüz açık değil</small>
        </aside>
      </section>

      <section className="qr-flow" aria-labelledby="qr-flow-title">
        <div className="qr-section-heading"><h2 id="qr-flow-title">Planlanan akış</h2><span>Üç adımda dosya doğrulama</span></div>
        <ol>
          <li><span className="qr-step">01</span><h3>Dosyayı ekleyin</h3><p>Belgeyi ve bilgilerini {company} çalışma alanına kaydedin.</p></li>
          <li><span className="qr-step">02</span><h3>QR kodu oluşturun</h3><p>Belgeye özel doğrulama bağlantısını QR koduyla paylaşın.</p></li>
          <li><span className="qr-step">03</span><h3>Durumu doğrulayın</h3><p>Kod okutulduğunda belge bilgileri ve doğrulama durumu görüntülensin.</p></li>
        </ol>
      </section>

      <div className="qr-privacy-note">
        <svg width="21" height="23" viewBox="0 0 20 22" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m10 2 7 3v6c0 4-7 9-7 9S3 15 3 11V5Z" /><path d="m6.5 10.5 2.5 2.5 4.5-5" /></svg>
        <div><strong>Dosyanız panelde kalacak.</strong><p>QR doğrulama ekranında yalnızca belge bilgileri ve durum gösterilecek. Dosyanın kendisi herkese açık paylaşılmayacak.</p></div>
      </div>
    </main>
  </div>;
}
