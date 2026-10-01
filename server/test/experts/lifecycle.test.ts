import { describe, expect, it } from "vitest";
import { AppError } from "../../src/core/errors";
import { CAT, catchErr, makeWorld } from "./fixtures";

describe("bilirkişi başvurusu", () => {
  it("doğrulanmamış üye başvuramaz; alanlar ve yeterlilik zorunludur", () => {
    const w = makeWorld();
    w.user("u-pending", "Bekleyen", "pending");
    const e1 = catchErr(() => w.svc.apply("u-pending", [CAT.toplu], "İnşaat mühendisi"));
    expect(e1).toBeInstanceOf(AppError);
    expect(e1.status).toBe(403);
    expect(catchErr(() => w.svc.apply("yok", [CAT.toplu], "İnşaat mühendisi")).status).toBe(404);

    w.user("u-1", "Ayşe");
    const e2 = catchErr(() => w.svc.apply("u-1", [], "İnşaat mühendisi"));
    expect(e2.status).toBe(400);
    expect(e2.code).toBe("domains_required");
    expect(catchErr(() => w.svc.apply("u-1", ["  "], "İnşaat mühendisi")).code).toBe("domains_required");
    expect(catchErr(() => w.svc.apply("u-1", [CAT.toplu], " ")).code).toBe("invalid_credentials");
  });

  it("başvuru 'applied' olur, yöneticilere bildirim ve denetim kaydı düşer", () => {
    const w = makeWorld();
    w.user("u-1", "Ayşe");
    const info = w.svc.apply("u-1", ["fy:TopluTasima", CAT.toplu], "Ulaşım planlama uzmanı");
    expect(info).toMatchObject({ userId: "u-1", nickname: "Ayşe", status: "applied", reputation: 0.75, activeAssignments: 0, completedReports: 0 });
    // kısa IRI genişletilir ve yinelenen alan tekilleşir
    expect(info.domains).toEqual([CAT.toplu]);
    const n = w.notifier.sent.filter((x) => x.kind === "expert_application");
    expect(n.map((x) => x.userId)).toEqual([w.admin]);
    expect(n[0].body).toContain("Ayşe");
    const log = w.db.get<{ actor_id: string; action: string; target: string }>("SELECT actor_id, action, target FROM audit_log WHERE action = 'expert.apply'");
    expect(log).toEqual({ actor_id: "u-1", action: "expert.apply", target: "user:u-1" });
    expect(catchErr(() => w.svc.apply("u-1", [CAT.toplu], "Ulaşım planlama uzmanı")).code).toBe("already_applied");
  });
});

describe("başvuru kararı", () => {
  it("yalnız yönetici karar verir; onay → active, EXPERT_IN kenarları, bildirim, denetim", () => {
    const w = makeWorld();
    w.user("u-1", "Ayşe");
    w.user("u-2", "Mehmet");
    w.svc.apply("u-1", [CAT.toplu, CAT.metro], "Ulaşım planlama uzmanı");
    const e = catchErr(() => w.svc.decideApplication("u-2", "u-1", "approve"));
    expect(e).toBeInstanceOf(AppError);
    expect(e.status).toBe(403);

    w.clock.advance(1000);
    const info = w.svc.decideApplication(w.admin, "u-1", "approve", "Belgeler uygun");
    expect(info.status).toBe("active");
    const row = w.db.get<{ approved_by: string; approved_at: number }>("SELECT approved_by, approved_at FROM experts WHERE user_id = 'u-1'");
    expect(row).toEqual({ approved_by: w.admin, approved_at: w.clock.now() });
    const edges = w.graph.listEdges({ src: "user:u-1", type: "EXPERT_IN" });
    expect(edges.map((x) => x.dst).sort()).toEqual([`cat:${CAT.metro}`, `cat:${CAT.toplu}`]);
    expect(w.notifier.sent.find((x) => x.kind === "expert_decision" && x.userId === "u-1")?.body).toContain("Belgeler uygun");
    expect(w.db.get("SELECT action FROM audit_log WHERE action = 'expert.approve' AND actor_id = ?", w.admin)).toBeTruthy();
    expect(w.db.get<{ reputation: number }>("SELECT reputation FROM users WHERE id = 'u-1'")?.reputation).toBe(0.75);

    expect(catchErr(() => w.svc.decideApplication(w.admin, "u-1", "approve")).code).toBe("not_pending");
    expect(catchErr(() => w.svc.apply("u-1", [CAT.toplu], "Tekrar başvuru")).code).toBe("already_expert");
  });

  it("ret → rejected; reddedilen yeniden başvurabilir; yönetici kendi başvurusuna karar veremez", () => {
    const w = makeWorld();
    w.user("u-1", "Ayşe");
    w.svc.apply("u-1", [CAT.toplu], "Ulaşım planlama uzmanı");
    expect(w.svc.decideApplication(w.admin, "u-1", "reject", "Belge eksik").status).toBe("rejected");
    expect(w.graph.listEdges({ src: "user:u-1" })).toHaveLength(0);
    expect(w.db.get("SELECT action FROM audit_log WHERE action = 'expert.reject'")).toBeTruthy();
    expect(w.svc.apply("u-1", [CAT.metro], "Belgeler tamamlandı").status).toBe("applied");

    w.svc.apply(w.admin, [CAT.saglik], "Hekim");
    expect(catchErr(() => w.svc.decideApplication(w.admin, w.admin, "approve")).status).toBe(403);
  });
});

