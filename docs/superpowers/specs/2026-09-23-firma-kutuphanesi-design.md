# Firma kütüphanesi ve firmaya göre çeviri — tasarım

Tarih: 23 Eylül 2026 · Durum: onaylandı (kullanıcı, sohbet içinde) · Üst belge:
`2026-09-19-ceviri-app-design.md` (bölüm 5.1 kapsam modeli, bölüm 9 madde 2).

## 1. Amaç

Aynı terim farklı firmalar için farklı çevrilir. Bir BASF belgesi BASF'nin terimleri ve
geçmiş çevirileriyle, bir Nase belgesi Nase'ninkilerle çevrilmeli. Bunun için:

1. Her firmanın bir **kütüphanesi** olur: terimce, çeviri belleği, referans çeviri
   çiftleri, firma talimatları.
2. Belge yüklenirken **firma seçilir**; sistem firmayı belgeden **kendisi tahmin eder**,
   kullanıcı onaylar ya da değiştirir.
3. Çeviri, **firma → üretici → sektör → genel** sırasıyla beslenir.
4. Sistem **öğrenir**: referans çiftlerinden terim çıkarır, inceleme ekranındaki
   düzeltmelerden firmaya özel terim önerir.

## 2. Ölçülen durum (23 Eylül 2026)

**Veritabanı** (Supabase `bmtmqywcrkxahxofrnib`):

| Tablo | Satır | Not |
|---|---|---|
| `tm_segments` | 73.623 | hepsi `client_id = null`, `origin = tmx-import` |
| `term_concepts` | 525 | hepsi `global` |
| `clients` | 3 | `basf`, `syngenta`, `nase` — boş |
| `sectors` | 1 | `zirai-ilac` |
| `ceviri_documents` | 9 | firma sütunu yok |

`search_tm` sıralaması `score desc` ile başlar; firma eşleşmesi yalnızca skorlar birebir
eşitse devreye girer. Firmanın %95 benzer cümlesi başka firmanın %100 cümlesine hep
kaybeder. `lookup_terms` tek bir `p_client_id` alır.

