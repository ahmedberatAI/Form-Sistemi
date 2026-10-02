// Regresyon (#220): herkese açık bilirkişi paneli özel yakınlık/hane gerekçelerini ifşa etmez; personel ayrıntıyı görür.
// (#221): bilirkişi–yazar arasında yalnız doğrudan beyan kesin dışlama; üçüncü kişi zinciri yumuşak çatışmadır.
import { describe, expect, it } from "vitest";
import { CAT, makeWorld } from "./fixtures";

async function drawn() {
  const w = makeWorld();
  w.expert("author", [CAT.toplu]);
  w.expert("e-aile", [CAT.toplu]);
  w.expert("e-hane", [CAT.toplu]);
  w.expert("e-zincir", [CAT.toplu]);
  w.expert("e-ok", [CAT.toplu]);
  w.user("x-kuzen");
  w.graph.relate("e-aile", "author");
  w.graph.relate("e-zincir", "x-kuzen");
  w.graph.relate("x-kuzen", "author");
  w.households.set("e-hane", "hane-7");
  w.households.set("author", "hane-7");
  w.proposal("p-1", "author", [CAT.toplu]);
  await w.draw("p-1", "author", [CAT.toplu], { k: 3 });
  return w;
}

const reasonOf = (panel: { candidates: { userId: string; excludedReason?: string }[] } | null, id: string) =>
  panel!.candidates.find((c) => c.userId === id)?.excludedReason;

describe("bilirkişi paneli gizliliği (#220)", () => {
  it("anonim ve sıradan üyeler çatışma ayrıntısını (yakınlık, zincir, hane) görmez", async () => {
    const w = await drawn();
    for (const viewer of [undefined, null, { id: "u", roles: ["member"] as const }]) {
      const panel = w.svc.panel("p-1", viewer as never);
      expect(reasonOf(panel, "e-aile")).toBe("Çıkar çatışması nedeniyle dışlandı");
      expect(reasonOf(panel, "e-hane")).toBe("Çıkar çatışması nedeniyle dışlandı");
      expect(reasonOf(panel, "author")).toBe("Önerinin yazarı");
      const reasons = panel!.candidates.map((c) => c.excludedReason ?? "").join(" | ");
      for (const secret of ["hane", "aile", "zincir", "adımlık", "yakınlık"]) expect(reasons, secret).not.toContain(secret);
    }
  });

  it("yönetici, kayıt memuru ve denetçi ayrıntıyı görür", async () => {
    const w = await drawn();
    for (const role of ["admin", "registrar", "auditor"] as const) {
      const panel = w.svc.panel("p-1", { id: "staff", roles: [role] });
      expect(reasonOf(panel, "e-aile")).toMatch(/kesin çıkar çatışması.*1 adım/);
      expect(reasonOf(panel, "e-hane")).toMatch(/aynı hane/);
    }
  });
});

describe("üçüncü kişi beyanları kesin dışlama üretmez (#221)", () => {
  it("doğrudan beyan dışlanır; 2 adımlık zincir dışlanmaz, yalnız ağırlığı düşer", async () => {
    const w = await drawn();
    const panel = w.svc.panel("p-1", { id: "staff", roles: ["admin"] })!;
    const byId = Object.fromEntries(panel.candidates.map((c) => [c.userId, c]));
    expect(byId["e-aile"].weight).toBe(0);
    expect(byId["e-zincir"].excludedReason).toBeUndefined();
    expect(byId["e-zincir"].softConflict).toBe(0.5);
    expect(byId["e-zincir"].weight).toBeGreaterThan(0);
    expect(byId["e-zincir"].weight).toBeLessThan(byId["e-ok"].weight);
  });
});
