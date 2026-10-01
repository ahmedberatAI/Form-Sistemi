import { contentHash, type ExpertAssessment } from "@forum/shared";
import { describe, expect, it } from "vitest";
import type { ExpertReportInput } from "../../src/core/contracts";
import { reportScore, suspensive, updatedReputation } from "../../src/experts";
import { CAT, LONG_BODY, catchAsync, makeWorld } from "./fixtures";

async function setup(k = 3) {
  const w = makeWorld();
  w.user("author", "Yazar");
  w.user("u-sor", "Soran");
  for (const id of ["e-a", "e-b", "e-c"]) w.expert(id, [CAT.toplu]);
  w.proposal("p-1", "author", [CAT.toplu]);
  const q1 = w.svc.addQuestion("p-1", "u-sor", "Yeni hat kaç durak içerecek?");
  const q2 = w.svc.addQuestion("p-1", "author", "İşletme maliyeti ne olur?", true);
  const panel = await w.draw("p-1", "author", [CAT.toplu], { k });
  const byExpert = Object.fromEntries(panel.assignments.map((a) => [a.expertId, a]));
  const input = (over: Partial<ExpertReportInput> = {}): ExpertReportInput => ({
    assessment: "feasible",
    confidence: 0.9,
    risks: ["Yoğun saatlerde kapasite yetersizliği"],
    answers: [
      { questionId: q1.id, answer: "On iki durak." },
      { questionId: q2.id, answer: "Yıllık bütçenin yaklaşık yüzde ikisi." },
    ],
    body: LONG_BODY,
    dissent: null,
    ...over,
  });
  const rep = (id: string) => w.db.get<{ reputation: number }>("SELECT reputation FROM experts WHERE user_id = ?", id)!.reputation;
  return { w, q1, q2, panel, byExpert, input, rep };
}

describe("rapor doğrulaması", () => {
  it("şema ve yetki denetimleri", async () => {
    const { w, byExpert, input, q1 } = await setup();
    const a = byExpert["e-a"];
    const sub = (over: Partial<ExpertReportInput>) => catchAsync(w.svc.submitReport(a.id, "e-a", input(over)));
    expect(await sub({ assessment: "harika" as ExpertAssessment })).toMatchObject({ status: 400, code: "invalid_assessment" });
    expect(await sub({ confidence: 1.2 })).toMatchObject({ status: 400, code: "invalid_confidence" });
    expect(await sub({ confidence: -0.1 })).toMatchObject({ code: "invalid_confidence" });
    expect(await sub({ body: "Kısa rapor." })).toMatchObject({ status: 400, code: "body_too_short" });
    expect(await sub({ risks: "yok" as never })).toMatchObject({ status: 400, code: "invalid_risks" });
    expect(await sub({ answers: [{ questionId: "baska-onerinin-sorusu", answer: "x" }] })).toMatchObject({ status: 400, code: "foreign_question" });
    expect(
      await sub({ answers: [{ questionId: q1.id, answer: "a" }, { questionId: q1.id, answer: "b" }] }),
    ).toMatchObject({ code: "duplicate_answer" });
    expect((await catchAsync(w.svc.submitReport(a.id, "e-b", input()))).status).toBe(403);
    expect((await catchAsync(w.svc.submitReport("yok", "e-a", input()))).status).toBe(404);
    expect(w.db.all("SELECT * FROM expert_reports")).toHaveLength(0);
  });
});

