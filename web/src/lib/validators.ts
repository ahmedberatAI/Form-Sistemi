// Doğrulayıcı açık anahtarlarının ilk kullanımda sabitlenmesi (TOFU — trust on first use).
// Dahil olma kanıtları (verifyInclusionProof) sunucunun o an söylediği anahtarlarla değil,
// cihazda sabitlenmiş anahtarlarla doğrulanır; anahtarlar sonradan değişirse kullanıcı uyarılır.
import type { ValidatorKeys } from "@forum/shared";
import { getServerUrl } from "../api/client";
import { getValidators } from "../api/endpoints";
import { getJsonPref, PREF_KEYS, setJsonPref } from "./prefs";

export interface PinnedValidators {
  chainId: string;
  validators: { id: string; publicKey: string }[];
  /** Uygulama sunucusunun işlem imzalama anahtarı (eski sabitlemelerde olmayabilir) */
  appPublicKey?: string;
  pinnedAt: number;
  serverUrl: string;
}

export interface ValidatorDiff {
  same: boolean;
  chainChanged: boolean;
  added: string[];
  removed: string[];
  changed: string[];
}

export type PinStatus = "pinned_now" | "match" | "changed";

/** Sunucu adresine göre anahtarlanmış depo (farklı sunucuların zinciri farklıdır). */
type Store = Record<string, PinnedValidators>;

const keyOf = (serverUrl: string) => serverUrl || "(aynı köken)";

async function readStore(): Promise<Store> {
  const s = await getJsonPref<Store>(PREF_KEYS.validators, {});
  return s && typeof s === "object" ? s : {};
}

/** Etkin sunucu için sabitlenmiş anahtarlar (yoksa null). */
export async function getPinnedValidators(): Promise<PinnedValidators | null> {
  const url = await getServerUrl();
  return (await readStore())[keyOf(url)] ?? null;
}

/** Verilen anahtarları etkin sunucu için sabitler (varsa üzerine yazar). */
export async function pinValidators(keys: ValidatorKeys): Promise<PinnedValidators> {
  const url = await getServerUrl();
  const store = await readStore();
  const pinned: PinnedValidators = {
    chainId: keys.chainId,
    validators: keys.validators.map((v) => ({ id: v.id, publicKey: v.publicKey.toLowerCase() })),
    appPublicKey: keys.appPublicKey?.toLowerCase(),
    pinnedAt: Date.now(),
    serverUrl: url,
  };
  store[keyOf(url)] = pinned;
  await setJsonPref(PREF_KEYS.validators, store);
  return pinned;
}

/** Sabitlenmiş anahtarları siler. all=true → tüm sunucular için. */
export async function resetPinnedValidators(all = false): Promise<void> {
  if (all) {
    await setJsonPref(PREF_KEYS.validators, {});
    return;
  }
  const url = await getServerUrl();
  const store = await readStore();
  delete store[keyOf(url)];
  await setJsonPref(PREF_KEYS.validators, store);
}

/** Tüm sunuculardaki sabitlemeler (Ayarlar sayfası için). */
export async function listPinnedValidators(): Promise<PinnedValidators[]> {
  return Object.values(await readStore());
}

export function compareValidators(pinned: Pick<PinnedValidators, "chainId" | "validators">, fresh: ValidatorKeys): ValidatorDiff {
  const a = new Map(pinned.validators.map((v) => [v.id, v.publicKey.toLowerCase()]));
  const b = new Map(fresh.validators.map((v) => [v.id, v.publicKey.toLowerCase()]));
  const added = [...b.keys()].filter((id) => !a.has(id));
  const removed = [...a.keys()].filter((id) => !b.has(id));
  const changed = [...a.keys()].filter((id) => b.has(id) && a.get(id) !== b.get(id));
  const chainChanged = pinned.chainId !== fresh.chainId;
  return { same: !chainChanged && !added.length && !removed.length && !changed.length, chainChanged, added, removed, changed };
}

/**
 * Sunucudan anahtarları alır; ilk kullanımda sabitler, sonraki kullanımlarda karşılaştırır.
 * Değişiklik varsa sabitlemeyi DEĞİŞTİRMEZ (status: "changed"); kullanıcı Ayarlar'dan sıfırlamalıdır.
 * Doğrulamada her zaman `pinned.validators` kullanılmalıdır.
 */
export async function ensurePinnedValidators(): Promise<{ status: PinStatus; pinned: PinnedValidators; fresh: ValidatorKeys; diff: ValidatorDiff }> {
  const fresh = await getValidators();
  const existing = await getPinnedValidators();
  if (!existing) {
    const pinned = await pinValidators(fresh);
    return { status: "pinned_now", pinned, fresh, diff: compareValidators(pinned, fresh) };
  }
  const diff = compareValidators(existing, fresh);
  return { status: diff.same ? "match" : "changed", pinned: existing, fresh, diff };
}

/** Değişiklik özetini Türkçe açıklar. */
export function describeValidatorDiff(d: ValidatorDiff): string {
  if (d.same) return "Doğrulayıcı anahtarları sabitlenmiş anahtarlarla aynı.";
  const parts: string[] = [];
  if (d.chainChanged) parts.push("zincir kimliği değişmiş");
  if (d.changed.length) parts.push(`anahtarı değişen doğrulayıcılar: ${d.changed.join(", ")}`);
  if (d.added.length) parts.push(`yeni doğrulayıcılar: ${d.added.join(", ")}`);
  if (d.removed.length) parts.push(`kaldırılan doğrulayıcılar: ${d.removed.join(", ")}`);
  return `Uyarı: sunucunun bildirdiği doğrulayıcı anahtarları cihazınızda sabitlenenlerden farklı (${parts.join("; ")}). Bu bir saldırı belirtisi olabilir; doğrulama sabitlenmiş anahtarlarla yapılır.`;
}
