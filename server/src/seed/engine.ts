// Tohum motoru: simüle saati bir ajanda ve evre bitişleri boyunca ilerletir, her adımda yaşam döngüsünü
// (lifecycle.tick) çalıştırıp defteri boşaltır (ledger.flush) ve faz geçişlerine bağlı senaryo kancalarını tetikler.
// Tüm alan verisi SERVİSLER üzerinden yazılır; doğrudan SQL yalnızca okuma içindir.
import type { ProposalStatus, Rng, VoteChoice } from "@forum/shared";
import type { AppServices } from "../app";
import { HOUR, type Clock } from "../core/clock";
import type { AuthUser } from "../core/contracts";
import type { MsgSpec } from "./content";
import type { Block, Person } from "./people";

export interface SeedUser {
  id: string;
  person: Person;
}

export interface PhaseEvent {
  proposalId: string;
  key: string;
  from: ProposalStatus | null;
  to: ProposalStatus;
  at: number;
}

export type Handler = (ev: PhaseEvent) => Promise<void> | void;

interface AgendaItem {
  at: number;
  seq: number;
  label: string;
  run: () => Promise<void> | void;
}

/** Blok tercihi: evet olasılığı ya da kesin sayılar (oy vermeyenler hariç). */
export type BlockPref = number | { yes: number; no: number; abstain?: number };

export interface VoteSpec {
  A: BlockPref;
  B: BlockPref;
  C: BlockPref;
  /** Planlanan oyların ne kadarı gerçekten verilsin (açık bırakılan oylamalar için) */
  fraction?: number;
  exclude?: string[];
  /** İkinci parti oyların kaç saat sonra verileceği (verilmezse 30 saat; null: tek parti) */
  secondBatchHours?: number | null;
}

const ACTIVE = "('sponsoring','deliberation','voting','objection_window','reconciliation','revote')";

export class SeedEngine {
  readonly users = new Map<string, SeedUser>();
  readonly byId = new Map<string, SeedUser>();
  readonly ids = new Map<string, string>();
  readonly keyOf = new Map<string, string>();
  readonly handlers = new Map<string, Handler>();
  /** `${anahtar}|${tur}` → takma ad → seçim */
  readonly ballots = new Map<string, Map<string, VoteChoice>>();
  /** İş parçacığı anahtarı → gönderilen mesaj kimlikleri (MsgSpec sırasıyla) */
  readonly threadMessages = new Map<string, string[]>();
  readonly problems: string[] = [];
  private agenda: AgendaItem[] = [];
  private agendaSeq = 0;
  private lastEventRow = 0;
  stats = { settles: 0, ticks: 0, votes: 0, messages: 0, endorsements: 0 };

  constructor(
    readonly s: AppServices,
    readonly clock: Clock,
    readonly rng: Rng,
    readonly log: (msg: string) => void,
  ) {}

  // ───────────── Kimlik yardımcıları ─────────────

  user(nickname: string): SeedUser {
    const u = this.users.get(nickname);
    if (!u) throw new Error(`Tohum: bilinmeyen kullanıcı "${nickname}"`);
    return u;
  }

  /** Güncel AuthUser (her çağrıda kimlik modülünden okunur). */
  auth(nickname: string): AuthUser {
    const u = this.user(nickname);
    const me = this.s.identity.me(u.id);
    return { id: me.id, nickname: me.nickname, roles: me.roles, status: me.status, isAdult: me.isAdult, politicalConsent: me.politicalConsent, aiConsent: me.aiConsent };
  }

  blockMembers(block: Block, opts: { exclude?: string[]; experts?: boolean } = {}): string[] {
    const ex = new Set(opts.exclude ?? []);
    return [...this.users.values()]
      .filter((u) => u.person.block === block && !ex.has(u.person.nickname) && (opts.experts || u.person.kind !== "expert"))
      .map((u) => u.person.nickname);
  }

  pick<T>(xs: T[]): T {
    return xs[this.rng.int(xs.length)];
  }

  /** "A" | "B" | "C" ise o bloktan bir üye seçer (deneyimli katılımcılar ağırlıklı); değilse takma adı döndürür. */
  resolveAuthor(by: string, exclude: string[] = []): string {
    if (by === "A" || by === "B" || by === "C") {
      const pool = this.blockMembers(by, { exclude }).filter((n) => (this.user(n).person.turnout ?? 0.88) > 0.5);
      return this.pick(pool.length ? pool : this.blockMembers(by));
    }
    return by;
  }

