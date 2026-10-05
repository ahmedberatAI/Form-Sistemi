// Time: oy değiştirilince "Geçerli oyunuz" satırı yeni oy zamanını gelecekte gösteriyordu ("6 dakika sonra" / "birazdan"):
// göreli metin 30 sn'de bir yenilenen bayat "şimdi" ile hesaplanıyordu. Artık çizim anındaki sunucu saati kullanılır ve geçmiş
// olaylar (past) hiçbir zaman gelecekte görünmez. Gelecekteki son tarihler (evre bitişi) eskisi gibi "… sonra" yazar.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Time, timeText } from "./time";

const T = Date.UTC(2026, 9, 6, 10, 0);
const clock = vi.hoisted(() => ({ calls: 0, values: [] as number[] }));
vi.mock("../auth/AuthContext", () => ({
  // Her çağrı sıradaki değeri verir (sonuncusu tekrarlanır): ilk çağrı useNow'un tik değeri, sonraki çizim anındaki sunucu saati.
  useServerNow: () => () => clock.values[Math.min(clock.calls++, clock.values.length - 1)],
}));

describe("timeText", () => {
  it("geçmiş olay: zaman 'şimdi'nin birkaç dakika önünde görünse de 'az önce' (TIME_SCALE=60'ta birkaç gerçek saniye)", () => {
    expect(timeText(T + 6 * 60_000, T, "relative", true)).toBe("az önce");
    expect(timeText(T + 10_000, T, "relative", true)).toBe("az önce");
    expect(timeText(T - 3 * 60_000, T, "relative", true)).toBe("3 dakika önce");
  });

  it("gelecekteki son tarih (past yok) eskisi gibi ileriyi gösterir", () => {
    expect(timeText(T + 6 * 60_000, T)).toBe("6 dakika sonra");
    expect(timeText(T + 10_000, T)).toBe("birazdan");
  });

  it("both: mutlak zaman + göreli metin", () => {
    expect(timeText(T, T, "both", true)).toMatch(/2026 .*\(az önce\)$/);
  });
});

describe("Time bileşeni", () => {
  it("bayat 30 sn'lik tik yerine çizim anındaki sunucu saatiyle karşılaştırır (oy değişince 'N dakika sonra' çıkmaz)", () => {
    // Tik T'de kalmış; bu arada simüle saat 6 dk ilerlemiş ve yeni oy T+5 dk'da verilmiş.
    clock.calls = 0;
    clock.values = [T, T + 6 * 60_000];
    const html = renderToStaticMarkup(<Time at={T + 5 * 60_000} />);
    expect(html).toContain(">1 dakika önce<");
  });

  it("past: istemci saati sunucunun gerisinde kalsa da geçmiş olay 'az önce' yazar", () => {
    clock.calls = 0;
    clock.values = [T];
    expect(renderToStaticMarkup(<Time at={T + 4 * 60_000} mode="both" past />)).toContain("(az önce)");
  });
});
