// Kısaltılmış hash gösterimi ve panoya kopyalama düğmesi.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { shortHash } from "../lib/format";
import { cx } from "./basic";
import { Icon } from "./Icon";
import { Term } from "./Term";

/** Panoya kopyalar (Clipboard API yoksa gizli textarea yedeği). Başarıyı döner. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* yedeğe düş */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export interface CopyButtonProps {
  text: string;
  /** Düğme metni (varsayılan "Kopyala"); iconOnly'de erişilebilir ad */
  label?: string;
  iconOnly?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function CopyButton({ text, label = "Kopyala", iconOnly, size = "sm", className }: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onClick = async () => {
    const ok = await copyToClipboard(text);
    setState(ok ? "ok" : "fail");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2000);
  };
  const shown = state === "ok" ? "Kopyalandı" : state === "fail" ? "Kopyalanamadı" : label;
  return (
    <button
      type="button"
      className={cx(iconOnly ? "icon-btn" : "btn btn-ghost", !iconOnly && size === "sm" && "btn-sm", "copy-btn", className)}
      onClick={onClick}
      aria-label={iconOnly ? shown : undefined}
      title={iconOnly ? shown : undefined}
    >
      <Icon name={state === "ok" ? "check" : "copy"} size={14} />
      {iconOnly ? null : <span>{shown}</span>}
      <span className="sr-only" aria-live="polite">
        {state === "ok" ? "Panoya kopyalandı" : state === "fail" ? "Kopyalanamadı" : ""}
      </span>
    </button>
  );
}

export interface HashTextProps {
  hash: string | null | undefined;
  /** Görünen karakter sayısı (varsayılan 10) */
  chars?: number;
  /** Kopyala düğmesi (varsayılan true) */
  copy?: boolean;
  /** Bağlantı (ör. /defter/islem/<hash>) */
  to?: string;
  /** Tam hash'i göster (kırılarak) */
  full?: boolean;
  /** Erişilebilir açıklama (ör. "İşlem özeti") */
  label?: string;
  /**
   * Değer bir özet (SHA-256 parmak izi) mi? Varsayılan true: fare ipucu 'Özet (parmak izi): …' der. İmza, açık anahtar ve rastgele
   * kimlik gibi özet OLMAYAN değerlerde false verin; ipucu yalnız değerin kendisidir (sözlükteki 'özet' tanımı yanlış öğretilmesin).
   */
  digest?: boolean;
  /**
   * Yanına 'Özet nedir?' düğmesi koyar: dokununca özetin günlük karşılığı ('parmak izi') sözlük penceresinde okunur.
   * Varsayılan false (tablo ve satırlarda gürültü olmasın). Bağlantı, düğme ya da <summary> içindeki HashText'te kullanılmaz.
   */
  explain?: boolean;
  className?: string;
}

/**
 * Fare ipucu. 'özet' sözcüğü hash anlamında YENİDEN ADLANDIRILMAZ (görünen etiketler aynen kalır); günlük karşılığı olan
 * 'parmak izi' ipucuna ve sözlüğe eklenir. Tam değer ipucunun sonunda durur.
 */
export function hashTitle(hash: string): string {
  return `Özet (parmak izi): ${hash}`;
}

export function HashText({ hash, chars = 10, copy = true, to, full, label, digest = true, explain, className }: HashTextProps) {
  if (!hash) return <span className="muted">—</span>;
  const shown = full ? hash : shortHash(hash, chars);
  const text = (
    <code className={cx("hash", full && "hash-full")} title={digest ? hashTitle(hash) : hash} aria-label={label ? `${label}: ${hash}` : undefined}>
      {shown}
    </code>
  );
  return (
    <span className={cx("hash-wrap", className)}>
      {to ? <Link to={to}>{text}</Link> : text}
      {copy ? <CopyButton text={hash} iconOnly label={label ? `${label} kopyala` : "Özeti kopyala"} /> : null}
      {explain ? (
        <Term id="ozet" className="term-info">
          <Icon name="info" size={14} />
          <span className="sr-only">Özet nedir?</span>
        </Term>
      ) : null}
    </span>
  );
}
