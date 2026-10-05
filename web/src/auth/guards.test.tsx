// Rol korumaları, yeni hata başlıkları ve rol onay kutuları (Yönetim > Roller).
// Görev rolleri (kayıt memuru, denetçi, yönetici) yalnız DOĞRULANMIŞ hesapta geçerlidir (AuthContext.derivePermissions). Bekleyen bir
// hesapta rol verilmişse sayfa 'yalnızca şu rollere açıktır' demez, asıl nedeni (hesabın doğrulanmamış olduğunu) söyler.
// Sunucu tarafı çizimle denetlenir (DOM gerekmez).
import type { AdminUserRow, Me, Role, UserStatus } from "@forum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { roleCheckbox } from "../components/system/AdminPanels";
import { ErrorView } from "../ui/ErrorView";

const state = vi.hoisted(() => ({ user: null as unknown, perms: null as unknown }));

vi.mock("./AuthContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./AuthContext")>()),
  useAuth: () => ({ user: state.user, loading: false, token: "t", connectionError: null, refresh: async () => null, ...(state.perms as object) }),
}));

import { RequireRole } from "./guards";
import { derivePermissions } from "./AuthContext";

function me(status: UserStatus, roles: Role[]): Me {
  return { id: "u1", nickname: "ayse", status, roles, isExpert: false, expertDomains: [], reputation: 0, joinedAt: 0, isAdult: true, aiConsent: false, politicalConsent: true };
}

function render(user: Me, roles: Role[]): string {
  state.user = user;
  state.perms = derivePermissions(user);
  return renderToStaticMarkup(
    <MemoryRouter>
      <RequireRole roles={roles}>
        <p>KORUNAN-SAYFA</p>
      </RequireRole>
    </MemoryRouter>,
  );
}

describe("RequireRole: rol var ama hesap doğrulanmamış", () => {
  it("doğrulanmış kayıt memuru sayfayı görür", () => {
    expect(render(me("verified", ["member", "registrar"]), ["registrar", "auditor"])).toContain("KORUNAN-SAYFA");
  });

  it("bekleyen hesapta rol verilmişse asıl neden söylenir (kayıt memuru onayı bekleniyor)", () => {
    const html = render(me("pending", ["member", "registrar"]), ["registrar", "auditor"]);
    expect(html).not.toContain("KORUNAN-SAYFA");
    expect(html).toContain("Görev rolünüz henüz etkin değil");
    expect(html).toContain("kayıt memuru onayını bekliyor");
    expect(html).not.toContain("yalnızca şu rollere açıktır");
  });

  it("askıdaki hesapta durum etiketi yazılır", () => {
    const html = render(me("suspended", ["member", "admin"]), ["admin", "auditor"]);
    expect(html).toContain("Görev rolünüz henüz etkin değil");
    expect(html).toContain("Hesabınızın durumu:");
  });

  it("rolü hiç olmayan üyeye rol listesi gösterilir (doğrulanmış ya da değil)", () => {
    for (const status of ["verified", "pending"] as const) {
      const html = render(me(status, ["member"]), ["registrar", "auditor"]);
      expect(html).not.toContain("KORUNAN-SAYFA");
      expect(html).toContain("yalnızca şu rollere açıktır: kayıt memuru, denetçi");
      expect(html).not.toContain("Görev rolünüz henüz etkin değil");
    }
  });
});

describe("ErrorView: yeni hata kodlarının başlıkları", () => {
  const view = (code: string, status: number) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <ErrorView error={new ApiError(status, code, "Sunucu iletisi.")} compact />
      </MemoryRouter>,
    );

  it("login_locked ve not_verified okunur başlık alır; ileti sunucudan gelir", () => {
    const locked = view("login_locked", 429);
    expect(locked).toContain("Giriş geçici olarak durduruldu");
    expect(locked).toContain("Sunucu iletisi.");
    expect(view("not_verified", 409)).toContain("Kimlik doğrulaması gerekiyor");
    expect(view("idempotency_in_progress", 409)).toContain("İşlem sürüyor");
  });

  it("bilinmeyen kod genel başlıkta kalır", () => {
    expect(view("baska_bir_kod", 400)).toContain("İşlem başarısız");
  });
});

describe("roleCheckbox: Yönetim > Roller onay kutuları", () => {
  const row = (status: UserStatus, roles: Role[]): Pick<AdminUserRow, "status" | "roles"> => ({ status, roles });

  it("'Üye' her zaman işaretli ve kapalıdır", () => {
    expect(roleCheckbox(row("verified", ["member"]), "member", false)).toEqual({ checked: true, disabled: true });
    expect(roleCheckbox(row("pending", []), "member", false)).toEqual({ checked: true, disabled: true });
  });

  it("doğrulanmış üyeye görev rolü verilebilir; verilmiş rol kaldırılabilir", () => {
    expect(roleCheckbox(row("verified", ["member"]), "auditor", false)).toEqual({ checked: false, disabled: false });
    expect(roleCheckbox(row("verified", ["member", "auditor"]), "auditor", false)).toEqual({ checked: true, disabled: false });
  });

  it.each<UserStatus>(["pending", "suspended"])("%s üyeye görev rolü VERİLEMEZ (neden yazılır) ama verilmiş rol kaldırılabilir", (status) => {
    for (const role of ["registrar", "auditor", "admin"] as const) {
      const off = roleCheckbox(row(status, ["member"]), role, false);
      expect(off.disabled).toBe(true);
      expect(off.checked).toBe(false);
      expect(off.reason).toMatch(/yalnızca kimliği doğrulanmış/);
      const held = roleCheckbox(row(status, ["member", role]), role, false);
      expect(held).toEqual({ checked: true, disabled: false });
    }
  });

  it("silinmiş ve reddedilmiş hesapta hiçbir rol değişmez; işlem sürerken kutu kapalıdır", () => {
    for (const status of ["erased", "rejected"] as const) expect(roleCheckbox(row(status, ["member", "auditor"]), "auditor", false).disabled).toBe(true);
    expect(roleCheckbox(row("verified", ["member"]), "registrar", true).disabled).toBe(true);
  });
});
