# Çeviri APP — Tasarım Dokümanı

**Tarih:** 19 Eylül 2026
**Konum:** `/ceviri-app` (şu an yer tutucu inşaat sayfası)
**Durum:** Tasarım onaylandı, uygulama planı bekliyor

---

## 1. Amaç

Resmi evrak niteliğindeki belgelerin, müşteriye ve sektöre özgü terminolojiye uyarak,
kaynak belgenin biçimini koruyarak çevrilmesi. Sistem yapılan düzeltmeleri kalıcı olarak
hatırlar; aynı hata ikinci kez yapılmaz.

Bugünkü akış — belgeyi ChatGPT'ye yükleyip prompt yazmak — üç yerden kırılıyor:

1. **Uzun belgelerde bozulma.** Model tüm belgeyi yeniden ürettiği için uzadıkça segment
   atlıyor, biçimi kaybediyor.
2. **Tutarsızlık.** Aynı cümle aynı belgede iki farklı şekilde çevrilebiliyor; geçen ayki
   teslimatla bu ayki çelişebiliyor.
3. **Hafızasızlık.** "Bunu böyle çevir" düzeltmesi bir sonraki belgede unutuluyor.

Bunlar resmi evrakta ticari risk doğurur: hatalı ruhsat kodu, eksik tablo satırı veya
terminolojiye aykırı karşılık müşteri nezdinde sorumluluk yaratır.

---

## 2. Ölçülen mevcut durum

Tasarım varsayımla değil, eldeki verinin ölçümüyle kuruldu.

### 2.1 Çeviri belleği (3 TMX arşivi)

| Arşiv | Dosya | Segment |
|---|---|---|
| `b7a955…` | 21 TMX | 86.696 |
| `bcdff…` | 16 TMX | 45.066 |
| `8b91bc…` | 1 TMX | 4.983 |
| **Toplam** | **38 dosya** | **136.745** |

- ~28 dil çifti, ~21 dil. İngilizce↔Türkçe baskın (~108k segment).
- Kaynak: MyMemory / Lara. Segment başına `x-project_name` (örn. `basf 11-08`),
  `x-context-pre`, `x-context-post` ve köken bilgisi (`TM` / `MT` / `Lara`) var.
- **Üç arşivde de `english__turkish.tmx` var** (4.983 / 33.817 / 69.581). Bunlar aynı
  hesabın farklı tarihli ihraçları; ciddi biçimde üst üste biniyor. Tekilleştirme zorunlu.

### 2.2 Terminoloji (4 xlsx)

Şema: `Forbidden | Domain | Subdomain | Definition | <dil> | Notes | Example of use`
(dil üçlüsü her dil için tekrarlıyor).

- Toplam ~525 terim satırı.
- Diller: `de-DE`, `el-GR`, `en-GB`, `en-US`, `es-ES`, `it-IT`, `ru-RU`, `tr-TR`, `pl-PL`.
- **`Domain`, `Subdomain`, `Definition` sütunları tamamen boş.** Sadece başlık var.
- **`Forbidden` her satırda `false`.** Yasaklı terim tanımlanmamış.
- Dosyalar müşteri/sektör etiketi taşımıyor.

Yani bugünkü terminoloji, düz bir iki dilli kelime listesi. Sektör ayrımı ve yasaklı terim
mekanizması bu projede kurulacak.

### 2.3 Referans arşivi (BASF, 127 dosya)

**Girdi tarafı — 84 PDF:**
- **%100'ü taranmış görüntü.** Hiçbirinde metin katmanı yok (`pdftotext` sıfır karakter
  döndürüyor); içerik gömülü JPEG (`/DCTDecode`).
- Toplam **188 sayfa**, ortalama **2,32 sayfa/belge**, en büyüğü **16 sayfa**.
  (81 PDF üzerinden; 3 dosyanın adı arşivde bozuk kodlanmış, okunamadı.)
- Sayfa dağılımı: 1sf×47, 2sf×19, 3sf×1, 4sf×6, 6sf×1, 7sf×1, 8sf×3, 11sf×1, 12sf×1, 16sf×1.
  Çoğunluk kısa, ama uzun kuyruk var — tek sayfalık varsayımı yapılamaz.
