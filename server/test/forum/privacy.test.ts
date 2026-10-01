// Senaryo 9 (kişisel veri → 422 pii_detected) ve senaryo 10 (defter yüklerinde kullanıcı kimliği / kişisel veri YOK:
// karışık bir iş yükünden sonra TÜM defter işlemleri taranır), ayrıca bilirkişi kurası (önceden taahhüt edilen blok).
import { beforeAll, describe, expect, it } from "vitest";
import { fy } from "@forum/shared";
import type { AuthUser } from "../../src/core/contracts";
import { CAT, endPhase, insertTopic, LONG_BODY, makeForum, toDeliberation, toVoting, type ForumHarness } from "./harness";

const FORBIDDEN_KEYS = ["firstName", "lastName", "tckn", "birthDate", "address", "email", "phone", "body", "text", "password", "nickname", "userId", "authorId", "user_id"];

function walk(v: unknown, visit: (key: string | null, value: unknown) => void, key: string | null = null): void {
  visit(key, v);
  if (Array.isArray(v)) v.forEach((x) => walk(x, visit, null));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, visit, k);
}

describe("forum: kişisel veri ve defter gizliliği", () => {
  let h: ForumHarness;
  let m: AuthUser[];
  let admin: AuthUser;
  let expert: AuthUser;

  beforeAll(async () => {
    h = await makeForum();
    m = h.users("uye", 30);
    admin = h.user("yonetici", { roles: ["admin"] });
    expert = h.user("bilirkisi", { aiConsent: true });
    h.experts.apply(expert.id, [CAT.enerji], "Elektrik mühendisi, 12 yıl deneyim.");
    h.experts.decideApplication(admin.id, expert.id, "approve");
  });

  it("senaryo 9: kişisel veri → 422 pii_detected (details.pii); onayla gönderilebilir", async () => {
    const input = { kind: "topic" as const, title: "Komşu şikâyeti hakkında", body: "Sorumlu kişinin T.C. kimlik numarası 10000000146 olup bilgisi verilsin.", categories: [CAT.park] };
    const err = await h.forum.proposals.create(m[0], input).catch((e) => e);
    expect(err).toMatchObject({ status: 422, code: "pii_detected" });
    expect(err.details.pii.length).toBeGreaterThan(0);
    expect(JSON.stringify(err.details)).not.toContain("10000000146");
    const pre = await h.forum.proposals.precheck(m[0], input);
    expect(pre.pii.length).toBeGreaterThan(0);
    expect(pre.warnings.some((w) => w.includes("kişisel veri"))).toBe(true);
    const ok = await h.forum.proposals.create(m[0], { ...input, acknowledgePii: true });
    expect(ok.status).toBe("draft");
    // Mesaj ve düzenleme
    const topicId = insertTopic(h, "Gizlilik konusu");
    await expect(h.forum.messages.post(m[1], "topic", topicId, { body: "Bana mail atın: ali.veli@ornek.org", stance: "neutral" })).rejects.toMatchObject({ code: "pii_detected" });
    const msg = await h.forum.messages.post(m[1], "topic", topicId, { body: "Toplantı saat yedide.", stance: "neutral" });
    await expect(h.forum.messages.edit(m[1], msg.id, "Numaram 0532 111 22 33")).rejects.toMatchObject({ code: "pii_detected" });
    const pc = await h.forum.messages.precheck(m[1], "IBAN: TR33 0006 1005 1978 6457 8413 26");
    expect(pc.pii.length).toBeGreaterThan(0);
    expect(pc.aiLabel).toMatch(/^Yapay zekâ ile üretildi/);
  });

  it("bilirkişi gerektiren kategoride panel, önceden taahhüt edilen bloğun hash'iyle çekilir", async () => {
    const id = await toDeliberation(h, m[2], m.slice(3), {
      title: "Okul çatısına güneş paneli",
      body: "İlkokul çatısına güneş paneli kurulsun; üretilen elektrik okulun aydınlatmasında kullanılsın.",
      categories: [CAT.enerji],
    });
    const row = h.ctx.db.get<{ hgt: number | null }>("SELECT expert_draw_height AS hgt FROM proposals WHERE id = ?", id)!;
    expect(row.hgt).not.toBeNull();
    // PHASE_CHANGED (deliberation) bloğu taahhüt edilen yüksekliktedir
    const committed = h.ledger.getBlock(row.hgt!);
    expect(committed?.txs.some((t) => t.type === "PHASE_CHANGED" && t.payload.to === "deliberation")).toBe(true);
    await h.tick();
    const d = h.forum.proposals.get(id, null);
    expect(d.expertPanel).not.toBeNull();
    expect(d.expertPanel!.seedSource.blockHeight).toBe(row.hgt);
    expect(d.expertPanel!.seedSource.blockHash).toBe(committed!.hash);
    expect(d.expertPanel!.assignments.map((a) => a.expertId)).toEqual([expert.id]);
    expect(h.forum.community.tasks(expert).some((t) => t.kind === "expert")).toBe(true);
    // Bilirkişi alanında hak bayrağı kaldırabilir; sıradan üye kaldıramaz (yalnızca yükseltme)
    const right = fy("ErisimHakki");
    const flagged = await h.forum.proposals.flagRight(m[7], id, { right, direction: "restrict" });
    expect(flagged.tier).toBe("T1");
    await expect(h.forum.proposals.flagRight(m[7], id, { right, direction: "restrict", remove: true })).rejects.toMatchObject({ status: 403 });
    const cleared = await h.forum.proposals.flagRight(expert, id, { right, direction: "restrict", remove: true });
    expect(cleared.tier).toBe("T0");
    expect(h.forum.community.auditLog({ actorId: expert.id }).some((e) => e.action === "proposal.rights_flag_removed")).toBe(true);
  });

  it("senaryo 10: karışık iş yükünden sonra hiçbir defter yükünde kullanıcı kimliği ya da kişisel veri yok", async () => {
    // Konu önerisi: oylama, itiraz, azınlık raporu, yürürlük
    const id = await toDeliberation(h, m[10], m.slice(11), { title: "Bisiklet yolu yapılsın", body: LONG_BODY, categories: [fy("BisikletYaya")] });
    const reply = await h.forum.messages.post(m[12], "proposal", id, { body: "Bisiklet yolu çok iyi olur.", stance: "pro" });
    await h.forum.messages.post(m[13], "proposal", id, { body: "Kaldırımlar daralır, katılmıyorum.", stance: "con", parentId: reply.id });
    h.forum.messages.endorse(m[14], reply.id, 1);
    h.graph.delegate(m[29].id, m[11].id, "*", 1);
    await toVoting(h, id);
    for (let i = 0; i < 24; i++) await h.forum.proposals.vote(m[i], id, i < 20 ? "yes" : "no");
    await endPhase(h, id);
    expect(h.forum.proposals.get(id, null).status).toBe("objection_window");
    await h.forum.proposals.object(m[21], id, { ground: fy("UsulHatasi"), statement: "Tartışma süresinde yeterli bilgilendirme yapılmadı." });
    h.forum.proposals.minorityReport(m[22], id, "Bisiklet yolu ana caddede kaldırımları daraltacak; yaşlılar ve engelliler için yaya güvenliği öncelik olmalı.");
    await h.forum.proposals.aiSummary(m[15], id);
    await endPhase(h, id);
    expect(h.forum.proposals.get(id, null).status).toBe("enacted");

    const ids = new Set(h.ctx.db.all<{ id: string }>("SELECT id FROM users").map((r) => r.id));
    const nicknames = new Set(h.ctx.db.all<{ nickname: string }>("SELECT nickname FROM users").map((r) => r.nickname));
    const txs = h.fake!.txs;
    expect(txs.length).toBeGreaterThan(50);
    const types = new Set(txs.map((t) => t.type));
    for (const t of ["PROPOSAL_CREATED", "SPONSORED", "PHASE_CHANGED", "VOTE_COMMIT", "BALLOT_REVEAL", "TALLY", "OBJECTION", "MINORITY_REPORT", "MESSAGE_POSTED", "TOPIC_REVISION", "EXPERT_DRAW", "AI_ANALYSIS", "CLUSTER_SNAPSHOT", "DELEGATION"]) {
      expect(types, t).toContain(t);
    }
    const problems: string[] = [];
    for (const tx of txs) {
      const raw = JSON.stringify(tx.payload);
      for (const uid of ids) if (raw.includes(uid)) problems.push(`${tx.type}: kullanıcı kimliği`);
      walk(tx.payload, (key, value) => {
        if (key && FORBIDDEN_KEYS.includes(key)) problems.push(`${tx.type}: yasak anahtar ${key}`);
        if (typeof value === "string" && nicknames.has(value)) problems.push(`${tx.type}: takma ad`);
        if (typeof value === "string" && /(ali\.veli@|0532|10000000146|bisiklet yolu)/i.test(value)) problems.push(`${tx.type}: ham metin`);
      });
    }
    expect([...new Set(problems)]).toEqual([]);
  });
});
