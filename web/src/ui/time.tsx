// Zaman gösterimi: göreli + mutlak (tr-TR) ve geri sayım. Sunucu (simüle) saatine göre çalışır.
import { useEffect, useRef } from "react";
import { formatDateTime, formatDuration, formatRelative } from "../lib/format";
import { useNow } from "../lib/hooks";
import { cx } from "./basic";
import { Icon } from "./Icon";

export interface TimeProps {
  at: number | null | undefined;
  /** relative: "3 dakika önce" (mutlak zaman title'da) · absolute: "1 Ekim 2026 14:05" · both: "1 Eki 2026 14:05 (3 dakika önce)" */
  mode?: "relative" | "absolute" | "both";
  className?: string;
}

export function Time({ at, mode = "relative", className }: TimeProps) {
  const now = useNow(30_000);
  if (at == null || !Number.isFinite(at)) return <span className={cx("time", className)}>—</span>;
  const abs = formatDateTime(at);
  const rel = formatRelative(at, now);
  const text = mode === "absolute" ? abs : mode === "both" ? `${formatDateTime(at, true)} (${rel})` : rel;
  return (
    <time className={cx("time", className)} dateTime={new Date(at).toISOString()} title={abs}>
      {text}
    </time>
  );
}

export interface CountdownProps {
  /** Bitiş zamanı (ms, sunucu saati) */
  to: number | null | undefined;
  /** Önündeki metin (ör. "Oylamanın bitmesine") */
  prefix?: string;
  /** Süre dolunca gösterilecek metin */
  doneText?: string;
  onDone?: () => void;
  /** Kalan süre bu değerin altındaysa uyarı rengi (varsayılan 1 saat) */
  warnBelowMs?: number;
  /** Simge gösterme */
  plain?: boolean;
  className?: string;
}

/** "2 sa 13 dk" biçiminde geri sayım; bitince "süre doldu". */
export function Countdown({ to, prefix, doneText = "süre doldu", onDone, warnBelowMs = 3_600_000, plain, className }: CountdownProps) {
  const now = useNow(1000);
  const firedRef = useRef(false);
  const remaining = to == null ? null : to - now;
  const done = remaining !== null && remaining <= 0;

  useEffect(() => {
    if (done && !firedRef.current) {
      firedRef.current = true;
      onDone?.();
    }
    if (!done) firedRef.current = false;
  }, [done, onDone]);

  if (to == null) return null;
  const text = done ? doneText : formatDuration(remaining!);
  return (
    <span
      className={cx("countdown", done ? "countdown-done" : remaining! < warnBelowMs ? "countdown-warn" : null, className)}
      title={`Bitiş: ${formatDateTime(to)}`}
    >
      {plain ? null : <Icon name="clock" size={14} />}
      {prefix && !done ? <span className="countdown-prefix">{prefix} </span> : null}
      <time dateTime={new Date(to).toISOString()}>{text}</time>
      {!done ? <span className="sr-only"> kaldı</span> : null}
    </span>
  );
}
