import { canonicalLinkUrl, type ResearchedLink } from "./link-catalog";

export type AyLinkBrief = {
  topic: string;
  audience: string;
  country: string;
  documentType: string;
};

function ayBaseUrl() {
  return (process.env.AY_WP_URL || process.env.AY_SITE_URL || "").trim().replace(/\/$/, "");
}

function internalUrl(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return ayBaseUrl() ? `${ayBaseUrl()}${normalized}` : normalized;
}

export function buildAyContactUrl(topic?: string) {
  const phone = process.env.AY_WHATSAPP_PHONE?.replace(/\D/g, "");
  if (!phone) return internalUrl("/iletisim/");
  const detail = topic?.trim() ? ` ${topic.trim()} konusunda` : "";
  const message = `Merhaba AY Tercüme,${detail} tercüme desteği almak istiyorum. Belgeyi buradan gönderip fiyat ve süreç bilgisi alabilir miyim?`;
  return `https://api.whatsapp.com/send/?phone=${phone}&text=${encodeURIComponent(message)}&type=phone_number&app_absent=0`;
}

function internal(anchor: string, path: string, reason: string): ResearchedLink {
  return { anchor, url: internalUrl(path), reason, source: "internal" };
}

const OFFICIAL: Record<string, ResearchedLink> = {
  hcch: { anchor: "HCCH Apostil Sözleşmesi ülke tablosu", url: "https://www.hcch.net/en/instruments/conventions/status-table/?cid=41", reason: "Apostil taraf ülkeleri için resmî HCCH kaynağı", source: "official" },
  eApostil: { anchor: "e-Devlet apostil belge doğrulama hizmeti", url: "https://www.turkiye.gov.tr/icisleri-apostil-belge-dogrulamasi", reason: "Türkiye Cumhuriyeti resmî belge doğrulama hizmeti", source: "official" },
  disisleri: { anchor: "T.C. Dışişleri Bakanlığı konsolosluk bilgileri", url: "https://www.mfa.gov.tr/konsolosluk-islemleri.tr.mfa", reason: "Konsolosluk işlemleri için resmî bakanlık kaynağı", source: "official" },
  noterler: { anchor: "Türkiye Noterler Birliği", url: "https://www.tnb.org.tr/", reason: "Noterlik işlemleri için resmî meslek kuruluşu", source: "official" },
  iso17100: { anchor: "ISO 17100 çeviri hizmetleri standardı", url: "https://www.iso.org/standard/59149.html", reason: "Çeviri süreci için resmî uluslararası standart", source: "official" },
  iso18587: { anchor: "ISO 18587 post-editing standardı", url: "https://www.iso.org/standard/62970.html", reason: "Makine çevirisi post-editing süreci için resmî standart", source: "official" },
  nvi: { anchor: "Nüfus ve Vatandaşlık İşleri Genel Müdürlüğü", url: "https://www.nvi.gov.tr/", reason: "Kişisel durum belgeleri için resmî kurum kaynağı", source: "official" },
  eDevlet: { anchor: "e-Devlet Kapısı", url: "https://www.turkiye.gov.tr/", reason: "Türkiye Cumhuriyeti resmî dijital hizmet platformu", source: "official" },
};

