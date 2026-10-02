// Veri klasörü için tek-örnek kilidi: aynı DATA_DIR'i iki süreç birlikte kullanırsa her biri blokları belleğe yükleyip
// aynı yüksekliğin üzerine yazar ve onaylı defter kayıtları sessizce kaybolur. Bu yüzden sunucu, tohum ve anahtar dönüşüm
// betiği klasörü kullanmadan önce DATA_DIR/.lock dosyasını ÖZEL olarak oluşturur ('wx'); kapanışta siler.
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";

export const LOCK_FILE_NAME = ".lock";
/** Dosya yeni oluşturulmuş ama içeriği henüz yazılmamış olabilir; bu süreden gençse "kilitli" sayılır. */
const FRESH_UNPARSEABLE_MS = 5_000;

interface LockInfo {
  pid: number;
  startedAt: number;
  token: string;
}

export interface DataDirLock {
  readonly path: string;
  /** Kilidi bırakır (yalnız kilit hâlâ bu sürecinse dosyayı siler). Birden çok kez çağrılabilir. */
  release(): void;
}

/** Veri klasörü başka bir canlı süreç tarafından kullanılıyor. */
export class DataDirLockedError extends Error {
  constructor(
    readonly lockPath: string,
    readonly holderPid: number | null,
  ) {
    super(
      `Veri klasörü başka bir süreç tarafından kullanılıyor${holderPid ? ` (PID ${holderPid})` : ""}: ${lockPath}\n` +
        "Aynı klasörü iki sunucu/betik birlikte kullanırsa defter kayıtları kaybolur. Önce o süreci kapatın " +
        "(sunucu, tohum betiği ya da anahtar dönüşümü olabilir). Süreç gerçekten yoksa kilit dosyasını elle silin.",
    );
    this.name = "DataDirLockedError";
  }
}

const held = new Map<string, LockInfo>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // process.exit() ile çıkan yollar (ör. betiklerin fail()'i) kilidi açıkta bırakmasın.
  process.once("exit", () => {
    for (const [path, info] of [...held]) removeIfOwned(path, info);
  });
}

function readInfo(path: string): LockInfo | "unparseable" | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    return "unparseable";
  }
  try {
    const v = JSON.parse(text) as Partial<LockInfo>;
    if (typeof v.pid === "number" && Number.isInteger(v.pid) && v.pid > 0 && typeof v.token === "string") {
      return { pid: v.pid, startedAt: typeof v.startedAt === "number" ? v.startedAt : 0, token: v.token };
    }
  } catch {
    /* aşağıda bozuk sayılır */
  }
  return "unparseable";
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: süreç var ama bize ait değil (canlı). ESRCH: yok.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function removeIfOwned(path: string, mine: LockInfo): void {
  held.delete(path);
  const cur = readInfo(path);
  if (cur && cur !== "unparseable" && cur.token === mine.token) rmSync(path, { force: true });
}

/**
 * dataDir için özel kilidi alır. ":memory:" (bellek içi test yapılandırması) için kilit alınmaz.
 * Bayat kilit (ölü PID, ya da bu süreçte tutulmayan kendi PID'imiz) uyarıyla devralınır; canlı süreçte
 * DataDirLockedError fırlatılır.
 */
export function acquireDataDirLock(dataDir: string, opts: { warn?: (msg: string) => void } = {}): DataDirLock {
  if (dataDir === ":memory:") return { path: ":memory:", release() {} };
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, LOCK_FILE_NAME);
  const mine: LockInfo = { pid: process.pid, startedAt: Date.now(), token: randomBytes(8).toString("hex") };
  if (held.has(path)) throw new DataDirLockedError(path, process.pid);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(path, "wx", 0o600);
      try {
        writeSync(fd, JSON.stringify(mine));
      } finally {
        closeSync(fd);
      }
      held.set(path, mine);
      installExitHook();
      return {
        path,
        release() {
          if (held.get(path) === mine) removeIfOwned(path, mine);
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    // Kilit dosyası var: sahibi canlı mı?
    const cur = readInfo(path);
    if (cur === null) continue; // bu arada silindi: yeniden dene
    if (cur === "unparseable") {
      let ageMs = Infinity;
      try {
        ageMs = Date.now() - statSync(path).mtimeMs;
      } catch {
        continue;
      }
      if (ageMs < FRESH_UNPARSEABLE_MS) throw new DataDirLockedError(path, null);
      warn(`[kilit] ${path} bozuk/boş bir kilit dosyasıydı; bayat sayılıp devralınıyor.`);
    } else {
      if (cur.pid !== process.pid && pidAlive(cur.pid)) throw new DataDirLockedError(path, cur.pid);
      const since = cur.startedAt ? ` (${new Date(cur.startedAt).toISOString()} tarihli)` : "";
      warn(`[kilit] ${path}${since} bayat bir kilitti (PID ${cur.pid} çalışmıyor); devralınıyor.`);
    }
    // Not: iki süreç aynı anda bayat kilidi devralmaya çalışırsa dar bir yarış penceresi kalır; 'wx' yeniden denemesi birini eler.
    rmSync(path, { force: true });
  }
  throw new DataDirLockedError(path, null);
}

/** Testler/araçlar için: dosya var mı (kilit alınmadan bakar). */
export function dataDirLockExists(dataDir: string): boolean {
  return existsSync(join(dataDir, LOCK_FILE_NAME));
}
