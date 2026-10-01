import { describe, it, expect } from "vitest";
import { blockHash, ed25519Verify, hashCanonical, precommitSignBytes, sha256Hex, verifyInclusionProof } from "@forum/shared";
import { IDS, chainOf, sleep, startLedger, waitFor } from "./util";

describe("defter / konsensüs", () => {
  it("işlemler bloklara girer, dört düğümün zinciri aynı, submitAndWait döner", async () => {
    const l = await startLedger();
    try {
      const first = await l.submitAndWait("PROPOSAL_CREATED", { proposalId: "p1", contentHash: sha256Hex("öneri") });
      expect(first.height).toBe(1);
      expect(first.index).toBe(0);
      expect(first.blockHash).toMatch(/^[0-9a-f]{64}$/);
      expect(first.sig).toMatch(/^[0-9a-f]{128}$/);
      expect(l.getTx(first.hash)).toEqual(first);

      const hashes = Array.from({ length: 30 }, (_, i) => l.submit("VOTE_COMMIT", { proposalId: "p1", ballotId: `b${i}`, commitment: sha256Hex(`c${i}`) }).txHash);
      await l.flush();
      for (const h of hashes) expect(l.getTx(h)).not.toBeNull();

      const ref = chainOf(l, "v0");
      expect(ref.length).toBe(l.latestBlock().height);
      expect(l.latestBlock().hash).toBe(ref[ref.length - 1]);
      for (const id of IDS) expect(chainOf(l, id)).toEqual(ref);

      const blocks = l.listBlocks({ limit: 100 });
      expect(blocks.map((b) => b.height)).toEqual(ref.map((_, i) => ref.length - i)); // yeniden eskiye
      let prevTime = Infinity;
      for (const b of blocks) {
        expect(b.txCount).toBeGreaterThan(0); // boş blok yok
        expect(b.txs).toHaveLength(b.txCount);
        expect(b.commitSigs.length).toBeGreaterThanOrEqual(3);
        expect(blockHash(b)).toBe(b.hash);
        expect(b.proposer).toBe(`v${(b.height + b.round) % 4}`);
        expect(b.time).toBeLessThan(prevTime);
        prevTime = b.time;
      }
      expect(l.listBlocks({ from: 1, limit: 5 }).map((b) => b.height)).toEqual([1]);

      const byProposal = l.findTxs({ proposalId: "p1" });
      expect(byProposal).toHaveLength(31);
      expect(byProposal[byProposal.length - 1].hash).toBe(first.hash); // en eski en sonda
      expect(byProposal[0].height).toBeGreaterThanOrEqual(byProposal[30].height);
      expect(l.findTxs({ type: "VOTE_COMMIT", limit: 5 })).toHaveLength(5);
      expect(l.findTxs({ type: "PROPOSAL_CREATED" }).map((t) => t.hash)).toEqual([first.hash]);
      expect(l.findTxs({ proposalId: "p1", type: "PROPOSAL_CREATED" })).toHaveLength(1);
      expect(l.findTxs({ proposalId: "yok" })).toEqual([]);

      const st = l.status();
      expect(st).toMatchObject({ mode: "in-process", height: ref.length, mempool: 0, quorum: 3, faultTolerance: 1, sameMachineNotice: true });
      expect(st.validators.map((v) => v.id)).toEqual(IDS);
      for (const v of st.validators) {
        expect(v).toMatchObject({ height: ref.length, lastHash: ref[ref.length - 1], fault: "none", healthy: true, operator: "Aynı makine (demo)" });
        expect(v.publicKey).toMatch(/^[0-9a-f]{64}$/);
      }
      expect(new Set(st.validators.map((v) => v.publicKey)).size).toBe(4);
      expect(l.verifyChain().every((v) => v.ok && v.checkedBlocks === ref.length)).toBe(true);

      // Havuz boşken yeni blok üretilmez.
      await sleep(150);
      expect(l.latestBlock().height).toBe(ref.length);
    } finally {
      await l.stop();
    }
  });

  it("tekilleştirme: aynı (type, payload) aynı özeti verir ve zincirde bir kez yer alır", async () => {
    const l = await startLedger();
    try {
      const a = l.submit("SPONSORED", { proposalId: "p2", count: 1 });
      const b = l.submit("SPONSORED", { count: 1, proposalId: "p2" }); // anahtar sırası önemsiz
      expect(b.txHash).toBe(a.txHash);
      const payload = { proposalId: "p2", count: 1 };
      const nonce = hashCanonical({ type: "SPONSORED", payload }).slice(0, 32);
      expect(a.txHash).toBe(hashCanonical({ type: "SPONSORED", payload, nonce }));
      await l.flush();
      const height = l.latestBlock().height;

      expect(l.submit("SPONSORED", { proposalId: "p2", count: 1 }).txHash).toBe(a.txHash); // işlendikten sonra da
      await l.flush();
      expect(l.latestBlock().height).toBe(height);
      expect(l.findTxs({ proposalId: "p2" })).toHaveLength(1);
      for (const id of IDS) {
        let seen = 0;
        for (let h = 1; h <= height; h++) seen += l.getBlock(h, id)!.txs.filter((t) => t.hash === a.txHash).length;
        expect(seen).toBe(1);
      }

      const c = l.submit("SPONSORED", { proposalId: "p2", count: 1, _nonce: "ikinci" });
      expect(c.txHash).not.toBe(a.txHash);
      const [x, y] = await Promise.all([l.submitAndWait("TALLY", { proposalId: "p2" }), l.submitAndWait("TALLY", { proposalId: "p2" })]);
      expect(x).toEqual(y);
      expect(l.getTx(c.txHash)!.nonce).toBe("ikinci");
    } finally {
      await l.stop();
    }
  });

  it("bir düğüm çökünce canlılık sürer; geri gelince eşlerinden senkronlanır", async () => {
    const l = await startLedger();
    try {
      l.setFault("v3", "crash");
      for (let i = 0; i < 6; i++) await l.submitAndWait("MESSAGE_POSTED", { topicId: "t1", contentHash: sha256Hex(`m${i}`) });
      await l.flush();
      const st = l.status();
      const v3 = st.validators.find((v) => v.id === "v3")!;
      expect(st.height).toBeGreaterThanOrEqual(6);
      expect(v3.height).toBeLessThan(st.height);
      expect(v3.healthy).toBe(false);
      expect(chainOf(l, "v1")).toEqual(chainOf(l, "v0"));

      l.setFault("v3", "none");
      await waitFor(() => l.validator("v3").height() === l.latestBlock().height, "v3 senkronu");
      expect(chainOf(l, "v3")).toEqual(chainOf(l, "v0"));

      // Geri gelen düğüm konsensüse yeniden katılır.
      await l.submitAndWait("MESSAGE_POSTED", { topicId: "t1", contentHash: sha256Hex("son") });
      await l.flush();
      const ref = chainOf(l, "v0");
      for (const id of IDS) expect(chainOf(l, id)).toEqual(ref);
      expect(l.verifyChain().every((v) => v.ok)).toBe(true);
    } finally {
      await l.stop();
    }
  });

  it("öneren çökünce tur değişimiyle ilerlenir (round > 0 olan blok)", async () => {
    const l = await startLedger();
    try {
      await l.submitAndWait("PHASE_CHANGED", { proposalId: "p4", to: "discussion" });
      await l.flush();
      const next = l.latestBlock().height + 1;
      const proposer = `v${next % 4}`;
      l.setFault(proposer, "crash");
      const c = await l.submitAndWait("PHASE_CHANGED", { proposalId: "p4", to: "voting" });
      expect(c.height).toBe(next);
      const b = l.getBlock(c.height)!;
      expect(b.round).toBeGreaterThan(0);
      expect(b.proposer).not.toBe(proposer);
      expect(b.proposer).toBe(`v${(next + b.round) % 4}`);
      expect(verifyInclusionProof(l.proof(c.hash)!).ok).toBe(true);

      l.setFault(proposer, "none");
      await waitFor(() => l.validator(proposer).height() === l.latestBlock().height, "öneren senkronu");
      expect(chainOf(l, proposer)).toEqual(chainOf(l, "v0"));
    } finally {
      await l.stop();
    }
  });

  it("çoğunluk yoksa (2 düğüm çöktü) işlem işlenmez; zaman aşımı ve durdurma hataları", async () => {
    const l = await startLedger();
    try {
      await l.submitAndWait("GRAPH_RUN", { run: 1 });
      l.setFault("v2", "crash");
      l.setFault("v3", "crash");
      await expect(l.submitAndWait("GRAPH_RUN", { run: 2 }, 300)).rejects.toMatchObject({ status: 504, code: "ledger_timeout" });
      expect(l.latestBlock().height).toBe(1);
      const pending = l.submitAndWait("GRAPH_RUN", { run: 3 }, 10_000);
      l.setFault("v3", "none"); // nisap geri geldi
      const c = await pending;
      expect(c.height).toBeGreaterThan(1);
      const waiting = l.submitAndWait("GRAPH_RUN", { run: 4 }, 10_000);
      l.setFault("v0", "crash");
      l.setFault("v1", "crash");
      await sleep(20);
      await l.stop();
      await expect(waiting).rejects.toMatchObject({ status: 503, code: "ledger_stopped" });
    } finally {
      await l.stop();
    }
  });

  it("bizans düğüm: güvenlik korunur ve çift imza EVIDENCE işlemi olarak zincire girer", async () => {
    const l = await startLedger();
    try {
      l.setFault("v1", "byzantine");
      const committed: string[] = [];
      for (let i = 0; i < 8; i++) committed.push((await l.submitAndWait("VOTE_COMMIT", { proposalId: "p5", ballotId: `b${i}` }, 15_000)).hash);
      await waitFor(() => l.findTxs({ type: "EVIDENCE" }).length > 0, "EVIDENCE işlemi");
      await l.flush();

      const ev = l.findTxs({ type: "EVIDENCE" })[0];
      const p = ev.payload as { validator: string; height: number; round: number; voteA: { blockHash: string | null; sig: string }; voteB: { blockHash: string | null; sig: string } };
      expect(Object.keys(p).sort()).toEqual(["height", "round", "validator", "voteA", "voteB"]);
      expect(p.validator).toBe("v1");
      expect(p.voteA.blockHash).not.toBe(p.voteB.blockHash);
      const pk = l.status().validators.find((v) => v.id === "v1")!.publicKey;
      for (const v of [p.voteA, p.voteB]) expect(ed25519Verify(v.sig, precommitSignBytes(p.height, p.round, v.blockHash), pk)).toBe(true);

      // Güvenlik: hiçbir düğümde aynı yükseklikte iki farklı blok yok.
      const ref = chainOf(l, "v0");
      for (const id of ["v2", "v3"]) expect(chainOf(l, id)).toEqual(ref);
      const byz = chainOf(l, "v1");
      byz.forEach((h, i) => expect(h).toBe(ref[i]));
      for (const h of committed) expect(l.getTx(h)).not.toBeNull();
      expect(l.verifyChain().every((v) => v.ok)).toBe(true);
      expect(l.status().validators.find((v) => v.id === "v1")!.healthy).toBe(false);

      // Bizans önerenin (çift/geçersiz öneri) turları başarısız olur; ilerleme sonraki turlarda sağlanır.
      const blocks = ref.map((_, i) => l.getBlock(i + 1)!);
      for (const b of blocks) expect(b.proposer).not.toBe("v1");
      expect(blocks.some((b) => b.round > 0)).toBe(true);

      l.setFault("v1", "none");
      await l.submitAndWait("VOTE_COMMIT", { proposalId: "p5", ballotId: "son" });
      await l.flush();
      await waitFor(() => l.validator("v1").height() === l.latestBlock().height, "v1 eşitlenmesi");
      const fin = chainOf(l, "v0");
      for (const id of IDS) expect(chainOf(l, id)).toEqual(fin);
    } finally {
      await l.stop();
    }
  });
});
