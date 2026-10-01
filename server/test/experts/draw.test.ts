import { sha256Hex } from "@forum/shared";
import { describe, expect, it } from "vitest";
import { candidateRef, drawSeed, expertWeight } from "../../src/experts";
import { CAT, catchAsync, catchErr, fakeMath, makeWorld, type World } from "./fixtures";

/** Başka bir öneride bekleyen görev ekleyerek bilirkişiye "aktif görev" yükü verir. */
function addLoad(w: World, expertId: string, n: number): void {
  if (!w.db.get("SELECT id FROM users WHERE id = 'load-author'")) w.user("load-author");
  for (let i = 0; i < n; i++) {
    const pid = w.proposal(`load-${expertId}-${i}`, "load-author");
    const panelId = `panel-${pid}`;
    w.db.run(
      "INSERT INTO expert_panels(id, proposal_id, round, is_counter, seed, seed_source, candidates, selected, created_at) VALUES (?, ?, 1, 0, 's', '{}', '[]', '[]', 0)",
      panelId,
      pid,
    );
    w.db.run(
      "INSERT INTO expert_assignments(id, panel_id, proposal_id, expert_id, status, due_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'invited', ?, 0, 0)",
      `as-${pid}`,
      panelId,
      pid,
      expertId,
      w.clock.now() + 1e9,
    );
  }
}

describe("aday havuzu (§8 adım 2)", () => {
  it("yalnız etkin bilirkişiler; alan = kategorinin kendisi, üst ya da alt sınıfı", async () => {
    const w = makeWorld();
    w.user("author");
    w.expert("e-ulasim", [CAT.ulasim]);
    w.expert("e-toplu", [CAT.toplu]);
    w.expert("e-metro", [CAT.metro]);
    w.expert("e-bisiklet", [CAT.bisiklet]);
    w.expert("e-saglik", [CAT.saglik]);
    w.expert("e-cok", [CAT.saglik, CAT.metro]);
    w.expert("e-askida", [CAT.toplu]);
    w.svc.sanction(w.admin, "e-askida", "suspend", "Soruşturma");
    w.user("e-basvuru");
    w.svc.apply("e-basvuru", [CAT.toplu], "Başvurdu");
    w.proposal("p-1", "author", [CAT.toplu]);

    const panel = await w.draw("p-1", "author", [CAT.toplu], { k: 10 });
    expect(panel.candidates.map((c) => c.userId)).toEqual(["e-cok", "e-metro", "e-toplu", "e-ulasim"]);
    expect(panel.assignments.map((a) => a.expertId).sort()).toEqual(["e-cok", "e-metro", "e-toplu", "e-ulasim"]);
    expect(panel.noExpertAvailable).toBe(false);
    expect(panel.candidates.every((c) => c.excludedReason === undefined && c.weight === 0.75)).toBe(true);
  });
});

