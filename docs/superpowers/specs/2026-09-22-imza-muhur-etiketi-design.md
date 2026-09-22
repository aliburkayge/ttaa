# İmza ve mühür etiketi — tasarım

Tarih: 2026-09-22 · Durum: onaylandı

## Müşteri kuralı

Çevirilerde imza ve mühür orijinaldeki gibi kopyalanmaz. Yerlerine köşeli
parantez içinde etiket yazılır: imza için `[İMZA]`, mühür için `[MÜHÜR]`.
Bu kural, "imza ve mühür piksellerine dokunulmaz" kuralının yerini alır.
Belgenin geri kalanı için eski kural geçerli: biçim, düzen, logo, çizgi,
fotoğraf ve tablolar değişmez; yalnızca yazı hedef dile çevrilir.

## Kararlar

- Etiket hedef dilde ve büyük harfle yazılır. Listede olmayan dilde İngilizce.

  | Hedef | İmza | Mühür |
  |---|---|---|
  | tr | İMZA | MÜHÜR |
  | en | SIGNATURE | SEAL |
  | de | UNTERSCHRIFT | STEMPEL |
  | ru | ПОДПИСЬ | ПЕЧАТЬ |
  | es | FIRMA | SELLO |
  | it | FIRMA | TIMBRO |
  | el | ΥΠΟΓΡΑΦΗ | ΣΦΡΑΓΙΔΑ |
  | pl | PODPIS | PIECZĘĆ |

- Mühürün içindeki okunabilir yazı çevrilip etiketin içine girer:
  `[MÜHÜR: BASF SE, Ludwigshafen]`. Yazı yoksa `[MÜHÜR]`.
- İmza bölgesindeki basılı yazı (isim, unvan) çevrilip etiketin altına ayrı
  satırlar olarak yazılır.
- İmza ve mühür iç içe ise `[İMZA] [MÜHÜR]`; içindeki basılı yazı çoğu zaman
  imzacının adı ve unvanıdır (DELAN SC), ayrı satırlar olarak altına yazılır.
- Kural Word belgelerine de uygulanır.

## Taranmış PDF ve görsel

Sınıflandırıcı (`image-kind.ts`) OCR'ın her görsel bölgesini etiketler; düzen
(`ceviri_documents.layout.blocks`) bu etiketi ve bölgenin kutusunu saklar.

- `planOverlay`, `signature` / `stamp` / `signature_stamp` bloğu için bir
  işaret öğesi (`OverlayItem.mark`) üretir: bölgenin tamamı silinir, kağıt
  `reconstructPaper` ile sayfanın kendi dokusundan kurulur, etiket bölgenin
  ortasına sayfanın gövde puntosu ve yazı rengiyle yazılır.
- Bölgenin içindeki satırlar (`block.lines`) ayrıca planlanmaz; işaret
  öğesinin `lineIds`'i olur ve çizimde etikete eklenir.
- İşaret bölgesi başka bir öğenin alanına değiyorsa o öğe çeviri değişmese de
  çizilir (silinen yazı geri gelsin). Yerine yazılamayan bir satırın bloğu
  işaret bölgesine değiyorsa, o kesişim silinmez ve uyarı verilir.
- İşaretler önce silinir, sonra diğer öğeler çizilir.
- `unknown` türlü görsel ve el yazısı gibi görünen satır silinmez; uyarı
  "imza olabilir, kontrol edin" der.
- `PLAN_VERSION` 4 olur: kayıtlı belgeler indirmede yeniden planlanır.

## Word

- Yüklemede `word/document.xml` içindeki `<w:drawing>` (a:blip r:embed) ve
  `<w:pict>` (v:imagedata r:id) görselleri bulunur, ilişki dosyasından medya
  yoluna çevrilir; her benzersiz medya bir kez `inspectImage` ile sınıflandırılır.
- Mühür görselinin yazısı segment olur ve normal çevrilir.
- Sonuç `layout` alanına yazılır: `{ version: "docx-1", marks: [...] }`.
- `rebuildDocx`, metin çevirisinden sonra imza/mühür görselini içeren
  `<w:drawing>` / `<w:pict>` öğesini aynı koşu içinde etiket metniyle değiştirir.
- Düzeni olmayan eski Word belgesinde görseller indirmede sınıflandırılır ve
  sonuç kaydedilir; mühür yazısı çevrilmemiş olduğundan yalnızca `[MÜHÜR]`.

## Arayüz

- İşaret bölgesinden gelen satırlarda not: çıktıda etiketin içinde/altında
  yazılacağı.
- Belge özetinde imza ve mühür sayısı.

## Test

- `markLabel`: her dil, yazılı/yazısız mühür, iç içe.
- Plan: işaret bloğu → tek öğe, bölgenin tamamı silinir, satırlar ayrıca
  planlanmaz.
- Word: imza görseli etiketle değişir, logo kalır, çeviri yazılır.
- Uçtan uca: BASF belgesi yerelde yeniden indirilip çıktıya bakılır.