- **Sonuç: OCR opsiyonel değil, sistemin ön kapısı.**

> **Ölçüm notu:** Sayfa sayısı `pypdf` ile ölçülmüştür. PDF nesne akışları sıkıştırıldığı
> için ham metin araması (`/Type /Page` grep'i) güvenilmezdir ve bu belgelerde yanlış
> sonuç verir.

> **Veri notu:** Arşivdeki 3 PDF'in dosya adı bozuk kodlanmış (Türkçe karakterler
> kayıp). İçe aktarma katmanı bozuk dosya adlarını tolere etmeli ve raporlamalıdır.

**Çıktı tarafı — 43 DOCX teslimat:**
- Ortalama 580 kelime.
- 34/43 dosyada tablo (toplam 156).
- 39/43 dosyada gömülü görsel (toplam 131) — logolar korunmuş.
- 37/43 dosyada köşeli parantez yer tutucu (toplam 400).

**Yer tutucu sözlüğü:**

| Yer tutucu | Kullanım |
|---|---|
| `[İMZA]` | ~196 |
| `[MÜHÜR]` | 138 |
| `[KAŞE]` | 21 |
| `[MÜHÜR/KAŞE]`, `[LOGO]`, `[BARKOD]` | az sayıda |
| Açıklayıcı | `[NOTERLİK BELGELERİNE MAHSUS DEVLET DAMGA PULU]`, `[KIRMIZI MÜHÜR]` |

Büyük/küçük harf tutarsız (`[MÜHÜR]` ve `[mühür]` birlikte kullanılmış). Tek standarda
oturtulacak.

**Belge tipi frekansı:**

| Tip | Adet |
|---|---|
| Ambalaj Bilgi Formu | 19 |
| Garanti Mektubu | 17 |
| Ürün Spesifikasyonu | 11 |
| Sözleşme | 8 |
| Üretici Belgesi | 7 |
| Gizli Reçete | 7 |
| Yetkilendirme Mektubu | 6 |

İlk beş tip dosyaların ~%49'u. Klasörleme ürün bazlı (ASPİRE, DAXUR, FASTAC, INTERVIX,
POLYRAM, PRIAXOR…), her üründe aynı belge tipleri tekrarlıyor.

**33 adet `EN.pdf` → `TR.docx` çifti** aynı klasörde. Hizalanabilir altın standart.

### 2.4 Mevcut iş tanımı (`text prompt.docx`)

Bugün ChatGPT'ye verilen talimatların özü:

- Biçim korunacak; aynı **bold, altı çizili, italik** ifadeler görülecek.
- Tabloların puntoları orijinal dokümanla aynı olacak.
- Mühür, logo, kaşe, imza **köşeli parantez** ile verilecek.
- Çıktı `.docx`, kaynak dokümanla **aynı isimde**.
- Firma logosu silinmeyecek.
- Bazen tek girdiden birden fazla çıktı dosyası (her ürün için ayrı `.docx`).

Bu gereksinimler tasarıma doğrudan girdi oldu.

### 2.5 Tespit edilen tuzak

Kimyasal adlarda da köşeli parantez kullanılıyor: `[1-(ethoxyimino)butyl]`, `[2,3-b]`,
`[1,2,4]`. Sistem bunları yer tutucu sanarsa madde adını bozar — resmi evrakta kabul
edilemez. QA katmanında ayrı kural gerekir.

---

## 3. Alınan kararlar

