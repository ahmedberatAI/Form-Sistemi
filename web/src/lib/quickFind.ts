// "Hızlı bul" (üst çubuktaki önerili arama) için SAF mantık: istek metni, sonuçların gruplanması, seçenek listesi, bağlantılar,
// başlıkta eşleşen parçaların işaretlenmesi, durum iletisi ve WAI-ARIA combobox klavye davranışı. React/DOM yok; birim testli
// (quickFind.test.ts). Eşleşme ve sıralama kuralı sunucudadır (GET /api/search; ortak kural shared/src/search.ts): istemci
// sunucunun sırasını DEĞİŞTİRMEZ, yalnız türe göre gruplar (grup içinde sıra aynen kalır).
import { normalizeSearch, parseSearchRef, searchKey, searchReady, SEARCH_LIMIT_MAX, SEARCH_QUERY_MAX, type SearchHit, type SearchResponse } from "@forum/shared";
import { proposalRef, topicRef } from "./format";
import { routes } from "./routes";

/** Yazmayı bırakınca istek bu kadar sonra gider (ms). */
export const QUICK_FIND_DELAY_MS = 150;
/** Gösterilen en çok sonuç (sunucu üst sınırı). */
export const QUICK_FIND_LIMIT = SEARCH_LIMIT_MAX;
/** Arama kutusunun en çok karakteri (sunucu daha uzununu 400 ile reddeder). */
export const QUICK_FIND_MAX_CHARS = SEARCH_QUERY_MAX;

/** Sunucuya gidecek metin: kırpılmış, en çok 100 karakter; arama tetiklenmeyecekse (2 karakterden kısa ve numara değil) null. */
export function quickFindQuery(raw: string): string | null {
  const q = String(raw ?? "")
    .trim()
    .slice(0, SEARCH_QUERY_MAX)
    .trim();
  return q && searchReady(q) ? q : null;
}

export type QuickFindGroupType = SearchHit["type"];

export interface QuickFindGroup {
  type: QuickFindGroupType;
  /** Grup başlığı: "Konular" | "Öneriler" */
  label: string;
  hits: SearchHit[];
}

export const GROUP_LABELS: Record<QuickFindGroupType, string> = { topic: "Konular", proposal: "Öneriler" };

/**
 * Sonuçları türe göre gruplar. Grup içinde sunucu sırası aynen korunur; gruplar, en iyi (ilk) sonuçlarının sunucu sırasındaki
 * yerine göre dizilir: "#K12" yazana önce Öneriler, bir konu başlığıyla başlayan metni yazana önce Konular gelir.
 */
export function groupHits(items: readonly SearchHit[]): QuickFindGroup[] {
  const groups: QuickFindGroup[] = [];
  for (const hit of items) {
    let g = groups.find((x) => x.type === hit.type);
    if (!g) {
      g = { type: hit.type, label: GROUP_LABELS[hit.type], hits: [] };
      groups.push(g);
    }
    g.hits.push(hit);
  }
  return groups;
}

export const hitRef = (hit: SearchHit): string => (hit.type === "proposal" ? proposalRef(hit.seq) : topicRef(hit.seq));
export const hitHref = (hit: SearchHit): string => (hit.type === "proposal" ? routes.proposal(hit.id) : routes.topic(hit.id));

/**
 * 'Tüm önerilerde ara' hedefi: Öneriler › Tümü sekmesi, arama kutusu dolu (?ara=). Numara yazıldıysa ("K12", "#12") listedeki
 * biçimiyle ("#K-12") aranır; Öneriler sayfası numarayı bu biçimde eşler.
 */
export function allProposalsHref(q: string): string {
  const text = q.trim().slice(0, SEARCH_QUERY_MAX);
  const ref = parseSearchRef(text);
  const term = ref && ref.kind !== "topic" && ref.explicit ? proposalRef(ref.seq) : text;
  const sp = new URLSearchParams({ sekme: "tumu", ara: term });
  return `${routes.proposals()}?${sp.toString()}`;
}

/** Seçenek: bir sonuç ya da en sondaki 'Tüm önerilerde ara'. `key` DOM kimliğinin sonekidir (benzersiz). */
export type QuickFindOption = { kind: "hit"; key: string; hit: SearchHit; href: string } | { kind: "all"; key: "tumu"; href: string };

/** Görsel sırayla (gruplar, ardından 'Tüm önerilerde ara') düz seçenek listesi; klavye ile gezinme bu sırayı izler. */
export function quickFindOptions(groups: readonly QuickFindGroup[], q: string): QuickFindOption[] {
  const out: QuickFindOption[] = [];
  for (const g of groups) for (const hit of g.hits) out.push({ kind: "hit", key: `${hit.type}-${hit.id}`, hit, href: hitHref(hit) });
  if (quickFindQuery(q)) out.push({ kind: "all", key: "tumu", href: allProposalsHref(q) });
  return out;
}