describe("yaptırımlar", () => {
  it("uyarı itibarı 0,05 düşürür (alt sınır 0); gerekçe ve yönetici yetkisi zorunlu", () => {
    const w = makeWorld();
    w.expert("e-1", [CAT.toplu]);
    w.user("u-2");
    expect(catchErr(() => w.svc.sanction("u-2", "e-1", "warn", "Gecikme")).status).toBe(403);
    expect(catchErr(() => w.svc.sanction(w.admin, "e-1", "warn", "  ")).code).toBe("note_required");
    expect(catchErr(() => w.svc.sanction(w.admin, w.admin, "warn", "x")).status).toBe(403);

    expect(w.svc.sanction(w.admin, "e-1", "warn", "Rapor dili sert").reputation).toBe(0.7);
    expect(w.db.get<{ reputation: number }>("SELECT reputation FROM users WHERE id = 'e-1'")?.reputation).toBe(0.7);
    w.db.run("UPDATE experts SET reputation = 0.03 WHERE user_id = 'e-1'");
    expect(w.svc.sanction(w.admin, "e-1", "warn", "Tekrar").reputation).toBe(0);
    expect(w.db.get<{ sanction_note: string }>("SELECT sanction_note FROM experts WHERE user_id = 'e-1'")?.sanction_note).toBe("Tekrar");
    expect(w.notifier.sent.filter((x) => x.kind === "expert_sanction" && x.userId === "e-1")).toHaveLength(2);
    expect(w.db.all("SELECT * FROM audit_log WHERE action = 'expert.sanction.warn'")).toHaveLength(2);
  });

  it("askıya alma bekleyen görevleri 'replaced' yapar ve yedek çeker; yeniden etkinleştirme", async () => {
    const w = makeWorld();
    w.user("author");
    for (const id of ["e-1", "e-2", "e-3", "e-4"]) w.expert(id, [CAT.toplu]);
    w.proposal("p-1", "author", [CAT.toplu]);
    const panel = await w.draw("p-1", "author", [CAT.toplu], { k: 2 });
    const victim = panel.assignments[0].expertId;
    const other = panel.assignments[1].expertId;

    const info = w.svc.sanction(w.admin, victim, "suspend", "Beyan edilmemiş çıkar çatışması");
    expect(info.status).toBe("suspended");
    expect(info.activeAssignments).toBe(0);
    const after = w.svc.panel("p-1")!;
    expect(after.assignments.find((a) => a.expertId === victim)?.status).toBe("replaced");
    const fresh = after.assignments.filter((a) => a.status === "invited");
    expect(fresh).toHaveLength(2);
    const sub = fresh.find((a) => a.expertId !== other)!;
    expect([victim, other]).not.toContain(sub.expertId);
    const subTx = w.drawTxs().find((t) => t.payload.substitute === 1)!;
    expect(subTx.payload).toMatchObject({ reason: "replaced", panelId: panel.panelId, seed: `${panel.seed}|yedek|1` });

    // askıdaki bilirkişi yeni kuralarda aday değildir
    w.proposal("p-2", "author", [CAT.toplu]);
    const p2 = await w.draw("p-2", "author", [CAT.toplu], { k: 1 });
    expect(p2.candidates.map((c) => c.userId)).not.toContain(victim);

    expect(catchErr(() => w.svc.sanction(w.admin, victim, "suspend", "x")).code).toBe("invalid_state");
    expect(w.svc.sanction(w.admin, victim, "reinstate", "Savunma kabul edildi").status).toBe("active");
    expect(catchErr(() => w.svc.sanction(w.admin, victim, "reinstate", "x")).code).toBe("invalid_state");
  });

  it("listeden çıkarma EXPERT_IN kenarlarını iptal eder, yeniden etkinleştirme geri ekler", () => {
    const w = makeWorld();
    w.expert("e-1", [CAT.toplu, CAT.metro]);
    expect(w.graph.listEdges({ src: "user:e-1", type: "EXPERT_IN" })).toHaveLength(2);
    expect(w.svc.sanction(w.admin, "e-1", "remove", "Sahte belge").status).toBe("removed");
    expect(w.graph.listEdges({ src: "user:e-1", type: "EXPERT_IN" })).toHaveLength(0);
    expect(w.graph.listEdges({ src: "user:e-1", type: "EXPERT_IN", includeRevoked: true })).toHaveLength(2);
    w.svc.sanction(w.admin, "e-1", "reinstate", "Belge doğrulandı");
    expect(w.graph.listEdges({ src: "user:e-1", type: "EXPERT_IN" })).toHaveLength(2);
  });
});