| # | Karar | Gerekçe |
|---|---|---|
| 1 | **Segment bazlı inceleme.** Çevirmen cümle cümle görür, düzeltir, onaylar. | Resmi evrakta denetim şart. Ayrıca düzeltmelerin TM'e geri yazılmasının tek yolu bu — "bir daha unutmama" buradan geliyor. |
| 2 | **Belge AI + ayrı çeviri.** Düzen/OCR ayrı servis, çeviri ayrı adım. Sağlayıcı adaptör arkasında; seçim Faz 1'de ölçümle yapılır (bkz. 6.5). | Modelin aynı anda hem okuyup hem çevirmesi, okuyamadığı yeri makul görünen bir şeyle doldurmasına yol açar. Bu hata türünün fark edilmesi çok zordur. |
| 3 | **Kademeli çeviri.** TM ≥%95 doğrudan, %75-95 öneri+doğrulama, <%75 çok motor + hakem. | 136k segmentlik alan içi TM var; tekrar eden işlerde isabet yüksek olacak. Çok motor gerçekten yeni cümlelerde devreye girer. |
| 4 | **Katmanlı terminoloji:** genel → sektör → müşteri, çakışmada müşteri kazanır. | Hem sektör ortaklığı hem müşteriye özel tercih korunur. |
| 5 | **Hibrit çıktı, aşamalı.** Önce yapıdan üretim (evrensel), sonra sık tiplere şablon. | Doğrudan şablona gidilirse tek seferlik belgeler sistemi kullanamaz; hiç şablon yapılmazsa hacmin yarısında bugünkü kalitenin altında kalınır. |
| 6 | **Ayrı Supabase projesi.** | Müşteri belgeleri ve gizli reçeteler blog üretiminden tamamen izole. Bir taraftaki anahtar sızıntısı diğerine erişim vermez. |

### Kurucu ilkeler

**İlke 1 — Çeviri motoru belgeyi asla yeniden yazmaz.** Motora segment girer, segment
çıkar. Belgenin yapısını kod kurar. Belge ne kadar uzarsa uzasın kalite düşmez, çünkü
model hiçbir zaman belgenin tamamını yeniden üretmez.

**İlke 2 — Her segment izlenebilir.** Hangi kaynaktan geldi (TM mi, hangi motor mu),
hangi terim kuralı uygulandı, hangi adaylar elendi, kim onayladı, ne zaman. Altı ay sonra
"bu cümle neden böyle çevrildi" sorusunun cevabı kayıtta durur.

---

## 4. Boru hattı

```
 YÜKLE  (taranmış PDF | DOCX | görsel)
   │
 [1] Alım          dosya hash'i → daha önce çevrildiyse önceki işi göster
   │               PDF → sayfa görselleri | DOCX → OCR atlanır, doğrudan ayrıştırılır
   │
 [2] Düzen + OCR   Belge AI sağlayıcısı (adaptör arkasında, bkz. 6.5):
   │               bloklar, tablo hücreleri (satır/sütun), okuma sırası,
   │               koordinat, güven skoru
   │
 [3] Belge modeli  Block[] = heading | paragraph | table | image | placeholder
   │               her blok → Segment[]   + stil (bold/italik/altı çizili/punto)
   │
 [4] Koruma        korunacak aralıklar işaretlenir (sayı, tarih, CAS, ürün kodu,
   │               kimyasal ad, tüzel kişi adı, adres, telefon, e-posta, URL)
   │               mühür/imza/kaşe bölgeleri → yer tutucu
   │
 [5] KADEMELİ ÇEVİRİ
   │    TM ≥ %95  ──────────────→ doğrudan kullan (motor çağrılmaz)
   │    TM %75-95 ──────────────→ öneri + tek motor doğrular
   │    TM < %75  ──┬─ DeepL ────┐
   │                ├─ Gemini ───┼→ HAKEM → seçim + tüm adaylar saklanır
   │                └─ OpenAI ───┘
   │    her durumda: zorunlu terimler, yasaklı terimler, müşteri kuralları enjekte
   │
 [6] QA            terim uyumu · korunan aralık bütünlüğü · tablo boyutu
   │               eksik segment · köşeli parantez tuzağı · OCR güven · motor ayrışması
   │
 [7] İNCELEME      solda kaynak görsel, sağda segment tablosu
   │               TM % · kaynak motor · terim uyarısı · QA bayrağı → düzelt → onayla
   │
 [8] ÜRETİM        yapıdan DOCX (şablon varsa şablondan)
   │               logolar orijinalden kopyalanır · kaynakla aynı dosya adı
   │
 [9] GERİ BESLEME  onaylanan segmentler TM'e (müşteri+sektör etiketiyle)
                   tekrarlayan düzeltmeler → kural ADAYI → insan onayıyla kalıcı kural
```

