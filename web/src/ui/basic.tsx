// Temel görsel bileşenler: düğme, kart, rozet, uyarı, boş durum, ilerleme, başlıklar, tablolar.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Link, useNavigate, type LinkProps } from "react-router-dom";
import { resolveDefaultOpen, useDetailLevel } from "../lib/detailLevel";
import { Icon, type IconName } from "./Icon";

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(" ");

/**
 * Renk rolleri (src/README.md › Görsel dil): info = mavi, eylem ve 'şu an' (birincil maviyle aynı renk) · success / danger =
 * sonuç (ve danger: hata) · warning = dikkat ve süre · accent = mor, YALNIZ yapay zekâ · neutral = gri, geri kalan her şey.
 * Rozet bütçesi: nesne başına en çok 1 renkli durum rozeti. Renk her zaman metin (ve çoğu kez simge) ile birlikte kullanılır.
 */
export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

// ───────────── Düğmeler ─────────────

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  /** true → devre dışı + dönen simge + aria-busy */
  loading?: boolean;
  /** Tam genişlik */
  block?: boolean;
  icon?: IconName;
}

export function Button({ variant = "secondary", size = "md", loading = false, block, icon, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("btn", `btn-${variant}`, size === "sm" && "btn-sm", block && "btn-block", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner spinner-sm" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === "sm" ? 16 : 18} /> : null}
      {children}
    </button>
  );
}

export interface LinkButtonProps extends LinkProps {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  block?: boolean;
  icon?: IconName;
}

/** Düğme görünümlü react-router bağlantısı. */
export function LinkButton({ variant = "secondary", size = "md", block, icon, className, children, ...rest }: LinkButtonProps) {
  return (
    <Link className={cx("btn", `btn-${variant}`, size === "sm" && "btn-sm", block && "btn-block", className)} {...rest}>
      {icon ? <Icon name={icon} size={size === "sm" ? 16 : 18} /> : null}
      {children}
    </Link>
  );
}

// ───────────── Açılım altyapısı (katlanabilir kart, Details) ─────────────

/**
 * Bölüm açma olayı. Bir öğede `bubbles: true` ile tetiklenirse o öğeyi içeren katlanmış kartların hepsi açılır
 * (derin bağlantı: lib/sectionParam.ts). `bubbles: false` ile yalnız o kartı açar/kapatır (setSectionsOpen).
 */
export const SECTION_OPEN_EVENT = "forum:section-open";

export interface SectionOpenDetail {
  open: boolean;
}

/**
 * Hedefi görünür kılar: onu içeren yerel <details> öğelerini ve katlanmış kartları açar. Güncellemelerin DOM'a
 * işlenmesi için çağıran flushSync içinde çalıştırmalıdır; kaydırma ve odak da çağıranın işidir.
 */
export function revealSection(target: Element): void {
  for (let el: Element | null = target; el; el = el.parentElement) {
    if (el.tagName === "DETAILS") (el as HTMLDetailsElement).open = true;
  }
  target.dispatchEvent(new CustomEvent<SectionOpenDetail>(SECTION_OPEN_EVENT, { bubbles: true, detail: { open: true } }));
}

/** `root` içindeki bütün katlanabilir kartları açar ya da kapatır ("Tümünü aç / Tümünü kapat"). */
export function setSectionsOpen(root: ParentNode, open: boolean): void {
  for (const el of Array.from(root.querySelectorAll(".card-collapsible"))) {
    el.dispatchEvent(new CustomEvent<SectionOpenDetail>(SECTION_OPEN_EVENT, { detail: { open } }));
  }
}

/** Tarayıcı hidden="until-found" ve beforematch destekliyorsa true (Chromium 102+, Android WebView dahil). */
function canFindInHidden(): boolean {
  try {
    return typeof document !== "undefined" && "onbeforematch" in document.documentElement;
  } catch {
    return false;
  }
}

/**
 * Açık/kapalı durumu. İlk değer `explicit` ?? görünüm yoğunluğu (sade → kapalı, tam → açık). Kullanıcı dokunmadıysa
 * yoğunluk değişince (Ayarlar ya da Android'de kalıcı depodan gecikmeli okuma) yeni varsayılana uyar.
 * `followExplicit`: `explicit` sonradan değişirse (Details open={...}) o da uygulanır; Card için yalnız ilk değer sayılır.
 */
function useDisclosure(explicit: boolean | undefined, openInFull: boolean, followExplicit: boolean): [boolean, (open: boolean) => void] {
  const { level } = useDetailLevel();
  const [open, setOpenState] = useState(() => resolveDefaultOpen(explicit, level, openInFull));
  const touched = useRef(false);
  const lastExplicit = useRef(explicit);

  // Yalnız yoğunluk değişince çalışır; explicit/openInFull o anki çizimden okunur.
  useEffect(() => {
    if (!touched.current) setOpenState(resolveDefaultOpen(explicit, level, openInFull));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  useEffect(() => {
    if (!followExplicit || lastExplicit.current === explicit) return;
    lastExplicit.current = explicit;
    touched.current = false;
    setOpenState(resolveDefaultOpen(explicit, level, openInFull));
  }, [explicit, followExplicit, level, openInFull]);

  const setOpen = useCallback((next: boolean) => {
    touched.current = true;
    setOpenState(next);
  }, []);
  return [open, setOpen];
}

// ───────────── Kart ─────────────

export interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Başlığın sağındaki düğmeler (katlanabilir kartta da her zaman görünür) */
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Başlık düzeyi (varsayılan h2) */
  headingLevel?: 2 | 3 | 4;
  /**
   * Kart tonu: action = ince mavi kenar (kullanıcıdan eylem bekleyen panel: oy, sayım doğrulama) · warning / danger / success =
   * kalın sol kenar (uyarı ve sonuç) · muted = gri zemin · accent = mor kenar, YALNIZ yapay zekâ içeriği.
   */
  tone?: "default" | "muted" | "action" | "warning" | "danger" | "success" | "accent";
  id?: string;
  /**
   * true → başlık, gövdeyi açıp kapatan düğme olur (WAI-ARIA akordeonu: <h2><button aria-expanded aria-controls>).
   * Gövde DOM'da kalır (hidden); içindeki bileşenler, yoklamalar ve yazılmış formlar kaybolmaz. `title` gerekir ve düz
   * metin olmalıdır (düğmenin içine girer). subtitle katlanabilir kartta gövdenin en üstünde durur (kapalıyken görünmez).
   */
  collapsible?: boolean;
  /** collapsible iken ilk açıklık (yalnız ilk çizimde). Verilmezse 'tam' görünümde açık, 'sade'de kapalı. */
  defaultOpen?: boolean;
  /** false → 'tam' görünümde de varsayılan kapalı (yalnız defaultOpen verilmemişse anlamlı). */
  openInFull?: boolean;
  /**
   * Başlığın altında tek satırlık hüküm ("✔ Uygun · Olağan karar (T0) · 1 uyarı"). Başlığın DIŞINDADIR: bölge (region)
   * adı değişmez; collapsible kartta düğmeye aria-describedby ile bağlanır. Kart kapalıyken de görünür.
   */
  summary?: ReactNode;
  /** summary rengi (renk her zaman metin/simgeyle birlikte kullanılır) */
  summaryTone?: "neutral" | "success" | "warning" | "danger";
  /** Derin bağlantı çapası: bölümün id'si (id yerine). `?bolum=<anchor>` bu kartı açar, kaydırır, odağı taşır. */
  anchor?: string;
}

const summaryClass = (tone: CardProps["summaryTone"]) => cx("card-summary", tone && tone !== "neutral" && `card-summary-${tone}`);

function PlainCard({ title, subtitle, actions, footer, children, className, headingLevel = 2, tone = "default", id, summary, summaryTone, anchor }: CardProps) {
  const H = `h${headingLevel}` as "h2";
  const hid = useId();
  return (
    <section className={cx("card", tone !== "default" && `card-${tone}`, className)} id={anchor ?? id} aria-labelledby={title ? hid : undefined}>
      {(title || actions) && (
        <header className="card-header">
          <div className="card-heading">
            {title ? (
              <H className="card-title" id={hid}>
                {title}
              </H>
            ) : null}
            {summary ? <p className={summaryClass(summaryTone)}>{summary}</p> : null}
            {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </header>
      )}
      <div className="card-body">{children}</div>
      {footer ? <footer className="card-footer">{footer}</footer> : null}
    </section>
  );
}

function CollapsibleCard({ title, subtitle, actions, footer, children, className, headingLevel = 2, tone = "default", id, defaultOpen, openInFull = true, summary, summaryTone, anchor }: CardProps) {
  const H = `h${headingLevel}` as "h2";
  const hid = useId();
  const bodyId = useId();
  const summaryId = useId();
  const [open, setOpen] = useDisclosure(defaultOpen, openInFull, false);
  const sectionRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const hasFooter = !!footer;

  // Kapalı gövde `hidden` ile gizlenir ama DOM'da bağlı kalır. Destekleyen tarayıcıda öznitelik hidden="until-found"a
  // yükseltilir: sayfa içi arama bulur ve beforematch ile kartı açar. React 19 `hidden` özelliğini yalnız boolean yazar
  // ("until-found" geçmez), bu yüzden yükseltme elle yapılır; `hidden` özelliği ilk işaretlemeyi ve (destek yoksa) geri dönüşü sağlar.
  useLayoutEffect(() => {
    if (open || !canFindInHidden()) return;
    for (const el of [bodyRef.current, footerRef.current]) el?.setAttribute("hidden", "until-found");
  }, [open, hasFooter]);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<SectionOpenDetail>).detail;
      if (typeof d?.open === "boolean") setOpen(d.open);
    };
    const onFound = () => setOpen(true);
    el.addEventListener(SECTION_OPEN_EVENT, onOpen);
    el.addEventListener("beforematch", onFound);
    return () => {
      el.removeEventListener(SECTION_OPEN_EVENT, onOpen);
      el.removeEventListener("beforematch", onFound);
    };
  }, [setOpen]);

  return (
    <section
      ref={sectionRef}
      className={cx("card", "card-collapsible", open && "is-open", tone !== "default" && `card-${tone}`, className)}
      id={anchor ?? id}
      aria-labelledby={hid}
    >
      <header className="card-header">
        <div className="card-heading">
          <H className="card-title" id={hid}>
            <button
              type="button"
              className="card-toggle"
              aria-expanded={open}
              aria-controls={bodyId}
              aria-describedby={summary ? summaryId : undefined}
              onClick={() => setOpen(!open)}
            >
              {title}
            </button>
          </H>
          {summary ? (
            <p className={summaryClass(summaryTone)} id={summaryId}>
              {summary}
            </p>
          ) : null}
        </div>
        {actions ? <div className="card-actions">{actions}</div> : null}
      </header>
      <div className="card-body" id={bodyId} ref={bodyRef} hidden={!open}>
        {subtitle ? <p className="card-subtitle card-subtitle-body">{subtitle}</p> : null}
        {children}
      </div>
      {footer ? (
        <footer className="card-footer" ref={footerRef} hidden={!open}>
          {footer}
        </footer>
      ) : null}
    </section>
  );
}

