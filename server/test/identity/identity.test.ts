import { describe, expect, it } from "vitest";
import { maskTckn } from "@forum/shared";
import { DAY } from "../../src/core/clock";
import { isVoter, SESSION_TTL_MS, createIdentityService } from "../../src/identity";
import { dumpDb, expectAppError, insertMessage, regInput, setup } from "./fixtures";

describe("kayıt doğrulaması", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["kısa takma ad", { nickname: "ab" }, "nickname"],
    ["boşluklu takma ad", { nickname: "ali veli" }, "nickname"],
    ["geçersiz karakterli takma ad", { nickname: "ali@x" }, "nickname"],
    ["kısa şifre", { password: "abc12" }, "password"],
    ["rakamsız şifre", { password: "sadeceharf" }, "password"],
    ["harfsiz şifre", { password: "12345678" }, "password"],
    ["geçersiz TCKN", { tckn: "12345678901" }, "tckn"],
    ["harfli TCKN", { tckn: "1234567890a" }, "tckn"],
    ["yanlış tarih biçimi", { birthDate: "15.05.1990" }, "birthDate"],
    ["olmayan tarih", { birthDate: "1990-02-30" }, "birthDate"],
    ["gelecekte doğum tarihi", { birthDate: "2030-01-01" }, "birthDate"],
    ["geçersiz e-posta", { email: "gecersiz" }, "email"],
    ["geçersiz telefon", { phone: "12345" }, "phone"],
    ["aydınlatma metni onaylanmamış", { kvkkNoticeAccepted: false }, "kvkkNoticeAccepted"],
    ["eksik ad", { firstName: undefined }, "firstName"],
  ];
  for (const [name, over, field] of cases) {
    it(`${name} → 400 validation (${field})`, async () => {
      const { identity } = setup();
      const e = await expectAppError(identity.register({ ...regInput(), ...over } as never), 400, "validation");
      expect(e.details).toHaveProperty(field);
      expect(e.message).toMatch(/[a-zçğıöşü]/i);
    });
  }

  it("boş adres alanları alan bazında raporlanır", async () => {
    const { identity } = setup();
    const e = await expectAppError(
      identity.register(regInput({ address: { il: "", ilce: "Çankaya", mahalle: "", acikAdres: "x" } })),
      400,
      "validation",
    );
    expect(Object.keys(e.details!)).toEqual(expect.arrayContaining(["address.il", "address.mahalle", "address.acikAdres"]));
    expect(e.details!["address.il"]).toContain("İl");
  });

  it("Türkçe harfli takma ad ve +90 telefon kabul edilir; telefon E.164'e çevrilir", async () => {
    const { identity, registrarId } = setup();
    const { user } = await identity.register(regInput({ nickname: "Çağrı.Öz-1", phone: "+90 (532) 111 22 33" }));
    expect(user.nickname).toBe("Çağrı.Öz-1");
    expect(identity.getPii(registrarId, user.id, "Kimlik doğrulaması").phone).toBe("+905321112233");
  });
});

