// #335: Claude hataları artık sessiz değil — neden sınıfı (içeriksiz) loglanır, ardışık başarısızlık sayılır,
// /api/ai/status Claude kipinde sağlık alanlarını gösterir; çevrimdışı yedek aynen çalışır.
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { createAiService, type AnthropicLike } from "../../src/ai";
import { registerAiRoutes } from "../../src/http/routes/ai";
import { makeCtx } from "../helpers/fakes";
import { classifyCtx, fakeClient, jsonResponse, moderateCtx } from "./fixtures";

const SECRET = "sk-ant-GIZLI-ANAHTAR özel kullanıcı metni 0532 987 65 43";

function failing(status: number | null): AnthropicLike {
  return {
    beta: {
      messages: {
        async create() {
          throw Object.assign(new Error(SECRET), status === null ? { name: "APIConnectionError" } : { status });
        },
      },
    },
  };
}

function collect() {
  const logs: { message: string; meta: Record<string, unknown> }[] = [];
  return { logs, warn: (message: string, meta: Record<string, unknown>) => void logs.push({ message, meta }) };
}

describe("Claude sağlık takibi", () => {
  it("hata: çevrimdışına düşer, neden sınıfı kaydedilir, içerik/anahtar loga ve duruma sızmaz", async () => {
    const { logs, warn } = collect();
    const ctx = makeCtx();
    const ai = createAiService(ctx, { client: failing(401), warn });
    expect(ai.health?.()).toMatchObject({ degraded: false, failures: 0, lastError: null, lastOkAt: null });

    const r = await ai.moderate("aptal herif", moderateCtx);
    expect(r.offline).toBe(true);
    expect(ai.mode()).toBe("claude"); // kip yine "claude"; sağlık ayrıca bildirilir
    expect(ai.health?.()).toMatchObject({ degraded: false, failures: 1, lastError: "http_401" });
    expect(ai.health?.().lastErrorAt).toBe(ctx.clock.now());
    expect(logs).toHaveLength(1);
    expect(logs[0].meta).toMatchObject({ reason: "http_401", consecutiveFailures: 1 });
    const dump = JSON.stringify([logs, ai.health?.()]);
    expect(dump).not.toContain("GIZLI");
    expect(dump).not.toContain("0532");
    expect(dump).not.toContain("aptal");
  });

  it("ardışık başarısızlık eşikte 'degraded' olur; her çağrıda log şişmez; başarı sayacı sıfırlar", async () => {
    const { logs, warn } = collect();
    let ok = false;
    const { client } = fakeClient(() => {
      if (!ok) throw Object.assign(new Error("ağ"), { status: 429 });
      return jsonResponse({ issues: [] });
    });
    const ai = createAiService(makeCtx(), { client, warn });
    for (let i = 0; i < 5; i++) await ai.lintExpertReport("Rapor metni.");
    expect(ai.health?.()).toMatchObject({ degraded: true, failures: 5, lastError: "http_429" });
    expect(logs.map((l) => l.meta.consecutiveFailures)).toEqual([1, 3]); // seri başı + degraded geçişi

    ok = true;
    const r = await ai.lintExpertReport("Rapor metni.");
    expect(r.offline).toBe(false);
    expect(ai.health?.()).toMatchObject({ degraded: false, failures: 0, lastError: "http_429" });
    expect(ai.health?.().lastOkAt).not.toBeNull();
    expect(logs.at(-1)?.message).toContain("yeniden başarılı");
  });

  it("ret, boş/geçersiz yanıt, şema uyumsuzluğu ve ağ hatası ayrı nedenlerle sınıflanır", async () => {
    const cases: [unknown, string][] = [
      [{ ...jsonResponse({}), stop_reason: "refusal" }, "refusal"],
      [{ ...jsonResponse({}), stop_reason: "max_tokens" }, "max_tokens"],
      [{ content: [] }, "empty"],
      [{ content: [{ type: "text", text: "{bozuk" }] }, "invalid_json"],
      [jsonResponse({ yanlis: true }), "schema"],
    ];
    for (const [response, reason] of cases) {
      const { client } = fakeClient(() => response);
      const ai = createAiService(makeCtx(), { client, warn: () => {} });
      expect((await ai.classifyProposal({ title: "A", body: "B" }, classifyCtx)).offline).toBe(true);
      expect(ai.health?.().lastError, reason).toBe(reason);
    }
    const net = createAiService(makeCtx(), { client: failing(null), warn: () => {} });
    await net.moderate("x", moderateCtx);
    expect(net.health?.().lastError).toBe("network");
  });

  it("/api/ai/status: Claude kipinde sağlık alanları, çevrimdışı kipte eski yanıt", async () => {
    const claude = createAiService(makeCtx(), { client: failing(404), warn: () => {} });
    for (let i = 0; i < 3; i++) await claude.moderate("x", moderateCtx);
    const offline = createAiService(makeCtx(), { client: null });

    for (const [ai, expected] of [
      [claude, { mode: "claude", degraded: true, failures: 3, lastError: "http_404" }],
      [offline, { mode: "offline" }],
    ] as const) {
      const app = Fastify({ logger: false });
      registerAiRoutes(app, { services: { ai, forum: {} } } as never);
      const res = await app.inject({ method: "GET", url: "/api/ai/status" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject(expected);
      if (ai === offline) expect(Object.keys(body).sort()).toEqual(["mode", "model"]);
      else expect(JSON.stringify(body)).not.toContain("GIZLI");
      await app.close();
    }
  });
});