describe("rapor teslimi, lint ve itibar", () => {
  it("eksiksiz rapor: S = 1, R' = 0,8·0,75 + 0,2 = 0,8; defter, özet, bildirim", async () => {
    const { w, byExpert, input, rep } = await setup();
    const a = byExpert["e-a"];
    await w.svc.respond(a.id, "e-a", "accept");
    const view = await w.svc.submitReport(a.id, "e-a", input({ dissent: "Ek duraklar ileride düşünülebilir." }));
    expect(view).toMatchObject({ assignmentId: a.id, expertId: "e-a", expertNickname: "e-a", assessment: "feasible", confidence: 0.9, lintIssues: [] });
    expect(view.contentHash).toBe(contentHash(view.id, LONG_BODY));
    expect(rep("e-a")).toBe(0.8);
    expect(w.db.get<{ reputation: number }>("SELECT reputation FROM users WHERE id = 'e-a'")?.reputation).toBe(0.8);
    expect(w.db.get<{ score: number }>("SELECT score FROM expert_reports WHERE id = ?", view.id)?.score).toBe(1);
    expect(w.ai.calls.at(-1)).toBe(`${LONG_BODY}\n\nEk duraklar ileride düşünülebilir.`);

    const tx = w.ledger.txs.find((t) => t.type === "EXPERT_REPORT")!;
    expect(view.ledgerTx).toBe(tx.hash);
    expect(tx.payload).toEqual({ proposalId: "p-1", reportId: view.id, assessment: "feasible", confidence: 0.9, contentHash: view.contentHash });

    expect(w.notifier.sent.some((n) => n.userId === "author" && n.kind === "expert_report")).toBe(true);
    const panel = w.svc.panel("p-1")!;
    expect(panel.assignments.find((x) => x.id === a.id)?.status).toBe("reported");
    expect(panel.reports.map((r) => r.id)).toEqual([view.id]);
    expect(panel.questions).toHaveLength(2);
    expect(w.svc.get("e-a")).toMatchObject({ completedReports: 1, activeAssignments: 0 });
    expect((await catchAsync(w.svc.submitReport(a.id, "e-a", input()))).code).toBe("invalid_state");
  });

  it("hukuki nitelendirme (YZ bulgusu) ve yanıtsız soru: S = 0,5, R' = 0,7", async () => {
    const { w, byExpert, input, q1, rep } = await setup();
    const view = await w.svc.submitReport(
      byExpert["e-b"].id,
      "e-b",
      input({ body: `${LONG_BODY} Ayrıca bu düzenleme hukuka aykırı niteliktedir.`, answers: [{ questionId: q1.id, answer: "On iki." }] }),
    );
    expect(view.lintIssues.map((i) => i.kind)).toEqual(["legal_qualification"]);
    expect(w.db.get<{ score: number }>("SELECT score FROM expert_reports WHERE id = ?", view.id)?.score).toBe(0.5);
    expect(rep("e-b")).toBe(0.7);
    const lint = JSON.parse(w.db.get<{ lint: string }>("SELECT lint FROM expert_reports WHERE id = ?", view.id)!.lint);
    expect(lint.label).toContain("çevrimdışı sezgisel mod");
  });

  it("alan dışı bulgu ve boş yanıt da puanı düşürür; geç teslim kabul edilir ama zamanında sayılmaz", async () => {
    const { w, byExpert, input, q1, q2, panel, rep } = await setup();
    w.clock.set(panel.assignments[0].dueAt + 1);
    const view = await w.svc.submitReport(
      byExpert["e-c"].id,
      "e-c",
      input({
        dissent: "Bu konu alan dışı olsa da belirtmeliyim.",
        answers: [
          { questionId: q1.id, answer: "On iki." },
          { questionId: q2.id, answer: "   " },
        ],
      }),
    );
    expect(view.lintIssues.map((i) => i.kind)).toEqual(["out_of_domain"]);
    // zamanında değil, tüm sorular yanıtlanmadı, alan dışı; hukuki nitelendirme yok → S = 0,25
    expect(w.db.get<{ score: number }>("SELECT score FROM expert_reports WHERE id = ?", view.id)?.score).toBe(0.25);
    expect(rep("e-c")).toBe(0.65);
  });

  it("sonucun içeriği puanı etkilemez: çoğunlukla aynı fikirde olmak ödüllendirilmez", async () => {
    const { w, byExpert, input, rep } = await setup();
    await w.svc.submitReport(byExpert["e-a"].id, "e-a", input({ assessment: "infeasible", confidence: 0.95 }));
    await w.svc.submitReport(byExpert["e-b"].id, "e-b", input({ assessment: "infeasible", confidence: 0.85 }));
    await w.svc.submitReport(byExpert["e-c"].id, "e-c", input({ assessment: "feasible", confidence: 0.6 }));
    expect([rep("e-a"), rep("e-b"), rep("e-c")]).toEqual([0.8, 0.8, 0.8]);
  });

  it("YZ denetimi başarısız olsa da rapor kabul edilir", async () => {
    const { w, byExpert, input } = await setup();
    w.ai.fail = true;
    const view = await w.svc.submitReport(byExpert["e-a"].id, "e-a", input());
    expect(view.lintIssues).toEqual([]);
  });

  it("saf yardımcılar", () => {
    expect(reportScore({ timely: true, allAnswered: true, inDomain: true, noLegalQualification: false })).toBe(0.75);
    expect(updatedReputation(0.75, 0.75)).toBe(0.75);
    expect(updatedReputation(0.75, 0)).toBe(0.6);
    expect(updatedReputation(0.6, 1)).toBe(0.68);
  });
});

