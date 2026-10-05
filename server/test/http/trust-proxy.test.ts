// TRUST_PROXY (bulgular #226, #343): ters vekil (nginx/Caddy) arkasında istemci adresi güvenilen vekilin X-Forwarded-For'undan
// okunur; böylece hız sınırı herkesi tek IP saymaz. Varsayılan kapalıdır ve güvenilmeyen adresten gelen başlık yok sayılır.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { describeTrustProxy, loadConfig, parseTrustProxy, trustProxyWarning, type Config } from "../../src/core/config";
import { buildServer } from "../../src/http";
import type { BuildServerOptions } from "../../src/http/server";
import { stubServices } from "./stubs";

const apps: FastifyInstance[] = [];
async function server(config: Partial<Config>, opts: BuildServerOptions = { rateLimit: false }) {
  const s = stubServices({}, config);
  const app = await buildServer(s.services, s.ctx.config, opts);
  app.get("/api/test/ip", async (req) => ({ ip: req.ip }));
  apps.push(app);
  return app;
}
afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

const PROXY = "127.0.0.1";
const ipOf = async (app: FastifyInstance, remoteAddress: string, xff?: string): Promise<string> => {
  const r = await app.inject({ method: "GET", url: "/api/test/ip", remoteAddress, headers: xff ? { "x-forwarded-for": xff } : {} });
  return r.json().ip;
};

describe("parseTrustProxy", () => {
  it("boş / kapalı sözcükler / 0 → false; açık sözcükler → true (büyük/küçük harf duyarsız)", () => {
    for (const off of [undefined, "", "  ", "false", "FALSE", "hayır", "HAYIR", "hayir", "no", "off", "0"]) expect(parseTrustProxy("TRUST_PROXY", off), String(off)).toBe(false);
    for (const on of ["true", "TRUE", "evet", "EVET", "yes", "on"]) expect(parseTrustProxy("TRUST_PROXY", on), on).toBe(true);
  });

  it("tamsayı → atlama sayısı; 32'den büyük → hata", () => {
    expect(parseTrustProxy("TRUST_PROXY", "1")).toBe(1);
    expect(parseTrustProxy("TRUST_PROXY", " 2 ")).toBe(2);
    expect(() => parseTrustProxy("TRUST_PROXY", "33")).toThrow(/TRUST_PROXY=33 aralık dışı/);
  });

  it("adres listesi: IP, CIDR ve hazır kümeler kabul edilir (küme adları küçük harfe çevrilir)", () => {
    expect(parseTrustProxy("TRUST_PROXY", "127.0.0.1")).toEqual(["127.0.0.1"]);
    expect(parseTrustProxy("TRUST_PROXY", " 10.0.0.0/8 , ::1, fd00::/8, LOOPBACK,uniquelocal ")).toEqual(["10.0.0.0/8", "::1", "fd00::/8", "loopback", "uniquelocal"]);
  });

  it("geçersiz öğe Türkçe hatayla reddedilir ve hatalı öğe adlandırılır", () => {
    expect(() => parseTrustProxy("TRUST_PROXY", "nginx")).toThrow(/TRUST_PROXY="nginx" geçersiz \("nginx"\)/);
    expect(() => parseTrustProxy("TRUST_PROXY", "10.0.0.0/33")).toThrow(/"10\.0\.0\.0\/33"/);
    expect(() => parseTrustProxy("TRUST_PROXY", "::1/129")).toThrow(/"::1\/129"/);
    expect(() => parseTrustProxy("TRUST_PROXY", "10.0.0.1,")).toThrow(/boş öğe/);
    expect(() => parseTrustProxy("TRUST_PROXY", "999.1.1.1")).toThrow(/geçersiz/);
    expect(() => parseTrustProxy("TRUST_PROXY", "1.5")).toThrow(/geçersiz/);
  });

  it("bağlantıyı kuran adresi doğrulamayan ayarlar (true, sayı) için açılış uyarısı; liste ve kapalı için yok", () => {
    expect(trustProxyWarning(true)).toMatch(/taklit/);
    expect(trustProxyWarning(1)).toMatch(/TRUST_PROXY=1/);
    expect(trustProxyWarning(["127.0.0.1"])).toBeNull();
    expect(trustProxyWarning(false)).toBeNull();
    expect(trustProxyWarning(undefined)).toBeNull();
  });

  it("açılış başlığı özeti: kapalı / true / atlama sayısı / adres listesi", () => {
    expect(describeTrustProxy(undefined)).toMatch(/^kapalı/);
    expect(describeTrustProxy(false)).toMatch(/^kapalı/);
    expect(describeTrustProxy(true)).toMatch(/TÜM vekillere/);
    expect(describeTrustProxy(2)).toMatch(/en yakın 2 atlama/);
    expect(describeTrustProxy(["127.0.0.1", "10.0.0.0/8"])).toContain("127.0.0.1, 10.0.0.0/8");
  });
});

