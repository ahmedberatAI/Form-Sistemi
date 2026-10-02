// Regresyon: yürürlük etkisi hatası (#4/#279/#201) ve adım hatalarının izlenmesi (#195).
//  - iç içe core.tx geri alınınca kuyruğa alınmış bildirim/defter kaydı iletilmez;
//  - ham istisna iletisi kapanış nedenine, phase_events'e, bildirime ve herkese açık deftere sızmaz (yalnız log + denetim günlüğü);
//  - bozuk bir satır için adım hatası sayılır, üstel geri çekilmeyle yeniden denenir, denetim günlüğüne yazılır, tick sonucu bildirir.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fy } from "@forum/shared";
import type { AuthUser } from "../../src/core/contracts";
import { failedProposalIds, STEP_BACKOFF_CAP_MS, stepBackoffMs } from "../../src/forum/lifecycle";
import { tickUntilSettled } from "../../src/http/routes/admin";
import type { AppServices } from "../../src/http/types";
import { closeVoting, insertTopic, makeForum, toDeliberation, toVoting, type ForumHarness } from "./harness";

afterEach(() => vi.restoreAllMocks());

const RAW = "UNIQUE constraint failed: message_versions.message_id, message_versions.version";

describe("yürürlük etkisi hatası: geri alınan iç işlemin yan etkileri iletilmez, ham hata yayımlanmaz", () => {
  let h: ForumHarness;
  let m: AuthUser[];
  let target: AuthUser;

  beforeAll(async () => {
    h = await makeForum();
    m = h.users("uye", 28);
    target = h.user("hedef");
  });

  it("2 mesajlı silme: 2. mesajda etki hatası → 1. mesajın bildirimi/defter kaydı atılır; neden genel + hata kodu", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const topicId = insertTopic(h, "Mahalle parkı");
    const m1 = await h.forum.messages.post(target, "topic", topicId, { body: "Yarın toplantıda herkesi bekliyorum, gelmeyen pişman olur!", stance: "neutral" });
    const m2 = await h.forum.messages.post(target, "topic", topicId, { body: "Toplantıya gelmeyenlerin kapısını tek tek çalacağım, ona göre davranın.", stance: "con" });
    const d = await h.forum.proposals.create(m[0], {
      kind: "deletion",
      title: "",
      body: "",
      categories: [],
      deletion: { messageIds: [m1.id, m2.id], ground: fy("Tehdit"), statement: "Bu iki mesaj açık biçimde tehdit içeriyor." },
      submit: true,
    });
    await h.forum.proposals.sponsor(m[1], d.id);
    await toVoting(h, d.id);
    for (let i = 0; i < 25; i++) await h.forum.proposals.vote(m[i], d.id, i < 20 ? "yes" : "no");

    // enact() deseni: etki iç core.tx içinde; ilk mesaj gizlenip (UPDATE + MESSAGE_HIDDEN + bildirim) sonra ham SQLite hatası fırlar.
    const orig = h.forum.messages.hide.bind(h.forum.messages);
    vi.spyOn(h.forum.messages, "hide").mockImplementation((ids, proposalId, ground, sealed) => {
      orig(ids.slice(0, 1), proposalId, ground, sealed);
      throw new Error(RAW);
    });
    const t = await closeVoting(h, d.id);
    expect(t.map((x) => [x.from, x.to])).toEqual([["voting", "rejected"]]);

    // DB geri alındı: mesajlar gizlenmedi (acil daraltma de kalktı)
    expect(h.forum.messages.get(m1.id, null).visibility).toBe("visible");
    expect(h.forum.messages.get(m2.id, null).visibility).toBe("visible");
    // Geri alınan iç işlemin yan etkileri iletilmedi
    expect(h.ledger.findTxs({ type: "MESSAGE_HIDDEN" })).toHaveLength(0);
    expect(h.forum.community.notifications(target.id).items.some((n) => n.kind === "message_hidden")).toBe(false);

    // Neden: genel + hata kodu; ham iç ileti hiçbir yerde yok
    const row = h.ctx.db.get<{ final_reason: string }>("SELECT final_reason FROM proposals WHERE id = ?", d.id)!;
    expect(row.final_reason).toContain("Yürürlük etkisi uygulanamadı");
    expect(row.final_reason).toContain("hata kodu: internal_error");
    const where = [
      row.final_reason,
      JSON.stringify(h.ctx.db.all("SELECT reason FROM phase_events WHERE proposal_id = ?", d.id)),
      JSON.stringify(h.forum.proposals.get(d.id, null).events),
      JSON.stringify(h.ledger.findTxs({ type: "PHASE_CHANGED", proposalId: d.id })),
      JSON.stringify(h.forum.community.notifications(m[0].id).items),
    ];
    for (const text of where) {
      expect(text).not.toContain("UNIQUE");
      expect(text).not.toContain("message_versions");
    }
    expect(JSON.stringify(h.ledger.findTxs({ type: "PHASE_CHANGED", proposalId: d.id }))).toContain("hata kodu: internal_error");

    // Ham ileti yalnızca denetim günlüğünde (kod ile)
    const audit = h.ctx.db.get<{ target: string; meta: string }>("SELECT target, meta FROM audit_log WHERE action = 'system.enactment_failed'")!;
    expect(audit.target).toBe(d.id);
    expect(JSON.parse(audit.meta)).toMatchObject({ code: "internal_error", error: RAW });
  }, 60_000);
});