describe("kayıt ve kasa", () => {
  it("bekleyen üye oluşturur; defter kaydı, memur bildirimi, denetim günlüğü", async () => {
    const { identity, ledger, notifier, registrarId, ctx } = setup();
    const { user } = await identity.register(regInput({ aiConsent: undefined as never }));
    expect(user.status).toBe("pending");
    expect(user.isAdult).toBe(true);
    expect(user.politicalConsent).toBe(true);
    expect(user.aiConsent).toBe(false);
    expect(user.regionIl).toBe("Ankara");
    expect(user.regionIlce).toBe("Çankaya");
    expect(user.roles).toEqual(["member"]);
    expect(identity.listPending().map((p) => p.id)).toEqual([user.id]);

    expect(ledger.txs).toHaveLength(1);
    expect(ledger.txs[0].type).toBe("MEMBER_REGISTERED");
    expect(Object.keys(ledger.txs[0].payload).sort()).toEqual(["at", "memberRef"]);
    expect(ledger.txs[0].payload.memberRef).toBe(identity.memberRef(user.id));
    expect(ledger.txs[0].payload.at).toBe(ctx.clock.now());

    expect(notifier.sent.filter((n) => n.userId === registrarId && n.kind === "registration_pending")).toHaveLength(1);
    const a = ctx.db.get<{ action: string }>("SELECT action FROM audit_log WHERE target = ? AND action = 'identity.register'", user.id);
    expect(a).toBeTruthy();
    const row = ctx.db.get<{ kvkk_notice_at: number }>("SELECT kvkk_notice_at FROM users WHERE id = ?", user.id)!;
    expect(row.kvkk_notice_at).toBe(ctx.clock.now());
  });

  it("şifreli alanlar veritabanında düz metin içermez", async () => {
    const { identity, ctx, registrarId } = setup();
    const inp = regInput({
      firstName: "Zümrüt",
      lastName: "Karabıyıkoğlu",
      email: "zumrut.karabiyikoglu@ornek.org",
      phone: "0544 987 65 43",
      birthDate: "1987-11-23",
      address: { il: "İzmir", ilce: "Bornova", mahalle: "Erzene Mahallesi", acikAdres: "Menekşe Sokak No 77 Daire 9" },
    });
    const { user } = await identity.register(inp);
    await identity.verify(registrarId, user.id, "approve");
    identity.getPii(registrarId, user.id, "Kimlik doğrulaması için");

    const vaultRow = ctx.db.get<Record<string, unknown>>("SELECT * FROM identity_vault WHERE user_id = ?", user.id)!;
    for (const k of ["enc_first_name", "enc_last_name", "enc_tckn", "enc_birth_date", "enc_email", "enc_phone", "enc_address"]) {
      expect(String(vaultRow[k])).toMatch(/^v1:/);
    }
    const all = dumpDb(ctx);
    const secrets = [inp.tckn, "Zümrüt", "Karabıyıkoğlu", "zumrut.karabiyikoglu", "5449876543", "544 987", "1987-11-23", "Menekşe", "Erzene"];
    for (const s of secrets) {
      expect(JSON.stringify(vaultRow).toLocaleLowerCase("tr-TR")).not.toContain(s.toLocaleLowerCase("tr-TR"));
      expect(all.toLocaleLowerCase("tr-TR")).not.toContain(s.toLocaleLowerCase("tr-TR"));
    }
    expect(JSON.stringify(identity.me(user.id))).not.toContain("Zümrüt");
  });

  it("AAD değişince (alanlar yer değiştirince / başka kullanıcıya kopyalanınca) çözme başarısız olur", async () => {
    const { identity, ctx, registrarId } = setup();
    const a = (await identity.register(regInput())).user;
    const b = (await identity.register(regInput())).user;
    const v = ctx.db.get<{ enc_first_name: string; enc_last_name: string }>("SELECT enc_first_name, enc_last_name FROM identity_vault WHERE user_id = ?", a.id)!;
    ctx.db.run("UPDATE identity_vault SET enc_first_name = ?, enc_last_name = ? WHERE user_id = ?", v.enc_last_name, v.enc_first_name, a.id);
    await expectAppError(() => identity.getPii(registrarId, a.id, "Bütünlük denetimi"), 500, "vault_integrity");

    const full = ctx.db.get<Record<string, string>>("SELECT * FROM identity_vault WHERE user_id = ?", b.id)!;
    const target = (await identity.register(regInput())).user;
    ctx.db.run(
      "UPDATE identity_vault SET wrapped_dek = ?, enc_tckn = ? WHERE user_id = ?",
      full.wrapped_dek,
      full.enc_tckn,
      target.id,
    );
    await expectAppError(() => identity.getPii(registrarId, target.id, "Bütünlük denetimi"), 500, "vault_integrity");
    expect(ctx.db.get("SELECT 1 FROM audit_log WHERE action = 'identity.vault_integrity_failure'")).toBeTruthy();
    expect(identity.getPii(registrarId, b.id, "Karşılaştırma").userId).toBe(b.id);
  });

  it("yinelenen TCKN, e-posta ve takma ad → 409", async () => {
    const { identity } = setup();
    const first = regInput({ nickname: "Ali", email: "Ali.Veli@Ornek.com" });
    await identity.register(first);
    const e1 = await expectAppError(identity.register(regInput({ tckn: first.tckn })), 409, "duplicate_tckn");
    expect(e1.message).toContain("T.C. kimlik");
    await expectAppError(identity.register(regInput({ email: "  ali.veli@ornek.COM " })), 409, "duplicate_email");
    const e3 = await expectAppError(identity.register(regInput({ nickname: "ALİ" })), 409, "duplicate_nickname");
    expect(e3.message).toContain("takma ad");
    // tr-TR: "ALI" → "alı" (noktasız), "Ali" ile farklıdır
    await identity.register(regInput({ nickname: "ALI" }));
  });

  it("reşit olmayan → isAdult false, doğrulansa da oy kullanamaz; 18 olunca güncellenir", async () => {
    const { identity, registrarId, ctx } = setup();
    const inp = regInput({ birthDate: "2010-03-01" });
    const { user } = await identity.register(inp);
    expect(user.isAdult).toBe(false);
    await identity.verify(registrarId, user.id, "approve");
    const { token } = await identity.login(inp.nickname, inp.password);
    const auth = identity.authenticate(token)!;
    expect(auth.status).toBe("verified");
    expect(auth.isAdult).toBe(false);
    expect(isVoter(auth)).toBe(false);

    ctx.clock.set(Date.UTC(2028, 2, 1, 12));
    expect(identity.refreshAdulthood()).toBe(1);
    expect(identity.me(user.id).isAdult).toBe(true);
  });
});

