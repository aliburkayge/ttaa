/**
 * Lingua'nın sunduğu diller. İngilizce tek bir dil değildir: müşteri belgenin
 * hangi ülkenin İngilizcesiyle yazılacağını seçer (yazım: "organisation" /
 * "organization", tarih biçimi, terimler). Her varyant kendi bayrağıyla gelir.
 *
 * `flag`: flag-icons paketindeki ülke kodu (ISO 3166-1 alpha-2, küçük harf).
 */
export type Language = {
  code: string;
  flag: string;
  /** Dilin kendi adıyla ("Deutsch"). */
  native: string;
  /** Arayüzde gösterilen Türkçe ad ("Almanca", "İngilizce · Kanada"). */
  label: string;
  /** Dil modeline verilen İngilizce ad ("English (Australia, en-AU)"). */
  prompt: string;
  group: "İngilizce" | "Diğer diller";
};

const english = (code: string, flag: string, country: string, countryEn: string): Language => ({
  code,
  flag,
  native: "English",
  label: `İngilizce · ${country}`,
  prompt: `English (${countryEn}, ${code})`,
  group: "İngilizce",
});

const other = (code: string, flag: string, native: string, label: string, name: string): Language => ({
  code,
  flag,
  native,
  label,
  prompt: `${name} (${code})`,
  group: "Diğer diller",
});

export const LANGUAGES: Language[] = [
  english("en-US", "us", "ABD", "United States"),
  english("en-GB", "gb", "Birleşik Krallık", "United Kingdom"),
  english("en-AU", "au", "Avustralya", "Australia"),
  english("en-CA", "ca", "Kanada", "Canada"),
  english("en-IE", "ie", "İrlanda", "Ireland"),
  english("en-NZ", "nz", "Yeni Zelanda", "New Zealand"),
  english("en-ZA", "za", "Güney Afrika", "South Africa"),
  english("en-IN", "in", "Hindistan", "India"),
  other("tr-TR", "tr", "Türkçe", "Türkçe", "Turkish"),
  other("de-DE", "de", "Deutsch", "Almanca", "German"),
  other("ru-RU", "ru", "Русский", "Rusça", "Russian"),
  other("es-ES", "es", "Español", "İspanyolca", "Spanish"),
  other("it-IT", "it", "Italiano", "İtalyanca", "Italian"),
  other("el-GR", "gr", "Ελληνικά", "Yunanca", "Greek"),
  other("pl-PL", "pl", "Polski", "Lehçe", "Polish"),
];

export function findLanguage(code: string): Language | undefined {
  return LANGUAGES.find((lang) => lang.code === code);
}

/** Arayüzde kısa Türkçe ad; bilinmeyen kod olduğu gibi. */
export function languageLabel(code: string): string {
  return findLanguage(code)?.label ?? code;
}

/** Dil modeline verilecek ad: varyant açıkça söylenir ("English (Australia, en-AU)"). */
export function languagePrompt(code: string): string {
  return findLanguage(code)?.prompt ?? code;
}

/** Belleği birlikte kullanan ana İngilizce varyantlar: onaylı çevirilerin çoğu bunlarla kayıtlı. */
const ENGLISH_CORE = ["en-US", "en-GB"];

/**
 * Çeviri belleğinde ve terminolojide bakılacak dil kodları, önceliğe göre.
 * İngilizce varyantlar belleği paylaşır: Avustralya İngilizcesine çevrilen bir
 * belge, ABD ya da İngiltere İngilizcesiyle onaylanmış cümleleri de bulur.
 * Önce varyantın kendisi gelir. Diğer diller yalnızca kendi belleklerine bakar.
 */
export function memoryLangs(code: string): string[] {
  if (!code.startsWith("en-")) return [code];
  return [code, ...ENGLISH_CORE.filter((core) => core !== code)];
}
