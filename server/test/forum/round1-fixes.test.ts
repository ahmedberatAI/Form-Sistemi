// Tur 1 forum düzeltmeleri:
//  - personel yetkisi (R, D, A) yalnız doğrulanmış hesapta: bekleyen hesaba (eski veride) denetçi rolü verilmiş olsa bile gizli
//    mesajın sürümleri/metni okunamaz (403, details.reason "inactive"); kayıt memuru görevi de gösterilmez;
//  - ana sayfa panosu ağır graf istatistiğini (Louvain, aracı, sybil) çalıştırmaz;
//  - yaşam döngüsü tick'i olay döngüsüne yol verir ve süre bütçesiyle kalan önerileri sonraki tick'e bırakır.
import { afterEach, describe, expect, it, vi } from "vitest";
import { tickDeferred, TICK_SLICE_MS } from "../../src/forum/lifecycle";
import { HOUR } from "../../src/core/clock";
import { insertTopic, LONG_BODY, makeForum, toDeliberation, type ForumHarness } from "./harness";

let h: ForumHarness | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await h?.close();
  h = null;
});

describe("personel yetkisi yalnız doğrulanmış hesapta", () => {
  it("bekleyen hesaptaki denetçi rolü gizli mesajın sürümlerini ve metnini okuyamaz (403 inactive); doğrulanmış denetçi okur", async () => {
    h = await makeForum();
    const author = h.user("yazar");
    const pendingAuditor = h.user("bekleyen_denetci", { roles: ["auditor"], status: "pending" });
    const suspendedAdmin = h.user("askidaki_yonetici", { roles: ["admin"], status: "suspended" });
    const auditor = h.user("denetci", { roles: ["auditor"] });
    const topicId = insertTopic(h, "Bisiklet yolu");
    const msg = await h.forum.messages.post(author, "topic", topicId, { body: "Bu bisiklet yolu önerisini savunanlar yanılıyor bence.", stance: "con" });
    h.ctx.db.run("UPDATE messages SET visibility = 'hidden' WHERE id = ?", msg.id);

    const errorOf = (fn: () => unknown): { status?: number; details?: { reason?: string } } | null => {
      try {
        fn();
      } catch (e) {
        return e as { status?: number; details?: { reason?: string } };
      }
      return null;
    };
    for (const actor of [pendingAuditor, suspendedAdmin]) {
      for (const read of [() => h!.forum.messages.versions(actor, msg.id), () => h!.forum.messages.readHidden(actor, msg.id)]) {
        const err = errorOf(read);
        expect(err?.status).toBe(403);
        expect(err?.details?.reason).toBe("inactive");
      }
    }
    expect(h.ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM hidden_access_log WHERE message_id = ?", msg.id)!.c).toBe(0);
    expect(h.forum.messages.versions(auditor, msg.id).map((v) => v.body)).toEqual(["Bu bisiklet yolu önerisini savunanlar yanılıyor bence."]);
    expect(h.forum.messages.readHidden(auditor, msg.id).accessLogged).toBe(true);
  });

  it("bekleyen hesaptaki kayıt memuru rolü 'doğrulama bekliyor' görevini görmez", async () => {
    h = await makeForum();
    h.user("basvuran", { status: "pending" });
    const pendingRegistrar = h.user("bekleyen_kayit", { roles: ["registrar"], status: "pending" });
    const registrar = h.user("kayit", { roles: ["registrar"] });
    expect(h.forum.community.tasks(registrar).some((t) => t.kind === "registrar")).toBe(true);
    expect(h.forum.community.tasks(pendingRegistrar).some((t) => t.kind === "registrar")).toBe(false);
  });
});

describe("ana sayfa panosu", () => {
  it("graph.stats() (uzlaşı/aracı/sybil) çağrılmaz; kalıcı kaybeden göstergesi stats() ile aynıdır", async () => {
    h = await makeForum();
    const statsSpy = vi.spyOn(h.graph, "stats");
    const d = h.forum.community.dashboard(null);
    expect(statsSpy).not.toHaveBeenCalled();
    statsSpy.mockRestore();
    expect(d.permanentLoser.map((x) => x.clusterId)).toEqual(h.graph.stats().permanentLoser.map((x) => x.clusterId));
  });
});

describe("yaşam döngüsü: toplu geçişler olay döngüsünü kilitlemez", () => {
  async function dueProposals(hh: ForumHarness, n: number): Promise<string[]> {
    const m = hh.users("uye", 12);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      ids.push(await toDeliberation(hh, m[i], m.filter((_, j) => j !== i), { title: `Toplu geçiş önerisi ${i + 1}`, body: `${LONG_BODY} (${i + 1})` }));
    }
    const ends = Math.max(...ids.map((id) => hh.forum.proposals.get(id, null).phaseEndsAt!));
    hh.ctx.clock.advance(ends - hh.ctx.clock.now() + HOUR);
    await hh.flush();
    return ids;
  }

  it("süre bütçesi dolunca kalan öneriler sonraki tick'e kalır (en az biri işlenir; sonuç tickDeferred)", async () => {
    h = await makeForum();
    const ids = await dueProposals(h, 3);
    const first = await h.forum.lifecycle.tick({ budgetMs: 0 });
    expect(tickDeferred(first)).toBe(true);
    expect(new Set(first.map((t) => t.proposalId)).size).toBe(1);
    const rest = await h.forum.lifecycle.tick();
    expect(tickDeferred(rest)).toBe(false);
    for (const id of ids) expect(h.forum.proposals.get(id, null).status).toBe("voting");
  });

  it(`öneriler arasında olay döngüsüne yol verilir (dilim ${TICK_SLICE_MS} ms dolunca)`, async () => {
    h = await makeForum();
    const ids = await dueProposals(h, 3);
    let ran = false;
    setImmediate(() => {
      ran = true;
    });
    // Her ölçümde 20 ms geçmiş gibi: dilim her öneride dolar → her öneriden önce olay döngüsüne yol verilmeli.
    let fake = performance.now();
    vi.spyOn(performance, "now").mockImplementation(() => (fake += 20));
    const ts = await h.forum.lifecycle.tick();
    vi.restoreAllMocks();
    expect(ran).toBe(true);
    expect(tickDeferred(ts)).toBe(false);
    for (const id of ids) expect(h.forum.proposals.get(id, null).status).toBe("voting");
  });
});
