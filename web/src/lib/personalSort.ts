// Öneriler › Sırala: seçenekler ve 'Size göre' (kişisel sıra) seçiminin bu cihazda hatırlanması.
// VARSAYILAN SIRALAMA DEĞİŞMEZ ("En yeni"): 'Size göre' yalnız oturumdaki üyeye sunulur ve ancak üye onu bir kez seçerse bu cihazda
// (anahtar `forum.oneriSirasi:<kullanıcı kimliği>`) hatırlanır; başka bir sıralama seçilince unutulur. Adresteki ?sirala= her zaman
// önce gelir (paylaşılan bağlantı ve geri tuşu). 'Size göre' sırasını sunucu verir (GET /api/proposals?sort=sana-gore); istemci
// o listeyi yeniden SIRALAMAZ, yalnız süzer (sekme, tür, arama göreli sırayı korur).
import type { ProposalSort } from "@forum/shared";
import { readDevice, removeDevice, writeDevice } from "./deviceStore";
import { PREF_KEYS } from "./prefs";

/** Kişisel sıranın ?sirala= değeri (sunucunun `sort` parametresiyle aynı). */
export const PERSONAL_SORT = "sana-gore" satisfies ProposalSort;

export type ListSortId = "yeni" | "sure" | "mesaj" | "eski" | typeof PERSONAL_SORT;

/** Varsayılan sıralama (değişmez). */
export const DEFAULT_SORT: ListSortId = "yeni";

const BASE_SORTS: { value: ListSortId; label: string }[] = [
  { value: "yeni", label: "En yeni" },
  { value: "sure", label: "Süresi en yakın" },
  { value: "mesaj", label: "En çok mesaj" },
  { value: "eski", label: "En eski" },
];

/** Sırala seçenekleri: 'Size göre' yalnız oturumdaki üyeye (varsayılanın hemen altında). */
export function sortOptions(loggedIn: boolean): { value: ListSortId; label: string }[] {
  return loggedIn ? [BASE_SORTS[0], { value: PERSONAL_SORT, label: "Size göre" }, ...BASE_SORTS.slice(1)] : BASE_SORTS.slice();
}

/**
 * Etkin sıralama (saf). `param`: adresteki ?sirala= (yoksa null).
 * - Geçerli bir değer varsa o; ancak 'Size göre' oturum yoksa varsayılana döner.
 * - Yoksa (ya da geçersizse): oturum varsa ve bu cihazda 'Size göre' hatırlanıyorsa o, değilse varsayılan ("En yeni").
 */
export function resolveListSort(param: string | null | undefined, opts: { loggedIn: boolean; remembered: boolean }): ListSortId {
  const valid = sortOptions(true).some((s) => s.value === param);
  if (valid) return param === PERSONAL_SORT && !opts.loggedIn ? DEFAULT_SORT : (param as ListSortId);
  return opts.loggedIn && opts.remembered ? PERSONAL_SORT : DEFAULT_SORT;
}

export const sortPrefKey = (userId: string): string => `${PREF_KEYS.proposalSort}:${userId}`;

/** Bu cihazda bu üye için 'Size göre' hatırlanıyor mu? */
export function rememberedPersonalSort(userId: string | null | undefined): boolean {
  return !!userId && readDevice(sortPrefKey(userId)) === PERSONAL_SORT;
}

/** Seçimi hatırlar ('Size göre') ya da unutur (başka bir sıralama seçildi). */
export function rememberPersonalSort(userId: string | null | undefined, on: boolean): void {
  if (!userId) return;
  if (on) writeDevice(sortPrefKey(userId), PERSONAL_SORT);
  else removeDevice(sortPrefKey(userId));
}
