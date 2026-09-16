# WordPress Yazı / Sayfa aktarımı

Üretim akışı ve taslak zorunluluğu korunur. TTAA ve Ay Tercüme'de yeni çalışma
başlatılırken tek hedef seçilir. `post` Yazılar, `page` Sayfalar bölümünde yeni
taslak oluşturur. Mevcut sayfa seçimi, üst sayfa, özel içerik türü ve çift aktarım
kapsam dışıdır; yazım yönergeleri, görsel üretimi ve içerik tasarımı değişmez.

## Kayıt ve API uyumluluğu

- `brief.wordpressTarget`: `post | page`. Eksik alan eski yazı davranışıdır;
  geçersiz değer 400, kapalı sayfa özelliği veya çelişen hedef 409 döndürür.
- `/api/jobs`, iki markanın üretim/finalize yolları aynı hedefi kullanır.
  `/api/jobs/[id]` hedefi geri döndürür; yenileme ve tekrar deneme kayıtlı işi kullanır.
- Paketlerde `wordpressTarget`, WordPress sonucunda `wordpress.wordpressTarget`
  saklanır. Mevcut JSON alanları kullanılır; migration/sütun adı değişikliği yoktur.
- `/api/projects/media` isteğinde isteğe bağlı `wordpressTarget=page` kullanılır.
  Eksik parametre yazı arar. Medya uç noktaları ve WordPress düzenleme URL'sindeki
  `post=` parametresi sayfalarda da değişmez.
- Yönetilen taslak senkronizasyonu kayıtlı tür, kimlik ve iş işaretini doğrular.
  Yayınlanmış/silinmiş kayıt veya yanlış iş işareti yeni kayıtla değiştirilmez.
- Özellik kapatılsa da önceden oluşturulmuş sayfalar okunup taslak olarak
  senkronize edilebilir. Tamamlanmamış yeni sayfa işleri etkinleştirmeyi bekler.

## Devreye alma

`WORDPRESS_PAGES_ENABLED` sunucu ayarı varsayılan `false` değerindedir; `.env.example`
bunu belgeler. Kapalıyken mevcut yazı formu korunur ve yeni sayfa talepleri reddedilir.
16 Eylül 2026 tarihinde Railway `dazzling-analysis` projesindeki `ttaa` ve
`ttaa-worker` servislerinin başlangıç commit'i `bb43941` ile eşleştiği doğrulandı.
Kullanıcı güncellemeyi canlıya almayı ve sayfa seçimini etkinleştirmeyi onayladı.

1. Önce Railway'deki web/worker kaynak commit'lerini doğrulayın ve farklılıkları
   uzlaştırın. Test WordPress ortamında iki hesabın sayfa oluşturma, medya yükleme
   ve SEO alanlarını yazma yetkilerini kontrol edin. Gereksiz rol yükseltmesi yapmayın.
2. Ayarı kapalı tutarak bu sürümü **tüm web ve worker replikalarına** kurun.
   Eski worker kalmadığını dağıtım kimliklerinden doğrulayın. Eski worker bu alanı
   tanımaz: tek başına web'e yeni sürüm kurmak güvenli değildir.
3. Test ortamında hazır içerik ve test görselleriyle her iki markada yazı/sayfa
   taslağı, SEO geri okuması, tema görünümü, tekrar deneme ve panel senkronizasyonunu
   doğrulayın. Ücretli AI üretimi veya canlı içeriğe yazma bu kontrolün parçası değildir.
4. Kontrollerden sonra önce worker'larda, sonra web'de `WORDPRESS_PAGES_ENABLED=true`
   yapın. Arayüz ayarı `/api/auth/status` üzerinden alır; yeni seçim için sayfa yenilenir.
5. Geri almada önce web'de yeni sayfa kabulünü kapatın. Bekleyen sayfa işlerini
   tamamlayın veya iptal edin; ardından worker ayarını kapatın. Sayfa kayıtları varken
   hedef desteği bulunmayan eski sürüme dönmeyin; kapalı özellikli bu sürümü koruyun.

Ayrı test sitesi bulunmuyor. Canlıya geçiş, dış servislere yazmayan testler ve
web/worker sağlık kontrolleriyle doğrulanır. Canlıda deneme içeriği veya ücretli
AI üretimi başlatılmaz; tema ve SEO eklentisinin gerçek sayfa görünümü henüz
doğrulanmamıştır. Etkinleştirme sırası önce worker, sonra web olarak korunur.

## Yerel doğrulama

- `npm run test:wordpress`: WordPress ve Supabase ağ istekleri tamamen sahte
  yanıtlarla sınırlandırılır; iki marka, eski kayıt, sayfa, SEO, medya, kayıtlı
  işten devam, tekrar deneme, proje senkronizasyonu ve hata durumları sınanır.
- `npm test`: mevcut 15 regresyon testi ve vinext derlemesi.
- `npm run build:railway`, `npm run typecheck:worker`, `npm run lint`.

Referans: https://developer.wordpress.org/rest-api/reference/pages/