export function Card(props: CardProps) {
  return props.collapsible && props.title ? <CollapsibleCard {...props} /> : <PlainCard {...props} />;
}

// ───────────── Rozet ─────────────

export interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  title?: string;
  icon?: IconName;
  className?: string;
}

export function Badge({ tone = "neutral", children, title, icon, className }: BadgeProps) {
  return (
    <span className={cx("badge", `badge-${tone}`, className)} title={title}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

// ───────────── Yükleniyor ─────────────

export interface SpinnerProps {
  /** Ekran okuyucu metni (varsayılan "Yükleniyor…") */
  label?: string;
  /** Ortalanmış blok olarak (sayfa/kart yüklenirken) */
  block?: boolean;
  /** Etiketi görünür yaz */
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
}

export function Spinner({ label = "Yükleniyor…", block, showLabel, size = "md" }: SpinnerProps) {
  const el = (
    <span className={cx("spinner-wrap", block && "spinner-block")} role="status" aria-live="polite">
      <span className={cx("spinner", size !== "md" && `spinner-${size}`)} aria-hidden="true" />
      {showLabel || block ? <span className="spinner-label">{label}</span> : <span className="sr-only">{label}</span>}
    </span>
  );
  return el;
}

// ───────────── Uyarı kutusu ─────────────

export type AlertTone = "info" | "success" | "warning" | "error";

const ALERT_META: Record<AlertTone, { icon: IconName; sr: string }> = {
  info: { icon: "info", sr: "Bilgi:" },
  success: { icon: "success", sr: "Başarılı:" },
  warning: { icon: "warning", sr: "Uyarı:" },
  error: { icon: "error", sr: "Hata:" },
};

export interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Kapatma düğmesi gösterilir */
  onClose?: () => void;
}

export function Alert({ tone = "info", title, children, actions, className, onClose }: AlertProps) {
  const meta = ALERT_META[tone];
  return (
    <div className={cx("alert", `alert-${tone}`, className)} role={tone === "error" || tone === "warning" ? "alert" : "status"}>
      <Icon name={meta.icon} size={20} className="alert-icon" />
      <div className="alert-content">
        {title ? (
          <p className="alert-title">
            <span className="sr-only">{meta.sr} </span>
            {title}
          </p>
        ) : (
          <span className="sr-only">{meta.sr} </span>
        )}
        {children ? <div className="alert-body">{children}</div> : null}
        {actions ? <div className="alert-actions">{actions}</div> : null}
      </div>
      {onClose ? (
        <button type="button" className="icon-btn alert-close" onClick={onClose} aria-label="Kapat">
          <Icon name="close" size={16} />
        </button>
      ) : null}
    </div>
  );
}

// ───────────── Boş durum ─────────────

export interface EmptyStateProps {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: IconName;
}

export function EmptyState({ title, children, action, icon = "info" }: EmptyStateProps) {
  return (
    <div className="empty">
      <Icon name={icon} size={32} className="empty-icon" />
      <p className="empty-title">{title}</p>
      {children ? <div className="empty-body">{children}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

// ───────────── İlerleme çubuğu ─────────────

export interface ProgressBarProps {
  value: number;
  /** Varsayılan 1 (value 0..1 oranı) */
  max?: number;
  /** Erişilebilir ad (zorunlu): "Katılım", "Destekçi" … */
  label: string;
  /** Çubuğun yanında metin değer (ör. "12/40" ya da "%30") */
  valueText?: string;
  /** Görsel etiket satırını göster */
  showLabel?: boolean;
  /** primary (varsayılan, mavi: süren katılım ve destek) · success / danger sonuç · warning dikkat · accent YALNIZ yapay zekâ */
  tone?: "primary" | "success" | "warning" | "danger" | "accent";
  /** Eşik işareti (aynı ölçekte; ör. taban 0,4) */
  marker?: number;
  markerLabel?: string;
}

export function ProgressBar({ value, max = 1, label, valueText, showLabel = true, tone = "primary", marker, markerLabel }: ProgressBarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const mpct = marker !== undefined && max > 0 ? Math.max(0, Math.min(100, (marker / max) * 100)) : null;
  const text = valueText ?? `%${Math.round(pct)}`;
  return (
    <div className="progress-wrap">
      {showLabel ? (
        <div className="progress-labels">
          <span>{label}</span>
          <span className="progress-value">{text}</span>
        </div>
      ) : null}
      <div
        className={cx("progress", `progress-${tone}`)}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
      >
        <div className="progress-fill" style={{ width: `${pct}%` }} />
        {mpct !== null ? <div className="progress-marker" style={{ left: `${mpct}%` }} title={markerLabel} /> : null}
      </div>
      {mpct !== null && markerLabel && showLabel ? <div className="progress-marker-label">{markerLabel}</div> : null}
    </div>
  );
}

// ───────────── Sayfa başlığı ve bölüm ─────────────

/** Belge başlığını ayarlar: "<başlık> · Forum Sistemi" */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (title) document.title = `${title} · Forum Sistemi`;
  }, [title]);
}

export interface PageHeaderProps {
  title: ReactNode;
  /** title metin değilse belge başlığı için */
  docTitle?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Başlığın üstündeki küçük rozet/bağlam satırı (ör. öneri no + durum) */
  meta?: ReactNode;
  /** Geri bağlantısı; to verilmezse tarayıcı geçmişinde geri gider */
  back?: { to?: string; label?: string };
}

export function PageHeader({ title, docTitle, subtitle, actions, meta, back }: PageHeaderProps) {
  useDocumentTitle(docTitle ?? (typeof title === "string" ? title : null));
  const navigate = useNavigate();
  return (
    <header className="page-header">
      {back ? (
        back.to ? (
          <Link className="page-back" to={back.to}>
            <Icon name="back" size={16} /> {back.label ?? "Geri"}
          </Link>
        ) : (
          <button type="button" className="page-back" onClick={() => navigate(-1)}>
            <Icon name="back" size={16} /> {back.label ?? "Geri"}
          </button>
        )
      ) : null}
      {meta ? <div className="page-meta">{meta}</div> : null}
      <div className="page-header-row">
        <h1 className="page-title">{title}</h1>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </div>
      {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
    </header>
  );
}

export interface SectionProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  id?: string;
  className?: string;
  headingLevel?: 2 | 3;
}

export function Section({ title, description, actions, children, id, className, headingLevel = 2 }: SectionProps) {
  const hid = useId();
  const H = `h${headingLevel}` as "h2";
  return (
    <section className={cx("section", className)} id={id} aria-labelledby={hid}>
      <div className="section-header">
        <H className="section-title" id={hid}>
          {title}
        </H>
        {actions ? <div className="section-actions">{actions}</div> : null}
      </div>
      {description ? <p className="section-description">{description}</p> : null}
      {children}
    </section>
  );
}

// ───────────── Anahtar–değer ve tablo ─────────────

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}