### Mevcut projeyle uyum

`lib/jobs.ts` ve `lib/job-pipeline.ts` içinde kuyruk, lease, heartbeat ve checkpoint
deseni hazır; Railway'de `ttaa-worker` servisi çalışıyor. Belge çevirisi uzun süren bir iş,
aynı desene oturuyor. Yeni altyapı kurulmayacak, var olan kullanılacak.

---

## 5. Veri modeli

Mevcut proje deseni izlenir: `supabase/migrations/` altında ham SQL, `public.` şeması,
`uuid` birincil anahtar + `gen_random_uuid()`, `timestamptz`, `jsonb`, check kısıtları,
RLS açık ve `anon`/`authenticated` rollerinden tamamen revoke — tüm erişim sunucudan
service-role ile.

### 5.1 Kapsam

```sql
sectors    id, name, slug, parent_id (nullable), created_at
clients    id, name, slug, default_sector_id, notes, created_at
```

Terim ve kurallar `scope_type` (`global` | `sector` | `client`) + `scope_id` taşır.
Çözümleme sırası: `client` > `sector` > `global`.

### 5.2 Terminoloji

```sql
term_concepts
  id, scope_type, scope_id, domain, subdomain, definition,
  created_at, created_by

term_variants
  id, concept_id, lang, text, normalized,
  is_preferred bool, is_forbidden bool,
  notes, example, created_at
```

Kavram/karşılık ayrımı xlsx yapısını birebir taşır (bir satır = bir kavram, sütunlar =
diller). `is_forbidden` dil bazında çalışır: "bu kavramın Türkçe karşılığı X'tir, Y asla
kullanılmaz".

### 5.3 Çeviri belleği

```sql
tm_segments
  id, source_lang, target_lang,
  source_text, target_text,
  source_hash,          -- birebir eşleşme (normalize edilmiş metnin hash'i)
  target_hash,          -- tekilleştirme anahtarının parçası
  source_normalized,    -- bulanık eşleşme (pg_trgm)
  client_id, sector_id, project_name,
  origin   ('tmx-import' | 'human-approved' | 'engine'),
  quality  ('approved' | 'draft'),
  context_pre, context_post,
  document_id, import_id,
  created_at, created_by
```

**Eşleşme:** birebir için `source_hash` üzerinde btree; bulanık için `source_normalized`
üzerinde `pg_trgm` GIN indeksi. Trigram benzerliği deterministiktir — aynı cümle her zaman
aynı sonucu verir; CAT araçlarının standart yöntemi.

**Normalizasyon:** küçük harfe çevirme Türkçe farkındalıklı olmalı (`İ`→`i`, `I`→`ı`).
Postgres `lower()` bunu doğru yapmaz; normalizasyon uygulama katmanında yapılıp
`source_normalized` olarak yazılır.

**Tekilleştirme:** anahtar `(source_lang, target_lang, source_hash, target_hash)`.
Tekrarlar birleşir, `project_name` etiketleri toplanır, en eski `created_at` korunur.
`origin = 'human-approved'` olan kayıt `tmx-import` olana üstün gelir.

### 5.4 Kurallar

```sql
rules
  id, scope_type, scope_id,
  kind ('instruction' | 'find-replace' | 'style'),
  source_lang, target_lang,
  pattern, instruction, enabled bool,
  origin ('manual' | 'suggested-from-corrections'),
  approved_by, approved_at, hit_count,
  created_at

rule_candidates
  id, scope_type, scope_id, suggestion,
  evidence jsonb,        -- hangi segment düzeltmelerinden çıkarıldı
  occurrences int,
  status ('pending' | 'accepted' | 'rejected'),
  created_at, decided_by, decided_at
```

