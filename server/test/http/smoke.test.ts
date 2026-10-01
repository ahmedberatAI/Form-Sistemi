// Gerçek servislerle her uç noktaya en az bir istek: beklenen durum kodu ve yanıt biçimi (500 yok).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  fy,
  type AdminUserRow,
  type AuditLogEntry,
  type ClusterSnapshotView,
  type Dashboard,
  type DelegationView,
  type ExpertInfo,
  type GraphStats,
  type LedgerStatus,
  type Me,
  type MessageView,
  type MyDelegations,
  type NotificationList,
  type ProposalDetail,
  type PublicProfile,
  type PublicUser,
} from "@forum/shared";
import { HOUR } from "../../src/core/clock";
import { boot, PASSWORD, type Harness } from "./harness";

const TIMEOUT = 120_000;

describe("uç nokta duman testi (gerçek servisler)", () => {
  let h: Harness;
  let admin: { token: string; user: Me };
  let auditor: { token: string; user: Me };
  let a: { token: string; user: Me };
  let b: { token: string; user: Me };
  let c: { token: string; user: Me };
  let proposal: ProposalDetail;
  let message: MessageView;

  beforeAll(async () => {
    h = await boot();
    admin = await h.staff("yonetici", ["admin"]);
    auditor = await h.staff("denetci", ["auditor"]);
    a = await h.member("ali");
    b = await h.member("berna");
    c = await h.member("cem", { aiConsent: true });
    h.clock.advance(HOUR);
    proposal = await h.ok<ProposalDetail>("POST", "/api/proposals", {
      token: a.token,
      body: { kind: "topic", title: "Sokak lambalarının yenilenmesi", body: "Mahalledeki eski sokak lambaları tasarruflu modellerle değiştirilsin.", categories: [fy("YesilAlan")], submit: true },
    });
    message = await h.ok<MessageView>("POST", `/api/threads/proposal/${proposal.id}`, { token: b.token, body: { body: "Bu öneriye katılıyorum.", stance: "pro" } });
  }, TIMEOUT);
  afterAll(async () => {
    await h?.close();
  });

  it("sistem ve pano", async () => {
    const d = await h.ok<Dashboard>("GET", "/api/dashboard", { token: a.token });
    expect(d.counts.sponsoring).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(d.tasks)).toBe(true);
    expect((await h.ok<Dashboard>("GET", "/api/dashboard")).tasks).toEqual([]);
  });

  it("hesap uçları", async () => {
    const me = await h.ok<Me>("GET", "/api/me", { token: c.token });
    expect(me.aiConsent).toBe(true);
    expect((await h.ok<Me>("PATCH", "/api/me/consents", { token: c.token, body: { aiConsent: false } })).aiConsent).toBe(false);
    const exp = await h.ok<Record<string, unknown>>("GET", "/api/me/export", { token: c.token });
    expect(JSON.stringify(exp)).toContain("Deneme");

    const del = await h.ok<DelegationView>("POST", "/api/me/delegations", { token: b.token, body: { to: c.user.id, scope: "fy:Ulasim", rank: 1 } });
    expect(del.scope).toBe(fy("Ulasim"));
    const mine = await h.ok<MyDelegations>("GET", "/api/me/delegations", { token: b.token });
    expect(mine.outgoing.map((d) => d.id)).toContain(del.id);
    expect((await h.ok<MyDelegations>("GET", "/api/me/delegations", { token: c.token })).incoming.map((d) => d.id)).toContain(del.id);
    expect(await h.ok("DELETE", `/api/me/delegations/${del.id}`, { token: b.token })).toEqual({ ok: true });
    expect((await h.ok<MyDelegations>("GET", "/api/me/delegations", { token: b.token })).outgoing).toEqual([]);
    expect((await h.req("POST", "/api/me/delegations", { token: b.token, body: { to: c.user.id, scope: "fy:YokBoyleKategori", rank: 1 } })).statusCode).toBe(400);

    await h.ok("POST", `/api/users/${c.user.id}/follow`, { token: b.token });
    expect((await h.ok<PublicUser[]>("GET", "/api/me/following", { token: b.token })).map((u) => u.id)).toEqual([c.user.id]);
    const notes = await h.ok<NotificationList>("GET", "/api/me/notifications", { token: a.token });
    expect(typeof notes.unread).toBe("number");
    expect((await h.ok<NotificationList>("GET", "/api/me/notifications?unread=1", { token: a.token })).items.every((n) => !n.read)).toBe(true);
    expect(await h.ok("POST", "/api/me/notifications/read", { token: a.token, body: {} })).toEqual({ ok: true });
    expect((await h.ok<NotificationList>("GET", "/api/me/notifications", { token: a.token })).unread).toBe(0);
    expect(Array.isArray(await h.ok("GET", "/api/me/tasks", { token: b.token }))).toBe(true);
    expect((await h.req("GET", "/api/me/assignments", { token: b.token })).statusCode).toBe(403);

    // Şifre değişikliği mevcut oturumu korur; çıkış belirteci geçersiz kılar.
    const tmp = await h.member("sifreci");
    expect(await h.ok("POST", "/api/me/password", { token: tmp.token, body: { oldPassword: PASSWORD, newPassword: "Yeni-Sifre-2027" } })).toEqual({ ok: true });
    expect((await h.req("GET", "/api/me", { token: tmp.token })).statusCode).toBe(200);
    expect((await h.req("POST", "/api/me/password", { token: tmp.token, body: { oldPassword: "yanlis-1", newPassword: "Yeni-Sifre-2028" } })).json().error.code).toBe("wrong_password");
    expect(await h.ok("POST", "/api/auth/logout", { token: tmp.token })).toEqual({ ok: true });
    expect((await h.req("GET", "/api/me", { token: tmp.token })).statusCode).toBe(401);
  }, TIMEOUT);

  it("kullanıcılar ve graf ilişkileri", async () => {
    expect((await h.ok<PublicUser[]>("GET", "/api/users?q=ber&limit=5")).map((u) => u.nickname)).toContain("berna");
    const prof = await h.ok<PublicProfile>("GET", `/api/users/${c.user.id}`, { token: b.token });
    expect(prof.viewer?.following).toBe(true);
    expect((await h.ok<PublicProfile>("GET", `/api/users/${c.user.id}`)).viewer).toBeNull();
    expect((await h.ok<PublicProfile>("DELETE", `/api/users/${c.user.id}/follow`, { token: b.token })).viewer?.following).toBe(false);
    expect((await h.ok<PublicProfile>("POST", `/api/users/${c.user.id}/vouch`, { token: b.token, body: { level: "known" } })).viewer?.vouched).toBe("known");
    expect((await h.ok<PublicProfile>("POST", `/api/users/${c.user.id}/relate`, { token: b.token, body: { kind: "family" } })).viewer?.related).toContain("family");
    expect((await h.req("POST", `/api/users/${b.user.id}/follow`, { token: b.token })).statusCode).toBe(400);
    expect((await h.req("GET", "/api/users/olmayan")).statusCode).toBe(404);

    // RELATED_TO (aile/iş/hane) herkese açık grafta görünmez; denetçiye görünür.
    const pub = await h.ok<{ edges: { type: string }[] }>("GET", "/api/graph?types=VOUCHES,RELATED_TO");
    expect(pub.edges.some((e) => e.type === "RELATED_TO")).toBe(false);
    expect(pub.edges.some((e) => e.type === "VOUCHES")).toBe(true);
    const priv = await h.ok<{ edges: { type: string }[] }>("GET", "/api/graph?types=VOUCHES,RELATED_TO", { token: auditor.token });
    expect(priv.edges.some((e) => e.type === "RELATED_TO")).toBe(true);
    expect(typeof (await h.ok<GraphStats>("GET", "/api/graph/stats")).nodes).toBe("number");
  }, TIMEOUT);

  it("yönetim ve kümeler", async () => {
    const users = await h.ok<AdminUserRow[]>("GET", "/api/admin/users", { token: admin.token });
    expect(users.length).toBeGreaterThanOrEqual(5);
    const me = await h.ok<Me>("PUT", `/api/admin/users/${b.user.id}/roles`, { token: admin.token, body: { roles: ["member", "auditor"] } });
    expect(me.roles).toContain("auditor");
    await h.ok("PUT", `/api/admin/users/${b.user.id}/roles`, { token: admin.token, body: { roles: ["member"] } });
    const log = await h.ok<AuditLogEntry[]>("GET", "/api/admin/audit-log?limit=50", { token: auditor.token });
    expect(log.length).toBeGreaterThan(0);
    expect((await h.req("GET", "/api/admin/audit-log", { token: a.token })).statusCode).toBe(403);
    const snap = await h.ok<ClusterSnapshotView>("POST", "/api/admin/clusters/recompute", { token: admin.token });
    expect(snap.id).toBeTruthy();
    expect((await h.ok<ClusterSnapshotView | null>("GET", "/api/clusters/latest"))?.id).toBe(snap.id);
    expect((await h.ok<ClusterSnapshotView>("GET", `/api/clusters/${snap.id}`)).id).toBe(snap.id);
    expect((await h.req("GET", "/api/clusters/olmayan")).statusCode).toBe(404);
    expect((await h.ok<{ transitions: unknown[] }>("POST", "/api/admin/tick", { token: admin.token })).transitions).toBeDefined();
  }, TIMEOUT);

  it("ontoloji", async () => {
    expect((await h.ok<unknown[]>("GET", "/api/ontology/versions")).length).toBeGreaterThanOrEqual(1);
    const rep = await h.ok<{ admissible: boolean }>("POST", "/api/ontology/validate-patch", {
      token: a.token,
      body: { patch: { ops: [{ op: "amendArticleText", article: "fy:YokMadde", text: "Yeni metin" }], rationale: "Deneme" } },
    });
    expect(rep.admissible).toBe(false);
    expect((await h.req("GET", "/api/ontology/turtle?version=999")).statusCode).toBe(404);
  });

  it("öneri uçları", async () => {
    const pc = await h.ok<{ audit: unknown; classification: { aiLabel: string } }>("POST", "/api/proposals/precheck", {
      token: a.token,
      body: { kind: "topic", title: "Parka bank konulsun", body: "Parkın girişine iki bank konulsun.", categories: [fy("YesilAlan")] },
    });
    expect(pc.classification.aiLabel).toMatch(/^Yapay zekâ ile üretildi/);
    expect((await h.ok<unknown[]>("GET", "/api/proposals?status=open&limit=10")).length).toBeGreaterThanOrEqual(1);
    expect((await h.ok<{ id: string }[]>("GET", "/api/proposals?mine=1", { token: a.token })).map((p) => p.id)).toContain(proposal.id);
    expect((await h.req("GET", "/api/proposals?mine=1")).statusCode).toBe(401);

    const draft = await h.ok<ProposalDetail>("POST", "/api/proposals", {
      token: a.token,
      body: { kind: "topic", title: "Taslak öneri", body: "Taslak metin burada.", categories: [fy("YesilAlan")] },
    });
    expect(draft.status).toBe("draft");
    expect((await h.ok<ProposalDetail>("PATCH", `/api/proposals/${draft.id}`, { token: a.token, body: { title: "Taslak öneri (2)", body: "Güncellenmiş taslak metni burada yer alıyor." } })).version).toBe(2);
    // Taslak yalnız yazarına görünür: başkası için 404 (ya da 403).
    expect([403, 404]).toContain((await h.req("PATCH", `/api/proposals/${draft.id}`, { token: b.token, body: { title: "Başkasının düzenlemesi", body: "Başkası bu taslağı düzenlemeye çalışıyor." } })).statusCode);
    expect((await h.ok<ProposalDetail>("POST", `/api/proposals/${draft.id}/submit`, { token: a.token })).status).toBe("sponsoring");
    expect((await h.ok<ProposalDetail>("POST", `/api/proposals/${draft.id}/withdraw`, { token: a.token })).status).toBe("withdrawn");

    for (const v of [b, c]) await h.ok("POST", `/api/proposals/${proposal.id}/sponsor`, { token: v.token });
    await h.ok("POST", "/api/admin/tick", { token: admin.token });
    const p = await h.ok<ProposalDetail>("GET", `/api/proposals/${proposal.id}`);
    expect(p.status).toBe("deliberation");

    const sug = await h.ok<{ id: string; status: string }>("POST", `/api/proposals/${proposal.id}/suggestions`, { token: b.token, body: { body: "Lambalar LED olsun." } });
    expect(sug.status).toBe("open");
    expect((await h.ok<ProposalDetail>("POST", `/api/proposals/${proposal.id}/suggestions/${sug.id}/decide`, { token: a.token, body: { decision: "reject" } })).suggestions.find((s) => s.id === sug.id)?.status).toBe("rejected");
    const flagged = await h.ok<ProposalDetail>("POST", `/api/proposals/${proposal.id}/rights-flags`, { token: c.token, body: { right: "fy:ErisimHakki", direction: "restrict" } });
    expect(flagged.id).toBe(proposal.id);
    const q = await h.ok<{ id: string }>("POST", `/api/proposals/${proposal.id}/expert-questions`, { token: b.token, body: { body: "Maliyet ne kadar olur?" } });
    expect(q.id).toBeTruthy();
    const er = await h.req("POST", `/api/proposals/${proposal.id}/expert-request`, { token: a.token, body: { kind: "panel" } });
    expect(er.statusCode).toBe(200);
    const sum = await h.ok<{ label: string; offline: boolean }>("POST", `/api/proposals/${proposal.id}/ai/summary`, { token: b.token });
    expect(sum.label).toMatch(/^Yapay zekâ ile üretildi/);
    const bridging = await h.req("POST", `/api/proposals/${proposal.id}/ai/bridging`, { token: b.token });
    expect(bridging.statusCode).toBe(409); // yalnız uzlaşma turunda
    const approve = await h.req("POST", `/api/ai/analyses/${(sum as unknown as { id: string }).id}/approve`, { token: a.token, body: {} });
    expect(approve.statusCode).toBe(200);
    expect((await h.ok<{ voters: unknown[] }>("GET", `/api/proposals/${proposal.id}/voters`)).voters).toBeDefined();
    expect((await h.req("POST", `/api/proposals/${proposal.id}/vote`, { token: b.token, body: { choice: "yes" } })).statusCode).toBe(409);
    expect((await h.req("POST", `/api/proposals/${proposal.id}/objections`, { token: b.token, body: { ground: "fy:UsulHatasi", statement: "Usul hatası" } })).statusCode).toBe(409);
    expect((await h.req("POST", `/api/proposals/${proposal.id}/minority-reports`, { token: b.token, body: { body: "Azınlık görüşü" } })).statusCode).toBe(409);
  }, TIMEOUT);

  it("tartışma uçları", async () => {
    const pre = await h.ok<{ pii: unknown[]; aiLabel: string }>("POST", "/api/messages/precheck", { token: a.token, body: { body: "TC kimlik numaram 10000000146" } });
    expect(pre.pii.length).toBeGreaterThan(0);
    expect((await h.ok<MessageView>("GET", `/api/messages/${message.id}`)).id).toBe(message.id);
    expect((await h.ok<MessageView>("PATCH", `/api/messages/${message.id}`, { token: b.token, body: { body: "Bu öneriye kesinlikle katılıyorum." } })).version).toBe(2);
    expect((await h.req("PATCH", `/api/messages/${message.id}`, { token: a.token, body: { body: "başkası" } })).statusCode).toBe(403);
    expect((await h.ok<unknown[]>("GET", `/api/messages/${message.id}/versions`)).length).toBe(2);
    expect((await h.ok<MessageView>("POST", `/api/messages/${message.id}/endorse`, { token: c.token, body: { value: 1 } })).endorsements.agree).toBe(1);
    expect((await h.req("POST", `/api/messages/${message.id}/rebuttal`, { token: b.token, body: { body: "cevap" } })).statusCode).toBe(409);
    expect((await h.req("GET", `/api/messages/${message.id}/hidden`, { token: a.token })).statusCode).toBe(403);
    expect((await h.req("GET", `/api/messages/${message.id}/hidden`, { token: auditor.token })).statusCode).toBe(409); // gizlenmemiş mesaj
    const topics = await h.ok<{ id: string }[]>("GET", "/api/topics");
    expect(Array.isArray(topics)).toBe(true);
    expect((await h.req("GET", "/api/topics/olmayan")).statusCode).toBe(404);
  }, TIMEOUT);

  it("bilirkişi uçları", async () => {
    const applied = await h.ok<ExpertInfo>("POST", "/api/experts/apply", { token: c.token, body: { domains: ["fy:YesilAlan"], credentials: "Peyzaj mimarı, 10 yıl deneyim" } });
    expect(applied.status).toBe("applied");
    expect((await h.req("POST", `/api/experts/${c.user.id}/decide`, { token: a.token, body: { decision: "approve" } })).statusCode).toBe(403);
    expect((await h.ok<ExpertInfo>("POST", `/api/experts/${c.user.id}/decide`, { token: admin.token, body: { decision: "approve" } })).status).toBe("active");
    expect((await h.ok<ExpertInfo[]>("GET", "/api/experts?status=active")).map((e) => e.userId)).toContain(c.user.id);
    expect((await h.ok<unknown[]>("GET", "/api/me/assignments", { token: c.token })).length).toBeGreaterThanOrEqual(0);
    expect((await h.req("POST", "/api/experts/assignments/olmayan/respond", { token: c.token, body: { decision: "accept" } })).statusCode).toBe(404);
    expect((await h.req("POST", "/api/experts/assignments/olmayan/report", { token: c.token, body: { assessment: "feasible", confidence: 0.9, risks: [], answers: [], body: "Rapor" } })).statusCode).toBe(404);
    const lint = await h.ok<{ issues: unknown[]; aiLabel: string; offline: boolean }>("POST", "/api/experts/lint", { token: c.token, body: { text: "Bu eylem açıkça suçtur ve hukuka aykırıdır." } });
    expect(lint.offline).toBe(true);
    expect(lint.aiLabel).toMatch(/^Yapay zekâ ile üretildi/);
    expect((await h.ok<ExpertInfo>("POST", `/api/experts/${c.user.id}/sanction`, { token: admin.token, body: { action: "warn", note: "Uyarı" } })).userId).toBe(c.user.id);
  }, TIMEOUT);

  it("defter uçları", async () => {
    await h.services.ledger.flush();
    const st = await h.ok<LedgerStatus>("GET", "/api/ledger/status");
    expect(st.validators.length).toBeGreaterThanOrEqual(4);
    const node = st.validators[1].id;
    const txs = await h.ok<{ hash: string; height: number }[]>("GET", "/api/ledger/txs?type=PROPOSAL_CREATED&limit=5");
    expect(txs.length).toBeGreaterThan(0);
    expect((await h.ok<{ hash: string }>("GET", `/api/ledger/txs/${txs[0].hash}`)).hash).toBe(txs[0].hash);
    expect((await h.req("GET", `/api/ledger/txs/${"0".repeat(64)}`)).statusCode).toBe(404);
    expect((await h.ok<{ height: number; txs: unknown[] }>("GET", `/api/ledger/blocks/${txs[0].height}?node=${node}`)).txs.length).toBeGreaterThan(0);
    expect((await h.req("GET", "/api/ledger/blocks/999999")).statusCode).toBe(404);
    expect((await h.ok<{ ok: boolean }[]>("GET", "/api/ledger/verify")).every((v) => v.ok)).toBe(true);
    expect((await h.ok<{ nodeId: string }[]>("GET", `/api/ledger/verify?node=${node}`)).map((v) => v.nodeId)).toEqual([node]);

    expect((await h.req("POST", "/api/ledger/tamper", { token: a.token, body: { nodeId: node, height: 1 } })).statusCode).toBe(403);
    const tampered = await h.ok<{ nodeId: string; ok: boolean }[]>("POST", "/api/ledger/tamper", { token: admin.token, body: { nodeId: node, height: 1 } });
    expect(tampered.find((v) => v.nodeId === node)?.ok).toBe(false);
    expect((await h.ok<{ ok: boolean }>("POST", "/api/ledger/repair", { token: admin.token, body: { nodeId: node } })).ok).toBe(true);
    const faulty = await h.ok<LedgerStatus>("POST", "/api/ledger/fault", { token: admin.token, body: { nodeId: node, fault: "crash" } });
    expect(faulty.validators.find((v) => v.id === node)?.fault).toBe("crash");
    await h.ok("POST", "/api/ledger/fault", { token: admin.token, body: { nodeId: node, fault: "none" } });
    expect((await h.req("POST", "/api/ledger/fault", { token: admin.token, body: { nodeId: "yok", fault: "none" } })).statusCode).toBe(404);
    const actions = h.services.ctx.db.all<{ action: string }>("SELECT action FROM audit_log WHERE action LIKE 'ledger.%'").map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["ledger.tamper", "ledger.repair", "ledger.fault"]));
  }, TIMEOUT);
});
