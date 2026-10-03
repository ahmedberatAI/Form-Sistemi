// Tartışma saf mantığı: tek satır istatistik, köprü skoru notu, yazma kutusunun kapısı ve açık-kapalı kararı.
import type { MessageView } from "@forum/shared";
import { describe, expect, it } from "vitest";
import { blockedNote, bridgeNote, composerGate, composerIsOpen, discussionStats, stanceSummary, UNVERIFIED_NOTE } from "./discussionLogic";

type Row = Pick<MessageView, "stance" | "visibility">;
const row = (stance: Row["stance"], visibility: Row["visibility"] = "visible"): Row => ({ stance, visibility });

describe("discussionStats ve stanceSummary", () => {
  it("görünür mesajları tutuma göre sayar; hidden ve sealed ayrı sayılır, collapsed görünürdür", () => {
    const { counts, hidden } = discussionStats([row("pro"), row("pro"), row("con"), row("question"), row("pro", "hidden"), row("neutral", "sealed"), row("con", "collapsed")]);
    expect(counts).toEqual({ pro: 2, con: 2, neutral: 0, question: 1 });
    expect(hidden).toBe(2);
  });

  it("sıfırlar yazılmaz: 'Lehte 2 · Aleyhte 1 · Soru 1'", () => {
    expect(stanceSummary({ pro: 2, con: 1, neutral: 0, question: 1 })).toBe("Lehte 2 · Aleyhte 1 · Soru 1");
    expect(stanceSummary({ pro: 0, con: 0, neutral: 3, question: 0 })).toBe("Nötr 3");
  });

  it("karar ile gizlenen varsa sona eklenir; yalnız gizlenen mesaj varsa yalnız o yazılır", () => {
    expect(stanceSummary({ pro: 1, con: 0, neutral: 0, question: 0 }, 2)).toBe("Lehte 1 · Karar ile gizlenen 2");
    expect(stanceSummary({ pro: 0, con: 0, neutral: 0, question: 0 }, 1)).toBe("Karar ile gizlenen 1");
  });

  it("mesaj yoksa boş dize (satır çizilmez)", () => {
    const { counts, hidden } = discussionStats([]);
    expect(stanceSummary(counts, hidden)).toBe("");
  });
});

describe("bridgeNote", () => {
  it("skor hiçbir mesajda yoksa nedenini söyler; skor varsa ya da mesaj yoksa null", () => {
    expect(bridgeNote(3, false)).toContain("en az iki anlamlı görüş grubu");
    expect(bridgeNote(3, true)).toBeNull();
    expect(bridgeNote(0, false)).toBeNull();
  });
});

describe("composerGate", () => {
  const verified = { status: "verified" as const };

  it("sıra: anonim → doğrulanmamış → kapalı → açık", () => {
    expect(composerGate({ user: null, canVerify: false, closedReason: "x", mode: "new" })).toEqual({ kind: "anonymous" });
    expect(composerGate({ user: { status: "pending" }, canVerify: false, closedReason: "x", mode: "new" })).toEqual({ kind: "blocked", text: UNVERIFIED_NOTE });
    expect(composerGate({ user: verified, canVerify: true, closedReason: "Bu konu arşivlendi; yeni mesaj yazılamaz.", mode: "new" })).toEqual({
      kind: "closed",
      text: "Bu konu arşivlendi; yeni mesaj yazılamaz.",
    });
    expect(composerGate({ user: verified, canVerify: true, closedReason: null, mode: "new" })).toEqual({ kind: "open" });
  });

  it("yazma kapalıyken yanıt da kapalıdır, düzenleme değildir", () => {
    expect(composerGate({ user: verified, canVerify: true, closedReason: "taslak", mode: "reply" }).kind).toBe("closed");
    expect(composerGate({ user: verified, canVerify: true, closedReason: "taslak", mode: "edit" }).kind).toBe("open");
  });

  it("doğrulanmamış notu hesabın durumuna göre söylenir ve tek cümledir", () => {
    expect(blockedNote("pending")).toBe(UNVERIFIED_NOTE);
    expect(blockedNote(undefined)).toBe(UNVERIFIED_NOTE);
    expect(blockedNote("suspended")).toContain("askıya alındığı");
    expect(blockedNote("rejected")).toContain("onaylanmadığı");
    for (const s of ["pending", "suspended", "rejected"] as const) {
      expect(blockedNote(s).match(/[.!?](\s|$)/g)).toHaveLength(1);
    }
  });
});

describe("composerIsOpen", () => {
  it("yanıt ve düzenleme her zaman açık", () => {
    for (const mode of ["reply", "edit"] as const) {
      expect(composerIsOpen({ mode, hasText: false, choice: false, defaultOpen: false })).toBe(true);
    }
  });

  it("yeni mesaj: sade kipte kapalı başlar, dokununca açılır", () => {
    expect(composerIsOpen({ mode: "new", hasText: false, choice: null, defaultOpen: false })).toBe(false);
    expect(composerIsOpen({ mode: "new", hasText: false, choice: true, defaultOpen: false })).toBe(true);
  });

  it("yeni mesaj: 'Tam' kipte baştan açık; kullanıcı Vazgeç derse kapanır", () => {
    expect(composerIsOpen({ mode: "new", hasText: false, choice: null, defaultOpen: true })).toBe(true);
    expect(composerIsOpen({ mode: "new", hasText: false, choice: false, defaultOpen: true })).toBe(false);
  });

  it("metin yazılmışsa açık kalır (kullanıcının seçimi ya da varsayılan ne olursa olsun)", () => {
    expect(composerIsOpen({ mode: "new", hasText: true, choice: null, defaultOpen: false })).toBe(true);
    expect(composerIsOpen({ mode: "new", hasText: true, choice: false, defaultOpen: false })).toBe(true);
  });
});
