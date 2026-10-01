// Oy makbuzları cihazda saklanır (sunucuya güvenmeden "Oyum kayıtlı mı?" doğrulaması için).
// Oy değiştirilince YENİ makbuz eklenir; bir öneri+tur için geçerli olan EN SON makbuzdur.
import type { BallotReceipt } from "@forum/shared";
import { getJsonPref, PREF_KEYS, setJsonPref } from "./prefs";

export interface StoredReceipt extends BallotReceipt {
  /** Cihaza kaydedildiği an (istemci saati) */
  savedAt: number;
  /** Makbuzu alan kullanıcı (aynı cihazı paylaşan kişiler karışmasın) */
  ownerId: string | null;
  proposalTitle?: string;
  proposalSeq?: number;
}

let owner: string | null = null;

/** AuthContext oturum açılınca/kapanınca çağırır. */
export function setReceiptOwner(userId: string | null): void {
  owner = userId;
}

async function readAll(): Promise<StoredReceipt[]> {
  const list = await getJsonPref<StoredReceipt[]>(PREF_KEYS.receipts, []);
  return Array.isArray(list) ? list : [];
}

function sameReceipt(a: BallotReceipt, b: BallotReceipt): boolean {
  return a.proposalId === b.proposalId && a.round === b.round && a.ballotId === b.ballotId && a.commitment === b.commitment && a.castAt === b.castAt;
}

/** Makbuzu ekler (aynısı varsa günceller, ör. txHash sonradan geldiyse). */
export async function saveReceipt(r: BallotReceipt, meta?: { proposalTitle?: string; proposalSeq?: number }): Promise<StoredReceipt> {
  const all = await readAll();
  const stored: StoredReceipt = { ...r, savedAt: Date.now(), ownerId: owner, ...meta };
  const i = all.findIndex((x) => sameReceipt(x, r));
  if (i >= 0) all[i] = { ...all[i], ...stored, savedAt: all[i].savedAt };
  else all.push(stored);
  await setJsonPref(PREF_KEYS.receipts, all);
  return stored;
}

/** Oturumdaki kullanıcının makbuzları, en yeniden eskiye. proposalId verilirse yalnızca o öneri. */
export async function listReceipts(proposalId?: string): Promise<StoredReceipt[]> {
  const all = await readAll();
  return all
    .filter((r) => (proposalId ? r.proposalId === proposalId : true))
    .filter((r) => r.ownerId == null || owner == null || r.ownerId === owner)
    .sort((a, b) => b.castAt - a.castAt || b.savedAt - a.savedAt);
}

/** Bir öneri (ve isteğe bağlı tur) için geçerli (en son) makbuz. */
export async function latestReceipt(proposalId: string, round?: 1 | 2): Promise<StoredReceipt | null> {
  const list = await listReceipts(proposalId);
  return list.find((r) => (round ? r.round === round : true)) ?? null;
}

/** Makbuzun aynı öneri+turdaki en son makbuz olup olmadığı (eski makbuzlar "geçersiz/değiştirildi" gösterilir). */
export function isLatest(r: BallotReceipt, list: BallotReceipt[]): boolean {
  const newer = list.filter((x) => x.proposalId === r.proposalId && x.round === r.round && x.castAt > r.castAt);
  return newer.length === 0;
}

/** Makbuzları JSON metni olarak dışa aktarır (yedek / başka cihaza taşıma). */
export async function exportReceipts(): Promise<string> {
  return JSON.stringify(await listReceipts(), null, 2);
}

/** JSON metninden makbuz içe aktarır; eklenen sayıyı döner. */
export async function importReceipts(json: string): Promise<number> {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Geçersiz makbuz dosyası: liste bekleniyordu.");
  let n = 0;
  for (const x of parsed) {
    const r = x as Partial<BallotReceipt>;
    if (typeof r?.proposalId === "string" && typeof r.ballotId === "string" && typeof r.commitment === "string" && typeof r.salt === "string" && r.choice) {
      await saveReceipt(r as BallotReceipt);
      n++;
    }
  }
  return n;
}

/** Oturumdaki kullanıcının makbuzlarını cihazdan siler. */
export async function clearReceipts(): Promise<void> {
  const all = await readAll();
  await setJsonPref(
    PREF_KEYS.receipts,
    all.filter((r) => !(r.ownerId == null || owner == null || r.ownerId === owner)),
  );
}