describe("kesin dışlamalar (§8 adım 3)", () => {
  it("yazar, 2 adımlık aile bağı, aynı hane: listede görünür, ağırlık 0, seçilmez", async () => {
    const w = makeWorld();
    w.expert("author", [CAT.toplu]);
    w.expert("e-aile", [CAT.toplu]);
    w.expert("e-hane", [CAT.toplu]);
    w.expert("e-ok1", [CAT.toplu]);
    w.expert("e-ok2", [CAT.toplu]);
    w.user("x-kuzen");
    w.graph.relate("e-aile", "x-kuzen");
    w.graph.relate("x-kuzen", "author");
    w.households.set("e-hane", "hane-7");
    w.households.set("author", "hane-7");
    w.proposal("p-1", "author", [CAT.toplu]);

    const panel = await w.draw("p-1", "author", [CAT.toplu], { k: 3 });
    const byId = Object.fromEntries(panel.candidates.map((c) => [c.userId, c]));
    expect(byId["author"]).toMatchObject({ weight: 0, excludedReason: "Önerinin yazarı" });
    expect(byId["e-aile"].weight).toBe(0);
    expect(byId["e-aile"].excludedReason).toMatch(/kesin çıkar çatışması.*2 adım/);
    expect(byId["e-hane"].weight).toBe(0);
    expect(byId["e-hane"].excludedReason).toMatch(/aynı hane/);
    expect(byId["e-ok1"].excludedReason).toBeUndefined();
    expect(panel.assignments.map((a) => a.expertId).sort()).toEqual(["e-ok1", "e-ok2"]);
  });

  it("aynı önerinin önceki panelistleri (karşı panelde de) ve çekinme beyan edenler dışlanır", async () => {
    const w = makeWorld();
    w.user("author");
    for (const id of ["e-1", "e-2", "e-3", "e-4", "e-5", "e-6"]) w.expert(id, [CAT.toplu]);
    w.proposal("p-1", "author", [CAT.toplu]);

    const first = await w.draw("p-1", "author", [CAT.toplu], { k: 2 });
    const firstIds = first.assignments.map((a) => a.expertId);
    // ilk panelistlerden biri çekinir → yerine yedek gelir (o da artık "önceki panelist")
    const recuser = firstIds[0];
    const afterRecuse = await w.svc.respond(first.assignments[0].id, recuser, "recuse", "Yazarla ortak proje");
    const panel1Ids = afterRecuse.assignments.map((a) => a.expertId);
    expect(panel1Ids).toHaveLength(3);

    const counter = await w.draw("p-1", "author", [CAT.toplu], { k: 3, counter: true });
    expect(counter.isCounterPanel).toBe(true);
    expect(counter.round).toBe(2);
    const byId = Object.fromEntries(counter.candidates.map((c) => [c.userId, c]));
    expect(byId[recuser]).toMatchObject({ weight: 0, excludedReason: "Bu öneride daha önce çekinme beyan etti" });
    for (const id of panel1Ids.filter((x) => x !== recuser)) {
      expect(byId[id].weight).toBe(0);
      expect(byId[id].excludedReason).toMatch(/karşı panele giremez/);
    }
    const counterIds = counter.assignments.map((a) => a.expertId);
    expect(counterIds).toHaveLength(3);
    expect(counterIds.some((id) => panel1Ids.includes(id))).toBe(false);

    // üçüncü panelde tüm önceki panelistler dışlanır → kimse kalmaz
    const third = await w.draw("p-1", "author", [CAT.toplu], { k: 3 });
    expect(third.noExpertAvailable).toBe(true);
    expect(third.assignments).toHaveLength(0);
    expect(third.candidates.filter((c) => /önceki panelinde/.test(c.excludedReason ?? ""))).toHaveLength(5);
  });
});

describe("yumuşak çatışma ve ağırlık (§8 adım 4)", () => {
  it("w = clamp(R, 0,5, 1,5) / (1 + aktifGörev) · (1 − soft)", () => {
    expect(expertWeight(0.75, 0, 0)).toBe(0.75);
    expect(expertWeight(0.75, 1, 0.5)).toBe(0.1875);
    expect(expertWeight(0.2, 0, 0)).toBe(0.5);
    expect(expertWeight(2, 0, 0)).toBe(1.5);
    expect(expertWeight(0.9, 2, 0.5)).toBe(0.15);
    expect(expertWeight(1, 0, 1)).toBe(0);
  });

  it("kurada graf mesafesi, itibar ve aktif görev yükü ağırlığa yansır", async () => {
    const w = makeWorld();
    w.user("author");
    w.user("z-ara");
    w.expert("e-takip", [CAT.toplu]); // yazarı doğrudan takip ediyor → soft 1
    w.expert("e-uzak", [CAT.toplu]); // 2 adım → soft 0,5
    w.expert("e-mesgul", [CAT.toplu]); // 1 aktif görev
    w.expert("e-dusuk", [CAT.toplu], 0.3); // R < 0,5 → 0,5
    w.expert("e-yuksek", [CAT.toplu], 1.2);
    w.expert("e-karma", [CAT.toplu], 0.9); // 2 görev + soft 0,5
    w.graph.follow("e-takip", "author");
    w.graph.follow("e-uzak", "z-ara");
    w.graph.follow("z-ara", "author");
    w.graph.follow("e-karma", "z-ara");
    addLoad(w, "e-mesgul", 1);
    addLoad(w, "e-karma", 2);
    w.proposal("p-1", "author", [CAT.toplu]);

    const panel = await w.draw("p-1", "author", [CAT.toplu], { k: 6 });
    const c = Object.fromEntries(panel.candidates.map((x) => [x.userId, x]));
    expect(c["e-takip"]).toMatchObject({ weight: 0, softConflict: 1 });
    expect(c["e-takip"].excludedReason).toBeUndefined();
    expect(c["e-uzak"]).toMatchObject({ weight: 0.375, softConflict: 0.5 });
    expect(c["e-mesgul"]).toMatchObject({ weight: 0.375, softConflict: 0 });
    expect(c["e-dusuk"].weight).toBe(0.5);
    expect(c["e-yuksek"].weight).toBe(1.2);
    expect(c["e-karma"]).toMatchObject({ weight: 0.15, softConflict: 0.5 });
    // ağırlığı 0 olan (soft = 1) seçilemez
    expect(panel.assignments.map((a) => a.expertId)).not.toContain("e-takip");
    expect(panel.assignments).toHaveLength(5);
  });
});

