import Link from "next/link";
import { redirect } from "next/navigation";
import CompanySwitcher from "../company-switcher";
import { getAdminSession } from "../../lib/auth";

const PAYMENT_SCHEDULE = [
  ["12 Ağustos 2026", "200 USD"],
  ["12 Eylül 2026", "200 USD"],
  ["12 Ekim 2026", "200 USD"],
  ["12 Kasım 2026", "200 USD"],
  ["12 Aralık 2026", "200 USD"],
  ["12 Ocak 2027", "200 USD"],
  ["12 Şubat 2027", "200 USD"],
  ["12 Mart 2027", "200 USD"],
  ["12 Nisan 2027", "200 USD"],
  ["12 Mayıs 2027", "200 USD"],
  ["12 Haziran 2027", "200 USD"],
  ["12 Temmuz 2027", "200 USD"],
];

const USD_TO_TRY = 47.22;
const COMPARISON_PLANS = [
  { label: "Normal ödeme", referrals: "0 müşteri", monthlyUsd: 200 },
  { label: "1 müşteri getirirse", referrals: "50 USD indirim", monthlyUsd: 150 },
  { label: "2 müşteri getirirse", referrals: "100 USD indirim", monthlyUsd: 100 },
].map((plan) => ({
  ...plan,
  monthlyTry: plan.monthlyUsd * USD_TO_TRY,
  annualTry: plan.monthlyUsd * 12 * USD_TO_TRY,
  annualSaving: (200 - plan.monthlyUsd) * 12 * USD_TO_TRY,
}));

