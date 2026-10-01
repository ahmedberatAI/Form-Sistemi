// Süreç yardımcıları: kabuksuz (shell:false) çalıştırma, Windows'ta süreç ağacını öldürme, port/HTTP bekleme.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "./env";

const requireFromRoot = createRequire(join(REPO_ROOT, "package.json"));

/**
 * tsx yükleyicisinin file:// adresi: `node --import <adres> betik.ts` = `tsx betik.ts`, ama tek süreç
 * (npm/npx kabuğu ve ara süreç yok; Windows'ta da shell:false ile başlatılabilir).
 */
export function tsxLoader(): string {
  // "tsx" paketinin kök dışa aktarımı ESM yükleyicisidir (dist/loader.mjs). Windows yolları URL'ye çevrilmelidir.
  return pathToFileURL(requireFromRoot.resolve("tsx")).href;
}

/** Bir paketin dosyasının mutlak yolu, verilen klasörden çözülerek (ör. vite/bin/vite.js). */
export function resolveFrom(dir: string, request: string): string {
  return createRequire(join(dir, "package.json")).resolve(request);
}

export interface RunResult {
  code: number | null;
  output: string;
}

/** Bir komutu kabuksuz çalıştırır, çıktısını bir günlük dosyasına yazar; hata kodunda fırlatır. */
export function runToCompletion(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; logFile: string; timeoutMs: number; label: string }): Promise<RunResult> {
  return new Promise((resolveRun, reject) => {
    const log = createWriteStream(opts.logFile);
    let output = "";
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const onData = (b: Buffer) => {
      const s = b.toString("utf8");
      output += s;
      if (output.length > 200_000) output = output.slice(-100_000);
      log.write(b);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const timer = setTimeout(() => {
      killTree(child);
      reject(new Error(`${opts.label}: ${Math.round(opts.timeoutMs / 1000)} sn içinde bitmedi. Günlük: ${opts.logFile}`));
    }, opts.timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      log.end();
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      log.end();
      if (code === 0) resolveRun({ code, output });
      else reject(new Error(`${opts.label} başarısız (çıkış kodu ${code}). Son çıktı:\n${output.slice(-3000)}\nGünlük: ${opts.logFile}`));
    });
  });
}

/** Süreci ve alt süreçlerini öldürür. Windows'ta sinyaller ağaca yayılmadığı için taskkill /T /F kullanılır. */
export function killTree(child: ChildProcess | number): void {
  const pid = typeof child === "number" ? child : child.pid;
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    // detached: true ile başlatılan süreçlerde negatif pid tüm grubu hedefler.
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* zaten kapanmış */
    }
  }
}

/** Portta dinleyen biri var mı? */
export function isPortInUse(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((res) => {
    const sock = connect({ port, host });
    sock.once("connect", () => {
      sock.destroy();
      res(true);
    });
    sock.once("error", () => res(false));
    sock.setTimeout(1000, () => {
      sock.destroy();
      res(false);
    });
  });
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Bir koşul sağlanana kadar kısa aralıklarla yoklar (sabit uyku değil: koşul sağlanınca hemen döner).
 * Süre dolarsa açıklamalı hata fırlatır.
 */
export async function pollUntil<T>(fn: () => Promise<T | null | undefined | false>, opts: { timeoutMs: number; intervalMs?: number; what: string; onTimeout?: () => string }): Promise<T> {
  const deadline = Date.now() + opts.timeoutMs;
  let lastError: unknown = null;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch (e) {
      lastError = e;
    }
    if (Date.now() > deadline) {
      const extra = opts.onTimeout?.() ?? "";
      throw new Error(`${opts.what}: ${Math.round(opts.timeoutMs / 1000)} sn içinde gerçekleşmedi.${lastError ? ` Son hata: ${String(lastError)}` : ""}${extra ? `\n${extra}` : ""}`);
    }
    await pause(opts.intervalMs ?? 200);
  }
}

/** Günlük dosyasının son satırları (hata iletilerine eklemek için). */
export function tailFile(path: string, chars = 3000): string {
  try {
    if (!existsSync(path)) return "";
    const s = readFileSync(path, "utf8");
    return s.slice(-chars);
  } catch {
    return "";
  }
}
