// Bütünlük ve görünürlük testleri (ALGORITMA.md §12 madde 10 ve 11; mimari kural için MIMARI.md):
//  a) ProposalDetail.rightsFlags (yön + kaynak) ve canWriteMinorityReport (uygun seçmen, tur-1 etkin oyu "red", tek rapor);
//  b) kilit adım (lockstep) taraması kesin sayımda çalışır, KARARI DEĞİŞTİRMEZ, denetim uyarısı olarak görünür
//     (herkese yalnız sayılar; üyeler yalnız denetçi/yöneticiye; defterde iz yok);
//  i) forum YZ kayıtlarına yalnızca AiRecordSink arayüzüyle erişir (../ai iç yardımcıları içe aktarılmaz).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fy, verifyTally } from "@forum/shared";
import type { AuthUser } from "../../src/core/contracts";
import { INTEGRITY_LOCKSTEP_ACTION } from "../../src/forum";
import { FakeAiSink } from "../helpers/fakes";
import { CAT, endPhase, LONG_BODY, makeForum, toDeliberation, toVoting, type ForumHarness } from "./harness";

afterEach(() => vi.restoreAllMocks());

describe("forum: hak etkisi bayrakları ProposalDetail'de (yön ve kaynakla)", () => {
  it("üye 'genişletiyor', yazar 'kısıtlıyor' ekler; yönetici yalnız ilgili yönü kaldırır", async () => {
    const h = await makeForum();
    const m = h.users("uye", 8);
    const admin = h.user("yonetici", { roles: ["admin"] });
    const id = await toDeliberation(h, m[0], m.slice(1), { title: "Parka ortak bahçe", body: LONG_BODY, categories: [CAT.park] });
    const right = fy("MulkiyetHakki");
    expect(h.forum.proposals.get(id, null).rightsFlags).toEqual([]);

    await h.forum.proposals.flagRight(m[2], id, { right, direction: "expand" });
    const d = await h.forum.proposals.flagRight(m[0], id, { right, direction: "restrict" });
    expect(d.rightsFlags).toEqual([
      { right, direction: "expand", source: "member" },
      { right, direction: "restrict", source: "author" },
    ]);
    expect(d.audit?.rightsAffected).toContain(right);

    // Kaldırma yönü belirler: "genişletiyor" bayrağını kaldırmak "kısıtlıyor"u etkilemez.
    const after = await h.forum.proposals.flagRight(admin, id, { right, direction: "expand", remove: true });
    expect(after.rightsFlags).toEqual([{ right, direction: "restrict", source: "author" }]);
    // Görünüm herkese aynıdır (bayraklar kamusaldır; kişi bilgisi içermez).
    expect(h.forum.proposals.get(id, null).rightsFlags).toEqual(after.rightsFlags);
    await h.close();
  });
});