/** Ekran okuyucuya söylenen durum (LiveStatus): "Aranıyor…", "Sonuç yok", "5 sonuç: 2 konu, 3 öneri" ya da hata. */
export function quickFindStatus(s: { query: string | null; loading: boolean; error: boolean; res: Pick<SearchResponse, "items"> | null }): string {
  if (!s.query) return "";
  if (s.loading && !s.res) return "Aranıyor…";
  if (s.error && !s.res) return "Arama yapılamadı. Tüm önerilerde aramayı deneyin.";
  if (!s.res) return "";
  const n = s.res.items.length;
  if (n === 0) return "Sonuç yok";
  const topics = s.res.items.filter((h) => h.type === "topic").length;
  const parts = [topics ? `${topics} konu` : null, n - topics ? `${n - topics} öneri` : null].filter(Boolean).join(", ");
  return `${n} sonuç: ${parts}`;
}

// ───────────── Başlıkta eşleşen parçalar ─────────────

export interface TitlePart {
  text: string;
  /** Aranan kelimeyle eşleşen parça (<mark>) */
  hit: boolean;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Başlığı, aranan kelimelerin geçtiği parçalar işaretlenmiş olarak böler (saf). Eşleşme sunucuyla aynı Türkçe duyarsız kuraldır
 * (normalizeSearch: "cevre" ~ "Çevre", "istanbul" ~ "İstanbul"); her kelimenin önce kelime başındaki, yoksa ilk geçtiği yeri
 * işaretlenir. Numara aramasında (ör. "#K12") başlık işaretlenmez. Parçalar birleştirilince başlığın kendisi çıkar.
 */
export function highlightTitle(title: string, query: string): TitlePart[] {
  const text = String(title ?? "");
  const q = searchKey(query ?? "");
  if (!text || !q || (parseSearchRef(query)?.explicit ?? false)) return text ? [{ text, hit: false }] : [];
  // Karakter karakter normalleştirme: normalleştirilmiş metindeki her konumun özgün metindeki karakter başlangıcı bilinir.
  const chars = Array.from(text);
  let norm = "";
  const startOf: number[] = []; // norm konumu → chars dizini
  chars.forEach((ch, i) => {
    const n = /\s/.test(ch) ? " " : normalizeSearch(ch);
    for (let k = 0; k < n.length; k++) startOf.push(i);
    norm += n;
  });
  const ranges: [number, number][] = []; // chars dizinleri [başlangıç, bitiş)
  for (const tok of [...new Set(q.split(" ").filter(Boolean))]) {
    let at = -1;
    for (let i = norm.indexOf(tok); i !== -1; i = norm.indexOf(tok, i + 1)) {
      if (at === -1) at = i;
      if (i === 0 || !WORD_CHAR.test(norm[i - 1])) {
        at = i;
        break;
      }
    }
    if (at === -1) continue;
    const from = startOf[at];
    let end = startOf[at + tok.length - 1] + 1;
    // Ayrık yazılmış birleşen işaretler (ör. "c" + U+0327) normalleşince kaybolur: işaretlenen parçaya dahil edilir.
    while (end < chars.length && normalizeSearch(chars[end]) === "" && !/\s/.test(chars[end])) end++;
    ranges.push([from, end]);
  }
  if (!ranges.length) return [{ text, hit: false }];
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const top = merged[merged.length - 1];
    if (top && r[0] <= top[1]) top[1] = Math.max(top[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const parts: TitlePart[] = [];
  let pos = 0;
  for (const [a, b] of merged) {
    if (a > pos) parts.push({ text: chars.slice(pos, a).join(""), hit: false });
    parts.push({ text: chars.slice(a, b).join(""), hit: true });
    pos = b;
  }
  if (pos < chars.length) parts.push({ text: chars.slice(pos).join(""), hit: false });
  return parts;
}

// ───────────── Klavye (WAI-ARIA combobox, liste açılır penceresi) ─────────────

export interface ComboState {
  /** Liste görünür mü (aria-expanded) */
  open: boolean;
  /** Etkin seçenek (aria-activedescendant); -1: yok, odak ve yazma imleci metin kutusunda */
  active: number;
}

/** Tuşun sonucu: `select` etkin seçeneğe git · `submit` seçenek yokken Enter · `clear` metni sil · `dismiss` paneli bitir. */
export type ComboAction = "select" | "submit" | "clear" | "dismiss" | null;

export interface ComboKeyResult {
  state: ComboState;
  action: ComboAction;
  /** true: tarayıcının varsayılan davranışı engellenmeli (preventDefault) */
  handled: boolean;
}

export const COMBO_CLOSED: ComboState = { open: false, active: -1 };

/**
 * Metin kutusundaki tuşun sonucu (saf). APG "Combobox With Listbox Popup" deseni:
 * - ↓: liste kapalıysa açar ve ilk seçeneği etkinleştirir (Alt+↓ yalnız açar); açıksa sonrakine geçer (sondan başa döner).
 * - ↑: liste kapalıysa açar ve son seçeneği etkinleştirir; açıksa öncekine geçer (baştan sona döner).
 * - Enter: etkin seçenek varsa onu seçer; yoksa `submit` (çağıran 'Tüm önerilerde ara'ya ya da numara eşleşmesine gider).
 * - Esc: üst çubuktaki kutuda liste açıksa yalnız kapatır, kapalıysa metni siler (`clear`). Telefon panelinde sonuçlar panelin
 *   kendisidir: Esc paneli bitirir (`dismiss`; engellenmez, yerel <dialog> da Esc ile kapanır).
 * - Tab: listeyi kapatır, odak doğal sırayla ilerler (engellenmez).
 * - ←, →, Home, End: yazma imleci metin kutusunda kalır, etkin seçenek bırakılır (engellenmez).
 * `count`: seçenek sayısı (0 ise ok tuşları listeyi yalnız açar: "Sonuç yok" görünür).
 */
export function comboKey(state: ComboState, key: string, count: number, opts: { altKey?: boolean; mode: "inline" | "panel"; hasText: boolean }): ComboKeyResult {
  const same = (handled = false): ComboKeyResult => ({ state, action: null, handled });
  switch (key) {
    case "ArrowDown": {
      if (count <= 0) return { state: { open: opts.hasText, active: -1 }, action: null, handled: true };
      if (opts.altKey) return { state: { open: true, active: state.open ? state.active : -1 }, action: null, handled: true };
      if (!state.open) return { state: { open: true, active: 0 }, action: null, handled: true };
      return { state: { open: true, active: state.active >= count - 1 ? 0 : state.active + 1 }, action: null, handled: true };
    }
    case "ArrowUp": {
      if (count <= 0) return { state: { open: opts.hasText, active: -1 }, action: null, handled: true };
      if (!state.open) return { state: { open: true, active: count - 1 }, action: null, handled: true };
      return { state: { open: true, active: state.active <= 0 ? count - 1 : state.active - 1 }, action: null, handled: true };
    }
    case "Enter": {
      if (state.open && state.active >= 0 && state.active < count) return { state, action: "select", handled: true };
      return opts.hasText ? { state, action: "submit", handled: true } : same();
    }
    case "Escape": {
      if (opts.mode === "panel") return { state: COMBO_CLOSED, action: "dismiss", handled: false };
      if (state.open) return { state: COMBO_CLOSED, action: null, handled: true };
      return opts.hasText ? { state, action: "clear", handled: true } : same();
    }
    case "Tab":
      return { state: COMBO_CLOSED, action: null, handled: false };
    case "ArrowLeft":
    case "ArrowRight":
    case "Home":
    case "End":
      return state.active >= 0 ? { state: { open: state.open, active: -1 }, action: null, handled: false } : same();
    default:
      return same();
  }
}

/**
 * Sonuçlar bu metnin mi (saf)? Yeni sorgunun yanıtı gelene kadar öncekinin sonuçları ekranda kalır (titreşim olmasın); ama Enter
 * kararı ve 'Tüm önerilerde ara (N öneri)' sayısı yalnız GÜNCEL sonuçlarla verilir. `fetchedQuery`: sonuçların ait olduğu sorgu.
 */
export function currentResults<R>(text: string, fetchedQuery: string | null, res: R | null): R | null {
  const q = quickFindQuery(text);
  return q !== null && fetchedQuery === q ? res : null;
}

/**
 * Seçenek yokken Enter'ın hedefi (saf), yazılan metnin GÜNCEL sonuçlarıyla: numara aramasında ilk sonuç aynı numaranın ve türün tam
 * eşleşmesiyse ("K12" → #K-12) doğrudan ona; değilse 'Tüm önerilerde ara'. Arama tetiklenmeyecek metinde null.
 */
export function submitTarget(res: Pick<SearchResponse, "items">, text: string): string | null {
  const q = quickFindQuery(text);
  if (!q) return null;
  const ref = parseSearchRef(q);
  const first = res.items[0];
  if (ref && first && first.match === "ref" && first.seq === ref.seq && (ref.kind === null || ref.kind === first.type)) return hitHref(first);
  return allProposalsHref(q);
}

/** Seçeneksiz Enter'ın sonucu: git · güncel sonuçları bekle · hiçbir şey yapma (null). */
export type SubmitDecision = { kind: "go"; href: string } | { kind: "wait" } | null;

/**
 * Seçeneksiz Enter kararı (saf). `current`: YALNIZ bu metnin sonuçları ({@link currentResults}); ekranda daha eski bir sorgunun
 * sonuçları dursa da karar onlarla verilmez — "#K1" sonuçları görünürken "2" yazıp hemen Enter'a basan #K-1'e değil #K-12'ye gider.
 *  - Metin numara değilse sonuç beklenmez: 'Tüm önerilerde ara'.
 *  - Numaraysa: güncel sonuç varsa {@link submitTarget}; arama hata verdiyse 'Tüm önerilerde ara'; yoksa `wait` (yanıt gelince karar).
 */
export function submitDecision(text: string, current: Pick<SearchResponse, "items"> | null, failed = false): SubmitDecision {
  const q = quickFindQuery(text);
  if (!q) return null;
  if (!parseSearchRef(q) || failed) return { kind: "go", href: allProposalsHref(q) };
  if (current) return { kind: "go", href: submitTarget(current, q) ?? allProposalsHref(q) };
  return { kind: "wait" };
}
