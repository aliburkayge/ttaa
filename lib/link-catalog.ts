export type ResearchedLink = {
  anchor: string;
  url: string;
  reason: string;
  source: "internal" | "official";
};

export type LinkBrief = {
  topic: string;
  audience: string;
  country: string;
  documentType: string;
};

const TTAA_WHATSAPP_PHONE = "905305196099";

export function buildTtaaWhatsAppUrl(topic?: string) {
  const subject = topic?.trim();
  const message = subject
    ? `Hello Turkish Translation 👋 I would like to send my document for review regarding ${subject}. Can I send the file here for a quotation?`
    : "Hello Turkish Translation 👋 I would like to send my document for review. Can I send the file here for a quotation?";
  return `https://api.whatsapp.com/send/?phone=${TTAA_WHATSAPP_PHONE}&text=${encodeURIComponent(message)}&type=phone_number&app_absent=0`;
}

const INTERNAL: Record<string, ResearchedLink> = {
  translation: { anchor: "professional translation services", url: "https://turkishtranslation.com.tr/services/translation/", reason: "Core TTAA translation service", source: "internal" },
  order: { anchor: "send your document for review", url: buildTtaaWhatsAppUrl(), reason: "Direct TTAA WhatsApp document review and quotation", source: "internal" },
  check: { anchor: "checking and revision", url: "https://turkishtranslation.com.tr/services/check/", reason: "TTAA quality-control stage", source: "internal" },
  deliver: { anchor: "delivery options", url: "https://turkishtranslation.com.tr/services/deliver/", reason: "TTAA digital and physical delivery stage", source: "internal" },
  apostille: { anchor: "apostille and legalization support", url: "https://turkishtranslation.com.tr/services/apostille-and-legalization/", reason: "Relevant TTAA attestation service", source: "internal" },
  personal: { anchor: "personal document translation", url: "https://turkishtranslation.com.tr/services/personal-documents/", reason: "Related TTAA document service", source: "internal" },
  business: { anchor: "business and legal translation", url: "https://turkishtranslation.com.tr/services/business-and-legal-translation/", reason: "Related TTAA specialist service", source: "internal" },
  technical: { anchor: "technical translation", url: "https://turkishtranslation.com.tr/services/technical-translation/", reason: "Related TTAA specialist service", source: "internal" },
  interpreting: { anchor: "professional interpreting services", url: "https://turkishtranslation.com.tr/services/interpreting/", reason: "Related TTAA spoken-language service", source: "internal" },
  qvpGuide: { anchor: "TTAA QVP verification guide", url: "https://turkishtranslation.com.tr/qvp-verification-for-ksa-work-visa/", reason: "Related TTAA country guide", source: "internal" },
  usaGuide: { anchor: "TTAA apostille legalization in the USA guide", url: "https://turkishtranslation.com.tr/apostille-legalization-in-usa/", reason: "Related TTAA country guide", source: "internal" },
  malaysiaGuide: { anchor: "TTAA Malaysian Embassy attestation guide", url: "https://turkishtranslation.com.tr/malaysian-embassy-attestation-in-turkey/", reason: "Related TTAA embassy guide", source: "internal" },
  contacts: { anchor: "contact TTAA", url: "https://turkishtranslation.com.tr/contacts/", reason: "Direct consultation page", source: "internal" },
};

