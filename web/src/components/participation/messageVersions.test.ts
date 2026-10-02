// Sürüm geçmişi paneli açıkken düzenleme sürümleri sıfırlarsa panel yeniden yüklemeli (sonsuz döner gösterge olmamalı).
import type { MessageVersionView } from "@forum/shared";
import { describe, expect, it } from "vitest";
import { shouldLoadVersions } from "./messageVersions";

const loaded = [{ version: 1 }] as unknown as MessageVersionView[];

describe("sürüm geçmişi yükleme kararı", () => {
  it("panel kapalıyken istek atılmaz", () => {
    expect(shouldLoadVersions(false, null, null)).toBe(false);
  });

  it("panel açılınca ve veri yokken istenir", () => {
    expect(shouldLoadVersions(true, null, null)).toBe(true);
  });

  it("düzenleme sonrası sürümler sıfırlanmışsa (panel hâlâ açık) yeniden istenir", () => {
    // Önce yüklenmiş: istenmez. Sonra Composer.onDone → setVersions(null): yeniden istenmeli.
    expect(shouldLoadVersions(true, loaded, null)).toBe(false);
    expect(shouldLoadVersions(true, null, null)).toBe(true);
  });

  it("hata varken kendiliğinden döngüye girmez (kapatıp açınca hata temizlenir)", () => {
    expect(shouldLoadVersions(true, null, new Error("ağ"))).toBe(false);
  });
});
