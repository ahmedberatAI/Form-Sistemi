// Metin uzunluğu sınırlarının TEK kaynağı (TEXT_LIMITS): HTTP şeması bir değeri kabul ediyorsa servis de kabul eder,
// reddediyorsa servis de reddeder. Bkz. bulgular #3, #95, #246. (İtiraz ve azınlık raporu oylama sonrası evrede
// yazıldığından burada yalnızca şema sınırlarının TEXT_LIMITS ile aynı olduğu doğrulanır.)
import { TEXT_LIMITS } from "@forum/shared";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "../../src/core/contracts";
import { expertQuestionBody, minorityReportBody, objectionBody, suggestionBody } from "../../src/http/schemas";
import { makeForum, toDeliberation, type ForumHarness } from "./harness";

const x = (n: number) => "x".repeat(n);

describe("metin sınırları: şema ve öneri servisi uyuşur", () => {
  let h: ForumHarness;
  let m: AuthUser[];
  let id: string;

  beforeAll(async () => {
    h = await makeForum();
    m = h.users("uye", 20);
    id = await toDeliberation(h, m[0], m.slice(1));
  });

  it("metin önerisi: 20000 karakter şemada da serviste de kabul, bir fazlası ikisinde de ret", () => {
    const { max } = TEXT_LIMITS.suggestion;
    expect(suggestionBody.safeParse({ body: x(max) }).success).toBe(true);
    expect(suggestionBody.safeParse({ body: x(max + 1) }).success).toBe(false);
    // Eskiden şema 10000'de kesiyordu: arayüzün önceden doldurduğu uzun metin hiç gönderilemiyordu.
    expect(suggestionBody.safeParse({ body: x(15_000) }).success).toBe(true);
    expect(h.forum.proposals.suggest(m[2], id, x(max)).body).toHaveLength(max);
    expect(() => h.forum.proposals.suggest(m[3], id, x(max + 1))).toThrow(/en fazla 20000 karakter/);
  });

  it("bilirkişiye soru: şema ve ProposalService.expertQuestion aynı sınırda kabul/ret eder", () => {
    const { max } = TEXT_LIMITS.expertQuestion;
    expect(expertQuestionBody.safeParse({ body: x(max) }).success).toBe(true);
    expect(expertQuestionBody.safeParse({ body: x(max + 1) }).success).toBe(false);
    expect(h.forum.proposals.expertQuestion(m[4], id, x(max)).body).toHaveLength(max);
    expect(() => h.forum.proposals.expertQuestion(m[5], id, x(max + 1))).toThrow(/en fazla 1000 karakter/);
  });

  it("itiraz ve azınlık raporu: şema sınırı TEXT_LIMITS ile aynı", () => {
    const iri = "fy:Gerekce";
    expect(objectionBody.safeParse({ ground: iri, statement: x(TEXT_LIMITS.objection.max) }).success).toBe(true);
    expect(objectionBody.safeParse({ ground: iri, statement: x(TEXT_LIMITS.objection.max + 1) }).success).toBe(false);
    expect(minorityReportBody.safeParse({ body: x(TEXT_LIMITS.minorityReport.max) }).success).toBe(true);
    expect(minorityReportBody.safeParse({ body: x(TEXT_LIMITS.minorityReport.max + 1) }).success).toBe(false);
  });
});
