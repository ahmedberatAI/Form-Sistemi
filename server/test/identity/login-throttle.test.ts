// #226: hesap (normalleştirilmiş tanımlayıcı) başına giriş kilidi — 15 dakikada 5 başarısızlık → 15 dakika kilit, 429 + Retry-After.
// Var olmayan ad için de aynı davranış (hesabın varlığı sızmaz); süreler gerçek duvar saatiyle ölçülür.
import { describe, expect, it } from "vitest";
import { DAY } from "../../src/core/clock";
import { AppError } from "../../src/core/errors";
import { createLoginThrottle, LOGIN_LOCK_MS, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, throttleKey } from "../../src/identity/login-throttle";
import { expectAppError, regInput, setup } from "./fixtures";

const MIN = 60_000;

function lockErr(fn: () => unknown): AppError {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error("429 bekleniyordu");
}

describe("giriş kilidi (birim)", () => {
  it("varsayılanlar: 15 dakikada 5 başarısızlık → 15 dakika kilit", () => {
    expect(LOGIN_MAX_FAILURES).toBe(5);
    expect(LOGIN_WINDOW_MS).toBe(15 * MIN);
    expect(LOGIN_LOCK_MS).toBe(15 * MIN);
  });

  it("5. başarısızlıktan sonra kilit; Retry-After saniyesi; kilit bitince yeniden denenebilir", () => {
    let now = 1_000_000;
    const t = createLoginThrottle({ now: () => now });
    for (let i = 0; i < 5; i++) {
      t.begin("k");
      expect(t.failed("k")).toBe(i === 4); // kilidi başlatan başarısızlık bir kez bildirilir
    }
    const e = lockErr(() => t.begin("k"));
    expect(e.status).toBe(429);
    expect(e.code).toBe("login_locked");
    expect(e.details).toEqual({ retryAfterSeconds: 900 });
    expect(e.message).toMatch(/15 dakika sonra/);
    now += 10 * MIN;
    expect(lockErr(() => t.begin("k")).details).toEqual({ retryAfterSeconds: 300 });
    now += 5 * MIN;
    expect(() => t.begin("k")).not.toThrow();
  });

  it("başarılı giriş sayacı sıfırlar; pencere dolunca sayaç baştan başlar", () => {
    let now = 0;
    const t = createLoginThrottle({ now: () => now });
    for (let i = 0; i < 4; i++) {
      t.begin("a");
      t.failed("a");
    }
    t.begin("a");
    t.succeeded("a");
    for (let i = 0; i < 4; i++) {
      t.begin("a");
      t.failed("a");
    }
    expect(() => t.begin("a")).not.toThrow(); // 5. deneme yine denetlenir
    t.succeeded("a");

    for (let i = 0; i < 4; i++) {
      t.begin("b");
      t.failed("b");
    }
    now += 15 * MIN;
    for (let i = 0; i < 4; i++) {
      t.begin("b");
      t.failed("b");
    }
    expect(() => t.begin("b")).not.toThrow();
  });

  it("aynı anda gönderilen denemeler de sayılır (sonucu beklenmeden): 6. istek hemen reddedilir", () => {
    const t = createLoginThrottle({ now: () => 0 });
    for (let i = 0; i < 5; i++) t.begin("eszamanli");
    expect(lockErr(() => t.begin("eszamanli")).status).toBe(429);
  });

  it("anahtarlar ayrıdır; bellek sınırı dolunca kilitsiz kayıtlardan en az denemesi olan (eşitlikte en eski) atılır", () => {
    const t = createLoginThrottle({ now: () => 0, maxEntries: 3 });
    for (let i = 0; i < 3; i++) t.begin("yakin"); // kilide yaklaşmış sayaç (3 deneme)
    t.begin("a");
    t.begin("b");
    t.begin("c"); // yer açılır: tek denemelik en eski kayıt ("a") atılır, "yakin" değil
    t.begin("yakin"); // 4
    t.begin("yakin"); // 5: kilit başlar (sayaç atılsaydı burada 2 olurdu)
    expect(() => t.begin("yakin")).toThrow(AppError);
  });

  it("kilitli kayıt, sınır kadar kilitsiz yeni anahtar eklense de atılmaz (bellek doldurarak kilit silinemez)", () => {
    let now = 0;
    const t = createLoginThrottle({ now: () => now, maxEntries: 50 });
    for (let i = 0; i < 5; i++) t.begin("hedef");
    expect(lockErr(() => t.begin("hedef")).status).toBe(429);
    for (let i = 0; i < 200; i++) t.begin(`rastgele-${i}`); // çok adresli saldırgan: her biri yeni kayıt
    expect(lockErr(() => t.begin("hedef")).status).toBe(429);
    now += LOGIN_LOCK_MS;
    expect(() => t.begin("hedef")).not.toThrow(); // kilit süresi dolunca normal
  });

  it("hepsi kilitliyse kilidi en erken bitecek kayıt atılır (bellek yine sınırlı)", () => {
    let now = 0;
    const t = createLoginThrottle({ now: () => now, maxEntries: 2 });
    for (let i = 0; i < 5; i++) t.begin("ilk");
    now += 1000;
    for (let i = 0; i < 5; i++) t.begin("ikinci");
    t.begin("ucuncu"); // ikisi de kilitli: "ilk" (kilidi önce biten) atılır
    expect(() => t.begin("ilk")).not.toThrow();
    expect(lockErr(() => t.begin("ikinci")).status).toBe(429);
  });

  it("anahtar tanımlayıcıyı düz metin taşımaz", () => {
    const k = throttleKey("nickname", "gizli-ad");
    expect(k).not.toContain("gizli");
    expect(throttleKey("nickname", "gizli-ad")).toBe(k);
    expect(throttleKey("email", "gizli-ad")).not.toBe(k);
  });
});

