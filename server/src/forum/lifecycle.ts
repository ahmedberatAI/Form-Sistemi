// Yaşam döngüsü (ALGORITMA.md §3): zamanlayıcıyla yürüyen faz geçişleri. Sıralı kuyruk (yeniden giriş yok), her öneri kendi
// try/catch'inde. Bir geçişin YAZILDIĞI tek yer applyTransition'dır (durum + phase_events + PHASE_CHANGED defter kaydı);
// zamanlayıcının geçişleri de yazarın submit/withdraw eylemleri de (proposals.ts) onu çağırır. Tüm süreler ctx.clock ile ve
// gerçek saat değerleriyle (hours · HOUR) hesaplanır.
import {
  PROPOSAL_STATUS_LABELS,
  sponsorsRequired,
  type AuditReport,
  type BylawVersionInfo,
  type ProposalStatus,
} from "@forum/shared";
import type { ProposalAuditInput } from "../core/contracts";
import { AppError } from "../core/errors";
import type { LifecycleEngine, MessageService, TopicService, Transition } from "../core/forum-contracts";
import { newId } from "../core/ids";
import { json, type SqlValue } from "../db";
import type { ClusterServiceImpl } from "./clusters";
import { recordLockstep } from "./integrity";
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

/** Kapanan (düşen, geri çekilen, reddedilen ya da yürürlüğe giren) öneriler: bekleyen bilirkişi görevleri cezasız iptal edilir. */
const CLOSED_FOR_EXPERTS = new Set<ProposalStatus>(["withdrawn", "expired", "inadmissible", "rejected", "enacted"]);

/**
 * Bilirkişi kurası tohum bloğunun taahhüt payı (ALGORITMA.md §12 madde 9): tohum, taahhüt anındaki son blok yüksekliğine
 * bu pay eklenerek bulunan, o anda HENÜZ VAR OLMAYAN bloğun hash'inden alınır. Yükseklik bir kez (boşken) yazılır ve
 * değişmez; kura bu blok işlenmeden yapılmaz (`seed_block_pending`), dolayısıyla çekiliş anı seçilerek uygun bir hash
 * yakalanamaz. Pay 1'dir, 2 değil: defter boş blok üretmez; +1 bloğunu taahhüdü taşıyan SEED_COMMIT işlemi (bkz.
 * commitSeedBlock) oluşturur, +2 bloğu için başka bir işlemin gelmesi gerekir ve boşta kalan bir defterde kura süre bitene
 * kadar beklerdi (bilirkişi gerekliyken panelsiz oylama). Bu payı değiştirmeden önce ALGORITMA.md §12 madde 9'daki gerekçeye
 * ve test/forum/seed-commit.test.ts'e bakın.
 */
export const SEED_COMMIT_LEAD = 1;

/** Taahhüt edilecek tohum bloğunun yüksekliği: taahhüt anındaki son blok + SEED_COMMIT_LEAD. */
export const seedCommitHeight = (latestHeight: number): number => latestHeight + SEED_COMMIT_LEAD;

/**
 * Tohum taahhüdünü TAŞIYAN defter işlemi (SEED_COMMIT {proposalId, height, phase}). Taahhüt yüksekliği yazılan HER yolda
 * (tartışma açılışı, hak bayrağı, bilirkişi talebi, uzlaşma turu yeniden çekimi ve karşı panel) aynı ForumCore.tx içinde
 * çağrılır: defter boş blok üretmediğinden taahhüt edilen +1 bloğunu bu işlem oluşturur (kura, ilgisiz bir defter işlemi
 * beklemeden bir blok aralığında yapılabilir) ve taahhüt defterde denetlenebilir olur — işlem taahhüt edilen bloğun içindedir,
 * dolayısıyla taahhüt o bloğun hash'i bilinmeden yapılmıştır. Gönderim işlem COMMIT olunca yapılır (ForumCore.submit).
 */
export function commitSeedBlock(core: ForumCore, proposalId: string, height: number, phase: ProposalStatus): void {
  core.submit("SEED_COMMIT", { proposalId, height, phase });
}

/** Yazarın metin önerilerine karar verebildiği evreler (ALGORITMA.md §3, "Tartışma içi öneriler"). */
export const SUGGESTION_DECIDABLE = new Set<ProposalStatus>(["deliberation", "reconciliation"]);

/**
 * Yazarın karar vermediği açık metin önerileri, karar verilebilen evreden çıkılınca "lapsed" (karar verilmeden kapandı) olur:
 * oylama başlarken metin kilitlenir; geri çekme, geçersizlik, süre dolumu ya da kesin sonuç da aynı etkiyi doğurur. Öneri
 * herkese açık kalır ve öneren kişiye bildirim gider; öneren onu ayrı bir öneri olarak açabilir (yazarın sessiz vetosu yoktur).
 */
