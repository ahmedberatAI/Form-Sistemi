// Bilirkişi kurası tohum bloğunun ÖNCEDEN taahhüdü (ALGORITMA.md §12 madde 9; bkz. SEED_COMMIT_LEAD, commitSeedBlock).
// Karar: taahhüt payı +1'dir. Tohum, taahhüt anında henüz var olmayan bloğun hash'idir; yükseklik bir kez yazılır, kura bu blok
// işlenmeden yapılmaz ve tohum tam o bloktan alınır (sonradan gelen "uygun" bir bloktan değil). +2 seçilmedi çünkü defter boş blok
// üretmez (test/ledger/consensus.test.ts "boş blok yok"): +1 bloğunu taahhüdü taşıyan SEED_COMMIT işlemi oluşturur, +2 bloğu ise
// başka bir işlem gelene kadar oluşmaz ve boşta kalan bir defterde kura süre boyunca beklerdi.
// Taahhüt yazılan HER yolda (tartışma açılışı, bilirkişi talebi, hak bayrağı, uzlaşma turu, karşı panel) aynı işlemde SEED_COMMIT
// gönderilir: kura ilgisiz bir defter işlemi beklemez (canlılık) ve taahhüt defterde denetlenebilir.
import { fy } from "@forum/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOUR } from "../../src/core/clock";
import type { AuthUser } from "../../src/core/contracts";
import { SEED_COMMIT_LEAD, seedCommitHeight } from "../../src/forum/lifecycle";
import { CAT, LONG_BODY, makeForum, type ForumHarness } from "./harness";

const heightOf = (h: ForumHarness, id: string): number | null =>
  h.ctx.db.get<{ e: number | null }>("SELECT expert_draw_height AS e FROM proposals WHERE id = ?", id)!.e;

const seedCommits = (h: ForumHarness, id: string) => h.ledger.findTxs({ type: "SEED_COMMIT", proposalId: id });

async function setupForum(realLedger: boolean): Promise<{ h: ForumHarness; m: AuthUser[]; expert: AuthUser }> {
  const h = await makeForum({ realLedger });
  const m = h.users("uye", 30);
  const admin = h.user("yonetici", { roles: ["admin"] });
  const expert = h.user("bilirkisi");
  h.experts.apply(expert.id, [CAT.enerji], "Enerji uzmanı, elektrik mühendisi.");
  h.experts.decideApplication(admin.id, expert.id, "approve");
  return { h, m, expert };
}

/** Bir öneriyi destekçi toplamadan tartışmaya taşır; tartışma açılırken yapılan taahhüt yüksekliğini (yoksa null) döndürür. */
async function openDeliberation(h: ForumHarness, author: AuthUser, sponsors: AuthUser[], title: string, categories: string[]): Promise<{ id: string; committed: number | null }> {
  const d = await h.forum.proposals.create(author, { kind: "topic", title, body: `${LONG_BODY} (${title})`, categories, submit: true });
  for (const s of sponsors.slice(0, d.sponsorsRequired)) await h.forum.proposals.sponsor(s, d.id);
  await h.flush();
  expect(h.forum.proposals.get(d.id, null).status).toBe("deliberation");
  return { id: d.id, committed: heightOf(h, d.id) };
}

