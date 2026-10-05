// Idempotency-Key (bulgu #275): yanıtı belirsiz kalan bir gönderim (istemci zaman aşımı, bağlantı kopması) aynı anahtarla
// yeniden gönderilince işlem ikinci kez yapılmaz; sunucu ilk başarılı yanıtı aynen döndürür.
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { PostMessageRequest } from "@forum/shared";
import { unprocessable } from "../../src/core/errors";
import { buildServer } from "../../src/http";
import { DEFAULT_IDEMPOTENCY } from "../../src/http/idempotency";
import type { BuildServerOptions } from "../../src/http/server";
import { fakeUser, stubServices, type FakeUser, type StubApp } from "./stubs";

const apps: FastifyInstance[] = [];
async function server(s: StubApp, opts: BuildServerOptions = {}) {
  const app = await buildServer(s.services, s.ctx.config, { rateLimit: false, ...opts });
  apps.push(app);
  return app;
}
afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

const KEY = "3f1c2a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c";
const KEY2 = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";
const MSG: PostMessageRequest = { body: "Bu öneriye katılıyorum.", stance: "pro" };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("Koşul zamanında sağlanmadı");
    await sleep(5);
  }
}

/** Mesaj gönderme ucunu sayan sahte servis. gate verilirse her çağrı o söz çözülene kadar bekler (yavaş YZ moderasyonu). */
function messaging(opts: { gate?: () => Promise<void>; failFirst?: boolean; bodyOf?: (n: number) => string } = {}) {
  const calls: { user: string; thread: string; body: string }[] = [];
  const s = stubServices({
    forum: {
      messages: {
        post: async (user, _type, threadId, input) => {
          calls.push({ user: user.id, thread: threadId, body: input.body });
          if (opts.failFirst && calls.length === 1) throw unprocessable("pii_detected", "Mesajda kişisel veri var.");
          if (opts.gate) await opts.gate();
          return { id: `m${calls.length}`, threadId, body: opts.bodyOf ? opts.bodyOf(calls.length) : input.body } as never;
        },
      },
    },
  });
  const member = s.addUser(fakeUser("uye"));
  const other = s.addUser(fakeUser("diger"));
  return { s, member, other, calls };
}

function send(app: FastifyInstance, s: StubApp, user: FakeUser | null, key?: string, body: unknown = MSG, thread = "t1"): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = { ...(user ? s.auth(user) : {}) };
  if (key !== undefined) headers["idempotency-key"] = key;
  return app.inject({ method: "POST", url: `/api/threads/topic/${thread}`, headers, payload: body as Record<string, unknown> });
}