  // ───────────── Öneri yardımcıları ─────────────

  proposalId(key: string): string {
    const id = this.ids.get(key);
    if (!id) throw new Error(`Tohum: "${key}" önerisi henüz oluşturulmadı`);
    return id;
  }

  register(key: string, id: string, handler?: Handler): void {
    this.ids.set(key, id);
    this.keyOf.set(id, key);
    if (handler) this.handlers.set(key, handler);
  }

  status(key: string): ProposalStatus {
    return this.s.ctx.db.get<{ status: ProposalStatus }>("SELECT status FROM proposals WHERE id = ?", this.proposalId(key))!.status;
  }

  seq(key: string): number {
    return Number(this.s.ctx.db.get<{ seq: number }>("SELECT seq FROM proposals WHERE id = ?", this.proposalId(key))?.seq ?? 0);
  }

  /** Yürürlüğe giren konu/alt konu önerisinin oluşturduğu konu kimliği. */
  topicOf(key: string): string {
    const r = this.s.ctx.db.get<{ enacted_entity_id: string | null; status: string }>("SELECT enacted_entity_id, status FROM proposals WHERE id = ?", this.proposalId(key));
    if (!r?.enacted_entity_id) throw new Error(`Tohum: "${key}" önerisi bir konu oluşturmadı (durum: ${r?.status ?? "?"})`);
    return r.enacted_entity_id;
  }

  // ───────────── Saat ve ajanda ─────────────

  now(): number {
    return this.clock.now();
  }

  advanceTo(t: number): void {
    const d = Math.floor(t - this.clock.now());
    if (d > 0) this.clock.advance(d);
  }

  /** Küçük, tohumlu bir saat ilerlemesi (oy/mesaj aralığı; kilit adım tespitini tetiklememek için ≥ 70 sn). */
  jitter(minMs: number, maxMs: number): void {
    this.clock.advance(minMs + this.rng.int(Math.max(1, maxMs - minMs)));
  }

  schedule(at: number, label: string, run: () => Promise<void> | void): void {
    this.agenda.push({ at, seq: this.agendaSeq++, label, run });
    this.agenda.sort((a, b) => a.at - b.at || a.seq - b.seq);
  }

  scheduleIn(ms: number, label: string, run: () => Promise<void> | void): void {
    this.schedule(this.now() + ms, label, run);
  }

  private nextPhaseEnd(): number | null {
    const r = this.s.ctx.db.get<{ m: number | null }>(`SELECT MIN(phase_ends_at) AS m FROM proposals WHERE status IN ${ACTIVE} AND phase_ends_at > ?`, this.now());
    return r?.m ?? null;
  }

  /** Süresi dolan evreleri işler; geçiş ve kanca kalmayana dek (en çok 8 tur). */
  async settle(): Promise<void> {
    this.stats.settles++;
    for (let i = 0; i < 8; i++) {
      const ts = await this.s.forum.lifecycle.tick();
      this.stats.ticks++;
      await this.s.ledger.flush();
      const evs = this.newEvents();
      for (const ev of evs) await this.fire(ev);
      if (evs.length > 0) await this.s.ledger.flush();
      if (ts.length === 0 && evs.length === 0 && i > 0) break;
    }
  }

  private newEvents(): PhaseEvent[] {
    const rows = this.s.ctx.db.all<{ r: number; p: string; f: string | null; t: string; at: number }>(
      "SELECT rowid AS r, proposal_id AS p, from_status AS f, to_status AS t, at FROM phase_events WHERE rowid > ? ORDER BY rowid",
      this.lastEventRow,
    );
    if (rows.length) this.lastEventRow = rows[rows.length - 1].r;
    return rows
      .filter((r) => this.keyOf.has(r.p))
      .map((r) => ({ proposalId: r.p, key: this.keyOf.get(r.p)!, from: r.f as ProposalStatus | null, to: r.t as ProposalStatus, at: Number(r.at) }));
  }

