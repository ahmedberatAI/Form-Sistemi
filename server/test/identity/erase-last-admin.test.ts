// eraseSelf, setRoles ile aynı son-yönetici değişmezini uygular: tek yönetici kendini silerse sistemde yönetici kalmazdı.
import { describe, expect, it } from "vitest";
import { insertUser } from "../helpers/fakes";
import { expectAppError, setup } from "./fixtures";

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
