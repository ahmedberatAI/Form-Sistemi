// Defter kipi: yalnızca tek süreç (in-process) desteklenir. Çalışmayan "ledger:node" betiği paketten kaldırıldı;
// LEDGER_MODE=multi-process sessizce yok sayılmaz, uyarıyla in-process kullanılır (MIMARI.md §4).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, SERVER_ROOT } from "../../src/core/config";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "forum-defter-kipi-"));
  dirs.push(dir);
  return dir;
}

describe("defter kipi", () => {
  it("LEDGER_MODE=multi-process desteklenmez: uyarı yazılır ve in-process kullanılır", () => {
    vi.stubEnv("LEDGER_MODE", "multi-process");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(loadConfig({ dataDir: tempDir() }).ledgerMode).toBe("in-process");
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/LEDGER_MODE=multi-process desteklenmiyor/));
  });

  it("tanımsız ya da in-process: uyarı yok", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("LEDGER_MODE", "in-process");
    expect(loadConfig({ dataDir: tempDir() }).ledgerMode).toBe("in-process");
    vi.stubEnv("LEDGER_MODE", undefined);
    expect(loadConfig({ dataDir: tempDir() }).ledgerMode).toBe("in-process");
    expect(warn).not.toHaveBeenCalled();
  });

  it("sunucu paketinde çalışmayan 'ledger:node' betiği yok", () => {
    const pkg = JSON.parse(readFileSync(join(SERVER_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(Object.keys(pkg.scripts)).not.toContain("ledger:node");
    expect(Object.values(pkg.scripts).some((s) => s.includes("standalone"))).toBe(false);
  });
});