function lapseOpenSuggestions(core: ForumCore, p: ProposalRow, to: ProposalStatus, now: number): void {
  const rows = core.db.all<{ author_id: string }>("SELECT author_id FROM proposal_suggestions WHERE proposal_id = ? AND status = 'open'", p.id);
  if (rows.length === 0) return;
  core.db.run("UPDATE proposal_suggestions SET status = 'lapsed', decided_at = ? WHERE proposal_id = ? AND status = 'open'", now, p.id);
  const why =
    to === "voting"
      ? "Oylama başladığı için metin kilitlendi; yazar önerinize karar vermedi."
      : `Öneri “${PROPOSAL_STATUS_LABELS[to] ?? to}” durumuna geçtiği için önerinize karar verilmedi.`;
  core.notify([...new Set(rows.map((r) => r.author_id))], {
    kind: "proposal_suggestion",
    title: `${proposalRef(p)}: metin öneriniz karar verilmeden kapandı`,
    body: `${why} Öneriniz herkese açık kalır; isterseniz ayrı bir öneri olarak açabilirsiniz.`,
    link: proposalLink(p.id),
  });
}

/**
 * Tek bir faz geçişi (çağıran işlemin İÇİNDE çalışır): proposals güncellemesi (durum + sürüm koşullu),
 * phase_events satırı ve PHASE_CHANGED defter kaydı {proposalId, from, to, textHash, at, reason}.
 * Durum ya da sürüm bu arada değiştiyse `StaleState` fırlatır (geçiş yapılmaz, defter kaydı gönderilmez).
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
  // Öneri kapandıysa bekleyen bilirkişi görevleri itibar cezası olmadan iptal edilir.
  if (CLOSED_FOR_EXPERTS.has(to)) core.deps.experts.cancelPending(p.id);
  // Karar verilebilen evreden çıkılırken (oylama, geri çekme, kesin sonuç …) bekleyen metin önerileri kapanır.
  if (!SUGGESTION_DECIDABLE.has(to)) lapseOpenSuggestions(core, p, to, o.now);
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

/** Ardışık başarısız adım denemeleri arasındaki üstel geri çekilme: 2 sn · 2^(n-1), en çok 10 dk. */
export const STEP_BACKOFF_BASE_MS = 2_000;
export const STEP_BACKOFF_CAP_MS = 10 * 60_000;
/** Denetim günlüğüne ilk başarısızlıkta ve sonra her N. ardışık başarısızlıkta yazılır. */
export const STEP_FAILURE_AUDIT_EVERY = 5;

export const stepBackoffMs = (failures: number): number => Math.min(STEP_BACKOFF_CAP_MS, STEP_BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));

/** tick() sonucu: dizi + (numaralanamaz özellik) `failed` — bu turda ilerletilemeyen (geri çekilmede bekleyenler dâhil) öneri kimlikleri. */
export function failedProposalIds(ts: readonly Transition[]): string[] {
  return ((ts as { failed?: string[] }).failed ?? []).slice();
}

function withFailed(out: Transition[], failed: string[]): Transition[] {
  // Numaralanamaz: mevcut tüketiciler (toEqual, spread, JSON) diziyi eskisi gibi görür.
  Object.defineProperty(out, "failed", { value: failed, enumerable: false });
  return out;
}

/** Kalıcı ve herkese açık metne yalnızca güvenli neden yazılır: AppError iletisi kullanıcıya yöneliktir; gerisi genel iletiye iner. */
function safeReason(e: unknown): { code: string; why: string } {
  if (e instanceof AppError) return { code: e.code, why: e.message };
  return { code: "internal_error", why: "Beklenmeyen bir iç hata nedeniyle uygulanamadı." };
}

/** Ham istisna iletisi yalnızca sunucu logunda ve denetim günlüğünde tutulur (kısaltılmış). */
const rawMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 500);

