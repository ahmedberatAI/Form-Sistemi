// Test tarafı REST istemcisi: senaryonun "arka plandaki" adımları (diğer üyelerin desteği ve oyları, yönetici saati,
// keşif sorguları) için. Arayüzden yapılması gereken adımlar testlerde tarayıcıyla yapılır.
// Oturum belirteçleri kullanıcı başına önbelleğe alınır (giriş hız sınırı); 429 yanıtında sunucunun bildirdiği süre kadar beklenir.
import type { BallotReceipt, LoginRequest, ProposalDetail, ProposalSummary, SystemInfo, TickResponse } from "@forum/shared";
import { HOUR_MS, passwordOf } from "./env";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Api {
  private readonly tokens = new Map<string, string>();
  constructor(readonly baseURL: string) {}

  async request<T>(method: string, path: string, opts: { as?: string; token?: string; body?: unknown } = {}): Promise<T> {
    const token = opts.token ?? (opts.as ? await this.token(opts.as) : undefined);
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.baseURL + path, {
        method,
        headers: {
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const text = await res.text();
      const data = text ? (JSON.parse(text) as unknown) : null;
      if (res.status === 429 && attempt < 5) {
        // Hız sınırı: sunucunun bildirdiği süre (retry-after) kadar bekle ve yeniden dene.
        const sec = Number(res.headers.get("retry-after") ?? (data as { error?: { details?: { retryAfterSeconds?: number } } })?.error?.details?.retryAfterSeconds ?? 5);
        await pause(Math.min(65, Math.max(1, sec)) * 1000);
        continue;
      }
      if (!res.ok) {
        const e = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
        throw new HttpError(res.status, e?.code ?? "http_error", `${method} ${path} → ${res.status} ${e?.code ?? ""}: ${e?.message ?? text.slice(0, 300)}`, e?.details);
      }
      return data as T;
    }
  }

  get<T>(path: string, as?: string): Promise<T> {
    return this.request<T>("GET", path, { as });
  }
  post<T>(path: string, body: unknown, as?: string): Promise<T> {
    return this.request<T>("POST", path, { as, body });
  }

  /** Kullanıcının oturum belirteci (ilk çağrıda POST /api/auth/login; sonra önbellekten). */
  async token(nickname: string, password = passwordOf(nickname)): Promise<string> {
    const cached = this.tokens.get(nickname);
    if (cached) return cached;
    const body: LoginRequest = { login: nickname, password };
    const res = await this.request<{ token: string }>("POST", "/api/auth/login", { body });
    this.tokens.set(nickname, res.token);
    return res.token;
  }

  setToken(nickname: string, token: string): void {
    this.tokens.set(nickname, token);
  }

  system(): Promise<SystemInfo> {
    return this.get<SystemInfo>("/api/system");
  }

  proposals(query: Record<string, string> = {}): Promise<ProposalSummary[]> {
    const qs = new URLSearchParams({ limit: "200", ...query }).toString();
    return this.get<ProposalSummary[]>(`/api/proposals?${qs}`);
  }

  async proposalBySeq(seq: number): Promise<ProposalSummary> {
    const p = (await this.proposals()).find((x) => x.seq === seq);
    if (!p) throw new Error(`#K-${seq} bulunamadı`);
    return p;
  }

  /** Bu durumdaki ilk öneri (tohumda her evrede en az bir öneri vardır). */
  async proposalInStatus(status: ProposalSummary["status"], kind?: ProposalSummary["kind"]): Promise<ProposalSummary> {
    const p = (await this.proposals({ status })).find((x) => x.status === status && (!kind || x.kind === kind));
    if (!p) throw new Error(`"${status}" durumunda öneri yok`);
    return p;
  }

  proposal(id: string, as?: string): Promise<ProposalDetail> {
    return this.get<ProposalDetail>(`/api/proposals/${id}`, as);
  }

  sponsor(id: string, as: string): Promise<ProposalDetail> {
    return this.post<ProposalDetail>(`/api/proposals/${id}/sponsor`, {}, as);
  }

  vote(id: string, as: string, choice: "yes" | "no" | "abstain"): Promise<BallotReceipt> {
    return this.post<BallotReceipt>(`/api/proposals/${id}/vote`, { choice }, as);
  }

  advanceClock(hours: number): Promise<TickResponse> {
    return this.post<TickResponse>("/api/admin/clock/advance", { hours }, "yonetici");
  }

  /** Defter işlemi bir bloğa girmiş mi (GET /api/ledger/txs/:hash 200)? */
  async isCommitted(txHash: string): Promise<boolean> {
    try {
      await this.get(`/api/ledger/txs/${txHash}`);
      return true;
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return false;
      throw e;
    }
  }

  /** Önerinin kesin sayım işlemleri (TALLY, BALLOT_REVEAL) bloklara girene kadar bekler. */
  async waitBulletinCommitted(id: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const b = await this.get<{ rounds: { tallyTx: string | null; revealTx: string | null }[] }>(`/api/proposals/${id}/bulletin`);
      const hashes = b.rounds.flatMap((r) => [r.tallyTx, r.revealTx]);
      if (hashes.length && hashes.every((h) => !!h) && (await Promise.all(hashes.map((h) => this.isCommitted(h!)))).every(Boolean)) return;
      if (Date.now() > deadline) throw new Error(`Öneri ${id}: sayım işlemleri ${timeoutMs / 1000} sn içinde bloğa girmedi`);
      await pause(250);
    }
  }

  /** Önerinin mevcut evresi bitene kadar saati ileri alır (yönetici) ve yeni durumu döndürür. */
  async advancePastPhase(id: string): Promise<ProposalDetail> {
    const before = await this.proposal(id);
    if (!before.phaseEndsAt) throw new Error(`#K-${before.seq} (${before.status}) için evre bitişi yok`);
    const now = (await this.system()).now;
    const hours = Math.max(1, Math.ceil((before.phaseEndsAt - now) / HOUR_MS) + 1);
    await this.advanceClock(hours);
    return this.proposal(id);
  }
}
