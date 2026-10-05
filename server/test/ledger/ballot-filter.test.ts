// GET /api/ledger/txs pusula süzgeci (test döngüsü tur 1): "Oyum kayıtlı mı?" son taahhüt denetimi yalnız en yeni 500 VOTE_COMMIT'e
// bakıyordu; 500'den fazla oy alan oylamada erken oy verenin taahhüdü listenin dışında kalıyor, geçersizleşmiş makbuza "Şimdilik
// doğrulandı" deniyordu. Artık istemci listeyi ballotId (+round) ile bu pusulaya daraltır; liste kesilmez ve sonuç kesindir.
import { afterEach, describe, expect, it } from "vitest";
import { sha256Hex } from "@forum/shared";
import { boot, type Harness } from "../http/harness";
import { startLedger } from "./util";

describe("findTxs: ballotId / round süzgeci", () => {
  it("yalnız o pusulanın (ve turun) işlemleri döner; süzgeç sınıra sayılmayan işlemleri atlar, en yeniden eskiye sıralar", async () => {
    const l = await startLedger();
    try {
      // b0'ın iki taahhüdü (oy değişikliği) önce, ardından başka pusulaların 40 taahhüdü: b0 en yeni 10'un dışında kalır.
      const mine = [
        l.submit("VOTE_COMMIT", { proposalId: "p1", round: 1, ballotId: "b0", commitment: sha256Hex("ilk") }).txHash,
        l.submit("VOTE_COMMIT", { proposalId: "p1", round: 1, ballotId: "b0", commitment: sha256Hex("ikinci") }).txHash,
      ];
      await l.flush();
      for (let i = 1; i <= 40; i++) l.submit("VOTE_COMMIT", { proposalId: "p1", round: 1, ballotId: `b${i}`, commitment: sha256Hex(`c${i}`) });
      const r2 = l.submit("VOTE_COMMIT", { proposalId: "p1", round: 2, ballotId: "b0", commitment: sha256Hex("tur2") }).txHash;
      l.submit("VOTE_COMMIT", { proposalId: "p2", round: 1, ballotId: "b0", commitment: sha256Hex("baska-oneri") });
      await l.flush();

      // Süzgeçsiz en yeni 10: b0'ın 1. tur taahhütleri yok (eski davranışın kör noktası).
      const newest = l.findTxs({ type: "VOTE_COMMIT", proposalId: "p1", limit: 10 });
      expect(newest.some((t) => (t.payload as { ballotId: string; round: number }).ballotId === "b0" && (t.payload as { round: number }).round === 1)).toBe(false);

      const filtered = l.findTxs({ type: "VOTE_COMMIT", proposalId: "p1", ballotId: "b0", round: 1, limit: 10 });
      expect(filtered.map((t) => t.hash)).toEqual([...mine].reverse()); // en yeni önce
      expect(filtered.every((t) => (t.payload as { ballotId: string }).ballotId === "b0")).toBe(true);

      // Tur süzgeci ve yalnız pusula süzgeci
      expect(l.findTxs({ proposalId: "p1", ballotId: "b0", round: 2 }).map((t) => t.hash)).toEqual([r2]);
      expect(l.findTxs({ proposalId: "p1", ballotId: "b0" }).map((t) => t.hash)).toEqual([r2, ...[...mine].reverse()]);
      // Sınır süzgeçten SONRA uygulanır
      expect(l.findTxs({ proposalId: "p1", ballotId: "b0", limit: 1 }).map((t) => t.hash)).toEqual([r2]);
      expect(l.findTxs({ proposalId: "p1", ballotId: "yok" })).toEqual([]);
      // Süzgeçsiz davranış değişmez
      expect(l.findTxs({ proposalId: "p1" })).toHaveLength(43);
    } finally {
      await l.stop();
    }
  });
});

describe("GET /api/ledger/txs?ballotId=&round=", () => {
  let h: Harness | null = null;
  afterEach(async () => {
    await h?.close();
    h = null;
  });

  it("süzgeç proposalId ister (öneri dizini taranır, zincirin tamamı değil); geçerli istek süzülmüş liste döner", async () => {
    h = await boot();
    const noProposal = await h.req("GET", "/api/ledger/txs?type=VOTE_COMMIT&ballotId=abc");
    expect(noProposal.statusCode).toBe(400);
    expect(noProposal.json().error.code).toBe("validation");
    expect(noProposal.json().error.details.ballotId).toMatch(/proposalId/);
    const roundOnly = await h.req("GET", "/api/ledger/txs?round=1");
    expect(roundOnly.statusCode).toBe(400);
    expect(roundOnly.json().error.details.round).toMatch(/proposalId/);
    const badRound = await h.req("GET", "/api/ledger/txs?proposalId=p&round=3");
    expect(badRound.statusCode).toBe(400);

    h.services.ledger.submit("VOTE_COMMIT", { proposalId: "px", round: 1, ballotId: "b-a", commitment: sha256Hex("a") });
    h.services.ledger.submit("VOTE_COMMIT", { proposalId: "px", round: 1, ballotId: "b-b", commitment: sha256Hex("b") });
    await h.services.ledger.flush();
    const list = await h.ok<{ payload: { ballotId: string } }[]>("GET", "/api/ledger/txs?type=VOTE_COMMIT&proposalId=px&ballotId=b-a&round=1&limit=500");
    expect(list.map((t) => t.payload.ballotId)).toEqual(["b-a"]);
    expect(await h.ok("GET", "/api/ledger/txs?type=VOTE_COMMIT&proposalId=px&ballotId=b-a&round=2")).toEqual([]);
  });
});