Sistem düzeltmelerden örüntü çıkarır ama **kendi kendine kural yazmaz**. Aday olarak sunar;
insan onaylarsa `rules`'a geçer. `hit_count` hangi kuralın işe yaradığını gösterir.

### 5.5 Belgeler

```sql
documents
  id, client_id, sector_id,
  source_filename, source_hash, source_mime, storage_path,
  source_lang, target_langs text[],
  doc_type, page_count,
  status ('uploaded'|'analyzing'|'translating'|'review'|'approved'|'delivered'|'failed'),
  layout jsonb, created_at, created_by

document_blocks
  id, document_id, order_index,
  kind ('heading'|'paragraph'|'table'|'image'|'placeholder'),
  parent_block_id, row_index, col_index,     -- tablo hücreleri
  style jsonb, bbox jsonb, page_no, ocr_confidence numeric

segments
  id, document_id, block_id, order_index, target_lang,
  source_text, protected_spans jsonb,
  proposed_text, final_text,
  source_kind ('tm-exact'|'tm-fuzzy'|'engine-arbiter'|'human'),
  tm_match_id, tm_match_score numeric,
  engine_results jsonb,      -- üç motorun çıktısı + hakem gerekçesi, denetim için
  qa_flags jsonb,
  status ('pending'|'proposed'|'edited'|'approved'),
  reviewed_by, reviewed_at
```

`documents.source_hash` aynı belgenin tekrar yüklenmesini yakalar.
`engine_results` kalıcıdır; denetlenebilirliğin taşıyıcısıdır.

### 5.6 Referans ve şablon

```sql
reference_documents   id, client_id, sector_id, title, lang_pair,
                      kind ('aligned-pair'|'single'), storage_path, created_at
reference_chunks      id, reference_document_id, text, embedding vector, metadata jsonb
doc_templates         id, client_id, doc_type, name, storage_path,
                      field_map jsonb, enabled bool
```

**Bilinçli ayrım:** TM eşleşmesi `pg_trgm`, referans arama `pgvector`. İkisi farklı iş
yapar. TM "bu cümleyi daha önce çevirdik mi" sorusuna deterministik cevap verir; referans
RAG "bu tür belgeyi nasıl ele alıyoruz" sorusuna anlamsal cevap verir. BASF arşivindeki
33 hizalı EN/TR çifti `reference_documents`'a girer.

### 5.7 Kayıt

```sql
imports             id, kind ('tmx'|'termbase-xlsx'|'reference-archive'),
                    filename, file_hash, stats jsonb, status, created_at
translation_jobs    content_jobs ile aynı desen:
                    status, stage, progress, brief, checkpoint, result, error,
                    stage_attempts, lease_owner, lease_expires_at, cancel_requested
```