describe("giriş ve oturum", () => {
  it("takma ad ya da e-posta ile giriş; hatalı girişte genel mesaj", async () => {
    const { identity } = setup();
    const inp = regInput({ nickname: "Zeynep_K", email: "zeynep@ornek.com" });
    const { user } = await identity.register(inp);

    const r1 = await identity.login("zeynep_k", inp.password);
    expect(r1.user.id).toBe(user.id);
    expect(identity.authenticate(r1.token)?.id).toBe(user.id);
    const r2 = await identity.login("ZEYNEP_K", inp.password);
    expect(r2.user.id).toBe(user.id);
    const r3 = await identity.login("  Zeynep@Ornek.COM ", inp.password);
    expect(r3.user.id).toBe(user.id);

    const e1 = await expectAppError(identity.login("zeynep_k", "Yanlis1234"), 401, "invalid_credentials");
    const e2 = await expectAppError(identity.login("olmayan_kisi", "Yanlis1234"), 401, "invalid_credentials");
    const e3 = await expectAppError(identity.login("yok@ornek.com", "Yanlis1234"), 401, "invalid_credentials");
    expect(e1.message).toBe("Takma ad/e-posta veya şifre hatalı.");
    expect(e2.message).toBe(e1.message);
    expect(e3.message).toBe(e1.message);
  });

  it("belirteç kurcalanırsa null", async () => {
    const { identity, ctx } = setup();
    const inp = regInput();
    await identity.register(inp);
    const { token } = await identity.login(inp.nickname, inp.password);
    const [sid, sig] = token.split(".");
    const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === "x" ? "y" : "x") + s.slice(i + 1);
    expect(identity.authenticate(`${sid}.${flip(sig, 5)}`)).toBeNull();
    expect(identity.authenticate(`${flip(sid, 5)}.${sig}`)).toBeNull();
    expect(identity.authenticate(sid)).toBeNull();
    expect(identity.authenticate("")).toBeNull();
    expect(identity.authenticate("a.b.c")).toBeNull();
    // Başka imza anahtarıyla çalışan sunucu bu belirteci kabul etmez
    const other = createIdentityService({ ...ctx, config: { ...ctx.config, tokenKey: "44".repeat(32) } }, {
      ledger: null,
      notifier: { notify() {} },
      audit: { log() {} },
    });
    expect(other.authenticate(token)).toBeNull();
    expect(identity.authenticate(token)).not.toBeNull();
  });

  it("süre dolunca ve çıkışta oturum geçersiz", async () => {
    const { identity, ctx } = setup();
    const inp = regInput();
    await identity.register(inp);
    const { token } = await identity.login(inp.nickname, inp.password);
    expect(SESSION_TTL_MS).toBe(180 * DAY);
    ctx.clock.advance(SESSION_TTL_MS - 1000);
    expect(identity.authenticate(token)).not.toBeNull();
    ctx.clock.advance(1001);
    expect(identity.authenticate(token)).toBeNull();

    const { token: t2 } = await identity.login(inp.nickname, inp.password);
    expect(identity.authenticate(t2)).not.toBeNull();
    identity.logout(t2);
    expect(identity.authenticate(t2)).toBeNull();
  });
});