describe("bilirkişi kurası tohum taahhüdü", () => {
  let h: ForumHarness;
  let m: AuthUser[];
  let expert: AuthUser;

  beforeAll(async () => {
    ({ h, m, expert } = await setupForum(false));
  });

  it("pay 1'dir: yükseklik = taahhüt anındaki son blok + 1", () => {
    expect(SEED_COMMIT_LEAD).toBe(1);
    expect(seedCommitHeight(0)).toBe(1);
    expect(seedCommitHeight(41)).toBe(42);
  });

  it("tartışma açılırken: taahhüt anında blok yoktu; taahhüdü taşıyan işlemler (PHASE_CHANGED, SEED_COMMIT) onu oluşturur", async () => {
    const { id, committed: c } = await openDeliberation(h, m[0], m.slice(1), "Okul çatısına güneş paneli", [CAT.enerji]);
    expect(c).not.toBeNull(); // enerji kategorisi bilirkişi gerektirir: taahhüt, tartışma açılırken yapılır
    const committed = c!;
    const phaseTx = h.ledger.findTxs({ type: "PHASE_CHANGED", proposalId: id }).find((t) => t.payload.to === "deliberation")!;
    // Taahhüt anındaki son blok committed - SEED_COMMIT_LEAD idi ve taahhüdü taşıyan işlem içermiyordu;
    const before = h.ledger.getBlock(committed - SEED_COMMIT_LEAD);
    expect(before).not.toBeNull();
    expect(before!.txs.some((t) => t.hash === phaseTx.hash)).toBe(false);
    // taahhüt edilen blok ise yalnızca bu geçişle (başka işlem beklemeden) oluşmuş ve taahhüt işlemini içeriyor.
    const block = h.ledger.getBlock(committed)!;
    expect(block.txs.map((t) => t.hash)).toContain(phaseTx.hash);
    // Taahhüt defterde: SEED_COMMIT {proposalId, height, phase}.
    const commits = seedCommits(h, id);
    expect(commits.map((t) => t.payload)).toEqual([{ proposalId: id, height: committed, phase: "deliberation" }]);
    expect(commits[0].height).toBeGreaterThanOrEqual(committed);
    // Kura, ek bir işlem gelmeden bu blokla yapılır.
    await h.tick();
    const panel = h.forum.proposals.get(id, null).expertPanel!;
    expect(panel).not.toBeNull();
    expect(panel.seedSource).toMatchObject({ blockHeight: committed, blockHash: block.hash, proposalId: id });
    expect(panel.assignments.map((a) => a.expertId)).toEqual([expert.id]);
  });

  it("bilirkişi talebiyle taahhüt: SEED_COMMIT taahhüt edilen bloğu oluşturur; yükseklik değişmez; tohum tam o bloktan alınır", async () => {
    // Bilirkişi gerektirmeyen kategori: taahhüt, yazarın bilirkişi talebiyle (kullanıcı eylemi) yapılır.
    const { id, committed } = await openDeliberation(h, m[10], m.slice(11), "Park bankı yerleşimi", [CAT.park]);
    expect(committed).toBeNull();
    expect(seedCommits(h, id)).toEqual([]);
    const before = h.ledger.latestBlock().height;
    await h.forum.proposals.requestExpert(m[10], id, "panel");
    const target = heightOf(h, id)!;
    expect(target).toBe(before + SEED_COMMIT_LEAD);
    // Taahhüt anında blok yoktu (önceki son blok taahhüt işlemini içermiyor); taahhüt edilen bloğu SEED_COMMIT oluşturdu.
    const [commit] = seedCommits(h, id);
    expect(commit.payload).toEqual({ proposalId: id, height: target, phase: "deliberation" });
    expect(commit.height).toBe(target);
    expect(h.ledger.getBlock(before)!.txs.some((t) => t.hash === commit.hash)).toBe(false);

    // Başka bir üyenin talebi mevcut taahhüdü değiştiremez (yalnızca boşken yazılır) ve yeni taahhüt işlemi üretmez.
    await h.forum.proposals.requestExpert(m[11], id, "panel");
    expect(heightOf(h, id)).toBe(target);
    expect(seedCommits(h, id)).toHaveLength(1);

    // Defter taahhüt edilen yüksekliğin ötesine geçer: tohum TAAHHÜT EDİLEN bloktan alınır, son bloktan değil.
    while (h.ledger.latestBlock().height < target + 2) h.ledger.submit("GRAPH_RUN", { dummy: h.ledger.latestBlock().height + 1 });
    await h.tick();
    const panel = h.forum.proposals.get(id, null).expertPanel!;
    expect(panel).not.toBeNull();
    expect(panel.seedSource.blockHeight).toBe(target);
    expect(panel.seedSource.blockHash).toBe(h.ledger.getBlock(target)!.hash);
    expect(panel.seedSource.blockHash).not.toBe(h.ledger.latestBlock().hash);
    expect(heightOf(h, id)).toBe(target);
  });

  it("taahhüt edilen blok işlenmeden kura yapılmaz ve zamanlayıcı yüksekliği yeniden yazmaz", async () => {
    const { id } = await openDeliberation(h, m[20], m.slice(21), "Park aydınlatması", [CAT.park]);
    // Henüz var olmayan (ileri) bir yükseklik taahhüt edilmiş olsun.
    const target = h.ledger.latestBlock().height + 3;
    h.ctx.db.run("UPDATE proposals SET request_expert = 1, expert_draw_height = ? WHERE id = ?", target, id);
    await h.tick();
    await h.tick();
    expect(h.forum.proposals.get(id, null).expertPanel).toBeNull(); // blok yok → kura yok (seed_block_pending)
    expect(heightOf(h, id)).toBe(target);
    while (h.ledger.latestBlock().height < target) h.ledger.submit("GRAPH_RUN", { dummy: h.ledger.latestBlock().height + 1 });
    await h.tick();
    const panel = h.forum.proposals.get(id, null).expertPanel!;
    expect(panel.seedSource.blockHeight).toBe(target);
  });
});

