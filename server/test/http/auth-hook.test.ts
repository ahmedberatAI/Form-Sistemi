// #199: kimlik doğrulama kancası yalnızca geçersiz/süresi dolmuş/iptal edilmiş belirteci "anonim" sayar;
// altyapı hataları (ör. SQLITE_BUSY) 5xx olarak yayılır, istemciyi oturumdan atan 401'e dönüşmez.
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { AuthUser, IdentityService } from "../../src/core/contracts";
import { installAuth, requireUser } from "../../src/http/auth";
import { installErrorHandling } from "../../src/http/errors";

const USER = { id: "u1", nickname: "ali", roles: ["member"], status: "verified" } as unknown as AuthUser;

async function build(authenticate: (token: string) => AuthUser | null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  installErrorHandling(app, { spaIndex: () => null });
  installAuth(app, { authenticate } as unknown as IdentityService);
  app.get("/ben", async (req) => ({ id: requireUser(req).id }));
  app.get("/acik", async (req) => ({ anonim: req.user === null }));
  await app.ready();
  return app;
}

describe("auth kancası: altyapı hataları anonime çevrilmez", () => {
  let app: FastifyInstance | null = null;
  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it("geçerli belirteç → kullanıcı", async () => {
    app = await build(() => USER);
    const r = await app.inject({ method: "GET", url: "/ben", headers: { authorization: "Bearer iyi" } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ id: "u1" });
  });

  it("geçersiz/süresi dolmuş/iptal belirteç (null) → anonim: korumalı uç 401", async () => {
    app = await build(() => null);
    const r = await app.inject({ method: "GET", url: "/ben", headers: { authorization: "Bearer eski" } });
    expect(r.statusCode).toBe(401);
    const open = await app.inject({ method: "GET", url: "/acik", headers: { authorization: "Bearer eski" } });
    expect(open.statusCode).toBe(200);
    expect(open.json()).toEqual({ anonim: true });
  });

  it("authenticate() fırlatırsa 401 değil 5xx döner (istemci belirteci silmez)", async () => {
    app = await build(() => {
      throw new Error("SQLITE_BUSY: database is locked");
    });
    for (const url of ["/ben", "/acik"]) {
      const r = await app.inject({ method: "GET", url, headers: { authorization: "Bearer gecerli" } });
      expect(r.statusCode, url).toBe(500);
      expect(r.json().error.code).toBe("internal");
      expect(r.body).not.toContain("SQLITE_BUSY");
    }
  });

  it("Authorization başlığı yoksa kimlik doğrulayıcı hiç çağrılmaz", async () => {
    let calls = 0;
    app = await build(() => {
      calls++;
      throw new Error("çağrılmamalı");
    });
    const r = await app.inject({ method: "GET", url: "/acik" });
    expect(r.statusCode).toBe(200);
    expect(calls).toBe(0);
  });
});
