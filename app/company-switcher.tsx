/* The supplied TTAA and Ay Tercüme logos are local brand assets. */
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import QrIcon from "./qr-icon";

type CompanySwitcherProps = {
  current: "ttaa" | "ay-tercume" | "billing" | "ttaa-qr" | "ay-tercume-qr";
};

export default function CompanySwitcher({ current }: CompanySwitcherProps) {
  const isTtaa = current === "ttaa";
  const isAyTercume = current === "ay-tercume";
  const isBilling = current === "billing";
  const isQr = current === "ttaa-qr" || current === "ay-tercume-qr";
  const isTtaaBrand = isTtaa || current === "ttaa-qr";
  const isAyBrand = isAyTercume || current === "ay-tercume-qr";

  return (
    <details className="company-switcher">
      <summary aria-label="Firma değiştir">
        {isTtaaBrand
          ? <img className="brand-logo-image" src="/ttaa-logo.png" alt="Turkish Translation & Attestation Agency" />
          : isAyBrand
            ? <img className="ay-brand-logo-image" src="/ay-tercume-logo.jpg" alt="Ay Tercüme" />
            : <span className="billing-summary-icon" aria-hidden="true">₺</span>}
        <div>
          <strong>{isQr ? "Dosya Doğrulama" : isTtaa ? "Content Studio" : isAyTercume ? "Ay Tercüme" : "Faturalandırma"}</strong>
          <span>{isTtaaBrand ? "TTAA çalışma alanı" : isAyBrand ? "Ay Tercüme çalışma alanı" : "Ödeme takvimi ve partnerlik"}</span>
        </div>
        <b aria-hidden="true">⌄</b>
      </summary>
      <div className="company-menu" role="menu">
        <small>FİRMA SEÇİN</small>
        <Link href="/" className={isTtaa ? "active" : ""} role="menuitem">
          <span className="company-option-logo">
            <img src="/ttaa-logo.png" alt="TTAA logosu" />
          </span>
          <span><strong>TTAA</strong><small>Aktif içerik sistemi</small></span>
          {isTtaa ? <b>✓</b> : null}
        </Link>
        <Link href="/ay-tercume" className={isAyTercume ? "active" : ""} role="menuitem">
          <span className="company-option-logo ay-company-option-logo">
            <img src="/ay-tercume-logo.jpg" alt="Ay Tercüme logosu" />
          </span>
          <span><strong>Ay Tercüme</strong><small>Aktif içerik ve görsel sistemi</small></span>
          {isAyTercume ? <b>✓</b> : null}
        </Link>
        <div className="company-menu-divider" />
        <details className="assistant-switcher">
          <summary>
            <span className="assistant-switcher-icon" aria-hidden="true">●</span>
            <span>WhatsApp Asistan</span>
            <b aria-hidden="true">⌄</b>
          </summary>
          <div className="assistant-options">
            <button type="button" disabled>
              <span className="company-option-logo">
                <img src="/ttaa-logo.png" alt="" />
              </span>
              <span><strong>TTAA Asistan</strong><small>Yakında kullanıma açılacak</small></span>
            </button>
            <button type="button" disabled>
              <span className="company-option-logo ay-company-option-logo">
                <img src="/ay-tercume-logo.jpg" alt="" />
              </span>
              <span><strong>AY Asistan</strong><small>Yakında kullanıma açılacak</small></span>
            </button>
          </div>
        </details>
        <div className="company-menu-divider" />
        <details className="assistant-switcher qr-menu" open={isQr}>
          <summary>
            <span className="qr-menu-icon"><QrIcon size={15} /></span>
            <span>QR Dosya Doğrulama Sistemi</span>
            <b aria-hidden="true">⌄</b>
          </summary>
          <div className="assistant-options qr-menu-options">
            <Link href="/qr-dosya-dogrulama/ttaa" className={current === "ttaa-qr" ? "active" : ""} aria-current={current === "ttaa-qr" ? "page" : undefined} role="menuitem">
              <span className="company-option-logo"><img src="/ttaa-logo.png" alt="" /></span>
              <span><strong>TTAA Doğrulama</strong><small>QR etiket prototipi</small></span>
              {current === "ttaa-qr" ? <b>✓</b> : null}
            </Link>
            <Link href="/qr-dosya-dogrulama/ay-tercume" className={current === "ay-tercume-qr" ? "active" : ""} aria-current={current === "ay-tercume-qr" ? "page" : undefined} role="menuitem">
              <span className="company-option-logo ay-company-option-logo"><img src="/ay-tercume-logo.jpg" alt="" /></span>
              <span><strong>Ay Tercüme Doğrulama</strong><small>QR etiket prototipi</small></span>
              {current === "ay-tercume-qr" ? <b>✓</b> : null}
            </Link>
          </div>
        </details>
        <div className="company-menu-divider" />
        <Link href="/faturalandirma-ve-partnerlik" className={`billing-partnership-item${isBilling ? " active" : ""}`} role="menuitem">
          <span className="billing-partnership-icon" aria-hidden="true">₺</span>
          <span><strong>Faturalandırma ve Partnerlik</strong><small>Ödeme takvimi ve iş ortaklığı</small></span>
        </Link>
      </div>
    </details>
  );
}