describe("loadConfig: TRUST_PROXY", () => {
  const saved = process.env.TRUST_PROXY;
  const keys = { masterKey: "11".repeat(32), tokenKey: "22".repeat(32), voteKey: "33".repeat(32), dataDir: ":memory:", dbPath: ":memory:" };
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = saved;
    vi.restoreAllMocks();
  });

  it("tanımsız → kapalı; liste okunur; true açılışta uyarır", () => {
    delete process.env.TRUST_PROXY;
    expect(loadConfig(keys).trustProxy).toBe(false);
    process.env.TRUST_PROXY = "127.0.0.1,10.0.0.0/8";
    expect(loadConfig(keys).trustProxy).toEqual(["127.0.0.1", "10.0.0.0/8"]);
    expect(console.warn).not.toHaveBeenCalled();
    process.env.TRUST_PROXY = "true";
    expect(loadConfig(keys).trustProxy).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/TRUST_PROXY=true/));
  });

  it("geçersiz değer açılışı durdurur (diğer yapılandırma hatalarıyla birlikte bildirilir)", () => {
    process.env.TRUST_PROXY = "vekil";
    expect(() => loadConfig(keys)).toThrow(/Yapılandırma geçersiz[\s\S]*TRUST_PROXY="vekil" geçersiz/);
  });
});

describe("Fastify trustProxy: istemci adresi", () => {
  it("varsayılan (kapalı): X-Forwarded-For yok sayılır, bağlantı adresi kullanılır", async () => {
    const app = await server({});
    expect(await ipOf(app, PROXY, "203.0.113.5")).toBe(PROXY);
  });

  it("adres listesi: yalnız güvenilen vekilden gelen başlık okunur; doğrudan bağlanan istemci IP taklit edemez", async () => {
    const app = await server({ trustProxy: [PROXY] });
    expect(await ipOf(app, PROXY, "203.0.113.5")).toBe("203.0.113.5");
    // İstemci kendi X-Forwarded-For'unu yazdıysa vekil sona ekler; en sağdaki güvenilmeyen adres istemcidir.
    expect(await ipOf(app, PROXY, "6.6.6.6, 203.0.113.5")).toBe("203.0.113.5");
    expect(await ipOf(app, "198.51.100.7", "6.6.6.6")).toBe("198.51.100.7");
  });

  it("atlama sayısı: en yakın n adres vekil sayılır (Fastify 5'in yok saydığı sayı işleve çevrilir)", async () => {
    const one = await server({ trustProxy: 1 });
    expect(await ipOf(one, PROXY, "1.1.1.1, 2.2.2.2")).toBe("2.2.2.2");
    const two = await server({ trustProxy: 2 });
    expect(await ipOf(two, PROXY, "1.1.1.1, 2.2.2.2")).toBe("1.1.1.1");
  });

  it("true: X-Forwarded-For'un en soldaki adresi", async () => {
    const app = await server({ trustProxy: true });
    expect(await ipOf(app, PROXY, "1.1.1.1, 2.2.2.2")).toBe("1.1.1.1");
  });

  it("hız sınırı vekil arkasında istemci başına sayar; TRUST_PROXY kapalıyken herkes tek kovaya düşer", async () => {
    const opts: BuildServerOptions = { rateLimit: { global: 2, auth: 20 } };
    const hit = async (app: FastifyInstance, client: string) =>
      (await app.inject({ method: "GET", url: "/api/health", remoteAddress: PROXY, headers: { "x-forwarded-for": client } })).statusCode;

    const behind = await server({ trustProxy: [PROXY] }, opts);
    expect([await hit(behind, "203.0.113.1"), await hit(behind, "203.0.113.1"), await hit(behind, "203.0.113.1")]).toEqual([200, 200, 429]);
    expect(await hit(behind, "203.0.113.2")).toBe(200); // başka üye etkilenmez

    const naive = await server({}, opts);
    expect([await hit(naive, "203.0.113.1"), await hit(naive, "203.0.113.2"), await hit(naive, "203.0.113.3")]).toEqual([200, 200, 429]);
  });
});