describe("doğrulama akışı", () => {
  it("onay: verified, MEMBER_VERIFIED {memberRef}, kullanıcıya bildirim", async () => {
    const { identity, registrarId, memberId, ledger, notifier, ctx } = setup();
    const { user } = await identity.register(regInput());
    await expectAppError(identity.verify(memberId, user.id, "approve"), 403, "forbidden");
    ctx.clock.advance(5000);
    const me = await identity.verify(registrarId, user.id, "approve", "Yüz yüze kimlik kontrolü yapıldı");
    expect(me.status).toBe("verified");
    expect(ctx.db.get<{ verified_at: number; verified_by: string }>("SELECT verified_at, verified_by FROM users WHERE id = ?", user.id)).toEqual({
      verified_at: ctx.clock.now(),
      verified_by: registrarId,
    });
    const tx = ledger.txs.find((t) => t.type === "MEMBER_VERIFIED")!;
    expect(tx.payload).toEqual({ memberRef: identity.memberRef(user.id) });
    expect(notifier.sent.some((n) => n.userId === user.id && n.kind === "account_verified")).toBe(true);
    expect(identity.listPending()).toEqual([]);
    await expectAppError(identity.verify(registrarId, user.id, "approve"), 409, "invalid_state");
  });

  it("red: rejected + kripto-imha; defter yüklerinde kişisel veri yok", async () => {
    const { identity, registrarId, ledger, ctx, notifier } = setup();
    const inp = regInput({ nickname: "reddedilecek" });
    const { user } = await identity.register(inp);
    const okInp = regInput();
    const ok = (await identity.register(okInp)).user;
    await identity.verify(registrarId, ok.id, "approve");

    const me = await identity.verify(registrarId, user.id, "reject", "Belgeler uyuşmuyor");
    expect(me.status).toBe("rejected");
    expect(me.nickname).toMatch(/^Reddedilen başvuru #/);
    const v = ctx.db.get<Record<string, unknown>>("SELECT * FROM identity_vault WHERE user_id = ?", user.id)!;
    for (const k of ["wrapped_dek", "enc_first_name", "enc_last_name", "enc_tckn", "enc_birth_date", "enc_email", "enc_phone", "enc_address", "tckn_bidx", "email_bidx", "household_bidx"]) {
      expect(v[k]).toBeNull();
    }
    await expectAppError(identity.login(inp.email, inp.password), 401, "invalid_credentials");
    await expectAppError(() => identity.getPii(registrarId, user.id, "Kontrol amaçlı"), 409, "pii_erased");
    expect(notifier.sent.some((n) => n.userId === user.id && n.kind === "account_rejected")).toBe(true);
    expect(ledger.txs.find((t) => t.type === "MEMBER_ERASED")!.payload).toEqual({ memberRef: identity.memberRef(user.id) });

    const forbiddenStrings = [inp.tckn, okInp.tckn, inp.email, okInp.email, "Ayşe", "Yılmaz", "Atatürk", "Kızılay", "1990-05-15", "5321234567", "+90", user.id, ok.id, inp.nickname, okInp.nickname];
    for (const t of ledger.txs) {
      expect(Object.keys(t.payload).every((k) => k === "memberRef" || k === "at")).toBe(true);
      const s = JSON.stringify(t.payload);
      for (const f of forbiddenStrings) expect(s).not.toContain(f);
    }
    // aynı TCKN ile yeniden başvuru mümkün
    await identity.register(regInput({ tckn: inp.tckn, email: inp.email, nickname: "reddedilecek" }));
  });

  it("periyodik imha: süresi geçen bekleyen başvurular kripto-imha edilir", async () => {
    const { identity, registrarId, ctx } = setup();
    const old = (await identity.register(regInput())).user;
    ctx.clock.advance(100 * DAY);
    const fresh = (await identity.register(regInput())).user;
    ctx.clock.advance(81 * DAY);
    expect(identity.purgeStalePending()).toBe(1);
    expect(identity.me(old.id).status).toBe("rejected");
    expect(identity.me(fresh.id).status).toBe("pending");
    await expectAppError(() => identity.getPii(registrarId, old.id, "Kontrol amaçlı"), 409, "pii_erased");
    expect(identity.purgeStalePending()).toBe(0);
  });

  it("kayıt memuru üyeyi doğrudan doğrulanmış olarak girer", async () => {
    const { identity, registrarId, memberId, ledger } = setup();
    await expectAppError(identity.createByRegistrar(memberId, regInput()), 403, "forbidden");
    const inp = regInput();
    const { user } = await identity.createByRegistrar(registrarId, inp);
    expect(user.status).toBe("verified");
    expect(identity.listPending()).toEqual([]);
    expect(ledger.txs.map((t) => t.type)).toEqual(["MEMBER_REGISTERED", "MEMBER_VERIFIED"]);
    const { token } = await identity.login(inp.nickname, inp.password);
    expect(isVoter(identity.authenticate(token)!)).toBe(true);
  });
});

describe("kişisel veriye erişim", () => {
  it("yalnız memur/denetçi/yönetici; amaç zorunlu; erişim günlüğe yazılır", async () => {
    const { identity, registrarId, auditorId, adminId, memberId, ctx } = setup();
    const inp = regInput();
    const { user } = await identity.register(inp);
    await expectAppError(() => identity.getPii(memberId, user.id, "Merak ettim"), 403, "forbidden");
    await expectAppError(() => identity.getPii(user.id, user.id, "Kendi verim"), 403, "forbidden");
    await expectAppError(() => identity.getPii(registrarId, user.id, "kısa"), 400, "validation");

    const rec = identity.getPii(registrarId, user.id, "Kimlik doğrulama görüşmesi");
    expect(rec).toEqual({
      userId: user.id,
      firstName: "Ayşe",
      lastName: "Yılmaz",
      tcknMasked: maskTckn(inp.tckn),
      birthDate: "1990-05-15",
      email: inp.email,
      phone: "+905321234567",
      address: inp.address,
    });
    expect(rec.tcknMasked).not.toBe(inp.tckn);
    identity.getPii(auditorId, user.id, "Periyodik denetim");
    identity.getPii(adminId, user.id, "Şikâyet incelemesi");

    const log = ctx.db.all<{ actor_id: string; purpose: string }>("SELECT actor_id, purpose FROM pii_access_log WHERE user_id = ? ORDER BY at", user.id);
    expect(log).toEqual([
      { actor_id: registrarId, purpose: "Kimlik doğrulama görüşmesi" },
      { actor_id: auditorId, purpose: "Periyodik denetim" },
      { actor_id: adminId, purpose: "Şikâyet incelemesi" },
    ]);
    expect(ctx.db.all("SELECT 1 FROM audit_log WHERE action = 'identity.pii_access' AND target = ?", user.id)).toHaveLength(3);
  });

  it("householdOf: aynı adres (yazım farkıyla) → aynı; farklı adres → farklı", async () => {
    const { identity } = setup();
    const a = (await identity.register(regInput({ address: { il: "Ankara", ilce: "Çankaya", mahalle: "Kızılay Mahallesi", acikAdres: "Atatürk Bulvarı No: 12 Daire 4" } }))).user;
    const b = (await identity.register(regInput({ address: { il: "ANKARA", ilce: "ÇANKAYA", mahalle: "Kızılay Mah.", acikAdres: "Atatürk Blv. No 12 D:4", postaKodu: "06420" } }))).user;
    const c = (await identity.register(regInput({ address: { il: "Ankara", ilce: "Çankaya", mahalle: "Kızılay Mahallesi", acikAdres: "Atatürk Bulvarı No: 12 Daire 5" } }))).user;
    expect(identity.householdOf(a.id)).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.householdOf(a.id)).toBe(identity.householdOf(b.id));
    expect(identity.householdOf(a.id)).not.toBe(identity.householdOf(c.id));
    expect(identity.householdOf("yok")).toBeNull();
  });
});