**Eski arşivin firma taraması** (38 TMX, 742 proje, ~100 bin tekil cümle; tarama betikleri
oturumun scratchpad'inde, sonuçlar `firma-gruplari.tsv`, `belirsiz-siniflandirma.tsv`):

| Grup | Proje | ≈ Cümle | Bulunma yolu |
|---|---|---|---|
| Syngenta | 157 | 30.500 | proje adı (`syngenta…`, `syn…`, `syng…`), metin, parmak izi |
| Nase | 174 | 24.800 | proje adı, ortak cümle |
| Bayer | 69 | 7.100 | metin (`Bayer CropScience`, `Bayer Türk Kimya`…) |
| BASF | 40 | 4.500 | proje adı, metin |
| SQM | 12 | 1.800 | metin, ortak cümle (Yunanca projeler) |
| Diğer üreticiler | ~20 | 6.300 | Novozymes, Yara, Globachem… |
| Genel (kişisel belge) | 251 | 18.900 | banka/bordro, diploma, kimlik, tıbbi, adli |
| Onaya kalan | 18 | 2.700 | iki firma izi ya da çok zayıf iz |

**Bulgu — müşteri ile üretici ayrı şeylerdir.** Nase adlı projelerin metninde en çok
Bayer (1.959) ve Syngenta (533) geçiyor; Nase zip'lerindeki 23 Word dosyasının 23'ünde
Syngenta ürünleri var. Nase bir dağıtıcı. Belgedeki üretici adı, işi getiren müşteriyi
göstermez. Bu yüzden belgede iki ayrı firma alanı tutulur: **müşteri** ve **üretici**.

**Belge zip'leri:** `BASF ARŞİV.zip` 43 docx'in 42'si BASF. `arşiv.zip` 243 docx'in
242'si firmasız kişisel belge (diploma, pasaport, banka…) — genel kütüphaneye, belge
türüyle girer.

**Dağıtımdan sonra (24 Eylül 2026, canlı veritabanı):**

| Firma | Bellek satırı | Adın güvenilirliği (`name_weight`) | Terim önerisi |
|---|---|---|---|
| Syngenta | 22.353 | 0,767 | 121 |
| Nase | 12.157 | 1,000 | 91 |
| Bayer | 3.316 | 0,355 | 72 |
| BASF | 2.942 | 0,931 | 131 |
| Yara | 2.095 | 1,000 | 117 |
| Novozymes | 1.992 | 0,778 | 133 |
| SQM | 1.340 | 1,000 | 0 |
| Globachem | 1.103 | 0,667 | 0 |
| Genel (`client_id = null`) | 26.325 | — | — |

Karar bekleyen proje 21, parmak izi 882 satır (710 belge/projeden). SQM ve Globachem
belleği en-US→tr-TR dışında (Yunanca vb.) olduğundan varsayılan dil çiftinde öneri
çıkmaz; firma sayfasında dil çifti seçilerek çıkarılır.

## 3. Kavramlar

- **Firma**: `clients` satırı. Hem müşteri hem üretici aynı tabloda; bir firma
  (ör. Syngenta) bir belgede müşteri, başka bir belgede üretici olabilir.
- **Müşteri** (`ceviri_documents.client_id`): işi getiren. Terimce önceliği en yüksek.
- **Üretici** (`ceviri_documents.maker_id`): belgede ürünü/ruhsatı geçen firma; müşteriyle
  aynıysa boş kalır.
- **Kapsam zinciri** bir belge için: `[müşteri, üretici, sektör, genel]`. Sektör,
  müşterinin (yoksa üreticinin) `default_sector_id`'si.
- **Genel kütüphane**: firmasız veri (`client_id is null`, `scope_type = 'global'`).
  Her firma için son yedektir.

## 4. Veri modeli (yeni migration, `supabase/ceviri/migrations/`)

```sql
-- Firma ayrıntıları
alter table public.clients
  add column aliases text[] not null default '{}',     -- "Bayer Türk Kimya", "syn", "BAS"
  add column instructions text,                          -- firma talimatları (prompt'a girer)
  add column updated_at timestamptz not null default now();

-- Belgenin firması ve tespitin gerekçesi
alter table public.ceviri_documents
  add column client_id uuid references public.clients(id) on delete set null,
  add column maker_id  uuid references public.clients(id) on delete set null,
  add column detection jsonb;   -- { decision, candidates:[{client_id, score, reasons[]}], at }

-- Bellek kökeni: referans çiftinden hizalanmış cümle
alter table public.tm_segments drop constraint tm_segments_origin_check;
alter table public.tm_segments add constraint tm_segments_origin_check
  check (origin in ('tmx-import', 'human-approved', 'engine', 'reference'));
create index if not exists tm_segments_client_idx on public.tm_segments (client_id);

-- Proje adı → firma eşlemesi (eski arşivin dağıtımı ve yeni TMX içe aktarımı)
create table public.project_clients (
  project_name text primary key,
  client_id uuid references public.clients(id) on delete cascade,  -- null: bilinçli olarak genel
  decided_by text not null check (decided_by in ('name', 'text', 'fingerprint', 'user')),
  pending boolean not null default false,                  -- kullanıcı kararı bekliyor
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Firma parmak izi: firmayı ayırt eden özel adlar ve kodlar
create table public.client_signatures (
  client_id uuid not null references public.clients(id) on delete cascade,
  token text not null,          -- katlanmış biçim (bkz. 5.2)
  weight real not null,         -- firmadaki yoğunluk (0–1)
  rows int not null,
  primary key (client_id, token)
);

-- Terim önerileri (öğrenme)
create table public.term_suggestions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source_lang text not null, target_lang text not null,
  source_text text not null, target_text text not null,
  kind text not null check (kind in ('extracted', 'edit', 'conflict')),
  score real not null,
  evidence jsonb not null default '[]'::jsonb,   -- örnek cümle çiftleri
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  unique (client_id, source_lang, target_lang, source_text, target_text)
);
```

Yeni tablolarda RLS açık, `anon`/`authenticated` revoke (mevcut desen).

`tm_segments` tekillik anahtarı `(source_lang, target_lang, source_hash, target_hash)`
aynen kalır. Aynı cümle çiftini iki firma kullanıyorsa çeviri zaten aynıdır; satır
`client_id = null` (ortak) olur. Firmanın **farklı** çevirisi farklı `target_hash`
demektir ve kendi `client_id`'siyle ayrı satırdır — önemli olan tam da budur.

Uygulamada eklenen iki migration:
- `202609230002_apply_project_clients_by_name.sql` — `preview_project_clients(p_names)` ve
  `apply_project_clients(p_names)`: dağıtım proje adı listesiyle parça parça yapılır
  (73 bin satırı tek çağrıda güncellemek PostgREST'in deyim süre sınırına takıldı);
  yalnız `origin = tmx-import` satırlarına dokunur, `lingua-düzeltme` adı yok sayılır.
  Yalnız service-role çağırabilir.
- `202609230003_client_name_weight.sql` — `clients.name_weight real not null default 1`
  (5.2'deki adın güvenilirliği).

Düzeltmenin (`human-approved`) bellek satırı yeni cümle çiftiyse belgenin
`client_id`'siyle yazılır; aynı çift bellekte zaten varsa (`upsert_tm_segments`
çakışmada yalnız proje adlarını birleştirir) firması ve kökeni değişmez: ortak satır
ortak kalır, tek bir firmanın düzeltmesiyle o firmaya bonus kazandırmaz. (Firma
satırları başka firmalardan gizlenmez; aramada yalnız kendi zincirindeki firmaya
bonus alır.)

## 5. Algoritmalar

### 5.1 Kapsam zinciriyle arama

`search_tm` ve `lookup_terms` tek `p_client_id` yerine sıralı `p_client_ids uuid[]`
(müşteri, üretici) alır; eski imza yeni fonksiyona yönlenir.

**Bellek:** sıralama, ham benzerliğe kapsam payı eklenmiş **düzeltilmiş skorla** yapılır:

```
adjusted = score + 0.06·[müşteri] + 0.04·[üretici] + 0.02·[sektör] + 0.03·[human-approved|reference]
```

Kullanım kararı (birebir yeniden kullan / motora örnek ver) yine **ham skorla** verilir;
pay yalnızca sırayı değiştirir. Böylece müşterinin %95'lik cümlesi başka firmanın
%100'lük cümlesinin önüne geçer ama %95'lik cümle %100 sayılmaz.

**Terimler:** her kavram için hedef, zincirde en üstteki kapsamdan alınır. Aynı kaynak
ifade için müşteri "ruhsat", genel "tescil" diyorsa "ruhsat" zorunlu terim olur ve
prompt'ta "tescil değil" diye açıkça yazılır (firma farkı korunur). "tescil" kalite
kontrolünde yasaklı sayılmaz: aynı kelime cümlenin başka bir yerinde başka anlamda doğru
olabilir; zorunlu terimin kullanılıp kullanılmadığı zaten denetleniyor. Zincirdeki
herhangi bir kapsamın yasakladığı karşılık, daha üst kapsam onu tercih etmedikçe yasaklı
kalır.

**Prompt:** zorunlu terimler kapsam etiketiyle yazılır; firma talimatları
(`clients.instructions`) belge talimatlarından önce, "firma kuralı" başlığıyla eklenir.

### 5.2 Firma tespiti

Belge parçalandıktan sonra (OCR/docx) çalışır; çeviriden önce. Her firma `f` için üç
ipucu:

1. **Ad** — `f.name` ve `f.aliases` belgede kelime sınırıyla aranır.
   `n_ad = min(eşleşme, 3)`.
2. **Parmak izi** — belgenin katlanmış kelimeleri `client_signatures` ile kesiştirilir.
   `n_iz = min(Σ weight, 10)`.
3. **Bellek örtüşmesi** — belgenin ≥30 karakterlik cümlelerinin `source_hash`'leri,
   `client_id = f` olan bellek satırlarında aranır. `n_bellek = min(eşleşen cümle, 15)`.

```
puan(f) = 3·w_ad(f)·n_ad + 1·n_iz + 2·n_bellek
```

`w_ad(f)` adın müşteri göstergesi olarak güvenilirliğidir: firması bilinen belgelerde
adı geçen firmanın gerçekten müşteri olma oranı, Laplace düzeltmesiyle
`(doğru + 1) / (toplam + 2)`. Parmak izi her yeniden kurulduğunda `clients.name_weight`'e
yazılır. Bayer'in adı çok belgede geçer ama iş çoğu zaman Nase'den gelir: 0,355.

- **Müşteri** = en yüksek puan. Karar (eşikler 5.2 "Ölçüm"de seçildi, `DETECTION`):
  - `puan ≥ 20`, ikincinin ≥ 2 katı **ve** en az bir cümle firmanın belleğinde →
    **otomatik** (seçili gelir, gerekçe gösterilir). Bellek örtüşmesi olmadan yalnız ad
    ve iz otomatik karar için yetmez,
  - `puan ≥ 3` ve ikincinin ≥ 1,5 katı → **öneri** (seçili gelir, "emin değilim" işaretli),
  - aksi hâlde → **sor** (çeviri başlamadan kullanıcıya sorulur; "Genel" seçeneği var).
- **Üretici** = müşteri dışındaki firmalardan en çok **ad** eşleşmesi olan (≥ 2).
  Kullanıcı müşteriyi elle seçtiğinde de üretici belgeden bulunur.
- Gerekçeler kaydedilir: "BAS 703 07 F (iz)", "14 cümle BASF belleğinde", "Syngenta ×5 (ad)".

**Katlama:** küçük harf, `İ`'nin birleşik noktası (U+0307) atılır, `ı → i`. Taramada
büyük harfli Türkçe başlıklar ("GEREKLİLİK", "DEPOLANMASI") aksi hâlde özel ad sanılıyordu.

**Parmak izinin kurulması** (`client_signatures`, kütüphane değiştikçe yeniden):
- Aday: 4+ harfli kelime ya da kod (`BAS 703 07 F`, `A20570A`, `RP-0420`).
- **Özel ad şartı:** kelimenin cümle ortasındaki geçişlerinin ≥ %80'i büyük harfle
  (en az 2 geçiş) ya da kelime rakam içeren kod. Cümle başındaki geçişler paydaya
  girmez: orada her kelime büyük harfle başlar ve oran hiçbir şey söylemez. "workplace", "patient" gibi sıradan kelimeler böylece elenir (taramada
  elenmeyince tıbbi bir epikriz Syngenta'ya atanmıştı).
- **Yoğunluk:** firmalı satırlardaki geçişlerinin ≥ %90'ı tek firmada, en az 3 satırda,
  toplamda ≤ 25 belge/projede. `weight` = yoğunluk.

**Kalibrasyon ve kabul ölçütü:** eşikler eski arşivde, adı belli projelerle bir-proje-dışarıda
(leave-one-project-out) ölçülür: her proje parmak izinden çıkarılıp geri kalanla
sınıflandırılır. Kabul: "otomatik" kararların **≥ %95'i doğru**, "sor"a düşen oran
≤ %30. Ölçüm betiği `scripts/ceviri-eval-detection.ts` olarak repoya girer.

**Ölçüm (24 Eylül 2026).** Bir-proje-dışarıda yerine 5 katlı çapraz doğrulama
kullanıldı (parmak izi, "firmanın uzun cümleleri" ve adın güvenilirliği her katta
yalnız eğitim parçasından öğrenilir; proje adı kullanılmaz):

| Etiket kümesi | Proje | Otomatik | Otomatik doğruluk | Öneri (doğruluk) | Sor |
|---|---|---|---|---|---|
| Proje adından (güçlü) | 217 | %31,8 | **%95,7** | %40,6 (%78,4) | **%27,6** |
| Bütün etiketler | 435 | %36,3 | %85,4 | %42,3 (%77,7) | %21,4 |

Kabul ölçütü güçlü etiketlerde sağlanıyor. Bütün etiketlerdeki otomatik hataların
çoğu (`bayer→nase` 9) etiket gürültüsü: metinden "bayer" etiketi almış projelerin bir
kısmı aslında Nase'nin Bayer ürünü işleri. Yol: ilk sürüm (ad ağırlığı yok, eşik 6/2)
%79,9 → adın güvenilirliği öğrenilince %83,6 → otomatik için bellek örtüşmesi şartı ve
20/2 eşiği ile %95,7. Eşik taraması betiğin çıktısında; daha düşük eşikler otomatik
oranını artırırken doğruluğu %90–94'e indiriyor.

**Gerçek belgelerde:** Priaxor ambalaj formu → otomatik BASF (ad ×12, BASF'a özgü
yer adları, 18 cümle bellekte). BASF USA mektupları → BASF ön seçili öneri (bellekte
1–2 cümle). Nase'nin Previcur (Bayer ürünü) belgeleri → Bayer ön seçili öneri, Nase
ikinci aday; Nase'nin adı belgede geçmediği için metinden müşteri çıkarılamaz, kullanıcı
Nase'yi seçince üretici Bayer bulunur.

### 5.3 Eski arşivin dağıtılması

1. Tarama sonuçları `project_clients`'a yazılır (`decided_by` = name/text/fingerprint).
2. Onaya kalan 18 proje firma sayfasında "karar bekleyen projeler" listesinde gösterilir;
   kullanıcı seçer (`decided_by = user`).
3. `tm_segments.client_id` güncellenir: satırın `project_names` dizisindeki adların
   **hepsi aynı firmaya** eşleniyorsa o firma; farklı firmalar ya da eşlenmemiş ad varsa
   `null` (ortak) kalır.
4. Aynı eşleme gelecekteki TMX içe aktarımlarında da kullanılır.

Proje adında eşleme kuralları: `basf…`, `syngenta…|syn …|syng …`, `nase…`; diğerleri
tarama sonucundan. Kişisel belge türündeki (diploma, kimlik, banka, adli, tıbbi) projeler
güçlü firma izi yoksa genel kalır.

### 5.4 Referans çiftlerinin hizalanması

Girdi: kaynak dosya (PDF/görsel → mevcut OCR; docx → mevcut ayrıştırıcı) ve çevirisi
(docx). Çıktı: firmaya ait bellek satırları (`origin = reference`).

1. Her iki taraf mevcut segmentleyiciden geçer.
2. **Gale-Church dinamik programlama**, izin verilen eşleşmeler 1-1, 1-0, 0-1, 2-1, 1-2.
   Maliyet = uzunluk maliyeti (karakter oranı, dil çiftine göre ortalama/varyans eski
   bellekten ölçülür) + **çapa cezası**.
3. **Çapalar:** sayılar, tarihler, ürün/ruhsat kodları, e-posta/URL, özel adlar. Çapalar
   iki tarafta birebir aynı kalmalıdır; eşleşen çapa maliyeti düşürür, uyuşmayan yükseltir.
4. Her eşleşmenin **güveni** maliyetinden hesaplanır. Yüksek → `quality = approved`.
   Orta → yapay zekâya toplu doğrulatılır ("Bu iki cümle birbirinin çevirisi mi?").
   Düşük ya da doğrulanmayan → atılır.
5. Kütüphane sayfasında içe aktarım raporu: eşlenen / doğrulanan / atılan.

Zip yüklenirse dosyalar adlarından eşlenir: ortak kök + dil eki ya da "TR/-EN" ekleri
(`X.pdf` ↔ `X-TR.docx`, `X (it).docx`). Eşlenemeyen dosyalar raporda listelenir.

Uygulamada eklenenler: birden çok cümleyi birleştiren eşleşme hiçbir zaman "yüksek"
güvenli sayılmaz (en çok "orta", yani doğrulanır; gerçek veride "Çeviri notu" bir
cümleye yapışmıştı); anlamlı harf içermeyen ("CONTROL ↔ .") ve kişisel görünen kısa
çiftler (≤ 6 kelime; iki taraf aynı ya da ≥ 6 rakam) atılır. Dosya eşlemede kopya
sayacı `(2)` atılır, kökler tutmazsa ikinci turda kelime kapsaması (≥ %75, ≥ 2 ortak
kelime) denenir, Windows zip'lerinin CP857 dosya adları çözülür, `.doc/.rtf/.odt`
"desteklenmiyor" olarak ayrıca raporlanır. Gerçek arşivlerde eşleme: `arşiv.zip`
202/421 dosya, `BASF ARŞİV.zip` 50/127.

### 5.5 Terim çıkarma (firma başına)

Kaynak: firmanın bellek satırları (referans + onaylı + dağıtılmış eski bellek).

1. **Aday kaynak ifadeler:** 1–4 kelimelik n-gramlar, firmada ≥ 3 geçiş. Kalıp cümle
   bellekte defalarca durduğundan aynı kaynak cümle bir kez sayılır. Elenenler:
   - uçlarında işlev kelimesi ya da tek harf ("water d"); içeride yalnız "of"
     ("mode of action"), öbür işlev kelimeleri cümle parçası demek ("shall continue to
     comply", "please indicate");
   - rakamlı kelime ("30 5 at 20", suş kodu "fzb24") ve ölçü birimi ("mg ml test item");
   - 4+ harfli kelimesi olmayan ("g l");
   - satırlarının yarısında hedefte aynen geçen ifade: çevrilmeyen ad ya da kod ("BASF",
     "CIPAC MT", "Arnhem").
2. **Anahtarlık:** firma derlemine karşı genel derlem için Dunning log-olabilirlik (G²).
   G² ≥ 10,83 (p < 0,001) ve firmadaki oran genelden yüksek olanlar kalır; kendisini
   içeren daha uzun ifadeyle hep birlikte geçen alt ifade atılır.
3. **Kök:** Türkçe hedefte hâl, iyelik ve çoğul ekleri atılır (en çok üç tur, kök dört
   harfin altına inmez, yumuşayan ünsüz sertleşir: "saflığını" → "saflık"), sonra 7+
   harfli kelimenin ilk 6 harfi alınır. "partiden", "partilerin", "parti" aynı sayılır.
4. **Karşılık — cümle içi rekabetçi eşleme (Melamed 2000):** adayı içeren cümlelerin
   hedef tarafındaki 1–5 kelimelik kök n-gramları **Dice** `2·birlikte / (f_kaynak +
   f_hedef)` ile puanlanır; karşılık kaynaktan uzunsa fazla kelime başına 0,1 düşülür
   (uzunluk cezası), eşitlikte G² (kanıt miktarı) öne geçer. Her satırda çiftler bu
   puanla sırayla bağlanır: her kaynak satırda tek karşılık alır ve bağlanan hedef
   kelimeyi, iç içe olmayan ("recipe" ⊂ "secret recipe") başka kaynak o satırda
   kullanamaz. "five representative batches ↔ temsili beş parti"de "beş" five'ındır;
   eş anlamlılar (state/indicate → belirtiniz) ayrı satırlarda aynı karşılığı alabilir.
   Karşılık, bağlanan görülmelerle yeniden hesaplanan Dice'ın en yükseği; ona 0,05 yakın
   olanlardan kaynağın kelime sayısına en yakını ("water content" → "su içeriği").
   Şart: bağlanan ≥ 3, Dice ≥ 0,5; kaynağın kopyası karşılık olamaz.
5. **Yazılış:** kökle birebir aynı biçim ("ruhsat"), yoksa yeterince sık biçimlerin en
   kısası ("depolandıktan" değil "depolama"). Kelime bir yerde küçük harfle geçiyorsa
   küçük harf; tümü büyük kelime kaynak ifadede de varsa kısaltmadır ve kalır ("CIPAC",
   "DPP"), yoksa başlıktır ve küçülür ("ŞEKİL" → "şekil").
6. **Tür (`generalCheck`):** firmanın terimcesinde zaten olan atlanır. Genel terimcede
   aynı kaynak varsa: aynı kök ("solüsyonu" ~ "solüsyon", kesmesiz kök: "teslimat" ≠
   "teslim") ya da firma o terimi içeren satırlarının en az yarısında genel karşılığı
   kullanıyorsa atlanır; gerçekten başka çeviriyorsa `conflict` ("firma farkı", genel
   karşılık kanıtta saklanır ve yan yana gösterilir); genelde yoksa `extracted`.
7. Öneriler kanıt cümleleriyle `term_suggestions`'a yazılır; kullanıcı (gerekirse
   karşılığı düzelterek) kabul edince firmanın `term_concepts`/`term_variants`'ına
   (`scope_type = client`) geçer. Reddedilen bir daha önerilmez.

Gerçek bellekte ilk öneriler: BASF formulation → formülasyon, storage → depolama,
melting point → erime noktası, wet sieve test → ıslak elek testi; Syngenta method →
yöntem, five → beş, analytical method → analitik yöntem; firma farkı BASF solvent →
çözücü (genel: solvent), solution → çözelti (genel: solüsyon).

### 5.6 İnceleme ekranından öğrenme

`PATCH /documents/[id]/segments` bugün düzeltmeyi `human-approved` olarak belleğe yazıyor.
Ek olarak:

1. Bellek satırına belgenin `client_id`'si yazılır.
2. Makine çevirisi ile düzeltilmiş hâl kelime düzeyinde karşılaştırılır (en uzun ortak
   altdizi). Değişen hedef aralığı, kaynak cümlede zorunlu terim listesindeki bir ifadeye
   ya da 5.5'teki bir adaya karşılık geliyorsa `(kaynak ifade → yeni karşılık)` bir `edit`
   gözlemi olur.
3. Aynı firmada aynı gözlem **2. kez** görülünce öneri kuyruğunda görünür; kabul edilince
   firmanın terimcesine girer. "Aynı gözlem" kök anahtarıyla belirlenir: bir belgede
   "Ruhsatı", ötekinde "ruhsat" yazılması aynı gözlemdir; öneride en kısa biçim küçük
   harfle gösterilir. Aynı belgenin aynı cümlesi kanıtı iki kez saymaz; bellekten
   çıkarılmış aynı öneri varsa düzeltme ona kanıt olur. Öğrenme yan iştir, hatası
   düzeltmenin kaydını bozmaz.

## 6. Arayüz

- **Yükleme:** dil seçicinin yanında **Firma** seçici (Genel + firmalar + "Yeni firma…").
  "Otomatik" varsayılandır: belge parçalanınca tespit sonucu kartta görünür
  ("BASF — otomatik: BAS kodu, 14 cümle belleğinde"). "Sor" kararında çeviri başlamadan
  küçük bir seçim penceresi açılır.
- **Belge ekranı:** başlıkta müşteri ve üretici rozetleri; değiştirilirse "Firmaya göre
  yeniden çevir" (yalnızca insan düzeltmesi olmayan segmentler yeniden çevrilir).
- **Firmalar sayfası** (`/ceviri-app/firmalar`): firma kartları (terim, bellek, belge
  sayısı). Firma sayfasında sekmeler: Terimce · Bellek · Referanslar (yükleme ve
  içe aktarım raporları) · Öneriler · Talimatlar & takma adlar · Belgeler · Karar
  bekleyen projeler.
- **Kütüphane süzgeci:** mevcut kütüphane sayfasına firma süzgeci.

## 7. API

| Yol | İş |
|---|---|
| `GET/POST /api/ceviri/clients` | liste, oluşturma |
| `GET/PATCH /api/ceviri/clients/[id]` | ayrıntı, ad/takma ad/talimat/sektör |
| `POST /api/ceviri/clients/[id]/imports` | terimce xlsx, TMX, referans çifti ya da zip |
| `GET/PATCH /api/ceviri/clients/[id]/suggestions` | öneri listesi, kabul/red |
| `GET/PATCH /api/ceviri/projects` | karar bekleyen proje eşlemeleri |
| `PATCH /api/ceviri/documents/[id]` | `client_id`, `maker_id` değiştirme |
| `POST /api/ceviri/clients/signatures` | parmak izini yeniden kur |

`POST /api/ceviri/documents` formuna `clientId` (`auto` | uuid | `none`) eklenir; yanıtta
`detection` döner. `/translate` belgenin `client_id`/`maker_id`'sini zincire çevirir.

## 8. Kod yerleşimi

| Dosya | Sorumluluk |
|---|---|
| `lib/ceviri/clients.ts` | firma CRUD, kapsam zinciri çözümleme |
| `lib/ceviri/fold.ts` | kelime katlama, özel ad testi (tespit ve parmak izi ortak) |
| `lib/ceviri/detect-client.ts` | 5.2 puanlama ve karar (saf fonksiyon + veri çekme ayrı) |
| `lib/ceviri/signatures.ts` | parmak izi kurma |
| `lib/ceviri/align.ts` | 5.4 Gale-Church + çapalar (saf) |
| `lib/ceviri/term-mining.ts` | 5.5 G² + Dice (saf) |
| `lib/ceviri/edit-learning.ts` | 5.6 kelime farkı → gözlem (saf) |
| `lib/ceviri/tm-store.ts`, `term-store.ts`, `translate.ts` | zincirli arama, prompt |
| `scripts/ceviri-backfill-clients.ts` | 5.3 dağıtım (kuru çalıştırma varsayılan) |
| `scripts/ceviri-eval-detection.ts` | 5.2 kalibrasyon ölçümü |

Algoritmalar saf fonksiyonlardır; veritabanı erişimi ayrı katmandadır. Testler
Supabase'e dokunmadan çalışır (mevcut `node --test` deseni).

## 9. Aşamalar

1. **Firmalar ve firmaya göre çeviri** — migration, zincirli `search_tm`/`lookup_terms`,
   prompt, yüklemede elle firma seçimi, belge rozetleri, eski arşivin dağıtılması
   (5.3), karar bekleyen projeler ekranı.
2. **Kütüphaneye yükleme** — firma sayfası, xlsx/TMX içe aktarımı firmaya, referans
   çifti ve zip hizalaması (5.4).
3. **Otomatik tespit** — parmak izi, puanlama, kalibrasyon ölçümü (5.2).
4. **Öğrenme** — terim çıkarma (5.5), düzeltmeden öğrenme (5.6), öneri ekranı.

Her aşama kendi başına kullanılabilir hâlde teslim edilir.

## 10. Test

- Saf algoritmalar için birim testler: kapsam zinciri önceliği ve firma farkının
  yasaklıya dönmesi; düzeltilmiş skor sıralaması (firma %95 > yabancı %100, karar ham
  skorla); katlama (GEREKLİLİK, DEPOLANMASI); özel ad testi; tespit kararları
  (otomatik/öneri/sor, müşteri ≠ üretici — Nase belgesinde Syngenta ürünü);
  Gale-Church çapa etkisi ve 2-1 birleşme; G²/Dice ile bilinen bir terim çiftinin
  bulunması ve sıradan kelimenin bulunmaması; düzeltme farkından gözlem çıkarma.
- Migration SQL'i dal (branch) veritabanında denenir; `search_tm` sıralaması SQL
  düzeyinde örnek satırlarla doğrulanır.
- Kalibrasyon: 5.2'deki kabul ölçütü eski arşivde ölçülür ve rapor edilir.
- Uçtan uca: yerel sunucuda bir BASF ve bir Nase belgesiyle firma seçimi, çeviri ve
  düzeltmenin firmanın belleğine düşmesi.

## 11. Riskler

| Risk | Karşılık |
|---|---|
| Yanlış otomatik firma → yanlış terimce | Gerekçe her zaman görünür; eşikler ölçümle; "sor" kararı; tek tıkla değiştir + yeniden çevir |
| Eski arşivin yanlış dağıtılması | Betik varsayılan kuru çalışır ve özet verir; yalnızca tek firmaya eşlenen satırlar etiketlenir; `project_clients` geri alınabilir |
| Kişisel veri (arşiv.zip) | Referans çiftleri firmasız "genel"e girer; kimlik numarası/isim içeren kısa satırlar (yalnızca özel ad + sayı) belleğe alınmaz |
| Hizalama hatası belleği kirletir | Güvene göre üç kademe; orta güven yapay zekâ doğrulaması; içe aktarım raporu |
| `lookup_terms` alt dizgi araması büyüdükçe yavaşlar | Bu tasarımda değişmiyor; terim sayısı 10 bini geçerse trigram indeksli sürüme geçilir |

## 12. Kapsam dışı

- Firma başına kullanıcı/yetki (tek yönetici yapısı sürer).
- Firma başına ayrı çeviri motoru ya da model.
- Stil kılavuzu belgelerinin otomatik okunması (firma talimatları elle yazılır).
