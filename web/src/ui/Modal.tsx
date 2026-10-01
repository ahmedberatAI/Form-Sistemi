// Erişilebilir modal (yerel <dialog> + showModal: odak tuzağı, Esc ile kapanma, arka plan etkisiz)
// ve onay penceresi (isteğe bağlı "SİL" yazdırma).
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "../api/client";
import { Alert, Button, cx } from "./basic";
import { Icon } from "./Icon";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  /** Alt düğme satırı */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Arka plana tıklayınca kapansın mı (varsayılan true) */
  closeOnBackdrop?: boolean;
  /** false → Esc / kapat düğmesi / arka plan kapatmaz (ör. işlem sürerken) */
  dismissible?: boolean;
  /** Mobilde alttan açılan sayfa görünümü */
  sheet?: boolean;
}

let openCount = 0;

export function Modal(props: ModalProps) {
  if (!props.open) return null;
  return <ModalInner {...props} />;
}

function ModalInner({ onClose, title, children, footer, size = "md", closeOnBackdrop = true, dismissible = true, sheet }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
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
    openCount++;
    document.body.classList.add("modal-open");
    return () => {
      openCount = Math.max(0, openCount - 1);
      if (openCount === 0) document.body.classList.remove("modal-open");
      try {
        if (d.open) d.close();
      } catch {
        /* yok say */
      }
      prev?.focus?.();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={cx("modal", `modal-${size}`, sheet && "modal-sheet")}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) closeRef.current();
      }}
      onMouseDown={(e) => {
        if (closeOnBackdrop && dismissible && e.target === e.currentTarget) closeRef.current();
      }}
    >
      <div className="modal-inner">
        <header className="modal-header">
          <h2 className="modal-title" id={titleId}>
            {title}
          </h2>
          {dismissible ? (
            <button type="button" className="icon-btn" onClick={() => closeRef.current()} aria-label="Kapat">
              <Icon name="close" size={18} />
            </button>
          ) : null}
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  message?: ReactNode;
  /** Ek içerik (ör. şifre alanı) */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  /** Kullanıcının onay için aynen yazması gereken metin (ör. "SİL"). Türkçe büyük harfe çevrilerek karşılaştırılır. */
  requireText?: string;
  /** Ek koşul sağlanmadıysa onay düğmesini kilitle (ör. şifre boş) */
  confirmDisabled?: boolean;
  /** Promise dönerse beklenir; hata fırlatırsa pencere açık kalır ve hata gösterilir. Başarıda onClose çağrılır. */
  onConfirm: () => void | Promise<unknown>;
  /** Vazgeç ya da başarılı onaydan sonra */
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  children,
  confirmLabel = "Onayla",
  cancelLabel = "Vazgeç",
  tone = "primary",
  requireText,
  confirmDisabled,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  useEffect(() => {
    if (open) {
      setTyped("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const textOk = !requireText || typed.trim().toLocaleUpperCase("tr-TR") === requireText.toLocaleUpperCase("tr-TR");

  const confirm = async () => {
    if (!textOk || confirmDisabled) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setBusy(false);
      onClose();
    } catch (e) {
      setBusy(false);
      setError(errorMessage(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={confirm} loading={busy} disabled={!textOk || confirmDisabled}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        {message ? <div className="confirm-message">{message}</div> : null}
        {children}
        {requireText ? (
          <div className="field">
            <label className="field-label" htmlFor={inputId}>
              Onaylamak için kutuya <strong className="confirm-token">“{requireText}”</strong> yazın
            </label>
            <input
              id={inputId}
              className="input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={typed && !textOk ? true : undefined}
            />
          </div>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
