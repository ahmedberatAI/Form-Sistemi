// Gerçek bileşim kökü (createApp) üzerinden uçtan uca HTTP senaryoları (fastify.inject; ağ portu açılmaz).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  fy,
  verifyInclusionProof,
  verifyTally,
  voteCommitment,
  type BallotReceipt,
  type BlockListResponse,
  type BulletinResponse,
  type CommittedTxView,
  type InclusionProof,
  type Me,
  type MessageView,
  type PendingUser,
  type PiiRecord,
  type ProposalDetail,
  type SystemInfo,
  type TickResponse,
  type TopicSummary,
  type ValidatorKeys,
} from "@forum/shared";
import { createApp } from "../../src/app";
import { HOUR } from "../../src/core/clock";
import { testConfig } from "../../src/core/config";
import { boot, registrationInput, type Harness } from "./harness";

const TIMEOUT = 120_000;

describe("HTTP entegrasyonu (createApp + fastify.inject)", () => {
  let h: Harness;
  let admin: { token: string; user: Me };
  let registrar: { token: string; user: Me };
  let auditor: { token: string; user: Me };

  beforeAll(async () => {
    h = await boot();
    admin = await h.staff("yonetici", ["admin"]);
    registrar = await h.staff("memur", ["registrar"]);
    auditor = await h.staff("denetci", ["auditor"]);
  }, TIMEOUT);
  afterAll(async () => {
    await h?.close();
    await h?.close(); // iki kez çağrılabilir
  });

  it("sağlık, sistem bilgisi, YZ kipi", async () => {
    expect(await h.ok("GET", "/api/health")).toEqual({ ok: true });
    const sys = await h.ok<SystemInfo>("GET", "/api/system");
    expect(sys.now).toBe(h.clock.now());
    expect(sys.ledger.validators).toBeGreaterThanOrEqual(4);
    expect(sys.aiMode).toBe("offline");
    expect(await h.ok("GET", "/api/ai/status")).toEqual({ mode: "offline", model: expect.any(String) });
  });

  it("kayıt → bekleyenler → PII görüntüleme (amaç zorunlu, kayıt altında) → onay → giriş", async () => {
    const reg = await h.register("ayse_k");
    expect(reg.user.status).toBe("pending");
    expect(reg.token.length).toBeGreaterThan(10);
    const input = registrationInput("x");
    expect(JSON.stringify(reg)).not.toContain(input.firstName);
    expect(JSON.stringify(reg)).not.toContain("ornek.org");

    // Doğrulama bekleyen üye oturum açabilir ama öneri oluşturamaz.
    expect((await h.ok<Me>("GET", "/api/me", { token: reg.token })).status).toBe("pending");
    const denied = await h.req("POST", "/api/proposals", { token: reg.token, body: { kind: "topic", title: "Deneme", body: "Metin", categories: [fy("YesilAlan")] } });
    expect(denied.statusCode).toBe(403);

    // Denetçi bekleyenleri görebilir (kayıt memurunun okuma ucu).
    const pending = await h.ok<PendingUser[]>("GET", "/api/registrar/pending", { token: auditor.token });
    expect(pending.map((p) => p.id)).toContain(reg.user.id);

    const noPurpose = await h.req("POST", `/api/registrar/users/${reg.user.id}/pii`, { token: registrar.token, body: {} });
    expect(noPurpose.statusCode).toBe(400);
    expect(noPurpose.json().error.code).toBe("validation");
    const memberTry = await h.req("POST", `/api/registrar/users/${reg.user.id}/pii`, { token: reg.token, body: { purpose: "Merak ettim" } });
    expect(memberTry.statusCode).toBe(403);

    const purpose = "Yüz yüze kimlik doğrulaması";
    const pii = await h.ok<PiiRecord>("POST", `/api/registrar/users/${reg.user.id}/pii`, { token: registrar.token, body: { purpose } });
    expect(pii.userId).toBe(reg.user.id);
    expect(pii.firstName).toBe("Deneme");
    expect(pii.tcknMasked).toMatch(/^\d{3}\*{6}\d{2}$/);
    const log = h.services.ctx.db.get<{ actor_id: string; purpose: string }>("SELECT actor_id, purpose FROM pii_access_log WHERE user_id = ?", reg.user.id);
    expect(log).toEqual({ actor_id: registrar.user.id, purpose });

    // Denetçi doğrulama yapamaz; kayıt memuru yapar.
    expect((await h.req("POST", `/api/registrar/users/${reg.user.id}/verify`, { token: auditor.token, body: { decision: "approve" } })).statusCode).toBe(403);
    const verified = await h.ok<Me>("POST", `/api/registrar/users/${reg.user.id}/verify`, { token: registrar.token, body: { decision: "approve" } });
    expect(verified.status).toBe("verified");

    const again = await h.login("ayse_k");
    expect((await h.ok<Me>("GET", "/api/me", { token: again.token })).status).toBe("verified");
    const wrong = await h.req("POST", "/api/auth/login", { body: { login: "ayse_k", password: "yanlis-sifre-1" } });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe("invalid_credentials");
  }, TIMEOUT);

  it("yetki matrisi örnekleri ve hata biçimi", async () => {
    const m = await h.member("uye_matris");
    expect((await h.req("GET", "/api/admin/users", { token: m.token })).statusCode).toBe(403);
    expect((await h.req("GET", "/api/me")).statusCode).toBe(401);
    expect((await h.req("POST", "/api/admin/clock/advance", { token: m.token, body: { hours: 1 } })).statusCode).toBe(403);
    const rows = await h.ok<{ id: string; nickname: string }[]>("GET", "/api/admin/users?q=uye_mat", { token: admin.token });
    expect(rows.map((r) => r.nickname)).toEqual(["uye_matris"]);
    expect(JSON.stringify(rows)).not.toMatch(/Deneme|ornek\.org|0555/);

    const bad = await h.req("POST", "/api/proposals", { token: m.token, body: { kind: "kanun", title: "", body: 3 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("validation");
    expect(Object.keys(bad.json().error.details).sort()).toEqual(["body", "kind", "title"]);

    const nf = await h.req("GET", "/api/yok/boyle-bir-sey");
    expect(nf.statusCode).toBe(404);
    expect(nf.json().error.code).toBe("not_found");
    expect((await h.req("GET", "/api/proposals/olmayan-oneri")).statusCode).toBe(404);
  }, TIMEOUT);

  it("ontoloji: genel bakış ve Turtle içerik türü", async () => {
    const ov = await h.ok<{ categories: unknown[]; params: unknown[]; version: { version: number } }>("GET", "/api/ontology");
    expect(ov.categories.length).toBeGreaterThan(0);
    expect(ov.params.length).toBeGreaterThan(0);
    const ttl = await h.req("GET", "/api/ontology/turtle");
    expect(ttl.statusCode).toBe(200);
    expect(ttl.headers["content-type"]).toBe("text/turtle; charset=utf-8");
    expect(ttl.body).toMatch(/@prefix/);
  });

  it("öneri tam akışı: oluştur+gönder → destek → tartışma → oy (makbuz) → bülten → bağımsız doğrulama → yürürlük", async () => {
    const author = await h.member("yazar");
    const voters = [];
    for (let i = 1; i <= 6; i++) voters.push(await h.member(`secmen${i}`));
    h.clock.advance(HOUR); // seçmenler öneriden önce doğrulanmış olmalı

    const title = "Mahalle parkına çocuk oyun alanı";
    const created = await h.ok<ProposalDetail>("POST", "/api/proposals", {
      token: author.token,
      body: {
        kind: "topic",
        title,
        body: "Parkın kuzey köşesine çocuklar için güvenli bir oyun alanı ve gölgelik yapılmasını öneriyorum. Zemin kauçuk kaplansın.",
        categories: [fy("YesilAlan")],
        submit: true,
      },
    });
    expect(created.status).toBe("sponsoring");
    expect(created.authorId).toBe(author.user.id);

    for (let i = 0; i < created.sponsorsRequired; i++) {
      await h.ok("POST", `/api/proposals/${created.id}/sponsor`, { token: voters[i].token });
    }
    await h.ok<TickResponse>("POST", "/api/admin/tick", { token: admin.token });
    let p = await h.ok<ProposalDetail>("GET", `/api/proposals/${created.id}`);
    expect(p.status).toBe("deliberation");
    expect(p.params).not.toBeNull();

    // Tartışma: kişisel veri içeren mesaj 422 (details.pii); temiz mesaj kabul edilir.
    const piiMsg = await h.req("POST", `/api/threads/proposal/${created.id}`, {
      token: voters[0].token,
      body: { body: "Bana 0532 123 45 67 numarasından ulaşabilirsiniz.", stance: "pro" },
    });
    expect(piiMsg.statusCode).toBe(422);
    expect(piiMsg.json().error.code).toBe("pii_detected");
    expect(piiMsg.json().error.details.pii.length).toBeGreaterThan(0);
    const msg = await h.ok<MessageView>("POST", `/api/threads/proposal/${created.id}`, { token: voters[0].token, body: { body: "Çok iyi bir fikir, destekliyorum.", stance: "pro" } });
    expect(msg.body).toBe("Çok iyi bir fikir, destekliyorum.");
    const thread = await h.ok<{ messages: MessageView[] }>("GET", `/api/threads/proposal/${created.id}`);
    expect(thread.messages.map((m) => m.id)).toContain(msg.id);

    const toVoting = await h.ok<TickResponse>("POST", "/api/admin/clock/advance", { token: admin.token, body: { hours: p.params!.durationsHours.deliberation } });
    expect(toVoting.now).toBe(h.clock.now());
    expect(toVoting.transitions).toContainEqual(expect.objectContaining({ proposalId: created.id, seq: created.seq, from: "deliberation", to: "voting" }));

    // Oylar: yazar + 6 seçmen (6 evet, 1 hayır) ve yönetici.
    const receipts: BallotReceipt[] = [];
    const choices = ["yes", "yes", "yes", "yes", "yes", "no"] as const;
    receipts.push(await h.ok<BallotReceipt>("POST", `/api/proposals/${created.id}/vote`, { token: author.token, body: { choice: "yes" } }));
    for (let i = 0; i < voters.length; i++) {
      receipts.push(await h.ok<BallotReceipt>("POST", `/api/proposals/${created.id}/vote`, { token: voters[i].token, body: { choice: choices[i] } }));
    }
    for (const r of receipts) expect(r.commitment).toBe(voteCommitment(created.id, r.round, r.ballotId, r.choice, r.salt));

    // Oylama sürerken sonuç yok, yalnız katılım.
    p = await h.ok<ProposalDetail>("GET", `/api/proposals/${created.id}`);
    expect(p.status).toBe("voting");
    expect(p.results).toEqual([]);
    expect(p.participation?.voted).toBe(receipts.length);
    expect((await h.ok<BulletinResponse>("GET", `/api/proposals/${created.id}/bulletin`)).rounds).toEqual([]);
    expect((await h.ok<BallotReceipt[]>("GET", `/api/proposals/${created.id}/receipts`, { token: author.token })).map((r) => r.ballotId)).toEqual([receipts[0].ballotId]);

    const closeVote = await h.ok<TickResponse>("POST", "/api/admin/clock/advance", { token: admin.token, body: { hours: p.params!.durationsHours.voting } });
    expect(closeVote.transitions).toContainEqual(expect.objectContaining({ proposalId: created.id, from: "voting", to: "objection_window" }));
    p = await h.ok<ProposalDetail>("GET", `/api/proposals/${created.id}`);
    expect(p.results).toHaveLength(1);
    expect(p.results[0].outcome).toBe("accept");

    // Bülten → istemci tarafı bağımsız yeniden sayım.
    await h.services.ledger.flush();
    const bulletin = await h.ok<BulletinResponse>("GET", `/api/proposals/${created.id}/bulletin`);
    expect(bulletin.rounds).toHaveLength(1);
    const round = bulletin.rounds[0];
    const check = verifyTally(round.tally, round.reveals, round.commitments);
    expect(check.mismatches).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.recomputed.outcome).toBe("accept");
    for (const r of receipts) expect(round.commitments[r.ballotId]).toBe(r.commitment);

    // Makbuz → dahil olma kanıtı (sabitlenmiş doğrulayıcı anahtarlarıyla) + defterdeki taahhüt eşleşmesi.
    const keys = await h.ok<ValidatorKeys>("GET", "/api/ledger/validators");
    expect(keys.chainId).toBe("forum-sistemi-1");
    const receipt = receipts[1];
    expect(receipt.txHash).toBeTruthy();
    const proof = await h.ok<InclusionProof>("GET", `/api/ledger/proofs/${receipt.txHash}`);
    expect(verifyInclusionProof(proof, keys.validators)).toEqual({ ok: true, reasons: [] });
    const tx = await h.ok<CommittedTxView>("GET", `/api/ledger/txs/${receipt.txHash}`);
    expect(tx.type).toBe("VOTE_COMMIT");
    expect(JSON.stringify(tx.payload)).toContain(receipt.commitment);
    expect(JSON.stringify(tx.payload)).not.toContain(author.user.id);

    const blocks = await h.ok<BlockListResponse>("GET", "/api/ledger/blocks?limit=5");
    expect(blocks.blocks.length).toBeGreaterThan(0);
    expect(blocks.blocks[0]).toHaveProperty("txTypes");
    expect(blocks.blocks[0]).not.toHaveProperty("txs");

    const enact = await h.ok<TickResponse>("POST", "/api/admin/clock/advance", { token: admin.token, body: { hours: p.params!.durationsHours.objection } });
    expect(enact.transitions).toContainEqual(expect.objectContaining({ proposalId: created.id, from: "objection_window", to: "enacted" }));
    const topics = await h.ok<TopicSummary[]>("GET", "/api/topics");
    expect(topics.map((t) => t.title)).toContain(title);
  }, TIMEOUT);

  it('POST /api/me/erase: "SİL" olmadan 400; doğru onay + şifreyle kripto-imha, oturum düşer', async () => {
    const m = await h.member("silinecek");
    const r = await h.req("POST", "/api/me/erase", { token: m.token, body: { confirm: "evet", password: "Guvenli-Sifre-2026" } });
    expect(r.statusCode).toBe(400);
    const wrong = await h.req("POST", "/api/me/erase", { token: m.token, body: { confirm: "SİL", password: "baska-sifre-1" } });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe("wrong_password");
    expect(await h.ok("POST", "/api/me/erase", { token: m.token, body: { confirm: "SİL", password: "Guvenli-Sifre-2026" } })).toEqual({ ok: true });
    expect((await h.req("GET", "/api/me", { token: m.token })).statusCode).toBe(401);
  }, TIMEOUT);
});

describe("createApp yan senaryoları", () => {
  it("SPA geri dönüşü (webDist): /oneriler/123 → index.html, /api/yok → JSON 404", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forum-dist-"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>Forum Sistemi</title>");
    const h = await boot({ webDist: dir });
    try {
      const spa = await h.req("GET", "/oneriler/123");
      expect(spa.statusCode).toBe(200);
      expect(spa.headers["content-type"]).toMatch(/text\/html/);
      expect(spa.body).toContain("Forum Sistemi");
      const api = await h.req("GET", "/api/yok");
      expect(api.statusCode).toBe(404);
      expect(api.json().error.code).toBe("not_found");
    } finally {
      await h.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, TIMEOUT);

  it("hız sınırı: /api/auth/* aşımında 429 rate_limited", async () => {
    const h = await boot({}, { rateLimit: { global: 300, auth: 2 } });
    try {
      for (let i = 0; i < 2; i++) expect((await h.req("POST", "/api/auth/login", { body: { login: "yok", password: "x" } })).statusCode).toBe(401);
      const r = await h.req("POST", "/api/auth/login", { body: { login: "yok", password: "x" } });
      expect(r.statusCode).toBe(429);
      expect(r.json().error.code).toBe("rate_limited");
    } finally {
      await h.close();
    }
  }, TIMEOUT);

  it("CORS: http://localhost ve capacitor://localhost kökenlerine izin verilir", async () => {
    const h = await boot({ corsOrigins: ["http://localhost", "capacitor://localhost", "https://localhost", "http://localhost:5173"] });
    try {
      for (const origin of ["http://localhost", "capacitor://localhost"]) {
        const r = await h.req("GET", "/api/health", { headers: { origin } });
        expect(r.headers["access-control-allow-origin"]).toBe(origin);
      }
    } finally {
      await h.close();
    }
  }, TIMEOUT);

  it("simüle saat meta tablosunda saklanır ve yeniden başlatmada sürdürülür", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forum-clock-"));
    const cfg = testConfig({ dataDir: dir, dbPath: join(dir, "forum.db"), ledgerBlockIntervalMs: 5, timeScale: 1 });
    try {
      const first = await createApp(cfg, { startTimers: false, aiClient: null, rateLimit: false });
      first.services.clock.advance(5 * HOUR);
      const before = first.services.clock.now();
      await first.close();
      await first.close();
      const second = await createApp(cfg, { startTimers: false, aiClient: null, rateLimit: false });
      try {
        expect(second.services.clock.offset()).toBe(5 * HOUR);
        expect(second.services.clock.now()).toBeGreaterThanOrEqual(before);
        expect(second.services.clock.now() - before).toBeLessThan(60_000);
      } finally {
        await second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, TIMEOUT);
});