`translation_jobs` ayrı tablodur. `content_jobs` blog üretimine özgüdür (`brand` kısıtı,
içerik `brief`'i) ve worker mantığı ona göre yazılmıştır. Ayrı tablo sınırları temiz tutar;
aynı worker süreci iki kuyruğu da işleyebilir.

---

## 6. Motor katmanı

### 6.1 Kademe eşikleri

**Eşleşme skoru tanımı:** birebir eşleşme (`source_hash` aynı) %100 sayılır. Bunun
dışındaki skor, `source_normalized` üzerinde `pg_trgm` trigram benzerliğidir
(`similarity()`, 0–1 aralığı yüzdeye çevrilir). Tek ölçü kullanılır; arayüzde gösterilen
yüzde ile kademe kararında kullanılan yüzde aynıdır.

Eşikler yapılandırılabilir; başlangıç değerleri:

| Durum | Davranış |
|---|---|
| TM eşleşme ≥ %95 | Doğrudan kullan. Motor çağrılmaz. `source_kind = 'tm-exact'` |
| TM eşleşme %75–95 | TM önerisi gösterilir, tek motor doğrular. Farklıysa QA bayrağı |
| TM eşleşme < %75 | DeepL ∥ Gemini ∥ OpenAI paralel → hakem |

Aynı belge içindeki tekrarlar ilk çeviriden sonra otomatik %100 eşleşir. (DELAN SC
örneğinde adres bloğu üç kez geçiyor — bir kez çevrilir, üçü de birebir aynı olur.)

### 6.2 Hakem

Hakem serbest değil, kısıtlıdır.

**Sıra önemlidir:** yasaklı terim içeren aday hakem görmeden elenir. Hiçbir aday kalmazsa
segment "insan gerekli" olarak işaretlenir.

**Girdi:** kaynak cümle, kalan adaylar, TM komşuları, zorunlu/yasaklı terimler, geçerli
müşteri kuralları, belge tipi.
**Çıktı:** seçilen aday + gerekçe (kayda yazılır).

Hakem "hangisi daha akıcı" diye değil, "hangisi kurallara uyuyor ve TM ile tutarlı" diye
seçer.

### 6.3 Korunan aralıklar

Çeviriden muaf tutulan ve çeviri sonrası **yeniden doğrulanan** parçalar:

sayılar ve birimler · tarihler · CAS numaraları · ürün/ruhsat kodları (`BAS 216 17 F`) ·
kimyasal adlar · tüzel kişi adları · kişi adları · adresler · telefon/faks · e-posta · URL

Kaynakta ne varsa hedefte de aynı olmalıdır. Değilse segment otomatik kırmızı işaretlenir
ve onaylanamaz.

### 6.4 QA kuralları

| Kural | Kontrol |
|---|---|
| Zorunlu terim | Geçerli katmandaki tercih edilen karşılık kullanıldı mı |
| Yasaklı terim | `is_forbidden` işaretli karşılık hedefte geçiyor mu |
| Korunan aralık | Kaynaktaki sayı/kod/ad hedefte birebir var mı |
| Tablo bütünlüğü | Hedef tablo satır ve sütun sayısı kaynakla aynı mı |
| Eksik segment | Boş veya çevrilmemiş segment var mı |
| Köşeli parantez tuzağı | `[2,3-b]` gibi kimyasal ad yer tutucu sanılmış mı |
| OCR güveni | Düşük güvenli bölgeden gelen segment |
| Motor ayrışması | Üç motor birbirinden belirgin ayrıştı mı |

### 6.5 OCR / belge AI sağlayıcısı

**Sağlayıcı adaptör arkasındadır.** `[2]` adımı ne kullanırsa kullansın `[3]`'e kendi
`DocModel`'imizi verir. Sağlayıcı değişirse yalnızca adaptör değişir; segmentasyon,
koruma, çeviri, QA ve üretim katmanları etkilenmez. Bu nedenle seçim tasarımı bloke
etmez ve geri alınabilir.

**Gereksinimler:** tablo hücre yapısı (satır/sütun), koordinat kutuları (inceleme
ekranında kaynak bölgeyi vurgulamak için), güven skoru, Türkçe + İngilizce desteği.

**Adaylar (Eylül 2026 fiyatları):**

| Sağlayıcı | Birim | Tablo yapısı | Koordinat | Not |
|---|---|---|---|---|
| Mistral OCR 3 | $2 / 1.000 sayfa | HTML/Markdown (`table_format`) | `include_blocks=True` | En ucuz, kayıt basit, daha az sahada denenmiş |
| Azure DI **Layout** | $10 / 1.000 sayfa | Hücre bazlı | Var | Kurumsal standart, resmi belgede en çok test edilmiş |
| Google Document AI Layout Parser | $10 / 1.000 sayfa | Var | Var | Yeni müşteriye 90 gün $300 kredi |
| Gemini / OpenAI vision | Mevcut kotalar | Yapılandırılmış çıktı ile | Zayıf | Yeni hesap gerektirmez, tablo güvenilirliği düşük |

**Not:** Azure'un $1,50/1.000 sayfa fiyatı **Read** modelidir ve tablo yapısı vermez.
Bu projenin ihtiyacı **Layout** modelidir: $10/1.000 sayfa.

**Azure F0 ücretsiz katmanı bu iş için uygun değildir.** 500 sayfa/ay verir ama her
belgenin yalnızca ilk 2 sayfasını işler ve dosya boyutunu 4 MB ile sınırlar. BASF arşivi
üzerinde ölçüm: 81 okunabilir PDF'in 66'sı (%81) sorunsuz işlenir, **15'i kırpılır veya
reddedilir**. Kırpılacaklar arasında 16, 12, 11 ve 8 sayfalık belgeler var — örneğin
`Mizona_Ruhsat Devir Evrakları.pdf` (12 sayfa) iki sayfaya inerdi. On sayfalık bir ruhsat
devir evrakının iki sayfasının teslim edilmesi, bu projenin önlemek için var olduğu hata
türüdür.

**Maliyet bağlamı:** BASF arşivinin tamamı 188 sayfa. Azure Layout ile $1,88, Mistral ile
$0,38. Ayda 300 sayfalık gerçekçi bir hacimde sırasıyla ~$3 ve ~$0,60. Karar maliyet
üzerinden değil, kalite üzerinden verilmelidir.

**Seçim yöntemi — Faz 1'in ilk işi.** Arşivdeki **33 hizalı `EN.pdf` → `TR.docx` çifti**
altın standart olarak kullanılır. Adaylar aynı sayfalara uygulanır, çıktıları doğru
olduğu bilinen Türkçe teslimatla karşılaştırılır. Ölçülecekler: tablo satır/sütun
doğruluğu, ürün ve ruhsat kodlarının bozulmadan çıkması, kimyasal adların doğruluğu,
mühür/imza bölgelerinin tespiti. Karar bu ölçüme dayanır.

### 6.6 Yer tutucu standardı

Tek biçim: **büyük harf, köşeli parantez** — `[İMZA]`, `[MÜHÜR]`, `[KAŞE]`,
`[MÜHÜR/KAŞE]`, `[LOGO]`, `[BARKOD]`. Açıklayıcı varyantlar serbest metin olarak korunur
(`[KIRMIZI MÜHÜR]`). İçe aktarmada mevcut küçük harfli kullanımlar normalize edilir.

---

## 7. Arayüz

`/ceviri-app` üç ekran:

**Yükle.** Dosya bırak, müşteri + sektör seç (sistem tahmin eder, insan onaylar), hedef
dil(ler) seç. Kaynak dil otomatik tespit edilir, değiştirilebilir.

**İşler.** Süren ve biten işler, durum ve ilerleme. Mevcut `use-content-job.ts` deseni
yeniden kullanılır.

**İnceleme.** Solda taranmış sayfa görüntüsü (segment tıklanınca ilgili bölge vurgulanır),
sağda segment tablosu. Her satırda: kaynak, çeviri, TM yüzdesi, kaynak motor, terim
uyarıları, QA bayrakları. Alternatif adaylar istendiğinde açılır.

Klavye odaklı: onayla-ve-sonraki tek tuş. CAT araçlarında hız buradan gelir.

ChatGPT sadeliği kabukta tutulur; segment tablosu yalnızca inceleme ekranında görünür.

---

## 8. Fazlar

Her faz kendi planı ve kendi uygulama döngüsüyle ilerler.

| Faz | Kapsam | Teslim |
|---|---|---|
| **0** | Ayrı Supabase projesi, şema, TMX + terminoloji içe aktarma, tekilleştirme, TM/terim arama | Terim ve cümle sorgulanabilir. Çeviri yok. |
| **1** | OCR sağlayıcı karşılaştırması (33 altın çift üzerinde, bkz. 6.5) → seçim. Ardından uçtan uca EN→TR: yükle → OCR → belge modeli → koruma → TM+terim destekli tek motor (**OpenAI**, anahtarı mevcut) → inceleme ekranı → DOCX üretimi | Gerçek iş yapılabilir |
| **2** | Üç motor paralel, hakem, tam QA kuralları, motor ayrışma bayrakları | "En uygun seçeneği seçen" sistem tamam |
| **3** | Diğer dil çiftleri, belge tipi şablonları, kural adayı çıkarımı ve onay akışı, referans RAG | Tam sistem |

Faz 0 önce gelir çünkü bilgi tabanı olmadan Faz 1 tahmin üretir.

---

## 9. Bekleyen girdiler

Tasarım kararları tamamdır. Aşağıdakiler veri ve erişim eksikleridir; Faz 0/1'i başlatmak
için gerekir.

**Hesaplar:**

| Ne | Nereden | Maliyet |
|---|---|---|
| Yeni Supabase projesi | supabase.com | Ücretsiz katman yeterli |
| OCR sağlayıcı hesabı (Mistral / Azure / Google) | bkz. 6.5 | Ayda ~$0,60–3 gerçekçi hacimde |
| DeepL API anahtarı | deepl.com/pro-api | Free 500k karakter/ay |
| Gemini API anahtarı | aistudio.google.com | Ücretsiz kota |
| OpenAI | mevcut | — |

**Faz sırasına göre engelleyicilik:**

| Faz | Gerekenler |
|---|---|
| **0** | Yalnızca ücretsiz Supabase projesi. Başka hiçbir hesap gerekmez. |
| **1** | Ek olarak bir OCR sağlayıcı hesabı. Çeviri motoru olarak mevcut OpenAI anahtarı kullanılır. |
| **2** | Ek olarak DeepL ve Gemini anahtarları. |
| **3** | Yeni hesap gerekmez. |

Faz 0 hiçbir ödeme hesabı gerektirmediği için, OCR sağlayıcı kararı beklenmeden
başlatılabilir.

> **Not (19 Eylül 2026):** Azure ücretsiz hesap başvurusu "not eligible" ile
> sonuçlandı. Bu yalnızca $200'lük promosyon kredisinin kaybı anlamına gelir; pay-as-you-go
> kaydı mümkündür. Karar yine de Faz 1'deki ölçüme bırakılmıştır.

**Veri:**

1. NASE ve NASE İLAÇLAR referans arşivleri (yalnızca BASF teslim edildi).
2. Dört terminoloji xlsx'inin müşteri/sektör eşleşmesi — katmanlı model bunsuz kurulamaz.
3. Başka TMX veya terminoloji dosyası olup olmadığı.

**Kararlar:**

4. Kullanıcı sayısı. Mevcut uygulama tek `ADMIN_EMAIL` ile çalışıyor; birden fazla
   çevirmen olacaksa kullanıcı yönetimi Faz 1 kapsamına girer.
5. Gizlilik onayı: gizli reçete niteliğindeki belgeler Azure ve DeepL'e de gidecek
   (bugün OpenAI'a zaten gidiyor).

---

## 10. Riskler

| Risk | Etki | Karşılık |
|---|---|---|
| OCR taranmış belgede hata yapar | Yanlış çeviri kaynağa işler | Düşük güven bölgeleri QA bayrağı; segment incelemesinde kaynak görüntü yanında |
| Tablo yapısı yanlış çıkarılır | Satır/sütun kayması, resmi evrakta ciddi hata | Tablo boyutu QA kuralı; inceleme ekranında tablo görsel olarak karşılaştırılır |
| Kimyasal ad yer tutucu sanılır | Madde adı bozulur | Özel QA kuralı; kimyasal ad korunan aralık listesinde |
| TM'de hatalı eski çeviri var | Hata tekrar eder ve yayılır | `origin` ayrımı; insan onaylı kayıt üstün; TM kaydı inceleme ekranından düzeltilebilir |
| Motor sağlayıcı kesintisi | İş durur | Kademeli yapı zaten TM öncelikli; motorlardan biri düşerse kalanla devam |
| Üç TMX arşivinin çelişen kayıtları | Eşleşme skorları bozulur | Tekilleştirme anahtarı ve öncelik kuralı (bkz. 5.3) |

---

## 11. Kapsam dışı

- Makine çevirisi modeli eğitimi veya ince ayar.
- Gerçek zamanlı çoklu kullanıcı eş zamanlı düzenleme.
- Müşteriye dönük self-servis portal.
- Fatura/muhasebe entegrasyonu.
- PDF çıktı (çıktı biçimi `.docx`).