describe("rızalar ve roller", () => {
  it("siyasi rıza geri alınınca oy kullanamaz; YZ rızası ayrı", async () => {
    const { identity, registrarId, ctx } = setup();
    const inp = regInput();
    const { user } = await identity.register(inp);
    await identity.verify(registrarId, user.id, "approve");
    const { token } = await identity.login(inp.nickname, inp.password);
    expect(isVoter(identity.authenticate(token)!)).toBe(true);

    const me = identity.setConsents(user.id, { politicalConsent: false });
    expect(me.politicalConsent).toBe(false);
    expect(me.aiConsent).toBe(false);
    expect(isVoter(identity.authenticate(token)!)).toBe(false);

    const me2 = identity.setConsents(user.id, { aiConsent: true });
    expect(me2.aiConsent).toBe(true);
    expect(me2.politicalConsent).toBe(false);
    expect(ctx.db.all("SELECT 1 FROM audit_log WHERE action = 'identity.consents' AND target = ?", user.id)).toHaveLength(2);
    await expectAppError(() => identity.setConsents(user.id, { aiConsent: "evet" as never }), 400, "validation");
  });

  it("rolleri yalnız yönetici değiştirir; geçersiz rol reddi; member her zaman var", async () => {
    const { identity, adminId, registrarId, memberId } = setup();
    await expectAppError(() => identity.setRoles(registrarId, memberId, ["registrar"]), 403, "forbidden");
    await expectAppError(() => identity.setRoles(adminId, memberId, ["superuser" as never]), 400, "validation");
    expect(identity.setRoles(adminId, memberId, ["auditor", "registrar"]).roles).toEqual(["member", "registrar", "auditor"]);
    expect(identity.setRoles(adminId, memberId, []).roles).toEqual(["member"]);
    await expectAppError(() => identity.setRoles(adminId, adminId, ["member"]), 409, "last_admin");
  });

  it("me: bilirkişi bilgisi experts tablosundan", async () => {
    const { identity, ctx } = setup();
    const { user } = await identity.register(regInput());
    expect(identity.me(user.id).isExpert).toBe(false);
    ctx.db.run(
      "INSERT INTO experts(user_id, domains, credentials, status, created_at) VALUES (?, ?, 'Diploma', 'active', ?)",
      user.id,
      JSON.stringify(["https://forum.example/fy#Egitim"]),
      ctx.clock.now(),
    );
    const me = identity.me(user.id);
    expect(me.isExpert).toBe(true);
    expect(me.expertDomains).toEqual(["https://forum.example/fy#Egitim"]);
    await expectAppError(() => identity.me("yok"), 404, "not_found");
  });
});