describe("forum: kilit adım bütünlük uyarıları ve azınlık raporu yetkisi", () => {
  let h: ForumHarness;
  let lock: AuthUser[];
  let others: AuthUser[];
  let auditor: AuthUser;
  let admin: AuthUser;
  let ids: string[];

  beforeAll(async () => {
    h = await makeForum();
    lock = h.users("kilit", 5);
    others = h.users("diger", 7);
    auditor = h.user("denetci", { roles: ["auditor"] });
    admin = h.user("yonetici", { roles: ["admin"] });
    ids = [];
    for (let i = 0; i < 4; i++) {
      ids.push(
        await toDeliberation(h, others[i], others.filter((_, j) => j !== i), {
          title: `Mahalle düzenlemesi ${i + 1}: oyun alanı`,
          body: `${LONG_BODY} (düzenleme ${i + 1})`,
        }),
      );
    }
    await toVoting(h, ids[0]);
    // Aynı anda (ManualClock: aynı milisaniye) aynı oyu veren ve geçmişte hep birlikte oy kullanan 5 kişilik grup.
    for (const id of ids) {
      for (const u of lock) await h.forum.proposals.vote(u, id, "yes");
      await h.forum.proposals.vote(others[4], id, "no");
      await h.forum.proposals.vote(others[5], id, "no");
    }
    await endPhase(h, ids[0]);
  });

  it("kesin sayımda grup bulunur; karar değişmez (bağımsız yeniden sayım tutar), defterde iz yok", () => {
    for (const id of ids) {
      const d = h.forum.proposals.get(id, null);
      expect(d.status).toBe("objection_window");
      expect(d.results).toHaveLength(1);
      expect(d.results[0].outcome).toBe("accept");
      const b = h.forum.proposals.bulletin(id).rounds[0];
      expect(verifyTally(b.tally, b.reveals, b.commitments).ok).toBe(true);
      expect(JSON.stringify(b.tally)).not.toMatch(/lockstep|integrity|kilit/i);
      expect(d.integrityWarnings).toHaveLength(1);
      expect(d.integrityWarnings[0]).toMatchObject({ kind: "lockstep", round: 1, groupSize: 5, members: null, detectedAt: h.ctx.clock.now() });
      expect(d.integrityWarnings[0].message).toMatch(/5 kişilik/);
      expect(d.integrityWarnings[0].message).toMatch(/karar DEĞİŞTİRİLMEDİ/);
      // Hangi seçeneğin oylandığı asla yazılmaz.
      expect(d.integrityWarnings[0].message).not.toMatch(/evet|kabul|yes/i);
    }
    // Defter: hiçbir kayıtta grup üyelerinin kimliği ya da kilit adım verisi yok.
    const all = JSON.stringify(h.fake!.txs.map((t) => t.payload));
    for (const u of lock) expect(all).not.toContain(u.id);
    expect(all).not.toMatch(/lockstep/i);
    // Denetim günlüğü: sistem (aktör yok) kaydı, hedef öneri.
    const rows = h.ctx.db.all<{ actor_id: string | null; target: string }>("SELECT actor_id, target FROM audit_log WHERE action = ?", INTEGRITY_LOCKSTEP_ACTION);
    expect(rows.map((r) => r.target).sort()).toEqual(ids.map((id) => `proposal:${id}`).sort());
    expect(rows.every((r) => r.actor_id === null)).toBe(true);
  });

  it("üye takma adları yalnız denetçi ve yöneticiye; sıradan üyeye ve oturumsuza yalnız sayı", () => {
    const want = lock.map((u) => u.nickname).sort();
    for (const viewer of [auditor, admin]) {
      const w = h.forum.proposals.get(ids[0], viewer).integrityWarnings[0];
      expect(w.members?.map((x) => x.nickname).sort()).toEqual(want);
      expect(w.members?.map((x) => x.userId).sort()).toEqual(lock.map((u) => u.id).sort());
    }
    for (const viewer of [null, others[0], lock[0]]) {
      const w = h.forum.proposals.get(ids[0], viewer).integrityWarnings[0];
      expect(w.members).toBeNull();
      expect(JSON.stringify(w)).not.toContain(lock[1].nickname);
    }
  });

  it("ProposalSummary.integrityWarningCount liste uçlarında görünür (yeni uç yok)", () => {
    const list = h.forum.proposals.list({ limit: 1000 }, null);
    for (const id of ids) expect(list.find((p) => p.id === id)?.integrityWarningCount).toBe(1);
    const fresh = list.filter((p) => !ids.includes(p.id));
    expect(fresh.every((p) => p.integrityWarningCount === 0)).toBe(true);
    expect(h.forum.proposals.get(ids[1], null).integrityWarningCount).toBe(1);
  });

  it("canWriteMinorityReport: yalnız tur-1 etkin oyu 'red' olan uygun seçmen, bir kez", () => {
    const id = ids[0];
    expect(h.forum.proposals.get(id, others[4]).canWriteMinorityReport).toBe(true);
    expect(h.forum.proposals.get(id, others[4]).canObject).toBe(true);
    expect(h.forum.proposals.get(id, lock[0]).canWriteMinorityReport).toBe(false); // "kabul" oyu
    expect(h.forum.proposals.get(id, others[6]).canWriteMinorityReport).toBe(false); // oy vermedi
    expect(h.forum.proposals.get(id, null).canWriteMinorityReport).toBe(false);
    // Rıza geri çekilirse yazamaz (sunucu da reddeder)
    h.ctx.db.run("UPDATE users SET political_consent = 0 WHERE id = ?", others[5].id);
    expect(h.forum.proposals.get(id, others[5]).canWriteMinorityReport).toBe(false);
    expect(() => h.forum.proposals.minorityReport(others[5], id, "x".repeat(60))).toThrow();
    h.ctx.db.run("UPDATE users SET political_consent = 1 WHERE id = ?", others[5].id);
    expect(h.forum.proposals.get(id, others[5]).canWriteMinorityReport).toBe(true);
    // Yazdıktan sonra ikinci rapor yok
    h.forum.proposals.minorityReport(others[4], id, "Oyun alanının konumu gürültü ve güvenlik açısından yeniden düşünülmeli; alternatif yer önerilmeli.");
    expect(h.forum.proposals.get(id, others[4]).canWriteMinorityReport).toBe(false);
    // Oylama evresinde (rapor evresi değil) kimse yazamaz
    expect(ids.every((x) => h.forum.proposals.get(x, others[5]).status === "objection_window")).toBe(true);
  });
});

