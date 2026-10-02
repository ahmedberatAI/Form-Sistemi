// Kalıcı kaybeden küme durumu: eşikler shared/limits.ts'ten gelir; Ana sayfa göstergesiyle aynı sınıflandırma.
import { LOSER_MIN_DECISIONS, LOSER_WARN_SHARE } from "@forum/shared";
import { describe, expect, it } from "vitest";
import { LOSER_STATUS_LABELS, loserStatus } from "./loserStatus";

describe("kalıcı kaybeden küme durumu", () => {
  it("eşikler yönetmelik değerleridir (%75, en az 3 karar)", () => {
    expect(LOSER_WARN_SHARE).toBe(0.75);
    expect(LOSER_MIN_DECISIONS).toBe(3);
  });

  it("karar sayısı yetersizse oran ne olursa olsun 'Yetersiz veri'", () => {
    expect(loserStatus({ lostShare: 1, decisions: 2 })).toBe("insufficient");
    expect(loserStatus({ lostShare: 0, decisions: 0 })).toBe("insufficient");
    expect(loserStatus({ lostShare: 0.9, decisions: LOSER_MIN_DECISIONS - 1 })).toBe("insufficient");
  });

  it("yeterli kararda eşiğe ulaşan küme 'Uyarı' (eşik dahil)", () => {
    expect(loserStatus({ lostShare: LOSER_WARN_SHARE, decisions: LOSER_MIN_DECISIONS })).toBe("warning");
    expect(loserStatus({ lostShare: 1, decisions: 10 })).toBe("warning");
  });

  it("yeterli kararda eşiğin altı 'Olağan'", () => {
    expect(loserStatus({ lostShare: 0.74, decisions: 10 })).toBe("normal");
    expect(loserStatus({ lostShare: 0, decisions: LOSER_MIN_DECISIONS })).toBe("normal");
  });

  it("etiketler Ana sayfa göstergesindeki rozet metinleriyle aynıdır", () => {
    expect(LOSER_STATUS_LABELS).toEqual({ warning: "Uyarı", insufficient: "Yetersiz veri", normal: "Olağan" });
  });
});
