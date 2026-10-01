// CommunityService: arama, herkese açık profil, takip, vekâletler, bildirimler, denetim günlüğü, sistem bilgisi, pano, görevler.
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "../../src/core/contracts";
import { CAT, LONG_BODY, makeForum, toDeliberation, type ForumHarness } from "./harness";

describe("forum: topluluk hizmeti", () => {
  let h: ForumHarness;
  let m: AuthUser[];
  let registrar: AuthUser;

  beforeAll(async () => {
    h = await makeForum();
    m = h.users("uye", 6);
    h.user("İlkay");
    h.user("bekleyen", { status: "pending", verifiedAt: null });
    registrar = h.user("memur", { roles: ["registrar"] });
  });

  it("kullanıcı arama: yalnız doğrulanmış; Türkçe harf katlama; LIKE özel karakterleri kaçışlı", () => {
    expect(h.forum.community.searchUsers("uye").map((u) => u.nickname)).toEqual(["uye01", "uye02", "uye03", "uye04", "uye05", "uye06"]);
    expect(h.forum.community.searchUsers("uye", 2)).toHaveLength(2);
    expect(h.forum.community.searchUsers("İLKAY").map((u) => u.nickname)).toEqual(["İlkay"]);
    expect(h.forum.community.searchUsers("bekleyen")).toEqual([]);
    expect(h.forum.community.searchUsers("%")).toEqual([]);
    const u = h.forum.community.searchUsers("uye01")[0];
    expect(u).toMatchObject({ isExpert: false, expertDomains: [], roles: ["member"] });
    expect(u).not.toHaveProperty("clusterId");
  });

  it("herkese açık profil: istatistikler ve görüntüleyen ilişkisi (takip, kefalet, vekâlet, yakınlık)", async () => {
    const [a, b, c] = m;
    h.graph.follow(b.id, a.id);
    h.graph.follow(c.id, a.id);
    h.graph.vouch(b.id, a.id, "close");
    h.graph.vouch(c.id, a.id, "suspicious");
    h.graph.delegate(b.id, a.id, "*", 1);
    h.graph.relate(a.id, b.id, "family");
    await h.forum.proposals.create(a, { kind: "topic", title: "Profil önerisi", body: LONG_BODY, categories: [CAT.park], submit: true });
    await h.forum.proposals.create(a, { kind: "topic", title: "Gizli taslak", body: LONG_BODY, categories: [CAT.park] });

    const anon = h.forum.community.publicProfile(a.id, null);
    expect(anon.stats).toMatchObject({ proposals: 1, enacted: 0, messages: 0, followers: 2, following: 0, vouchedBy: 1, delegatorsCount: 1 });
    expect(anon.viewer).toBeNull();
    expect(anon.recentProposals.map((p) => p.title)).toEqual(["Profil önerisi"]);
    expect(anon).not.toHaveProperty("clusterId");

    const byB = h.forum.community.publicProfile(a.id, b);
    expect(byB.viewer).toMatchObject({ isSelf: false, following: true, vouched: "close", related: ["family"] });
    expect(byB.viewer!.delegations.map((d) => [d.toNickname, d.scope])).toEqual([["uye01", "*"]]);
    const self = h.forum.community.publicProfile(a.id, a);
    expect(self.viewer).toMatchObject({ isSelf: true, following: false, vouched: null, related: [] });
    expect(self.recentProposals).toHaveLength(2);
    expect(self).toHaveProperty("clusterId", null);
    expect(() => h.forum.community.publicProfile("yok", null)).toThrow(/bulunamadı/);

    expect(h.forum.community.following(b.id).map((u) => u.nickname)).toEqual(["uye01"]);
    const me = h.forum.community.me(a.id);
    expect(me.nickname).toBe("uye01");
    expect(me.clusterId).toBeNull();
  });

  it("bildirimler: okunmamış süzgeci ve okundu işareti", async () => {
    const [a] = m;
    h.notifier.notify(a.id, { kind: "test", title: "Bir", body: "Birinci bildirim", link: null });
    h.notifier.notify(a.id, { kind: "test", title: "İki", body: "İkinci bildirim", link: "/konular/x" });
    const before = h.forum.community.notifications(a.id);
    expect(before.items[0]).toMatchObject({ title: "İki", read: false, link: "/konular/x" });
    expect(before.unread).toBeGreaterThan(0);
    const first = before.items[0];
    h.forum.community.markRead(a.id, [first.id]);
    const after = h.forum.community.notifications(a.id, { unreadOnly: true });
    expect(after.unread).toBe(before.unread - 1);
    expect(after.items.some((n) => n.id === first.id)).toBe(false);
    h.forum.community.markRead(a.id);
    expect(h.forum.community.notifications(a.id).unread).toBe(0);
    // Başkasının bildirimini işaretleyemez
    h.forum.community.markRead(m[1].id, [first.id]);
    expect(h.forum.community.notifications(a.id, { limit: 1 }).items).toHaveLength(1);
  });

  it("sistem bilgisi, pano ve görevler", async () => {
    const info = h.forum.community.systemInfo();
    expect(info).toMatchObject({ version: "1.0.0", now: h.ctx.clock.now(), clockOffsetMs: 0, timeScale: 1, aiMode: "offline", bylawVersion: 1 });
    expect(info.members).toEqual({ verified: 8, pending: 1 });
    expect(info.ledger.height).toBeGreaterThan(0);

    const id = await toDeliberation(h, m[3], [m[4], m[5], m[0]], { title: "Pano önerisi", body: LONG_BODY });
    const dash = h.forum.community.dashboard(m[1]);
    expect(dash.counts.sponsoring).toBe(1);
    expect(dash.counts.deliberation).toBe(1);
    expect(dash.counts.draft).toBe(0);
    expect(dash.topics).toBe(0);
    expect(dash.open.map((p) => p.id)).toContain(id);
    expect(dash.members).toEqual({ verified: 8, pending: 1 });
    expect(Array.isArray(dash.permanentLoser)).toBe(true);
    expect(dash.tasks.some((t) => t.kind === "sponsor")).toBe(true);
    expect(h.forum.community.dashboard(null).tasks).toEqual([]);

    const authorTasks = h.forum.community.tasks(m[0]);
    expect(authorTasks.some((t) => t.kind === "author" && t.title.includes("taslağınızı"))).toBe(true);
    expect(h.forum.community.tasks(registrar).find((t) => t.kind === "registrar")).toMatchObject({ title: "1 üye kimlik doğrulaması bekliyor", link: "/kayit-memuru" });
    expect(h.forum.community.tasks(m[1]).some((t) => t.kind === "registrar")).toBe(false);
  });

  it("denetim günlüğü ve vekâlet görünümü", () => {
    h.audit.log(registrar.id, "test.action", "hedef", { a: 1 });
    h.audit.log(null, "sistem.olay");
    const all = h.forum.community.auditLog({});
    expect(all[0]).toMatchObject({ action: "sistem.olay", actorId: null, actorNickname: null });
    const mine = h.forum.community.auditLog({ actorId: registrar.id });
    expect(mine).toEqual([expect.objectContaining({ action: "test.action", actorNickname: "memur", target: "hedef", meta: { a: 1 } })]);
    expect(h.forum.community.auditLog({ action: "test.action", limit: 1 })).toHaveLength(1);

    const d = h.forum.community.delegations(m[0].id);
    expect(d.outgoing).toEqual([]);
    expect(d.incoming.map((x) => x.fromNickname)).toEqual(["uye02"]);
    expect(d.cap).toBe(2);
  });
});
