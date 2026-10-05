// Yetki türetme (AuthContext.derivePermissions): görev rolleri (kayıt memuru, denetçi, yönetici) ve bilirkişilik yalnızca DOĞRULANMIŞ
// hesapta geçerlidir; sunucudaki requireRole / requireExpert ile aynı sonucu verir. Menü (nav.ts) bu yetkilere bağlıdır.
// Eski davranış: yönetici henüz onaylanmamış (pending) bir üyeye rol verince menüde görev bölümleri görünüyor, sayfalar 403 veriyordu.
import type { Me, Role, UserStatus } from "@forum/shared";
import { describe, expect, it } from "vitest";
import { derivePermissions, type AuthContextValue } from "./AuthContext";
import { canOpenAdmin, canOpenRegistrar, visibleItems } from "../components/layout/nav";

function me(over: Partial<Me> & { status: UserStatus; roles: Role[] }): Me {
  return {
    id: "u1",
    nickname: "ayse",
    isExpert: false,
    expertDomains: [],
    reputation: 0,
    joinedAt: 0,
    isAdult: true,
    aiConsent: false,
    politicalConsent: true,
    ...over,
  };
}

/** nav.visibleItems'ın beklediği bağlam: yalnız yetki alanları ve kullanıcı gerekir. */
const ctx = (user: Me | null) => ({ ...derivePermissions(user), user }) as unknown as AuthContextValue;
const paths = (user: Me | null) => visibleItems(ctx(user)).map((i) => i.to);

describe("derivePermissions: görev rolleri doğrulanmış hesaba bağlıdır", () => {
  it("oturum yoksa hiçbir yetki yok", () => {
    const p = derivePermissions(null);
    for (const k of ["U", "V", "VV", "R", "D", "A", "E"] as const) expect(p.can(k)).toBe(false);
    expect(p.hasRole("member")).toBe(false);
    expect(p.isAdmin).toBe(false);
  });

  it("doğrulanmış kayıt memuru: R var; D ve A yok", () => {
    const p = derivePermissions(me({ status: "verified", roles: ["member", "registrar"] }));
    expect([p.can("R"), p.can("D"), p.can("A")]).toEqual([true, false, false]);
    expect(p.hasRole("registrar")).toBe(true);
    expect(p.isAdmin).toBe(false);
  });

  it("doğrulanmış denetçi: D var; R ve A yok", () => {
    const p = derivePermissions(me({ status: "verified", roles: ["member", "auditor"] }));
    expect([p.can("R"), p.can("D"), p.can("A")]).toEqual([false, true, false]);
  });

  it("doğrulanmış yönetici R, D ve A yetkilerini kapsar", () => {
    const p = derivePermissions(me({ status: "verified", roles: ["member", "admin"] }));
    expect([p.can("R"), p.can("D"), p.can("A")]).toEqual([true, true, true]);
    expect(p.isAdmin).toBe(true);
  });

  it.each<UserStatus>(["pending", "suspended", "rejected", "erased"])("%s hesapta rol verilmiş olsa bile R, D, A yok; hasRole ve isAdmin da yok", (status) => {
    const p = derivePermissions(me({ status, roles: ["member", "registrar", "auditor", "admin"] }));
    expect([p.can("R"), p.can("D"), p.can("A")]).toEqual([false, false, false]);
    expect(p.isAdmin).toBe(false);
    expect(p.hasRole("registrar")).toBe(false);
    expect(p.hasRole("auditor")).toBe(false);
    expect(p.hasRole("admin")).toBe(false);
    // Oturum açmışlık ve 'üye' rolü hesap durumundan etkilenmez; V (doğrulanmış) yoktur.
    expect(p.can("U")).toBe(true);
    expect(p.can("V")).toBe(false);
    expect(p.hasRole("member")).toBe(true);
  });

  it("oy verme (VV) kuralı değişmedi: doğrulanmış + reşit + siyasi görüş rızası", () => {
    expect(derivePermissions(me({ status: "verified", roles: ["member"] })).can("VV")).toBe(true);
    expect(derivePermissions(me({ status: "verified", roles: ["member"], isAdult: false })).can("VV")).toBe(false);
    expect(derivePermissions(me({ status: "verified", roles: ["member"], politicalConsent: false })).can("VV")).toBe(false);
    expect(derivePermissions(me({ status: "pending", roles: ["member"] })).can("VV")).toBe(false);
  });

  it("bilirkişilik (E) de doğrulanmış hesaba bağlıdır", () => {
    expect(derivePermissions(me({ status: "verified", roles: ["member"], isExpert: true })).can("E")).toBe(true);
    expect(derivePermissions(me({ status: "pending", roles: ["member"], isExpert: true })).can("E")).toBe(false);
    expect(derivePermissions(me({ status: "verified", roles: ["member"] })).isExpert).toBe(false);
  });
});

describe("menü: görev bölümleri yalnızca yetkisi çalışan hesapta görünür", () => {
  const registrar = "/kayit-memuru";
  const admin = "/yonetim";

  it("bekleyen (doğrulanmamış) hesapta, rolleri olsa da, Kayıt memuru ve Yönetim menüde yoktur", () => {
    const u = me({ status: "pending", roles: ["member", "registrar", "auditor", "admin"] });
    expect(canOpenRegistrar(ctx(u))).toBe(false);
    expect(canOpenAdmin(ctx(u))).toBe(false);
    const p = paths(u);
    expect(p).not.toContain(registrar);
    expect(p).not.toContain(admin);
    expect(p).toContain("/profil"); // hesap öğeleri kalır
  });

  it("doğrulanmış kayıt memuru yalnız Kayıt memuru'nu görür", () => {
    const p = paths(me({ status: "verified", roles: ["member", "registrar"] }));
    expect(p).toContain(registrar);
    expect(p).not.toContain(admin);
  });

  it("doğrulanmış denetçi her ikisini görür (Yönetim'de yalnız denetim günlüğü)", () => {
    const p = paths(me({ status: "verified", roles: ["member", "auditor"] }));
    expect(p).toContain(registrar);
    expect(p).toContain(admin);
  });

  it("doğrulanmış yönetici her ikisini görür; sıradan üye hiçbirini görmez", () => {
    const a = paths(me({ status: "verified", roles: ["member", "admin"] }));
    expect(a).toContain(registrar);
    expect(a).toContain(admin);
    const m = paths(me({ status: "verified", roles: ["member"] }));
    expect(m).not.toContain(registrar);
    expect(m).not.toContain(admin);
  });
});
