// #342 seed --reset: DB_PATH DATA_DIR dışındaysa o veritabanı da sıfırlanır; e2e kurulumu DB_PATH'i seed'e sızdırmaz.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extraDbFiles } from "../../src/seed";

describe("seed --reset ve DB_PATH", () => {
  const dataDir = resolve("/tmp/forum-data");

  it("DATA_DIR/forum.db ve :memory: zaten sıfırlanan kapsamdadır → ek dosya yok", () => {
    expect(extraDbFiles(dataDir, join(dataDir, "forum.db"))).toEqual([]);
    expect(extraDbFiles(dataDir, ":memory:")).toEqual([]);
  });

  it("DATA_DIR dışındaki DB_PATH ile -wal/-shm dosyaları da silinecekler listesindedir", () => {
    const db = resolve("/tmp/baska/ozel.db");
    expect(extraDbFiles(dataDir, db)).toEqual([db, `${db}-wal`, `${db}-shm`]);
  });

  it("e2e küresel kurulum DB_PATH ve ANTHROPIC_API_KEY'i ortamdan devralmaz", () => {
    const src = readFileSync(resolve(__dirname, "../../../e2e/global-setup.ts"), "utf8");
    expect(src).toMatch(/DB_PATH: undefined/);
    expect(src).toMatch(/ANTHROPIC_API_KEY: undefined/);
  });
});
