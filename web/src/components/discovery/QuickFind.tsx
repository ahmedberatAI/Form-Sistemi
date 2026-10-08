// "Hızlı bul": her sayfada üst çubukta önerili arama (WAI-ARIA combobox + listbox).
// - Geniş ekranda (≥ 720 px) üst çubukta metin kutusu; sonuçlar kutunun altında açılan listede.
// - Telefonda üst çubukta büyüteç düğmesi → tam ekran panel (yerel <dialog>: odak tuzağı, Esc ve Android geri tuşu paneli kapatır,
//   lib/native.ts). Alt gezinme (5 sekme) değişmez.
// 2 karakterden sonra (ya da "#K12", "K-12", "#T3" gibi bir numarada) 150 ms bekleyip GET /api/search'e sorar; en çok 8 sonuç
// Konular (#T-n, durum) ve Öneriler (#K-n, evre rozeti) diye gruplanır (sıra sunucunundur), son seçenek 'Tüm önerilerde ara'
// (Öneriler › Tümü, ?ara=). Klavye: ↑ ↓ Enter Esc (saf mantık lib/quickFind.ts › comboKey, birim testli). Durum (sonuç sayısı,
// "Sonuç yok") ekran okuyucuya LiveStatus ile söylenir.
// Yeni sorgunun yanıtı gelene kadar önceki sonuçlar ekranda kalır (titreşim olmasın); seçeneksiz Enter ve '(N öneri)' sayısı ise
// YALNIZ güncel sonuçlarla karar verir (lib/quickFind.ts › submitDecision): numara yazıp yanıt gelmeden Enter'a basılırsa yanıt beklenir.
// İki biçim aynı metni ve "meşguliyeti" paylaşır (useSharedFind): telefon döndürülüp 720 px aşılınca yazılan metin ve odak kaybolmaz —
// panel açıkken genişleyen ekranda metin üst çubuk kutusuna geçer ve odak ona taşınır; kutuda yazarken daralan ekranda panel açılır.
// Erişilebilir ad 'Hızlı bul': e2e'nin aradığı adlarla ('Ara', 'Konu ara', 'Başlık', 'Sözlükte ara' …) alt dize çakışması yoktur ve
// üst çubukta role="search" kullanılmaz (e2e sayfadaki TEK search bölgesini Konular/Öneriler süzgeci sayar).
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { SearchResponse } from "@forum/shared";
import { search } from "../../api/endpoints";
import { useDebounced, useMediaQuery } from "../../lib/hooks";
import {
  comboKey,
  COMBO_CLOSED,
  currentResults,
  groupHits,
  highlightTitle,
  hitRef,
  quickFindOptions,
  quickFindQuery,
  quickFindStatus,
  QUICK_FIND_DELAY_MS,
  QUICK_FIND_LIMIT,
  QUICK_FIND_MAX_CHARS,
  submitDecision,
  type ComboState,
  type QuickFindOption,
} from "../../lib/quickFind";
import { cx, Icon, LiveStatus, StatusBadge } from "../../ui";
import "./discovery.css";

/** Bu genişlikten itibaren üst çubukta metin kutusu; altında büyüteç düğmesi + panel. */
export const QUICK_FIND_INLINE_QUERY = "(min-width: 720px)";

/** Erişilebilir ad (metin kutusu, büyüteç düğmesi ve panel). */
export const QUICK_FIND_LABEL = "Hızlı bul";

const PLACEHOLDER = "Öneri ya da konu bul (#K12)";
const HINT = "Öneri ya da konu adından en az 2 harf ya da #K12, #T3 gibi bir numara yazın.";

// ───────────── İki biçimin paylaştığı durum (kırılma noktası aşılınca metin ve odak kaybolmasın) ─────────────

interface SharedFind {
  /** Kutudaki metin */
  text: string;
  /** Kullanıcı aramayla meşgul: üst çubuk kutusu odakta ya da telefon paneli açık */
  engaged: boolean;
}

let shared: SharedFind = { text: "", engaged: false };
const listeners = new Set<() => void>();

function setShared(patch: Partial<SharedFind>): void {
  const next = { ...shared, ...patch };
  if (next.text === shared.text && next.engaged === shared.engaged) return;
  shared = next;
  for (const l of listeners) l();
}

const subscribeShared = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function useSharedFind(): SharedFind {
  return useSyncExternalStore(subscribeShared, () => shared, () => shared);
}

/** Yalnız testler: paylaşılan durumu sıfırlar. */
export function resetQuickFindState(): void {
  shared = { text: "", engaged: false };
}