describe("Idempotency-Key: yeniden gönderim", () => {
  it("aynı anahtarla yeniden gönderim işlemi tekrarlamaz; ilk yanıt aynen döner (Idempotent-Replayed)", async () => {
    const { s, member, calls } = messaging();
    const app = await server(s);
    const first = await send(app, s, member, KEY);
    expect(first.statusCode).toBe(200);
    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    const again = await send(app, s, member, KEY);
    expect(again.statusCode).toBe(200);
    expect(again.body).toBe(first.body);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.headers["content-type"]).toMatch(/application\/json/);
    expect(again.headers["cache-control"]).toBe("no-store");
    expect(calls).toHaveLength(1);
  });

  it("anahtarsız istekler ve yeni anahtarlı istekler her seferinde işlenir", async () => {
    const { s, member, calls } = messaging();
    const app = await server(s);
    await send(app, s, member);
    await send(app, s, member);
    await send(app, s, member, KEY);
    await send(app, s, member, KEY2);
    expect(calls).toHaveLength(4);
  });

  it("aynı anahtar farklı gövdeyle → 422 idempotency_key_reused; işlem yapılmaz", async () => {
    const { s, member, calls } = messaging();
    const app = await server(s);
    expect((await send(app, s, member, KEY)).statusCode).toBe(200);
    const r = await send(app, s, member, KEY, { ...MSG, body: "Başka bir metin." });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe("idempotency_key_reused");
    expect(r.json().error.message).toMatch(/farklı bir istek gövdesiyle/);
    expect(calls).toHaveLength(1);
  });

  it("anahtar kullanıcıya ve yola bağlıdır: başka üye ya da başka başlık aynı anahtarla ayrı işlenir", async () => {
    const { s, member, other, calls } = messaging();
    const app = await server(s);
    await send(app, s, member, KEY);
    const theirs = await send(app, s, other, KEY);
    expect(theirs.statusCode).toBe(200);
    expect(theirs.headers["idempotent-replayed"]).toBeUndefined();
    const elsewhere = await send(app, s, member, KEY, MSG, "t2");
    expect(elsewhere.headers["idempotent-replayed"]).toBeUndefined();
    expect(calls.map((c) => `${c.user}/${c.thread}`)).toEqual(["u-uye/t1", "u-diger/t1", "u-uye/t2"]);
  });

  it("başarısız (2xx olmayan) yanıt saklanmaz: aynı anahtarla yeniden gönderim baştan işlenir", async () => {
    const { s, member, calls } = messaging({ failFirst: true });
    const app = await server(s);
    const bad = await send(app, s, member, KEY);
    expect(bad.statusCode).toBe(422);
    const ok = await send(app, s, member, KEY);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["idempotent-replayed"]).toBeUndefined();
    expect((await send(app, s, member, KEY)).headers["idempotent-replayed"]).toBe("true");
    expect(calls).toHaveLength(2);
  });

  it("ilk istek sürerken gelen kopya onun sonucunu bekler ve aynı yanıtı alır", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const { s, member, calls } = messaging({ gate: () => gate });
    const app = await server(s);
    const first = send(app, s, member, KEY);
    await until(() => calls.length === 1);
    const copy = send(app, s, member, KEY);
    await sleep(20);
    open();
    const [a, b] = await Promise.all([first, copy]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.body).toBe(a.body);
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(calls).toHaveLength(1);
  });

  it("ilk istek bekleme süresinde bitmezse 409 idempotency_in_progress; bitince yeniden gönderim yanıtı alır", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const { s, member, calls } = messaging({ gate: () => gate });
    const app = await server(s, { idempotency: { waitMs: 30 } });
    const first = send(app, s, member, KEY);
    await until(() => calls.length === 1);
    const busy = await send(app, s, member, KEY);
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error.code).toBe("idempotency_in_progress");
    open();
    expect((await first).statusCode).toBe(200);
    const later = await send(app, s, member, KEY);
    expect(later.headers["idempotent-replayed"]).toBe("true");
    expect(calls).toHaveLength(1);
  });

  it("istemci zaman aşımıyla bağlantıyı koparsa da işlem bitince yanıt saklanır; yeniden gönderim aynı yanıtı alır", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const { s, member, calls } = messaging({ gate: () => gate });
    const app = await server(s);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/threads/topic/t1`;
    const init = { method: "POST", headers: { ...s.auth(member), "content-type": "application/json", "idempotency-key": KEY }, body: JSON.stringify(MSG) };

    const ctrl = new AbortController();
    const first = fetch(url, { ...init, signal: ctrl.signal }).then(
      () => null,
      (e: unknown) => e,
    );
    await until(() => calls.length === 1);
    ctrl.abort(); // istemci 30 sn'de vazgeçti; sunucu işi sürdürüyor
    expect(await first).toBeInstanceOf(Error);
    await sleep(20);
    open();

    const retry = await fetch(url, init);
    expect(retry.status).toBe(200);
    expect(retry.headers.get("idempotent-replayed")).toBe("true");
    expect(await retry.json()).toMatchObject({ id: "m1", body: MSG.body });
    expect(calls).toHaveLength(1);
  });
});

describe("Idempotency-Key: sınırlar", () => {
  it("saklama süresi (duvar saati) dolunca anahtar unutulur", async () => {
    let now = 1_000_000;
    const { s, member, calls } = messaging();
    const app = await server(s, { idempotency: { now: () => now } });
    await send(app, s, member, KEY);
    now += DEFAULT_IDEMPOTENCY.ttlMs - 1;
    expect((await send(app, s, member, KEY)).headers["idempotent-replayed"]).toBe("true");
    now += 2;
    expect((await send(app, s, member, KEY)).headers["idempotent-replayed"]).toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  it("kayıt sayısı sınırı aşılınca en eski tamamlanmış kayıt atılır", async () => {
    const { s, member, calls } = messaging();
    const app = await server(s, { idempotency: { maxEntries: 2 } });
    const keys = ["aaaaaaaa-0001", "bbbbbbbb-0002", "cccccccc-0003"];
    for (const k of keys) await send(app, s, member, k);
    expect((await send(app, s, member, keys[2])).headers["idempotent-replayed"]).toBe("true");
    expect((await send(app, s, member, keys[1])).headers["idempotent-replayed"]).toBe("true");
    expect((await send(app, s, member, keys[0])).headers["idempotent-replayed"]).toBeUndefined();
    expect(calls).toHaveLength(4);
  });

  it("toplam boyut sınırı aşılınca en eski yanıt atılır", async () => {
    const { s, member, calls } = messaging({ bodyOf: () => "x".repeat(400) });
    const app = await server(s, { idempotency: { maxBytes: 1000 } });
    await send(app, s, member, KEY);
    await send(app, s, member, KEY2); // ~2 × 430 bayt: sığar
    await send(app, s, member, "eeeeeeee-0003"); // üçüncüsü sınırı aşar → en eski (KEY) atılır
    expect((await send(app, s, member, KEY2)).headers["idempotent-replayed"]).toBe("true");
    expect((await send(app, s, member, KEY)).headers["idempotent-replayed"]).toBeUndefined();
    expect(calls).toHaveLength(4);
  });

  it("saklanamayacak kadar büyük yanıt: işlem tekrarlanmaz, yeniden gönderim 409 idempotency_replay_unavailable", async () => {
    const { s, member, calls } = messaging();
    const app = await server(s, { idempotency: { maxEntryBytes: 10 } });
    expect((await send(app, s, member, KEY)).statusCode).toBe(200);
    const r = await send(app, s, member, KEY);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("idempotency_replay_unavailable");
    expect(calls).toHaveLength(1);
  });
});

describe("Idempotency-Key: kapsam ve doğrulama", () => {
  it("geçersiz anahtar → 400 idempotency_key_invalid (işlem yapılmaz)", async () => {
    const { s, member, calls } = messaging();
    const app = await server(s);
    for (const bad of ["kisa", "bosluklu anahtar 123", "x".repeat(129), "a/b/c/d/e/f/g"]) {
      const r = await send(app, s, member, bad);
      expect(r.statusCode, bad).toBe(400);
      expect(r.json().error.code).toBe("idempotency_key_invalid");
    }
    expect(calls).toHaveLength(0);
  });

  it("anonim istekte başlık yok sayılır (önce oturum denetimi: 401)", async () => {
    const { s, calls } = messaging();
    const app = await server(s);
    const r = await send(app, s, null, "kisa");
    expect(r.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("çözülmüş kişisel veri döndüren uç kapsam dışıdır: yanıt saklanmaz, her okuma yeniden işlenir (erişim kaydı)", async () => {
    let reads = 0;
    const s = stubServices({
      identity: {
        getPii: (_actor, userId) => {
          reads++;
          return { userId, firstName: "Ad", lastName: "Soyad", tcknMasked: "123******90", birthDate: "1990-01-01", email: "a@ornek.org", phone: "05550000000", address: { il: "Ankara", ilce: "Çankaya", mahalle: "Kızılay", acikAdres: "x" } };
        },
      },
    });
    const registrar = s.addUser(fakeUser("memur", { roles: ["member", "registrar"] }));
    const app = await server(s);
    const read = () =>
      app.inject({ method: "POST", url: "/api/registrar/users/u-1/pii", headers: { ...s.auth(registrar), "idempotency-key": KEY }, payload: { purpose: "Başvuru incelemesi" } });
    const a = await read();
    const b = await read();
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.headers["idempotent-replayed"]).toBeUndefined();
    expect(reads).toBe(2);
  });

  it("yalnız denetim yapan uç (ön denetim) kapsam dışıdır", async () => {
    let checks = 0;
    const s = stubServices({ forum: { messages: { precheck: async () => (checks++, { pii: [] }) as never } } });
    const member = s.addUser(fakeUser("uye"));
    const app = await server(s);
    for (let i = 0; i < 2; i++) {
      const r = await app.inject({ method: "POST", url: "/api/messages/precheck", headers: { ...s.auth(member), "idempotency-key": KEY }, payload: { body: "Merhaba" } });
      expect(r.headers["idempotent-replayed"]).toBeUndefined();
    }
    expect(checks).toBe(2);
  });

  it("CORS: ön uçuş Idempotency-Key başlığına izin verir; Idempotent-Replayed istemciye açılır", async () => {
    const { s, member } = messaging();
    const app = await server(s);
    const pre = await app.inject({
      method: "OPTIONS",
      url: "/api/threads/topic/t1",
      headers: { origin: "capacitor://localhost", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type,idempotency-key" },
    });
    expect(pre.statusCode).toBe(204);
    expect(String(pre.headers["access-control-allow-headers"]).toLowerCase()).toMatch(/idempotency-key/);
    const r = await app.inject({ method: "POST", url: "/api/threads/topic/t1", headers: { ...s.auth(member), origin: "capacitor://localhost", "idempotency-key": KEY }, payload: MSG });
    expect(String(r.headers["access-control-expose-headers"]).toLowerCase()).toMatch(/idempotent-replayed/);
  });
});
