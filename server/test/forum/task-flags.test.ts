// Görev–bayrak tutarlılığı: Ana sayfa görevleri (vote / object / reconciliation) ile öneri sayfası bayrakları
// (canVote / canObject / canWriteMinorityReport) AYNI koşulları kullanır (tek kaynak: forum/eligibility.ts).
// Eskiden görevler siyasi rızayı, 30 günlük itiraz bütçesini ve (itirazda) süreyi denetlemiyordu: Ana sayfa "itiraz hakkınız var"
// derken öneri sayfası formu göstermiyordu.
import { beforeAll, describe, expect, it } from "vitest";
import { fy } from "@forum/shared";
import type { AuthUser } from "../../src/core/contracts";
import { minorityReportStage, objectionOpen, votingOpen } from "../../src/forum/eligibility";
import { closeVoting, makeForum, toDeliberation, toVoting, type ForumHarness } from "./harness";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

describe("eligibility: evre ve süre yardımcıları", () => {
  it("votingOpen: oylama ve yeniden oylama; bitiş anı dahil değil; bitiş yoksa kapalı", () => {
    expect(votingOpen({ status: "voting", phase_ends_at: 100 }, 99)).toBe(true);
    expect(votingOpen({ status: "revote", phase_ends_at: 100 }, 99)).toBe(true);
    expect(votingOpen({ status: "voting", phase_ends_at: 100 }, 100)).toBe(false);
    expect(votingOpen({ status: "voting", phase_ends_at: null }, 0)).toBe(false);
    expect(votingOpen({ status: "deliberation", phase_ends_at: 100 }, 1)).toBe(false);
  });

  it("objectionOpen: yalnız itiraz süresi ve süre dolmadıkça", () => {
    expect(objectionOpen({ status: "objection_window", phase_ends_at: 100 }, 99)).toBe(true);
    expect(objectionOpen({ status: "objection_window", phase_ends_at: 100 }, 100)).toBe(false);
    expect(objectionOpen({ status: "objection_window", phase_ends_at: null }, 1)).toBe(false);
    expect(objectionOpen({ status: "reconciliation", phase_ends_at: 100 }, 1)).toBe(false);
  });

  it("minorityReportStage: itiraz süresi ve uzlaşma", () => {
    expect(minorityReportStage({ status: "objection_window" })).toBe(true);
    expect(minorityReportStage({ status: "reconciliation" })).toBe(true);
    expect(minorityReportStage({ status: "voting" })).toBe(false);
    expect(minorityReportStage({ status: "enacted" })).toBe(false);
  });
});

