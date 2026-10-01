// Forum entegrasyon testleri için bileşim: GERÇEK wave-1 modülleri (ontoloji, graf, yönetişim, kimlik, YZ (çevrimdışı),
// bilirkişi) + gerçek ya da sahte defter. Saat ManualClock; faz geçişleri lifecycle.tick() ile.
import { fy, type Role } from "@forum/shared";
import { createAiRecordSink, createAiService } from "../../src/ai";
import { createAuditLogger, type AuditLogger } from "../../src/core/audit";
import { HOUR } from "../../src/core/clock";
import type { AiService, AuthUser, ExpertService, GovernanceMath, GraphService, IdentityService, LedgerService, OntologyService } from "../../src/core/contracts";
import type { ForumServices, Transition } from "../../src/core/forum-contracts";
import { DbNotifier } from "../../src/core/notifier";
import { createExpertService } from "../../src/experts";
import { createForumServices } from "../../src/forum";
import { createGovernanceMath } from "../../src/governance";
import { createGraphService } from "../../src/graph";
import { createIdentityService } from "../../src/identity";
import { createLedgerService } from "../../src/ledger";
import { createOntologyService } from "../../src/ontology";
import { FakeLedger, insertUser, makeCtx, type TestCtx } from "../helpers/fakes";

export const CAT = {
  park: fy("YesilAlan"),
  cevre: fy("Cevre"),
  ulasim: fy("TopluTasima"),
  enerji: fy("Enerji"),
  yonetmelik: fy("ForumYonetmeligi"),
  spor: fy("Spor"),
};

