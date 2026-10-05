// eraseSelf, setRoles ile aynı son-yönetici değişmezini uygular: tek yönetici kendini silerse sistemde yönetici kalmazdı.
import { describe, expect, it } from "vitest";
import { assertErasable } from "../../src/identity";
import { insertUser } from "../helpers/fakes";
import { expectAppError, setup } from "./fixtures";

describe("assertErasable: silme ön koşulları yan etkisiz denetlenir (#14/#280)", () => {
  it("son yönetici → 409 last_admin; kapalı hesap → 409 already_erased; hiçbir satır değişmez", async () => {
    const { identity, ctx, adminId, memberId } = setup();
    const snapshot = () => JSON.stringify(ctx.db.all("SELECT * FROM users ORDER BY id")) + JSON.stringify(ctx.db.all("SELECT * FROM audit_log"));
    const before = snapshot();
    const e = await expectAppError(() => assertErasable(ctx.db, adminId), 409, "last_admin");
    expect(e.message).toMatch(/son yönetici/i);
    expect(() => assertErasable(ctx.db, memberId)).not.toThrow();
    expect(() => assertErasable(ctx.db, "olmayan-uye")).not.toThrow(); // satır yoksa eraseSelf 404 verir
    expect(snapshot()).toBe(before);
    await identity.eraseSelf(memberId);
    await expectAppError(() => assertErasable(ctx.db, memberId), 409, "already_erased");
  });

  it("eraseSelf ön koşul hatasını EŞZAMANLI fırlatır (çağıranın işlemi geri alınabilsin)", () => {
    const { identity, adminId } = setup();
    expect(() => identity.eraseSelf(adminId)).toThrow(/son yönetici/i);
  });
});

describe("kimlik: son yönetici kendini silemez", () => {
  it("tek yönetici eraseSelf → 409 last_admin; hesap ve rol olduğu gibi kalır", async () => {
    const { identity, ctx, adminId } = setup();
    const e = await expectAppError(() => identity.eraseSelf(adminId), 409, "last_admin");
    expect(e.message).toMatch(/son yönetici/i);
    const row = ctx.db.get<{ status: string; roles: string }>("SELECT status, roles FROM users WHERE id = ?", adminId);
    expect(row?.status).toBe("verified");
    expect(JSON.parse(row!.roles)).toContain("admin");
  });

  it("başka doğrulanmış yönetici varsa silebilir; sıradan üye zaten silebilir", async () => {
    const { identity, ctx, adminId, memberId } = setup();
    await identity.eraseSelf(memberId);
    insertUser(ctx.db, { nickname: "ikinci-yonetici", roles: ["member", "admin"] });
    await identity.eraseSelf(adminId);
    const row = ctx.db.get<{ status: string; roles: string }>("SELECT status, roles FROM users WHERE id = ?", adminId);
    expect(row?.status).toBe("erased");
    expect(JSON.parse(row!.roles)).toEqual(["member"]);
  });
});
