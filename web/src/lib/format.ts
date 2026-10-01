// tr-TR biçimlendirme yardımcıları. Zaman damgaları milisaniyedir (sunucunun simüle saati).
import type { Rational } from "@forum/shared";

const LOCALE = "tr-TR";

const dtFull = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dtShort = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dOnly = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", year: "numeric" });
const tOnly = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" });
const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
const nf = new Intl.NumberFormat(LOCALE);

const valid = (ms: number | null | undefined): ms is number => typeof ms === "number" && Number.isFinite(ms);

/** "1 Ekim 2026 14:05" (short=true → "1 Eki 2026 14:05") */
export function formatDateTime(ms: number | null | undefined, short = false): string {
  if (!valid(ms)) return "—";
  return (short ? dtShort : dtFull).format(ms);
}

/** "1 Ekim 2026" */
export function formatDate(ms: number | null | undefined): string {
  return valid(ms) ? dOnly.format(ms) : "—";
}

/** "14:05" */
export function formatTime(ms: number | null | undefined): string {
  return valid(ms) ? tOnly.format(ms) : "—";
}

/** YYYY-MM-DD (doğum tarihi gibi takvim günü) → "1 Ekim 2026" */
export function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return dOnly.format(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
}

/** Göreli zaman: "3 dakika önce", "2 saat sonra", "dün". now: useAuth().now() */
export function formatRelative(ms: number | null | undefined, now: number): string {
  if (!valid(ms)) return "—";
  const diff = ms - now;
  const abs = Math.abs(diff);
  const sec = 1000;
  const min = 60 * sec;
  const hour = 60 * min;
  const day = 24 * hour;
  if (abs < 45 * sec) return diff < 0 ? "az önce" : "birazdan";
  if (abs < 45 * min) return rtf.format(Math.round(diff / min), "minute");
  if (abs < 22 * hour) return rtf.format(Math.round(diff / hour), "hour");
  if (abs < 26 * day) return rtf.format(Math.round(diff / day), "day");
  if (abs < 320 * day) return rtf.format(Math.round(diff / (30 * day)), "month");
  return rtf.format(Math.round(diff / (365 * day)), "year");
}

/**
 * Süre: "2 sa 13 dk", "3 gün 4 sa", "5 dk 10 sn", "45 sn". Negatif süreler 0 kabul edilir.
 * withSeconds=true → saat altı sürelerde saniye de gösterilir.
 */
export function formatDuration(ms: number, withSeconds = true): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return h > 0 ? `${d} gün ${h} sa` : `${d} gün`;
  if (h > 0) return m > 0 ? `${h} sa ${m} dk` : `${h} sa`;
  if (m > 0) return withSeconds && m < 10 && s > 0 ? `${m} dk ${s} sn` : `${m} dk`;
  return `${s} sn`;
}

/** Saat cinsinden süre: 72 → "3 gün", 36 → "1 gün 12 sa", 0.5 → "30 dk" */
export function formatHours(hours: number): string {
  return formatDuration(hours * 3_600_000, false);
}

/** Yüzde: 0.615 → "%61,5"; 0.5 → "%50" */
export function formatPercent(x: number | null | undefined, digits = 1): string {
  if (!valid(x)) return "—";
  return new Intl.NumberFormat(LOCALE, { style: "percent", maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(x);
}

/** Sayı: 12345 → "12.345"; digits verilirse ondalık (virgül) */
export function formatNumber(n: number | null | undefined, digits?: number): string {
  if (!valid(n)) return "—";
  if (digits === undefined) return nf.format(n);
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

/** Rasyonel: {2,3} → "2/3 (%66,7)" */
export function formatRational(r: Rational | null | undefined): string {
  if (!r || !r.den) return "—";
  return `${r.num}/${r.den} (${formatPercent(r.num / r.den)})`;
}

/** Hash kısaltma: "a1b2c3d4e5…" */
export function shortHash(h: string | null | undefined, chars = 10): string {
  if (!h) return "—";
  return h.length > chars + 1 ? h.slice(0, chars) + "…" : h;
}

/** Öneri numarası: 12 → "#K-12" (karar/öneri kısa kimliği) */
export function proposalRef(seq: number | null | undefined): string {
  return valid(seq) ? `#K-${seq}` : "#K-?";
}

/** Konu numarası: 7 → "#T-7" */
export function topicRef(seq: number | null | undefined): string {
  return valid(seq) ? `#T-${seq}` : "#T-?";
}

/** Metni kısaltır: "Uzun metin…" */
export function truncate(s: string | null | undefined, max = 140): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/** Türkçe büyük/küçük harfe duyarsız arama için normalleştirme ("İstanbul" ~ "istanbul", "ı" ~ "i"). */
export function normalizeSearch(s: string): string {
  return s
    .toLocaleLowerCase(LOCALE)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i");
}
