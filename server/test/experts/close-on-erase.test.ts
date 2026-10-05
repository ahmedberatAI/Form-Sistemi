// Regresyon: hesabı kapanan (KVKK silme) bilirkişinin kaydı kapatılır ve açık görevleri yedeğe devredilir; uzmanlık alanları
// yönetmelikte (ontolojide) tanımlı kategorilerden olmalıdır.
import { describe, expect, it } from "vitest";
import { fy } from "@forum/shared";
import { createAuditLogger } from "../../src/core/audit";
import type { AiService, GraphService } from "../../src/core/contracts";
import { MemoryNotifier } from "../../src/core/notifier";
import { createExpertService } from "../../src/experts";
import { CAT, catchErr, fakeMath, fakeOntology, makeWorld } from "./fixtures";

const erase = (w: ReturnType<typeof makeWorld>, id: string) =>
  w.db.run("UPDATE users SET status = 'erased', nickname = ? WHERE id = ?", `Silinmiş üye #${id.slice(0, 6)}`, id);

describe("bilirkişi: hesabı kapanan üyenin kaydı kapatılır", () => {
  it("closeForClosedAccount: davetli ve kabul edilmiş görevler 'replaced' olur, yedek çekilir; kayıt removed, beyan imha, kenarlar iptal", async () => {
    const w = makeWorld();
    w.user("author");
    for (const id of ["e-1", "e-2", "e-3", "e-4", "e-5"]) w.expert(id, [CAT.toplu]);
    w.proposal("p-1", "author", [CAT.toplu]);
    const panel = await w.draw("p-1", "author", [CAT.toplu], { k: 2 });
    const [victim, other] = panel.assignments.map((a) => a.expertId);
    await w.svc.respond(panel.assignments[0].id, victim, "accept");
    w.svc.sanction(w.admin, victim, "warn", "Gecikmeli yanıt"); // yaptırım notu (serbest metin) da imha edilmeli
    w.proposal("p-2", "author", [CAT.toplu]);
    const p2 = await w.draw("p-2", "author", [CAT.toplu], { k: 5 }); // davetli (invited) görev
    expect(p2.assignments.map((a) => a.expertId)).toContain(victim);

    erase(w, victim);
    const replaced = w.svc.closeForClosedAccount(victim);
    expect(replaced).toBe(2);

    const after = w.svc.panel("p-1")!;
    expect(after.assignments.find((a) => a.expertId === victim)?.status).toBe("replaced");
    const invited = after.assignments.filter((a) => a.status === "invited").map((a) => a.expertId);
    expect(invited).toContain(other);
    expect(invited.filter((id) => id !== other)).toHaveLength(1); // yedek çekildi
    expect(invited).not.toContain(victim);
    expect(w.drawTxs().some((t) => t.payload.substitute === 1 && t.payload.reason === "replaced" && t.payload.panelId === panel.panelId)).toBe(true);
    expect(w.svc.panel("p-2")!.assignments.find((a) => a.expertId === victim)?.status).toBe("replaced");

    expect(w.db.get("SELECT status, domains, credentials, sanction_note FROM experts WHERE user_id = ?", victim)).toEqual({
      status: "removed",
      domains: "[]",
      credentials: "",
      sanction_note: null,
    });
    expect(w.graph.listEdges({ src: `user:${victim}`, type: "EXPERT_IN" })).toEqual([]);
    expect(w.svc.get(victim)).toBeNull();
    expect(w.svc.list().map((e) => e.userId)).not.toContain(victim);
    expect(w.svc.list({ status: "removed" }).map((e) => e.userId)).not.toContain(victim);
    expect(w.db.get("SELECT 1 FROM audit_log WHERE action = 'expert.close_on_account_closed' AND target = ?", `user:${victim}`)).toBeTruthy();
    // Kapanmış hesabın kaydı yeniden açılamaz, onaylanamaz.
    expect(catchErr(() => w.svc.sanction(w.admin, victim, "reinstate", "Geri alalım")).code).toBe("invalid_state");
    // Silinen kişi yeni kuralarda aday olmaz.
    w.proposal("p-3", "author", [CAT.toplu]);
    expect((await w.draw("p-3", "author", [CAT.toplu], { k: 1 })).candidates.map((c) => c.userId)).not.toContain(victim);
    // Kaydı olmayan üye için bir şey yapmaz.
    expect(w.svc.closeForClosedAccount("author")).toBe(0);
  });

  it("eski veri: kapatılmamış kaydın bekleyen görevi markOverdue çağrısında yedeğe devredilir", async () => {
    const w = makeWorld();
    w.user("author");
    for (const id of ["e-1", "e-2", "e-3"]) w.expert(id, [CAT.toplu]);
    w.proposal("p-1", "author", [CAT.toplu]);
    const panel = await w.draw("p-1", "author", [CAT.toplu], { k: 1 });
    const victim = panel.assignments[0].expertId;
    erase(w, victim); // düzeltmeden önceki silme: bilirkişi kaydına dokunulmamış
    expect(w.svc.markOverdue(w.clock.now())).toBe(0); // süresi geçen yok
    const after = w.svc.panel("p-1")!;
    expect(after.assignments.find((a) => a.expertId === victim)?.status).toBe("replaced");
    expect(after.assignments.filter((a) => a.status === "invited")).toHaveLength(1);
    expect(w.svc.markOverdue(w.clock.now())).toBe(0);
    expect(w.svc.panel("p-1")!.assignments).toHaveLength(2); // ikinci çağrı yeni yedek çekmez
  });

  it("eski veri: açılışta kapanmış hesapların bilirkişi kayıtları kapatılır (beyan imha, kenar iptal)", () => {
    const w = makeWorld();
    w.expert("e-1", [CAT.toplu, CAT.metro]);
    w.expert("e-2", [CAT.toplu]);
    erase(w, "e-1");
    // Aynı veritabanı üzerinde hizmet yeniden kurulur (sunucu yeniden başlatması).
    const svc = createExpertService(w.ctx, {
      ledger: w.ledger,
      graph: w.graph as unknown as GraphService,
      math: fakeMath,
      ai: w.ai as unknown as AiService,
      notifier: new MemoryNotifier(),
      audit: createAuditLogger(w.ctx),
      ontology: fakeOntology,
      householdOf: () => null,
    });
    expect(w.db.get("SELECT status, domains, credentials FROM experts WHERE user_id = 'e-1'")).toEqual({ status: "removed", domains: "[]", credentials: "" });
    expect(w.db.get<{ status: string }>("SELECT status FROM experts WHERE user_id = 'e-2'")?.status).toBe("active");
    expect(w.graph.listEdges({ src: "user:e-1", type: "EXPERT_IN" })).toEqual([]);
    expect(svc.list().map((e) => e.userId)).toEqual(["e-2"]);
  });
});

