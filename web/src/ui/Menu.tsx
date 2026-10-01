// Açılır menü (açıklama/disclosure deseni: düğme + bağlantı listesi). Dışarı tıklama ve Esc ile kapanır.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "./basic";
import { Icon, type IconName } from "./Icon";

export interface MenuItem {
  label: ReactNode;
  to?: string;
  onClick?: () => void;
  icon?: IconName;
  danger?: boolean;
  /** Sağda küçük rozet (ör. bildirim sayısı) */
  badge?: ReactNode;
}

export type MenuEntry = MenuItem | "divider" | null | false | undefined;

export interface DropdownMenuProps {
  /** Düğme içeriği */
  label: ReactNode;
  /** Düğmenin erişilebilir adı (label metin değilse) */
  ariaLabel?: string;
  items: MenuEntry[];
  align?: "left" | "right";
  buttonClassName?: string;
  className?: string;
}

export function DropdownMenu({ label, ariaLabel, items, align = "right", buttonClassName, className }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const entries = items.filter((x): x is MenuItem | "divider" => !!x);

  return (
    <div className={cx("menu", className)} ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className={cx("menu-button", buttonClassName)}
        aria-expanded={open}
        aria-controls={id}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        <Icon name="chevronDown" size={14} />
      </button>
      {open ? (
        <ul className={cx("menu-list", `menu-${align}`)} id={id}>
          {entries.map((it, i) =>
            it === "divider" ? (
              <li key={i} className="menu-divider" role="separator" />
            ) : (
              <li key={i}>
                {it.to ? (
                  <Link className={cx("menu-item", it.danger && "menu-item-danger")} to={it.to} onClick={() => setOpen(false)}>
                    {it.icon ? <Icon name={it.icon} size={16} /> : null}
                    <span className="menu-item-label">{it.label}</span>
                    {it.badge ?? null}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className={cx("menu-item", it.danger && "menu-item-danger")}
                    onClick={() => {
                      setOpen(false);
                      it.onClick?.();
                    }}
                  >
                    {it.icon ? <Icon name={it.icon} size={16} /> : null}
                    <span className="menu-item-label">{it.label}</span>
                    {it.badge ?? null}
                  </button>
                )}
              </li>
            ),
          )}
        </ul>
      ) : null}
    </div>
  );
}
