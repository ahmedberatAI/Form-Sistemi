// Takma ad: I/ı katlamalı tekillik, benzerlik (taklit) denetimi, anahtar göçü, güvenli takma ad değişikliği,
// bildirimlerde takma adın okunurken çözülmesi (yeniden yazma yok) ve herkese açık katılım tarihinin güne yuvarlanması.
import { describe, expect, it } from "vitest";
import { nicknameKey, nicknameSkeleton, publicJoinDay } from "@forum/shared";
import { createAuditLogger } from "../../src/core/audit";
import { DAY } from "../../src/core/clock";
import { memberToken, renderNotificationRows } from "../../src/core/notification-text";
import { DbNotifier } from "../../src/core/notifier";
import { createIdentityService, toPublicUser, type UserRow } from "../../src/identity";
import { FakeLedger, insertUser, makeCtx } from "../helpers/fakes";
import { expectAppError, regInput, setup } from "./fixtures";

describe("takma ad anahtarı ve iskeleti (shared)", () => {
  it("I, ı, İ ve i aynı anahtara katlanır; büyük/küçük harf farkı yok", () => {
    for (const n of ["YONETICI", "Yonetici", "yonetici", "YONETİCİ", "yonetıcı"]) expect(nicknameKey(n)).toBe("yonetici");
    expect(nicknameKey("AUDIT_SELF1")).toBe(nicknameKey("audit_self1"));
    expect(nicknameKey("  Çağrı.Öz  ")).toBe("çağri.öz");
  });

  it("iskelet Türkçe harf, benzer rakam, l/I ve ayraç farklarını yok sayar", () => {
    const base = nicknameSkeleton("yonetici");
    for (const n of ["Yönetici", "y0netici", "yonetici_", "yo.netici", "YONETICI"]) expect(nicknameSkeleton(n), n).toBe(base);
    expect(nicknameSkeleton("Iale")).toBe(nicknameSkeleton("lale"));
    expect(nicknameSkeleton("şükrü")).toBe(nicknameSkeleton("sukru"));
    expect(nicknameSkeleton("ayse")).not.toBe(nicknameSkeleton("ayten"));
  });

  it("herkese açık katılım tarihi Türkiye saatine göre günün başına yuvarlanır", () => {
    const at = Date.UTC(2026, 9, 1, 22, 30, 17, 123); // 2 Ekim 01:30 (TR)
    expect(publicJoinDay(at)).toBe(Date.UTC(2026, 9, 1, 21)); // 2 Ekim 00:00 (TR)
    expect(publicJoinDay(Date.UTC(2026, 9, 1, 20, 59))).toBe(Date.UTC(2026, 8, 30, 21)); // 1 Ekim 23:59 (TR)
    expect(publicJoinDay(publicJoinDay(at))).toBe(publicJoinDay(at));
  });
});

describe("kayıtta tekillik ve benzerlik", () => {
  it("büyük harfli ASCII 'I' içeren takma ad mevcut hesapla çakışır (409 duplicate_nickname)", async () => {
    const { identity } = setup(); // fixtures: "yonetici" var
    await expectAppError(identity.register(regInput({ nickname: "YONETICI" })), 409, "duplicate_nickname");
    await expectAppError(identity.register(regInput({ nickname: "Yonetici" })), 409, "duplicate_nickname");
    await identity.register(regInput({ nickname: "audit_self1" }));
    await expectAppError(identity.register(regInput({ nickname: "AUDIT_SELF1" })), 409, "duplicate_nickname");
  });

  it("taklit niteliğinde benzer takma ad reddedilir (409 similar_nickname)", async () => {
    const { identity } = setup();
    for (const n of ["Yönetici", "y0netici", "yonetici_", "yo.netici"]) {
      const e = await expectAppError(identity.register(regInput({ nickname: n })), 409, "similar_nickname");
      expect(e.details).toHaveProperty("nickname");
    }
    await identity.register(regInput({ nickname: "lale_y" }));
    await expectAppError(identity.register(regInput({ nickname: "Iale_y" })), 409, "similar_nickname");
    // Farklı bir takma ad sorunsuz kaydolur.
    expect((await identity.register(regInput({ nickname: "yonetim_gonullusu" }))).user.status).toBe("pending");
  });

  it("giriş, takma adın büyük/küçük harf ve I/ı yazımından bağımsızdır", async () => {
    const { identity, registrarId } = setup();
    const inp = regInput({ nickname: "ILGIN" });
    const { user } = await identity.createByRegistrar(registrarId, inp);
    for (const login of ["ILGIN", "ılgın", "Ilgin", "ilgin", "İLGİN"]) {
      expect((await identity.login(login, inp.password)).user.id, login).toBe(user.id);
    }
  });
});

