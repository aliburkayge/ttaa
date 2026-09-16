import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminSession } from "../../../lib/auth";
import CompanySwitcher from "../../company-switcher";
import QrPrototypeStudio from "../prototype-studio";
import AyVerificationStudio from "../ay-verification-studio";
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

      {isAy
        ? <AyVerificationStudio today={new Date().toISOString().slice(0, 10)} />
        : <QrPrototypeStudio brand={brand} today={new Date().toISOString().slice(0, 10)} />}
    </main>
  </div>;
}
