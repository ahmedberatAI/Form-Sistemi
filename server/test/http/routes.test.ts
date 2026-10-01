// docs/API.md'deki HER (yöntem, yol) çiftinin Fastify'da kayıtlı olduğunu denetler (ve tersini: belgelenmemiş /api ucu yok).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SERVER_ROOT } from "../../src/core/config";
import { registerRoutes } from "../../src/http/routes";
import { stubServer, stubServices } from "./stubs";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

function documentedRoutes(): { method: Method; url: string }[] {
  const md = readFileSync(join(SERVER_ROOT, "..", "docs", "API.md"), "utf8");
  const out: { method: Method; url: string }[] = [];
  const row = /^\|\s*(GET|POST|PATCH|PUT|DELETE)\s*\|\s*`([^`]+)`\s*\|/;
  for (const line of md.split(/\r?\n/)) {
    const m = row.exec(line);
    if (m) out.push({ method: m[1] as Method, url: m[2] });
  }
  return out;
}

describe("API.md ↔ Fastify rota eşleşmesi", () => {
  const docs = documentedRoutes();
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await stubServer(stubServices());
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it("API.md ayrıştırıldı (makul sayıda, yinelenmeyen uç nokta)", () => {
    expect(docs.length).toBeGreaterThanOrEqual(90);
    const keys = docs.map((d) => `${d.method} ${d.url}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(docs.map((d) => [d.method, d.url] as const))("%s %s kayıtlı", (method, url) => {
    expect(app.hasRoute({ method, url })).toBe(true);
  });

  it("belgelenmemiş /api ucu yok", async () => {
    const s = stubServices();
    const seen: string[] = [];
    const bare = Fastify();
    bare.decorateRequest("user", null);
    bare.decorateRequest("authToken", null);
    bare.addHook("onRoute", (r) => {
      for (const m of ([] as string[]).concat(r.method)) if (m !== "HEAD") seen.push(`${m} ${r.url}`);
    });
    registerRoutes(bare, { services: s.services, config: s.ctx.config, authLimiter: [] });
    await bare.ready();
    const documented = new Set(docs.map((d) => `${d.method} ${d.url}`));
    expect(seen.filter((k) => !documented.has(k))).toEqual([]);
    expect(seen.length).toBe(docs.length);
    await bare.close();
  });
});
