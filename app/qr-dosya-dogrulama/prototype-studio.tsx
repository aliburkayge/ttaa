"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState, type FormEvent } from "react";
import QrIcon from "../qr-icon";
import { createPrototypeLabel, qrCompany, validatePrototypeDetails, type PrototypeDetails, type QrBrand } from "../../lib/qr-prototype";

type DemoEntry = PrototypeDetails & Awaited<ReturnType<typeof createPrototypeLabel>> & { id: string };
type SavedRecord = { id: string; details: PrototypeDetails; createdAt: string; updatedAt: string; hasFile: boolean; pdfName: string | null };

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
  const [records, setRecords] = useState<SavedRecord[]>([]);
  const [selected, setSelected] = useState<DemoEntry | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<SavedRecord | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [listBusy, setListBusy] = useState(true);
  const [listError, setListError] = useState("");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("");
  const numberInput = useRef<HTMLInputElement>(null);
  const company = qrCompany(brand);
  const dirty = selected !== null && Object.keys(empty).some((key) => form[key as keyof PrototypeDetails].trim() !== selected[key as keyof PrototypeDetails]);
  const ready = Boolean(selected && !dirty && !busy);
  const visibleEntries = records.filter((entry) => `${entry.details.documentNumber} ${entry.details.customer} ${entry.details.documentType}`.toLocaleLowerCase("tr-TR").includes(filter.toLocaleLowerCase("tr-TR")));

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/qr-documents/ttaa?list=1", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const payload = await response.json() as { records?: SavedRecord[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Kayıtlar yüklenemedi.");
      setRecords(payload.records || []);
    }).catch((failure) => { if (!controller.signal.aborted) setListError(failure instanceof Error ? failure.message : "Kayıtlar yüklenemedi."); }).finally(() => { if (!controller.signal.aborted) setListBusy(false); });
    return () => controller.abort();
  }, [reload]);

  function change(key: keyof PrototypeDetails, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
    setNotice("");
  }

  function resetForm() {
    setForm(empty); setSelected(null); setSelectedRecord(null); setPdf(null); setError(""); setNotice("");
    numberInput.current?.focus();
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(""); setNotice("");
    try {
      const details = validatePrototypeDetails(form);
      setBusy(true);
      const data = new FormData();
      for (const key of ["documentNumber", "customer", "documentType", "documentDate", "driveLink"] as const) data.set(key, details[key]);
      const response = await fetch("/api/qr-documents/ttaa", { method: "POST", body: data });
      const payload = await response.json() as SavedRecord & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Belge kaydedilemedi.");
      const label = await createPrototypeLabel(brand, details);
      const entry = { ...details, ...label, id: payload.id };
      setForm(details); setSelected(entry); setSelectedRecord(payload);
      setNotice("Kayıt ve QR etiketi saklandı. İndirebilir veya yazdırabilirsiniz.");
      setListBusy(true); setListError(""); setReload((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "QR etiketi oluşturulamadı. Tekrar deneyin.");
    } finally { setBusy(false); }
  }

  async function select(record: SavedRecord) {
    try {
      const label = await createPrototypeLabel(brand, record.details);
      setSelected({ ...record.details, ...label, id: record.id }); setSelectedRecord(record);
      setForm(record.details); setPdf(null);
      setError(""); setNotice("Kayıt ve QR etiketi açıldı.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch { setError("QR etiketi açılamadı."); }
  }

  async function updatePdf(mode: "pdf" | "remove") {
    if (!selectedRecord || pdfBusy) return;
    if (mode === "pdf" && !pdf) { setError("Bir PDF seçin."); return; }
    if (mode === "remove" && !window.confirm(`${selectedRecord.details.documentNumber} numaralı belgenin PDF dosyası kaldırılsın mı?`)) return;
    setPdfBusy(true); setError(""); setNotice("");
    try {
      const data = new FormData(); data.set("mode", mode); data.set("documentNumber", selectedRecord.details.documentNumber);
      if (pdf && mode === "pdf") data.set("file", pdf);
      const response = await fetch("/api/qr-documents/ttaa", { method: "POST", body: data });
      const payload = await response.json() as SavedRecord & { error?: string; warning?: string | null };
      if (!response.ok) throw new Error(payload.error || "PDF işlemi tamamlanamadı.");
      setSelectedRecord(payload); setPdf(null); setListBusy(true); setListError(""); setReload((value) => value + 1);
      setNotice(payload.warning || (mode === "remove" ? "PDF kaldırıldı." : "PDF güvenli panel deposuna kaydedildi."));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "PDF işlemi tamamlanamadı."); }
    finally { setPdfBusy(false); }
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
      <span className="qr-status"><i /> Özel panel kaydı</span>
    </div>
    <div className="qr-proto-notice"><span aria-hidden="true">i</span><p>TTAA belge kayıtları ve PDF’ler özel panel deposunda saklanır. QR etiketi hâlâ prototiptir; resmî sitede doğrulama sayfası açmaz.</p></div>

    <div className="qr-proto-grid">
      <section className="qr-form-panel" aria-labelledby="qr-form-title">
        <div className="qr-panel-heading"><div><small>01 · BELGE BİLGİLERİ</small><h2 id="qr-form-title">Yeni kayıt ve QR etiketi</h2></div></div>
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
          <div className="qr-form-actions"><button className="qr-primary-button" type="submit" disabled={busy || Boolean(selectedRecord)}><QrIcon size={17} />{busy ? "Kaydediliyor…" : selectedRecord ? "Kayıt ve QR hazır" : "Kaydet ve QR oluştur"}</button><button className="qr-secondary-button" type="button" disabled={busy} onClick={resetForm}>Yeni belge</button></div>
        </form>
      </section>

      <section className="qr-label-panel" aria-labelledby="qr-label-title">
        <div className="qr-panel-heading"><div><small>02 · ETİKET ÖNİZLEMESİ</small><h2 id="qr-label-title">Yazdırmaya hazır</h2></div><span className="qr-size-badge">70 × 45 mm</span></div>
        <div className="qr-label-stage">
          {selected ? <img className="qr-generated-label" src={selected.labelUrl} alt={`${company} prototip QR etiketi, belge ${selected.documentNumber}`} /> : <div className="qr-label-empty"><span><QrIcon size={48} /></span><strong>Etiketiniz burada görünecek</strong><p>Belge bilgilerini doldurup<br />“Kaydet ve QR oluştur” düğmesine basın.</p></div>}
        </div>
        <div aria-live="polite" className={`qr-label-feedback${dirty ? " is-dirty" : ""}`}>{dirty ? "Bilgiler değişti. İndirmeden veya yazdırmadan önce etiketi güncelleyin." : notice || "Etikette müşteri adı ve Drive bağlantısı bulunmaz."}</div>
        <div className="qr-label-actions"><button type="button" className="qr-primary-button" disabled={!ready} onClick={() => window.print()}>Etiketi yazdır</button><button type="button" className="qr-secondary-button" disabled={!ready} onClick={() => void downloadPng()}>PNG indir</button><button type="button" className="qr-secondary-button" disabled={!ready} onClick={() => { if (selected) downloadFile(selected.labelUrl, `${brand}-prototip-etiket.svg`); }}>SVG indir</button></div>
        <p className="qr-print-help">Baskıda “gerçek boyut / %100” seçin. QR test metni içerir; doğrulama sayfasına yönlendirmez.</p>
        {selected ? <details className="qr-payload-preview"><summary>QR’ın içeriğini gör</summary><pre>{selected.qrText}</pre></details> : null}
      </section>
    </div>

    <section className="qr-demo-list" aria-labelledby="qr-demo-title">
      <div className="qr-list-heading"><div><h2 id="qr-demo-title">TTAA belge kayıtları <span>{records.length}</span></h2><p>Kaydedilen belgeler sayfayı yeniledikten sonra da burada kalır.</p></div><div className="qr-list-tools"><input aria-label="Belge kayıtlarında ara" placeholder="Belge no veya müşteri ara" value={filter} onChange={(event) => setFilter(event.target.value)} /><button type="button" className="qr-secondary-button" disabled={listBusy} onClick={() => { setListBusy(true); setListError(""); setReload((value) => value + 1); }}>Yenile</button></div></div>
      {listError ? <p className="qr-form-error" role="alert">{listError}</p> : null}
      {listBusy ? <p className="qr-list-message">Kayıtlar yükleniyor…</p> : visibleEntries.length ? <div className="qr-table-scroll"><table><thead><tr><th>Belge no</th><th>Müşteri</th><th>Belge türü</th><th>PDF</th><th>İşlem</th></tr></thead><tbody>{visibleEntries.map((entry) => <tr key={entry.id} className={selected?.id === entry.id ? "is-selected" : ""}><td><strong>{entry.details.documentNumber}</strong><small>{entry.details.documentDate.split("-").reverse().join(".")}</small></td><td>{entry.details.customer}</td><td>{entry.details.documentType}</td><td><span className={`qr-record-status${entry.hasFile ? " is-complete" : ""}`}>{entry.hasFile ? "PDF yüklü" : "PDF bekleniyor"}</span></td><td><button type="button" className="qr-text-button" disabled={busy} onClick={() => void select(entry)}>Kaydı / QR’ı aç</button></td></tr>)}</tbody></table></div> : <div className="qr-list-empty"><QrIcon size={22} /><strong>{filter ? "Aramayla eşleşen belge yok" : "Henüz kayıt yok"}</strong><p>Yeni bir belge kaydettiğinizde burada görünür.</p></div>}
    </section>
    {selectedRecord ? <section className="qr-update-card" aria-labelledby="ttaa-pdf-title"><div className="qr-panel-heading"><div><small>03 · ÖZEL PDF YÖNETİMİ</small><h2 id="ttaa-pdf-title">{selectedRecord.details.documentNumber} · {selectedRecord.details.customer}</h2></div><span className={`qr-record-status${selectedRecord.hasFile ? " is-complete" : ""}`}>{selectedRecord.hasFile ? "PDF yüklü" : "PDF bekleniyor"}</span></div><p className="qr-update-intro">PDF yalnızca giriş yapılmış panelden açılabilir. Dosyayı daha sonra ekleyebilir, yenisiyle değiştirebilir veya kaldırabilirsiniz.</p>{selectedRecord.hasFile ? <a className="qr-file-link" href={`/api/qr-documents/ttaa/file?documentNumber=${encodeURIComponent(selectedRecord.details.documentNumber)}`} target="_blank" rel="noopener noreferrer">Mevcut PDF’yi aç ↗ {selectedRecord.pdfName || ""}</a> : null}<div className="qr-attach-form"><label>{selectedRecord.hasFile ? "Yeni PDF ile değiştir" : "PDF ekle"}<input className="qr-file-input" type="file" accept=".pdf,application/pdf" onChange={(event) => setPdf(event.target.files?.[0] || null)} /><small>En fazla 8 MB.</small></label><div className="qr-form-actions"><button type="button" className="qr-primary-button" disabled={pdfBusy || !pdf} onClick={() => void updatePdf("pdf")}>{pdfBusy ? "Kaydediliyor…" : selectedRecord.hasFile ? "PDF’yi değiştir" : "PDF ekle"}</button>{selectedRecord.hasFile ? <button type="button" className="qr-danger-button" disabled={pdfBusy} onClick={() => void updatePdf("remove")}>PDF’yi kaldır</button> : null}</div></div></section> : null}
    <p className="qr-next-step">TTAA etiketindeki QR yalnızca prototip bilgisini içerir; resmî doğrulama sayfası sonraki aşamadadır.</p>
    {selected && !dirty ? <div className="qr-print-only"><img src={selected.labelUrl} alt="Prototip QR etiketi" /></div> : null}
  </>;
}
