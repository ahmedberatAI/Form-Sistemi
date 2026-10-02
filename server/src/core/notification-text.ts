// Bildirim metinlerinde üye başvurusu: takma ad metne GÖMÜLMEZ, {{uye:<kullanıcı kimliği>}} belirteci saklanır ve
// bildirim okunurken güncel takma adla çözülür. Böylece takma ad değişikliği ya da kripto-imha (hesap "Silinmiş üye #…"
// olur) başkalarının bildirim kutusundaki kayıtlı metni yeniden yazmayı gerektirmez; başka bir alanla (ör. öneri
// başlığı) aynı yazılan metin de yanlışlıkla değişmez.
import type { Db } from "../db";

const MEMBER_TOKEN = /\{\{uye:([0-9A-Za-z-]{1,64})\}\}/g;

/** Kayıtlı bildirim metnine konacak üye belirteci (okunurken güncel takma adla değiştirilir). */
export const memberToken = (userId: string): string => `{{uye:${userId}}}`;

/** Hesabı hiç bulunmayan (silinmiş satır) üye için gösterilen ad. */
export const DELETED_MEMBER_LABEL = "Silinmiş üye";

/** Metindeki üye belirteçlerini `names` tablosuyla çözer; bilinmeyen kimlik "Silinmiş üye" olur. */
export function renderMemberTokens(text: string, names: ReadonlyMap<string, string>): string {
  return text.includes("{{uye:") ? text.replace(MEMBER_TOKEN, (_m, id: string) => names.get(id) ?? DELETED_MEMBER_LABEL) : text;
}

/**
 * Bildirim satırlarının başlık ve gövdesindeki üye belirteçlerini güncel takma adlarla çözer (tek sorgu).
 * Belirteç içermeyen eski satırlar olduğu gibi döner.
 */
export function renderNotificationRows<T extends { title: string; body: string }>(db: Db, rows: readonly T[]): T[] {
  const ids = new Set<string>();
  for (const r of rows) {
    for (const text of [r.title, r.body]) {
      if (!text.includes("{{uye:")) continue;
      for (const m of text.matchAll(MEMBER_TOKEN)) ids.add(m[1]);
    }
  }
  if (ids.size === 0) return [...rows];
  const names = new Map<string, string>();
  for (const u of db.all<{ id: string; nickname: string }>(
    "SELECT id, nickname FROM users WHERE id IN (SELECT value FROM json_each(?))",
    JSON.stringify([...ids]),
  )) {
    names.set(u.id, u.nickname);
  }
  return rows.map((r) => ({ ...r, title: renderMemberTokens(r.title, names), body: renderMemberTokens(r.body, names) }));
}
