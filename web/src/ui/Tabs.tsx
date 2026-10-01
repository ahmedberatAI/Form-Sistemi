// Erişilebilir sekmeler (WAI-ARIA tabs: ok tuşlarıyla gezinme). Etkin sekmenin içeriği children olarak verilir.
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./basic";

export interface TabItem<V extends string = string> {
  id: V;
  label: ReactNode;
  /** Sekme etiketinin yanında sayı rozeti */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps<V extends string = string> {
  tabs: TabItem<V>[];
  value: V;
  onChange: (id: V) => void;
  /** Sekme listesinin erişilebilir adı */
  label: string;
  /** Etkin sekmenin içeriği (role="tabpanel" içinde gösterilir). Verilmezse yalnızca sekme listesi çizilir. */
  children?: ReactNode;
  className?: string;
}

export function Tabs<V extends string = string>({ tabs, value, onChange, label, children, className }: TabsProps<V>) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = tabs.map((t, i) => (t.disabled ? -1 : i)).filter((i) => i >= 0);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = tabs.findIndex((t) => t.id === value);
    const pos = enabled.indexOf(cur);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = enabled[(pos + 1) % enabled.length];
    else if (e.key === "ArrowLeft") next = enabled[(pos - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (next != null && next >= 0) {
      e.preventDefault();
      onChange(tabs[next].id);
      refs.current[next]?.focus();
    }
  };

  return (
    <div className={cx("tabs", className)}>
      <div className="tab-list" role="tablist" aria-label={label} onKeyDown={onKey}>
        {tabs.map((t, i) => {
          const selected = t.id === value;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={children !== undefined ? `${base}-panel` : undefined}
              tabIndex={selected ? 0 : -1}
              disabled={t.disabled}
              className={cx("tab", selected && "tab-active")}
              onClick={() => onChange(t.id)}
            >
              {t.label}
              {t.count !== undefined ? <span className="tab-count">{t.count}</span> : null}
            </button>
          );
        })}
      </div>
      {children !== undefined ? (
        <div className="tab-panel" role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`} tabIndex={0}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