describe("forum: kilit adım taraması hata verse de sayım sürer", () => {
  it("graph.lockstep istisnası günlüğe yazılır; geçiş ve sonuç aynen işlenir, uyarı yok", async () => {
    const h = await makeForum();
    const m = h.users("uye", 10);
    const id = await toDeliberation(h, m[0], m.slice(1), { title: "Sokak lambaları yenilensin", body: LONG_BODY });
    await toVoting(h, id);
    for (let i = 0; i < 8; i++) await h.forum.proposals.vote(m[i], id, i < 6 ? "yes" : "no");
    const spy = vi.spyOn(h.graph, "lockstep").mockImplementation(() => {
      throw new Error("graf kapalı");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await endPhase(h, id);
    expect(spy).toHaveBeenCalledWith(id);
    expect(err).toHaveBeenCalled();
    const d = h.forum.proposals.get(id, null);
    expect(d.results).toHaveLength(1);
    expect(d.status).toBe("objection_window");
    expect(d.integrityWarnings).toEqual([]);
    expect(d.integrityWarningCount).toBe(0);
    await h.close();
  });

  it("ara sayımda (needs_more_votes) tarama yapılmaz; yalnız kesin sayımda", async () => {
    const h = await makeForum();
    const m = h.users("uye", 20);
    const id = await toDeliberation(h, m[0], m.slice(1), { title: "Kütüphane saatleri uzasın", body: LONG_BODY });
    await toVoting(h, id);
    await h.forum.proposals.vote(m[0], id, "yes");
    const spy = vi.spyOn(h.graph, "lockstep");
    await endPhase(h, id); // katılım yetersiz → uzatma (ara sayım)
    expect(h.forum.proposals.get(id, null).extensionUsed).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    await endPhase(h, id); // kesin sayım
    expect(spy).toHaveBeenCalledTimes(1);
    await h.close();
  });
});

describe("forum: YZ kayıtlarına yalnızca AiRecordSink arayüzüyle erişir", () => {
  it("sahte depo enjekte edilince özet, liste ve onay tamamen arayüzden geçer (ai_analyses tablosuna dokunulmaz)", async () => {
    let sink: FakeAiSink | null = null;
    const h = await makeForum({
      aiSink: (ctx) => (sink = new FakeAiSink(ctx.clock)),
    });
    const m = h.users("uye", 6);
    const id = await toDeliberation(h, m[0], m.slice(1), { title: "Semt pazarına gölgelik", body: LONG_BODY });
    await h.forum.messages.post(m[1], "proposal", id, { body: "Gölgelik yaşlılar için çok faydalı olur, destekliyorum.", stance: "pro" });
    const a = await h.forum.proposals.aiSummary(m[1], id);
    expect(sink!.items.map((x) => x.id)).toEqual([a.id]);
    expect(sink!.items[0].promptVersion).toBe("fake/1"); // forum istem sürümünü kendisi vermez; depo belirler
    expect(h.forum.proposals.get(id, null).aiAnalyses.map((x) => x.id)).toEqual([a.id]);
    await expect(h.forum.proposals.approveAi(m[1], a.id)).rejects.toMatchObject({ status: 403 });
    expect((await h.forum.proposals.approveAi(m[0], a.id)).approvedBy).toBe(m[0].id);
    expect(sink!.get(a.id)?.approvedBy).toBe(m[0].id);
    await expect(h.forum.proposals.approveAi(m[0], "yok")).rejects.toMatchObject({ status: 404 });
    expect(h.ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM ai_analyses")!.c).toBe(0);
    await h.close();
  });

  it("forum kaynak dosyaları ../ai modülünü doğrudan içe aktarmaz (sözleşme sınırı)", () => {
    const dir = join(__dirname, "../../src/forum");
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /from\s+["']\.\.\/ai(\/[^"']*)?["']/.test(readFileSync(join(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
