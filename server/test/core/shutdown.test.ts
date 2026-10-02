// Kapanış tetikleyicisi (#331): tek sefer çalışır, genel zaman sınırı vardır, hata/takılma çıkış kodu 1 verir.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShutdown } from "../../src/core/shutdown";

afterEach(() => {
  vi.useRealTimers();
});

const quiet = { log: () => undefined, error: () => undefined };

describe("createShutdown", () => {
  it("close() başarılıysa kodu 0 ile çıkar; ikinci tetik yok sayılır", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const shutdown = createShutdown({ close, exit, ...quiet });
    shutdown("SIGTERM");
    shutdown("SIGINT");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(close).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });

  it("ölümcül hata yolunda (exitCode 1) düzgün kapanıştan sonra 1 ile çıkar", async () => {
    const exit = vi.fn();
    createShutdown({ close: async () => undefined, exit, ...quiet })("uncaughtException", 1);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });

  it("close() hata fırlatırsa 1 ile çıkar", async () => {
    const exit = vi.fn();
    createShutdown({ close: () => Promise.reject(new Error("kötü")), exit, ...quiet })("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });

  it("close() takılırsa zaman sınırında zorla 1 ile çıkar", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    createShutdown({ close: () => new Promise<void>(() => undefined), timeoutMs: 8_000, exit, ...quiet })("SIGTERM");
    await vi.advanceTimersByTimeAsync(7_999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("zamanında biten kapanış zaman aşımı sayacını iptal eder (çifte çıkış yok)", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    createShutdown({ close: async () => undefined, timeoutMs: 100, exit, ...quiet })("SIGTERM");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