describe("bilirkişi: uzmanlık alanı ontolojide tanımlı olmalı", () => {
  it("bilinmeyen IRI, serbest URL ve kök sınıf → 400 unknown_domain; geçerli alanlar kabul", () => {
    const w = makeWorld();
    w.user("u-1", "Deniz");
    for (const domains of [[fy("Yok")], ["https://reklam.example/indirim"], [CAT.root], [CAT.toplu, fy("Uydurma")]]) {
      const e = catchErr(() => w.svc.apply("u-1", domains, "Elektrik mühendisi; 10 yıl deneyim."));
      expect(e.status, JSON.stringify(domains)).toBe(400);
      expect(e.code).toBe("unknown_domain");
    }
    expect(w.notifier.sent.filter((n) => n.kind === "expert_application")).toHaveLength(0);
    expect(w.svc.apply("u-1", ["fy:TopluTasima", CAT.saglik], "Elektrik mühendisi; 10 yıl deneyim.").domains).toEqual([CAT.toplu, CAT.saglik]);
  });

  it("eski (tanımsız alanlı) başvurunun onayı 400 unknown_domain; ret serbest", () => {
    const w = makeWorld();
    w.user("u-1", "Deniz");
    w.user("u-2", "Mehmet");
    w.svc.apply("u-1", [CAT.toplu], "Elektrik mühendisi; 10 yıl deneyim.");
    w.svc.apply("u-2", [CAT.toplu], "Elektrik mühendisi; 10 yıl deneyim.");
    w.db.run("UPDATE experts SET domains = ? WHERE user_id IN ('u-1', 'u-2')", JSON.stringify([fy("Yok")]));
    expect(catchErr(() => w.svc.decideApplication(w.admin, "u-1", "approve")).code).toBe("unknown_domain");
    expect(w.svc.decideApplication(w.admin, "u-2", "reject").status).toBe("rejected");
  });
});
