# AY Tercüme Görsel Üretim Master Sistemi

Bu dosya, kullanıcı tarafından sağlanan `AY_Tercume_Image_Generation_Prompt_Style (1).md` kaynağının uygulama için geliştirilmiş ve teknik akışa bağlanmış sürümüdür.

## Amaç

Her Ay Tercüme içeriği için iki ayrı 16:9 görsel hazırlanır:

1. `featured`: WordPress öne çıkan görseli ve sosyal paylaşım görseli.
2. `inline`: Makalenin uygun H2 bölümünden sonra kullanılan açıklayıcı içerik görseli.

Görseller yalnızca dekoratif değildir. Başlığın gerçek hizmetini, belge türünü veya işlem akışını anlaşılır biçimde desteklemelidir.

## Değiştirilemez marka kuralları

- Girdi olarak `public/ay-tercume-logo.jpg` kullanılır.
- Logo yeniden çizilmez, kısaltılmaz, renkleri değiştirilmez ve yapay bir amblemle değiştirilmez.
- Logo her görselde sol üst köşede, güvenli boşluk içinde ve okunaklı biçimde bulunur.
- Logodaki `AY TERCÜME` yazısı, dairesel oklar, konuşan profil simgesi ve şirket alt satırı korunur.
- Başka logo, watermark, kurum amblemi veya devlet işareti eklenmez.

## Renk sistemi

- Ana turkuaz / mint: `#43cc9b`
- Vurgu mavisi: `#009fe4`
- Koyu yazı: `#0f0b08`
- Ana arka plan: `#ffffff`

Kaynak dosyadaki daha eski renk referansları yerine panel için kullanıcı tarafından sonradan verilen bu renkler uygulanır.

## Genel görsel dil

- Beyaz, ferah ve premium kurumsal banner.
- Yumuşak mint-mavi geçişler, ölçülü gölgeler ve temiz katmanlar.
- Solda logo ve kısa başlık; sağda konuya özel belge veya süreç nesneleri.
- Hafif dünya, dil yönü, iletişim veya doğrulama motifi kullanılabilir.
- Mobil kırpımda logo, başlık ve ana konu nesnesi görünür kalır.
- Featured ve inline aynı kompozisyonun kopyası olamaz.

## Konu eşleme sistemi

- Yeminli / noter onaylı tercüme: katmanlı belgeler, noter klasörü, kontrollü onay yolu.
- Apostil / legalizasyon / tasdik: sertifikalar, doğrulama adımları ve soyut işlem akışı.
- Vize / ikamet / çalışma izni: anonim seyahat belgesi silüetleri ve başvuru dosyası.
- Akademik tercüme: diploma, transkript, akademik kayıt ve terminoloji kontrolü.
- Hukuki tercüme: sözleşme, dava dosyası, madde ve terminoloji incelemesi.
- Ticari tercüme: şirket dosyaları, sözleşmeler ve çok dilli iş akışı.
- Tıbbi tercüme: anonim raporlar, terminoloji notları ve güvenli belge aktarımı.
- Teknik tercüme: kılavuzlar, teknik çizgiler, spesifikasyon ve kontrol listeleri.
- Sözlü tercüme: konuşma dalgaları, iki yönlü dil iletişimi ve profesyonel toplantı akışı.
- Acil tercüme: düzenli zaman çizelgesi ve hızlı fakat kontrollü iş akışı.

## Başlık politikası

- Görselde yalnızca bir kısa ana başlık kullanılır.
- Başlık makale konusuyla birebir bağlantılıdır ve en fazla yaklaşık 10–11 kelimedir.
- Rastgele küçük metin, paragraf, fiyat, slogan veya okunamayan karakter üretilmez.
- Model başlığı doğru üretemezse görsel yayın öncesi insan kontrolüne işaretlenir.

## Yasaklar

- Sahte resmî mühür, damga, imza veya devlet amblemi.
- Gerçek pasaport, kimlik, vize, diploma veya kişisel veri kopyası.
- Kurum adına garanti, kesin kabul veya resmî yetki iddiası.
- İlgisiz stok insan, kalabalık toplantı, masa veya laptop kahraman görseli.
- Koyu ve ağır tasarım, kalabalık nesne yığını, aşırı 3D efekt.
- TTAA logosu, rengi, adı, WordPress adresi veya görsel şablonu.

## Teknik üretim

- Endpoint: OpenAI Image API `/v1/images/edits`.
- Varsayılan model: `gpt-image-2`.
- Varsayılan boyut: `1536x864`.
- Varsayılan kalite: `medium`.
- Varsayılan format: `webp`.
- Logo, image edit çağrısına gerçek referans dosyası olarak eklenir.
- Featured ve inline görseller `Promise.all` ile paralel üretilir.
- 429 ve 5xx hataları sınırlı geri çekilme ile yeniden denenir.
- API anahtarı yalnızca sunucuda tutulur ve tarayıcı yanıtında yer almaz.

## SEO ve medya metadata sözleşmesi

Her görsel için aşağıdaki alanlar zorunludur:

- `fileName`: kısa slug + `featured` veya `inline`.
- `alt`: görseli ve içerik bağlamını doğal Türkçeyle anlatır.
- `titleText`: görselde talep edilen kısa başlık.
- `caption`: görünür figcaption için kısa açıklama.
- `description`: WordPress Media Library açıklaması.
- `prompt`: denetim için kullanılan korunmuş prompt.
- `width`, `height`, `format`, `model`, `quality`.
- `branding.logoReferenceApplied = true`.
- `branding.logoPlacement = top-left`.

## Yayın kapısı

1. Yazı, dinamik FAQ, SEO ve link paketi gizli olarak tamamlanır.
2. İki görsel briefi son hâline getirilir.
3. Featured ve inline görseller paralel üretilir.
4. İki görsel de tamamlanırsa yeni paket panelde gösterilir.
5. Görsel üretimi durursa önceki görsel yeni çalışmaya aitmiş gibi gösterilmez.
6. Görseller önce panelde güvenli önizleme olarak tutulur, ardından bağlı Ay WordPress Media Library’ye yüklenir.
7. Featured görsel `featured_media`, inline görsel semantik `figure` olarak yalnızca `draft` durumundaki yazıya aktarılır.