/** Odak geri verilecek yer: panel açılmadan önce odaktaki öğe hâlâ sayfadaysa o; değilse görünen arama denetimi (kutu ya da büyüteç). */
function restoreFocus(prev: HTMLElement | null): void {
  if (prev && prev !== document.body && prev.isConnected) {
    prev.focus?.();
    return;
  }
  (document.querySelector<HTMLElement>(".app-header .qf-inline input.qf-input") ?? document.querySelector<HTMLElement>(".app-header .header-search-btn"))?.focus();
}

interface FetchState {
  /** Sonuçların ait olduğu sorgu */
  q: string | null;
  res: SearchResponse | null;
  loading: boolean;
  error: boolean;
}

const IDLE: FetchState = { q: null, res: null, loading: false, error: false };

export interface QuickFindProps {
  /** inline: üst çubuktaki kutu (sonuçlar açılan listede) · panel: telefon paneli (sonuçlar panelin gövdesi) */
  variant: "inline" | "panel";
  /** Bir seçenek seçilip gidildiğinde (panel kapanır) */
  onNavigate?: () => void;
  /** Panelde Esc (panel kapanır) */
  onDismiss?: () => void;
  autoFocus?: boolean;
  /** Metin kutusunun solundaki öğe (panelde 'Geri' düğmesi) */
  leading?: ReactNode;
}