describe("görevler ile öneri bayrakları aynı koşulları kullanır", () => {
  let h: ForumHarness;
  let m: AuthUser[];
  let late: AuthUser;
  let id: string;

  const hasTask = (u: AuthUser, kind: "vote" | "object" | "reconciliation") => h.forum.community.tasks(u).some((t) => t.kind === kind && t.link === `/oneriler/${id}`);

  /** Her üye için görev ile bayrak aynı yanıtı verir (görev satırı bayraktan fazla olamaz, eksik de olamaz). */
  function expectConsistent(): void {
    for (const u of [...m, late]) {
      const d = h.forum.proposals.get(id, u);
      expect(hasTask(u, "vote"), `${u.nickname}: vote görevi`).toBe(d.canVote && !d.myBallot);
      expect(hasTask(u, "object"), `${u.nickname}: object görevi`).toBe(d.canObject);
      expect(hasTask(u, "reconciliation"), `${u.nickname}: reconciliation görevi`).toBe(d.status === "reconciliation" && d.canWriteMinorityReport);
    }
  }

  beforeAll(async () => {
    h = await makeForum();
    m = h.users("uye", 30);
    id = await toDeliberation(h, m[0], m.slice(1), { title: "Çocuk parkına gölgelik", body: "Çocuk parkının üzerine yaz sıcaklarında gölge sağlayacak bir gölgelik yapılsın; oturma alanı korunsun." });
  }, 30_000);

  it("vote: rızası geri çekilen, askıya alınan, daha sonra doğrulanan üyeye ve oy vermiş olana görev çıkmaz", async () => {
    await toVoting(h, id);
    late = h.user("gec_gelen", { verifiedAt: h.ctx.clock.now() }); // liste dondurulduktan sonra doğrulandı: seçmen değil
    h.ctx.db.run("UPDATE users SET political_consent = 0 WHERE id = ?", m[11].id);
    h.ctx.db.run("UPDATE users SET status = 'suspended' WHERE id = ?", m[12].id);

    expect(hasTask(m[10], "vote")).toBe(true); // olumlu kontrol
    expect(hasTask(m[11], "vote")).toBe(false); // rıza yok → sayfada oy formu da yok
    expect(h.forum.proposals.get(id, m[11]).canVote).toBe(false);
    expect(hasTask(m[12], "vote")).toBe(false);
    expect(hasTask(late, "vote")).toBe(false);
    expectConsistent();

    // Oy verenlerin görevi kalkar (oy değiştirilebilir: canVote true kalır, görev ise yalnız oy vermeyene aittir).
    for (const u of [...m.slice(0, 11), ...m.slice(13, 20)]) await h.forum.proposals.vote(u, id, "yes");
    for (const u of m.slice(20, 25)) await h.forum.proposals.vote(u, id, "no");
    expect(hasTask(m[10], "vote")).toBe(false);
    expect(h.forum.proposals.get(id, m[10]).canVote).toBe(true);
    expect(hasTask(m[25], "vote")).toBe(true);
    expectConsistent();
  });

  it("object: rıza, 30 günlük itiraz bütçesi, daha önce imza ve süre görevle bayrağı birlikte kapatır", async () => {
    await closeVoting(h, id);
    expect(h.forum.proposals.get(id, null).status).toBe("objection_window");

    // m[20] normal "red" seçmeni; m[21] rızasını geri çekti; m[22] bütçesi dolu; m[23] zaten imzaladı; m[24] askıda.
    h.ctx.db.run("UPDATE users SET political_consent = 0 WHERE id = ?", m[21].id);
    const now = h.ctx.clock.now();
    h.ctx.db.run("UPDATE users SET objection_budget_used = ? WHERE id = ?", JSON.stringify([now - 1000, now - 2000]), m[22].id);
    await h.forum.proposals.object(m[23], id, { ground: fy("OrantisizAzinlikEtkisi"), statement: "Gölgelik yalnızca parkın bir köşesini kapsıyor, diğer çocukları dışarıda bırakıyor." });
    h.ctx.db.run("UPDATE users SET status = 'suspended' WHERE id = ?", m[24].id);

    expect(hasTask(m[20], "object")).toBe(true); // olumlu kontrol
    expect(h.forum.proposals.get(id, m[20]).canObject).toBe(true);
    for (const u of [m[21], m[22], m[23], m[24]]) {
      expect(hasTask(u, "object"), `${u.nickname}: görev`).toBe(false);
      expect(h.forum.proposals.get(id, u).canObject, `${u.nickname}: bayrak`).toBe(false);
    }
    // "Evet" veren ve oy vermeyen itiraz edemez
    expect(hasTask(m[0], "object")).toBe(false);
    expect(hasTask(m[25], "object")).toBe(false);
    expectConsistent();

    // Eski imza bütçeyi tüketmez: bütçe geri gelince hem görev hem bayrak döner
    h.ctx.db.run("UPDATE users SET objection_budget_used = ? WHERE id = ?", JSON.stringify([now - 31 * DAY_MS, now - 1000]), m[22].id);
    expect(hasTask(m[22], "object")).toBe(true);
    expect(h.forum.proposals.get(id, m[22]).canObject).toBe(true);
    expectConsistent();

    // Süre dolunca (tick çalışmadan) ikisi de kapanır
    h.ctx.clock.advance(h.forum.proposals.get(id, null).phaseEndsAt! - h.ctx.clock.now());
    expect(hasTask(m[20], "object")).toBe(false);
    expect(h.forum.proposals.get(id, m[20]).canObject).toBe(false);
    expectConsistent();
  });

  it("reconciliation: rıza ve daha önce yazılmış rapor görevle bayrağı birlikte kapatır", () => {
    // Soğuk başlangıçta (küme yok) geçerli itiraz oluşmaz; uzlaşma evresini doğrudan kurarız (görev ve bayrak yalnız evreyi okur).
    h.ctx.db.run(
      "UPDATE proposals SET status = 'reconciliation', reconciliation_used = 1, reconciliation_origin = 'objection', phase_ends_at = ? WHERE id = ?",
      h.ctx.clock.now() + 48 * HOUR_MS,
      id,
    );

    // m[21] rızasız ve m[24] askıda → ikisi de kapalı; m[22] ve m[23] için itiraz bütçesi/imzası rapor yazmayı etkilemez.
    expect(hasTask(m[20], "reconciliation")).toBe(true); // olumlu kontrol
    expect(h.forum.proposals.get(id, m[20]).canWriteMinorityReport).toBe(true);
    for (const u of [m[22], m[23]]) {
      expect(hasTask(u, "reconciliation"), `${u.nickname}: görev`).toBe(true);
      expect(h.forum.proposals.get(id, u).canWriteMinorityReport, `${u.nickname}: bayrak`).toBe(true);
    }
    for (const u of [m[21], m[24]]) {
      expect(hasTask(u, "reconciliation"), `${u.nickname}: görev`).toBe(false);
      expect(h.forum.proposals.get(id, u).canWriteMinorityReport, `${u.nickname}: bayrak`).toBe(false);
    }
    expect(hasTask(m[0], "reconciliation")).toBe(false); // "evet" verdi
    expect(hasTask(m[25], "reconciliation")).toBe(false); // oy vermedi
    expectConsistent();

    // Rapor yazan üyenin görevi ve bayrağı kapanır
    h.forum.proposals.minorityReport(m[20], id, "Gölgelik tasarımı parkın yalnız bir köşesini kapsıyor; kalan alanlardaki çocuklar için ikinci bir gölge çözümü de öneriye eklenmelidir.");
    expect(hasTask(m[20], "reconciliation")).toBe(false);
    expect(h.forum.proposals.get(id, m[20]).canWriteMinorityReport).toBe(false);
    expectConsistent();

    // Rıza geri verilince görev ve bayrak birlikte döner
    h.ctx.db.run("UPDATE users SET political_consent = 1 WHERE id = ?", m[21].id);
    expect(hasTask(m[21], "reconciliation")).toBe(true);
    expect(h.forum.proposals.get(id, m[21]).canWriteMinorityReport).toBe(true);
    expectConsistent();
  });
});
