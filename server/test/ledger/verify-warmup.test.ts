// Regresyon: kimliksiz GET /api/ledger/verify'ın yeniden başlatma sonrası ilk (soğuk) çağrısı sunucuyu kilitlemez.
//  - İmzalar yerel (OpenSSL) Ed25519 ile doğrulanır; sonuç @noble doğrulamasıyla aynıdır (geçerli/bozuk/biçimsiz girdi).
//  - Diskten yüklenen zincirin tam doğrulama önbelleği açılışta arka planda, olay döngüsüne yol vererek ısıtılır; ısınınca
//    verifyChain hiçbir bloğu yeniden doğrulamaz.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ed25519PublicKey, ed25519RandomSecretKey, ed25519Sign, ed25519Verify, hexToBytes, sha256Hex } from "@forum/shared";
import { createInProcessLedger } from "../../src/ledger";
import { ed25519VerifyNative } from "../../src/ledger/tx";
import { makeCtx } from "../helpers/fakes";
import { FAST, IDS, waitFor } from "./util";

describe("defter: yerel Ed25519 doğrulaması", () => {
  it("@noble doğrulamasıyla aynı sonucu verir; biçimsiz girdi false (hata fırlatmaz)", () => {
    const sk = ed25519RandomSecretKey();
    const pk = ed25519PublicKey(sk);
    const otherPk = ed25519PublicKey(ed25519RandomSecretKey());
    for (let i = 0; i < 50; i++) {
      const msg = hexToBytes(sha256Hex(`ileti-${i}`));
      const sig = ed25519Sign(msg, sk);
      const flipped = sig.slice(0, 20) + (sig[20] === "0" ? "1" : "0") + sig.slice(21);
      const otherMsg = hexToBytes(sha256Hex(`baska-${i}`));
      for (const [s, m, k] of [
        [sig, msg, pk],
        [flipped, msg, pk],
        [sig, otherMsg, pk],
        [sig, msg, otherPk],
        [sig.toUpperCase(), msg, pk.toUpperCase()],
      ] as const) {
        expect(ed25519VerifyNative(s, m, k)).toBe(ed25519Verify(s, m, k));
      }
      expect(ed25519VerifyNative(sig, msg, pk)).toBe(true);
    }
    const msg = hexToBytes(sha256Hex("x"));
    const sig = ed25519Sign(msg, sk);
    expect(ed25519VerifyNative("zz".repeat(64), msg, pk)).toBe(false);
    expect(ed25519VerifyNative(sig.slice(0, 126), msg, pk)).toBe(false);
    expect(ed25519VerifyNative(sig, msg, "kisa")).toBe(false);
    expect(ed25519VerifyNative(sig, msg, "g".repeat(64))).toBe(false);
  });
});

describe("defter: açılışta doğrulama önbelleği ısıtılır", () => {
  it("diskten yüklenen zincir arka planda doğrulanır; sonra verifyChain hiçbir bloğu yeniden doğrulamaz", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "defter-isitma-"));
    try {
      const l1 = createInProcessLedger(makeCtx({ dataDir: dir }), FAST);
      await l1.start();
      for (let i = 0; i < 8; i++) await l1.submitAndWait("DELEGATION", { delegationId: `d${i}`, scope: "*" });
      await l1.flush();
      await l1.stop();

      const l2 = createInProcessLedger(makeCtx({ dataDir: dir }), FAST);
      try {
        const height = l2.latestBlock().height;
        expect(height).toBeGreaterThan(0);
        await l2.start();
        // Isıtma başlangıçta yüklenen tüm blokları her düğümde doğrular (olay döngüsüne yol vererek).
        await waitFor(() => l2.verifiedBlockCount() >= height * IDS.length, "ısıtma");
        const before = l2.verifiedBlockCount();
        const top = l2.latestBlock().height;
        const r = l2.verifyChain();
        expect(r.every((v) => v.ok)).toBe(true);
        // Isıtmadan sonra eklenmiş olabilecek bloklar dışında yeniden doğrulama yok.
        expect(l2.verifiedBlockCount() - before).toBeLessThanOrEqual((top - height) * IDS.length);
      } finally {
        await l2.stop();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("boş defterle açılışta ısıtma yapılmaz (ilk verifyChain tüm blokları kendisi doğrular)", async () => {
    const l = createInProcessLedger(makeCtx(), FAST);
    await l.start();
    try {
      await new Promise((r) => setTimeout(r, 20));
      expect(l.verifiedBlockCount()).toBe(0);
    } finally {
      await l.stop();
    }
  });
});
