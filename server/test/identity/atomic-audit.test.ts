// #280: durum değişikliği ve denetim kaydı TEK işlemde (biri yazılamazsa öteki de geri alınır); bildirim ve defter işlem sonrası.
// #106: doğrulanmamış hesaba personel rolü verilemez. #273 notu: kimlikteki defter gönderim hataları güvenli biçimde kaydedilir.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LedgerTxType } from "@forum/shared";
import { createAuditLogger, type AuditLogger } from "../../src/core/audit";
import { AppError } from "../../src/core/errors";
import { MemoryNotifier } from "../../src/core/notifier";
import { createIdentityService } from "../../src/identity";
import { FakeLedger, insertUser, makeCtx } from "../helpers/fakes";
import { expectAppError, regInput, setup } from "./fixtures";

/** Verilen denetim eylemi yazılırken hata veren denetim günlüğü (ör. disk dolu). */
function failingSetup(failOn: string, ledger?: FakeLedger) {
  const ctx = makeCtx();
  const real = createAuditLogger(ctx);
  const audit: AuditLogger = {
    log(actor, action, target, meta) {
      if (action === failOn) throw new Error("denetim günlüğü yazılamadı");
      real.log(actor, action, target, meta);
    },
  };
  const notifier = new MemoryNotifier();
  const led = ledger ?? new FakeLedger(ctx.clock);
  const identity = createIdentityService(ctx, { ledger: led, notifier, audit });
  const registrarId = insertUser(ctx.db, { nickname: "memur", roles: ["member", "registrar"] });
  const adminId = insertUser(ctx.db, { nickname: "yonetici", roles: ["member", "admin"] });
  const memberId = insertUser(ctx.db, { nickname: "siradan" });
  return { ctx, identity, notifier, ledger: led, registrarId, adminId, memberId };
}

const userRow = (ctx: ReturnType<typeof makeCtx>, id: string) =>
  ctx.db.get<{ status: string; roles: string; political_consent: number; ai_consent: number }>(
    "SELECT status, roles, political_consent, ai_consent FROM users WHERE id = ?",
    id,
  )!;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("durum değişikliği + denetim kaydı tek işlemde (#280)", () => {
  it("setRoles: denetim kaydı yazılamazsa rol değişmez, bildirim gitmez", () => {
    const { ctx, identity, notifier, adminId, memberId } = failingSetup("identity.roles");
    expect(() => identity.setRoles(adminId, memberId, ["auditor"])).toThrow(/denetim/);
    expect(JSON.parse(userRow(ctx, memberId).roles)).toEqual(["member"]);
    expect(notifier.sent).toEqual([]);
  });

  it("setConsents: denetim kaydı (rızanın ispatı) yazılamazsa rıza değişmez", () => {
    const { ctx, identity, memberId } = failingSetup("identity.consents");
    expect(() => identity.setConsents(memberId, { aiConsent: true, politicalConsent: false })).toThrow(/denetim/);
    expect(userRow(ctx, memberId)).toMatchObject({ ai_consent: 0, political_consent: 1 });
  });

  it("verify onay/ret: denetim kaydı yazılamazsa başvuru beklemede kalır; defter ve bildirim yok; kasa sağlam", async () => {
    for (const decision of ["approve", "reject"] as const) {
      const { ctx, identity, notifier, ledger, registrarId } = failingSetup("identity.verify");
      const { user } = await identity.register(regInput());
      const before = ledger.txs.length;
      await expect(identity.verify(registrarId, user.id, decision)).rejects.toThrow(/denetim/);
      expect(userRow(ctx, user.id).status).toBe("pending");
      expect(ledger.txs.length).toBe(before);
      expect(notifier.sent.filter((n) => n.userId === user.id)).toEqual([]);
      expect(identity.getPii(registrarId, user.id, "Kasa bütünlüğü kontrolü").firstName).toBe("Ayşe");
      expect(ctx.db.get("SELECT 1 FROM meta WHERE key = ?", `identity.pending_since:${user.id}`)).toBeTruthy();
    }
  });

  it("getPii: erişim denetim kaydı yazılamazsa pii_access_log satırı da kalmaz ve veri dönmez", async () => {
    const { ctx, identity, registrarId } = failingSetup("identity.pii_access");
    const { user } = await identity.register(regInput());
    expect(() => identity.getPii(registrarId, user.id, "Kimlik doğrulama")).toThrow(/denetim/);
    expect(ctx.db.all("SELECT 1 FROM pii_access_log")).toEqual([]);
  });

  it("eraseSelf: denetim kaydı yazılamazsa hesap silinmez (eşzamanlı hata), defter kaydı yok", async () => {
    const { ctx, identity, ledger, registrarId } = failingSetup("identity.erase");
    const { user } = await identity.register(regInput());
    const before = ledger.txs.length;
    expect(() => identity.eraseSelf(user.id)).toThrow(/denetim/);
    expect(userRow(ctx, user.id).status).toBe("pending");
    expect(identity.getPii(registrarId, user.id, "Silme sonrası kontrol").lastName).toBe("Yılmaz");
    expect(ledger.txs.length).toBe(before);
  });
});