export function QuickFind({ variant, onNavigate, onDismiss, autoFocus, leading }: QuickFindProps) {
  const navigate = useNavigate();
  const base = useId();
  const inputId = `${base}-q`;
  const listId = `${base}-lb`;
  const hintId = `${base}-hint`;
  const optionId = (o: QuickFindOption) => `${base}-o-${o.key}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const { text } = useSharedFind();
  const setText = (v: string) => setShared({ text: v });
  const [combo, setCombo] = useState<ComboState>(COMBO_CLOSED);
  const [fetched, setFetched] = useState<FetchState>(IDLE);
  /** Numara yazılıp güncel yanıt gelmeden Enter'a basıldı: yanıt gelince karar verilecek metin */
  const [pending, setPending] = useState<string | null>(null);
  const panel = variant === "panel";

  const query = quickFindQuery(useDebounced(text, QUICK_FIND_DELAY_MS));
  const typed = quickFindQuery(text);

  useEffect(() => {
    if (!query) {
      setFetched(IDLE);
      return;
    }
    const ctrl = new AbortController();
    // Önceki sonuçlar yenisi gelene kadar ekranda kalır (titreşim olmasın); durum satırı "Aranıyor…" yalnız ilk aramada.
    setFetched((prev) => ({ q: prev.q, res: prev.res, loading: true, error: false }));
    search(query, QUICK_FIND_LIMIT, { signal: ctrl.signal }).then(
      (res) => setFetched({ q: query, res, loading: false, error: false }),
      () => {
        if (!ctrl.signal.aborted) setFetched({ q: query, res: null, loading: false, error: true });
      },
    );
    return () => ctrl.abort();
  }, [query]);

  // Geniş ekrana geçişte (panel açıkken telefon yataya çevrildi) kullanıcı aramayla meşgulse odak yeni kutuya taşınır.
  useEffect(() => {
    if (!panel && shared.engaged) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kutu sayfadan kalkarken (yerleşim etkisinin temizliği DOM'dan çıkarılmadan önce çalışır): kullanıcı yazıyorsa meşguliyet sürer —
  // dar ekranda panel metinle açılır. Kaldırma sırasında tarayıcının gönderebileceği blur bu yüzden yok sayılır (alive).
  const alive = useRef(true);
  useLayoutEffect(() => {
    alive.current = true;
    const input = inputRef.current;
    return () => {
      alive.current = false;
      if (!panel && input && document.activeElement === input) setShared({ engaged: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Metin kısalıp arama dışına düşünce eski sonuçlar gösterilmez. Gösterilen (belki bir önceki sorgunun) ve GÜNCEL sonuçlar ayrıdır.
  const res = typed ? fetched.res : null;
  const current = currentResults(text, fetched.q, fetched.res);
  const groups = useMemo(() => groupHits(res?.items ?? []), [res]);
  const options = useMemo(() => (typed ? quickFindOptions(groups, text) : []), [groups, typed, text]);
  const hitCount = res?.items.length ?? 0;
  const shownProposals = current?.items.filter((h) => h.type === "proposal").length ?? 0;
  const moreProposals = current && current.total.proposals > shownProposals ? current.total.proposals : null;

  // Panelde sonuç alanı hep görünür; üst çubukta liste yalnız açıkken.
  const expanded = !!typed && (panel || combo.open);
  const active = expanded && combo.active >= 0 && combo.active < options.length ? options[combo.active] : null;
  const status = quickFindStatus({ query: typed ? query : null, loading: fetched.loading || pending !== null, error: fetched.error, res });

  // Etkin seçenek görünür alanda kalsın (uzun listede ↓ ile inerken).
  useEffect(() => {
    if (!active) return;
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.key]);

  // Seçilen sayfaya gider. Yol değişirse kabuk (AppLayout) odağı sayfa içeriğine taşır; aynı yolda (ör. Öneriler'deyken 'Tüm
  // önerilerde ara') odak boşalan metin kutusunda kalır.
  const go = (href: string) => {
    setShared({ text: "" });
    setPending(null);
    setCombo(COMBO_CLOSED);
    setFetched(IDLE);
    navigate(href);
    onNavigate?.();
  };

  // Bekleyen Enter: yazılan numaranın yanıtı (ya da hatası) gelince karar verilir.
  useEffect(() => {
    if (!pending || fetched.loading || fetched.q !== pending) return;
    const d = submitDecision(pending, fetched.res, fetched.error);
    setPending(null);
    if (d?.kind === "go") go(d.href);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, fetched]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const r = comboKey(combo, e.key, options.length, { altKey: e.altKey, mode: variant, hasText: text.length > 0 });
    if (r.handled) e.preventDefault();
    setCombo(r.state);
    if (r.action === "select" && options[r.state.active]) go(options[r.state.active].href);
    else if (r.action === "submit" && typed) {
      const d = submitDecision(text, current, fetched.q === typed && fetched.error);
      if (d?.kind === "go") go(d.href);
      else if (d?.kind === "wait") setPending(typed);
    } else if (r.action === "clear") setText("");
    else if (r.action === "dismiss") onDismiss?.();
  };

  const optionRow = (o: QuickFindOption, i: number) => {
    const selected = active?.key === o.key;
    const common = {
      id: optionId(o),
      role: "option" as const,
      "aria-selected": selected,
      className: cx("qf-option", selected && "is-active", o.kind === "all" && "qf-option-all"),
      // Tıklama metin kutusundan odağı almasın (liste kapanmasın); seçim click ile yapılır.
      onMouseDown: (e: MouseEvent) => e.preventDefault(),
      onMouseMove: () => (combo.active !== i ? setCombo({ open: true, active: i }) : undefined),
      onClick: () => go(o.href),
    };
    if (o.kind === "all") {
      return (
        <div key={o.key} {...common}>
          <Icon name="search" size={16} className="qf-option-icon" />
          <span className="qf-option-main">
            Tüm önerilerde ara{moreProposals ? ` (${moreProposals} öneri)` : ""}{" "}
            <span className="qf-option-term">“{typed}”</span>
          </span>
        </div>
      );
    }
    const h = o.hit;
    return (
      <div key={o.key} {...common}>
        <span className="qf-ref">{hitRef(h)}</span>{" "}
        <span className="qf-title">
          {highlightTitle(h.title, text).map((p, k) => (p.hit ? <mark key={k}>{p.text}</mark> : <span key={k}>{p.text}</span>))}
        </span>{" "}
        {h.type === "proposal" ? (
          <StatusBadge status={h.status} />
        ) : (
          <span className="qf-meta">{h.status === "active" ? "Yürürlükte" : "Arşivlendi"}</span>
        )}
      </div>
    );
  };

  let index = -1;
  const body = (
    <div className={cx("qf-results", !panel && "qf-popup")} hidden={!expanded}>
      {res && hitCount === 0 ? <p className="qf-empty">Sonuç yok</p> : null}
      {!res && fetched.error ? <p className="qf-empty">Arama yapılamadı.</p> : null}
      {!res && !fetched.error && typed ? <p className="qf-empty qf-loading">Aranıyor…</p> : null}
      <div role="listbox" id={listId} aria-label={`${QUICK_FIND_LABEL} sonuçları`} className="qf-listbox">
        {groups.map((g) => {
          const gid = `${base}-g-${g.type}`;
          return (
            <div key={g.type} role="group" aria-labelledby={gid} className="qf-group">
              <div role="presentation" id={gid} className="qf-group-label">
                {g.label}
              </div>
              {g.hits.map(() => {
                index++;
                return optionRow(options[index], index);
              })}
            </div>
          );
        })}
        {options.length && options[options.length - 1].kind === "all" ? optionRow(options[options.length - 1], options.length - 1) : null}
      </div>
    </div>
  );

  return (
    <div
      className={cx("qf", panel ? "qf-panel" : "qf-inline")}
      onFocus={() => {
        if (!panel) setShared({ engaged: true });
      }}
      onBlur={(e) => {
        // Odak bileşenin dışına çıkınca liste kapanır (seçenekler odak almaz; tıklama metin kutusunda kalır). Kutu kırılma noktası
        // aşıldığı için sayfadan kalkıyorsa meşguliyet sürer (telefon panelinde devam edilir).
        if (panel || !alive.current || e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setCombo(COMBO_CLOSED);
        if (e.currentTarget.isConnected) setShared({ engaged: false });
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        {QUICK_FIND_LABEL}
      </label>
      <div className="qf-row">
        {leading}
        <div className="qf-field">
        <Icon name="search" size={18} className="qf-field-icon" />
        <input
          ref={inputRef}
          id={inputId}
          className="input qf-input"
          type="text"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active ? optionId(active) : undefined}
          aria-describedby={panel && !typed ? hintId : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="search"
          inputMode="search"
          maxLength={QUICK_FIND_MAX_CHARS}
          placeholder={PLACEHOLDER}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            setPending(null);
            setCombo({ open: !!quickFindQuery(v), active: -1 });
          }}
          onFocus={() => {
            if (typed) setCombo((c) => ({ open: true, active: c.active }));
          }}
          onKeyDown={onKeyDown}
        />
        {fetched.loading ? <span className="spinner spinner-sm qf-spinner" aria-hidden="true" /> : null}
        </div>
      </div>
      {panel && !typed ? (
        <p className="qf-hint small muted" id={hintId}>
          {HINT}
        </p>
      ) : null}
      {body}
      <LiveStatus message={status} />
    </div>
  );
}

/**
 * Telefon paneli: tam ekran yerel <dialog>. Esc, 'Geri' düğmesi ve Android geri tuşu (lib/native.ts › "cancel") kapatır (`onClose`:
 * kullanıcı kapattı → metin silinir). Kırılma noktası aşıldığı için sayfadan kalkarsa metin ve meşguliyet korunur (kutuda sürer).
 */
function QuickFindDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const prev = document.activeElement as HTMLElement | null;
    try {
      if (!d.open) d.showModal();
    } catch {
      d.setAttribute("open", "");
    }
    document.body.classList.add("modal-open");
    setShared({ engaged: true });
    // showModal ilk odaklanabilir öğeye ('Geri') odaklanır; panel yalnız arama için açıldığından odak metin kutusuna taşınır.
    d.querySelector<HTMLInputElement>("input.qf-input")?.focus();
    return () => {
      try {
        if (d.open) d.close();
      } catch {
        /* yok say */
      }
      if (!document.querySelector("dialog[open]")) document.body.classList.remove("modal-open");
      // Açan öğe (büyüteç) kırılma noktası aşıldığı için kalktıysa odak görünen arama denetimine verilir (WCAG 2.4.3).
      restoreFocus(prev);
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="qf-dialog"
      aria-label={QUICK_FIND_LABEL}
      onCancel={(e) => {
        e.preventDefault();
        closeRef.current();
      }}
    >
      <div className="qf-dialog-inner">
        <QuickFind
          variant="panel"
          autoFocus
          onNavigate={() => closeRef.current()}
          onDismiss={() => closeRef.current()}
          leading={
            <button type="button" className="icon-btn" aria-label="Geri" onClick={() => closeRef.current()}>
              <Icon name="back" size={20} />
            </button>
          }
        />
      </div>
    </dialog>
  );
}

/** Geniş ekranda (≥ 720 px) üst çubuktaki metin kutusu. */
export function QuickFindInline() {
  return (
    <div className="header-search">
      <QuickFind variant="inline" />
    </div>
  );
}

/**
 * Telefonda üst çubuktaki büyüteç düğmesi: tam ekran 'Hızlı bul' panelini açar. Geniş ekrandaki kutuda yazarken ekran daraldıysa
 * (telefon dikeye çevrildi) panel yazılan metinle açık gelir.
 */
export function QuickFindButton() {
  const [open, setOpen] = useState(() => shared.engaged && shared.text.trim() !== "");
  const close = () => {
    // Kullanıcı kapattı: yeniden açılınca metin boş başlar.
    setShared({ text: "", engaged: false });
    setOpen(false);
  };
  return (
    <>
      <button type="button" className="icon-btn header-search-btn" aria-label={QUICK_FIND_LABEL} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <Icon name="search" size={20} />
      </button>
      {open ? <QuickFindDialog onClose={close} /> : null}
    </>
  );
}

/** Üst çubuk hangi biçimi kullanmalı: true → metin kutusu (QuickFindInline), false → büyüteç (QuickFindButton). */
export const useInlineQuickFind = (): boolean => useMediaQuery(QUICK_FIND_INLINE_QUERY);
