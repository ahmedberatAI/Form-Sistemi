// YZ tartışma özeti: çevrimdışı sezgisel yalnız gerektiğinde (Claude yok/başarısız ya da azınlık görüşü eksik) çalışır ve
// girdisi en yeni N mesajla sınırlıdır; Claude başarılıysa gereksiz yere tüm mesajlar üzerinde çalıştırılmaz.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAiService } from "../../src/ai";
import type { SummaryInputMessage } from "../../src/core/contracts";
import { makeCtx } from "../helpers/fakes";
import { fakeClient, jsonResponse } from "./fixtures";

const spy = vi.hoisted(() => ({ calls: [] as number[] }));
vi.mock("../../src/ai/heuristics", async (importActual) => {
  const actual = await importActual<typeof import("../../src/ai/heuristics")>();
  return {
    ...actual,
    offlineSummarize: (input: Parameters<typeof actual.offlineSummarize>[0]) => {
      spy.calls.push(input.messages.length);
      return actual.offlineSummarize(input);
    },
  };
});

const messages = (n: number): SummaryInputMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `m-${i}`,
    pseudonym: `K${(i % 7) + 1}`,
    clusterId: i % 2 ? "g0" : "g1",
    stance: i % 3 === 0 ? "pro" : i % 3 === 1 ? "con" : "question",
    body: `Otobüs seferleri ve park alanı hakkında ${i}. görüş: sulama maliyeti, gürültü ve güvenlik konuları.`,
  }));

const claudeOk = {
  commonGround: [{ text: "Ortak.", cites: ["m1"] }],
  contested: [],
  minorityViews: [{ text: "Azınlık.", cites: ["m2"] }],
  openQuestions: [],
};

describe("YZ özeti: çevrimdışı sezgisel tembel ve sınırlı", () => {
  beforeEach(() => {
    spy.calls.length = 0;
  });

  it("Claude başarılıysa ve azınlık görüşü verdiyse çevrimdışı özet hiç hesaplanmaz", async () => {
    const { client } = fakeClient(() => jsonResponse(claudeOk));
    const s = await createAiService(makeCtx(), { client }).summarize({ topicTitle: "Konu", messages: messages(50) });
    expect(s.offline).toBe(false);
    expect(spy.calls).toEqual([]);
  });

  it("Claude azınlık bölümünü boş bırakırsa çevrimdışı özet tek kez hesaplanır", async () => {
    const { client } = fakeClient(() => jsonResponse({ ...claudeOk, minorityViews: [] }));
    const s = await createAiService(makeCtx(), { client }).summarize({ topicTitle: "Konu", messages: messages(50) });
    expect(s.offline).toBe(false);
    expect(spy.calls).toEqual([50]);
  });

  it("istemci yokken çevrimdışı özet en yeni 400 mesajla sınırlıdır; kapsama tüm mesajlara göre hesaplanır", async () => {
    const all = messages(900);
    const s = await createAiService(makeCtx(), { client: null }).summarize({ topicTitle: "Konu", messages: all });
    expect(s.offline).toBe(true);
    expect(spy.calls).toEqual([400]);
    const newest = new Set(all.slice(-400).map((m) => m.id));
    const cited = [...s.commonGround, ...s.contested, ...s.minorityViews, ...s.openQuestions].flatMap((p) => p.cites);
    expect(cited.every((id) => newest.has(id))).toBe(true);
    expect(s.coverage).toBeLessThanOrEqual(1);
    expect(s.coverage).toBeLessThanOrEqual(new Set(cited).size / 900 + 0.001);
  });

  it("Claude başarısızsa da çevrimdışı özet çalışır; boş girdide çökmez", async () => {
    const { client } = fakeClient(() => ({ ...jsonResponse({}), stop_reason: "refusal" }));
    const ai = createAiService(makeCtx(), { client });
    expect((await ai.summarize({ topicTitle: "Konu", messages: messages(10) })).offline).toBe(true);
    expect(spy.calls).toEqual([10]);
    expect((await ai.summarize({ topicTitle: "Konu", messages: [] })).offline).toBe(true);
  });

  it("çevrimdışı sezgisel 400 mesajda hızlı biter (ikinci dereceden kopyalama yok)", async () => {
    const t0 = performance.now();
    await createAiService(makeCtx(), { client: null }).summarize({ topicTitle: "Konu", messages: messages(1600) });
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