export function dedupeAyLinks(links: ResearchedLink[]) {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = canonicalLinkUrl(link.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getAyCuratedLinks(brief: AyLinkBrief): ResearchedLink[] {
  const haystack = `${brief.topic} ${brief.audience} ${brief.country} ${brief.documentType}`.toLocaleLowerCase("tr-TR");
  const links: ResearchedLink[] = [
    internal("yeminli tercüme", "/yeminli-tercume/", "AY Tercüme yeminli tercüme hizmeti"),
    internal("noter onaylı tercüme", "/noter-onayli-tercume/", "AY Tercüme noter onayı süreci"),
    { anchor: "belgenizi incelemeye gönderin", url: buildAyContactUrl(brief.topic), reason: "Belge inceleme ve teklif için AY Tercüme iletişim kanalı", source: "internal" },
  ];

  if (/apostil|apostille|tasdik|legalizasyon|legalization|elçilik|konsolosluk/.test(haystack)) {
    links.push(internal("apostil ve tasdik desteği", "/apostil/", "AY Tercüme apostil ve tasdik hizmeti"), OFFICIAL.hcch, OFFICIAL.eApostil, OFFICIAL.disisleri);
  }
  if (/dışişleri|disisleri/.test(haystack)) links.push(internal("Dışişleri Bakanlığı tasdiki", "/disisleri-bakanligi-tasdiki/", "AY Tercüme tasdik süreç desteği"), OFFICIAL.disisleri);
  if (/elçilik|konsolosluk/.test(haystack)) links.push(internal("elçilik ve konsolosluk tasdiki", "/elcilik-tasdiki/", "AY Tercüme temsilcilik tasdik desteği"));
  if (/vize|pasaport|sabıka|nüfus|doğum|evlilik|kişisel/.test(haystack)) links.push(internal("vize evrakları çevirisi", "/vize-evraklari-cevirisi/", "AY Tercüme resmî ve kişisel belge çevirisi"), OFFICIAL.nvi, OFFICIAL.eDevlet);
  if (/diploma|transkript|öğrenci|akademik|üniversite/.test(haystack)) links.push(internal("akademik belge tercümesi", "/akademik-tercume/", "Diploma, transkript ve akademik belge hizmeti"));
  if (/hukuk|hukuki|mahkeme|vekalet|sözleşme|dava/.test(haystack)) links.push(internal("hukuki tercüme", "/hukuki-tercume/", "AY Tercüme hukuki belge hizmeti"));
  if (/ticari|şirket|ticaret|imza sirküleri|faaliyet belgesi/.test(haystack)) links.push(internal("ticari tercüme", "/ticari-tercume/", "AY Tercüme ticari belge hizmeti"));
  if (/teknik|mühendis|kılavuz|yazılım|imalat/.test(haystack)) links.push(internal("teknik tercüme", "/teknik-tercume/", "AY Tercüme teknik doküman hizmeti"));
  if (/medikal|sağlık|rapor|reçete|tıbbi/.test(haystack)) links.push(internal("medikal tercüme", "/medikal-tercume/", "AY Tercüme sağlık belgesi hizmeti"));
  if (/sözlü|tercüman|toplantı|konferans|randevu/.test(haystack)) links.push(internal("sözlü tercüme", "/sozlu-tercume/", "AY Tercüme sözlü iletişim desteği"));
  if (/acil|hızlı|ekspres/.test(haystack)) links.push(internal("acil tercüme", "/acil-tercume/", "AY Tercüme acil talep değerlendirmesi"));
  if (/ankara|çankaya|çayyolu/.test(haystack)) links.push(internal("Ankara tercüme bürosu", "/ankara-tercume-burosu/", "AY Tercüme Ankara yerel hizmet sayfası"));
  if (/istanbul|şişli|mecidiyeköy/.test(haystack)) links.push(internal("İstanbul tercüme bürosu", "/istanbul-tercume-burosu/", "AY Tercüme İstanbul yerel hizmet sayfası"));
  if (/çeviri|tercüme|translation|belge/.test(haystack)) links.push(OFFICIAL.iso17100);
  if (/makine çevirisi|yapay zeka|post.edit|mtpe/.test(haystack)) links.push(OFFICIAL.iso18587);

  return dedupeAyLinks(links).slice(0, 14);
}

export function getAyCanonical(slug: string) {
  const cleanSlug = slug.replace(/^\/+|\/+$/g, "");
  return ayBaseUrl() ? `${ayBaseUrl()}/${cleanSlug}/` : `/${cleanSlug}/`;
}
