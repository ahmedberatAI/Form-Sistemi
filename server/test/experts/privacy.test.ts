// Bilirkişi çıktısının görüntüleyene göre biçimlenmesi (DEVAM §4.4 e) ve panel şeffaflığı (§4.4 f):
// - Yeterlilik beyanı (credentials) serbest metindir ve kimliği belirleyebilir → yalnız yönetici, kayıt memuru, denetçi ve
//   bilirkişinin kendisi görür; herkese açık listede null + kimlik belirlemeyen `qualificationSummary`.
// - Panel bilgisi çekinme gerekçelerini ve tüm EXPERT_DRAW defter kayıtlarını (ilk kura + yedek kuralar) listeler.
import { describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { canSeeCredentials } from "../../src/experts";
import { fakeUser, stubServer, stubServices } from "../http/stubs";
import { CAT, LONG_BODY, makeWorld } from "./fixtures";

const CRED = "Ankara Büyükşehir Belediyesi Ulaşım Dairesi'nde 12 yıl planlama mühendisi (sicil 4711)";

function world() {
  const w = makeWorld();
  w.user("e-1", "uzman");
  w.svc.apply("e-1", [CAT.toplu, CAT.bisiklet], CRED);
  w.svc.decideApplication(w.admin, "e-1", "approve");
  w.user("u-uye", "uye");
  return w;
}

describe("bilirkişi yeterlilik beyanı: görüntüleyene göre biçimleme", () => {
  it("herkese açık liste/get: beyan null, kimlik belirlemeyen özet var", () => {
    const w = world();
    for (const info of [w.svc.list()[0], w.svc.list({ status: "active" }, null)[0], w.svc.get("e-1")!, w.svc.get("e-1", { id: "u-uye", roles: ["member"] })!]) {
      expect(info.credentials).toBeNull();
      expect(info.qualificationSummary).toBe("Yönetici onaylı bilirkişi · uzmanlık: TopluTasima, BisikletYaya");
      expect(JSON.stringify(info)).not.toContain("sicil");
      expect(JSON.stringify(info)).not.toContain("Ankara");
    }
  });

  it("yönetici, kayıt memuru, denetçi ve bilirkişinin kendisi beyanın tamamını görür", () => {
    const w = world();
    for (const viewer of [
      { id: "x", roles: ["member", "admin"] as const },
      { id: "x", roles: ["member", "registrar"] as const },
      { id: "x", roles: ["member", "auditor"] as const },
      { id: "e-1", roles: ["member"] as const },
    ]) {
      expect(w.svc.list({}, viewer)[0].credentials).toBe(CRED);
      expect(w.svc.get("e-1", viewer)?.credentials).toBe(CRED);
    }
    expect(canSeeCredentials(undefined, "e-1")).toBe(false);
    expect(canSeeCredentials(null, "e-1")).toBe(false);
    expect(canSeeCredentials({ id: "u-uye", roles: ["member"] }, "e-1")).toBe(false);
  });

  it("başvuru yanıtı başvurana, karar/yaptırım yanıtı yöneticiye tam beyanı döndürür", () => {
    const w = makeWorld();
    w.user("e-2");
    expect(w.svc.apply("e-2", [CAT.saglik], CRED).credentials).toBe(CRED);
    expect(w.svc.list({ status: "applied" })[0].qualificationSummary).toBe("Bilirkişilik başvurusu (karar bekliyor) · uzmanlık: Saglik");
    expect(w.svc.decideApplication(w.admin, "e-2", "approve").credentials).toBe(CRED);
    expect(w.svc.sanction(w.admin, "e-2", "warn", "Gecikme").credentials).toBe(CRED);
  });

  it("özet: 3'ten fazla alan kısaltılır, rapor sayısı eklenir", async () => {
    const w = makeWorld();
    w.user("e-3");
    w.svc.apply("e-3", [CAT.toplu, CAT.metro, CAT.bisiklet, CAT.saglik, CAT.halk], "Uzman");
    w.svc.decideApplication(w.admin, "e-3", "approve");
    expect(w.svc.get("e-3")!.qualificationSummary).toBe("Yönetici onaylı bilirkişi · uzmanlık: TopluTasima, Metro, BisikletYaya ve 2 alan daha");
    w.user("author");
    w.proposal("p-r", "author", [CAT.toplu]);
    const panel = await w.draw("p-r", "author", [CAT.toplu], { k: 1 });
    const a = panel.assignments[0];
    await w.svc.respond(a.id, "e-3", "accept");
    await w.svc.submitReport(a.id, "e-3", { assessment: "feasible", confidence: 0.8, risks: [], answers: [], body: LONG_BODY });
    expect(w.svc.get("e-3")!.qualificationSummary).toMatch(/ · 1 rapor$/);
  });
});

describe("GET /api/experts görüntüleyeni servise iletir", () => {
  const apps: FastifyInstance[] = [];
  it("oturumsuz → null; doğrulanmış kullanıcı → {id, roles}; doğrulanmamış → null", async () => {
    const list = vi.fn((_f?: unknown, _v?: unknown) => []);
    const s = stubServices({ experts: { list } });
    const auditor = s.addUser(fakeUser("denetci", { roles: ["member", "auditor"] }));
    const pending = s.addUser(fakeUser("bekleyen", { status: "pending" }));
    const app = await stubServer(s);
    apps.push(app);
    try {
      expect((await app.inject({ method: "GET", url: "/api/experts?status=active" })).statusCode).toBe(200);
      expect(list).toHaveBeenLastCalledWith({ status: "active", domain: undefined }, null);
      await app.inject({ method: "GET", url: "/api/experts", headers: s.auth(auditor) });
      expect(list).toHaveBeenLastCalledWith({ status: undefined, domain: undefined }, { id: auditor.id, roles: ["member", "auditor"] });
      await app.inject({ method: "GET", url: "/api/experts", headers: s.auth(pending) });
      expect(list).toHaveBeenLastCalledWith({ status: undefined, domain: undefined }, null);
    } finally {
      while (apps.length) await apps.pop()!.close();
    }
  });
});

describe("panel şeffaflığı: çekinme gerekçeleri ve kura kayıtları", () => {
  it("çekinme gerekçesi atamada; ilk kura ve yedek kuranın EXPERT_DRAW hash'leri draws içinde (defter sırasıyla)", async () => {
    const w = makeWorld();
    w.user("author");
    for (const id of ["e-1", "e-2", "e-3", "e-4"]) w.expert(id, [CAT.toplu]);
    w.proposal("p-1", "author", [CAT.toplu]);
    const panel = await w.draw("p-1", "author", [CAT.toplu], { k: 2 });
    expect(panel.draws).toEqual([{ round: 1, kind: "panel", reason: null, substitute: null, selected: 2, txHash: panel.ledgerTx, at: expect.any(Number) }]);
    expect(panel.assignments.every((a) => a.recuseReason === undefined)).toBe(true);

    const [a1, a2] = panel.assignments;
    await w.svc.respond(a2.id, a2.expertId, "accept");
    const after = await w.svc.respond(a1.id, a1.expertId, "recuse", "Yazarla aynı derneğin yönetimindeyim");
    expect(after.assignments.find((a) => a.id === a1.id)?.recuseReason).toBe("Yazarla aynı derneğin yönetimindeyim");
    expect(after.assignments.find((a) => a.id === a2.id)?.recuseReason).toBeUndefined();
    const drawTxs = w.drawTxs();
    expect(after.draws?.map((d) => d.txHash)).toEqual(drawTxs.map((t) => t.hash));
    expect(after.draws?.[1]).toMatchObject({ round: 1, kind: "substitute", reason: "recused", substitute: 1, selected: 1 });

    // Gerekçesiz çekinme → null; panel() aynı bilgiyi verir
    const sub = after.assignments.find((a) => a.status === "invited")!;
    await w.svc.respond(sub.id, sub.expertId, "recuse");
    const p = w.svc.panel("p-1")!;
    expect(p.assignments.find((a) => a.id === sub.id)?.recuseReason).toBeNull();
    expect(p.draws).toHaveLength(3);
    // Başka önerinin kuraları karışmaz
    w.proposal("p-2", "author", [CAT.toplu]);
    await w.draw("p-2", "author", [CAT.toplu], { k: 1 });
    expect(w.svc.panel("p-1")!.draws).toHaveLength(3);
    expect(w.svc.panel("p-2")!.draws).toHaveLength(1);
  });

  it("yaptırım nedeniyle değiştirme → reason 'replaced'; karşı panel → kind 'counter'", async () => {
    const w = makeWorld();
    w.user("author");
    for (const id of ["e-1", "e-2", "e-3", "e-4", "e-5"]) w.expert(id, [CAT.toplu]);
    w.proposal("p-1", "author", [CAT.toplu]);
    const panel = await w.draw("p-1", "author", [CAT.toplu], { k: 2 });
    w.svc.sanction(w.admin, panel.assignments[0].expertId, "suspend", "Gecikme");
    const after = w.svc.panel("p-1")!;
    expect(after.draws?.map((d) => [d.kind, d.reason])).toEqual([
      ["panel", null],
      ["substitute", "replaced"],
    ]);
    const counter = await w.draw("p-1", "author", [CAT.toplu], { k: 1, counter: true });
    expect(counter.draws?.map((d) => [d.round, d.kind])).toEqual([
      [1, "panel"],
      [1, "substitute"],
      [2, "counter"],
    ]);
  });
});
