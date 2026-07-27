/* The supplied TTAA and Ay Tercüme logos are local brand assets. */
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";

type CompanySwitcherProps = {
  current: "ttaa" | "ay-tercume" | "billing";
};

export default function CompanySwitcher({ current }: CompanySwitcherProps) {
  const isTtaa = current === "ttaa";
  const isAyTercume = current === "ay-tercume";
  const isBilling = current === "billing";

  return (
    <details className="company-switcher">
      <summary aria-label="Firma değiştir">
        {isTtaa
          ? <img className="brand-logo-image" src="/ttaa-logo.png" alt="Turkish Translation & Attestation Agency" />
          : isAyTercume
            ? <img className="ay-brand-logo-image" src="/ay-tercume-logo.jpg" alt="Ay Tercüme" />
            : <span className="billing-summary-icon" aria-hidden="true">₺</span>}
        <div>
          <strong>{isTtaa ? "Content Studio" : isAyTercume ? "Ay Tercüme" : "Faturalandırma"}</strong>
          <span>{isTtaa ? "TTAA çalışma alanı" : isAyTercume ? "Ay Tercüme çalışma alanı" : "Ödeme takvimi ve partnerlik"}</span>
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
        <Link href="/faturalandirma-ve-partnerlik" className={`billing-partnership-item${isBilling ? " active" : ""}`} role="menuitem">
          <span className="billing-partnership-icon" aria-hidden="true">₺</span>
          <span><strong>Faturalandırma ve Partnerlik</strong><small>Ödeme takvimi ve iş ortaklığı</small></span>
        </Link>
      </div>
    </details>
  );
}
