// Geliştirme vekili hedefi PORT / VITE_API_TARGET ortam değişkenlerini izler (sabit 4000 değil). Bkz. bulgular #87, #313, #341.
import { afterEach, describe, expect, it, vi } from "vitest";

const saved = { PORT: process.env.PORT, VITE_API_TARGET: process.env.VITE_API_TARGET };

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
});

async function proxyTarget(env: { PORT?: string; VITE_API_TARGET?: string }): Promise<unknown> {
  delete process.env.PORT;
  delete process.env.VITE_API_TARGET;
  Object.assign(process.env, env);
  vi.resetModules();
  const config = (await import("./vite.config")).default;
  return (config.server?.proxy as Record<string, unknown>)["/api"];
}

describe("Vite /api vekili", () => {
  it("varsayılan http://localhost:4000", async () => {
    expect(await proxyTarget({})).toBe("http://localhost:4000");
  });

  it("PORT=4200 ise vekil 4200'e gider", async () => {
    expect(await proxyTarget({ PORT: "4200" })).toBe("http://localhost:4200");
  });

  it("VITE_API_TARGET her şeyden önce gelir (sondaki / atılır)", async () => {
    expect(await proxyTarget({ PORT: "4200", VITE_API_TARGET: "http://127.0.0.1:5000/" })).toBe("http://127.0.0.1:5000");
  });
});
