/**
 * Müşteri kuralı: adresler çevrilmez, yalnızca ülke adları çevrilir
 * ("100 Park Avenue" kalır; "USA" → "ABD"). Adres satırı kural tabanlı
 * tanınır, çeviri belleğinden de önce gelir: bellekte "100 Park Caddesi"
 * gibi eski bir kayıt olsa bile kullanılmaz.
 */

const STREET_WORD =
  /\b(avenue|ave|street|st|drive|dr|road|rd|boulevard|blvd|lane|ln|way|court|ct|place|pl|parkway|pkwy|highway|hwy|circle|cir|terrace|plaza|square|sq)\b\.?/i;
const EUROPEAN_STREET =
  /[\p{L}-]*(straße|strasse|str\.|weg|platz|allee|gasse|ring|damm|laan|straat|gatan|vej|caddesi|cad\.|sokak|sok\.|bulvarı)\s*\d+/iu;
const STREET_FIRST = /^(via|viale|piazza|rue|calle|avenida|rua|ulica|ul\.)\s+\S.*\d/iu;
const BOX = /^(p\.?\s?o\.?\s*box|postfach|suite|ste\.?|floor|fl\.)\s*[#\d]/i;
const US_STATE_ZIP = /\b[A-Z]{2}\s+\d{5}(?:-\d{0,4})?(?=$|[\s,])/;
const CITY_STATE_ZIP = /,\s*[A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+)*\s+\d{5}(?:-\d{0,4})?(?=$|[\s,])/;
const EU_ZIP_CITY = /^(?:[A-Z]{1,2}-)?(\d{4,5})\s+\p{Lu}[\p{L}.'-]+(?:[\s-]+\p{L}[\p{L}.'-]*){0,2}(?:,\s*[\p{L} .]+)?$/u;
const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/;

const ABBREVIATIONS: Record<string, string> = { USA: "US", "U.S.A.": "US", US: "US", "U.S.": "US", UK: "GB", "U.K.": "GB" };
const US_SHORT: Record<string, string> = { tr: "ABD", de: "USA", ru: "США", es: "EE. UU.", it: "USA", el: "ΗΠΑ", pl: "USA", fr: "États-Unis" };

let englishNames: Map<string, string> | null = null;

/** İngilizce ülke adı (küçük harf) → ISO kodu. */
function countryCodes(): Map<string, string> {
  if (englishNames) return englishNames;
  const names = new Map<string, string>();
  const english = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const name = english.of(code);
      if (name) names.set(name.toLowerCase(), code);
    }
  }
  names.set("united states of america", "US");
  names.set("great britain", "GB");
  names.set("the netherlands", "NL");
  englishNames = names;
  return names;
}

function countryOf(part: string): { code: string; abbreviation: boolean } | null {
  const clean = part.trim().replace(/[;:]$/, "");
  // "U.S.A." kısaltmasındaki nokta adın parçasıdır; "Germany." sonundaki değil.
  if (ABBREVIATIONS[clean]) return { code: ABBREVIATIONS[clean], abbreviation: true };
  const code = countryCodes().get(clean.replace(/\.$/, "").toLowerCase());
  return code ? { code, abbreviation: false } : null;
}

/** Adres parçalarını ayıran virgül ya da boşluklu tire ("… Boulevard - St. Louis - Missouri"). */
const PART_SEPARATOR = /(,|\s[-–]\s)/;

export function isAddressLine(text: string): boolean {
  // Liste işareti ("- ", "• ") adresin parçası değildir.
  const line = text.trim().replace(/^[-–•·]\s+/, "");
  const words = line.split(/\s+/).filter((word) => !/^[-–]$/.test(word));
  if (!line || line.length > 90 || words.length > 12) return false;
  if (countryOf(line)) return true;
  if (BOX.test(line)) return true;
  if (/^\d+[a-z]?(?:[-–]\d+[a-z]?)?\s+\S/i.test(line) && STREET_WORD.test(line)) return true;
  if (EUROPEAN_STREET.test(line) || STREET_FIRST.test(line)) return true;
  if (US_STATE_ZIP.test(line) || CITY_STATE_ZIP.test(line) || UK_POSTCODE.test(line)) return true;
  const european = EU_ZIP_CITY.exec(line);
  // Dört haneli sayı + büyük harfli kelime bir yıl olabilir ("2025 Annual Report").
  if (european && !(european[1].length === 4 && /^(19|20)\d\d$/.test(european[1]))) return true;
  return false;
}

/**
 * Adreste yalnızca ülke adı çevrilir. Ülke, satırın tamamı ya da virgülle
 * veya tireyle ayrılmış bir parçasıdır; bir sokak adının içindeki ülke adına
 * dokunulmaz ("12 Jordan Street").
 */
export function localizeCountries(text: string, targetLang: string): string {
  const base = targetLang.split("-")[0].toLowerCase();
  if (base === "en") return text;
  const target = new Intl.DisplayNames([targetLang, base], { type: "region", fallback: "none" });
  return text
    .split(PART_SEPARATOR)
    .map((part, index) => {
      // Tek sıradakiler ayırıcıların kendisidir.
      if (index % 2 === 1) return part;
      const country = countryOf(part);
      if (!country) return part;
      const name = country.abbreviation && country.code === "US" && US_SHORT[base] ? US_SHORT[base] : target.of(country.code);
      if (!name) return part;
      const leading = part.match(/^\s*/)?.[0] ?? "";
      const trailing = part.match(/\s*$/)?.[0] ?? "";
      return `${leading}${name}${trailing}`;
    })
    .join("");
}
