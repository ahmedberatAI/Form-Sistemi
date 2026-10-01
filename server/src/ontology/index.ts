// OntologyService: Forum Yönetmeliği ontolojisi (T-kutusu, sürümlenen A-kutusu, SHACL şekilleri, N3 kuralları).
// Kullanmadan önce `await svc.init()` çağrılmalıdır.
import {
  FY_NS,
  TIER_LABELS,
  compactIri,
  expandIri,
  type ArticleInfo,
  type AuditReport,
  type BylawVersionInfo,
  type CategoryNode,
  type GroundInfo,
  type RegulationPatch,
  type RightInfo,
  type Tier,
} from "@forum/shared";
import type { CoreContext, OntologyService, ProposalAuditInput } from "../core/contracts";
import { conflict, notFound, unprocessable } from "../core/errors";
import type { Db } from "../db";
import { patchedAbox, runAudit, type AuditEnv } from "./audit";
import { BylawModel, TIER_PARAMS, type GroundRecord } from "./model";
import { hashQuads, parseN3, parseTurtle, readOntologyFile, writeTurtle, type Quad } from "./rdf";
import { RuleEngine } from "./reasoner";
import { ShaclChecker } from "./shacl";

export const ONTOLOGY_FILES = {
  tbox: "fy-schema.ttl",
  abox: "yonetmelik.ttl",
  shapes: "yonetmelik-sekiller.ttl",
  rules: "yonetmelik-kurallar.n3",
} as const;

const TIER_ORDER: Tier[] = ["T0", "T1", "T2", "T3", "DEL"];

interface VersionRow {
  version: number;
  ttl: string;
  hash: string;
  via_proposal_id: string | null;
  ledger_tx: string | null;
  created_at: number;
}

interface LoadedVersion {
  version: number;
  hash: string;
  model: BylawModel;
  baseQuads: Quad[];
}

/** Ek alanlı gerekçe bilgisi (GroundInfo'nun üst kümesi). */
export interface GroundInfoExt extends GroundInfo {
  sealed?: boolean;
  invalid?: boolean;
  article?: string;
}

function toInfo(r: Omit<VersionRow, "ttl">): BylawVersionInfo {
  return { version: r.version, hash: r.hash, createdAt: r.created_at, viaProposalId: r.via_proposal_id, ledgerTx: r.ledger_tx };
}

/** BYLAW_VERSION defter kaydı yapıldıktan sonra işlem özetini sürüme bağlar. */
export function recordBylawLedgerTx(db: Db, version: number, txHash: string): void {
  db.run("UPDATE bylaw_versions SET ledger_tx = ? WHERE version = ?", txHash, version);
}

