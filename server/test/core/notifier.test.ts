// Bildirim yayılımı (#290): alıcı başına otomatik işlem yerine TEK ifade/işlem.
import { describe, expect, it, vi } from "vitest";
import { ManualClock } from "../../src/core/clock";
import type { ForumDeps } from "../../src/core/forum-contracts";
import { DbNotifier } from "../../src/core/notifier";
import { openMemoryDb } from "../../src/db";
import { ForumCore } from "../../src/forum/util";

const notice = { kind: "vote_open", title: "Oylama açıldı", body: "Oy verebilirsiniz.", link: "/p/1" };

describe("DbNotifier.notifyMany", () => {
  it("N alıcıya tek veritabanı ifadesiyle yazar, yinelenenleri atlar", () => {
    const db = openMemoryDb();
    const notifier = new DbNotifier({ db, clock: new ManualClock() });
    const run = vi.spyOn(db, "run");
    const ids = Array.from({ length: 500 }, (_, i) => `u${i}`);
    notifier.notifyMany([...ids, "u0", "u1"], notice);
    expect(run).toHaveBeenCalledTimes(1);
    const rows = db.all<{ user_id: string; kind: string; title: string; link: string | null; read: number }>(
      "SELECT user_id, kind, title, link, read FROM notifications",
    );
    expect(rows).toHaveLength(500);
    expect(new Set(rows.map((r) => r.user_id)).size).toBe(500);
    expect(rows[0]).toMatchObject({ kind: "vote_open", title: "Oylama açıldı", link: "/p/1", read: 0 });
    expect(db.get<{ n: number }>("SELECT COUNT(DISTINCT id) AS n FROM notifications")?.n).toBe(500);
  });

  it("boş alıcı listesinde hiçbir şey yazmaz; link verilmezse NULL kalır", () => {
    const db = openMemoryDb();
    const notifier = new DbNotifier({ db, clock: new ManualClock() });
    const run = vi.spyOn(db, "run");
    notifier.notifyMany([], notice);
    expect(run).not.toHaveBeenCalled();
    notifier.notifyMany(["a"], { kind: "k", title: "t", body: "b" });
    expect(db.get<{ link: string | null }>("SELECT link FROM notifications")?.link).toBeNull();
  });
});

describe("ForumCore.notify", () => {
  const makeCore = (notifier: unknown) =>
    new ForumCore({ ctx: { db: openMemoryDb(), config: {}, clock: new ManualClock() }, audit: {}, notifier } as unknown as ForumDeps);

  it("notifyMany varsa toplu yolu kullanır (tekil notify çağrılmaz); işlem içindeyse commit sonrası", () => {
    const notifier = { notify: vi.fn(), notifyMany: vi.fn() };
    const core = makeCore(notifier);
    core.tx(() => {
      core.notify(["a", "b", "a"], { kind: "k", title: "t", body: "b" });
      expect(notifier.notifyMany).not.toHaveBeenCalled(); // commit'ten önce yok
    });
    expect(notifier.notifyMany).toHaveBeenCalledTimes(1);
    expect([...notifier.notifyMany.mock.calls[0][0]]).toEqual(["a", "b"]);
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it("notifyMany uygulamayan notifier için tekil notify döngüsüne düşer", () => {
    const notifier = { notify: vi.fn() };
    makeCore(notifier).notify(["a", "b"], { kind: "k", title: "t", body: "b" });
    expect(notifier.notify).toHaveBeenCalledTimes(2);
  });
});