describe("askı kuralı (§8 adım 9)", () => {
  const r = (assessment: ExpertAssessment, confidence: number) => ({ assessment, confidence });

  it("sınır durumları: 2/3 tam ve medyan 0,8 tam", () => {
    expect(suspensive([])).toBe(false);
    expect(suspensive([r("infeasible", 0.8)])).toBe(true);
    expect(suspensive([r("infeasible", 0.79)])).toBe(false);
    // 2/3 tam, medyan tam 0,8
    expect(suspensive([r("infeasible", 0.8), r("infeasible", 0.9), r("feasible", 0.3)])).toBe(true);
    expect(suspensive([r("infeasible", 0.79), r("infeasible", 0.9), r("feasible", 0.3)])).toBe(false);
    // 1/2 < 2/3
    expect(suspensive([r("infeasible", 0.9), r("feasible", 0.9)])).toBe(false);
    // 4 raporda 3 gerekir (2/4 < 2/3 ≤ 3/4)
    expect(suspensive([r("infeasible", 0.9), r("infeasible", 0.9), r("uncertain", 0.9), r("feasible", 0.9)])).toBe(false);
    // çift sayıda medyan: (0,75 + 0,85) / 2 = 0,8 tam
    expect(suspensive([r("infeasible", 0.7), r("infeasible", 0.75), r("infeasible", 0.85), r("feasible", 0.9)])).toBe(true);
    expect(suspensive([r("infeasible", 0.7), r("infeasible", 0.75), r("infeasible", 0.84), r("feasible", 0.9)])).toBe(false);
    // 6 raporda tam 4 (= 2/3)
    const six = [0.8, 0.8, 0.8, 0.8, 0.8, 0.8].map((c, i) => r(i < 4 ? "infeasible" : "feasible", c));
    expect(suspensive(six)).toBe(true);
  });

  it("servis: raporlardan hesaplanır ve panelde gösterilir", async () => {
    const { w, byExpert, input } = await setup();
    expect(w.svc.suspensiveFlag("p-1")).toBe(false);
    await w.svc.submitReport(byExpert["e-a"].id, "e-a", input({ assessment: "infeasible", confidence: 0.8 }));
    expect(w.svc.suspensiveFlag("p-1")).toBe(true);
    await w.svc.submitReport(byExpert["e-b"].id, "e-b", input({ assessment: "feasible", confidence: 0.95 }));
    expect(w.svc.suspensiveFlag("p-1")).toBe(false);
    await w.svc.submitReport(byExpert["e-c"].id, "e-c", input({ assessment: "infeasible", confidence: 0.8 }));
    expect(w.svc.suspensiveFlag("p-1")).toBe(true);
    expect(w.svc.panel("p-1")?.suspensiveFlag).toBe(true);
  });
});

describe("süresi geçen görevler", () => {
  it("markOverdue: overdue + R' = 0,8R + bildirim; sonradan rapor verilemez", async () => {
    const { w, panel, byExpert, input, rep } = await setup();
    await w.svc.submitReport(byExpert["e-a"].id, "e-a", input());
    const due = panel.assignments[0].dueAt;
    expect(w.svc.markOverdue(due)).toBe(0);
    w.clock.set(due + 1);
    expect(w.svc.markOverdue(w.clock.now())).toBe(2);
    expect(rep("e-a")).toBe(0.8);
    expect(rep("e-b")).toBe(0.6);
    expect(rep("e-c")).toBe(0.6);
    expect(w.db.get<{ reputation: number }>("SELECT reputation FROM users WHERE id = 'e-b'")?.reputation).toBe(0.6);
    expect(w.svc.assignmentsFor("e-b")[0].status).toBe("overdue");
    expect(w.notifier.sent.filter((n) => n.kind === "expert_overdue").map((n) => n.userId).sort()).toEqual(["e-b", "e-c"]);
    expect(w.svc.markOverdue(w.clock.now())).toBe(0);
    expect((await catchAsync(w.svc.submitReport(byExpert["e-b"].id, "e-b", input()))).code).toBe("invalid_state");
  });
});
