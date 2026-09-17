import type { VerificationBrand } from "./public-verification";

export const VERIFICATION_WIDGET_ORIGIN = "https://ttaa-production.up.railway.app";

export function verificationLandingWidget(brand: VerificationBrand) {
  const english = brand === "ttaa";
  const url = `${VERIFICATION_WIDGET_ORIGIN}/verify/${brand}`;
  return `<section class="ayv-lookup" aria-labelledby="ayv-lookup-title"><div class="ayv-lookup-heading"><span class="ayv-section-label">${english ? "TWO WAYS TO VERIFY" : "İKİ DOĞRULAMA YÖNTEMİ"}</span><h2 id="ayv-lookup-title">${english ? "Verify your document here" : "Belgenizi buradan doğrulayın"}</h2><p>${english ? "Use the QR code or enter the document number. Both methods open the official TTAA record." : "QR kodunu okutun veya belge numarasını girin. Her iki yöntem de resmî AY Tercüme kaydını açar."}</p></div><iframe class="ayv-lookup-frame" src="${url}" title="${english ? "TTAA document verification tools" : "AY Tercüme belge doğrulama araçları"}" allow="camera" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe><p class="ayv-lookup-fallback">${english ? "If the verification tool does not load," : "Doğrulama aracı yüklenmezse"} <a href="${url}" target="_blank" rel="noopener noreferrer">${english ? "open it in a new tab" : "yeni sekmede açın"}</a>.</p></section>`;
}