  private async fire(ev: PhaseEvent): Promise<void> {
    const seq = this.seq(ev.key);
    this.log(`  #K-${seq} (${ev.key}) ${ev.from ?? "—"} → ${ev.to}`);
    const h = this.handlers.get(ev.key);
    if (!h) return;
    try {
      await h(ev);
    } catch (e) {
      this.problem(`${ev.key} (${ev.from} → ${ev.to}) kancası başarısız: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  problem(msg: string): void {
    this.problems.push(msg);
    this.log(`  ⚠ ${msg}`);
  }

  /** Ajandayı ve evre bitişlerini `until` anına kadar işler. */
  async runUntil(until: number): Promise<void> {
    await this.settle();
    for (let guard = 0; guard < 5000; guard++) {
      const nextAgenda = this.agenda[0]?.at ?? Infinity;
      const pe = this.nextPhaseEnd();
      const nextPhase = pe === null ? Infinity : pe + 1000;
      const next = Math.min(nextAgenda, nextPhase);
      if (next > until) break;
      this.advanceTo(next);
      while (this.agenda.length && this.agenda[0].at <= this.now()) {
        const item = this.agenda.shift()!;
        try {
          await item.run();
        } catch (e) {
          this.problem(`${item.label} başarısız: ${e instanceof Error ? e.message : String(e)}`);
        }
        await this.s.ledger.flush();
      }
      await this.settle();
    }
    this.advanceTo(until);
    await this.settle();
  }

  pendingAgenda(): number {
    return this.agenda.length;
  }

  // ───────────── Oylar ─────────────

  /**
   * Blok eğilimlerine göre (tohumlu) oy planı çıkarır ve ilk partiyi hemen, ikinciyi `secondBatchHours` sonra verir.
   * Kesin sayılı bloklarda üyeler karıştırılıp ilk `yes` kişi evet, sonraki `no` kişi hayır der.
   */
  async castVotes(key: string, round: 1 | 2, spec: VoteSpec): Promise<void> {
    const id = this.proposalId(key);
    const eligible = new Set(this.s.forum.proposals.voters(id).voters.map((v) => v.userId));
    const exclude = new Set(spec.exclude ?? []);
    const plan: { nick: string; choice: VoteChoice }[] = [];
    for (const block of ["A", "B", "C"] as Block[]) {
      const pref = spec[block];
      const members = this.blockMembers(block, { experts: true }).filter((n) => eligible.has(this.user(n).id) && !exclude.has(n));
      if (typeof pref === "number") {
        for (const n of members) {
          const turnout = this.user(n).person.turnout ?? 0.88;
          if (this.rng.next() >= turnout) continue;
          const r = this.rng.next();
          plan.push({ nick: n, choice: r < 0.03 ? "abstain" : this.rng.next() < pref ? "yes" : "no" });
        }
      } else {
        const order = this.rng.shuffle(members);
        let i = 0;
        for (let k = 0; k < pref.yes && i < order.length; k++) plan.push({ nick: order[i++], choice: "yes" });
        for (let k = 0; k < pref.no && i < order.length; k++) plan.push({ nick: order[i++], choice: "no" });
        for (let k = 0; k < (pref.abstain ?? 0) && i < order.length; k++) plan.push({ nick: order[i++], choice: "abstain" });
      }
    }
    let list = this.rng.shuffle(plan);
    if (spec.fraction !== undefined) list = list.slice(0, Math.max(1, Math.round(list.length * spec.fraction)));
    const second = spec.secondBatchHours === undefined ? 30 : spec.secondBatchHours;
    const cut = second === null || spec.fraction !== undefined ? list.length : Math.ceil(list.length * 0.6);
    await this.castList(key, round, list.slice(0, cut));
    const rest = list.slice(cut);
    if (rest.length && second !== null) this.scheduleIn(second * HOUR, `${key} tur ${round} oyları (2. parti)`, () => this.castList(key, round, rest));
  }

  private async castList(key: string, round: 1 | 2, list: { nick: string; choice: VoteChoice }[]): Promise<void> {
    const id = this.proposalId(key);
    const k = `${key}|${round}`;
    const map = this.ballots.get(k) ?? new Map<string, VoteChoice>();
    this.ballots.set(k, map);
    for (const v of list) {
      this.jitter(70_000, 300_000);
      try {
        await this.s.forum.proposals.vote(this.auth(v.nick), id, v.choice);
        map.set(v.nick, v.choice);
        this.stats.votes++;
      } catch (e) {
        this.problem(`${key} tur ${round}: ${v.nick} oy veremedi (${e instanceof Error ? e.message : String(e)})`);
      }
    }
  }

  /** Bu turda belirli seçimi yapan (doğrudan oy) takma adlar. */
  votersWith(key: string, round: 1 | 2, choice: VoteChoice, block?: Block): string[] {
    const map = this.ballots.get(`${key}|${round}`) ?? new Map();
    return [...map.entries()].filter(([n, c]) => c === choice && (!block || this.user(n).person.block === block)).map(([n]) => n);
  }

  // ───────────── Tartışma ─────────────

  /** Mesajları sırayla gönderir (yanıt zincirleri dahil) ve bloklara göre katılıyorum/katılmıyorum işaretleri ekler. */
  async postThread(threadKey: string, threadType: "topic" | "proposal", threadId: string, msgs: MsgSpec[], opts: { avoid?: string[] } = {}): Promise<string[]> {
    const ids = this.threadMessages.get(threadKey) ?? [];
    const base = ids.length;
    const authors: string[] = [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const nick = this.resolveAuthor(m.by, opts.avoid);
      this.jitter(5 * 60_000, 40 * 60_000);
      const parentId = m.reply !== undefined ? ids[base + m.reply] ?? null : null;
      const view = await this.s.forum.messages.post(this.auth(nick), threadType, threadId, { body: m.text, stance: m.stance, parentId });
      ids.push(view.id);
      authors.push(nick);
      this.stats.messages++;
    }
    this.threadMessages.set(threadKey, ids);
    for (let i = 0; i < msgs.length; i++) this.endorse(ids[base + i], authors[i], !!msgs[i].bridge);
    return ids.slice(base);
  }

  private endorse(messageId: string, author: string, bridge: boolean): void {
    const authorBlock = this.users.get(author)?.person.block;
    const pool = [...this.users.values()].filter((u) => u.person.block && u.person.nickname !== author && u.person.kind !== "expert");
    const n = 3 + this.rng.int(7);
    const chosen = this.rng.shuffle(pool).slice(0, n);
    for (const u of chosen) {
      let value: -1 | 1 | null = null;
      if (u.person.block === authorBlock) value = this.rng.next() < 0.85 ? 1 : null;
      else if (bridge) value = this.rng.next() < 0.75 ? 1 : null;
      else value = this.rng.next() < 0.6 ? -1 : this.rng.next() < 0.2 ? 1 : null;
      if (value === null) continue;
      try {
        this.s.forum.messages.endorse(this.auth(u.person.nickname), messageId, value);
        this.stats.endorsements++;
      } catch (e) {
        this.problem(`işaret eklenemedi: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // ───────────── Destek ─────────────

  /** Yazar dışındaki üyelerden destekçi ekler (önce yazarın bloğu). `count` verilmezse gerekli sayıya ulaşılır. */
  async sponsor(key: string, author: string, count?: number): Promise<void> {
    const id = this.proposalId(key);
    const need = count ?? this.s.forum.proposals.get(id, this.auth(author)).sponsorsRequired;
    const block = this.users.get(author)?.person.block ?? "A";
    const others = (["A", "B", "C"] as Block[]).filter((b) => b !== block);
    const pool = [
      ...this.rng.shuffle(this.blockMembers(block, { exclude: [author] })),
      ...this.rng.shuffle([...this.blockMembers(others[0]), ...this.blockMembers(others[1])]),
    ].filter((n) => (this.user(n).person.turnout ?? 0.88) > 0.5);
    for (let i = 0; i < need && i < pool.length; i++) {
      this.jitter(10 * 60_000, 50 * 60_000);
      await this.s.forum.proposals.sponsor(this.auth(pool[i]), id);
    }
  }

  // ───────────── Bilirkişi ─────────────

  /** Panel çekilene dek defteri boşaltıp yaşam döngüsünü ilerletir (tohum bloğu önceden taahhüt edilir). */
  async ensurePanel(key: string): Promise<boolean> {
    const id = this.proposalId(key);
    for (let i = 0; i < 8; i++) {
      if (this.s.experts.panel(id)) return true;
      await this.s.ledger.flush();
      await this.s.forum.lifecycle.tick();
    }
    return !!this.s.experts.panel(id);
  }
}