const formatTry = (value: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(value);
const CHART_X = [150, 480, 810];
const chartY = (value: number) => 280 - (value / 120000) * 240;
const annualPaymentPoints = COMPARISON_PLANS.map((plan, index) => `${CHART_X[index]},${chartY(plan.annualTry)}`).join(" ");
const annualSavingPoints = COMPARISON_PLANS.map((plan, index) => `${CHART_X[index]},${chartY(plan.annualSaving)}`).join(" ");
const CHART_TICKS = [120000, 90000, 60000, 30000, 0];
const MOBILE_CHART_X = [78, 210, 342];
const mobileChartY = (value: number) => 330 - (value / 120000) * 250;
const mobileAnnualPaymentPoints = COMPARISON_PLANS.map((plan, index) => `${MOBILE_CHART_X[index]},${mobileChartY(plan.annualTry)}`).join(" ");
const mobileAnnualSavingPoints = COMPARISON_PLANS.map((plan, index) => `${MOBILE_CHART_X[index]},${mobileChartY(plan.annualSaving)}`).join(" ");
const MOBILE_CHART_TICKS = [120000, 60000, 0];

export default async function BillingAndPartnershipPage() {
  const session = await getAdminSession();
  if (!session) redirect("/");

  return (
    <div className="billing-shell">
      <header className="studio-header">
        <CompanySwitcher current="billing" />
        <div className="header-actions">
          <span className="save-state">{session.email}</span>
          <Link className="ghost-button billing-back-link" href="/">İçerik paneline dön</Link>
        </div>
      </header>

      <main className="billing-page">
        <section className="referral-hero">
          <div className="referral-hero-copy">
            <span className="page-kicker">PARTNERLİK PROGRAMI</span>
            <h1>Müşteri getir,<br />aylık ödemen düşsün.</h1>
            <p>İşletmemizi başka bir işletmeye önerin. Başlayan her yeni müşteri için aylık ödemenizden 50 USD indirim kazanın.</p>
            <div className="referral-limit-note">
              <span>2</span>
              <div><strong>En fazla iki müşteri</strong><small>Toplam aylık indirim sınırı 100 USD</small></div>
            </div>
          </div>
          <div className="referral-reward-panel">
            <div className="referral-reward-heading">
              <div><small>MEVCUT PARTNERLİK DURUMU</small><strong>0 / 2 müşteri</strong></div>
              <span>Başlangıç</span>
            </div>
            <div className="referral-progress" aria-label="Referral ilerlemesi: sıfır müşteri">
              <span className="reached" /><span /><span />
            </div>
            <div className="referral-tier-grid">
              <article className="current">
                <small>0 MÜŞTERİ</small>
                <strong><span>$</span>200</strong>
                <p>Aylık standart ödeme</p>
              </article>
              <article>
                <small>1 MÜŞTERİ</small>
                <strong><span>$</span>150</strong>
                <p>Aylık 50 USD indirim</p>
              </article>
              <article className="best-reward">
                <small>2 MÜŞTERİ</small>
                <strong><span>$</span>100</strong>
                <p>Aylık 100 USD indirim</p>
              </article>
            </div>
            <div className="referral-reward-footer"><span>−$50</span><p>Her yeni müşteri aylık ödemenizi 50 USD azaltır.</p></div>
          </div>
        </section>

        <section className="plan-comparison-section">
          <div className="comparison-heading">
            <div><span className="page-kicker">KAZANÇ KARŞILAŞTIRMASI</span><h2>Partnerlik indiriminin yıllık karşılığı</h2><p>Müşteri sayısı arttıkça yıllık ödemenin nasıl azaldığını ve tasarrufun nasıl büyüdüğünü görün.</p></div>
            <span className="exchange-rate-badge"><small>REFERANS KUR</small><strong>1 USD = 47,22 TL</strong></span>
          </div>
          <div className="comparison-chart-legend" aria-label="Grafik açıklaması">
            <span><i className="annual-payment-line" /> Yıllık ödeme</span>
            <span><i className="annual-saving-line" /> Yıllık tasarruf</span>
          </div>
          <div className="comparison-chart-wrap">
            <svg className="comparison-line-chart desktop-comparison-chart" viewBox="0 0 920 365" role="img" aria-labelledby="comparison-chart-title comparison-chart-desc">
              <title id="comparison-chart-title">Referral sayısına göre yıllık ödeme ve tasarruf çizgi grafiği</title>
              <desc id="comparison-chart-desc">Sıfır müşteride yıllık ödeme 113.328 TL ve tasarruf sıfırdır. Bir müşteride yıllık ödeme 84.996 TL, tasarruf 28.332 TL olur. İki müşteride yıllık ödeme ve tasarruf 56.664 TL olur.</desc>
              {CHART_TICKS.map((tick) => {
                const y = chartY(tick);
                return <g className="chart-grid-line" key={tick}><line x1="82" y1={y} x2="870" y2={y} /><text x="68" y={y + 4} textAnchor="end">{tick === 0 ? "0" : `${formatTry(tick / 1000)} bin`}</text></g>;
              })}
              <text className="chart-axis-unit" x="68" y="22" textAnchor="end">TL / YIL</text>
              <polyline className="chart-series annual-payment-series" points={annualPaymentPoints} />
              <polyline className="chart-series annual-saving-series" points={annualSavingPoints} />
              {COMPARISON_PLANS.map((plan, index) => {
                const x = CHART_X[index];
                const paymentY = chartY(plan.annualTry);
                const savingY = chartY(plan.annualSaving);
                return (
                  <g key={plan.label}>
                    <circle className="chart-point annual-payment-point" cx={x} cy={paymentY} r="6" />
                    <text className="chart-value annual-payment-value" x={x} y={paymentY - 14} textAnchor="middle">{formatTry(plan.annualTry)} TL</text>
                    <circle className="chart-point annual-saving-point" cx={x} cy={savingY} r="6" />
                    <text className="chart-value annual-saving-value" x={x} y={index === 2 ? savingY + 27 : savingY - 14} textAnchor="middle">{formatTry(plan.annualSaving)} TL</text>
                    <text className="chart-x-label" x={x} y="322" textAnchor="middle">{index} MÜŞTERİ</text>
                    <text className="chart-x-sub-label" x={x} y="343" textAnchor="middle">${plan.monthlyUsd} / ay</text>
                  </g>
                );
              })}
            </svg>
            <svg className="comparison-line-chart mobile-comparison-chart" viewBox="0 0 420 430" role="img" aria-labelledby="mobile-comparison-chart-title mobile-comparison-chart-desc">
              <title id="mobile-comparison-chart-title">Mobil referral kazanç karşılaştırması</title>
              <desc id="mobile-comparison-chart-desc">Müşteri sayısı sıfırdan ikiye yükseldikçe yıllık ödeme 113.328 TL&apos;den 56.664 TL&apos;ye düşer ve yıllık tasarruf sıfırdan 56.664 TL&apos;ye çıkar.</desc>
              {MOBILE_CHART_TICKS.map((tick) => {
                const y = mobileChartY(tick);
                return <g className="chart-grid-line" key={tick}><line x1="52" y1={y} x2="390" y2={y} /><text x="44" y={y + 5} textAnchor="end">{tick === 0 ? "0" : `${formatTry(tick / 1000)}K`}</text></g>;
              })}
              <text className="chart-axis-unit" x="44" y="50" textAnchor="end">TL</text>
              <polyline className="chart-series annual-payment-series" points={mobileAnnualPaymentPoints} />
              <polyline className="chart-series annual-saving-series" points={mobileAnnualSavingPoints} />
              {COMPARISON_PLANS.map((plan, index) => {
                const x = MOBILE_CHART_X[index];
                const paymentY = mobileChartY(plan.annualTry);
                const savingY = mobileChartY(plan.annualSaving);
                return (
                  <g key={plan.label}>
                    <circle className="chart-point annual-payment-point" cx={x} cy={paymentY} r="7" />
                    <text className="chart-value annual-payment-value" x={x} y={paymentY - 18} textAnchor="middle">{formatTry(plan.annualTry)} TL</text>
                    <circle className="chart-point annual-saving-point" cx={x} cy={savingY} r="7" />
                    <text className="chart-value annual-saving-value" x={x} y={index === 2 ? savingY + 34 : savingY - 18} textAnchor="middle">{formatTry(plan.annualSaving)} TL</text>
                    <text className="chart-x-label" x={x} y="378" textAnchor="middle">{index} MÜŞTERİ</text>
                    <text className="chart-x-sub-label" x={x} y="405" textAnchor="middle">${plan.monthlyUsd} / ay</text>
                  </g>
                );
              })}
            </svg>
            <div className="chart-accessible-values" aria-hidden="true">
              {COMPARISON_PLANS.map((plan, index) => <span key={plan.label}><strong>{index} müşteri</strong><small>{formatTry(plan.annualTry)} TL yıllık ödeme · {formatTry(plan.annualSaving)} TL tasarruf</small></span>)}
            </div>
          </div>
          <p className="comparison-rate-note">Hesaplama kullanıcı tarafından verilen 47,22 TL sabit referans kuruyla yapılmıştır. Kur değiştiğinde TL karşılıkları da değişir.</p>
        </section>

        <section className="billing-section-intro">
          <div><span className="page-kicker">FATURALANDIRMA</span><h2>Ödeme planı</h2></div>
          <span className="billing-plan-status"><i /> Planlandı</span>
        </section>
        <section className="billing-summary-grid" aria-label="Ödeme planı özeti">
          <article>
            <small>AYLIK ÖDEME</small>
            <strong><span>$</span>200</strong>
            <p>Her ay aynı tutar</p>
          </article>
          <article>
            <small>İLK ÖDEME</small>
            <strong>12 Ağustos</strong>
            <p>2026 başlangıç tarihi</p>
          </article>
          <article>
            <small>ÖDEME GÜNÜ</small>
            <strong>Her ayın 12&apos;si</strong>
            <p>Aylık tekrar eden takvim</p>
          </article>
          <article>
            <small>İLK 12 AY</small>
            <strong><span>$</span>2.400</strong>
            <p>12 × 200 USD</p>
          </article>
        </section>

        <div className="billing-content-grid">
          <section className="payment-calendar-card">
            <div className="billing-section-heading">
              <div>
                <small>12 AYLIK GÖRÜNÜM</small>
                <h2>Planlanan ödemeler</h2>
              </div>
              <span>USD</span>
            </div>
            <div className="payment-table" role="table" aria-label="Aylık ödeme tarihleri">
              <div className="payment-table-header" role="row">
                <span role="columnheader">Dönem</span>
                <span role="columnheader">Tarih</span>
                <span role="columnheader">Tutar</span>
                <span role="columnheader">Durum</span>
              </div>
              {PAYMENT_SCHEDULE.map(([date, amount], index) => (
                <div className="payment-table-row" role="row" key={date}>
                  <span role="cell">{String(index + 1).padStart(2, "0")}</span>
                  <strong role="cell">{date}</strong>
                  <span role="cell">{amount}</span>
                  <span className="scheduled-pill" role="cell">Planlandı</span>
                </div>
              ))}
            </div>
            <p className="billing-table-note">Bu tablo indirim öncesi ilk 12 aylık planı gösterir. Referral indirimi kazanıldığında sonraki aylık tutar 1 müşteri için 150 USD, 2 müşteri için 100 USD olarak güncellenir.</p>
          </section>

          <aside className="partnership-card referral-rules-card">
            <span className="partnership-icon" aria-hidden="true">◎</span>
            <small>PROGRAM KURALLARI</small>
            <h2>İndirim nasıl işler?</h2>
            <ol>
              <li><span>1</span><p>Müşteri panel için tek seferlik kurulum ve aylık hizmet ödemesi yapar.</p></li>
              <li><span>2</span><p>Getirilen her yeni müşteri için mevcut müşterinin aylık ödemesi 50 USD azalır.</p></li>
              <li><span>3</span><p>En fazla iki referral indirime dahil edilir; aylık ödeme en düşük 100 USD olur.</p></li>
            </ol>
            <div className="referral-rule-note"><strong>Kurulum ücreti sabit kalır</strong><small>Partnerlik indirimi yalnızca aylık ödemeye uygulanır.</small></div>
          </aside>
        </div>
      </main>
    </div>
  );
}
