// Tohum verisi: bileşim köküyle kurulmuş servisler üzerinde senaryoyu çalıştırır, doğrular ve özetler.
import { createRng } from "@forum/shared";
import type { AppServices } from "../app";
import type { Clock } from "../core/clock";
import { SeedEngine } from "./engine";
import { runScenario } from "./scenario";
import { printSummary, verifySeed, type Check } from "./verify";

export { SeedEngine } from "./engine";
export { KEYS, runScenario, setupAccounts, setupGraph } from "./scenario";
export { verifySeed, printSummary, type Check } from "./verify";

export const SEED = "forum-seed-1";

export interface SeedRunOptions {
  start: number;
  end: number;
  log?: (msg: string) => void;
  /** Özet tablosunu yazdır (varsayılan: evet) */
  summary?: boolean;
}

export interface SeedRunResult {
  engine: SeedEngine;
  checks: Check[];
  ok: boolean;
  problems: string[];
}

/** Forum çekirdeğinin console.error'a yazdığı hataları yakalar (tohum raporunda gösterilir). */
function captureForumErrors(into: string[]): () => void {
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    const text = args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    into.push(`Sunucu hatası: ${text}`);
  };
  return () => {
    console.error = orig;
  };
}

export async function runSeed(services: AppServices, clock: Clock, opts: SeedRunOptions): Promise<SeedRunResult> {
  const t0 = performance.now();
  const log = opts.log ?? (() => undefined);
  const engine = new SeedEngine(services, clock, createRng(SEED), log);
  const serverErrors: string[] = [];
  const restore = captureForumErrors(serverErrors);
  try {
    await runScenario(engine, { start: opts.start, end: opts.end });
    // Son anlık görüntü ve uzlaşı toplulukları (gösterge).
    await services.forum.clusters.snapshot("tohum");
    services.graph.agreementCommunities(SEED);
    await services.ledger.flush();
  } catch (e) {
    engine.problem(`Senaryo yarıda kaldı: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  } finally {
    restore();
  }
  const problems = [...engine.problems, ...serverErrors];
  let checks: Check[];
  try {
    checks = verifySeed(engine);
  } catch (e) {
    checks = [{ label: "Doğrulama yapılabildi", ok: false, detail: e instanceof Error ? e.message : String(e) }];
  }
  const ok = checks.every((c) => c.ok);
  if (opts.summary !== false) printSummary(engine, checks, { seconds: (performance.now() - t0) / 1000, simNow: clock.now(), problems });
  return { engine, checks, ok, problems };
}
