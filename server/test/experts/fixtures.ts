// Bilirkişi testleri için küçük sahte bağımlılıklar (graf, matematik, YZ, ontoloji) ve dünya kurucu.
import { createRng, fy, weightedSampleWithoutReplacement, type GraphEdgeView } from "@forum/shared";
import { createAuditLogger } from "../../src/core/audit";
import type { AiService, ConflictCheck, GovernanceMath, GraphService, NewEdge } from "../../src/core/contracts";
import { MemoryNotifier } from "../../src/core/notifier";
import { createExpertService } from "../../src/experts";
import { FakeLedger, insertUser, makeCtx } from "../helpers/fakes";

export const CAT = {
  root: fy("Kategori"),
  ulasim: fy("Ulasim"),
  toplu: fy("TopluTasima"),
  metro: fy("Metro"),
  bisiklet: fy("BisikletYaya"),
  saglik: fy("Saglik"),
  halk: fy("HalkSagligi"),
};

const PARENT: Record<string, string | null> = {
  [CAT.root]: null,
  [CAT.ulasim]: CAT.root,
  [CAT.toplu]: CAT.ulasim,
  [CAT.metro]: CAT.toplu,
  [CAT.bisiklet]: CAT.ulasim,
  [CAT.saglik]: CAT.root,
  [CAT.halk]: CAT.saglik,
};

function ancestors(iri: string): string[] {
  const out: string[] = [];
  let c: string | null = iri;
  while (c) {
    out.push(c);
    c = PARENT[c] ?? null;
  }
  return out;
}

export const fakeOntology = {
  ancestors,
  isSubCategoryOf: (a: string, b: string) => ancestors(a).includes(b),
  categoryLabel: (iri: string) => iri.slice(iri.indexOf("#") + 1),
};

/** Sahte kura: shared'deki A-Res örnekleyicisi, adaylar kimliğe göre sıralanır. */
export const fakeMath = {
  drawWeighted<T extends { id: string; weight: number }>(candidates: T[], k: number, seed: string): T[] {
    const sorted = candidates.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return weightedSampleWithoutReplacement(sorted, sorted.map((c) => c.weight), k, createRng(seed));
  },
} as unknown as GovernanceMath;

function bfs(adj: Map<string, Set<string>>, a: string, b: string, max: number): number | null {
  if (a === b) return 0;
  let frontier = [a];
  const seen = new Set([a]);
  for (let d = 1; d <= max; d++) {
    const next: string[] = [];
    for (const x of frontier) {
      for (const y of adj.get(x) ?? []) {
        if (y === b) return d;
        if (!seen.has(y)) {
          seen.add(y);
          next.push(y);
        }
      }
    }
    frontier = next;
  }
  return null;
}

/** Sahte graf: RELATED_TO (aile/iş/hane) ≤ 3 adım → kesin; hane eşitliği → kesin; FOLLOWS mesafe 1/2 → yumuşak 1/0,5. */
export class FakeGraph {
  readonly edges: (GraphEdgeView & { revoked: boolean })[] = [];
  private related = new Map<string, Set<string>>();
  private follows = new Map<string, Set<string>>();
  private seq = 0;

  private link(m: Map<string, Set<string>>, a: string, b: string): void {
    if (!m.has(a)) m.set(a, new Set());
    if (!m.has(b)) m.set(b, new Set());
    m.get(a)!.add(b);
    m.get(b)!.add(a);
  }
  relate(a: string, b: string): void {
    this.link(this.related, a, b);
  }
  follow(a: string, b: string): void {
    this.link(this.follows, a, b);
  }
  addEdge(e: NewEdge): GraphEdgeView {
    const v = { id: `edge-${++this.seq}`, src: e.src, dst: e.dst, type: e.type, weight: e.weight ?? 1, scope: e.scope ?? null, meta: e.meta ?? null, createdAt: 0, revoked: false };
    this.edges.push(v);
    return v;
  }
  revokeEdge(id: string): void {
    const e = this.edges.find((x) => x.id === id);
    if (e) e.revoked = true;
  }
  listEdges(f: { src?: string; dst?: string; type?: string; includeRevoked?: boolean }): GraphEdgeView[] {
    return this.edges.filter(
      (e) => (!f.src || e.src === f.src) && (!f.dst || e.dst === f.dst) && (!f.type || e.type === f.type) && (f.includeRevoked || !e.revoked),
    );
  }
  conflictOfInterest(expert: string, author: string, opts?: { householdOf?: (u: string) => string | null }): ConflictCheck {
    const reasons: string[] = [];
    const d = bfs(this.related, expert, author, 3);
    let hard = d !== null;
    if (d !== null) reasons.push(`yazarla ${d} adımlık yakınlık bağı`);
    const h1 = opts?.householdOf?.(expert) ?? null;
    const h2 = opts?.householdOf?.(author) ?? null;
    if (h1 && h1 === h2) {
      hard = true;
      reasons.push("aynı hane");
    }
    const fd = bfs(this.follows, expert, author, 2);
    return { hard, soft: fd === 1 ? 1 : fd === 2 ? 0.5 : 0, distance: d ?? fd, reasons };
  }
}