describe("nickname_norm göçü (I/ı katlaması)", () => {
  it("eski anahtarlar yeniden hesaplanır; çakışmada en eski hesap anahtarı korur, sonraki işaretlenir ve bildirilir", async () => {
    const ctx = makeCtx();
    const old = (nickname: string, norm: string, createdAt: number) => {
      const id = insertUser(ctx.db, { nickname: `gecici${createdAt}`, createdAt });
      ctx.db.run("UPDATE users SET nickname = ?, nickname_norm = ? WHERE id = ?", nickname, norm, id);
      return id;
    };
    // Eski kural: toLocaleLowerCase("tr-TR") → "YONETICI" ≠ "yonetici".
    const first = old("yonetici", "yonetici", Date.UTC(2026, 0, 1));
    const second = old("YONETICI", "yonetıcı", Date.UTC(2026, 0, 2));
    const third = old("AUDIT_X", "audıt_x", Date.UTC(2026, 0, 3));
    ctx.db.run("DELETE FROM meta WHERE key = 'nickname_key_version'");

    const notifier = new DbNotifier(ctx);
    const audit = createAuditLogger(ctx);
    const identity = createIdentityService(ctx, { ledger: new FakeLedger(ctx.clock), notifier, audit });
    const norm = (id: string) => ctx.db.get<{ nickname_norm: string }>("SELECT nickname_norm FROM users WHERE id = ?", id)!.nickname_norm;
    expect(norm(first)).toBe("yonetici");
    expect(norm(second)).toMatch(/^yonetici#[0-9a-f]{8}$/);
    expect(norm(third)).toBe("audit_x");
    expect(identity.me(second).nickname).toBe("YONETICI"); // görünen ad değişmez

    const conflicts = ctx.db.all<{ target: string; meta: string }>("SELECT target, meta FROM audit_log WHERE action = 'identity.nickname_conflict'");
    expect(conflicts.map((c) => c.target)).toEqual([second]);
    expect(conflicts[0].meta).not.toContain("YONETICI");
    expect(ctx.db.all("SELECT 1 FROM notifications WHERE user_id = ? AND kind = 'nickname_conflict'", second)).toHaveLength(1);

    // Göç bir kez çalışır: hizmet yeniden kurulduğunda yeni bildirim üretilmez.
    createIdentityService(ctx, { ledger: new FakeLedger(ctx.clock), notifier, audit });
    expect(ctx.db.all("SELECT 1 FROM notifications WHERE kind = 'nickname_conflict'")).toHaveLength(1);
  });

  it("çakışan hesap takma adını 30 günlük sınır olmadan değiştirebilir", async () => {
    const ctx = makeCtx();
    const identity0 = createIdentityService(ctx, { ledger: new FakeLedger(ctx.clock), notifier: new DbNotifier(ctx), audit: createAuditLogger(ctx) });
    const registrarId = insertUser(ctx.db, { nickname: "memur", roles: ["member", "registrar"] });
    const a = await identity0.createByRegistrar(registrarId, regInput({ nickname: "irmak" }));
    ctx.clock.advance(1000); // göçte "en eski" sıralaması belirgin olsun
    const inp = regInput({ nickname: "irmak_b" });
    const b = await identity0.createByRegistrar(registrarId, inp);
    // Eski kuralla açılmış çakışan hesabı taklit et ve göçü yeniden çalıştır.
    ctx.db.run("UPDATE users SET nickname = 'IRMAK', nickname_norm = 'ırmak' WHERE id = ?", b.user.id);
    ctx.db.run("DELETE FROM meta WHERE key = 'nickname_key_version'");
    const identity = createIdentityService(ctx, { ledger: new FakeLedger(ctx.clock), notifier: new DbNotifier(ctx), audit: createAuditLogger(ctx) });
    expect((await identity.login("IRMAK", inp.password).catch(() => null))?.user.id ?? null).not.toBe(b.user.id);
    expect((await identity.login(inp.email, inp.password)).user.id).toBe(b.user.id);
    await identity.changeNickname(b.user.id, "irmak_bulut", inp.password);
    // İlk değişiklikten hemen sonra sınır yeniden işler.
    await expectAppError(identity.changeNickname(b.user.id, "irmak_bulut2", inp.password), 422, "nickname_change_limit");
    expect(identity.me(a.user.id).nickname).toBe("irmak");
  });
});

describe("takma ad değişikliği", () => {
  async function member(s: ReturnType<typeof setup>, nickname = "eski_ad") {
    const inp = regInput({ nickname });
    const { user } = await s.identity.createByRegistrar(s.registrarId, inp);
    return { id: user.id, password: inp.password, email: inp.email };
  }

  it("şifre teyidi, kural, tekillik ve benzerlik denetimi", async () => {
    const s = setup();
    const m = await member(s);
    await expectAppError(s.identity.changeNickname(m.id, "yeni_ad", "yanlis-sifre1"), 400, "wrong_password");
    await expectAppError(s.identity.changeNickname(m.id, "ab", m.password), 400, "validation");
    await expectAppError(s.identity.changeNickname(m.id, "ali veli", m.password), 400, "validation");
    await expectAppError(s.identity.changeNickname(m.id, "eski_ad", m.password), 400, "validation");
    await expectAppError(s.identity.changeNickname(m.id, "YONETICI", m.password), 409, "duplicate_nickname");
    await expectAppError(s.identity.changeNickname(m.id, "y0netici", m.password), 409, "similar_nickname");
    // Reddedilen denemeler sınırı tüketmez.
    const me = await s.identity.changeNickname(m.id, "Yeni_Ad", m.password);
    expect(me.nickname).toBe("Yeni_Ad");
    expect((await s.identity.login("YENI_AD", m.password)).user.id).toBe(m.id);
    await expectAppError(s.identity.login("eski_ad", m.password), 401, "invalid_credentials");
  });

  it("30 günde en çok bir kez; denetim kaydında eski/yeni ad yok; kişiye bildirim", async () => {
    const s = setup();
    const m = await member(s);
    await s.identity.changeNickname(m.id, "ikinci_ad", m.password);
    s.ctx.clock.advance(29 * DAY);
    const e = await expectAppError(s.identity.changeNickname(m.id, "ucuncu_ad", m.password), 422, "nickname_change_limit");
    expect(e.message).toContain("1 gün sonra");
    s.ctx.clock.advance(DAY);
    expect((await s.identity.changeNickname(m.id, "ucuncu_ad", m.password)).nickname).toBe("ucuncu_ad");

    const logs = s.ctx.db.all<{ meta: string | null }>("SELECT meta FROM audit_log WHERE action = 'identity.nickname_change' AND target = ?", m.id);
    expect(logs).toHaveLength(2);
    for (const l of logs) for (const n of ["eski_ad", "ikinci_ad", "ucuncu_ad"]) expect(l.meta ?? "").not.toContain(n);
    expect(s.notifier.sent.filter((n) => n.userId === m.id && n.kind === "nickname_changed")).toHaveLength(2);
  });

  it("yalnız büyük/küçük harf değişikliği kendi anahtarıyla çakışmaz; silinmiş hesap değiştiremez", async () => {
    const s = setup();
    const m = await member(s, "deniz");
    expect((await s.identity.changeNickname(m.id, "Deniz", m.password)).nickname).toBe("Deniz");
    await s.identity.eraseSelf(m.id);
    await expectAppError(s.identity.changeNickname(m.id, "deniz2", m.password), 409, "invalid_state");
  });
});

describe("kayıtlı bildirimlerde takma ad (okunurken çözülen belirteç)", () => {
  function dbSetup() {
    const ctx = makeCtx();
    const notifier = new DbNotifier(ctx);
    const identity = createIdentityService(ctx, { ledger: new FakeLedger(ctx.clock), notifier, audit: createAuditLogger(ctx) });
    const registrarId = insertUser(ctx.db, { nickname: "memur", roles: ["member", "registrar"] });
    const otherId = insertUser(ctx.db, { nickname: "diger" });
    const raw = (userId: string) => ctx.db.all<{ kind: string; title: string; body: string }>("SELECT kind, title, body FROM notifications WHERE user_id = ? ORDER BY created_at, id", userId);
    /** Bildirim kutusunda görünen metin (okuma yolundaki çözümleme). */
    const shown = (userId: string) => renderNotificationRows(ctx.db, raw(userId));
    return { ctx, notifier, identity, registrarId, otherId, raw, shown };
  }

  it("bildirim kayıtlı metinde takma ad değil üye belirteci taşır", async () => {
    const t = dbSetup();
    const { user } = await t.identity.register(regInput({ nickname: "belirtec_uye" }));
    const [n] = t.raw(t.registrarId);
    expect(n.body).toBe(`"${memberToken(user.id)}" takma adlı yeni üyenin kimlik doğrulaması bekleniyor.`);
    expect(n.body).not.toContain("belirtec_uye");
    expect(t.shown(t.registrarId)[0].body).toBe('"belirtec_uye" takma adlı yeni üyenin kimlik doğrulaması bekleniyor.');
  });

  it("takma ad değişince bildirim güncel adı gösterir; kayıtlı satırlar yeniden yazılmaz", async () => {
    const t = dbSetup();
    const inp = regInput({ nickname: "ilk_ad" });
    const { user } = await t.identity.register(inp);
    const before = t.raw(t.registrarId);
    await t.identity.changeNickname(user.id, "ikinci_ad", inp.password);
    expect(t.raw(t.registrarId)).toEqual(before);
    expect(t.shown(t.registrarId)[0].body).toBe('"ikinci_ad" takma adlı yeni üyenin kimlik doğrulaması bekleniyor.');
  });

  it("başka bir alanda (öneri başlığı) takma adla aynı yazılan tırnaklı metne dokunulmaz", async () => {
    const t = dbSetup();
    const inp = regInput({ nickname: "ulasim_plani" });
    const { user } = await t.identity.register(inp);
    // Bir önerinin başlığı eski takma adla aynı: geri çekilme bildirimi başlığı tırnak içinde yazar.
    t.notifier.notify(t.otherId, { kind: "proposal_phase", title: "#T-1 geri çekildi", body: "“ulasim_plani” yazarı tarafından geri çekildi.", link: null });
    await t.identity.changeNickname(user.id, "yeni_ad_alindi", inp.password);
    await t.identity.eraseSelf(user.id);
    expect(t.shown(t.otherId)[0].body).toBe("“ulasim_plani” yazarı tarafından geri çekildi.");
  });

  it("kripto-imhada belirteç 'Silinmiş üye #…' olarak çözülür; eski takma ad görünmez", async () => {
    const t = dbSetup();
    const inp = regInput({ nickname: "audit_self1" });
    const { user } = await t.identity.register(inp);
    t.ctx.clock.advance(1000);
    t.identity.requestCorrection(user.id, { changes: { lastName: "Kaya" }, reason: "Soyadım evlilik nedeniyle değişti." });
    // Başka modüllerin şablonu: gövde belirteçle başlar.
    t.ctx.clock.advance(1000);
    t.notifier.notify(t.otherId, { kind: "message_reply", title: "Mesajınıza yanıt geldi", body: `${memberToken(user.id)}, #K-3 tartışmasında mesajınızı yanıtladı.`, link: null });
    // Takma adla aynı yazılan sıradan bir sözcük (belirteç olmayan metin) değişmez.
    t.ctx.clock.advance(1000);
    t.notifier.notify(t.otherId, { kind: "proposal_note", title: "Bilgi", body: "Konu: audit_self1 adlı dosya incelendi.", link: null });
    expect(t.shown(t.registrarId).every((n) => n.body.includes('"audit_self1"'))).toBe(true);

    await t.identity.eraseSelf(user.id);
    const anon = t.identity.me(user.id).nickname;
    expect(anon).toMatch(/^Silinmiş üye #/);
    expect(t.shown(t.registrarId).map((n) => n.body)).toEqual([
      `"${anon}" takma adlı yeni üyenin kimlik doğrulaması bekleniyor.`,
      expect.stringContaining(`"${anon}" takma adlı üye`),
    ]);
    expect(t.shown(t.otherId).map((n) => ({ kind: n.kind, body: n.body }))).toEqual([
      { kind: "message_reply", body: `${anon}, #K-3 tartışmasında mesajınızı yanıtladı.` },
      { kind: "proposal_note", body: "Konu: audit_self1 adlı dosya incelendi." },
    ]);
    // Kayıtlı (ham) metinlerde de eski takma ad hiç yoktur: belirteç taşınır.
    expect(JSON.stringify([...t.raw(t.registrarId), ...t.raw(t.otherId).slice(0, 1)])).not.toContain("audit_self1");
  });

  it("reddedilen başvuruda belirteç 'Reddedilen başvuru #…' olarak çözülür", async () => {
    const t = dbSetup();
    const { user } = await t.identity.register(regInput({ nickname: "reddedilecek_aday" }));
    await t.identity.verify(t.registrarId, user.id, "reject");
    const [n] = t.shown(t.registrarId);
    expect(n.body).toMatch(/^"Reddedilen başvuru #[0-9a-f]{6}" takma adlı/);
  });

  it("bilinmeyen kimlikli belirteç 'Silinmiş üye' olur; belirteçsiz eski satırlar aynen kalır", () => {
    const t = dbSetup();
    t.notifier.notify(t.otherId, { kind: "x", title: "{{uye:yok-boyle-biri}} yazdı", body: "eski satır: ali yanıtladı", link: null });
    expect(t.shown(t.otherId)[0]).toMatchObject({ title: "Silinmiş üye yazdı", body: "eski satır: ali yanıtladı" });
  });
});

describe("herkese açık katılım tarihi", () => {
  it("PublicUser.joinedAt güne yuvarlanır; Me (yalnız sahibine) tam anı taşır", async () => {
    const { identity, ctx } = setup();
    ctx.clock.advance(13 * 3_600_000 + 1234);
    const { user } = await identity.register(regInput());
    const row = ctx.db.get<UserRow>("SELECT * FROM users WHERE id = ?", user.id)!;
    expect(user.joinedAt).toBe(row.created_at);
    const pub = toPublicUser(row);
    expect(pub.joinedAt).toBe(publicJoinDay(row.created_at));
    expect(pub.joinedAt).not.toBe(row.created_at);
  });
});
