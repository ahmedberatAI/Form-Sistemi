// Görünüm yoğunluğu tercihi: okuma sırası (eşzamanlı ayna → kalıcı depo → varsayılan), geçersiz değerler ve
// bölümlerin varsayılan açıklığı. Bkz. lib/detailLevel.tsx.
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DETAIL_LEVEL,
  DETAIL_LEVEL_LABELS,
  parseDetailLevel,
  readDetailLevelSync,
  resolveDefaultOpen,
  resolveDetailLevel,
} from "./detailLevel";
import { PREF_KEYS, removePref, setPref, setPrefSync } from "./prefs";

describe("görünüm yoğunluğu: değer doğrulama", () => {
  it("yalnız 'sade' ve 'tam' geçerlidir", () => {
    expect(parseDetailLevel("sade")).toBe("sade");
    expect(parseDetailLevel("tam")).toBe("tam");
    for (const bad of ["", "Tam", "full", "açık", null, undefined, 1, true, {}]) expect(parseDetailLevel(bad)).toBeNull();
  });

  it("varsayılan 'sade'dir; anahtar forum.detail", () => {
    expect(DEFAULT_DETAIL_LEVEL).toBe("sade");
    expect(PREF_KEYS.detail).toBe("forum.detail");
  });

  it("etiketler Ayarlar sözleşmesine uyar ve tema radyolarındaki tam 'Açık'/'Koyu' adlarıyla çakışmaz", () => {
    expect(DETAIL_LEVEL_LABELS).toEqual({ sade: "Sade (önerilen)", tam: "Tam — tüm ayrıntılar açık" });
    for (const label of Object.values(DETAIL_LEVEL_LABELS)) {
      expect(label).not.toBe("Açık");
      expect(label).not.toBe("Koyu");
    }
  });
});

describe("görünüm yoğunluğu: okuma sırası", () => {
  it("kalıcı depodaki geçerli değer aynadan önce gelir (Android Preferences)", () => {
    expect(resolveDetailLevel("sade", "tam")).toBe("tam");
    expect(resolveDetailLevel("tam", "sade")).toBe("sade");
  });

  it("kalıcı depo boş ya da bozuksa ayna, o da yoksa varsayılan", () => {
    expect(resolveDetailLevel("tam", null)).toBe("tam");
    expect(resolveDetailLevel("tam", "bozuk")).toBe("tam");
    expect(resolveDetailLevel(null, null)).toBe("sade");
    expect(resolveDetailLevel("bozuk", "bozuk")).toBe("sade");
    expect(resolveDetailLevel(undefined, undefined)).toBe("sade");
  });

  describe("eşzamanlı ayna (ilk çizim)", () => {
    beforeEach(async () => {
      await removePref(PREF_KEYS.detail);
    });

    it("kayıt yoksa 'sade'", () => {
      expect(readDetailLevelSync()).toBe("sade");
    });

    it("kayıtlı 'tam' ilk çizimde okunur", () => {
      setPrefSync(PREF_KEYS.detail, "tam");
      expect(readDetailLevelSync()).toBe("tam");
    });

    it("bozuk kayıt 'sade'ye düşer", () => {
      setPrefSync(PREF_KEYS.detail, "her-sey");
      expect(readDetailLevelSync()).toBe("sade");
    });

    it("kalıcı depoya yazılan değer de aynı anahtarla okunur", async () => {
      await setPref(PREF_KEYS.detail, "tam");
      expect(readDetailLevelSync()).toBe("tam");
    });
  });
});

describe("bölümlerin varsayılan açıklığı", () => {
  it("açık değer verilmemişse sade → kapalı, tam → açık", () => {
    expect(resolveDefaultOpen(undefined, "sade")).toBe(false);
    expect(resolveDefaultOpen(undefined, "tam")).toBe(true);
  });

  it("açık değer her iki kipte de geçerlidir (sorun varsa kendiliğinden açık, yoksa kapalı)", () => {
    expect(resolveDefaultOpen(true, "sade")).toBe(true);
    expect(resolveDefaultOpen(true, "tam")).toBe(true);
    expect(resolveDefaultOpen(false, "sade")).toBe(false);
    expect(resolveDefaultOpen(false, "tam")).toBe(false);
  });

  it("openInFull=false olan bölüm 'tam' kipte de kapalı gelir ama açık değer yine kazanır", () => {
    expect(resolveDefaultOpen(undefined, "tam", false)).toBe(false);
    expect(resolveDefaultOpen(undefined, "sade", false)).toBe(false);
    expect(resolveDefaultOpen(true, "tam", false)).toBe(true);
  });
});
