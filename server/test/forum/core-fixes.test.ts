// Regresyon: (1) canObject, object() ile aynı 30 günlük itiraz bütçesini uygular; (2) applyRevision, YZ çağrıları sürerken
// eklenen hak bayrağını/katmanı eski anlık görüntüyle ezmez (kayıp güncelleme).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fy } from "@forum/shared";
import { CAT, closeVoting, LONG_BODY, makeBlocks, makeForum, seedHistory, toDeliberation, toVoting, type ForumHarness } from "./harness";

afterEach(() => vi.restoreAllMocks());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("canObject: itiraz bütçesi object() ile aynı kuralla", () => {
  let h: ForumHarness;
  beforeAll(async () => {
    h = await makeForum();
  }, 60_000);

  it("son 30 günde 2 imzası olan 'hayır' seçmeni için canObject=false ve object() 422; eski imzalar bütçeyi tüketmez", async () => {
    const b = makeBlocks(h);
    await seedHistory(h, b, 10);
    const id = await toDeliberation(h, b.A[2], b.all.slice(3), { title: "Otopark ücretli olsun", body: "Meydandaki otopark saatlik ücretli olsun; gelir park bakımına aktarılsın diye öneriyoruz." });
    await toVoting(h, id);
    for (const u of b.A) await h.forum.proposals.vote(u, id, "yes");
    for (const u of b.B) await h.forum.proposals.vote(u, id, "yes");
    for (const [i, u] of b.C.entries()) await h.forum.proposals.vote(u, id, i < 3 ? "yes" : "no");
    await closeVoting(h, id);

    const voter = b.C[5];
    expect(h.forum.proposals.get(id, voter).status).toBe("objection_window");
    expect(h.forum.proposals.get(id, voter).canObject).toBe(true);

    const now = h.ctx.clock.now();
    h.ctx.db.run("UPDATE users SET objection_budget_used = ? WHERE id = ?", JSON.stringify([now - 1000, now - 2000]), voter.id);
    const ground = fy("OrantisizAzinlikEtkisi");
    const statement = "Ücretlendirme yalnızca meydan çevresindeki dar gelirli sakinleri etkiliyor.";
    // Arayüz bayrağı ile sunucu kuralı aynı sonucu verir
    expect(h.forum.proposals.get(id, voter).canObject).toBe(false);
    await expect(h.forum.proposals.object(voter, id, { ground, statement })).rejects.toMatchObject({ status: 422, code: "objection_budget" });

    h.ctx.db.run("UPDATE users SET objection_budget_used = ? WHERE id = ?", JSON.stringify([now - 31 * 86_400_000, now - 1000]), voter.id);
    expect(h.forum.proposals.get(id, voter).canObject).toBe(true);
    const d = await h.forum.proposals.object(voter, id, { ground, statement });
    expect(d.canObject).toBe(false); // artık itiraz etti
  }, 60_000);
});

describe("applyRevision: eşzamanlı hak bayrağı ezilmez", () => {
  async function setup() {
    const h = await makeForum();
    const m = h.users("uye", 8);
    const id = await toDeliberation(h, m[0], m.slice(1), { title: "Parka ortak bahçe", body: LONG_BODY, categories: [CAT.park] });
    expect(h.forum.proposals.get(id, null).status).toBe("deliberation");
    return { h, m, id, right: fy("MulkiyetHakki") };
  }
  const NEW_BODY = LONG_BODY + " Ortak bahçe için ayrı bir alan ayrılacaktır.";

  it("YZ moderasyonu beklenirken bir üye bayrak ekler: güncelleme bayrağı ve katmanı korur", async () => {
    const { h, m, id, right } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const orig = h.ai.moderate.bind(h.ai);
    vi.spyOn(h.ai, "moderate").mockImplementation(async (...a) => {
      await gate;
      return orig(...a);
    });

    const pending = h.forum.proposals.update(m[0], id, { title: "Parka ortak bahçe projesi", body: NEW_BODY });
    await sleep(10);
    const flagged = await h.forum.proposals.flagRight(m[3], id, { right, direction: "restrict" });
    expect(flagged.rightsFlags).toEqual([{ right, direction: "restrict", source: "member" }]);
    release();
    const d = await pending;

    expect(d.version).toBe(2);
    expect(d.rightsFlags).toContainEqual({ right, direction: "restrict", source: "member" });
    expect(d.tier).toBe(flagged.tier);
    await h.close();
  });

  it("denetim (ontoloji) beklenirken eklenen bayrak, işlem içinde birleştirilir; katman daha sıkı olandır", async () => {
    const { h, m, id, right } = await setup();
    let entered!: () => void;
    const started = new Promise<void>((r) => (entered = r));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const orig = h.ontology.audit.bind(h.ontology);
    let calls = 0;
    vi.spyOn(h.ontology, "audit").mockImplementation(async (...a) => {
      if (calls++ === 0) {
        entered();
        await gate; // update'in denetimi: bayrak eklenmeden önceki girdiyle hesaplanır
      }
      return orig(...a);
    });

    const pending = h.forum.proposals.update(m[0], id, { title: "Parka ortak bahçe projesi", body: NEW_BODY });
    await started;
    const flagged = await h.forum.proposals.flagRight(m[3], id, { right, direction: "restrict" });
    expect(flagged.rightsFlags).toHaveLength(1);
    release();
    const d = await pending;

    expect(d.version).toBe(2);
    expect(d.rightsFlags).toEqual([{ right, direction: "restrict", source: "member" }]);
    expect(d.tier).toBe(flagged.tier);
    expect(d.tier).not.toBe("T0");
    await h.close();
  });
});
