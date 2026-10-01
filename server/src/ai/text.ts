// Türkçe metin işleme: normalizasyon, konumlu belirteçleme, durak sözcükler, basit ek budama.

export interface Token {
  /** tr-TR küçük harfe çevrilmiş biçim */
  norm: string;
  start: number;
  end: number;
}

export const lowerTr = (s: string): string => s.toLocaleLowerCase("tr-TR");

/** Küçük harf + noktalama temizliği + kesme işaretinden sonraki eklerin atılması ("Ankara'da" → "ankara"). */
export function normalizeTr(text: string): string {
  return lowerTr(text.normalize("NFC"))
    .replace(/['’][\p{L}]+/gu, "")
    .replace(/[^\p{L}\p{N}%\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Özgün metindeki konumlarıyla belirteçler. Kesme işaretinden hemen sonra gelen ekler atlanır. */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index;
    const prev = text[start - 1];
    if ((prev === "'" || prev === "’") && start >= 2 && /[\p{L}\p{N}]/u.test(text[start - 2])) continue;
    out.push({ norm: lowerTr(m[0]), start, end: start + m[0].length });
  }
  return out;
}

export const STOPWORDS: ReadonlySet<string> = new Set([
  "acaba", "ama", "ancak", "artık", "aslında", "az", "bana", "bazı", "belki", "ben", "bence", "benim", "beni", "bir",
  "biraz", "birçok", "biri", "birkaç", "birşey", "biz", "bize", "bizi", "bizim", "bizce", "bu", "buna", "bunda",
  "bundan", "bunlar", "bunları", "bunların", "bunu", "bunun", "burada", "böyle", "bütün", "çok", "çünkü", "da", "daha",
  "de", "değil", "diye", "dolayı", "eğer", "en", "fakat", "gibi", "göre", "hem", "hep", "hepsi", "her", "herhangi",
  "hiç", "için", "ile", "ilgili", "ise", "işte", "kadar", "karşı", "kendi", "ki", "kim", "mi", "mı", "mu", "mü", "nasıl",
  "ne", "neden", "nerede", "niçin", "niye", "o", "olan", "olarak", "oldu", "olduğu", "olmak", "olması", "olmalı",
  "olsun", "olur", "on", "ona", "onlar", "onları", "onların", "onu", "onun", "orada", "öyle", "önce", "sanki", "sen",
  "senin", "siz", "sizin", "sonra", "şey", "şeyler", "şimdi", "şu", "şuna", "şunu", "tabii", "tüm", "ve", "veya", "ya",
  "yani", "yine", "zaten", "çünki", "üzere", "hâlâ", "hala", "ayrıca", "dahi", "bile", "gerek", "var", "yok", "the",
  "olacak", "edilsin", "edilmeli", "yapılsın", "yapılmalı", "bunlara", "şöyle", "lütfen", "iyi", "kötü",
]);

/** Kısa (≤3 harf) anahtar kelimelerde izin verilen ekler — "hat" ↔ "hata" gibi yanlış eşleşmeleri önler. */
const SHORT_SUFFIXES = new Set([
  "", "ler", "lar", "leri", "ları", "lerin", "ların", "i", "ı", "u", "ü", "in", "ın", "un", "ün", "de", "da", "te",
  "ta", "den", "dan", "ten", "tan", "imiz", "ımız", "umuz", "ümüz", "iniz", "ınız", "unuz", "ünüz", "si", "sı", "su",
  "sü", "ye", "ya", "yi", "yı", "yu", "yü", "nde", "nda", "nden", "ndan", "nin", "nın", "nun", "nün",
]);

const SOFTEN: Record<string, string> = { ç: "c", p: "b", t: "d", k: "ğ" };

/**
 * Basit ek budama: anahtar kelime belirtecin başında geçiyorsa eşleşir ("park" → "parka", "parklar").
 * Sonu sertleşen ünsüzle biten köklerde yumuşama denenir ("ağaç" → "ağacı").
 * "-l-" ile başlayan fiilimsi ekler (edilgen: "yapı" → "yapılsın") reddedilir; çoğul ve "-lık" kabul edilir.
 */
export function stemMatch(token: string, keyword: string, strict = false): boolean {
  if (token === keyword) return true;
  const stems = [keyword];
  const last = keyword[keyword.length - 1];
  if (keyword.length >= 3 && SOFTEN[last]) stems.push(keyword.slice(0, -1) + SOFTEN[last]);
  for (const stem of stems) {
    if (!token.startsWith(stem)) continue;
    const rest = token.slice(stem.length);
    if (strict || keyword.length <= 3) {
      if (SHORT_SUFFIXES.has(rest)) return true;
      continue;
    }
    if (rest.startsWith("l") && !/^(lar|ler|l[ıiuü]k|l[ıiuü]ğ)/.test(rest)) continue;
    return true;
  }
  return false;
}

/** Bir anahtar ifadenin (çok sözcüklü olabilir) belirteç dizisindeki eşleşmeleri: [ilk belirteç, son belirteç] dizinleri. */
export function findPhrase(tokens: Token[], phrase: string, opts: { exact?: boolean; strict?: boolean } = {}): [number, number][] {
  const words = normalizeTr(phrase).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const hits: [number, number][] = [];
  for (let i = 0; i + words.length <= tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < words.length && ok; j++) {
      const t = tokens[i + j].norm;
      ok = opts.exact ? t === words[j] : stemMatch(t, words[j], opts.strict);
    }
    if (ok) hits.push([i, i + words.length - 1]);
  }
  return hits;
}

/** İçerik belirteçleri: durak sözcükler ve tek harfliler atılır. */
export function contentTokens(text: string): string[] {
  return tokenize(text)
    .map((t) => t.norm)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

/** F5 kök budama (Türkçe bilgi erişiminde yaygın): ilk 5 harf. */
export const f5 = (t: string): string => (t.length > 5 ? t.slice(0, 5) : t);

/** Cümlelere böler (özgün konumlarla). */
export function sentences(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const re = /[^.!?\n]+[.!?]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t) out.push({ text: t, start: m.index + lead, end: m.index + lead + t.length });
  }
  return out;
}

export function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut) + "…";
}

export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
export const round3 = (x: number): number => Math.round(x * 1000) / 1000;
