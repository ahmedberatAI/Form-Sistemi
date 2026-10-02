// Regresyon: ForumCore.tx yan etki kuyruğu savepoint'e göre kapsamlıdır (#4/#279) ve DB işlemi içindeki defter
// gönderimleri COMMIT sonrasına ertelenir; geri alınan işlem deftere "hayalet" kayıt bırakmaz (#272).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuditLogger } from "../../src/core/audit";
import type { LedgerService } from "../../src/core/contracts";
import type { ForumDeps } from "../../src/core/forum-contracts";
import { ForumCore } from "../../src/forum";
import { createLedgerService } from "../../src/ledger";
import { prepareTx } from "../../src/ledger/tx";
import { FakeLedger, makeCtx } from "../helpers/fakes";

afterEach(() => vi.restoreAllMocks());

const hidden = (id: string) => ({ messageId: id, proposalId: "p-1", ground: "g" });
const note = (title: string) => ({ kind: "test", title, body: "b" });

function setup(ledgerOf: (ctx: ReturnType<typeof makeCtx>) => LedgerService = (c) => new FakeLedger(c.clock)) {
  const ctx = makeCtx();
  const ledger = ledgerOf(ctx);
  const notify = vi.fn();
  const core = new ForumCore({ ctx, ledger, notifier: { notify }, audit: createAuditLogger(ctx) } as unknown as ForumDeps);
  return { ctx, ledger, core, notify, delivered: () => notify.mock.calls.map((c) => c[0] as string) };
}

describe("ForumCore.tx: savepoint'e göre kapsamlı yan etki kuyruğu", () => {
  it("iç işlem geri alınır ve dış işlem yine commit olursa: iç bildirim ve defter kaydı atılır, dışınki iletilir (enact() deseni)", () => {
    const { core, ledger, delivered } = setup();
    const fake = ledger as FakeLedger;
    core.tx(() => {
      core.notify(["dis"], note("dış"));
      core.submit("MESSAGE_HIDDEN", hidden("m-dis"));
      try {
        core.tx(() => {
          core.notify(["ic"], note("iç"));
          core.submit("MESSAGE_HIDDEN", hidden("m-ic"));
          throw new Error("etki uygulanamadı");
        });
      } catch {
        /* enact().effect gibi: iç hata yakalanır, dış işlem sürer */
      }
    });
    expect(delivered()).toEqual(["dis"]);
    expect(fake.txs.map((t) => t.payload.messageId)).toEqual(["m-dis"]);
  });

  it("başarılı iç işlemin yan etkileri üst düzeyin kuyruğuna katılır; dış işlem geri alınırsa HEPSİ atılır", () => {
    const { core, ledger, delivered } = setup();
    const fake = ledger as FakeLedger;
    core.tx(() => {
      core.tx(() => {
        core.notify(["ic"], note("iç"));
        core.submit("MESSAGE_HIDDEN", hidden("m-ic"));
      });
      core.notify(["dis"], note("dış"));
    });
    expect(delivered().sort()).toEqual(["dis", "ic"]);
    expect(fake.txs).toHaveLength(1);

    const rolledBack = setup();
    expect(() =>
      rolledBack.core.tx(() => {
        rolledBack.core.tx(() => {
          rolledBack.core.notify(["ic"], note("iç"));
          rolledBack.core.submit("MESSAGE_HIDDEN", hidden("m-ic"));
        });
        throw new Error("dış hata");
      }),
    ).toThrow("dış hata");
    expect(rolledBack.delivered()).toEqual([]);
    expect((rolledBack.ledger as FakeLedger).txs).toHaveLength(0);
  });

  it("üç düzey: ortadaki geri alınırken yalnızca kendi ve altındaki işler atılır", () => {
    const { core, delivered } = setup();
    core.tx(() => {
      core.notify(["a"], note("a"));
      try {
        core.tx(() => {
          core.notify(["b"], note("b"));
          core.tx(() => core.notify(["c"], note("c")));
          throw new Error("orta düzey");
        });
      } catch {
        /* yakalandı */
      }
      core.notify(["d"], note("d"));
    });
    expect(delivered()).toEqual(["a", "d"]);
  });
});

