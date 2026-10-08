// Önerili arama ("Hızlı bul") ve listelerdeki yerel süzgeçler için ORTAK eşleşme kuralları: Türkçe duyarsız normalleştirme,
// numara (#K-12, K12, #T3) ayrıştırma, başlık eşleşme düzeyi ve sıralama. Sunucu (GET /api/search) ile istemci aynı kuralı
// kullanır; böylece "listede bulunan öneri aramada da bulunur". Saf işlevlerdir (durum, zaman ve G/Ç yok).

const LOCALE = "tr-TR";

/**
 * Türkçe büyük/küçük harfe ve aksana duyarsız arama anahtarı: tr-TR küçük harf → NFD → birleşen işaretler atılır → "ı" → "i".
 * Böylece "İstanbul" ~ "istanbul", "ISIK" ~ "ışık" ~ "isik", "Çevre" ~ "cevre", "Gölge" ~ "golge", "Şenlik" ~ "senlik".
 * (Boşluklar olduğu gibi kalır; arama karşılaştırmaları ayrıca {@link searchKey} ile sadeleştirir.)
 */
export function normalizeSearch(s: string): string {
  return String(s ?? "")
    .toLocaleLowerCase(LOCALE)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i");
}

/** Arama karşılaştırma anahtarı: {@link normalizeSearch} + boşluk sadeleştirme (ardışık boşluklar tek, baş/son kırpılır). */
export function searchKey(s: string): string {
  return normalizeSearch(s).replace(/\s+/g, " ").trim();
}

/** Önerili aramanın tetiklendiği asgari karakter sayısı (numara aramaları hemen tetiklenir; bkz. {@link searchReady}). */
export const SEARCH_MIN_CHARS = 2;
/** Önerili aramada gösterilen en çok sonuç (GET /api/search `limit` üst sınırı). */
export const SEARCH_LIMIT_MAX = 8;
/** Arama metninin üst sınırı (karakter; GET /api/search `q`). */
export const SEARCH_QUERY_MAX = 100;

/** Numara araması: "#K-12", "K12", "k 12" → öneri 12; "#T3", "T-3" → konu 3; "#12" ya da "12" → her iki türde 12. */
export interface SearchRef {
  /** null: tür belirtilmedi (ör. "#12", "12") — hem öneri hem konu numarasıyla eşleşir */
  kind: "proposal" | "topic" | null;
  seq: number;
  /** true: kullanıcı açıkça numara yazdı ("#" ya da K/T harfi); yalnız rakamlarda (ör. "2026") başlıklar da aranır */
  explicit: boolean;
}