describe("doğrulanmamış hesaba personel rolü verilemez (#106)", () => {
  it("bekleyen hesap: kayıt memuru/denetçi/yönetici → 409 not_verified (Türkçe); rol değişmez", async () => {
    const { identity, adminId, ctx } = setup();
    const { user } = await identity.register(regInput());
    for (const role of ["registrar", "auditor", "admin"] as const) {
      const e = await expectAppError(() => identity.setRoles(adminId, user.id, [role]), 409, "not_verified");
      expect(e.message).toMatch(/yalnızca kimliği doğrulanmış/);
      expect(e.message).toMatch(/Doğrulama bekliyor/);
      expect(e.details).toHaveProperty("roles");
    }
    const two = await expectAppError(() => identity.setRoles(adminId, user.id, ["registrar", "auditor"]), 409, "not_verified");
    expect(two.message).toMatch(/Kayıt Memuru, Denetçi rolleri/);
    expect(JSON.parse(userRow(ctx, user.id).roles)).toEqual(["member"]);
    // Rol vermeyen istek (yalnız üye) sorunsuz; onaydan sonra rol verilebilir.
    expect(identity.setRoles(adminId, user.id, []).roles).toEqual(["member"]);
  });

  it("askıdaki hesap: yeni personel rolü verilemez, var olan rol geri alınabilir; doğrulanınca verilebilir", async () => {
    const { identity, adminId, registrarId, ctx } = setup();
    const suspended = insertUser(ctx.db, { nickname: "askida", status: "suspended", roles: ["member", "auditor"] });
    await expectAppError(() => identity.setRoles(adminId, suspended, ["auditor", "registrar"]), 409, "not_verified");
    expect(identity.setRoles(adminId, suspended, []).roles).toEqual(["member"]);

    const { user } = await identity.register(regInput());
    await identity.verify(registrarId, user.id, "approve");
    expect(identity.setRoles(adminId, user.id, ["registrar"]).roles).toEqual(["member", "registrar"]);
  });
});

/** submit'i her çağrıda hata veren defter (ör. kapanış sırasında durdurulmuş). */
class StoppedLedger extends FakeLedger {
  override submit(_type: LedgerTxType, _payload: Record<string, unknown>): { txHash: string } {
    throw new AppError(503, "ledger_stopped", "Defter durduruldu; işlem kabul edilmiyor. memberRef=gizli-ayrinti");
  }
}

describe("defter gönderim hatası güvenli biçimde kaydedilir (#273)", () => {
  it("işlem bozulmaz; denetimde yalnız tür + hata kodu (ileti, memberRef, üye kimliği yok); sunucu günlüğüne de yazılır", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    const ctx = makeCtx();
    const identity = createIdentityService(ctx, { ledger: new StoppedLedger(ctx.clock), notifier: new MemoryNotifier(), audit: createAuditLogger(ctx) });
    const { user } = await identity.register(regInput());
    expect(userRow(ctx, user.id).status).toBe("pending");
    const rows = ctx.db.all<{ target: string | null; meta: string }>("SELECT target, meta FROM audit_log WHERE action = 'identity.ledger_error'");
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toBeNull();
    expect(JSON.parse(rows[0].meta)).toEqual({ type: "MEMBER_REGISTERED", code: "ledger_stopped" });
    const memberRef = identity.memberRef(user.id);
    for (const text of [rows[0].meta, ...errors]) {
      expect(text).not.toContain(memberRef);
      expect(text).not.toContain(user.id);
      expect(text).not.toContain("gizli-ayrinti");
    }
    expect(errors.some((m) => m.includes("MEMBER_REGISTERED") && m.includes("ledger_stopped"))).toBe(true);
  });

  it("denetim günlüğü de yazılamazsa hata yayılmaz (asıl işlem zaten kaydedildi)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { ctx, identity } = failingSetup("identity.ledger_error", new StoppedLedger());
    const { user } = await identity.register(regInput());
    expect(userRow(ctx, user.id).status).toBe("pending");
  });
});