describe("ForumCore.submit: geri alınan DB işlemi deftere hayalet kayıt bırakmaz", () => {
  it("işlem içinde gönderip sonra hata: defterde kayıt yok; commit olan işlemde önceden dönen özetle kayıt var", () => {
    const { core, ledger } = setup();
    const fake = ledger as FakeLedger;
    let hash = "";
    expect(() =>
      core.tx(() => {
        hash = core.submit("MESSAGE_HIDDEN", hidden("m-1"));
        expect(fake.txs).toHaveLength(0); // COMMIT'e kadar deftere gitmez
        throw new Error("geri al");
      }),
    ).toThrow("geri al");
    expect(fake.txs).toHaveLength(0);
    expect(fake.getTx(hash)).toBeNull();

    const committed = core.tx(() => core.submit("MESSAGE_HIDDEN", hidden("m-2")));
    expect(fake.txs).toHaveLength(1);
    expect(fake.getTx(committed)).not.toBeNull();
    expect(committed).toBe(prepareTx("MESSAGE_HIDDEN", hidden("m-2")).hash); // özet önceden hesaplanabilir/deterministik
  });

  it("işlem dışında hemen gönderilir; doğrulama hatası (kişisel veri) işlem içinde de ANINDA fırlar ve işlemi geri alır", () => {
    const { core, ledger } = setup();
    const fake = ledger as FakeLedger;
    core.submit("MESSAGE_HIDDEN", hidden("m-3"));
    expect(fake.txs).toHaveLength(1);
    expect(() => core.tx(() => core.submit("MESSAGE_HIDDEN", { ...hidden("m-4"), email: "a@b.c" }))).toThrow(/kişisel veri/);
    expect(fake.txs).toHaveLength(1);
  });

  it("gerçek defter: geri alınan işlem havuza/deftere girmez; commit olan girer ve özet eşleşir", async () => {
    const { ledger, core } = setup((c) => createLedgerService(c, { persist: false, blockIntervalMs: 5 }));
    await ledger.start();
    try {
      let ghost = "";
      expect(() =>
        core.tx(() => {
          ghost = core.submit("MESSAGE_HIDDEN", hidden("m-hayalet"));
          throw new Error("geri al");
        }),
      ).toThrow("geri al");
      const real = core.tx(() => core.submit("MESSAGE_HIDDEN", hidden("m-gercek")));
      await ledger.flush(20_000);
      expect(ledger.getTx(ghost)).toBeNull();
      expect(ledger.findTxs({ type: "MESSAGE_HIDDEN" }).map((t) => t.payload.messageId)).toEqual(["m-gercek"]);
      expect(ledger.getTx(real)?.hash).toBe(real);
    } finally {
      await ledger.stop();
    }
  }, 60_000);

  it("COMMIT sonrası gönderim başarısız olursa işlem geri alınmaz; hata denetim günlüğüne (yüksüz) yazılır", () => {
    const { core, ledger, ctx } = setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(ledger, "submit").mockImplementation(() => {
      throw new Error("defter çöktü");
    });
    const hash = core.tx(() => {
      ctx.db.run("CREATE TABLE IF NOT EXISTS t_probe(x INTEGER)");
      ctx.db.run("INSERT INTO t_probe(x) VALUES (1)");
      return core.submit("MESSAGE_HIDDEN", hidden("m-5"));
    });
    expect(ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM t_probe")!.c).toBe(1);
    const row = ctx.db.get<{ meta: string }>("SELECT meta FROM audit_log WHERE action = 'system.ledger_submit_failed'");
    expect(row).toBeTruthy();
    const meta = JSON.parse(row!.meta) as Record<string, unknown>;
    expect(meta).toMatchObject({ type: "MESSAGE_HIDDEN", txHash: hash });
    expect(JSON.stringify(meta)).not.toContain("m-5");
  });
});