const REF_RE = /^(#)?\s*([kt])?\s*-?\s*(\d{1,9})$/i;

/** Arama metni bir numara mı? Değilse null. */
export function parseSearchRef(q: string): SearchRef | null {
  const m = REF_RE.exec(String(q ?? "").trim());
  if (!m) return null;
  const seq = Number(m[3]);
  if (!Number.isSafeInteger(seq) || seq < 1) return null;
  const letter = m[2]?.toLowerCase() ?? "";
  return { kind: letter === "k" ? "proposal" : letter === "t" ? "topic" : null, seq, explicit: !!m[1] || !!letter };
}

/** Önerili arama bu metinle çalışmalı mı: en az {@link SEARCH_MIN_CHARS} anlamlı karakter ya da bir numara. */
export function searchReady(q: string): boolean {
  return searchKey(q).length >= SEARCH_MIN_CHARS || parseSearchRef(q) !== null;
}

/** Eşleşme düzeyi (güçlüden zayıfa): numara tam eşleşme > başlık yazılanla başlıyor > kelime başı > içinde geçiyor. */
export type SearchMatch = "ref" | "prefix" | "word" | "contains";
export const SEARCH_MATCH_ORDER: Readonly<Record<SearchMatch, number>> = { ref: 0, prefix: 1, word: 2, contains: 3 };

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** `token` metinde bir kelimenin başında geçiyor mu (metin başı ya da öncesinde harf/rakam olmayan bir karakter)? */
function atWordStart(text: string, token: string): boolean {
  for (let i = text.indexOf(token); i !== -1; i = text.indexOf(token, i + 1)) {
    if (i === 0 || !WORD_CHAR.test(text[i - 1])) return true;
  }
  return false;
}

/**
 * Başlığın aramayla eşleşme düzeyi (numara dışı); eşleşmiyorsa null. Çok kelimeli aramada:
 *   "prefix"   → başlık yazılan ifadenin tamamıyla başlıyor,
 *   "word"     → her kelime başlıkta bir kelimenin başında geçiyor (sıra önemsiz),
 *   "contains" → ifade ya da her kelime başlıkta (herhangi bir yerde) geçiyor.
 */
export function matchTitle(title: string, query: string): Exclude<SearchMatch, "ref"> | null {
  const q = searchKey(query);
  if (!q) return null;
  const t = searchKey(title);
  if (t.startsWith(q)) return "prefix";
  const tokens = q.split(" ");
  if (tokens.every((tok) => atWordStart(t, tok))) return "word";
  if (t.includes(q) || tokens.every((tok) => t.includes(tok))) return "contains";
  return null;
}

/** Öneriler sayfasının yerel arama süzgecinin gördüğü alanlar. */
export interface ProposalQueryFields {
  seq: number;
  title: string;
  /** Yazarın takma adı (yoksa yalnız numara ve başlık aranır) */
  authorNickname?: string | null;
}

/**
 * Öneriler sayfasındaki arama kutusunun süzgeci ile 'Tüm önerilerde ara (N öneri)' sayısının (GET /api/search `total.proposals`)
 * ORTAK kuralı; böylece seçenekteki sayı ile gidilen liste aynıdır. Eşleşir:
 *   - numara: "#K-12", "K12" → yalnız 12 numaralı öneri (açık numara başlıkta ve yazarda aranmaz); "12" → numara 12 ya da aşağıdakiler,
 *   - başlık: {@link matchTitle} (kelimeler sırasız, her biri başlığın herhangi bir yerinde; Türkçe duyarsız, boşluk sadeleşir),
 *   - yazar: takma ad aranan ifadeyi içeriyor.
 * Boş (yalnız boşluk) arama her öneriyi geçirir.
 */
export function proposalMatchesQuery(p: ProposalQueryFields, query: string): boolean {
  const q = searchKey(query);
  if (!q) return true;
  const ref = parseSearchRef(query);
  if (ref && ref.kind !== "topic" && p.seq === ref.seq) return true;
  if (ref?.explicit) return false;
  if (matchTitle(p.title, query) !== null) return true;
  return !!p.authorNickname && searchKey(p.authorNickname).includes(q);
}

/** Sıralanabilir arama sonucu (sunucunun SearchHit'i bunu karşılar). */
export interface SearchRankable {
  type: "proposal" | "topic";
  id: string;
  seq: number;
  match: SearchMatch;
  /** Açık/etkin: öneride taslak ya da işleyen evre, konuda yürürlükte (active) */
  open: boolean;
  createdAt: number;
}

/**
 * Arama sırası: eşleşme düzeyi → açık/etkin olanlar önce → yeniler önce (oluşturma anı, sonra numara) → konu önce → kimlik.
 * Toplam (belirlenimci) bir sıradır: aynı girdi her zaman aynı sırayı verir.
 */
export function compareSearchHits(a: SearchRankable, b: SearchRankable): number {
  return (
    SEARCH_MATCH_ORDER[a.match] - SEARCH_MATCH_ORDER[b.match] ||
    Number(b.open) - Number(a.open) ||
    b.createdAt - a.createdAt ||
    b.seq - a.seq ||
    (a.type === b.type ? 0 : a.type === "topic" ? -1 : 1) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