describe("kura canlılığı: boştaki gerçek defterde taahhüt edilen bloğu taahhüt işlemi oluşturur", () => {
  let h: ForumHarness;
  let m: AuthUser[];

  beforeAll(async () => {
    ({ h, m } = await setupForum(true));
  }, 60_000);
  afterAll(async () => {
    await h.close();
  });

  /** Kuradan sonra: tohum bloğu taahhüt edilen yükseklikte ve içinde YALNIZ taahhüt işlemi var (ilgisiz işlem beklenmedi). */
  function expectDrawnFromOwnCommit(id: string, target: number, phase: string): void {
    const panel = h.forum.proposals.get(id, null).expertPanel!;
    expect(panel).not.toBeNull();
    expect(panel.seedSource.blockHeight).toBe(target);
    const block = h.ledger.getBlock(target)!;
    expect(panel.seedSource.blockHash).toBe(block.hash);
    expect(block.txs.map((t) => t.type)).toEqual(["SEED_COMMIT"]);
    expect(block.txs[0].payload).toEqual({ proposalId: id, height: target, phase });
  }

  it("bilirkişi talebi: ek işlem gelmeden panel bir sonraki tick'te çekilir", async () => {
    const { id } = await openDeliberation(h, m[0], m.slice(1), "Park çeşmesi onarımı", [CAT.park]);
    await h.tick();
    const before = h.ledger.latestBlock().height;
    await h.forum.proposals.requestExpert(m[0], id, "panel");
    const target = heightOf(h, id)!;
    expect(target).toBe(before + 1);
    await h.tick(); // defter boşaltılır (SEED_COMMIT bloğu oluşur), ardından kura
    expectDrawnFromOwnCommit(id, target, "deliberation");
  }, 60_000);

  it("hak bayrağı bilirkişiyi zorunlu kılınca: ek işlem gelmeden panel çekilir", async () => {
    const { id } = await openDeliberation(h, m[10], m.slice(11), "Parka bisiklet parkı", [CAT.park]);
    await h.tick();
    expect(heightOf(h, id)).toBeNull();
    const before = h.ledger.latestBlock().height;
    // Özü oylanamaz bir hakkın üye (danışma) bayrağı: yalnızca yükseltir — T1 + bilirkişi zorunlu (ALGORITMA §12 madde 11).
    await h.forum.proposals.flagRight(m[12], id, { right: fy("EsitlikAyrimcilikYasagi"), direction: "restrict" });
    const target = heightOf(h, id)!;
    expect(target).toBe(before + 1);
    await h.tick();
    expectDrawnFromOwnCommit(id, target, "deliberation");
  }, 60_000);

  it("uzlaşma turu (yeniden çekim): zamanlayıcının taahhüdü SEED_COMMIT taşır; panel ek işlem beklemeden çekilir", async () => {
    const { id } = await openDeliberation(h, m[20], m.slice(21), "Park girişine rampa", [CAT.park]);
    await h.tick();
    // Bilirkişi gerekli, panel yok, uzlaşma turu yeni başladı (geçiş taahhüdü sıfırlar).
    const now = h.ctx.clock.now();
    h.ctx.db.run(
      "UPDATE proposals SET status = 'reconciliation', phase_started_at = ?, phase_ends_at = ?, request_expert = 1, expert_draw_height = NULL WHERE id = ?",
      now,
      now + 24 * HOUR,
      id,
    );
    const before = h.ledger.latestBlock().height;
    await h.tick(); // taahhüt + SEED_COMMIT (COMMIT sonrası gönderilir ve boşaltmada bloğa girer)
    const target = heightOf(h, id)!;
    expect(target).toBe(before + 1);
    expect(h.forum.proposals.get(id, null).expertPanel).toBeNull();
    await h.tick(); // kura
    expectDrawnFromOwnCommit(id, target, "reconciliation");
  }, 60_000);
});
