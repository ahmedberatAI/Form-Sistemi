// Yaşam döngüsü (ALGORITMA.md §3): faz geçişlerinin TEK otoritesi. Sıralı kuyruk (yeniden giriş yok), her öneri kendi
// try/catch'inde. Tüm süreler ctx.clock ile ve gerçek saat değerleriyle (hours · HOUR) hesaplanır.
import {
  PROPOSAL_STATUS_LABELS,
  sponsorsRequired,
  type AuditReport,
  type BylawVersionInfo,
  type ProposalStatus,
} from "@forum/shared";
import { DAY } from "../core/clock";
import type { ProposalAuditInput } from "../core/contracts";
import { AppError } from "../core/errors";
import type { LifecycleEngine, MessageService, TopicService, Transition } from "../core/forum-contracts";
import { newId } from "../core/ids";
import { json, type SqlValue } from "../db";
import type { ClusterServiceImpl } from "./clusters";
import { computeRound, deletionTargetAuthor, evaluateObjections } from "./tally";
import {
  ACTIVE_SQL,
  durationsOf,
  groundIsSealed,
  hoursToMs,
  isActive,
  parseProposal,
  proposalLink,
  proposalRef,
  safe,
  textHash,
  type ForumCore,
  type ProposalRow,
  type RightsFlag,
} from "./util";

/** Öneri durumu bu arada (başka bir işlemle) değişti; adım sessizce bırakılır, sonraki tick yeniden değerlendirir. */
export class StaleState extends Error {
  constructor() {
    super("Öneri durumu eşzamanlı olarak değişti.");
  }
}

export interface TransitionOpts {
  now: number;
  endsAt: number | null;
  set?: Record<string, SqlValue>;
  /** Aynı evrede uzatma (deliberation→deliberation, voting→voting): evre başlangıcı korunur. */
  keepStart?: boolean;
}

/**
 * Tek bir faz geçişi (çağıran işlemin İÇİNDE çalışır): proposals güncellemesi (durum + sürüm koşullu),
 * phase_events satırı ve PHASE_CHANGED defter kaydı {proposalId, from, to, textHash, at, reason}.
 */
export function applyTransition(core: ForumCore, p: ProposalRow, to: ProposalStatus, reason: string, o: TransitionOpts): Transition {
  const set: Record<string, SqlValue> = { ...(o.set ?? {}), status: to, phase_ends_at: o.endsAt, updated_at: o.now };
  if (!o.keepStart) set.phase_started_at = o.now;
  const keys = Object.keys(set);
  const r = core.db.run(
    `UPDATE proposals SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND status = ? AND version = ?`,
    ...keys.map((k) => set[k]),
    p.id,
    p.status,
    p.version,
  );
  if (r.changes !== 1) throw new StaleState();
  const tx = core.submit("PHASE_CHANGED", { proposalId: p.id, from: p.status, to, textHash: textHash(p.title, p.body), at: o.now, reason });
  core.db.run(
    "INSERT INTO phase_events(id, proposal_id, from_status, to_status, reason, at, ledger_tx) VALUES (?, ?, ?, ?, ?, ?, ?)",
    newId(),
    p.id,
    p.status,
    to,
    reason,
    o.now,
    tx,
  );
  return { proposalId: p.id, seq: Number(p.seq), from: p.status, to, reason };
}

