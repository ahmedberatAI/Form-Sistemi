// Metin uzunluğu sınırlarının TEK kaynağı (TEXT_LIMITS): HTTP şeması bir değeri kabul ediyorsa servis de kabul eder,
// reddediyorsa servis de reddeder (sınır değerinde ve bir fazlasında). Bkz. bulgular #3, #95, #115, #246.
import { TEXT_LIMITS } from "@forum/shared";
import { describe, expect, it } from "vitest";
import { assignmentRespondBody, expertApplyBody, expertQuestionBody, expertReportBody } from "../../src/http/schemas";
import { CAT, catchAsync, catchErr, makeWorld } from "./fixtures";

const x = (n: number) => "x".repeat(n);
const DOMAIN = CAT.toplu;
const BASE_REPORT = { assessment: "feasible" as const, confidence: 0.9, risks: ["Kapasite riski"], answers: [] as { questionId: string; answer: string }[], body: x(60) };

describe("metin sınırları: şema ve bilirkişi servisi uyuşur", () => {
  it("bilirkişi sorusu: şema ve ExpertService.addQuestion aynı sınırda kabul/ret eder", () => {
    const w = makeWorld();
    w.user("author");
    w.user("asker");
    w.proposal("p-1", "author", [DOMAIN]);
    const { min, max } = TEXT_LIMITS.expertQuestion;
    expect(expertQuestionBody.safeParse({ body: x(max) }).success).toBe(true);
    expect(expertQuestionBody.safeParse({ body: x(max + 1) }).success).toBe(false);
    expect(w.svc.addQuestion("p-1", "asker", x(max)).body).toHaveLength(max);
    expect(catchErr(() => w.svc.addQuestion("p-1", "asker", x(max + 1)))).toMatchObject({ status: 400, code: "invalid_question" });
    expect(catchErr(() => w.svc.addQuestion("p-1", "asker", x(min - 1)))).toMatchObject({ code: "invalid_question" });
    expect(w.svc.addQuestion("p-1", "asker", x(min)).body).toHaveLength(min);
  });

  it("yeterlilik açıklaması: şema ve ExpertService.apply aynı sınırda kabul/ret eder", () => {
    const w = makeWorld();
    w.user("basvuran");
    const { max } = TEXT_LIMITS.expertCredentials;
    expect(expertApplyBody.safeParse({ domains: [DOMAIN], credentials: x(max) }).success).toBe(true);
    expect(expertApplyBody.safeParse({ domains: [DOMAIN], credentials: x(max + 1) }).success).toBe(false);
    expect(catchErr(() => w.svc.apply("basvuran", [DOMAIN], x(max + 1)))).toMatchObject({ status: 400, code: "credentials_length" });
    expect(w.svc.apply("basvuran", [DOMAIN], x(max))).toBeTruthy();
  });

  it("çekinme gerekçesi: şema ve ExpertService.respond aynı sınırda kabul/ret eder", async () => {
    const w = makeWorld();
    w.user("author");
    for (const id of ["e-a", "e-b", "e-c", "e-d"]) w.expert(id, [DOMAIN]);
    w.proposal("p-1", "author", [DOMAIN]);
    const panel = await w.draw("p-1", "author", [DOMAIN], { k: 3 });
    const a = panel.assignments[0];
    const { max } = TEXT_LIMITS.expertRecuseReason;
    expect(assignmentRespondBody.safeParse({ decision: "recuse", reason: x(max) }).success).toBe(true);
    expect(assignmentRespondBody.safeParse({ decision: "recuse", reason: x(max + 1) }).success).toBe(false);
    expect(await catchAsync(w.svc.respond(a.id, a.expertId, "recuse", x(max + 1)))).toMatchObject({ status: 400, code: "reason_too_long" });
    await expect(w.svc.respond(a.id, a.expertId, "recuse", x(max))).resolves.toBeTruthy();
  });

  it("rapor alanları (gövde, risk, yanıt, karşı görüş): şema ve ExpertService.submitReport aynı sınırda kabul/ret eder", async () => {
    const w = makeWorld();
    w.user("author");
    w.user("asker");
    for (const id of ["e-a", "e-b", "e-c"]) w.expert(id, [DOMAIN]);
    w.proposal("p-1", "author", [DOMAIN]);
    const q = w.svc.addQuestion("p-1", "asker", "Yeni hat kaç durak içerecek?");
    const panel = await w.draw("p-1", "author", [DOMAIN], { k: 3 });
    const [a, b] = panel.assignments;
    const L = TEXT_LIMITS;
    const answers = (n: number) => [{ questionId: q.id, answer: x(n) }];
    // [alan, kabul edilen değer, reddedilen değer, hata kodu]
    const cases: [string, Record<string, unknown>, Record<string, unknown>, string][] = [
      ["body", { body: x(L.expertReportBody.max) }, { body: x(L.expertReportBody.max + 1) }, "body_too_long"],
      ["risk", { risks: [x(L.expertReportRisk.max)] }, { risks: [x(L.expertReportRisk.max + 1)] }, "invalid_risks"],
      ["answer", { answers: answers(L.expertReportAnswer.max) }, { answers: answers(L.expertReportAnswer.max + 1) }, "answer_too_long"],
      ["dissent", { dissent: x(L.expertReportDissent.max) }, { dissent: x(L.expertReportDissent.max + 1) }, "dissent_too_long"],
    ];
    for (const [field, ok, tooLong, code] of cases) {
      expect(expertReportBody.safeParse({ ...BASE_REPORT, ...ok }).success, `${field}: şema sınırı kabul etmeli`).toBe(true);
      expect(expertReportBody.safeParse({ ...BASE_REPORT, ...tooLong }).success, `${field}: şema sınırı aşanı reddetmeli`).toBe(false);
      const err = await catchAsync(w.svc.submitReport(b.id, b.expertId, { ...BASE_REPORT, ...tooLong }));
      expect(err, `${field}: servis sınırı aşanı reddetmeli`).toMatchObject({ status: 400, code });
    }
    // Hepsi sınır değerinde olan rapor tek seferde kabul edilir.
    const all = { body: x(L.expertReportBody.max), risks: [x(L.expertReportRisk.max)], answers: answers(L.expertReportAnswer.max), dissent: x(L.expertReportDissent.max) };
    expect(expertReportBody.safeParse({ ...BASE_REPORT, ...all }).success).toBe(true);
    await expect(w.svc.submitReport(a.id, a.expertId, { ...BASE_REPORT, ...all })).resolves.toMatchObject({ assignmentId: a.id });
  });
});
