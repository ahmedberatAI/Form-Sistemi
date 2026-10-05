// KVKK md. 11/1-d: kimlik verisi düzeltme talebi akışı (üye → kayıt memuru; amaç kayıtlı inceleme; kasa yeniden şifreleme).
import { describe, expect, it } from "vitest";
import { generateTckn, maskTckn } from "@forum/shared";
import { dumpDb, expectAppError, regInput, setup } from "./fixtures";

async function verifiedMember(s: ReturnType<typeof setup>, over: Parameters<typeof regInput>[0] = {}) {
  const { user } = await s.identity.createByRegistrar(s.registrarId, regInput(over));
  return user.id;
}

describe("kimlik verisi düzeltme talebi", () => {
  it("talep → amaçlı inceleme → onay: kasa alanları yeniden şifrelenir, kör indeks/il/ilçe güncellenir, değerler günlüğe yazılmaz", async () => {
    const s = setup();
    const { identity, ctx, registrarId, notifier } = s;
    const userId = await verifiedMember(s, { lastName: "Yılmaz", email: "eski.adres@ornek.com.tr" });
    const before = ctx.db.get<Record<string, string>>("SELECT * FROM identity_vault WHERE user_id = ?", userId)!;

    const req = identity.requestCorrection(userId, {
      changes: {
        lastName: "Demir",
        email: "Yeni.Adres@Ornek.com.tr",
        address: { il: "İzmir", ilce: "Karşıyaka", mahalle: "Bostanlı Mahallesi", acikAdres: "Cemal Gürsel Caddesi No: 5" },
        firstName: "Ayşe", // mevcutla aynı → alan listesine girmez
      },
      reason: "Evlilik nedeniyle soyadım değişti ve taşındım.",
    });
    expect(req.status).toBe("pending");
    expect(req.fields).toEqual(["lastName", "email", "address"]);
    expect(req.reason).toBe("Evlilik nedeniyle soyadım değişti ve taşındım.");
    expect(notifier.sent.some((n) => n.userId === registrarId && n.kind === "identity_correction_pending")).toBe(true);

    // Değerler talep tablosunda düz metin değil
    const raw = dumpDb(ctx);
    expect(raw).not.toContain("Demir");
    expect(raw).not.toContain("Bostanlı");
    expect(raw).not.toContain("Evlilik nedeniyle");

    // Liste değer içermez
    const list = identity.listCorrections(registrarId);
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("reason");

    // İncelemeden karar verilemez
    await expectAppError(() => identity.decideCorrection(registrarId, req.id, "approve"), 409, "review_required");
    await expectAppError(() => identity.reviewCorrection(registrarId, req.id, "kısa"), 400, "validation");

    const review = identity.reviewCorrection(registrarId, req.id, "Üyenin bilgi düzeltme talebi");
    expect(review.reason).toContain("Evlilik");
    expect(review.current).toMatchObject({ lastName: "Yılmaz", email: "eski.adres@ornek.com.tr" });
    expect(review.proposed).toMatchObject({ lastName: "Demir", email: "Yeni.Adres@Ornek.com.tr" });
    expect(review.proposed.address?.il).toBe("İzmir");
    expect(review.current.firstName).toBeUndefined(); // yalnız düzeltilen alanlar
    const log = ctx.db.all<{ actor_id: string; user_id: string; purpose: string }>("SELECT * FROM pii_access_log");
    expect(log).toEqual([expect.objectContaining({ actor_id: registrarId, user_id: userId, purpose: "Üyenin bilgi düzeltme talebi" })]);

    const done = identity.decideCorrection(registrarId, req.id, "approve", "Nüfus kayıt örneği görüldü");
    expect(done.status).toBe("approved");
    expect(done.decisionNote).toBe("Nüfus kayıt örneği görüldü");

    const pii = identity.getPii(registrarId, userId, "Düzeltme sonrası kontrol");
    expect(pii.lastName).toBe("Demir");
    expect(pii.firstName).toBe("Ayşe");
    expect(pii.email).toBe("Yeni.Adres@Ornek.com.tr");
    expect(pii.address).toMatchObject({ il: "İzmir", ilce: "Karşıyaka" });
    const after = ctx.db.get<Record<string, string>>("SELECT * FROM identity_vault WHERE user_id = ?", userId)!;
    expect(after.enc_last_name).not.toBe(before.enc_last_name);
    expect(after.enc_first_name).toBe(before.enc_first_name); // değişmeyen alan aynen kalır
    expect(after.email_bidx).not.toBe(before.email_bidx);
    expect(after.household_bidx).not.toBe(before.household_bidx);
    expect(after.wrapped_dek).toBe(before.wrapped_dek);
    expect(ctx.db.get<{ region_il: string; region_ilce: string }>("SELECT region_il, region_ilce FROM users WHERE id = ?", userId)).toEqual({
      region_il: "İzmir",
      region_ilce: "Karşıyaka",
    });
    // Yeni e-postayla giriş
    const { user } = await identity.login("yeni.adres@ornek.com.tr", "Gizli1234");
    expect(user.id).toBe(userId);
    await expectAppError(identity.login("eski.adres@ornek.com.tr", "Gizli1234"), 401, "invalid_credentials");

    // Öneri imha edildi; denetim günlüğünde yalnız alan adları
    expect(ctx.db.get<{ enc_payload: string | null }>("SELECT enc_payload FROM identity_corrections WHERE id = ?", req.id)?.enc_payload).toBeNull();
    const audit = ctx.db.all<{ action: string; meta: string }>("SELECT action, meta FROM audit_log WHERE action LIKE 'identity.correction%'");
    expect(audit.map((a) => a.action)).toEqual(["identity.correction_requested", "identity.correction_approved"]);
    for (const a of audit) {
      expect(a.meta).toContain("lastName");
      expect(a.meta).not.toContain("Demir");
      expect(a.meta).not.toContain("Yeni.Adres");
    }
    expect(notifier.sent.some((n) => n.userId === userId && n.title.includes("düzeltildi"))).toBe(true);

    // Üye kendi listesinde gerekçesini görür; KVKK dökümünde talep kaydı var
    expect(identity.myCorrections(userId)[0]).toMatchObject({ status: "approved", reason: "Evlilik nedeniyle soyadım değişti ve taşındım." });
    const exp = identity.exportOwnData(userId) as { identityCorrections: { fields: string[]; status: string }[] };
    expect(exp.identityCorrections).toEqual([expect.objectContaining({ fields: ["lastName", "email", "address"], status: "approved" })]);
  });

  it("TCKN ve doğum tarihi düzeltmesi: kör indeks ve reşitlik yeniden hesaplanır; incelemede TCKN maskeli", async () => {
    const s = setup();
    const { identity, ctx, registrarId } = s;
    const userId = await verifiedMember(s, { birthDate: "1990-05-15" });
    const newTckn = generateTckn("765432109");
    const req = identity.requestCorrection(userId, { changes: { tckn: newTckn, birthDate: "2015-01-01" }, reason: "Kayıtta TCKN ve doğum tarihi yanlış girilmiş." });
    const review = identity.reviewCorrection(registrarId, req.id, "Üyenin bilgi düzeltme talebi");
    expect(review.proposed.tckn).toBe(maskTckn(newTckn));
    expect(review.current.tckn).toMatch(/\*{6}/);
    identity.decideCorrection(registrarId, req.id, "approve");
    expect(ctx.db.get<{ is_adult: number }>("SELECT is_adult FROM users WHERE id = ?", userId)?.is_adult).toBe(0);
    // Yeni TCKN artık kayıtlı: başka biri aynı TCKN ile kaydolamaz
    await expectAppError(identity.register(regInput({ tckn: newTckn })), 409, "duplicate_tckn");
  });

  it("ret: kasa değişmez, öneri imha edilir, üyeye bildirim gider", async () => {
    const s = setup();
    const { identity, ctx, registrarId, notifier } = s;
    const userId = await verifiedMember(s);
    const before = ctx.db.get<Record<string, string>>("SELECT * FROM identity_vault WHERE user_id = ?", userId)!;
    const req = identity.requestCorrection(userId, { changes: { phone: "0533 999 88 77" }, reason: "Telefon numaram değişti, lütfen güncelleyin." });
    identity.reviewCorrection(registrarId, req.id, "Üyenin bilgi düzeltme talebi");
    const r = identity.decideCorrection(registrarId, req.id, "reject", "Belge sunulmadı");
    expect(r.status).toBe("rejected");
    const after = ctx.db.get<Record<string, string>>("SELECT * FROM identity_vault WHERE user_id = ?", userId)!;
    expect(after.enc_phone).toBe(before.enc_phone);
    expect(ctx.db.get<{ enc_payload: string | null }>("SELECT enc_payload FROM identity_corrections WHERE id = ?", req.id)?.enc_payload).toBeNull();
    expect(notifier.sent.some((n) => n.userId === userId && n.title.includes("reddedildi"))).toBe(true);
    await expectAppError(() => identity.decideCorrection(registrarId, req.id, "approve"), 409, "invalid_state");
    // İncelemede öneri artık gösterilmez, gerekçe kalır
    const again = identity.reviewCorrection(registrarId, req.id, "Denetim: kapanmış talep");
    expect(again.proposed).toEqual({});
    expect(again.reason).toContain("Telefon");
  });

  it("doğrulama ve kurallar: gerekçe, bilinmeyen alan, değişiklik yok, tek bekleyen talep, yinelenen e-posta, geri çekme", async () => {
    const s = setup();
    const { identity, registrarId } = s;
    const userId = await verifiedMember(s);
    const otherEmail = "baskasi@ornek.com.tr";
    await verifiedMember(s, { email: otherEmail });

    let e = await expectAppError(() => identity.requestCorrection(userId, { changes: { lastName: "Kaya" }, reason: "kısa" }), 400, "validation");
    expect(e.details).toHaveProperty("reason");
    e = await expectAppError(() => identity.requestCorrection(userId, { changes: { nickname: "yeni" } as never, reason: "Takma adımı değiştirmek istiyorum." }), 400, "validation");
    expect(e.details).toHaveProperty("nickname");
    e = await expectAppError(() => identity.requestCorrection(userId, { changes: { tckn: "12345678901" }, reason: "TCKN yanlış girilmiş durumda." }), 400, "validation");
    expect(e.details).toHaveProperty("tckn");
    e = await expectAppError(() => identity.requestCorrection(userId, { changes: {}, reason: "Herhangi bir şey yazıyorum." }), 400, "validation");
    expect(e.details).toHaveProperty("changes");
    await expectAppError(() => identity.requestCorrection(userId, { changes: { firstName: "Ayşe" }, reason: "Adım zaten bu, deneme." }), 400, "validation");
    // Yinelenen e-posta talep anında REDDEDİLMEZ (üyeye dönen 409 bir üyelik kâhini olurdu, KVKK.md §4.4): talep açılır, çakışma
    // yalnız denetim günlüğüne yazılır ve kayıt memuru karar anında 409 duplicate_email alır (kasa değişmez).
    const dup = identity.requestCorrection(userId, { changes: { email: otherEmail }, reason: "E-posta adresimi güncellemek istiyorum." });
    expect(dup.status).toBe("pending");
    expect(s.ctx.db.get("SELECT 1 FROM audit_log WHERE action = 'identity.duplicate_attempt' AND actor_id = ?", userId)).toBeTruthy();
    identity.reviewCorrection(registrarId, dup.id, "Üyenin bilgi düzeltme talebi");
    await expectAppError(() => identity.decideCorrection(registrarId, dup.id, "approve"), 409, "duplicate_email");
    expect(identity.withdrawCorrection(userId, dup.id).status).toBe("withdrawn");

    const req = identity.requestCorrection(userId, { changes: { lastName: "Kaya" }, reason: "Soyadım mahkeme kararıyla değişti." });
    await expectAppError(() => identity.requestCorrection(userId, { changes: { lastName: "Arslan" }, reason: "İkinci bir talep açmaya çalışıyorum." }), 409, "correction_pending");
    // Başkası geri çekemez; sahibi geri çeker
    await expectAppError(() => identity.withdrawCorrection(s.memberId, req.id), 404, "not_found");
    const w = identity.withdrawCorrection(userId, req.id);
    expect(w.status).toBe("withdrawn");
    await expectAppError(() => identity.withdrawCorrection(userId, req.id), 409, "invalid_state");
    await expectAppError(() => identity.reviewCorrection(registrarId, "yok", "Üyenin bilgi düzeltme talebi"), 404, "not_found");
    // Geri çekildikten sonra yeni talep açılabilir
    expect(identity.requestCorrection(userId, { changes: { lastName: "Arslan" }, reason: "Soyadım mahkeme kararıyla değişti." }).status).toBe("pending");
  });

  it("yetki: sıradan üye listeleyemez/inceleyemez; denetçi inceler ama karar veremez; personel kendi talebine karar veremez", async () => {
    const s = setup();
    const { identity, registrarId, auditorId, memberId, adminId } = s;
    const userId = await verifiedMember(s);
    const req = identity.requestCorrection(userId, { changes: { phone: "0533 111 22 33" }, reason: "Telefon numaram değişti." });
    await expectAppError(() => identity.listCorrections(memberId), 403, "forbidden");
    await expectAppError(() => identity.reviewCorrection(memberId, req.id, "Merak ettim, bakıyorum"), 403, "forbidden");
    expect(identity.listCorrections(auditorId)).toHaveLength(1);
    identity.reviewCorrection(auditorId, req.id, "Denetim: erişim incelemesi");
    await expectAppError(() => identity.decideCorrection(auditorId, req.id, "approve"), 403, "forbidden");
    // Denetçinin incelemesi kayıt memurunun incelemesi yerine geçmez
    await expectAppError(() => identity.decideCorrection(registrarId, req.id, "approve"), 409, "review_required");
    expect(identity.listCorrections(registrarId, "all")).toHaveLength(1);
    expect(identity.listCorrections(registrarId, "approved")).toHaveLength(0);

    // Kayıt memuru (kasası olan) kendi talebine karar veremez; yönetici verebilir
    const { user: staff } = await identity.createByRegistrar(adminId, regInput());
    identity.setRoles(adminId, staff.id, ["member", "registrar"]);
    const own = identity.requestCorrection(staff.id, { changes: { phone: "0533 444 55 66" }, reason: "Telefon numaram değişti." });
    identity.reviewCorrection(staff.id, own.id, "Kendi talebim, deneme");
    await expectAppError(() => identity.decideCorrection(staff.id, own.id, "approve"), 403, "forbidden");
    identity.reviewCorrection(adminId, own.id, "Üyenin bilgi düzeltme talebi");
    expect(identity.decideCorrection(adminId, own.id, "approve").status).toBe("approved");
  });

  it("kripto-imha: bekleyen talep geri çekilmiş sayılır, şifreli öneri ve gerekçe silinir", async () => {
    const s = setup();
    const { identity, ctx, registrarId } = s;
    const userId = await verifiedMember(s);
    const req = identity.requestCorrection(userId, { changes: { lastName: "Kaya" }, reason: "Soyadım mahkeme kararıyla değişti." });
    await identity.eraseSelf(userId);
    const row = ctx.db.get<{ status: string; enc_payload: string | null; enc_reason: string | null }>(
      "SELECT status, enc_payload, enc_reason FROM identity_corrections WHERE id = ?",
      req.id,
    )!;
    expect(row).toEqual({ status: "withdrawn", enc_payload: null, enc_reason: null });
    await expectAppError(() => identity.reviewCorrection(registrarId, req.id, "Üyenin bilgi düzeltme talebi"), 409, "pii_erased");
    await expectAppError(() => identity.requestCorrection(userId, { changes: { lastName: "Kaya" }, reason: "Soyadım mahkeme kararıyla değişti." }), 409, "invalid_state");
  });

  it("şifreli öneri başka bir talebe taşınırsa çözülmez (AAD talep kimliğine bağlı)", async () => {
    const s = setup();
    const { identity, ctx, registrarId } = s;
    const userId = await verifiedMember(s);
    const a = identity.requestCorrection(userId, { changes: { lastName: "Kaya" }, reason: "Soyadım mahkeme kararıyla değişti." });
    identity.withdrawCorrection(userId, a.id);
    const b = identity.requestCorrection(userId, { changes: { phone: "0533 111 22 33" }, reason: "Telefon numaram değişti." });
    const reasonA = ctx.db.get<{ enc_reason: string }>("SELECT enc_reason FROM identity_corrections WHERE id = ?", a.id)!.enc_reason;
    ctx.db.run("UPDATE identity_corrections SET enc_reason = ? WHERE id = ?", reasonA, b.id);
    await expectAppError(() => identity.reviewCorrection(registrarId, b.id, "Üyenin bilgi düzeltme talebi"), 500, "vault_integrity");
  });
});