describe("giriş kilidi (kimlik servisi)", () => {
  it("5 hatalı denemeden sonra doğru şifre de 429 login_locked alır; şifre denetlenmez; kilit gerçek saatle biter", async () => {
    let real = Date.UTC(2026, 9, 5, 12);
    const { identity, ctx } = setup({ realNow: () => real });
    const inp = regInput({ nickname: "kilitli_uye" });
    const { user } = await identity.register(inp);
    for (let i = 0; i < 5; i++) await expectAppError(identity.login("kilitli_uye", "Yanlis1234"), 401, "invalid_credentials");
    const failedBefore = ctx.db.all("SELECT 1 FROM audit_log WHERE action = 'identity.login_failed'").length;
    const e = await expectAppError(identity.login("KILITLI_UYE", inp.password), 429, "login_locked");
    expect(e.details).toEqual({ retryAfterSeconds: 900 });
    // Kilitliyken şifre denetlenmez: yeni login_failed kaydı yok.
    expect(ctx.db.all("SELECT 1 FROM audit_log WHERE action = 'identity.login_failed'").length).toBe(failedBefore);
    // Denetim: kilit bir kez, hedef hesap; tanımlayıcı yazılmaz.
    const locked = ctx.db.all<{ target: string | null; meta: string }>("SELECT target, meta FROM audit_log WHERE action = 'identity.login_locked'");
    expect(locked).toHaveLength(1);
    expect(locked[0].target).toBe(user.id);
    expect(JSON.parse(locked[0].meta)).toEqual({ via: "nickname" });
    expect(locked[0].meta).not.toContain("kilitli");

    // Simüle saat ileri alınsa da kilit sürer (demo hızlandırması kilidi kısaltmaz).
    ctx.clock.advance(DAY);
    await expectAppError(identity.login("kilitli_uye", inp.password), 429, "login_locked");
    real += 15 * MIN;
    expect((await identity.login("kilitli_uye", inp.password)).user.id).toBe(user.id);
  });

  it("var olmayan ad için de aynı davranış ve aynı ileti (hesabın varlığı sızmaz)", async () => {
    const { identity, ctx } = setup({ realNow: () => 0 });
    const inp = regInput({ nickname: "var_olan" });
    await identity.register(inp);
    for (let i = 0; i < 5; i++) {
      await expectAppError(identity.login("var_olan", "Yanlis1234"), 401, "invalid_credentials");
      await expectAppError(identity.login("olmayan_ad", "Yanlis1234"), 401, "invalid_credentials");
    }
    const a = await expectAppError(identity.login("var_olan", "Yanlis1234"), 429, "login_locked");
    const b = await expectAppError(identity.login("olmayan_ad", "Yanlis1234"), 429, "login_locked");
    expect(b.message).toBe(a.message);
    expect(b.details).toEqual(a.details);
    const targets = ctx.db.all<{ target: string | null }>("SELECT target FROM audit_log WHERE action = 'identity.login_locked' ORDER BY rowid").map((r) => r.target);
    expect(targets).toHaveLength(2);
    expect(targets).toContain(null);
  });

  it("takma ad ve e-posta ayrı sayılır: biri kilitlenince öteki e-postanın hangi takma ada ait olduğunu ele vermez", async () => {
    const { identity } = setup({ realNow: () => 0 });
    const inp = regInput({ nickname: "ayri_sayac", email: "ayri.sayac@ornek.com" });
    await identity.register(inp);
    for (let i = 0; i < 5; i++) await expectAppError(identity.login("ayri_sayac", "Yanlis1234"), 401, "invalid_credentials");
    await expectAppError(identity.login("ayri_sayac", "Yanlis1234"), 429, "login_locked");
    // Aynı hesabın e-postasıyla hatalı deneme 401 (429 değil); doğru şifreyle giriş olur.
    await expectAppError(identity.login("Ayri.Sayac@ornek.com", "Yanlis1234"), 401, "invalid_credentials");
    expect((await identity.login(" ayri.sayac@ornek.com ", inp.password)).user.nickname).toBe("ayri_sayac");
  });

  it("önceden kilitlenmiş (henüz hesabı olmayan) takma adla kayıt olan kişi hemen giriş yapabilir", async () => {
    const { identity } = setup({ realNow: () => 0 });
    for (let i = 0; i < 5; i++) await expectAppError(identity.login("sonradan_gelen", "Yanlis1234"), 401, "invalid_credentials");
    await expectAppError(identity.login("sonradan_gelen", "Yanlis1234"), 429, "login_locked");
    const inp = regInput({ nickname: "Sonradan_Gelen" });
    await identity.register(inp);
    expect((await identity.login(inp.nickname, inp.password)).user.nickname).toBe("Sonradan_Gelen");
  });

  it("başarılı giriş sayacı sıfırlar (4 hata + giriş + 4 hata → kilit yok)", async () => {
    const { identity } = setup({ realNow: () => 0 });
    const inp = regInput({ nickname: "sifirlanan" });
    await identity.register(inp);
    for (let i = 0; i < 4; i++) await expectAppError(identity.login("sifirlanan", "Yanlis1234"), 401, "invalid_credentials");
    await identity.login("sifirlanan", inp.password);
    for (let i = 0; i < 4; i++) await expectAppError(identity.login("sifirlanan", "Yanlis1234"), 401, "invalid_credentials");
    await identity.login("sifirlanan", inp.password);
  });
});
