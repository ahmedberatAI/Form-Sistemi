// Uçtan uca testlerin ortak sabitleri: depo yolları, port, demo hesapları ve şifreleri.
// Not: Playwright bu dosyaları CommonJS'e çevirerek yükler; yollar __dirname'den türetilir.
import { join, resolve } from "node:path";

export const REPO_ROOT = resolve(__dirname, "..", "..");
export const SERVER_DIR = join(REPO_ROOT, "server");
export const WEB_DIR = join(REPO_ROOT, "web");
export const WEB_DIST = join(WEB_DIR, "dist");

/** Test sunucusunun taban portu (kullanıcının önizleme sunucusu 4000'de çalışır; ona dokunulmaz). */
export const BASE_PORT = Number(process.env.E2E_PORT ?? 4100);

/** Küresel kurulumun (global-setup) ortam değişkenleriyle işçilere aktardığı bilgiler. */
export const ENV_KEYS = {
  /** Bu çalıştırmaya ait geçici kök klasör */
  tmpRoot: "FORUM_E2E_TMP",
  /** Tohumlanmış şablon veri klasörü (her test dosyası bunun kopyasıyla çalışır) */
  template: "FORUM_E2E_TEMPLATE",
} as const;

/** Demo hesaplarının şifreleri (README §2 ve server/src/seed/people.ts ile aynı). */
export const PASSWORDS = {
  admin: "Yonetici123!",
  registrar: "Kayit123!",
  auditor: "Denetci123!",
  expert: "Bilirkisi123!",
  member: "Uye12345!",
} as const;

export function passwordOf(nickname: string): string {
  if (nickname === "yonetici") return PASSWORDS.admin;
  if (nickname === "kayitmemuru") return PASSWORDS.registrar;
  if (nickname === "denetci") return PASSWORDS.auditor;
  if (nickname.startsWith("bk_")) return PASSWORDS.expert;
  return PASSWORDS.member;
}

/** Tohumdaki görüş blokları (oy verebilen üyeler). Kümeler oylardan hesaplanır; bloklar bunlarla örtüşür. */
export const BLOCKS = {
  A: ["ayse", "deniz_k", "elif_d", "burak_s", "selin_a", "emre_t", "cem_y", "ozge_b", "murat_e", "irem_c", "tolga_a", "pinar_g", "onur_h", "ceren_m", "umut_f", "ece_p", "baran_y"],
  B: ["mehmet", "sert_kaan", "serkan_u", "gokhan_r", "nihan_l", "volkan_i", "derya_n", "tarik_o", "figen_s", "levent_c"],
  C: ["zeynep", "nur_a", "hulya_t", "ismail_g", "sevgi_k", "orhan_d"],
} as const;

export const HOUR_MS = 3_600_000;