/** Önerinin güncel hâline göre ontoloji denetim girdisi. */
export function auditInputFor(
  core: ForumCore,
  p: ProposalRow,
  over: { title?: string; body?: string; rightsFlags?: RightsFlag[]; contentLabels?: ProposalAuditInput["contentLabels"] } = {},
): ProposalAuditInput {
  const parsed = parseProposal(p);
  let parentTopic: ProposalAuditInput["parentTopic"] = null;
  let amendment: ProposalAuditInput["amendment"] = null;
  if ((p.kind === "subtopic" || p.kind === "amendment") && p.parent_topic_id) {
    const t = core.db.get<{ id: string; categories: string; status: string; current_version: number }>(
      "SELECT id, categories, status, current_version FROM topics WHERE id = ?",
      p.parent_topic_id,
    );
    if (t) parentTopic = { id: t.id, categories: json<string[]>(t.categories, []), status: t.status };
    if (p.kind === "amendment") amendment = { baseVersion: parsed.amendment?.baseVersion ?? 0, currentVersion: Number(t?.current_version ?? 0) };
  }
  return {
    id: p.id,
    kind: p.kind,
    title: over.title ?? p.title,
    body: over.body ?? p.body,
    categories: parsed.categories,
    rightsAffected: over.rightsFlags ?? parsed.rightsFlags,
    contentLabels: over.contentLabels ?? parsed.contentLabels,
    parentTopic,
    amendment,
    deletion: p.kind === "deletion" && parsed.deletion ? { ground: parsed.deletion.ground, messageCount: parsed.deletion.messageIds.length } : null,
    regulationPatch: parsed.patch,
    requestExpert: p.request_expert === 1,
    verifiedMembers: core.verifiedCount(),
  };
}

export function findingsSummary(report: AuditReport, max = 3): string {
  const v = report.violations.slice(0, max).map((f) => (f.articleLabel ? `${f.message} (${f.articleLabel})` : f.message));
  if (v.length === 0) return "Denetim bulguları için ayrıntılara bakın.";
  return v.join("; ") + (report.violations.length > max ? ` (+${report.violations.length - max} bulgu)` : "");
}

export interface LifecycleParts {
  clusters: ClusterServiceImpl;
  topics: TopicService;
  messages: MessageService;
}

interface EnactPrep {
  bylaw?: BylawVersionInfo;
  error?: string;
}

