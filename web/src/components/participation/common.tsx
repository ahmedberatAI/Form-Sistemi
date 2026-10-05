// Katılım bileşenlerinin ortak yardımcıları: kişisel veri uyarısı, ✔/✘ işareti, mesaj çapası.
import type { ReactNode } from "react";
import { isApiError } from "../../api/client";
import { Alert, Button, cx } from "../../ui";

export interface PiiFinding {
  kind: string;
  start: number;
  end: number;
  masked: string;
}

const PII_KIND_LABELS: Record<string, string> = {
  tckn: "T.C. kimlik numarası",
  iban: "IBAN",
  phone: "Telefon numarası",
  email: "E-posta adresi",
  address: "Adres",
};

export const piiKindLabel = (k: string) => PII_KIND_LABELS[k] ?? k;

/** Sunucunun 422 `pii_detected` hatasından (maskeli) bulguları çıkarır; başka hata ise null. */
export function piiFromError(e: unknown): PiiFinding[] | null {
  if (!isApiError(e) || e.code !== "pii_detected") return null;
  const d = e.details as { pii?: unknown } | null;
  const list = Array.isArray(d?.pii) ? (d!.pii as PiiFinding[]) : [];
  return list.filter((x) => x && typeof x.masked === "string");
}

/** Kişisel veri uyarısı: maskeli bulgular + "Yine de gönder" / "Düzelteceğim". */
export function PiiNotice({
  findings,
  onAcknowledge,
  onCancel,
  loading,
  ackLabel = "Yine de gönder",
}: {
  findings: PiiFinding[];
  onAcknowledge?: () => void;
  onCancel?: () => void;
  loading?: boolean;
  ackLabel?: string;
}) {
  return (
    <Alert
      tone="warning"
      title="Metinde kişisel veri olabilecek ifadeler bulundu"
      actions={
        onAcknowledge || onCancel ? (
          <>
            {onCancel ? (
              <Button size="sm" variant="secondary" onClick={onCancel} disabled={loading}>
                Metni düzelteceğim
              </Button>
            ) : null}
            {onAcknowledge ? (
              <Button size="sm" variant="danger" onClick={onAcknowledge} loading={loading}>
                {ackLabel}
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      <p>Kendinizin ya da başkasının kimlik, iletişim veya adres bilgisini paylaşmayın. Bulunanlar (maskeli):</p>
      <ul className="pii-list">
        {findings.map((f, i) => (
          <li key={i}>
            {piiKindLabel(f.kind)}: <code className="mono">{f.masked}</code>
          </li>
        ))}
      </ul>
      {onAcknowledge ? <p className="small">Bilerek paylaşıyorsanız onaylayarak gönderebilirsiniz; içerik kişisel veri ifşası gerekçesiyle silme talebine konu olabilir.</p> : null}
    </Alert>
  );
}

/** ✔ / ✘ / – işareti; anlam ekran okuyucuya da metinle verilir. */
export function Tick({ ok, label, className }: { ok: boolean | null | undefined; label?: string; className?: string }) {
  const state = ok === true ? "ok" : ok === false ? "fail" : "na";
  const sr = label ?? (ok === true ? "sağlandı" : ok === false ? "sağlanmadı" : "uygulanmadı");
  return (
    <span className={cx("tick", `tick-${state}`, className)} title={sr}>
      <span aria-hidden="true">{ok === true ? "✔" : ok === false ? "✘" : "–"}</span>
      <span className="sr-only">{sr}</span>
    </span>
  );
}

/** Tartışmadaki mesajın DOM kimliği (HashRouter kullandığımız için çapa yerine kaydırma yapılır). */
export const messageAnchorId = (id: string) => `mesaj-${id}`;

/**
 * Mesajı görünür yapma isteği: uzun tartışma sayfalanır (ilk ROOT_PAGE_SIZE ileti dizisi); istenen mesaj henüz çizilmediyse
 * Discussion bu olayı yakalar, mesajın dizisine kadar açar ve olayı preventDefault ile "üstlendim" diye işaretler.
 */
export const REVEAL_MESSAGE_EVENT = "forum:reveal-message";

/** Mesaja kaydırır ve kısa süre vurgular. Henüz çizilmemiş (sayfalanmış) mesaj önce açılır. Bulunamazsa false. */
export function scrollToMessage(id: string): boolean {
  const el = document.getElementById(messageAnchorId(id));
  if (!el) {
    const handled = !window.dispatchEvent(new CustomEvent(REVEAL_MESSAGE_EVENT, { detail: { id }, cancelable: true }));
    if (handled) window.setTimeout(() => void scrollToMessage(id), 120);
    return handled;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("msg-flash");
  window.setTimeout(() => el.classList.remove("msg-flash"), 2200);
  const focusable = el.querySelector<HTMLElement>(".msg-body, .msg-tombstone");
  focusable?.focus({ preventScroll: true });
  return true;
}

/** Düz metin paragraf bloğu (white-space: pre-wrap). */
export function PlainText({ text, className }: { text: string | null | undefined; className?: string }) {
  return <div className={cx("prose plain-text", className)}>{text ?? ""}</div>;
}

/** Küçük başlıklı bölüm (kart içi). */
export function SubHeading({ children, level = 3 }: { children: ReactNode; level?: 3 | 4 }) {
  const H = `h${level}` as "h3";
  return <H className="sub-heading">{children}</H>;
}

/** 0..1 sayıyı "0,67" biçiminde yazar. */
export function fmtDecimal(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toFixed(digits).replace(".", ",");
}
