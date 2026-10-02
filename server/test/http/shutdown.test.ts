// Kapanış sırası (#330, #331): HTTP önce boşaltılır, sonra yaşam döngüsü/defter/DB kapanır; close() uçuştaki istek yüzünden takılmaz.
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../../src/app";
import { testConfig } from "../../src/core/config";
import { registrationInput } from "./harness";

const appOpts = { startTimers: false, aiClient: null, rateLimit: false } as const;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function call(port: number, agent: http.Agent, method: string, path: string, body?: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      { host: "127.0.0.1", port, method, path, agent, headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {} },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

const portOf = (a: App) => (a.app.server.address() as AddressInfo).port;
const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

describe("kapanış", () => {
  it("uçuştaki istek tamamlanır; boşta ve sonradan boşa düşen keep-alive bağlantıları close()'u ~70 sn tutmaz", async () => {
    const a = await createApp(testConfig({ ledgerBlockIntervalMs: 5 }), appOpts);
    cleanup.push(() => a.close());
    a.app.get("/__yavas", async () => {
      await sleep(300);
      return { ok: true };
    });
    await a.app.listen({ port: 0, host: "127.0.0.1" });
    const port = portOf(a);
    const idleAgent = new http.Agent({ keepAlive: true });
    const slowAgent = new http.Agent({ keepAlive: true });
    cleanup.push(() => (idleAgent.destroy(), slowAgent.destroy()));

    expect((await call(port, idleAgent, "GET", "/api/health")).status).toBe(200); // bağlantı keep-alive'da boşta kalır
    const received = new Promise<void>((r) => a.app.server.once("request", () => r()));
    const slow = call(port, slowAgent, "GET", "/__yavas");
    await received;

    const t0 = Date.now();
    await a.close();
    const elapsed = Date.now() - t0;
    const res = await slow;
    expect(res.status).toBe(200); // kesilmedi, boşaltıldı
    expect(elapsed).toBeGreaterThanOrEqual(150); // uçuştaki isteği bekledi
    expect(elapsed).toBeLessThan(5_000); // eskiden ~70 sn
  }, 30_000);

  it("süre dolunca hâlâ uçuşta olan istek zorla koparılır (azami boşaltma süresi)", async () => {
    const a = await createApp(testConfig({ ledgerBlockIntervalMs: 5 }), { ...appOpts, httpDrainMs: 150 });
    cleanup.push(() => a.close());
    a.app.get("/__cok-yavas", async () => {
      await sleep(5_000);
      return { ok: true };
    });
    await a.app.listen({ port: 0, host: "127.0.0.1" });
    const agent = new http.Agent({ keepAlive: true });
    cleanup.push(() => agent.destroy());
    const received = new Promise<void>((r) => a.app.server.once("request", () => r()));
    const slow = call(portOf(a), agent, "GET", "/__cok-yavas").then(
      () => "tamam",
      () => "koptu",
    );
    await received;
    const t0 = Date.now();
    await a.close();
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(await slow).toBe("koptu");
  }, 30_000);

  it("kapanış sırasında uçuştaki kayıt defter durdurulmadan tamamlanır (defter kaydı kaybolmaz)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forum-shutdown-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const cfg = testConfig({ dataDir: dir, dbPath: join(dir, "forum.db"), ledgerBlockIntervalMs: 5 });
    const a = await createApp(cfg, appOpts);
    await a.app.listen({ port: 0, host: "127.0.0.1" });
    const agent = new http.Agent({ keepAlive: true });
    cleanup.push(() => agent.destroy());

    const received = new Promise<void>((r) => a.app.server.once("request", () => r()));
    const pending = call(portOf(a), agent, "POST", "/api/auth/register", registrationInput("Kapanisci"));
    await received;
    await a.close(); // kayıt hâlâ işlenirken kapanış başlar
    const res = await pending;
    expect(res.status).toBeLessThan(300);

    const b = await createApp(cfg, appOpts);
    try {
      const errors = b.services.ctx.db.all("SELECT id FROM audit_log WHERE action = 'identity.ledger_error'");
      expect(errors).toHaveLength(0);
      expect(b.services.ledger.findTxs({ type: "MEMBER_REGISTERED" })).toHaveLength(1);
    } finally {
      await b.close();
    }
  }, 30_000);

  it("lifecycle.stop() uçuştaki tick bitene kadar bekler", async () => {
    const a = await createApp(testConfig({ ledgerBlockIntervalMs: 5 }), appOpts);
    cleanup.push(() => a.close());
    const tick = a.services.forum.lifecycle.tick();
    let done = false;
    void tick.then(() => (done = true));
    await a.services.forum.lifecycle.stop();
    expect(done).toBe(true);
  });
});
