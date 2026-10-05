// "Oyum kayıtlı mı?" 4. adım (checkLatestCommit): sunucunun taahhüt listesi en yeni 500 işlemle sınırlıdır. Makbuzun taahhüdü bu
// pencerenin dışında kaldığında "henüz bloğa girmiş taahhüt yok" (bekliyor) DENMEZ ve genel kutu "Şimdilik doğrulandı" demez:
// sonuç alınamadı ("unknown"). Listede makbuzdan daha yeni bir taahhüt varsa makbuz kesin olarak geçersizdir.
import { ledgerTxHash, type CommittedTxView } from "@forum/shared";
import { describe, expect, it, vi } from "vitest";
import { checkLatestCommit, latestAfterClose } from "./VerifyVotePage";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: null, can: () => false, now: () => Date.UTC(2026, 9, 5) }),
  useServerNow: () => () => Date.UTC(2026, 9, 5),
}));

const P = "prop-30";

function tx(i: number, ballotId: string, height: number, over: { proposalId?: string; round?: number } = {}): CommittedTxView {
  const body = { type: "VOTE_COMMIT" as const, payload: { proposalId: over.proposalId ?? P, round: over.round ?? 1, ballotId, commitment: `c${i}` }, nonce: `n${i}` };
  const hash = ledgerTxHash(body);
  return { ...body, submittedAt: 0, sig: "00", hash, height, index: 0, blockHash: "bb", blockTime: 0 };
}

/** En yeniden eskiye, `n` işlemlik liste (sunucu findTxs sırası); başka pusulalar. */
const others = (n: number, fromHeight: number) => Array.from({ length: n }, (_, i) => tx(10_000 + i, `diger-${i}`, fromHeight - i));

describe("checkLatestCommit", () => {
  const mineOld = tx(1, "derya", 299); // makbuz A (Kabul)
  const mineNew = tx(2, "derya", 305); // makbuz B (Red, geçerli)
  const receiptA = { proposalId: P, round: 1 as const, ballotId: "derya", txHash: mineOld.hash };
  const receiptB = { proposalId: P, round: 1 as const, ballotId: "derya", txHash: mineNew.hash };

  it("liste kesilmiş (500) ve makbuzun işlemi dışında kalmış: 'bekliyor' değil 'sonuç alınamadı'", () => {
    const list = others(500, 900);
    expect(checkLatestCommit(receiptB, list, { height: 305, index: 0 })).toEqual({ status: "unknown", reason: "truncated" });
  });

  it("liste kesilmiş ama makbuzdan daha yeni taahhüt listede: eski makbuz kesin olarak geçersiz", () => {
    const list = [...others(499, 900), mineNew];
    const c = checkLatestCommit(receiptA, list, { height: 299, index: 0 });
    expect(c.status).toBe("fail");
    expect(c.status === "fail" && c.reason === "newer" && c.last.hash).toBe(mineNew.hash);
  });

  it("makbuz listede ve en sonuncu: ✔; liste kesilmişse taahhüt sayısı yazılmaz (eksik sayılabilir)", () => {
    const truncated = [...others(498, 900), mineNew, mineOld];
    expect(checkLatestCommit(receiptB, truncated, { height: 305, index: 0 })).toMatchObject({ status: "ok", count: null });
    const full = [mineNew, mineOld, ...others(3, 900)];
    expect(checkLatestCommit(receiptB, full, { height: 305, index: 0 })).toMatchObject({ status: "ok", count: 2 });
    expect(checkLatestCommit(receiptA, full, { height: 299, index: 0 })).toMatchObject({ status: "fail", reason: "newer" });
  });

  it("liste tam ve makbuzun işlemi bloğa girmemiş (2. adım 404): bekliyor", () => {
    expect(checkLatestCommit(receiptB, others(3, 900), null)).toEqual({ status: "pending" });
  });

  it("liste tam ama bloğa girmiş işlem listede yok: liste eksik — sonuç alınamadı", () => {
    expect(checkLatestCommit(receiptB, others(3, 900), { height: 305, index: 0 })).toEqual({ status: "unknown", reason: "missing" });
  });

  it("sunucu süzgecine güvenilmez: başka öneri ya da turdaki aynı pusula kimliği sayılmaz", () => {
    const foreign = tx(3, "derya", 400, { proposalId: "baska" });
    const round2 = tx(4, "derya", 401, { round: 2 });
    expect(checkLatestCommit(receiptB, [round2, foreign, mineNew], { height: 305, index: 0 })).toMatchObject({ status: "ok", count: 1 });
  });

  it("içeriği özetiyle eşleşmeyen taahhüt listeyi güvenilmez kılar", () => {
    const bad = { ...mineNew, payload: { ...mineNew.payload, commitment: "sahte" } };
    expect(checkLatestCommit(receiptB, [bad], { height: 305, index: 0 })).toMatchObject({ status: "fail", reason: "unbound" });
  });
});

describe("latestAfterClose: oylama kapanınca sonuçsuz 4. adım defterden kesinleşir", () => {
  const L = (over: Partial<Parameters<typeof latestAfterClose>[0]> = {}) => ({ complete: true, commitsPending: 0, commitProblems: [], commitments: { derya: "c-son" }, ...over });
  it("son taahhüt makbuzunkiyle aynıysa ✔, farklıysa ✘ (daha yeni oy)", () => {
    expect(latestAfterClose(L(), "derya", "c-son")).toBe("ok");
    expect(latestAfterClose(L(), "derya", "c-eski")).toBe("fail");
  });
  it("veriler kesin değilse (geçici hata, bekleyen ya da sorunlu işlem) ya da pusula yoksa karar verilmez", () => {
    expect(latestAfterClose(L({ complete: false }), "derya", "c-son")).toBeNull();
    expect(latestAfterClose(L({ commitsPending: 1 }), "derya", "c-son")).toBeNull();
    expect(latestAfterClose(L({ commitProblems: ["x"] }), "derya", "c-son")).toBeNull();
    expect(latestAfterClose(L(), "baska", "c-son")).toBeNull();
  });
});