const OFFICIAL: Record<string, ResearchedLink> = {
  hcch: { anchor: "Hague Apostille Convention status table", url: "https://www.hcch.net/en/instruments/conventions/status-table/?cid=41", reason: "Official HCCH convention reference", source: "official" },
  turkeyApostille: { anchor: "Türkiye e-Apostille verification service", url: "https://www.turkiye.gov.tr/icisleri-apostil-belge-dogrulamasi", reason: "Official Turkish government verification service", source: "official" },
  saudiVerification: { anchor: "Saudi Ministry of Human Resources and Social Development", url: "https://www.hrsd.gov.sa/en/media-center/news/%D9%88%D8%B2%D8%A7%D8%B1%D8%A9-%D8%A7%D9%84%D9%85%D9%88%D8%A7%D8%B1%D8%AF-%D8%A7%D9%84%D8%A8%D8%B4%D8%B1%D9%8A%D8%A9-%D9%88%D8%A7%D9%84%D8%AA%D9%86%D9%85%D9%8A%D8%A9-%D8%A7%D9%84%D8%A7%D8%AC%D8%AA%D9%85%D8%A7%D8%B9%D9%8A%D8%A9-%D8%AA%D9%83%D9%85%D9%84-%D8%A5%D8%B7%D9%84%D8%A7%D9%82-%D8%AE%D8%AF%D9%85%D8%A9-%D8%A7%D9%84%D8%AA%D8%AD%D9%82%D9%82-%D8%A7%D9%84%D9%85%D9%87%D9%86%D9%8A", reason: "Official Saudi professional-verification reference", source: "official" },
  saudiVisa: { anchor: "Saudi permanent work visa service", url: "https://my.gov.sa/en/services/2691970", reason: "Official Saudi national platform", source: "official" },
  usaGov: { anchor: "USAGov authentication guide", url: "https://www.usa.gov/authenticate-us-document", reason: "Official U.S. government overview", source: "official" },
  usaState: { anchor: "U.S. Department of State Office of Authentications", url: "https://travel.state.gov/content/travel/en/replace-certify-docs/authenticate-your-document/office-of-authentications.html", reason: "Official U.S. federal authentication authority", source: "official" },
  iso17100: { anchor: "ISO 17100 translation services standard", url: "https://www.iso.org/standard/59149.html", reason: "Official translation-process standard", source: "official" },
  iso18587: { anchor: "ISO 18587 post-editing standard", url: "https://www.iso.org/standard/62970.html", reason: "Official machine-translation post-editing standard", source: "official" },
  malaysiaMfa: { anchor: "Malaysian Ministry of Foreign Affairs attestation guidance", url: "https://www.kln.gov.my/web/guest/attestation-of-documents", reason: "Official Malaysian document-attestation guidance", source: "official" },
};

function normalizePath(value: string) {
  return value.toLowerCase().replace(/^https?:\/\/[^/]+/, "").replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9]+/g, "-");
}

export function canonicalLinkHost(value: string) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return value.toLowerCase();
  }
}

export function canonicalLinkUrl(value: string) {
  try {
    const url = new URL(value);
    url.hostname = url.hostname.toLowerCase();
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return value.toLowerCase().replace(/#.*$/, "").replace(/\/$/, "");
  }
}

export function dedupeLinks(links: ResearchedLink[]) {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = canonicalLinkUrl(link.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getCuratedLinks(brief: LinkBrief): ResearchedLink[] {
  const haystack = `${brief.topic} ${brief.audience} ${brief.country} ${brief.documentType}`.toLowerCase();
  const topicSpecificWhatsApp = { ...INTERNAL.order, url: buildTtaaWhatsAppUrl(brief.topic) };
  const links: ResearchedLink[] = [INTERNAL.translation, topicSpecificWhatsApp, INTERNAL.check, INTERNAL.deliver, INTERNAL.contacts];

  if (/apostille|legalization|attestation|embassy|consulate/.test(haystack)) links.push(INTERNAL.apostille, OFFICIAL.hcch);
  if (/personal|birth|marriage|degree|diploma|certificate|passport|police/.test(haystack)) links.push(INTERNAL.personal);
  if (/business|legal|contract|company|commercial|power of attorney/.test(haystack)) links.push(INTERNAL.business);
  if (/technical|engineering|manual|software|manufactur/.test(haystack)) links.push(INTERNAL.technical);
  if (/interpret|meeting|conference|appointment/.test(haystack)) links.push(INTERNAL.interpreting);
  if (/qvp|ksa|saudi|qualification verification|work visa/.test(haystack)) links.push(INTERNAL.qvpGuide, INTERNAL.business, OFFICIAL.saudiVerification, OFFICIAL.saudiVisa);
  if (/usa|united states|american|federal|state-issued/.test(haystack)) links.push(INTERNAL.usaGuide, OFFICIAL.usaGov, OFFICIAL.usaState, OFFICIAL.hcch);
  if (/malaysia|malaysian/.test(haystack)) links.push(INTERNAL.malaysiaGuide, OFFICIAL.malaysiaMfa);
  if (/turkey|türkiye|turkish/.test(haystack) && /apostille|attestation|legalization/.test(haystack)) links.push(OFFICIAL.turkeyApostille);
  if (/translation|translator|language|document/.test(haystack)) links.push(OFFICIAL.iso17100);
  if (/machine translation|mtpe|post-edit|ai translation|low.cost|cheap/.test(haystack)) links.push(OFFICIAL.iso18587);

  const currentPath = normalizePath(brief.topic);
  return dedupeLinks(links).filter((link) => normalizePath(link.url) !== currentPath).slice(0, 12);
}
