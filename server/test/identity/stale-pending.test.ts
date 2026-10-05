// #276: bekleyen başvuruların 180 günlük imhası GERÇEK duvar saatiyle ölçülür. Simüle saat (TIME_SCALE, yönetici "ileri al")
// ne kadar ilerlerse ilerlesin başvuru imha edilmez; kural gelmeden önce açılmış başvurularda süre ilk görüldüğü andan başlar.
import { describe, expect, it } from "vitest";
import { DAY } from "../../src/core/clock";
import { STALE_PENDING_MS } from "../../src/identity";
import { insertUser } from "../helpers/fakes";
import { regInput, setup } from "./fixtures";

const pendingKeys = (ctx: ReturnType<typeof setup>["ctx"]) =>
  ctx.db.all<{ key: string; value: string }>("SELECT key, value FROM meta WHERE key LIKE 'identity.pending_since:%' ORDER BY key");

describe("bekleyen başvuru imhası: gerçek saat", () => {
  it("180 gün = gerçek gün; simüle saat 400 gün ileri alınsa da imha yok", async () => {
    let real = Date.UTC(2026, 9, 5);
    const { identity, ctx } = setup({ realNow: () => real });
    expect(STALE_PENDING_MS).toBe(180 * DAY);
    const { user } = await identity.register(regInput());
    ctx.clock.advance(400 * DAY);
    expect(identity.purgeStalePending()).toBe(0);
    expect(identity.me(user.id).status).toBe("pending");
    real += 180 * DAY;
    expect(identity.purgeStalePending()).toBe(0); // sınır dahil değil (eski kuralla aynı: kesinlikle daha eski)
    real += 1;
    expect(identity.purgeStalePending()).toBe(1);
    expect(identity.me(user.id).status).toBe("rejected");
    expect(pendingKeys(ctx)).toEqual([]);
    expect(ctx.db.get("SELECT 1 FROM audit_log WHERE action = 'identity.purge_stale' AND target = ?", user.id)).toBeTruthy();
  });

  it("başvurunun gerçek açılış anı kayıtta yazılır; onay ve ret kaydı siler; doğrudan doğrulanmış üyede kayıt yok", async () => {
    const real = Date.UTC(2026, 9, 5, 8);
    const { identity, ctx, registrarId } = setup({ realNow: () => real });
    const a = (await identity.register(regInput())).user;
    const b = (await identity.register(regInput())).user;
    await identity.createByRegistrar(registrarId, regInput());
    expect(pendingKeys(ctx)).toEqual(
      [a.id, b.id].sort().map((id) => ({ key: `identity.pending_since:${id}`, value: String(real) })),
    );
    await identity.verify(registrarId, a.id, "approve");
    await identity.verify(registrarId, b.id, "reject");
    expect(pendingKeys(ctx)).toEqual([]);
  });

  it("açılış anı bilinmeyen (eski) başvuru: ilk bakımda süre başlar, 180 gerçek gün sonra imha edilir", async () => {
    let real = Date.UTC(2026, 9, 5);
    const { identity, ctx } = setup({ realNow: () => real });
    // Kuraldan önce açılmış, simüle saate göre çok eski bir başvuru (meta kaydı yok).
    const old = insertUser(ctx.db, { nickname: "eski_basvuru", status: "pending", createdAt: Date.UTC(2020, 0, 1) });
    expect(identity.purgeStalePending()).toBe(0);
    expect(pendingKeys(ctx)).toEqual([{ key: `identity.pending_since:${old}`, value: String(real) }]);
    real += 100 * DAY;
    expect(identity.purgeStalePending()).toBe(0);
    expect(pendingKeys(ctx)[0].value).toBe(String(Date.UTC(2026, 9, 5))); // ikinci bakım süreyi yeniden başlatmaz
    real += 81 * DAY;
    expect(identity.purgeStalePending()).toBe(1);
    expect(identity.me(old).status).toBe("rejected");
  });

  it("bozuk kayıt erken imhaya yol açmaz: süre yeniden başlar", async () => {
    const real = Date.UTC(2026, 9, 5);
    const { identity, ctx } = setup({ realNow: () => real });
    const { user } = await identity.register(regInput());
    ctx.db.run("UPDATE meta SET value = 'bozuk' WHERE key = ?", `identity.pending_since:${user.id}`);
    expect(identity.purgeStalePending()).toBe(0);
    expect(identity.me(user.id).status).toBe("pending");
    expect(pendingKeys(ctx)).toEqual([{ key: `identity.pending_since:${user.id}`, value: String(real) }]);
  });
});
