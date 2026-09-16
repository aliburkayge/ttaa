"use client";
/* eslint-disable @next/next/no-img-element */

import { useRef, useState, type FormEvent } from "react";
import QrIcon from "../qr-icon";
import { createPrototypeLabel, qrCompany, validatePrototypeDetails, type PrototypeDetails, type QrBrand } from "../../lib/qr-prototype";

type DemoEntry = PrototypeDetails & Awaited<ReturnType<typeof createPrototypeLabel>> & { id: string };

function downloadFile(dataUrl: string, name: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = name;
  link.click();
}

async function labelPng(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 1400;
  canvas.height = 900;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Etiket görseli hazırlanamadı.");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export default function QrPrototypeStudio({ brand, today }: { brand: QrBrand; today: string }) {
  const empty: PrototypeDetails = { documentNumber: "", customer: "", documentType: "Tercüme belgesi", documentDate: today, driveLink: "" };
  const [form, setForm] = useState<PrototypeDetails>(empty);
  const [entries, setEntries] = useState<DemoEntry[]>([]);
  const [selected, setSelected] = useState<DemoEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("");
  const numberInput = useRef<HTMLInputElement>(null);
  const company = qrCompany(brand);
  const dirty = selected !== null && Object.keys(empty).some((key) => form[key as keyof PrototypeDetails].trim() !== selected[key as keyof PrototypeDetails]);
  const ready = Boolean(selected && !dirty && !busy);
  const visibleEntries = entries.filter((entry) => `${entry.documentNumber} ${entry.customer}`.toLocaleLowerCase("tr-TR").includes(filter.toLocaleLowerCase("tr-TR")));

  function change(key: keyof PrototypeDetails, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
    setNotice("");
  }

  function resetForm() {
    setForm(empty); setSelected(null); setError(""); setNotice("");
    numberInput.current?.focus();
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(""); setNotice("");
    try {
      const details = validatePrototypeDetails(form);
      const existing = entries.find((entry) => entry.documentNumber.toLocaleLowerCase("tr-TR") === details.documentNumber.toLocaleLowerCase("tr-TR"));
      if (!existing && entries.length >= 30) throw new Error("Bu denemede en fazla 30 etiket oluşturabilirsiniz. Devam etmek için deneme listesini temizleyin.");
      setBusy(true);
      const label = await createPrototypeLabel(brand, details);
      const entry = { ...details, ...label, id: existing?.id || crypto.randomUUID() };
      setEntries((current) => [entry, ...current.filter((item) => item.id !== entry.id)]);
      setForm(details); setSelected(entry);
      setNotice(existing ? "Deneme etiketi güncellendi." : "QR etiketi hazır. İndirebilir veya yazdırabilirsiniz.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "QR etiketi oluşturulamadı. Tekrar deneyin.");
    } finally { setBusy(false); }
  }

  function select(entry: DemoEntry) {
    setSelected(entry);
    setForm({ documentNumber: entry.documentNumber, customer: entry.customer, documentType: entry.documentType, documentDate: entry.documentDate, driveLink: entry.driveLink });
    setError(""); setNotice("Deneme etiketi seçildi.");
  }

  async function downloadPng() {
    if (!selected || !ready) return;
    setBusy(true); setError("");
    try { downloadFile(await labelPng(selected.labelUrl), `${brand}-prototip-etiket.png`); }
    catch { setError("PNG indirilemedi. SVG seçeneğiyle indirebilirsiniz."); }
    finally { setBusy(false); }
  }

  return <>
    <div className="qr-proto-heading">
      <div><p className="qr-eyebrow">{company} · BELGE YÖNETİMİ</p><h1>QR Dosya Doğrulama</h1><p>Belge bilgilerini girin, QR etiketini hazırlayın ve yazdırın.</p></div>
      <span className="qr-status"><i /> Prototip</span>
    </div>
    <div className="qr-proto-notice"><span aria-hidden="true">i</span><p>Bu alan tasarım ve akış denemesi içindir. Bilgiler sunucuya kaydedilmez; sayfa yenilendiğinde veya şirket değiştirildiğinde temizlenir.</p></div>

    <div className="qr-proto-grid">
      <section className="qr-form-panel" aria-labelledby="qr-form-title">
        <div className="qr-panel-heading"><div><small>01 · BELGE BİLGİLERİ</small><h2 id="qr-form-title">Yeni QR etiketi</h2></div><button type="button" className="qr-text-button" disabled={busy} onClick={() => {
          setForm({ ...empty, documentNumber: brand === "ttaa" ? "TEST-TTAA-001" : "TEST-AY-001", customer: "Örnek Müşteri" }); setSelected(null); setError(""); setNotice("");
        }}>Örnek bilgilerle dene</button></div>
        <form onSubmit={generate}>
          <fieldset disabled={busy}>
            <div className="qr-fields-two">
              <label>Belge numarası <span>*</span><input ref={numberInput} value={form.documentNumber} onChange={(event) => change("documentNumber", event.target.value)} required maxLength={64} placeholder={brand === "ttaa" ? "Örn. TTAA2026001" : "Örn. AYT2026009"} autoComplete="off" /></label>
              <label>Belge tarihi <span>*</span><input type="date" value={form.documentDate} onChange={(event) => change("documentDate", event.target.value)} required /></label>
            </div>
            <label>Müşteri <span>*</span><input value={form.customer} onChange={(event) => change("customer", event.target.value)} required maxLength={120} placeholder="Müşteri adı veya firma unvanı" autoComplete="off" /><small>Yalnızca panelde görünür; etikete ve QR’a eklenmez.</small></label>
            <label>Belge türü<select value={form.documentType} onChange={(event) => change("documentType", event.target.value)}><option>Tercüme belgesi</option><option>Diploma / eğitim belgesi</option><option>Resmî evrak</option><option>Sözleşme</option><option>Diğer</option></select></label>
            <label>Google Drive bağlantısı <em>İsteğe bağlı</em><input type="url" value={form.driveLink} onChange={(event) => change("driveLink", event.target.value)} maxLength={2000} placeholder="https://drive.google.com/file/d/..." autoComplete="off" /><small>Excel’deki Drive alanının karşılığıdır. Bağlantı açılmaz ve QR’a eklenmez.</small></label>
          </fieldset>
          {error ? <p className="qr-form-error" role="alert">{error}</p> : null}
          <div className="qr-form-actions"><button className="qr-primary-button" type="submit" disabled={busy}><QrIcon size={17} />{busy ? "Hazırlanıyor…" : selected && dirty ? "Etiketi güncelle" : "QR etiketi oluştur"}</button><button className="qr-secondary-button" type="button" disabled={busy} onClick={resetForm}>Yeni belge</button></div>
        </form>
      </section>

      <section className="qr-label-panel" aria-labelledby="qr-label-title">
        <div className="qr-panel-heading"><div><small>02 · ETİKET ÖNİZLEMESİ</small><h2 id="qr-label-title">Yazdırmaya hazır</h2></div><span className="qr-size-badge">70 × 45 mm</span></div>
        <div className="qr-label-stage">
          {selected ? <img className="qr-generated-label" src={selected.labelUrl} alt={`${company} prototip QR etiketi, belge ${selected.documentNumber}`} /> : <div className="qr-label-empty"><span><QrIcon size={48} /></span><strong>Etiketiniz burada görünecek</strong><p>Belge bilgilerini doldurup<br />“QR etiketi oluştur” düğmesine basın.</p></div>}
        </div>
        <div aria-live="polite" className={`qr-label-feedback${dirty ? " is-dirty" : ""}`}>{dirty ? "Bilgiler değişti. İndirmeden veya yazdırmadan önce etiketi güncelleyin." : notice || "Etikette müşteri adı ve Drive bağlantısı bulunmaz."}</div>
        <div className="qr-label-actions"><button type="button" className="qr-primary-button" disabled={!ready} onClick={() => window.print()}>Etiketi yazdır</button><button type="button" className="qr-secondary-button" disabled={!ready} onClick={() => void downloadPng()}>PNG indir</button><button type="button" className="qr-secondary-button" disabled={!ready} onClick={() => { if (selected) downloadFile(selected.labelUrl, `${brand}-prototip-etiket.svg`); }}>SVG indir</button></div>
        <p className="qr-print-help">Baskıda “gerçek boyut / %100” seçin. QR test metni içerir; doğrulama sayfasına yönlendirmez.</p>
        {selected ? <details className="qr-payload-preview"><summary>QR’ın içeriğini gör</summary><pre>{selected.qrText}</pre></details> : null}
      </section>
    </div>

    <section className="qr-demo-list" aria-labelledby="qr-demo-title">
      <div className="qr-list-heading"><div><h2 id="qr-demo-title">Bu oturumdaki denemeler <span>{entries.length}</span></h2><p>{company} için hazırlanan geçici etiketler.</p></div><div className="qr-list-tools"><input aria-label="Deneme listesinde ara" placeholder="Belge no veya müşteri ara" value={filter} onChange={(event) => setFilter(event.target.value)} /><button type="button" className="qr-text-button" disabled={!entries.length || busy} onClick={() => { setEntries([]); setFilter(""); resetForm(); }}>Listeyi temizle</button></div></div>
      {entries.length ? <div className="qr-table-scroll"><table><thead><tr><th>Belge no</th><th>Müşteri</th><th>Belge türü</th><th>Drive</th><th>Durum</th><th><span className="qr-sr-only">İşlem</span></th></tr></thead><tbody>{visibleEntries.map((entry) => <tr key={entry.id} className={selected?.id === entry.id ? "is-selected" : ""}><td><strong>{entry.documentNumber}</strong><small>{entry.documentDate.split("-").reverse().join(".")}</small></td><td>{entry.customer}</td><td>{entry.documentType}</td><td>{entry.driveLink ? "Bağlantı girildi" : "—"}</td><td><span className="qr-demo-status">Deneme</span></td><td><button type="button" className="qr-text-button" disabled={busy} onClick={() => select(entry)} aria-label={`${entry.documentNumber} etiketini göster`}>Etiketi göster ↗</button></td></tr>)}</tbody></table>{!visibleEntries.length ? <p className="qr-list-empty">Aramanızla eşleşen deneme bulunamadı.</p> : null}</div> : <div className="qr-list-empty"><QrIcon size={22} /><strong>Henüz deneme etiketi yok</strong><p>İlk etiketi oluşturduğunuzda burada listelenecek.</p></div>}
    </section>
    <p className="qr-next-step">Sonraki aşama: kalıcı kayıt, güvenli doğrulama bağlantısı ve şirketlerin resmî sitelerinde doğrulama ekranı.</p>
    {selected && !dirty ? <div className="qr-print-only"><img src={selected.labelUrl} alt="Prototip QR etiketi" /></div> : null}
  </>;
}
