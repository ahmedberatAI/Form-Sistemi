// Bildirim balonları (useToast) ve söz tabanlı onay penceresi (useConfirm). İkisi de ToastProvider ister.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "../api/client";
import { cx } from "./basic";
import { Icon, type IconName } from "./Icon";
import { ConfirmDialog } from "./Modal";

export type ToastTone = "info" | "success" | "warning" | "error";

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: ReactNode;
  title?: ReactNode;
}

export interface ToastApi {
  show(message: ReactNode, opts?: { tone?: ToastTone; title?: ReactNode; durationMs?: number }): void;
  success(message: ReactNode): void;
  info(message: ReactNode): void;
  warning(message: ReactNode): void;
  /** Hata nesnesi (ApiError dahil) ya da metin */
  error(err: unknown, title?: ReactNode): void;
}

export interface ConfirmOptions {
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  /** Kullanıcının aynen yazması gereken metin (ör. "SİL") */
  requireText?: string;
}

const ToastContext = createContext<ToastApi | null>(null);
const ConfirmContext = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);

const ICONS: Record<ToastTone, IconName> = { info: "info", success: "success", warning: "warning", error: "error" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const [confirmState, setConfirmState] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const show = useCallback<ToastApi["show"]>(
    (message, opts) => {
      const id = ++seq.current;
      const tone = opts?.tone ?? "info";
      setItems((xs) => [...xs.slice(-3), { id, tone, message, title: opts?.title }]);
      const ms = opts?.durationMs ?? (tone === "error" ? 8000 : 4500);
      window.setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m) => show(m, { tone: "success" }),
      info: (m) => show(m, { tone: "info" }),
      warning: (m) => show(m, { tone: "warning" }),
      error: (e, title) => show(errorMessage(e), { tone: "error", title }),
    }),
    [show],
  );

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setConfirmState({ opts, resolve });
      }),
    [],
  );

  return (
    <ToastContext.Provider value={api}>
      <ConfirmContext.Provider value={confirm}>
        {children}
        <div className="toast-region" aria-live="polite" aria-relevant="additions">
          {items.map((t) => (
            <div key={t.id} className={cx("toast", `toast-${t.tone}`)} role={t.tone === "error" ? "alert" : "status"}>
              <Icon name={ICONS[t.tone]} size={18} className="toast-icon" />
              <div className="toast-content">
                {t.title ? <p className="toast-title">{t.title}</p> : null}
                <div>{t.message}</div>
              </div>
              <button type="button" className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Bildirimi kapat">
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
        </div>
        <ConfirmDialog
          open={!!confirmState}
          title={confirmState?.opts.title ?? ""}
          message={confirmState?.opts.message}
          confirmLabel={confirmState?.opts.confirmLabel}
          cancelLabel={confirmState?.opts.cancelLabel}
          tone={confirmState?.opts.tone}
          requireText={confirmState?.opts.requireText}
          onConfirm={() => {
            confirmState?.resolve(true);
          }}
          onClose={() => {
            confirmState?.resolve(false);
            setConfirmState(null);
          }}
        />
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}

/** const toast = useToast(); toast.success("Kaydedildi"); toast.error(e); */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() yalnızca <ToastProvider> içinde kullanılabilir.");
  return ctx;
}

/** const confirm = useConfirm(); if (await confirm({ title: "Emin misiniz?", tone: "danger" })) … */
export function useConfirm(): (o: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm() yalnızca <ToastProvider> içinde kullanılabilir.");
  return ctx;
}
