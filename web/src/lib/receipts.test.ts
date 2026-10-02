// Oy makbuzlarının cihaz paylaşımında gizliliği: çıkış yapılmış (misafir) ziyaretçi başkalarının makbuzunu (seçim + tuz)
// göremez; temizleme yalnızca geçerli sahibin kayıtlarını siler. Bkz. bulgular #219, #237.
import type { BallotReceipt } from "@forum/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { PREF_KEYS, removePref } from "./prefs";
import { clearReceipts, exportReceipts, importReceipts, latestReceipt, listReceipts, saveReceipt, setReceiptOwner } from "./receipts";

function receipt(proposalId: string, choice: "yes" | "no", salt: string, castAt: number): BallotReceipt {
  return {
    proposalId,
    round: 1,
    ballotId: `ballot-${proposalId}-${castAt}`,
    commitment: `c-${salt}`,
    castAt,
    choice,
    salt,
  } as unknown as BallotReceipt;
}

describe("oy makbuzları: cihazı paylaşan kullanıcılar", () => {
  beforeEach(async () => {
    setReceiptOwner(null);
    await removePref(PREF_KEYS.receipts);
  });

  it("çıkış yapmış ziyaretçi başkalarının makbuzunu (seçim ve tuz) görmez", async () => {
    setReceiptOwner("alice");
    await saveReceipt(receipt("p1", "yes", "SALT-ALICE", 1));
    setReceiptOwner("bob");
    await saveReceipt(receipt("p1", "no", "SALT-BOB", 2));

    setReceiptOwner(null); // çıkış
    expect(await listReceipts()).toEqual([]);
    expect(await latestReceipt("p1")).toBeNull();
    expect(await exportReceipts()).not.toContain("SALT-");

    setReceiptOwner("alice");
    expect((await listReceipts()).map((r) => r.salt)).toEqual(["SALT-ALICE"]);
    setReceiptOwner("bob");
    expect((await listReceipts()).map((r) => r.salt)).toEqual(["SALT-BOB"]);
  });

  it("sahipsiz (misafirin elle aktardığı) makbuzlar misafire görünür; aynı makbuzu aktarmak sahipli kaydı sahipsiz yapmaz", async () => {
    setReceiptOwner("alice");
    await saveReceipt(receipt("p1", "yes", "SALT-ALICE", 1));
    setReceiptOwner(null);
    expect(await importReceipts(JSON.stringify([receipt("p1", "yes", "SALT-ALICE", 1), receipt("p2", "no", "SALT-GUEST", 3)]))).toBe(2);
    // Misafir yalnızca kendi aktardığını (sahipsiz kopyaları) görür; Alice'in sahipli kaydı sahipli kalır.
    expect((await listReceipts()).map((r) => r.salt).sort()).toEqual(["SALT-ALICE", "SALT-GUEST"]);
    setReceiptOwner("bob");
    expect((await listReceipts()).map((r) => r.ownerId ?? null)).toEqual([null, null]);
    setReceiptOwner("alice");
    expect((await listReceipts()).filter((r) => r.ownerId === "alice")).toHaveLength(1);
  });

  it("clearReceipts yalnızca geçerli sahibin makbuzlarını siler; misafirken kimsenin sahipli makbuzuna dokunmaz", async () => {
    setReceiptOwner("alice");
    await saveReceipt(receipt("p1", "yes", "SALT-ALICE", 1));
    setReceiptOwner("bob");
    await saveReceipt(receipt("p1", "no", "SALT-BOB", 2));

    setReceiptOwner(null);
    await clearReceipts(); // oturum yok: sahipli hiçbir kayıt silinmemeli
    setReceiptOwner("alice");
    expect(await listReceipts()).toHaveLength(1);

    await clearReceipts(); // Alice kendi makbuzlarını siler
    expect(await listReceipts()).toHaveLength(0);
    setReceiptOwner("bob");
    expect((await listReceipts()).map((r) => r.salt)).toEqual(["SALT-BOB"]);
  });
});