describe("KVKK hakları", () => {
  it("exportOwnData: hesap, çözülmüş kişisel veri, rızalar, kendi içeriği", async () => {
    const { identity, ctx, registrarId, notifier } = setup();
    const inp = regInput();
    const { user } = await identity.register(inp);
    await identity.verify(registrarId, user.id, "approve");
    identity.getPii(registrarId, user.id, "Kimlik doğrulama");
    insertMessage(ctx, user.id, "Benim görüşüm şudur.");
    ctx.db.run("INSERT INTO notifications(id, user_id, kind, title, body, created_at) VALUES ('n1', ?, 'k', 'Başlık', 'Gövde', ?)", user.id, ctx.clock.now());
    expect(notifier.sent.length).toBeGreaterThan(0);

    const d = identity.exportOwnData(user.id) as Record<string, any>;
    expect(d.account.id).toBe(user.id);
    expect(d.account.nickname).toBe(inp.nickname);
    expect(d.personalData.tckn).toBe(inp.tckn);
    expect(d.personalData.email).toBe(inp.email);
    expect(d.personalData.address).toEqual(inp.address);
    expect(d.consents).toEqual({ kvkkNoticeAcceptedAt: user.joinedAt, politicalConsent: true, aiConsent: false });
    expect(d.messages).toHaveLength(1);
    expect(d.messages[0].body).toBe("Benim görüşüm şudur.");
    expect(d.notifications).toHaveLength(1);
    expect(d.piiAccessLog).toHaveLength(1);
    expect(d.piiAccessLog[0].purpose).toBe("Kimlik doğrulama");
    expect(d.ballots).toEqual([]);
    expect(d.delegations).toEqual({ outgoing: [], incomingActiveCount: 0 });
    expect(ctx.db.get("SELECT 1 FROM audit_log WHERE action = 'identity.export' AND actor_id = ?", user.id)).toBeTruthy();
  });

  it("eraseSelf: kripto-imha; getPii hata, giriş yok, mesajlar kalır, yeniden kayıt mümkün", async () => {
    const { identity, registrarId, ctx, ledger } = setup();
    const inp = regInput({ nickname: "silinecek" });
    const { user } = await identity.register(inp);
    await identity.verify(registrarId, user.id, "approve");
    const { token } = await identity.login(inp.nickname, inp.password);
    const msgId = insertMessage(ctx, user.id, "Bu mesaj silinmez.");

    await identity.eraseSelf(user.id);

    await expectAppError(() => identity.getPii(registrarId, user.id, "Silme sonrası kontrol"), 409, "pii_erased");
    await expectAppError(identity.login(inp.nickname, inp.password), 401, "invalid_credentials");
    await expectAppError(identity.login(inp.email, inp.password), 401, "invalid_credentials");
    expect(identity.authenticate(token)).toBeNull();

    const me = identity.me(user.id);
    expect(me.status).toBe("erased");
    expect(me.nickname).toBe(`Silinmiş üye #${user.id.replace(/-/g, "").slice(0, 6)}`);
    expect(me.politicalConsent).toBe(false);
    expect(me.aiConsent).toBe(false);
    expect(me.regionIl).toBeNull();
    expect(identity.householdOf(user.id)).toBeNull();
    const v = ctx.db.get<Record<string, unknown>>("SELECT * FROM identity_vault WHERE user_id = ?", user.id)!;
    expect(Object.entries(v).filter(([k, val]) => (k === "wrapped_dek" || k.startsWith("enc_") || k.endsWith("_bidx")) && val !== null)).toEqual([]);
    expect(ctx.db.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", user.id)!.password_hash).not.toMatch(/^scrypt\$/);

    const msg = ctx.db.get<{ author_id: string; body: string }>("SELECT author_id, body FROM messages WHERE id = ?", msgId)!;
    expect(msg).toEqual({ author_id: user.id, body: "Bu mesaj silinmez." });

    expect(ledger.txs.find((t) => t.type === "MEMBER_ERASED")!.payload).toEqual({ memberRef: identity.memberRef(user.id) });
    expect(ctx.db.get("SELECT 1 FROM audit_log WHERE action = 'identity.erase' AND target = ?", user.id)).toBeTruthy();
    const d = identity.exportOwnData(user.id) as Record<string, any>;
    expect(d.personalData).toBeNull();

    await expectAppError(identity.eraseSelf(user.id), 409, "already_erased");
    const again = await identity.register(regInput({ tckn: inp.tckn, email: inp.email, nickname: "silinecek" }));
    expect(again.user.id).not.toBe(user.id);
  });

  it("changePassword: eski şifre doğrulanır, diğer oturumlar iptal", async () => {
    const { identity } = setup();
    const inp = regInput();
    const { user } = await identity.register(inp);
    const t1 = (await identity.login(inp.nickname, inp.password)).token;
    const t2 = (await identity.login(inp.nickname, inp.password)).token;

    await expectAppError(identity.changePassword(user.id, "Yanlis1234", "YeniSifre99"), 400, "wrong_password");
    const weak = await expectAppError(identity.changePassword(user.id, inp.password, "zayif"), 400, "validation");
    expect(weak.details).toHaveProperty("newPassword");
    await expectAppError(identity.changePassword(user.id, inp.password, inp.password), 400, "validation");

    await identity.changePassword(user.id, inp.password, "YeniSifre99", t1);
    expect(identity.authenticate(t1)).not.toBeNull();
    expect(identity.authenticate(t2)).toBeNull();
    await expectAppError(identity.login(inp.nickname, inp.password), 401, "invalid_credentials");
    const t3 = (await identity.login(inp.nickname, "YeniSifre99")).token;

    await identity.changePassword(user.id, "YeniSifre99", "DahaYeni123");
    expect(identity.authenticate(t1)).toBeNull();
    expect(identity.authenticate(t3)).toBeNull();
    expect(await identity.verifyPassword(user.id, "DahaYeni123")).toBe(true);
    expect(await identity.verifyPassword(user.id, "YeniSifre99")).toBe(false);
  });
});