export function createLifecycle(core: ForumCore, parts: LifecycleParts): LifecycleEngine {
  const { db, deps } = core;
  const { clusters, topics, messages } = parts;
  let chain: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | null = null;
  let timerBusy = false;
  /** Öneri başına ardışık adım başarısızlıkları (bellekte): sayaç + sonraki deneme zamanı (ctx.clock). */
  const stepFailures = new Map<string, { count: number; nextAt: number; code: string }>();
  /** Bilirkişi kurası hataları evreyi durdurmaz; yalnızca ilk hata ve seyrek tekrarlar kaydedilir. */
  const drawFailures = new Map<string, number>();

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
      // Taahhüt: tohum, henüz üretilmemiş bloğun hash'i olacak (öğütmeye karşı; bkz. SEED_COMMIT_LEAD). Yalnız boşken yazılır;
      // taahhüdü taşıyan SEED_COMMIT işlemi aynı işlemde gönderilir ve taahhüt edilen bloğu oluşturur.
      core.tx(() => {
        const height = seedCommitHeight(latest.height);
        const r = db.run("UPDATE proposals SET expert_draw_height = ? WHERE id = ? AND expert_draw_height IS NULL", height, p.id);
        if (r.changes === 1) commitSeedBlock(core, p.id, height, p.status);
      });
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
      const { code, why } = safeReason(e);
      console.error(`[forum] ${proposalRef(p)} yönetmelik yaması uygulanamadı:`, e);
      core.audit.log(null, "system.enactment_failed", p.id, { step: "prepare", code, error: rawMessage(e) });
      return { error: `${why} (hata kodu: ${code})` };
    }
  }

  /**
   * Yürürlük etkileri + enacted (ya da sürüm çakışması / yama hatası / etki uygulanamadığında rejected).
   * Çağıranın işlemi içinde. Etki hatası öneriyi asla sonsuz yeniden denemede bırakmaz (canlılık).
   */
  function enact(p: ProposalRow, prep: EnactPrep, reason: string, now: number): Transition {
    const parsed = parseProposal(p);
    const enacted = (entity: string | null) =>
      applyTransition(core, p, "enacted", reason, { now, endsAt: null, set: { enacted_entity_id: entity, final_reason: reason } });
    // Ham istisna iletisi saklanan/yayımlanan nedene GİRMEZ (kalıcı, silinemez defter): yalnızca güvenli neden + hata kodu.
    const effect = <T>(fn: () => T): { ok: true; value: T } | { ok: false; why: string } => {
      try {
        return { ok: true, value: core.tx(fn) };
      } catch (e) {
        if (e instanceof StaleState) throw e;
        const { code, why } = safeReason(e);
        console.error(`[forum] ${proposalRef(p)} yürürlük etkisi uygulanamadı:`, e);
        core.audit.log(null, "system.enactment_failed", p.id, { step: "effect", kind: p.kind, code, error: rawMessage(e) });
        return { ok: false, why: `${why} (hata kodu: ${code})` };
      }
    };
    switch (p.kind) {
      case "topic":
      case "subtopic": {
        const r = effect(() => topics.createFromProposal(p.id));
        if (!r.ok) return close(p, "rejected", `Yürürlük etkisi uygulanamadı: ${r.why}`, now);
        return enacted(r.value.topicId);
      }
      case "amendment": {
        const r = effect(() => topics.reviseFromProposal(p.id));
        if (!r.ok) return close(p, "rejected", `Yürürlük etkisi uygulanamadı: ${r.why}`, now);
        if ("conflict" in r.value) {
          const why = `Sürüm çakışması: konu bu arada güncellendi (güncel sürüm ${r.value.currentVersion}, teklifin dayandığı sürüm ${parsed.amendment?.baseVersion ?? "?"}); düzenleme uygulanamadı.`;
          return close(p, "rejected", why, now);
        }
        return enacted(r.value.topicId);
      }
      case "deletion": {
        const d = parsed.deletion;
        const r = effect(() => (d ? messages.hide(d.messageIds, p.id, d.ground, groundIsSealed(deps, d.ground)) : []));
        if (!r.ok) return close(p, "rejected", `Yürürlük etkisi uygulanamadı: ${r.why}`, now);
        return enacted(null);
      }
      case "regulation": {
        if (!prep.bylaw) return close(p, "rejected", `Yönetmelik yaması uygulanamadı: ${prep.error ?? "bilinmeyen hata"}`, now);
        const v = prep.bylaw;
        const tx = core.submit("BYLAW_VERSION", { version: v.version, hash: v.hash, proposalId: p.id });
        try {
          deps.ontology.setLedgerTx(v.version, tx);
        } catch (e) {
          console.error("[forum] yönetmelik sürümüne defter kaydı bağlanamadı:", e);
        }
        return enacted(String(v.version));
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
        // Tohum taahhüdü: taahhüt edilen bloğu bu işlemin PHASE_CHANGED ve SEED_COMMIT kayıtları oluşturur; hash'i şu an bilinemez.
        const seedHeight = expert ? seedCommitHeight(deps.ledger.latestBlock().height) : null;
        const t = applyTransition(core, cur, "deliberation", reason, {
          now,
          endsAt: now + hoursToMs(durations.deliberation),
          set: {
            audit_report: JSON.stringify(report),
            tier: report.tier,
            expert_draw_height: seedHeight,
          },
        });
        if (seedHeight !== null) commitSeedBlock(core, cur.id, seedHeight, "deliberation");
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

  /** Kura hatası evre ilerlemesini asla durdurmaz (canlılık): hata günlüğe yazılır, sonraki tick yeniden dener. */
  async function drawSafely(p: ProposalRow, now: number): Promise<void> {
    try {
      await maybeDrawPanel(p, now);
      drawFailures.delete(p.id);
    } catch (e) {
      const n = (drawFailures.get(p.id) ?? 0) + 1;
      drawFailures.set(p.id, n);
      // Her saniye yeniden denenir: günlük/denetim yalnızca ilk hatada ve her 60. tekrarda yazılır.
      if (n === 1 || n % 60 === 0) {
        console.error(`[forum] ${proposalRef(p)} bilirkişi kurası yapılamadı (deneme ${n}):`, e);
        core.audit.log(null, "system.lifecycle_draw_error", p.id, { attempts: n, code: e instanceof AppError ? e.code : "internal_error", error: rawMessage(e) });
      }
    }
  }

  async function stepDeliberation(p: ProposalRow, now: number): Promise<Transition[]> {
    await drawSafely(p, now);
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
      // Kilit adım taraması (ALGORITMA §12.10): yalnızca denetim uyarısı — sonuç ve geçiş bundan ETKİLENMEZ.
      recordLockstep(core, cur.id, comp.round);
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
      const voters = db.all<{ user_id: string }>("SELECT user_id FROM ballots WHERE proposal_id = ? AND round = 1", cur.id).map((r) => r.user_id);
      notifyPhase(cur, t.to, t.reason, voters);
      return [t];
    });
  }

  async function stepReconciliation(p: ProposalRow, now: number): Promise<Transition[]> {
    await drawSafely(p, now);
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

  /**
   * Yaşam döngüsünün kendi bakımı: yalnız bilirkişi gecikme denetimi (her tick). Kimlik bakımı (reşitlik bayrağı, bekleyen başvuru
   * imhası) burada DEĞİL, bileşim kökündeki (app.ts) tek zamanlayıcıdadır — iki yerden iki kez zamanlanmaz.
   */
  function maintenance(now: number): void {
    try {
      deps.experts.markOverdue(now);
    } catch (e) {
      console.error("[forum] bilirkişi gecikme denetimi başarısız:", e);
    }
  }

  /** Bir adımın başarısızlığını kaydeder: sayaç + üstel geri çekilme; ilk hatada ve her N. hatada denetim günlüğüne yazar. */
  function recordFailure(id: string, e: unknown): void {
    const count = (stepFailures.get(id)?.count ?? 0) + 1;
    const code = e instanceof AppError ? e.code : "internal_error";
    const nextAt = core.now() + stepBackoffMs(count);
    stepFailures.set(id, { count, nextAt, code });
    console.error(`[forum] öneri ${id} ilerletilemedi (ardışık hata ${count}; sonraki deneme ${new Date(nextAt).toISOString()}):`, e);
    if (count === 1 || count % STEP_FAILURE_AUDIT_EVERY === 0) {
      try {
        core.audit.log(null, "system.lifecycle_error", id, { attempts: count, code, error: rawMessage(e), nextRetryAt: nextAt });
      } catch (auditErr) {
        console.error("[forum] yaşam döngüsü hatası denetim günlüğüne yazılamadı:", auditErr);
      }
    }
  }

  async function runTick(): Promise<Transition[]> {
    maintenance(core.now());
    const ids = db.all<{ id: string }>(`SELECT id FROM proposals WHERE status IN ${ACTIVE_SQL} ORDER BY seq ASC`).map((r) => r.id);
    const out: Transition[] = [];
    const failed: string[] = [];
    for (const id of ids) {
      const f = stepFailures.get(id);
      if (f && core.now() < f.nextAt) {
        failed.push(id); // geri çekilme penceresinde: yeniden denenmez, ama hâlâ başarısız sayılır
        continue;
      }
      try {
        out.push(...(await step(id)));
        stepFailures.delete(id);
      } catch (e) {
        recordFailure(id, e);
        failed.push(id);
      }
    }
    // Artık etkin olmayan (kapanmış) öneriler için kayıtları temizle.
    const active = new Set(ids);
    for (const id of [...stepFailures.keys()]) if (!active.has(id)) stepFailures.delete(id);
    for (const id of [...drawFailures.keys()]) if (!active.has(id)) drawFailures.delete(id);
    return withFailed(out, failed);
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
    stop(): Promise<void> {
      if (timer) clearInterval(timer);
      timer = null;
      // Uçuştaki tick/poke bitene kadar beklenir (zincir hiçbir zaman reddedilmez): kapanışta defter/DB bunlardan önce kapanmasın.
      return chain.then(() => undefined);
    },
    tick(): Promise<Transition[]> {
      return enqueue(runTick);
    },
    poke(proposalId: string): Promise<Transition[]> {
      return enqueue(async () => {
        try {
          const ts = await step(proposalId);
          stepFailures.delete(proposalId);
          return withFailed(ts, []);
        } catch (e) {
          recordFailure(proposalId, e);
          return withFailed([], [proposalId]);
        }
      });
    },
  };
  return engine;
}
