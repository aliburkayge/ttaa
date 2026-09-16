"use client";

import { useEffect, useId, useState } from "react";
import type { WordPressTarget } from "../lib/wordpress-target";

export default function WordPressTargetSelect({ value, disabled, onChange }: {
  value: WordPressTarget;
  disabled: boolean;
  onChange: (target: WordPressTarget) => void;
}) {
  const fieldId = useId();
  const [pagesEnabled, setPagesEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/status", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as { wordpressPagesEnabled?: boolean } : null)
      .then((result) => { if (!cancelled) setPagesEnabled(result?.wordpressPagesEnabled === true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // A disabled rollout keeps the existing form intact. Saved page jobs remain visible.
  if (!pagesEnabled && value === "post") return null;
  return <fieldset className="wp-destination" disabled={disabled} aria-describedby={`${fieldId}-note`}>
    <legend className="wp-destination__legend">WordPress hedefi</legend>
    <div className="wp-destination__heading">
      <span>İçerik nereye eklensin?</span>
      <span className="wp-destination__badge">Taslak</span>
    </div>
    <div className="wp-destination__options">
      {(["post", "page"] as const).map((target) => <label className="wp-destination__option" key={target}>
        <input type="radio" name={`${fieldId}-target`} value={target} checked={value === target} disabled={target === "page" && !pagesEnabled} onChange={() => onChange(target)} />
        <span className="wp-destination__card">
          <span className="wp-destination__icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              {target === "post" ? <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h8M8 15h5" /></> : <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11M13 13h4M13 16h3" /></>}
            </svg>
          </span>
          <span className="wp-destination__check" aria-hidden="true"><svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="m2.5 6 2.2 2.2 4.8-4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          <strong>{target === "post" ? "Yazı" : "Sayfa"}</strong>
          <small>{target === "post" ? "WordPress yazıları" : "WordPress sayfaları"}</small>
        </span>
      </label>)}
    </div>
    <p id={`${fieldId}-note`} className="wp-destination__note" aria-live="polite">
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M8 1.5 13 3.5V8c0 3-5 6.5-5 6.5S3 11 3 8V3.5Z" /><path d="m5.5 7.5 1.7 1.7 3.3-3.4" /></svg>
      <span><strong>{value === "page" ? "Sayfalar" : "Yazılar"}</strong> bölümüne taslak olarak eklenir.</span>
    </p>
  </fieldset>;
}