describe("listeleme ve sorular", () => {
  it("list durum ve alan (alt kategoriler dahil) süzgeci; get sayaçları", async () => {
    const w = makeWorld();
    w.user("author");
    w.expert("e-toplu", [CAT.toplu]);
    w.expert("e-metro", [CAT.metro]);
    w.expert("e-saglik", [CAT.saglik]);
    w.user("u-app");
    w.svc.apply("u-app", [CAT.toplu], "Yeni başvuru");

    expect(w.svc.list().map((e) => e.userId).sort()).toEqual(["e-metro", "e-saglik", "e-toplu", "u-app"]);
    expect(w.svc.list({ status: "active" }).map((e) => e.userId).sort()).toEqual(["e-metro", "e-saglik", "e-toplu"]);
    expect(w.svc.list({ status: "active", domain: CAT.ulasim }).map((e) => e.userId).sort()).toEqual(["e-metro", "e-toplu"]);
    expect(w.svc.list({ domain: "fy:Metro" }).map((e) => e.userId)).toEqual(["e-metro"]);
    expect(w.svc.get("yok")).toBeNull();

    w.proposal("p-1", "author", [CAT.saglik]);
    const panel = await w.draw("p-1", "author", [CAT.saglik], { k: 1 });
    expect(w.svc.get("e-saglik")).toMatchObject({ activeAssignments: 1, completedReports: 0 });
    expect(w.svc.assignmentsFor("e-saglik")).toEqual([
      { assignmentId: panel.assignments[0].id, proposalId: "p-1", status: "invited", dueAt: panel.assignments[0].dueAt },
    ]);
  });

  it("addQuestion: 10–1000 karakter, azınlık güvencesi ve takma ad", () => {
    const w = makeWorld();
    w.user("u-1", "Zeynep");
    w.proposal("p-1", "u-1");
    expect(catchErr(() => w.svc.addQuestion("p-1", "u-1", "kısa")).code).toBe("invalid_question");
    expect(catchErr(() => w.svc.addQuestion("p-1", "u-1", "x".repeat(1001))).code).toBe("invalid_question");
    expect(catchErr(() => w.svc.addQuestion("yok", "u-1", "Bu hat kaç kişiye hizmet eder?")).status).toBe(404);
    const q = w.svc.addQuestion("p-1", "u-1", "  Bu hat kaç kişiye hizmet eder?  ", true);
    expect(q).toMatchObject({ proposalId: "p-1", authorId: "u-1", authorNickname: "Zeynep", body: "Bu hat kaç kişiye hizmet eder?", minorityGuaranteed: true, createdAt: w.clock.now() });
  });
});