describe("tohum ve belirlenimcilik (§8 adım 5–6)", () => {
  async function scenario(height: number) {
    const w = makeWorld();
    w.user("author");
    for (const id of ["e-a", "e-b", "e-c", "e-d", "e-e", "e-f"]) w.expert(id, [CAT.toplu]);
    w.proposal("p-1", "author", [CAT.toplu]);
    w.blocks(8);
    const b = w.ledger.getBlock(height)!;
    const panel = await w.draw("p-1", "author", [CAT.toplu], { k: 2, seedBlock: { height, hash: b.hash } });
    return { w, b, panel, selected: panel.assignments.map((a) => a.expertId) };
  }

  it("tohum = SHA256(blokHash | proposalId | round); seedSource kaydedilir", async () => {
    const { w, b, panel } = await scenario(3);
    expect(panel.seed).toBe(sha256Hex(`${b.hash}|p-1|1`));
    expect(panel.seed).toBe(drawSeed(b.hash, "p-1", 1));
    expect(panel.seedSource).toEqual({ blockHash: b.hash, blockHeight: 3, proposalId: "p-1", round: 1 });
    // seedBlock verilmezse son blok; tur sayısı artar
    const latest = w.ledger.latestBlock();
    const second = await w.draw("p-1", "author", [CAT.toplu], { k: 2 });
    expect(second.round).toBe(2);
    expect(second.seedSource).toEqual({ blockHash: latest.hash, blockHeight: latest.height, proposalId: "p-1", round: 2 });
    expect(second.seed).toBe(sha256Hex(`${latest.hash}|p-1|2`));
  });

  it("aynı seedBlock → aynı seçim; farklı blok hash → (genelde) farklı seçim", async () => {
    const a = await scenario(4);
    const b = await scenario(4);
    expect(a.b.hash).toBe(b.b.hash);
    expect(a.selected).toEqual(b.selected);
    expect(a.panel.seed).toBe(b.panel.seed);

    const outcomes = new Set<string>();
    for (let h = 1; h <= 8; h++) outcomes.add((await scenario(h)).selected.join(","));
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it("çekiliş API aday listesinden yeniden üretilebilir; EXPERT_DRAW'da ham kimlik yok", async () => {
    const { w, panel, selected } = await scenario(5);
    const tx = w.drawTxs().at(-1)!;
    expect(panel.ledgerTx).toBe(tx.hash);
    const payload = tx.payload as {
      proposalId: string;
      panelId: string;
      round: number;
      isCounter: boolean;
      seed: string;
      seedSource: unknown;
      candidates: { ref: string; weight: number; softConflict: number; excluded: boolean }[];
      selected: string[];
    };
    expect(payload).toMatchObject({ proposalId: "p-1", panelId: panel.panelId, round: 1, isCounter: false, seed: panel.seed, seedSource: panel.seedSource });
    const text = JSON.stringify(payload);
    // Tırnaklı tam değer aranır: kısa kimlikler ("e-c") rastgele panel UUID'sinin içinde tesadüfen geçebilir.
    for (const id of ["author", "e-a", "e-b", "e-c", "e-d", "e-e", "e-f", w.admin]) expect(text).not.toContain(JSON.stringify(id));

    // ref'ler API'deki aday listesinden yeniden hesaplanabilir
    expect(payload.candidates.map((c) => c.ref)).toEqual(panel.candidates.map((c) => candidateRef(c.userId, panel.panelId)));
    expect(payload.candidates.map((c) => c.weight)).toEqual(panel.candidates.map((c) => c.weight));
    expect(payload.selected).toEqual(selected.map((id) => candidateRef(id, panel.panelId)));

    // bağımsız doğrulama: aynı tohumla aynı kura
    const eligible = panel.candidates.filter((c) => c.weight > 0).map((c) => ({ id: c.userId, weight: c.weight }));
    expect(fakeMath.drawWeighted(eligible, 2, payload.seed).map((c) => c.id)).toEqual(selected);
  });

  it("seedBlock defterdeki blokla eşleşmeli; henüz işlenmemiş yükseklik reddedilir", async () => {
    const w = makeWorld();
    w.user("author");
    w.expert("e-1", [CAT.toplu]);
    w.proposal("p-1", "author", [CAT.toplu]);
    w.blocks(3);
    const mismatch = await catchAsync(w.draw("p-1", "author", [CAT.toplu], { seedBlock: { height: 2, hash: "ab".repeat(32) } }));
    expect(mismatch).toMatchObject({ status: 400, code: "seed_block_mismatch" });
    const pending = await catchAsync(w.draw("p-1", "author", [CAT.toplu], { seedBlock: { height: 99, hash: "cd".repeat(32) } }));
    expect(pending).toMatchObject({ status: 409, code: "seed_block_pending" });
    expect(w.svc.panel("p-1")).toBeNull();
  });

  it("geçersiz panel büyüklüğü / teslim zamanı / bilinmeyen öneri", async () => {
    const w = makeWorld();
    w.user("author");
    w.proposal("p-1", "author", [CAT.toplu]);
    expect(await catchAsync(w.draw("p-1", "author", [CAT.toplu], { k: 0 }))).toMatchObject({ status: 400, code: "invalid_panel_size" });
    expect(
      await catchAsync(w.svc.drawPanel("p-1", { categories: [CAT.toplu], authorId: "author", k: 3, dueAt: w.clock.now() })),
    ).toMatchObject({ status: 400, code: "invalid_due" });
    expect((await catchAsync(w.draw("yok", "author", [CAT.toplu]))).status).toBe(404);
  });
});

describe("üst kategoriye genişleme ve bilirkişi yokluğu (§8 adım 7)", () => {
  it("aday yoksa üst kategoriye genişler (kök sınıf hariç)", async () => {
    const w = makeWorld();
    w.user("author");
    w.expert("e-toplu", [CAT.toplu]);
    w.expert("e-metro", [CAT.metro]);
    w.expert("e-saglik", [CAT.saglik]);
    w.proposal("p-1", "author", [CAT.bisiklet]);
    const panel = await w.draw("p-1", "author", [CAT.bisiklet], { k: 3 });
    expect(panel.noExpertAvailable).toBe(false);
    expect(panel.candidates.map((c) => c.userId)).toEqual(["e-metro", "e-toplu"]);
    expect(panel.assignments.map((a) => a.expertId).sort()).toEqual(["e-metro", "e-toplu"]);
    expect(w.drawTxs().at(-1)!.payload.widened).toBe(1);
  });

  it("tüm aday havuzu dışlanmışsa da genişler", async () => {
    const w = makeWorld();
    w.expert("author", [CAT.bisiklet]);
    w.expert("e-toplu", [CAT.toplu]);
    w.proposal("p-1", "author", [CAT.bisiklet]);
    const panel = await w.draw("p-1", "author", [CAT.bisiklet], { k: 3 });
    expect(panel.assignments.map((a) => a.expertId)).toEqual(["e-toplu"]);
  });

  it("genişlemeye rağmen yoksa noExpertAvailable; panel ve defter kaydı yine oluşur, süreç durmaz", async () => {
    const w = makeWorld();
    w.user("author", "Yazar");
    w.expert("e-toplu", [CAT.toplu]);
    w.proposal("p-1", "author", [CAT.halk]);
    const panel = await w.draw("p-1", "author", [CAT.halk], { k: 3 });
    expect(panel.noExpertAvailable).toBe(true);
    expect(panel.candidates).toEqual([]);
    expect(panel.assignments).toEqual([]);
    expect(panel.ledgerTx).toBeTruthy();
    expect(w.drawTxs().at(-1)!.payload.selected).toEqual([]);
    expect(w.notifier.sent.some((n) => n.userId === "author" && n.kind === "expert_unavailable")).toBe(true);
    expect(w.svc.panel("p-1")?.panelId).toBe(panel.panelId);
  });
});

describe("görev yanıtı ve çekinme", () => {
  async function setup() {
    const w = makeWorld();
    w.user("author");
    for (const id of ["e-1", "e-2", "e-3", "e-4"]) w.expert(id, [CAT.toplu]);
    w.proposal("p-1", "author", [CAT.toplu]);
    const panel = await w.draw("p-1", "author", [CAT.toplu], { k: 2 });
    return { w, panel };
  }

  it("kabul: yalnız atanan bilirkişi; iki kez kabul edilemez", async () => {
    const { w, panel } = await setup();
    const a = panel.assignments[0];
    const other = panel.assignments[1].expertId;
    expect((await catchAsync(w.svc.respond(a.id, other, "accept"))).status).toBe(403);
    expect((await catchAsync(w.svc.respond("yok", a.expertId, "accept"))).status).toBe(404);
    const after = await w.svc.respond(a.id, a.expertId, "accept");
    expect(after.assignments.find((x) => x.id === a.id)?.status).toBe("accepted");
    expect((await catchAsync(w.svc.respond(a.id, a.expertId, "accept"))).code).toBe("invalid_state");
  });

  it("çekinme → aynı tohumdan türetilmiş yedek çekilişle kalan adaylardan biri davet edilir", async () => {
    const { w, panel } = await setup();
    const [a1, a2] = panel.assignments;
    const remaining = panel.candidates
      .filter((c) => c.weight > 0 && c.userId !== a1.expertId && c.userId !== a2.expertId)
      .map((c) => ({ id: c.userId, weight: c.weight }));
    const expected = fakeMath.drawWeighted(remaining, 1, `${panel.seed}|yedek|1`)[0].id;

    const after = await w.svc.respond(a1.id, a1.expertId, "recuse", "Yazarla aynı derneğin yönetimindeyim");
    expect(after.panelId).toBe(panel.panelId);
    expect(after.assignments.map((a) => [a.expertId, a.status])).toEqual([
      [a1.expertId, "recused"],
      [a2.expertId, "invited"],
      [expected, "invited"],
    ]);
    expect(after.assignments[2].dueAt).toBe(a1.dueAt);
    expect(w.db.get<{ recuse_reason: string }>("SELECT recuse_reason FROM expert_assignments WHERE id = ?", a1.id)?.recuse_reason).toBe(
      "Yazarla aynı derneğin yönetimindeyim",
    );
    expect(w.notifier.sent.some((n) => n.userId === expected && n.kind === "expert_invited")).toBe(true);
    const sub = w.drawTxs().at(-1)!.payload;
    expect(sub).toMatchObject({ substitute: 1, reason: "recused", seed: `${panel.seed}|yedek|1`, vacated: candidateRef(a1.expertId, panel.panelId) });
    expect(sub.selected).toEqual([candidateRef(expected, panel.panelId)]);
    expect(JSON.stringify(sub)).not.toContain(a1.expertId);

    // ikinci çekinme son kalan adayı getirir; üçüncüde havuz tükenir ve panel eksik kalır
    const third = after.assignments[2];
    const after2 = await w.svc.respond(third.id, third.expertId, "recuse");
    const last = after2.assignments[3];
    expect(last.status).toBe("invited");
    expect([a1.expertId, a2.expertId, third.expertId]).not.toContain(last.expertId);
    const after3 = await w.svc.respond(last.id, last.expertId, "recuse");
    expect(after3.assignments).toHaveLength(4);
    expect(after3.assignments.filter((a) => a.status === "invited")).toHaveLength(1);
    expect(w.drawTxs().at(-1)!.payload.selected).toEqual([]);
  });

  it("yanıt türü doğrulanır", async () => {
    const { w, panel } = await setup();
    const a = panel.assignments[0];
    expect(await catchAsync(w.svc.respond(a.id, a.expertId, "belki" as never))).toMatchObject({ status: 400, code: "invalid_decision" });
    expect(catchErr(() => w.svc.sanction(w.admin, a.expertId, "sürgün" as never, "x"))).toMatchObject({ status: 400 });
  });
});
