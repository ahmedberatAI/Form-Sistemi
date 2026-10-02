// #224: YZ özet/köprü uçları — aynı girdi için kayıt yeniden kullanılır (yeni analiz/defter işlemi yok),
// kullanıcı başına saatlik sınır aşılınca Türkçe 429 döner; sınır kullanıcıya özeldir ve süre dolunca açılır.
import { beforeAll, describe, expect, it } from "vitest";
import { HOUR } from "../../src/core/clock";
import type { AuthUser } from "../../src/core/contracts";
import { AI_ANALYSES_PER_HOUR } from "../../src/forum/proposals";
import { CAT, LONG_BODY, makeForum, toDeliberation, type ForumHarness } from "./harness";

describe("forum: YZ analizi yeniden kullanımı ve kullanıcı başına kota", () => {
  let h: ForumHarness;
  let m: AuthUser[];

  beforeAll(async () => {
    h = await makeForum();
    m = h.users("uye", 40);
  });

  const analyses = (id: string) => h.ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM ai_analyses WHERE target_id = ?", id)!.c;
  const aiTxs = () => h.fake!.txs.filter((t) => t.type === "AI_ANALYSIS").length;

  it("aynı girdi: aynı analiz döner, yeni kayıt/defter işlemi üretilmez ve kota tüketilmez", async () => {
    const id = await toDeliberation(h, m[0], m.slice(1, 6), { kind: "topic", title: "Parka kamelya yapılsın", body: LONG_BODY, categories: [CAT.park] });
    await h.forum.messages.post(m[1], "proposal", id, { body: "Kamelya yaz aylarında işe yarar.", stance: "pro" });
    const first = await h.forum.proposals.aiSummary(m[2], id);
    const txBefore = aiTxs();
    // Aynı kullanıcı ve başka kullanıcı: sınırın çok üstünde istek → hiçbiri 429 değil, hepsi aynı kayıt
    for (let i = 0; i < AI_ANALYSES_PER_HOUR * 3; i++) {
      const again = await h.forum.proposals.aiSummary(i % 2 ? m[2] : m[3], id);
      expect(again.id).toBe(first.id);
    }
    expect(analyses(id)).toBe(1);
    expect(aiTxs()).toBe(txBefore);
    // Girdi değişince (yeni mesaj) yeni analiz üretilir
    await h.forum.messages.post(m[4], "proposal", id, { body: "Bakımı kim yapacak?", stance: "question" });
    const changed = await h.forum.proposals.aiSummary(m[2], id);
    expect(changed.id).not.toBe(first.id);
    expect(analyses(id)).toBe(2);
  });

  it("kullanıcı başına saatlik sınır: aşılınca 429 rate_limited, başka kullanıcı etkilenmez, süre dolunca açılır", async () => {
    const id = await toDeliberation(h, m[10], m.slice(11, 16), { kind: "topic", title: "Okul önüne yaya köprüsü", body: LONG_BODY, categories: [CAT.park] });
    const heavy = m[20];
    // Her istekten önce girdiyi değiştir (yeni mesaj) ki yeniden kullanım devreye girmesin
    let next = 21;
    const fresh = async (user: AuthUser) => {
      await h.forum.messages.post(m[next++], "proposal", id, { body: `Görüş ${next}: köprü güvenlik açısından önemli.`, stance: "pro" });
      return h.forum.proposals.aiSummary(user, id);
    };
    for (let i = 0; i < AI_ANALYSES_PER_HOUR; i++) await fresh(heavy);
    const count = analyses(id);
    expect(count).toBe(AI_ANALYSES_PER_HOUR);
    const txBefore = aiTxs();

    await h.forum.messages.post(m[next++], "proposal", id, { body: "Bir görüş daha.", stance: "con" });
    const err = await h.forum.proposals.aiSummary(heavy, id).catch((e) => e);
    expect(err).toMatchObject({ status: 429, code: "rate_limited" });
    expect(err.message).toMatch(/Saatlik yapay zekâ analizi sınırına/);
    expect(err.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(err.details.retryAfterSeconds).toBeLessThanOrEqual(3600);
    // Reddedilen istek analiz ya da defter işlemi üretmez
    expect(analyses(id)).toBe(count);
    expect(aiTxs()).toBe(txBefore);

    // Başka kullanıcı etkilenmez
    await expect(h.forum.proposals.aiSummary(m[30], id)).resolves.toMatchObject({ task: "summarize" });
    // Denetim kaydı: yalnızca gerçekten üretilen analizler kaydedilir
    const logged = h.ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM audit_log WHERE actor_id = ? AND action = 'ai.analysis_requested'", heavy.id)!.c;
    expect(logged).toBe(AI_ANALYSES_PER_HOUR);

    // Pencere dolunca yeniden açılır
    h.ctx.clock.advance(HOUR + 1000);
    await expect(h.forum.proposals.aiSummary(heavy, id)).resolves.toMatchObject({ task: "summarize" });
  });
});
