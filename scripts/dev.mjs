#!/usr/bin/env node
// Geliştirme modu: API sunucusunu (npm run dev -w server) ve Vite'ı (npm run dev -w web) birlikte başlatır, çıktılarını
// [sunucu] / [web] önekiyle tek terminalde gösterir. Windows (cmd/PowerShell), macOS ve Linux'ta aynı çalışır; ek bağımlılık yok.
// Ctrl+C (ya da SIGTERM) iki süreci de (alt süreç ağaçlarıyla birlikte) kapatır; biri beklenmedik biçimde biterse diğeri de durur.
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

const tasks = [
  { name: "sunucu", color: "36", args: ["run", "dev", "-w", "server"] },
  { name: "web", color: "35", args: ["run", "dev", "-w", "web"] },
];
const width = Math.max(...tasks.map((t) => t.name.length));

/** @type {{ task: typeof tasks[number], child: import("node:child_process").ChildProcess, exited: boolean }[]} */
const running = [];
let stopping = false;
let exitCode = 0;

function log(task, line, isErr) {
  const prefix = paint(task.color, `[${task.name.padEnd(width)}]`);
  (isErr ? process.stderr : process.stdout).write(`${prefix} ${line}\n`);
}

function pipe(task, stream, isErr) {
  if (!stream) return;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  rl.on("line", (line) => log(task, line, isErr));
}

function start(task) {
  // Windows'ta npm bir .cmd dosyasıdır: kabuk üzerinden tek komut dizesi olarak çalıştırılır (argümanlar sabittir).
  // Diğerlerinde ayrı süreç grubu (detached) açılır ki kapanışta tüm alt ağaç (tsx izleyicisi, vite) tek sinyalle durdurulabilsin.
  const options = {
    cwd: root,
    env: { ...process.env, FORCE_COLOR: useColor ? "1" : "0" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: !isWin,
    windowsHide: true,
  };
  const child = isWin ? spawn(`npm ${task.args.join(" ")}`, { ...options, shell: true }) : spawn("npm", task.args, options);
  const entry = { task, child, exited: false };
  running.push(entry);
  pipe(task, child.stdout, false);
  pipe(task, child.stderr, true);
  child.on("error", (err) => {
    log(task, paint("31", `başlatılamadı: ${err.message}`), true);
    entry.exited = true;
    exitCode = 1;
    shutdown("hata");
  });
  child.on("exit", (code, signal) => {
    entry.exited = true;
    if (!stopping) {
      log(task, paint("31", `beklenmedik biçimde sonlandı (${signal ?? `çıkış kodu ${code}`}); diğer süreç de kapatılıyor.`), true);
      exitCode = typeof code === "number" && code > 0 && code < 256 ? code : 1;
      shutdown("alt süreç bitti");
    }
    if (running.every((r) => r.exited)) process.exit(exitCode);
  });
}

function kill(entry) {
  if (entry.exited || entry.child.pid === undefined) return;
  try {
    if (isWin) {
      // Kabuk + npm + node ağacının tamamı (/T) zorla (/F) kapatılır.
      spawnSync("taskkill", ["/pid", String(entry.child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      process.kill(-entry.child.pid, "SIGTERM"); // süreç grubu
    }
  } catch {
    /* zaten bitmiş */
  }
}

function shutdown(reason) {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`\n${paint("33", `Geliştirme sunucuları kapatılıyor (${reason})…`)}\n`);
  for (const entry of running) kill(entry);
  // Güvenlik ağı: süreçler 5 sn içinde kapanmazsa çık.
  setTimeout(() => process.exit(exitCode), 5000).unref();
}

process.on("SIGINT", () => shutdown("Ctrl+C"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
if (isWin) process.on("SIGBREAK", () => shutdown("Ctrl+Break"));

console.log(paint("1", "Forum Sistemi — geliştirme modu"));
// Vite vekilinin hedefi (web/vite.config.ts ile aynı kural): VITE_API_TARGET > http://localhost:${PORT || 4000}
const apiTarget = (process.env.VITE_API_TARGET || `http://localhost:${process.env.PORT || 4000}`).replace(/\/+$/, "");
console.log(`  API (tsx watch) : http://localhost:${process.env.PORT || 4000}   (PORT ile değiştirilebilir)`);
console.log(`  Web (Vite)      : http://localhost:5173   (/api → ${apiTarget} vekili)`);
console.log("  Durdurmak için Ctrl+C.\n");
for (const t of tasks) start(t);