/** Tanım listesi (<dl>). Dar ekranda alt alta, geniş ekranda iki sütun. */
export function KeyValue({ items, className, compact }: { items: (KeyValueItem | null | false | undefined)[]; className?: string; compact?: boolean }) {
  return (
    <dl className={cx("kv", compact && "kv-compact", className)}>
      {items.filter((x): x is KeyValueItem => !!x).map((it, i) => (
        <div className="kv-row" key={i}>
          <dt>{it.label}</dt>
          <dd>
            {it.value}
            {it.hint ? <div className="kv-hint">{it.hint}</div> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  /** Dar ekranda gizle */
  hideOnMobile?: boolean;
}

export interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  /** Erişilebilir tablo başlığı (görünür değilse caption sr-only olur) */
  caption: string;
  showCaption?: boolean;
  empty?: ReactNode;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
}

/** Yatay kaydırılabilir kapsayıcı içinde tablo (360 px'de sayfa taşmaz). */
export function Table<T>({ columns, rows, rowKey, caption, showCaption, empty, className, rowClassName }: TableProps<T>) {
  if (!rows.length && empty !== undefined) return <>{empty}</>;
  return (
    <div className="table-wrap" role="region" aria-label={caption} tabIndex={0}>
      <table className={cx("table", className)}>
        <caption className={showCaption ? "table-caption" : "sr-only"}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx(c.align && `ta-${c.align}`, c.hideOnMobile && "hide-mobile", c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} className={rowClassName?.(r)}>
              {columns.map((c) => (
                <td key={c.key} className={cx(c.align && `ta-${c.align}`, c.hideOnMobile && "hide-mobile", c.className)}>
                  {c.render ? c.render(r, i) : String((r as Record<string, unknown>)[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────── Sayı kutucukları ─────────────

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  to?: string;
}

export function Stat({ label, value, hint, tone = "neutral", to }: StatProps) {
  const inner = (
    <>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </>
  );
  return to ? (
    <Link className={cx("stat", `stat-${tone}`, "stat-link")} to={to}>
      {inner}
    </Link>
  ) : (
    <div className={cx("stat", `stat-${tone}`)}>{inner}</div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="stat-grid">{children}</div>;
}

// ───────────── Açılır ayrıntı ─────────────

export interface DetailsProps {
  summary: ReactNode;
  children: ReactNode;
  /** Açık/kapalı. Verilmezse 'tam' görünümde açık, 'sade'de kapalı gelir; verilen değer her iki kipte de geçerlidir. */
  open?: boolean;
  className?: string;
  /** Özet satırının sağında gri sayı ya da kısa hüküm ("3", "✔ tutarlı"). Özet düğmesinin adına dahil olur. */
  meta?: ReactNode;
  /** Derin bağlantı çapası (`?bolum=<id>` bu açılırı açar, kaydırır, odağı özetine taşır). */
  id?: string;
  /** false → 'tam' görünümde de varsayılan kapalı (ör. moderasyonla daraltılmış içerik); yalnız `open` verilmemişse anlamlı. */
  openInFull?: boolean;
}

export function Details({ summary, children, open, className, meta, id, openInFull = true }: DetailsProps) {
  const [isOpen, setOpen] = useDisclosure(open, openInFull, true);
  return (
    <details
      className={cx("details", className)}
      id={id}
      open={isOpen}
      onToggle={(e) => {
        // Kullanıcının (ya da tarayıcının sayfa içi aramasının) açıp kapatması durumu günceller; React'in kendi değişikliği zaten eşittir.
        const now = e.currentTarget.open;
        if (now !== isOpen) setOpen(now);
      }}
    >
      {meta ? (
        <summary className="details-has-meta">
          <span className="details-summary-text">{summary}</span>
          <span className="details-meta">{meta}</span>
        </summary>
      ) : (
        <summary>{summary}</summary>
      )}
      <div className="details-body">{children}</div>
    </details>
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