describe("yaşam döngüsü adım hatası: sayaç, üstel geri çekilme, denetim kaydı, tick sonucu", () => {
  it("bozuk params satırı: hata görünür; geri çekilmede yeniden denenmez; 5. hatada tekrar denetim; onarım sonrası ilerler", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = await makeForum();
    try {
      const members = h.users("uye", 30);
      const id = await toDeliberation(h, members[0], members.slice(1));
      await toVoting(h, id);
      expect(h.forum.proposals.get(id, null).status).toBe("voting");
      const original = h.ctx.db.get<{ params: string }>("SELECT params FROM proposals WHERE id = ?", id)!.params;
      h.ctx.db.run("UPDATE proposals SET params = ? WHERE id = ?", "{bozuk json", id);
      const rows = () => h.ctx.db.all<{ target: string; meta: string }>("SELECT target, meta FROM audit_log WHERE action = 'system.lifecycle_error' ORDER BY rowid");

      // 1. hata: oylama süresi doldu ama sayım hesaplanamadı
      const t1 = await h.advance(80);
      expect(t1).toEqual([]);
      expect(failedProposalIds(t1)).toEqual([id]);
      expect(h.forum.proposals.get(id, null).status).toBe("voting");
      expect(rows()).toHaveLength(1);
      expect(rows()[0].target).toBe(id);
      expect(JSON.parse(rows()[0].meta)).toMatchObject({ attempts: 1, code: "internal_error" });
      const logged = errSpy.mock.calls.length;

      // Geri çekilme penceresinde (saat ilerlemeden) yeniden denenmez: ek günlük/denetim yok, ama hâlâ "başarısız" raporlanır
      const t2 = await h.tick();
      expect(failedProposalIds(t2)).toEqual([id]);
      expect(errSpy.mock.calls.length).toBe(logged);
      expect(rows()).toHaveLength(1);
      // Yönetim ucu aynı bilgiyi yanıtta döner
      const res = await tickUntilSettled({ forum: h.forum, clock: h.ctx.clock } as unknown as AppServices);
      expect(res.transitions).toEqual([]);
      expect(res.failed).toEqual([id]);

      // Pencere dolunca yeniden denenir (2. hata): günlük artar, denetim kaydı hâlâ 1
      h.ctx.clock.advance(stepBackoffMs(1) + 1);
      await h.tick();
      expect(errSpy.mock.calls.length).toBeGreaterThan(logged);
      expect(rows()).toHaveLength(1);
      // Üstel artış tavanla sınırlı
      expect(stepBackoffMs(2)).toBe(2 * stepBackoffMs(1));
      expect(stepBackoffMs(60)).toBe(STEP_BACKOFF_CAP_MS);

      // 3., 4., 5. hata: 5. ardışık hatada ikinci denetim kaydı
      for (let n = 2; n <= 4; n++) {
        h.ctx.clock.advance(stepBackoffMs(n) + 1);
        await h.tick();
      }
      expect(rows()).toHaveLength(2);
      expect(JSON.parse(rows()[1].meta)).toMatchObject({ attempts: 5 });

      // Onarım: sonraki deneme ilerler, hata kaydı temizlenir
      h.ctx.db.run("UPDATE proposals SET params = ? WHERE id = ?", original, id);
      h.ctx.clock.advance(STEP_BACKOFF_CAP_MS + 1);
      const ok = await h.tick();
      expect(ok.map((x) => x.proposalId)).toContain(id); // sayım artık hesaplanır (katılım yok → oylama uzatıldı)
      expect(failedProposalIds(ok)).toEqual([]);
      const res2 = await tickUntilSettled({ forum: h.forum, clock: h.ctx.clock } as unknown as AppServices);
      expect(res2.failed).toBeUndefined();
    } finally {
      await h.close();
    }
  }, 120_000);
});
