// Takma ad yardımcıları: tekillik anahtarı göçü (I/ı katlaması) ve benzerlik (taklit) denetimi. Bildirim metinleri takma ad
// taşımaz ({{uye:<kimlik>}} belirteci, core/notification-text.ts); takma ad değişikliği/imha bildirimleri yeniden yazmaz.
import { nicknameKey, nicknameSkeleton } from "@forum/shared";
import type { AuditLogger } from "../core/audit";
import type { Notifier } from "../core/contracts";
import { DAY } from "../core/clock";
import { conflict } from "../core/errors";
import type { Db } from "../db";

/** Takma ad en çok bu sıklıkta değiştirilebilir (simüle saat). */
export const NICKNAME_CHANGE_INTERVAL_MS = 30 * DAY;

/** nickname_norm kuralının sürümü: 1 = yalnız tr-TR küçük harf, 2 = I/ı/İ/i katlaması (shared `nicknameKey`). */
export const NICKNAME_KEY_VERSION = "2";
const META_KEY = "nickname_key_version";

/** Göçte çakışan (sonradan açılmış) hesaba verilen anahtar: "#" takma adda geçemediği için hiçbir girişle çakışmaz. */
export const conflictKey = (key: string, userId: string) => `${key}#${userId.replace(/-/g, "").slice(0, 8)}`;
export const isConflictKey = (norm: string) => norm.includes("#");

export const similarNickname = () =>
  conflict(
    "similar_nickname",
    "Bu takma ad kayıtlı bir takma ada çok benziyor (büyük/küçük harf, Türkçe harf, benzer rakam ya da ayraç farkı). Lütfen ayırt edilebilir bir takma ad seçin.",
    { nickname: "Bu takma ad kayıtlı bir takma ada çok benziyor; lütfen ayırt edilebilir bir takma ad seçin." },
  );

const isClosedStatus = (s: string) => s === "erased" || s === "rejected";

/**
 * Benzerlik (taklit) denetimi: iskeleti (`nicknameSkeleton`) açık bir hesabın takma adıyla aynı olan takma ad reddedilir
 * ("yonetici" varken "Yönetici", "y0netici", "yonetici_" …). Silinmiş/reddedilmiş hesaplar ve kişinin kendisi hariçtir.
 * Tüm takma adlar taranır (iskelet saklanmaz); üye sayısı on binler düzeyinde kaldıkça maliyet önemsizdir.
 */
export function assertNotSimilar(db: Db, nickname: string, excludeUserId: string | null): void {
  const skel = nicknameSkeleton(nickname);
  const rows = db.all<{ id: string; nickname: string; status: string }>("SELECT id, nickname, status FROM users WHERE id != ?", excludeUserId ?? "");
  for (const r of rows) {
    if (isClosedStatus(r.status)) continue;
    if (nicknameSkeleton(r.nickname) === skel) throw similarNickname();
  }
}

/**
 * Tek seferlik göç: `nickname_norm` eski kurala (yalnız tr-TR küçük harf; "YONETICI" → "yonetıcı") göre hesaplanmışsa
 * yeni anahtarla (`nicknameKey`) yeniden hesaplanır. Yeni kurala göre aynı anahtarı alan hesaplardan EN ESKİSİ anahtarı
 * korur; sonrakiler "<anahtar>#<kısa kimlik>" alır: takma adla girişte en eski hesap bulunur, çakışan hesap e-postasıyla
 * girer ve takma adını (30 günlük sınır olmadan) değiştirebilir. Her çakışma denetim günlüğüne
 * (`identity.nickname_conflict`, kişisel veri yok) yazılır ve kişiye bildirilir. Değişen satır sayısını döndürür.
 */
export function migrateNicknameKeys(db: Db, audit: AuditLogger, notifier: Notifier): number {
  const done = db.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", META_KEY);
  if (done?.value === NICKNAME_KEY_VERSION) return 0;
  const conflicts: string[] = [];
  let changed = 0;
  db.tx(() => {
    const rows = db.all<{ id: string; nickname: string; nickname_norm: string; status: string }>(
      "SELECT id, nickname, nickname_norm, status FROM users ORDER BY created_at ASC, id ASC",
    );
    const taken = new Set<string>();
    const next = new Map<string, string>();
    for (const r of rows) {
      if (isClosedStatus(r.status)) continue; // anahtarı "<durum>:<kimlik>"; takma adla girilemez
      const key = nicknameKey(r.nickname);
      let norm = key;
      if (taken.has(key)) {
        norm = conflictKey(key, r.id);
        conflicts.push(r.id);
      }
      taken.add(key);
      if (norm !== r.nickname_norm) next.set(r.id, norm);
    }
    // İki aşama: UNIQUE kısıtı ara durumda (iki satır yer değiştirirken) çakışmasın.
    for (const id of next.keys()) db.run("UPDATE users SET nickname_norm = ? WHERE id = ?", `gecici:${id}`, id);
    for (const [id, norm] of next) db.run("UPDATE users SET nickname_norm = ? WHERE id = ?", norm, id);
    changed = next.size;
    db.run(
      "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      META_KEY,
      NICKNAME_KEY_VERSION,
    );
  });
  for (const id of conflicts) {
    audit.log(null, "identity.nickname_conflict", id, { keyVersion: NICKNAME_KEY_VERSION });
    notifier.notify(id, {
      kind: "nickname_conflict",
      title: "Takma adınızı değiştirmeniz gerekiyor",
      body:
        "Takma adınız, daha önce açılmış bir hesabın takma adıyla yalnızca büyük/küçük harf farkıyla ayrılıyor. Takma adla girişte diğer hesap " +
        "bulunur; lütfen e-posta adresinizle giriş yapıp Profil sayfasından yeni bir takma ad seçin (30 günlük sınır bu değişiklikte uygulanmaz).",
      link: "/profil",
    });
  }
  return changed;
}
