// Defter anahtarları: uygulama sunucusu (işlem imzası) ve her doğrulayıcının Ed25519 gizli anahtarı.
// Kalıcı kipte ${dataDir}/keys/ledger/{app,v0,v1,…}.key (0600); bellek kipinde her açılışta rastgele.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ed25519RandomSecretKey } from "@forum/shared";

export interface LedgerKeys {
  app: string;
  validators: Map<string, string>; // id → gizli anahtar (hex)
}

const HEX32 = /^[0-9a-f]{64}$/;

function loadOrCreate(dir: string | null, name: string): string {
  if (!dir) return ed25519RandomSecretKey();
  const p = join(dir, `${name}.key`);
  if (existsSync(p)) {
    const k = readFileSync(p, "utf8").trim().toLowerCase();
    if (!HEX32.test(k)) throw new Error(`Defter anahtar dosyası bozuk: ${p}`);
    return k;
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const k = ed25519RandomSecretKey();
  writeFileSync(p, k, { mode: 0o600 });
  chmodSync(p, 0o600);
  return k;
}

export function loadLedgerKeys(dataDir: string | null, validatorIds: string[]): LedgerKeys {
  const dir = dataDir ? join(dataDir, "keys", "ledger") : null;
  const validators = new Map<string, string>();
  for (const id of validatorIds) validators.set(id, loadOrCreate(dir, id));
  return { app: loadOrCreate(dir, "app"), validators };
}
