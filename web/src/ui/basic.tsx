// Temel görsel bileşenler: düğme, kart, rozet, uyarı, boş durum, ilerleme, başlıklar, tablolar.
import { useEffect, useId, type ComponentProps, type ReactNode } from "react";
import { Link, useNavigate, type LinkProps } from "react-router-dom";
import { Icon, type IconName } from "./Icon";

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(" ");

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

// ───────────── Kart ─────────────

export interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Başlığın sağındaki düğmeler */
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Başlık düzeyi (varsayılan h2) */
  headingLevel?: 2 | 3 | 4;
  tone?: "default" | "muted" | "warning" | "danger" | "success" | "accent";
  id?: string;
}

export function Card({ title, subtitle, actions, footer, children, className, headingLevel = 2, tone = "default", id }: CardProps) {
  const H = `h${headingLevel}` as "h2";
  const hid = useId();
  return (
    <section className={cx("card", tone !== "default" && `card-${tone}`, className)} id={id} aria-labelledby={title ? hid : undefined}>
      {(title || actions) && (
        <header className="card-header">
          <div className="card-heading">
            {title ? (
              <H className="card-title" id={hid}>
                {title}
              </H>
            ) : null}
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

export function Details({ summary, children, open, className }: { summary: ReactNode; children: ReactNode; open?: boolean; className?: string }) {
  return (
    <details className={cx("details", className)} open={open}>
      <summary>{summary}</summary>
      <div className="details-body">{children}</div>
    </details>
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
