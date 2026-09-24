import { fold } from "./fold";

/**
 * Zip içindeki kaynak ve çeviri dosyalarının eşlenmesi (spec 5.4). Arşivlerde
 * çeviri, kaynağın adına bir dil eki eklenerek saklanıyor: "bordro.pdf" ↔
 * "bordro-en.docx", "X.pdf" ↔ "X TR.docx", "Adli Sicil-Es.pdf" ↔ "Adli
 * Sicil-Es.docx". Dil ekleri ve "(1)" kopya sayaçları atılınca kalan ad aynı
 * klasörde eşleşir. Kaynak taranmış belge (PDF/görsel) ya da Word'dür; çeviri
 * Word'dür.
 */

/** CP857 (Türkçe DOS kod sayfası) 0x80–0xA7: Windows'un zip'e yazdığı dosya adı baytları. */
const CP857 = "ÇüéâäàåçêëèïîıÄÅÉæÆôöòûùİÖÜø£ØŞşáíóúñÑĞğ";

/**
 * Windows'ta sıkıştırılmış arşivde Türkçe adlar UTF-8 işaretsiz, CP857
 * baytlarıyla gelir; zip okuyucu bu baytları olduğu gibi harfe çevirir
 * ("arşiv" → "ar\x9Fiv"). Adda 0x80–0x9F aralığında bir karakter varsa (gerçek
 * metinde hiç bulunmayan C1 kontrol karakterleri) ad CP857 sayılır ve çözülür.
 * Doğru kodlanmış adlar dokunulmadan döner.
 */
export function decodeZipName(name: string): string {
  if (!/[\u0080-\u009f]/.test(name)) return name;
  return [...name]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x80 && code < 0x80 + CP857.length ? CP857[code - 0x80] : char;
    })
    .join("");
}

const SOURCE = /\.(pdf|jpe?g|png|webp|tiff?|docx)$/i;
const LANGUAGE_TAG =
  /(?:[\s_-]+|\s*\()(tr|en|es|de|fr|it|ru|rus|el|pl|ro|ar|pt|nl|translation|ceviri|çeviri|revised|final)\)?$/i;
/** Windows'un kopya sayacı: "Resume (1) (1).docx". Yıl gibi çıplak sayılar ada dahildir. */
const COPY = /\s*\(\d+\)$/;

/** Okunamayan biçimler (eski Word ikili dosyası vb.): raporda ayrıca listelenir. */
const UNSUPPORTED = /\.(doc|rtf|odt|pages)$/i;

function parts(path: string): { folder: string; stem: string; words: string[]; tagged: boolean; word: boolean } {
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash) : "";
  let stem = path.slice(slash + 1).replace(/\.[^.]+$/, "");
  let tagged = false;
  for (let i = 0; i < 8; i++) {
    const copy = COPY.exec(stem);
    if (copy) {
      stem = stem.slice(0, copy.index);
      continue;
    }
    const tag = LANGUAGE_TAG.exec(stem);
    if (!tag) break;
    tagged = true;
    stem = stem.slice(0, tag.index);
  }
  const folded = fold(stem);
  return {
    folder,
    stem: folded.replace(/[^\p{L}\p{N}]+/gu, ""),
    words: folded.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 2),
    tagged,
    word: /\.docx$/i.test(path),
  };
}

/**
 * İkinci geçiş: adı birebir tutmayan kaynak ve çeviri, aynı klasörde, kısa
 * adın kelimelerinin çoğu uzun adda geçiyorsa eşlenir ("ASPİRE 60 SL (BAS 555
 * 00 F) AMBALAJ BİLGİ FORMU-EN.pdf" ↔ "Aspire 60 SL.docx"). En güçlü eşleşme
 * önce; her dosya bir kez.
 */
function pairByWords(leftovers: string[]): Array<{ source: string; target: string }> {
  const scans = leftovers.filter((file) => !parts(file).word);
  const docs = leftovers.filter((file) => parts(file).word);
  const candidates: Array<{ source: string; target: string; share: number; common: number }> = [];
  for (const source of scans) {
    const a = parts(source);
    for (const target of docs) {
      const b = parts(target);
      if (a.folder !== b.folder) continue;
      const set = new Set(a.words);
      const common = [...new Set(b.words)].filter((word) => set.has(word)).length;
      const share = common / Math.max(1, Math.min(new Set(a.words).size, new Set(b.words).size));
      if (common >= 2 && share >= 0.75) candidates.push({ source, target, share, common });
    }
  }
  candidates.sort((x, y) => y.share - x.share || y.common - x.common);
  const used = new Set<string>();
  const pairs: Array<{ source: string; target: string }> = [];
  for (const candidate of candidates) {
    if (used.has(candidate.source) || used.has(candidate.target)) continue;
    used.add(candidate.source);
    used.add(candidate.target);
    pairs.push({ source: candidate.source, target: candidate.target });
  }
  return pairs;
}

export function pairReferenceFiles(names: string[]): {
  pairs: Array<{ source: string; target: string }>;
  unmatched: string[];
  unsupported: string[];
} {
  const groups = new Map<string, string[]>();
  const unmatched: string[] = [];
  const unsupported: string[] = [];
  for (const name of names) {
    if (UNSUPPORTED.test(name)) {
      unsupported.push(name);
      continue;
    }
    if (!SOURCE.test(name)) {
      unmatched.push(name);
      continue;
    }
    const info = parts(name);
    const key = `${info.folder}\u0000${info.stem}`;
    groups.set(key, [...(groups.get(key) ?? []), name]);
  }

  const pairs: Array<{ source: string; target: string }> = [];
  for (const files of groups.values()) {
    const words = files.filter((file) => parts(file).word);
    const scans = files.filter((file) => !parts(file).word);
    let source: string | undefined;
    let target: string | undefined;
    if (scans.length >= 1 && words.length >= 1) {
      source = scans[0];
      target = words.find((file) => parts(file).tagged) ?? words[0];
    } else if (words.length === 2) {
      const [a, b] = words;
      if (parts(a).tagged !== parts(b).tagged) {
        target = parts(a).tagged ? a : b;
        source = target === a ? b : a;
      }
    }
    if (source && target) {
      pairs.push({ source, target });
      unmatched.push(...files.filter((file) => file !== source && file !== target));
    } else unmatched.push(...files);
  }

  const second = pairByWords(unmatched.filter((file) => SOURCE.test(file)));
  const paired = new Set(second.flatMap((pair) => [pair.source, pair.target]));
  return { pairs: [...pairs, ...second], unmatched: unmatched.filter((file) => !paired.has(file)), unsupported };
}
