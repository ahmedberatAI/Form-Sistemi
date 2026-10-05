// "Anlamlı görüş grubu" kuralı sayım dışı görünümlerde de YÜRÜRLÜKTEKİ yönetmelik parametreleriyle işler (σ_share, σ_min):
// mesajların köprü puanı (views.bridgeContext), öneri sayfası (bilirkişi "azınlık güvenceli soru", YZ özeti). Önceden bu
// görünümler 1/10 ve 3'ü sabit yazıyordu; yönetmelik eşikleri değiştirince karar ile öneri sayfası ayrışırdı.
import { beforeEach, describe, expect, it } from "vitest";
import { fy, rat } from "@forum/shared";
import type { AuthUser, OntologyService } from "../../src/core/contracts";
import { ForumCore } from "../../src/forum";
import { inForceSignificance, significanceFor } from "../../src/forum/views";
import { CAT, insertTopic, LONG_BODY, makeForum, toDeliberation, type ForumHarness } from "./harness";

const RATIONALE = "Anlamlı görüş grubu eşiğinin topluluğun yapısına göre ayarlanması önerilmektedir.";

/** Yürürlükteki yönetmeliğin genel parametresini bir yamayla değiştirir (yeni sürüm). */
async function setGeneral(h: ForumHarness, param: "anlamliKumePayi" | "anlamliKumeAsgariUye", value: number): Promise<void> {
  await h.ontology.applyPatch({ ops: [{ op: "setParam", rule: fy("GenelParametreler"), param, value }], rationale: RATIONALE }, `yama-${param}`);
}

let snapshotNo = 0;

/** Doğrudan anlık görüntü satırı: `sizes` nüfus büyüklükleri, `groups` ise kullanıcı → küme atamaları. */
function insertSnapshot(h: ForumHarness, sizes: Record<string, number>, groups: Record<string, AuthUser[]>): void {
  const assignments: Record<string, string> = {};
  for (const [g, users] of Object.entries(groups)) for (const u of users) assignments[u.id] = g;
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  const no = ++snapshotNo;
  h.ctx.db.run(
    `INSERT INTO cluster_snapshots(id, algo, params, seed, input_hash, output_hash, k, silhouette, assignments, coords, sizes, clustered_total, ledger_tx, created_at)
     VALUES (?, 'test', '{}', 'seed', 'in', ?, ?, 0.5, ?, '{}', ?, ?, NULL, ?)`,
    `snap-${no}`,
    `out-${no}`,
    Object.keys(sizes).length,
    JSON.stringify(assignments),
    JSON.stringify(sizes),
    total,
    h.ctx.clock.now(),
  );
}

// Nüfus: g0 = 20, g1 = 7, g2 = 3 (toplam 30). Varsayılan eşiklerle (%10, 3 üye) üçü de anlamlıdır (g2 tam %10 ve tam 3 üye).
const SIZES = { g0: 20, g1: 7, g2: 3 };

describe("anlamlı küme kuralı: mesajların köprü puanı yürürlükteki yönetmeliği izler", () => {
  let h: ForumHarness;
  let u: AuthUser[];
  let messageId: string;

  beforeEach(async () => {
    h = await makeForum();
    u = h.users("uye", 12);
    insertSnapshot(h, SIZES, { g0: u.slice(1, 5), g1: u.slice(5, 8), g2: u.slice(8, 11) });
    const topicId = insertTopic(h, "Anlamlı küme konusu");
    const msg = await h.forum.messages.post(u[0], "topic", topicId, { body: "Ortak alanların bakımını birlikte üstlenelim.", stance: "pro" });
    messageId = msg.id;
    for (const x of u.slice(1, 8)) h.forum.messages.endorse(x, messageId, 1); // g0 ve g1 katılıyor
    for (const x of u.slice(8, 11)) h.forum.messages.endorse(x, messageId, -1); // g2 katılmıyor
  });

  const score = () => h.forum.messages.get(messageId, null).bridgingScore;

  it("varsayılan eşikler: üç küme de anlamlı → en düşük destek g2'ninki (1/5)", () => {
    expect(score()).toBeCloseTo(0.2, 4);
  });

  it("σ_share yamayla %15'e çıkınca g2 (%10) anlamsızlaşır; puan g1'in desteğine (4/5) yükselir", async () => {
    await setGeneral(h, "anlamliKumePayi", 0.15);
    expect(score()).toBeCloseTo(0.8, 4);
  });

  it("σ_min yamayla 4'e çıkınca g2 (3 üye) anlamsızlaşır; puan g1'in desteğine (4/5) yükselir", async () => {
    await setGeneral(h, "anlamliKumeAsgariUye", 4);
    expect(score()).toBeCloseTo(0.8, 4);
  });

  it("σ_share yamayla %5'e inince hiçbir küme elenmez; puan değişmez (kural iki yönde de izlenir)", async () => {
    await setGeneral(h, "anlamliKumePayi", 0.05);
    expect(score()).toBeCloseTo(0.2, 4);
  });
});

