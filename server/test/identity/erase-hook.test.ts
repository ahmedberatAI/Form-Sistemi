// İmha sonrası kanca (IdentityDeps.onErased): hesap silme, kayıt memuru reddi ve bayat başvuru imhası — üçü de işlem TAMAMLANDIKTAN
// sonra kancayı çağırır (süreç belleğindeki kopyalar, ör. kişisel sıralamanın sinyal önbelleği, hemen düşürülür). İşlem geri
// alınırsa çağrılmaz; kancanın hatası imhayı bozmaz.
import { describe, expect, it, vi } from "vitest";
import { STALE_PENDING_MS } from "../../src/identity";
import { regInput, setup } from "./fixtures";

describe("onErased kancası", () => {
  it("hesap silme: işlem bitince bir kez; çağıranın işlemi geri alınırsa hiç", async () => {
    const onErased = vi.fn();
    const { ctx, identity, memberId } = setup({ onErased });
    let pending: Promise<void> | undefined;
    expect(() =>
      ctx.db.tx(() => {
        pending = identity.eraseSelf(memberId);
        throw new Error("geri al");
      }),
    ).toThrow("geri al");
    await pending;
    expect(onErased).not.toHaveBeenCalled();

    const p = identity.eraseSelf(memberId);
    expect(onErased, "işlem sürerken değil, tamamlanınca").not.toHaveBeenCalled();
    await p;
    expect(onErased).toHaveBeenCalledTimes(1);
    expect(onErased).toHaveBeenCalledWith(memberId);
  });

  it("kayıt memuru reddi: başvuru imha edilince çağrılır; onayda çağrılmaz", async () => {
    const onErased = vi.fn();
    const { identity, registrarId } = setup({ onErased });
    const ok = (await identity.register(regInput())).user;
    await identity.verify(registrarId, ok.id, "approve");
    expect(onErased).not.toHaveBeenCalled();
    const bad = (await identity.register(regInput())).user;
    await identity.verify(registrarId, bad.id, "reject");
    expect(onErased).toHaveBeenCalledTimes(1);
    expect(onErased).toHaveBeenCalledWith(bad.id);
  });

  it("bayat başvuru imhası: imha edilen her başvuru için çağrılır", async () => {
    const onErased = vi.fn();
    let real = Date.UTC(2026, 0, 1);
    const { identity } = setup({ onErased, realNow: () => real });
    const a = (await identity.register(regInput())).user;
    const b = (await identity.register(regInput())).user;
    expect(identity.purgeStalePending()).toBe(0); // ilk görüş: süre başlar
    real += STALE_PENDING_MS + 1;
    expect(identity.purgeStalePending()).toBe(2);
    expect(onErased.mock.calls.map((c) => c[0]).sort()).toEqual([a.id, b.id].sort());
  });

  it("kancanın hatası imhayı bozmaz", async () => {
    const { ctx, identity, memberId } = setup({
      onErased: () => {
        throw new Error("önbellek");
      },
    });
    await expect(identity.eraseSelf(memberId)).resolves.toBeUndefined();
    expect(ctx.db.get<{ status: string }>("SELECT status FROM users WHERE id = ?", memberId)?.status).toBe("erased");
  });
});
