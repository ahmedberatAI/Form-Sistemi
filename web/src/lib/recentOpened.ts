// "Son açılanlar": kişisel sıralamanın (Öneriler › Sırala › 'Size göre', Ana sayfa 'Şu an açık') GEÇİCİ girdisi.
// Oturumdaki üyenin son açtığı en çok 20 önerinin kimliği YALNIZ bu cihazda tutulur (localStorage; anahtar oturum sahibine göre:
// `forum.sonAcilanlar:<kullanıcı kimliği>`), yeniden eskiye, tekrarsız. Sunucuya yalnız sıralama isteğinde geçici `X-Forum-Recent`
// istek başlığıyla gider (adres satırında değil: ters vekil ve CDN erişim günlükleri sorgu dizesini düz yazar); sunucu bunu saklamaz
// (docs/KVKK.md #17). Çıkışta (hesap silme dahil) silinir.
// Yalnız öneri kimlikleri (UUID) saklanır: sunucu UUID olmayan bir öğede isteği 400 ile reddeder, bu yüzden bozuk kayıt hiç gitmez.
import { REC_PARAMS } from "@forum/shared";
import { readDevice, removeDevice, writeDevice } from "./deviceStore";
import { PREF_KEYS } from "./prefs";

/** Saklanan ve gönderilen en çok kimlik sayısı (sunucunun üst sınırı: REC_PARAMS.maxRecent). */
export const RECENT_MAX: number = REC_PARAMS.maxRecent;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sunucunun kabul ettiği öneri kimliği biçimi (UUID). */
export const isProposalId = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

/** Oturum sahibine göre depo anahtarı. */
export const recentKey = (userId: string): string => `${PREF_KEYS.recentOpened}:${userId}`;

/** Kayıtlı JSON metnini doğrular (saf): yalnız UUID dizeler, tekrarsız, ilk `max` tanesi; bozuk/boş kayıt boş liste. */
export function parseRecent(raw: string | null | undefined, max = RECENT_MAX): string[] {
  if (!raw) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (!isProposalId(x) || out.includes(x)) continue;
    out.push(x);
    if (out.length >= max) break;
  }
  return out;
}

/** Açılan öneriyi başa alır (saf): varsa eski yeri silinir, liste `max`'ta kesilir. Geçersiz kimlik listeyi değiştirmez. */
export function pushRecent(list: readonly string[], id: string, max = RECENT_MAX): string[] {
  if (!isProposalId(id)) return list.slice(0, max);
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

let owner: string | null = null;

/** Oturum sahibi (AuthProvider oturum değişince çağırır). Sahip yoksa hiçbir şey okunmaz ya da yazılmaz. */
export function setRecentOwner(userId: string | null): void {
  owner = userId;
}

/** Oturum sahibinin son açtığı öneriler (yeniden eskiye, en çok 20). Oturum yoksa boş. */
export function getRecentOpened(): string[] {
  return owner ? parseRecent(readDevice(recentKey(owner))) : [];
}

/** Öneri sayfası açılınca çağrılır (yalnız oturumdaki üyede ve yalnız bu cihazda). */
export function recordOpened(proposalId: string): void {
  if (!owner || !isProposalId(proposalId)) return;
  const key = recentKey(owner);
  writeDevice(key, JSON.stringify(pushRecent(parseRecent(readDevice(key)), proposalId)));
}

/** Çıkışta (ve hesap silmede) çağrılır: oturum sahibinin (ya da verilen üyenin) listesini siler. */
export function clearRecentOpened(userId: string | null = owner): void {
  if (userId) removeDevice(recentKey(userId));
}