class OntologyServiceImpl implements OntologyService {
  private tbox: Quad[] = [];
  private engine!: RuleEngine;
  private shacl!: ShaclChecker;
  private loaded: LoadedVersion | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly ctx: CoreContext) {}

  init(): Promise<void> {
    this.initPromise ??= this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const dir = this.ctx.config.ontologyDir;
    this.tbox = parseTurtle(readOntologyFile(dir, ONTOLOGY_FILES.tbox));
    this.shacl = new ShaclChecker(parseTurtle(readOntologyFile(dir, ONTOLOGY_FILES.shapes)));
    this.engine = new RuleEngine(parseN3(readOntologyFile(dir, ONTOLOGY_FILES.rules)));
    let row = this.latestRow();
    if (!row) {
      const ttl = readOntologyFile(dir, ONTOLOGY_FILES.abox);
      const hash = hashQuads(parseTurtle(ttl));
      this.ctx.db.run(
        "INSERT OR IGNORE INTO bylaw_versions(version, ttl, hash, via_proposal_id, ledger_tx, created_at) VALUES (1, ?, ?, NULL, NULL, ?)",
        ttl,
        hash,
        this.ctx.clock.now(),
      );
      row = this.latestRow()!;
    }
    this.load(row);
    // Yürürlükteki yönetmelik meta-şekillere uymalıdır (elle düzenlenen TTL'e karşı erken uyarı).
    const issues = (await this.shacl.validate([...this.tbox, ...this.state.model.aboxQuads], "yonetmelik")).filter((f) => f.severity === "violation");
    if (issues.length) throw new Error(`Yönetmelik ontolojisi meta-şekillere aykırı: ${issues.map((f) => `${f.message} [${f.focus}]`).join(" ")}`);
  }

  private latestRow(): VersionRow | undefined {
    return this.ctx.db.get<VersionRow>("SELECT * FROM bylaw_versions ORDER BY version DESC LIMIT 1");
  }

  private load(row: VersionRow): void {
    const abox = parseTurtle(row.ttl);
    const model = new BylawModel(this.tbox, abox);
    const baseQuads = this.engine.run([...this.tbox, ...abox]).getQuads(null, null, null, null);
    this.loaded = { version: row.version, hash: row.hash, model, baseQuads };
  }

  private get state(): LoadedVersion {
    if (!this.loaded) throw new Error("OntologyService.init() çağrılmadan kullanıldı");
    return this.loaded;
  }

  private get model(): BylawModel {
    return this.state.model;
  }

  private env(): AuditEnv {
    const s = this.state;
    return { model: s.model, engine: this.engine, shacl: this.shacl, baseQuads: s.baseQuads, version: s.version, hash: s.hash, now: this.ctx.clock.now() };
  }

  // ───────────── Sürümler ─────────────

  current(): BylawVersionInfo {
    const v = this.state.version;
    const row = this.ctx.db.get<Omit<VersionRow, "ttl">>(
      "SELECT version, hash, via_proposal_id, ledger_tx, created_at FROM bylaw_versions WHERE version = ?",
      v,
    );
    if (!row) throw notFound("Yönetmelik sürümü");
    return toInfo(row);
  }

  versions(): BylawVersionInfo[] {
    return this.ctx.db
      .all<Omit<VersionRow, "ttl">>("SELECT version, hash, via_proposal_id, ledger_tx, created_at FROM bylaw_versions ORDER BY version ASC")
      .map(toInfo);
  }

  /** Sözleşme dışı yardımcı: BYLAW_VERSION defter kaydının özetini sürüme bağlar. */
  setLedgerTx(version: number, txHash: string): void {
    recordBylawLedgerTx(this.ctx.db, version, txHash);
  }

  exportTurtle(version?: number): string {
    const v = version ?? this.state.version;
    const row = this.ctx.db.get<{ ttl: string }>("SELECT ttl FROM bylaw_versions WHERE version = ?", v);
    if (!row) throw notFound("Yönetmelik sürümü");
    return row.ttl;
  }

  // ───────────── Kategoriler ─────────────

  categories(): CategoryNode[] {
    const m = this.model;
    const build = (iri: string): CategoryNode => {
      const c = m.categories.get(iri)!;
      return {
        iri,
        label: c.label,
        parent: c.parent,
        children: (m.children.get(iri) ?? []).map(build),
        requiresExpert: m.effectiveRequiresExpert(iri),
        keywords: c.keywords.slice(),
      };
    };
    return (m.children.get("") ?? []).map(build);
  }

  categoryLabel(iri: string): string {
    if (iri === "*") return "Tüm kategoriler (genel)";
    const full = expandIri(iri);
    return this.model.categories.get(full)?.label ?? compactIri(full);
  }

  ancestors(iri: string): string[] {
    if (iri === "*") return ["*"];
    return this.model.ancestors(expandIri(iri)).slice();
  }

  isSubCategoryOf(a: string, b: string): boolean {
    if (b === "*") return true;
    const fa = expandIri(a);
    const fb = expandIri(b);
    if (fa === fb) return true;
    if (fb === FY_NS + "Kategori") return this.model.isCategory(fa);
    return this.model.ancestors(fa).includes(fb);
  }

  depth(iri: string): number {
    if (iri === "*") return 0;
    return this.model.depth(expandIri(iri));
  }

  keywordIndex(): { iri: string; keywords: string[] }[] {
    const out: { iri: string; keywords: string[] }[] = [];
    const walk = (nodes: CategoryNode[]) => {
      for (const n of nodes) {
        out.push({ iri: n.iri, keywords: n.keywords });
        walk(n.children);
      }
    };
    walk(this.categories());
    return out;
  }

  // ───────────── Haklar, maddeler, gerekçeler ─────────────

  rights(): RightInfo[] {
    return [...this.model.rights.values()]
      .sort((a, b) => a.label.localeCompare(b.label, "tr"))
      .map((r) => {
        const info: RightInfo = { iri: r.iri, label: r.label, description: r.description };
        if (r.article) info.article = r.article;
        return info;
      });
  }

  articles(): ArticleInfo[] {
    return this.model.sortedArticles().map((a) => {
      const info: ArticleInfo = { iri: a.iri, number: a.number, title: a.title, text: a.text, protection: a.protection };
      if (a.part) info.part = a.part;
      return info;
    });
  }

  private groundInfo(g: GroundRecord): GroundInfoExt {
    const art = this.model.articleLabel(g.article);
    const description = g.invalid ? `GEÇERSİZ GEREKÇE${art ? ` (${art}, değiştirilemez hüküm)` : ""}: ${g.description}` : g.description;
    const info: GroundInfoExt = { iri: g.iri, label: g.label, description };
    if (g.urgent) info.urgent = true;
    if (g.sealed) info.sealed = true;
    if (g.invalid) info.invalid = true;
    if (g.article) info.article = g.article;
    return info;
  }

  deletionGrounds(): GroundInfo[] {
    return [...this.model.deletionGrounds.values()]
      .sort((a, b) => Number(a.invalid) - Number(b.invalid) || Number(b.urgent) - Number(a.urgent) || a.label.localeCompare(b.label, "tr"))
      .map((g) => this.groundInfo(g));
  }

  objectionGrounds(): GroundInfo[] {
    return [...this.model.objectionGrounds.values()].sort((a, b) => a.label.localeCompare(b.label, "tr")).map((g) => this.groundInfo(g));
  }

  contentLabels(): { iri: string; label: string }[] {
    return [...this.model.contentLabels.values()].sort((a, b) => a.label.localeCompare(b.label, "tr")).map((c) => ({ ...c }));
  }

  // ───────────── Parametreler ve katmanlar ─────────────

  adjustableParams(): { rule: string; param: string; label: string; value: number | boolean | string; immutable: boolean }[] {
    const m = this.model;
    const holders = [...m.holders.values()];
    const rank = (h: (typeof holders)[number]): number => {
      if (h.kind === "tier") return TIER_ORDER.indexOf(h.tierCode ?? "T0");
      if (h.iri === FY_NS + "GenelParametreler") return 20;
      if (h.kind === "set") return 30;
      return 40;
    };
    holders.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (m.articles.get(a.article ?? "")?.order ?? 0) - (m.articles.get(b.article ?? "")?.order ?? 0) ||
        (a.iri < b.iri ? -1 : 1),
    );
    const paramOrder = [...TIER_PARAMS, ...[...m.paramDefs.keys()].filter((k) => !(TIER_PARAMS as readonly string[]).includes(k))];
    const out: { rule: string; param: string; label: string; value: number | boolean | string; immutable: boolean }[] = [];
    for (const h of holders) {
      const immutable = m.isImmutable(h.iri);
      for (const p of paramOrder) {
        if (!h.params.has(p)) continue;
        const def = m.paramDefs.get(p);
        const name = def ? `${def.label}${def.symbol ? ` (${def.symbol})` : ""}` : p;
        out.push({ rule: h.iri, param: p, label: `${h.label} · ${name}`, value: h.params.get(p)!, immutable });
      }
    }
    return out;
  }

  tiers(): { tier: Tier; label: string; quorum: number; threshold: number; clusterFloor: number }[] {
    const out: { tier: Tier; label: string; quorum: number; threshold: number; clusterFloor: number }[] = [];
    for (const t of TIER_ORDER) {
      const h = this.model.tierHolder(t);
      if (!h) continue;
      const n = (k: string) => (typeof h.params.get(k) === "number" ? (h.params.get(k) as number) : 0);
      out.push({ tier: t, label: h.label || TIER_LABELS[t], quorum: n("yeterSayi"), threshold: n("esik"), clusterFloor: n("kumeTabani") });
    }
    return out;
  }

  // ───────────── Denetim ─────────────

  audit(input: ProposalAuditInput): Promise<AuditReport> {
    return runAudit(this.env(), input);
  }

  private verifiedMembers(): number {
    const r = this.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE status = 'verified'");
    return Number(r?.n ?? 0);
  }

  validatePatch(patch: RegulationPatch): Promise<AuditReport> {
    const body = String(patch?.rationale ?? "").trim() || "Yönetmelik değişikliği yaması";
    return runAudit(this.env(), {
      kind: "regulation",
      title: "Yönetmelik yaması",
      body,
      categories: [],
      regulationPatch: patch,
      verifiedMembers: this.verifiedMembers(),
    });
  }

  async applyPatch(patch: RegulationPatch, proposalId: string): Promise<BylawVersionInfo> {
    const report = await this.validatePatch(patch);
    if (!report.admissible) {
      const detail = report.violations.map((v) => v.message).join(" ");
      throw unprocessable("bylaw_patch_invalid", `Yönetmelik yaması uygulanamaz. ${detail}`.trim(), { tier: report.tier, violations: report.violations });
    }
    const s = this.state;
    const quads = patchedAbox(s.model, patch);
    const version = s.version + 1;
    const header = `# Forum Yönetmeliği — A-kutusu, sürüm ${version} (öneri ${proposalId}). Önceki sürüm: ${s.version} (${s.hash}).`;
    const ttl = writeTurtle(quads, header);
    const hash = hashQuads(quads);
    const now = this.ctx.clock.now();
    this.ctx.db.tx(() => {
      const latest = this.ctx.db.get<{ v: number | null }>("SELECT MAX(version) AS v FROM bylaw_versions");
      if ((latest?.v ?? 0) !== s.version) throw conflict("bylaw_version_conflict", "Yönetmelik bu sırada başka bir yamayla değişti; yamayı yeniden denetleyin.");
      this.ctx.db.run(
        "INSERT INTO bylaw_versions(version, ttl, hash, via_proposal_id, ledger_tx, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
        version,
        ttl,
        hash,
        proposalId,
        now,
      );
    });
    this.load({ version, ttl, hash, via_proposal_id: proposalId, ledger_tx: null, created_at: now });
    return { version, hash, createdAt: now, viaProposalId: proposalId, ledgerTx: null };
  }
}

export function createOntologyService(ctx: CoreContext): OntologyService {
  return new OntologyServiceImpl(ctx);
}

export type { ProposalAuditInput };