/** Sahte YZ: "hukuka aykırı" → legal_qualification, "alan dışı" → out_of_domain. */
export class FakeAi {
  calls: string[] = [];
  fail = false;
  async lintExpertReport(text: string) {
    this.calls.push(text);
    if (this.fail) throw new Error("YZ kapalı");
    const issues: { quote: string; kind: string; message: string }[] = [];
    if (text.includes("hukuka aykırı")) issues.push({ quote: "hukuka aykırı", kind: "legal_qualification", message: "Hukuki nitelendirme bilirkişinin görevi değildir." });
    if (text.includes("alan dışı")) issues.push({ quote: "alan dışı", kind: "out_of_domain", message: "Uzmanlık alanı dışına çıkılmış." });
    return { issues, offline: true, model: "offline-heuristic" };
  }
}

export const LONG_BODY =
  "Önerilen hat düzenlemesi mevcut araç filosu ve sürücü sayısıyla teknik olarak uygulanabilir görünmektedir; ek maliyet sınırlıdır.";

export function makeWorld() {
  const ctx = makeCtx();
  const ledger = new FakeLedger(ctx.clock);
  const graph = new FakeGraph();
  const notifier = new MemoryNotifier();
  const audit = createAuditLogger(ctx);
  const households = new Map<string, string>();
  const ai = new FakeAi();
  const svc = createExpertService(ctx, {
    ledger,
    graph: graph as unknown as GraphService,
    math: fakeMath,
    ai: ai as unknown as AiService,
    notifier,
    audit,
    ontology: fakeOntology,
    householdOf: (id) => households.get(id) ?? null,
  });
  const admin = insertUser(ctx.db, { id: "admin-0", nickname: "Yönetici", roles: ["member", "admin"] });
  let seq = 0;
  const w = {
    ctx,
    db: ctx.db,
    clock: ctx.clock,
    ledger,
    graph,
    notifier,
    audit,
    households,
    ai,
    svc,
    admin,
    user(id: string, nickname = id, status: "verified" | "pending" = "verified"): string {
      return insertUser(ctx.db, { id, nickname, status });
    },
    /** Kullanıcı oluşturur, başvurtur ve onaylatır; isteğe bağlı itibarı doğrudan ayarlar. */
    expert(id: string, domains: string[], reputation?: number): string {
      w.user(id);
      svc.apply(id, domains, "Alanında deneyimli uzman");
      svc.decideApplication(admin, id, "approve");
      if (reputation !== undefined) ctx.db.run("UPDATE experts SET reputation = ? WHERE user_id = ?", reputation, id);
      return id;
    },
    proposal(id: string, authorId: string, categories: string[] = []): string {
      const now = ctx.clock.now();
      ctx.db.run(
        "INSERT INTO proposals(id, seq, kind, title, body, author_id, categories, created_at, updated_at) VALUES (?, ?, 'topic', ?, ?, ?, ?, ?, ?)",
        id,
        ++seq,
        `Öneri ${id}`,
        "Öneri metni",
        authorId,
        JSON.stringify(categories),
        now,
        now,
      );
      return id;
    },
    /** Sahte defterde n adet boş blok üretir (tohum bloğu seçmek için). */
    blocks(n: number): void {
      for (let i = 0; i < n; i++) ledger.submit("GRAPH_RUN", { dummy: ledger.txs.length + 1 });
    },
    draw(proposalId: string, authorId: string, categories: string[], extra: { k?: number; counter?: boolean; seedBlock?: { height: number; hash: string } } = {}) {
      return svc.drawPanel(proposalId, { categories, authorId, k: extra.k ?? 3, dueAt: ctx.clock.now() + 7 * 86_400_000, counter: extra.counter, seedBlock: extra.seedBlock });
    },
    drawTxs() {
      return ledger.txs.filter((t) => t.type === "EXPERT_DRAW");
    },
  };
  return w;
}

export type World = ReturnType<typeof makeWorld>;

export function catchErr(fn: () => unknown): { status: number; code: string; message: string } {
  try {
    fn();
  } catch (e) {
    return e as { status: number; code: string; message: string };
  }
  throw new Error("Hata bekleniyordu");
}

export async function catchAsync(p: Promise<unknown>): Promise<{ status: number; code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return e as { status: number; code: string; message: string };
  }
  throw new Error("Hata bekleniyordu");
}
