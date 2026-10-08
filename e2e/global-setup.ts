// Küresel kurulum (bir kez): web arayüzü derlenmemişse ya da eskiyse derler, geçici bir klasörde demo verisini
// tohumlar (DATA_DIR=<geçici>/template/data npm run seed -- --reset ile aynı) ve şablonun yerini işçilere bildirir.
// Döndürülen işlev küresel temizliktir: açık kalmış sunucuları kapatır, geçici klasörü siler (E2E_KEEP=1 ise bırakır).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ENV_KEYS, REPO_ROOT, SERVER_DIR, WEB_DIR, WEB_DIST } from "./support/env";
import { resolveFrom, runToCompletion, tsxLoader } from "./support/proc";
import { killLeftoverServers } from "./support/server";

/** Klasördeki en yeni dosya değişiklik zamanı (node_modules ve derleme çıktıları hariç). */
function newestMtime(dir: string): number {
  let max = 0;
  if (!existsSync(dir)) return max;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    max = Math.max(max, st.isDirectory() ? newestMtime(p) : st.mtimeMs);
  }
  return max;
}

/** Web derlemesi gerekli mi? E2E_BUILD=1 → her zaman, E2E_BUILD=0 → yalnızca dist yoksa; varsayılan: yok ya da eskiyse. */
function needsBuild(): string | null {
  const index = join(WEB_DIST, "index.html");
  if (!existsSync(index)) return "web/dist bulunamadı";
  if (process.env.E2E_BUILD === "1") return "E2E_BUILD=1";
  if (process.env.E2E_BUILD === "0") return null;
  const built = statSync(index).mtimeMs;
  const sources = Math.max(newestMtime(join(WEB_DIR, "src")), newestMtime(join(REPO_ROOT, "shared", "src")), statSync(join(WEB_DIR, "index.html")).mtimeMs);
  return sources > built ? "kaynak dosyalar web/dist'ten yeni" : null;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const started = Date.now();
  const tmpRoot = mkdtempSync(join(tmpdir(), "forum-e2e-"));
  mkdirSync(join(tmpRoot, "logs"), { recursive: true });
  try {
    await prepare(tmpRoot);
  } catch (err) {
    // Kurulum başarısızsa temizlik işlevi hiç dönmez: geçici klasörü burada sil (günlükler hata iletisinde).
    if (process.env.E2E_KEEP !== "1") rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    throw err;
  }
  console.log(`[e2e] Hazır (${Math.round((Date.now() - started) / 1000)} sn). Geçici klasör: ${tmpRoot}`);

  return async () => {
    killLeftoverServers(tmpRoot);
    if (process.env.E2E_KEEP === "1") {
      console.log(`[e2e] Geçici klasör bırakıldı (E2E_KEEP=1): ${tmpRoot}`);
      return;
    }
    // Windows'ta kapanan süreçlerin dosya kilitleri birkaç yüz ms sürebilir: rmSync'in kendi yeniden denemesi kullanılır.
    try {
      rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (e) {
      console.warn(`[e2e] Geçici klasör silinemedi (${tmpRoot}): ${e instanceof Error ? e.message : String(e)}`);
    }
  };
}

async function prepare(tmpRoot: string): Promise<void> {
  const why = needsBuild();
  if (why) {
    console.log(`[e2e] Web arayüzü derleniyor (${why})…`);
    const viteBin = join(dirname(resolveFrom(WEB_DIR, "vite/package.json")), "bin", "vite.js");
    await runToCompletion(process.execPath, [viteBin, "build"], { cwd: WEB_DIR, logFile: join(tmpRoot, "logs", "web-build.log"), timeoutMs: 300_000, label: "Web derlemesi (vite build)" });
  }

  // Şablon klasörün adı "data": tohum betiğinin --reset güvenlik denetimi yalnızca böyle bir klasörü sorgusuz sıfırlar.
  const template = join(tmpRoot, "template", "data");
  mkdirSync(template, { recursive: true });
  console.log(`[e2e] Demo verisi tohumlanıyor → ${template}`);
  // DB_PATH ve ANTHROPIC_API_KEY ortamdan DEVRALINMAZ (undefined → alt sürece geçmez): tohum yalnız geçici şablon klasörüne yazar.
  const env: NodeJS.ProcessEnv = { DATA_DIR: template, TIME_SCALE: "1", AI_ENABLED: "false", DB_PATH: undefined, ANTHROPIC_API_KEY: undefined, TOHUM_SIFRE: undefined };
  await runToCompletion(process.execPath, ["--import", tsxLoader(), join(SERVER_DIR, "src", "seed.ts"), "--reset"], {
    cwd: SERVER_DIR,
    env,
    logFile: join(tmpRoot, "logs", "seed.log"),
    timeoutMs: 300_000,
    label: "Tohum verisi (npm run seed -- --reset)",
  });

  // İşçiler (test dosyaları) bu değişkenleri devralır.
  process.env[ENV_KEYS.tmpRoot] = tmpRoot;
  process.env[ENV_KEYS.template] = template;
}