describe("anlamlı küme parametreleri: inForceSignificance / significanceFor", () => {
  let h: ForumHarness;
  let core: ForumCore;

  beforeEach(async () => {
    h = await makeForum();
    core = new ForumCore({
      ctx: h.ctx,
      ledger: h.ledger,
      ontology: h.ontology,
      graph: h.graph,
      math: h.math,
      identity: h.identity,
      ai: h.ai,
      aiSink: h.aiSink,
      experts: h.experts,
      notifier: h.notifier,
      audit: h.audit,
    });
  });

  it("kurucu yönetmelikte 1/10 ve 3; yama kabul edilince hemen yeni değerler", async () => {
    expect(inForceSignificance(core)).toEqual({ significantShare: rat(1, 10), significantMinMembers: 3 });
    await setGeneral(h, "anlamliKumePayi", 0.15);
    await setGeneral(h, "anlamliKumeAsgariUye", 4);
    expect(inForceSignificance(core)).toEqual({ significantShare: rat(3, 20), significantMinMembers: 4 });
  });

  it("önerinin kendi (dondurulmuş) parametreleri varsa onlar; yoksa yürürlükteki yönetmelik", async () => {
    await setGeneral(h, "anlamliKumePayi", 0.15);
    const own = { significantShare: rat(1, 10), significantMinMembers: 3 };
    expect(significanceFor(core, own)).toBe(own);
    expect(significanceFor(core, null)).toEqual({ significantShare: rat(3, 20), significantMinMembers: 3 });
    expect(significanceFor(core, undefined)).toEqual({ significantShare: rat(3, 20), significantMinMembers: 3 });
  });

  it("ontoloji okunamazsa kurucu yönetmeliğin varsayılanları (görünüm çökmez)", () => {
    const broken = Object.create(h.ontology, {
      adjustableParams: {
        value: () => {
          throw new Error("ontoloji okunamadı");
        },
      },
    }) as OntologyService;
    const brokenCore = new ForumCore({ ...core.deps, ontology: broken });
    expect(inForceSignificance(brokenCore)).toEqual({ significantShare: rat(1, 10), significantMinMembers: 3 });
  });
});

describe("anlamlı küme kuralı: öneri sayfası önerinin kendi parametreleriyle (azınlık güvenceli soru)", () => {
  it("yamadan ÖNCE açılan öneri eski eşikle, SONRA açılan yeni eşikle değerlendirilir", async () => {
    const h = await makeForum();
    const u = h.users("uye", 24);
    const body = (t: string) => ({ title: t, body: `${LONG_BODY} (${t})`, categories: [CAT.park] });
    // 1) yamadan önce açılan öneri: audit parametreleri σ_share = 1/10
    const oldId = await toDeliberation(h, u[0], u.slice(1, 8), body("Park bankları yenilensin"));
    // 2) yönetmelik değişir (σ_share = %15), sonra yeni öneri açılır
    await setGeneral(h, "anlamliKumePayi", 0.15);
    const newId = await toDeliberation(h, u[8], u.slice(9, 16), body("Park aydınlatması artırılsın"));
    // Küme anlık görüntüsü: g2 = 3/30 = %10 (eski eşikte anlamlı, yenisinde değil)
    insertSnapshot(h, SIZES, { g0: u.slice(16, 20), g1: u.slice(20, 22), g2: u.slice(22, 24) });
    const g1 = u[20];
    const g2 = u[22];
    const q = "Bu değişikliğin bakım maliyeti yıllık ne kadar olur acaba?";

    // Eski öneri (σ_share = 1/10): üç küme anlamlı; en küçüğü g2 → g2 üyesinin ilk sorusu güvenceli.
    expect(h.forum.proposals.expertQuestion(g2, oldId, q).minorityGuaranteed).toBe(true);
    // Yeni öneri (σ_share = 0,15): g2 anlamsız; anlamlı kümelerin en küçüğü g1 → g2 üyesinin sorusu güvenceli değil, g1 üyesininki güvenceli.
    expect(h.forum.proposals.expertQuestion(g2, newId, q).minorityGuaranteed).toBe(false);
    expect(h.forum.proposals.expertQuestion(g1, newId, q).minorityGuaranteed).toBe(true);
  });
});