export interface ForumHarness {
  ctx: TestCtx;
  ledger: LedgerService;
  fake: FakeLedger | null;
  ontology: OntologyService;
  graph: GraphService;
  math: GovernanceMath;
  identity: IdentityService;
  ai: AiService;
  experts: ExpertService;
  notifier: DbNotifier;
  audit: AuditLogger;
  forum: ForumServices;
  /** Doğrudan users satırı + AuthUser */
  user(nickname: string, o?: { roles?: Role[]; aiConsent?: boolean; politicalConsent?: boolean; isAdult?: boolean; status?: "verified" | "pending" | "suspended"; verifiedAt?: number | null }): AuthUser;
  users(prefix: string, n: number): AuthUser[];
  /** Saati ilerletir, defteri boşaltır ve tick çalıştırır. */
  advance(hours: number): Promise<Transition[]>;
  tick(): Promise<Transition[]>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export async function makeForum(opts: { realLedger?: boolean } = {}): Promise<ForumHarness> {
  const ctx = makeCtx();
  const notifier = new DbNotifier(ctx);
  const audit = createAuditLogger(ctx);
  const fake = opts.realLedger ? null : new FakeLedger(ctx.clock);
  const ledger: LedgerService = fake ?? createLedgerService(ctx, { persist: false, blockIntervalMs: 5 });
  await ledger.start();
  const ontology = createOntologyService(ctx);
  await ontology.init();
  const graph = createGraphService(ctx, { ledger });
  const math = createGovernanceMath();
  const identity = createIdentityService(ctx, { ledger, notifier, audit });
  const ai = createAiService(ctx, { client: null });
  const aiSink = createAiRecordSink(ctx, { ledger });
  const experts = createExpertService(ctx, { ledger, graph, math, ai, notifier, audit, ontology, householdOf: (u) => identity.householdOf(u) });
  const forum = createForumServices({ ctx, ledger, ontology, graph, math, identity, ai, aiSink, experts, notifier, audit });

  let n = 0;
  const user: ForumHarness["user"] = (nickname, o = {}) => {
    n++;
    const id = insertUser(ctx.db, {
      nickname,
      roles: o.roles,
      status: o.status ?? "verified",
      aiConsent: o.aiConsent,
      politicalConsent: o.politicalConsent,
      isAdult: o.isAdult,
      verifiedAt: o.verifiedAt,
      createdAt: Date.UTC(2026, 0, 1) + n * 1000,
    });
    return {
      id,
      nickname,
      roles: Array.from(new Set<Role>(["member", ...(o.roles ?? [])])),
      status: o.status ?? "verified",
      isAdult: o.isAdult !== false,
      politicalConsent: o.politicalConsent !== false,
      aiConsent: !!o.aiConsent,
    };
  };
  const flush = async () => {
    if (!fake) await ledger.flush(5000);
  };
  const tick = async () => {
    await flush();
    const t = await forum.lifecycle.tick();
    await flush();
    return t;
  };
  return {
    ctx,
    ledger,
    fake,
    ontology,
    graph,
    math,
    identity,
    ai,
    experts,
    notifier,
    audit,
    forum,
    user,
    users: (prefix, count) => Array.from({ length: count }, (_, i) => user(`${prefix}${String(i + 1).padStart(2, "0")}`)),
    async advance(hours) {
      ctx.clock.advance(hours * HOUR);
      return tick();
    },
    tick,
    flush,
    async close() {
      forum.lifecycle.stop();
      await ledger.stop();
    },
  };
}

export const LONG_BODY = "Bu öneri mahallemizin ortak yaşam alanlarını iyileştirmek için hazırlanmıştır ve ayrıntıları aşağıdadır.";

/** Öneri oluştur + gönder + K_s destek → deliberation. */
export async function toDeliberation(
  h: ForumHarness,
  author: AuthUser,
  sponsors: AuthUser[],
  input: Partial<Parameters<ForumServices["proposals"]["create"]>[1]> = {},
): Promise<string> {
  const d = await h.forum.proposals.create(author, {
    kind: "topic",
    title: "Parka gölgelik ve bank",
    body: LONG_BODY,
    categories: [CAT.park],
    submit: true,
    ...input,
  });
  const need = d.sponsorsRequired;
  for (const s of sponsors.slice(0, need)) await h.forum.proposals.sponsor(s, d.id);
  await h.flush();
  return d.id;
}

/** Tartışma süresini atlayıp oylamayı açar. */
export async function toVoting(h: ForumHarness, id: string): Promise<void> {
  const p = h.forum.proposals.get(id, null);
  if (p.status !== "deliberation") throw new Error(`deliberation bekleniyordu: ${p.status}`);
  await h.advance(Math.ceil((p.phaseEndsAt! - h.ctx.clock.now()) / HOUR) + 1);
}

/** Önerinin güncel evresinin süresini bitirir (ör. oylama kapanışı, uzlaşma sonu). */
export async function endPhase(h: ForumHarness, id: string): Promise<Transition[]> {
  const p = h.forum.proposals.get(id, null);
  if (p.phaseEndsAt === null) throw new Error(`evre sonu yok: ${p.status}`);
  return h.advance(Math.max(1, Math.ceil((p.phaseEndsAt - h.ctx.clock.now()) / HOUR) + 1));
}
export const closeVoting = endPhase;

export interface Blocks {
  A: AuthUser[];
  B: AuthUser[];
  C: AuthUser[];
  all: AuthUser[];
}

/** 3 görüş bloğu (60/30/10'a yakın: 15/9/6) — kümelenme için. */
export function makeBlocks(h: ForumHarness): Blocks {
  const A = h.users("a", 15);
  const B = h.users("b", 9);
  const C = h.users("c", 6);
  return { A, B, C, all: [...A, ...B, ...C] };
}

/**
 * Kapanmış oy geçmişi üretir: n öneri; A hep "evet", B ilk yarıda evet/ikinci yarıda hayır, C tersi.
 * Böylece PCA + k-means üç belirgin küme bulur (A büyük, B orta, C küçük).
 */
export async function seedHistory(h: ForumHarness, b: Blocks, n = 10): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const author = b.A[i % b.A.length];
    const sponsors = b.all.filter((u) => u.id !== author.id).slice(i, i + 5);
    ids.push(await toDeliberation(h, author, sponsors, { title: `Geçmiş karar ${i + 1}: mahalle düzenlemesi`, body: `${LONG_BODY} (geçmiş ${i + 1})` }));
  }
  await toVoting(h, ids[0]);
  for (let i = 0; i < n; i++) {
    const first = i < n / 2;
    for (const u of b.A) await h.forum.proposals.vote(u, ids[i], "yes");
    for (const u of b.B) await h.forum.proposals.vote(u, ids[i], first ? "yes" : "no");
    for (const u of b.C) await h.forum.proposals.vote(u, ids[i], first ? "no" : "yes");
  }
  await closeVoting(h, ids[0]);
  await h.advance(49);
  for (const id of ids) {
    const s = h.forum.proposals.get(id, null).status;
    if (s !== "enacted" && s !== "rejected") throw new Error(`geçmiş öneri kapanmadı: ${s}`);
  }
  return ids;
}

/** Test kolaylığı: yürürlükte bir konuyu doğrudan ekler (normalde yalnız kabul edilen öneriyle oluşur). */
export function insertTopic(h: ForumHarness, title: string, categories: string[] = [CAT.park], parentId: string | null = null): string {
  const id = `topic-${h.ctx.db.nextSeq("topics")}`;
  const now = h.ctx.clock.now();
  const seq = h.ctx.db.nextSeq("topics");
  const body = `${title} hakkında yürürlükteki konu metni.`;
  h.ctx.db.run(
    "INSERT INTO topics(id, seq, parent_id, title, body, categories, current_version, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)",
    id,
    seq,
    parentId,
    title,
    body,
    JSON.stringify(categories),
    now,
    now,
  );
  h.ctx.db.run("INSERT INTO topic_revisions(topic_id, version, title, body, content_hash, created_at) VALUES (?, 1, ?, ?, 'x', ?)", id, title, body, now);
  return id;
}
