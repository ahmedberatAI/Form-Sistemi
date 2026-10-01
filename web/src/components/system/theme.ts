// Tema: "light" | "dark" | "system". Seçim <html data-theme="..."> özniteliğine yazılır;
// styles.css koyu renkleri hem [data-theme="dark"] hem de (system iken) prefers-color-scheme ile uygular.
import { getPref, getPrefSync, PREF_KEYS, setPref, setPrefSync } from "../../lib/prefs";

export type ThemeMode = "light" | "dark" | "system";

export const THEME_LABELS: Record<ThemeMode, string> = {
  light: "Açık",
  dark: "Koyu",
  system: "Sistem ayarını izle",
};

const isMode = (v: unknown): v is ThemeMode => v === "light" || v === "dark" || v === "system";

let current: ThemeMode = "system";

function apply(mode: ThemeMode): void {
  current = mode;
  const root = document.documentElement;
  root.dataset.theme = mode;
  const dark = mode === "dark" || (mode === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  root.style.colorScheme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#111827" : "#1d4ed8");
}

/** main.tsx'ten bir kez çağrılır: kayıtlı temayı (önce eşzamanlı ayna, sonra kalıcı depo) uygular. */
export function applySavedTheme(): void {
  const sync = getPrefSync(PREF_KEYS.theme);
  apply(isMode(sync) ? sync : "system");
  void getPref(PREF_KEYS.theme).then((v) => {
    if (isMode(v) && v !== current) apply(v);
  });
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (current === "system") apply("system");
  });
}

export function getTheme(): ThemeMode {
  return current;
}

export async function setTheme(mode: ThemeMode): Promise<void> {
  apply(mode);
  setPrefSync(PREF_KEYS.theme, mode);
  await setPref(PREF_KEYS.theme, mode);
}