export function createLifecycle(core: ForumCore, parts: LifecycleParts): LifecycleEngine {
  const { db, deps } = core;
  const { clusters, topics, messages } = parts;
  let chain: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | null = null;
  let timerBusy = false;
  let lastDaily: number | null = null;

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  }

  // ───────────── Yardımcılar ─────────────

  /** İşlem içinde güncel satırı okur ve adımın dayandığı durumun değişmediğini doğrular. */
  function fresh(p: ProposalRow, opts: { version?: boolean } = {}): ProposalRow {
    const cur = core.proposalRow(p.id);
    if (!cur || cur.status !== p.status || cur.voting_round !== p.voting_round || cur.phase_ends_at !== p.phase_ends_at) throw new StaleState();
    if (opts.version && cur.version !== p.version) throw new StaleState();
    return cur;
  }

  function sponsorIds(id: string): string[] {
    return db.all<{ user_id: string }>("SELECT user_id FROM proposal_sponsors WHERE proposal_id = ?", id).map((r) => r.user_id);
  }

  function eligibleIds(id: string): string[] {
    return db.all<{ user_id: string }>("SELECT user_id FROM eligible_voters WHERE proposal_id = ?", id).map((r) => r.user_id);
  }

  function notifyPhase(p: ProposalRow, to: ProposalStatus, reason: string, extra: Iterable<string> = []): void {
    core.notify([p.author_id, ...sponsorIds(p.id), ...extra], {
      kind: "proposal_phase",
      title: `${proposalRef(p)} ${PROPOSAL_STATUS_LABELS[to]}`,
      body: `“${p.title}” — ${reason}`,
      link: proposalLink(p.id),
    });
  }

  function uncollapseIfDeletion(p: ProposalRow): void {
    if (p.kind !== "deletion") return;
    const d = parseProposal(p).deletion;
    if (d) messages.uncollapse(d.messageIds, p.id);
  }

  function close(p: ProposalRow, to: "rejected" | "inadmissible" | "expired", reason: string, now: number, set: Record<string, SqlValue> = {}): Transition {
    const t = applyTransition(core, p, to, reason, { now, endsAt: null, set: { ...set, final_reason: reason } });
    uncollapseIfDeletion(p);
    return t;
  }

  function needsExpert(p: ProposalRow): boolean {
    const parsed = parseProposal(p);
    return !!(parsed.fixedParams ?? parsed.audit?.params)?.requiresExpert || p.request_expert === 1;
  }

  function counterRequested(p: ProposalRow): boolean {
    const r = db.get<{ c: number; a: number | null }>(
      "SELECT COUNT(*) AS c, MAX(user_id = ?) AS a FROM expert_requests WHERE proposal_id = ? AND kind = 'counter'",
      p.author_id,
      p.id,
    );
    return Number(r?.c ?? 0) >= 3 || Number(r?.a ?? 0) === 1;
  }

  // ───────────── Bilirkişi kurası (tohum ÖNCEDEN taahhüt edilen bloktan) ─────────────

  async function maybeDrawPanel(p: ProposalRow, now: number): Promise<void> {
    if (p.phase_ends_at === null || now >= p.phase_ends_at) return;
    const panel = safe(() => deps.experts.panel(p.id), null);
    let needed = false;
    let counter = false;
    if (p.status === "deliberation") {
      needed = needsExpert(p) && !panel;
    } else if (p.status === "reconciliation") {
      const drawnThisPhase = !!panel && panel.createdAt >= Number(p.phase_started_at ?? 0);
      counter = counterRequested(p);
      const redraw = needsExpert(p) && (!panel || (panel.reports.length === 0 && !panel.noExpertAvailable));
      needed = (counter || redraw) && !drawnThisPhase;
    }
    if (!needed) return;
    const latest = deps.ledger.latestBlock();
    if (p.expert_draw_height === null) {
      // Taahhüt: tohum, henüz üretilmemiş bir sonraki bloğun hash'i olacak (öğütmeye karşı).
      core.tx(() => db.run("UPDATE proposals SET expert_draw_height = ? WHERE id = ? AND expert_draw_height IS NULL", latest.height + 1, p.id));
      return;
    }
    if (latest.height < p.expert_draw_height) return;
    const block = deps.ledger.getBlock(p.expert_draw_height);
    if (!block) return;
    const parsed = parseProposal(p);
    try {
      const info = await deps.experts.drawPanel(p.id, {
        categories: parsed.categories,
        authorId: p.author_id,
        k: (parsed.fixedParams ?? parsed.audit?.params)?.expertCount ?? 3,
        dueAt: p.phase_ends_at,
        counter,
        seedBlock: { height: block.height, hash: block.hash },
      });
      core.notify([p.author_id], {
        kind: "expert_panel",
        title: `${proposalRef(p)} için ${counter ? "karşı " : ""}bilirkişi paneli çekildi`,
        body: info.noExpertAvailable
          ? "Uygun bilirkişi bulunamadı; süreç raporsuz devam edecek."
          : `${info.assignments.length} bilirkişi davet edildi. Sorularınızı öneri sayfasından iletebilirsiniz.`,
        link: proposalLink(p.id),
      });
    } catch (e) {
      if (e instanceof AppError && e.code === "seed_block_pending") return;
      throw e;
    }
  }

  // ───────────── Yürürlük ─────────────

  /** Eşzamansız yürürlük hazırlığı (yalnız yönetmelik yaması). Aynı öneri için tekrar uygulanmaz (idempotent). */
  async function prepareEnactment(p: ProposalRow): Promise<EnactPrep> {
    if (p.kind !== "regulation") return {};
    const patch = parseProposal(p).patch;
    if (!patch) return { error: "Yönetmelik yaması bulunamadı." };
    const existing = safe(() => deps.ontology.versions(), []).find((v) => v.viaProposalId === p.id);
    if (existing) return { bylaw: existing };
    try {
      return { bylaw: await deps.ontology.applyPatch(patch, p.id) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Yürürlük etkileri + enacted (ya da sürüm çakışması / yama hatasında rejected). Çağıranın işlemi içinde. */
  function enact(p: ProposalRow, prep: EnactPrep, reason: string, now: number): Transition {
    const parsed = parseProposal(p);
    switch (p.kind) {
      case "topic":
      case "subtopic": {
        const r = topics.createFromProposal(p.id);
        return applyTransition(core, p, "enacted", reason, { now, endsAt: null, set: { enacted_entity_id: r.topicId, final_reason: reason } });
      }
      case "amendment": {
        const r = topics.reviseFromProposal(p.id);
        if ("conflict" in r) {
          const why = `Sürüm çakışması: konu bu arada güncellendi (güncel sürüm ${r.currentVersion}, teklifin dayandığı sürüm ${parsed.amendment?.baseVersion ?? "?"}); düzenleme uygulanamadı.`;
          return close(p, "rejected", why, now);
        }
        return applyTransition(core, p, "enacted", reason, { now, endsAt: null, set: { enacted_entity_id: r.topicId, final_reason: reason } });
      }
      case "deletion": {
        const d = parsed.deletion;
        if (d) messages.hide(d.messageIds, p.id, d.ground, groundIsSealed(d.ground));
        return applyTransition(core, p, "enacted", reason, { now, endsAt: null, set: { final_reason: reason } });
      }
      case "regulation": {
        if (!prep.bylaw) return close(p, "rejected", `Yönetmelik yaması uygulanamadı: ${prep.error ?? "bilinmeyen hata"}`, now);
        const v = prep.bylaw;
        const tx = core.submit("BYLAW_VERSION", { version: v.version, hash: v.hash, proposalId: p.id });
        db.run("UPDATE bylaw_versions SET ledger_tx = ? WHERE version = ? AND ledger_tx IS NULL", tx, v.version);
        return applyTransition(core, p, "enacted", reason, { now, endsAt: null, set: { enacted_entity_id: String(v.version), final_reason: reason } });
      }
    }
  }

  // ───────────── Evreler ─────────────

  async function stepSponsoring(p: ProposalRow, now: number): Promise<Transition[]> {
    const count = sponsorIds(p.id).length;
    const parsed = parseProposal(p);
    const need = parsed.audit?.params?.sponsorsRequired ?? null;
    const required = need && need > 0 ? need : sponsorsRequired(core.verifiedCount(), p.kind === "deletion" ? "DEL" : p.tier);
    if (count >= required) {
      const report = await deps.ontology.audit(auditInputFor(core, p));
      return core.tx(() => {
        const cur = fresh(p, { version: true });
        if (!report.admissible || !report.params || report.tier === "T3") {
          const reason = `Ontoloji denetimi: yönetmeliğe aykırı — ${findingsSummary(report)}`;
          const t = close(cur, "inadmissible", reason, now, { audit_report: JSON.stringify(report), tier: report.tier });
          notifyPhase(cur, "inadmissible", reason);
          return [t];
        }
        const durations = report.params.durationsHours;
        const expert = report.params.requiresExpert || cur.request_expert === 1;
        const reason = `Gerekli destekçi sayısına ulaşıldı (${count}/${required}); ontoloji denetimi geçti, tartışma başladı.`;
        const t = applyTransition(core, cur, "deliberation", reason, {
          now,
          endsAt: now + hoursToMs(durations.deliberation),
          set: {
            audit_report: JSON.stringify(report),
            tier: report.tier,
            // Tohum taahhüdü: PHASE_CHANGED ile birlikte bir sonraki blok kesin oluşur; hash'i şu an bilinemez.
            expert_draw_height: expert ? deps.ledger.latestBlock().height + 1 : null,
          },
        });
        notifyPhase(cur, "deliberation", reason);
        if (cur.kind === "deletion") {
          const target = deletionTargetAuthor(core, cur);
          if (target) {
            core.notify([target], {
              kind: "deletion_request",
              title: "Mesajınız için silme talebi tartışmada",
              body: `${proposalRef(cur)} mesajınızın gizlenmesini istiyor. Tartışma süresinde mesajınızı düzenleyebilir ya da tartışmaya katılabilirsiniz.`,
              link: proposalLink(cur.id),
            });
          }
        }
        return [t];
      });
    }
    if (p.phase_ends_at !== null && now >= p.phase_ends_at) {
      return core.tx(() => {
        const cur = fresh(p);
        const reason = `Destekçi toplama süresi doldu (${count}/${required} destekçi).`;
        const t = close(cur, "expired", reason, now);
        notifyPhase(cur, "expired", reason);
        return [t];
      });
    }
    return [];
  }

  async function stepDeliberation(p: ProposalRow, now: number): Promise<Transition[]> {
    await maybeDrawPanel(p, now);
    if (p.phase_ends_at === null || now < p.phase_ends_at) return [];
    if (!p.expert_extension_used && safe(() => deps.experts.suspensiveFlag(p.id), false)) {
      return core.tx(() => {
        const cur = fresh(p);
        const ext = durationsOf(cur).extension;
        const reason = "Bilirkişi askı kuralı: raporların en az 2/3'ü 'uygulanamaz' (güven medyanı ≥ 0,8); tartışma bir kez uzatıldı.";
        const t = applyTransition(core, cur, "deliberation", reason, {
          now,
          endsAt: Math.max(Number(cur.phase_ends_at), now) + hoursToMs(ext),
          keepStart: true,
          set: { expert_extension_used: 1 },
        });
        notifyPhase(cur, "deliberation", reason);
        return [t];
      });
    }
    return openVoting(p, now);
  }

  async function openVoting(p: ProposalRow, now: number): Promise<Transition[]> {
    const report = await deps.ontology.audit(auditInputFor(core, p));
    if (!report.admissible || !report.params || report.tier === "T3") {
      return core.tx(() => {
        const cur = fresh(p, { version: true });
        const reason = `Oylama öncesi son denetimde yönetmeliğe aykırılık bulundu — ${findingsSummary(report)}`;
        const t = close(cur, "inadmissible", reason, now, { audit_report: JSON.stringify(report), tier: report.tier });
        notifyPhase(cur, "inadmissible", reason);
        return [t];
      });
    }
    const params = report.params;
    const snap = await clusters.snapshot(`oylama ${proposalRef(p)}`);
    return core.tx(() => {
      const cur = fresh(p, { version: true });
      const excluded = cur.kind === "deletion" ? deletionTargetAuthor(core, cur) : null;
      db.run(
        `INSERT OR IGNORE INTO eligible_voters(proposal_id, user_id)
         SELECT ?, id FROM users
          WHERE status = 'verified' AND is_adult = 1 AND political_consent = 1
            AND verified_at IS NOT NULL AND verified_at < ? AND id <> ?`,
        cur.id,
        cur.created_at,
        excluded ?? "",
      );
      const voters = eligibleIds(cur.id);
      const panel = safe(() => deps.experts.panel(cur.id), null);
      const notes: string[] = [];
      if (needsExpert(cur) && (!panel || panel.reports.length === 0)) notes.push("Bilirkişi raporu olmadan başladı.");
      if (safe(() => deps.experts.suspensiveFlag(cur.id), false)) notes.push("Uyarı: bilirkişilerin çoğunluğu öneriyi uygulanamaz buldu.");
      const reason = `Tartışma süresi doldu; oylama açıldı (${voters.length} uygun seçmen).${notes.length ? " " + notes.join(" ") : ""}`;
      const t = applyTransition(core, cur, "voting", reason, {
        now,
        endsAt: now + hoursToMs(params.durationsHours.voting),
        set: {
          audit_report: JSON.stringify(report),
          tier: report.tier,
          params: JSON.stringify(params),
          bylaw_version: report.bylawVersion,
          cluster_snapshot_id: snap.id,
          voting_round: 1,
          extension_used: 0,
          eligible_count: voters.length,
        },
      });
      notifyPhase(cur, "voting", reason);
      core.notify(voters, {
        kind: "vote_open",
        title: `${proposalRef(cur)} oylamada`,
        body: `“${cur.title}” için oyunuzu kullanabilirsiniz. Oyunuzu süre bitene kadar değiştirebilirsiniz.`,
        link: proposalLink(cur.id),
      });
      return [t];
    });
  }

  async function closeRound(p: ProposalRow, now: number): Promise<Transition[]> {
    const comp = computeRound(core, clusters, p, now);
    const { result } = comp;
    const durations = durationsOf(p);

    if (result.outcome === "needs_more_votes") {
      return core.tx(() => {
        const cur = fresh(p);
        db.run(
          "INSERT INTO tallies(id, proposal_id, round, result, interim, created_at) VALUES (?, ?, ?, ?, 1, ?)",
          newId(),
          cur.id,
          comp.round,
          JSON.stringify(result),
          now,
        );
        const reason = "Katılım ya da bazı görüş gruplarındaki oy sayısı yetersiz; oylama bir kez uzatıldı.";
        const t = applyTransition(core, cur, cur.status, reason, {
          now,
          endsAt: Math.max(Number(cur.phase_ends_at), now) + hoursToMs(durations.extension),
          keepStart: true,
          set: { extension_used: 1 },
        });
        const voted = new Set(comp.directVoters);
        core.notify(
          comp.eligible.filter((u) => !voted.has(u)),
          {
            kind: "vote_extended",
            title: `${proposalRef(cur)} oylaması uzatıldı`,
            body: `“${cur.title}” için katılım yetersiz kaldı; oylama bir kez uzatıldı. Henüz oy vermediniz.`,
            link: proposalLink(cur.id),
          },
        );
        return [t];
      });
    }

    const enactsNow = result.outcome === "accept" && (comp.round === 2 || p.kind === "deletion" || durations.objection <= 0);
    const prep = enactsNow ? await prepareEnactment(p) : {};
    return core.tx(() => {
      const cur = fresh(p);
      const revealTx = core.submit("BALLOT_REVEAL", { proposalId: cur.id, round: comp.round, reveals: comp.reveals });
      const tallyTx = core.submit("TALLY", comp.payload as unknown as Record<string, unknown>);
      db.run(
        `INSERT INTO tallies(id, proposal_id, round, result, tally_payload, reveal_payload, ledger_tx, reveal_ledger_tx, interim, delegation_trace, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        newId(),
        cur.id,
        comp.round,
        JSON.stringify(result),
        JSON.stringify(comp.payload),
        JSON.stringify(comp.reveals),
        tallyTx,
        revealTx,
        JSON.stringify(comp.trace),
        now,
      );
      let t: Transition;
      if (result.outcome === "accept") {
        if (enactsNow) t = enact(cur, prep, result.reason, now);
        else {
          t = applyTransition(core, cur, "objection_window", `${result.reason} İtiraz süresi başladı.`, {
            now,
            endsAt: now + hoursToMs(durations.objection),
          });
        }
      } else if (result.outcome === "contested") {
        t = applyTransition(core, cur, "reconciliation", result.reason, {
          now,
          endsAt: now + hoursToMs(durations.reconciliation),
          set: { reconciliation_used: 1, reconciliation_origin: "contested", strong_objection: 0, expert_draw_height: null },
        });
      } else {
        t = close(cur, "rejected", result.reason, now);
      }
      notifyPhase(cur, t.to, t.reason, comp.directVoters);
      if (comp.unrouted.length > 0) {
        core.notify(comp.unrouted, {
          kind: "delegation_unrouted",
          title: `${proposalRef(cur)}: vekâlet oyunuz kullanılamadı`,
          body: "Vekâlet sınırı aşıldığı için oyunuz kullanılamadı. Bir sonraki oylamada doğrudan oy vermeyi ya da başka bir delege seçmeyi düşünebilirsiniz.",
          link: proposalLink(cur.id),
        });
      }
      return [t];
    });
  }

  async function stepObjection(p: ProposalRow, now: number): Promise<Transition[]> {
    const ev = evaluateObjections(core, clusters, p);
    if (ev?.valid && p.reconciliation_used === 0) {
      return core.tx(() => {
        const cur = fresh(p);
        const reason = `Geçerli azınlık itirazı: ${ev.explanation}`;
        const t = applyTransition(core, cur, "reconciliation", reason, {
          now,
          endsAt: now + hoursToMs(durationsOf(cur).reconciliation),
          set: { reconciliation_used: 1, reconciliation_origin: "objection", strong_objection: ev.strong ? 1 : 0, expert_draw_height: null },
        });
        notifyPhase(cur, "reconciliation", reason, eligibleIds(cur.id));
        return [t];
      });
    }
    if (p.phase_ends_at === null || now < p.phase_ends_at) return [];
    const prep = await prepareEnactment(p);
    return core.tx(() => {
      const cur = fresh(p);
      const t = enact(cur, prep, "İtiraz süresi geçerli bir itiraz olmadan doldu; karar yürürlüğe girdi.", now);
      notifyPhase(cur, t.to, t.reason);
      return [t];
    });
  }

  async function stepReconciliation(p: ProposalRow, now: number): Promise<Transition[]> {
    await maybeDrawPanel(p, now);
    if (p.phase_ends_at === null || now < p.phase_ends_at) return [];
    return core.tx(() => {
      const cur = fresh(p);
      const reason = "Uzlaşma süresi doldu; yeniden oylama başladı (aynı seçmen listesi ve küme görüntüsüyle).";
      const t = applyTransition(core, cur, "revote", reason, {
        now,
        endsAt: now + hoursToMs(durationsOf(cur).voting),
        set: { voting_round: 2, extension_used: 0 },
      });
      notifyPhase(cur, "revote", reason);
      core.notify(eligibleIds(cur.id), {
        kind: "vote_open",
        title: `${proposalRef(cur)} yeniden oylamada`,
        body: `“${cur.title}” uzlaşma turundan sonra yeniden oylanıyor. Önceki oyunuz bu tura taşınmaz; yeniden oy verin.`,
        link: proposalLink(cur.id),
      });
      return [t];
    });
  }

  async function stepOnce(p: ProposalRow, now: number): Promise<Transition[]> {
    switch (p.status) {
      case "sponsoring":
        return stepSponsoring(p, now);
      case "deliberation":
        return stepDeliberation(p, now);
      case "voting":
      case "revote":
        return p.phase_ends_at !== null && now >= p.phase_ends_at ? closeRound(p, now) : [];
      case "objection_window":
        return stepObjection(p, now);
      case "reconciliation":
        return stepReconciliation(p, now);
      default:
        return [];
    }
  }

  /** Bir öneriyi, koşulu oluşan geçişler bitene kadar (en çok 6 adım) ilerletir. */
  async function step(id: string): Promise<Transition[]> {
    const out: Transition[] = [];
    for (let i = 0; i < 6; i++) {
      const p = core.proposalRow(id);
      if (!p || !isActive(p.status)) break;
      let ts: Transition[];
      try {
        ts = await stepOnce(p, core.now());
      } catch (e) {
        if (e instanceof StaleState) break;
        throw e;
      }
      out.push(...ts);
      if (ts.length === 0) break;
    }
    return out;
  }

  function maintenance(now: number): void {
    try {
      deps.experts.markOverdue(now);
    } catch (e) {
      console.error("[forum] bilirkişi gecikme denetimi başarısız:", e);
    }
    if (lastDaily === null || now - lastDaily >= DAY) {
      lastDaily = now;
      const id = deps.identity as unknown as { refreshAdulthood?: () => number; purgeStalePending?: () => number };
      try {
        id.refreshAdulthood?.();
      } catch (e) {
        console.error("[forum] reşit olma güncellemesi başarısız:", e);
      }
      try {
        id.purgeStalePending?.();
      } catch (e) {
        console.error("[forum] bekleyen başvuru temizliği başarısız:", e);
      }
    }
  }

  async function runTick(): Promise<Transition[]> {
    maintenance(core.now());
    const ids = db.all<{ id: string }>(`SELECT id FROM proposals WHERE status IN ${ACTIVE_SQL} ORDER BY seq ASC`).map((r) => r.id);
    const out: Transition[] = [];
    for (const id of ids) {
      try {
        out.push(...(await step(id)));
      } catch (e) {
        console.error(`[forum] öneri ${id} ilerletilemedi:`, e);
      }
    }
    return out;
  }

  const engine: LifecycleEngine = {
    start(intervalMs = 1000): void {
      if (timer) return;
      timer = setInterval(() => {
        if (timerBusy) return;
        timerBusy = true;
        engine
          .tick()
          .catch((e) => console.error("[forum] zamanlayıcı hatası:", e))
          .finally(() => {
            timerBusy = false;
          });
      }, Math.max(50, intervalMs));
      timer.unref?.();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick(): Promise<Transition[]> {
      return enqueue(runTick);
    },
    poke(proposalId: string): Promise<Transition[]> {
      return enqueue(async () => {
        try {
          return await step(proposalId);
        } catch (e) {
          console.error(`[forum] öneri ${proposalId} ilerletilemedi:`, e);
          return [];
        }
      });
    },
  };
  return engine;
}
