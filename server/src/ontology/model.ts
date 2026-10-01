// Yürürlükteki yönetmeliğin (T-kutusu + A-kutusu) okunmuş, sorgulanabilir modeli.
import { FY_NS, type ArticleInfo, type ProtectionLevel, type Tier } from "@forum/shared";
import {
  RDF_TYPE,
  RDFS_COMMENT,
  RDFS_LABEL,
  RDFS_SUBCLASS,
  Store,
  fyN,
  localName,
  namedNode,
  termBool,
  termNumber,
  termValue,
  type Quad,
  type Term,
} from "./rdf";

export type ParamKind = "ratio" | "hours" | "count" | "bool" | "link";

export interface ParamDef {
  iri: string;
  local: string;
  label: string;
  symbol: string | null;
  kind: ParamKind;
}

export interface CategoryInfo {
  iri: string;
  label: string;
  parent: string | null; // fy:Kategori ise null (kök)
  keywords: string[];
  requiresExpert: boolean; // açık bayrak
}

export interface ArticleRecord extends ArticleInfo {
  order: number;
}

export interface HolderInfo {
  iri: string;
  label: string;
  kind: "tier" | "set" | "rule";
  article: string | null;
  params: Map<string, number | boolean | string>; // yerel ad → değer
  // yalnız kurallar
  appliesTo: string[];
  minTier: string | null;
  overrides: string[];
  // yalnız katmanlar
  tierCode: Tier | null;
  tierOrder: number | null;
}

export interface GroundRecord {
  iri: string;
  label: string;
  description: string;
  urgent: boolean;
  sealed: boolean;
  invalid: boolean;
  article: string | null;
}

export interface RightRecord {
  iri: string;
  label: string;
  description: string;
  coreImmutable: boolean;
  keywords: string[];
  article: string | null;
}

/** Katman parametresi olarak kurallarla birleştirilen parametreler (en koruyucu kazanır). */
export const TIER_PARAMS = [
  "yeterSayi",
  "esik",
  "esikKesin",
  "kumeTabani",
  "yazarKumesiTabani",
  "asmaEsigi",
  "yenidenOyEsigi",
  "sureDestek",
  "sureTartisma",
  "sureOylama",
  "sureUzatma",
  "sureItiraz",
  "sureUzlasma",
  "bilirkisiGerekli",
] as const;

export const DURATION_PARAMS = ["sureDestek", "sureTartisma", "sureOylama", "sureUzatma", "sureItiraz", "sureUzlasma"] as const;

/** Kural taşıyıcılarında IRI değerli bağlantı "parametreleri" */
export const LINK_PARAMS = ["dayanak", "uygulanirSinif", "asgariKatman", "overrides"] as const;

const FY_KATEGORI = FY_NS + "Kategori";

function str(t: Term | null | undefined): string {
  return t ? t.value : "";
}

function trCompare(a: string, b: string): number {
  return a.localeCompare(b, "tr");
}

export class BylawModel {
  readonly store: Store;
  readonly categories = new Map<string, CategoryInfo>();
  readonly children = new Map<string, string[]>();
  readonly articles = new Map<string, ArticleRecord>();
  readonly holders = new Map<string, HolderInfo>();
  readonly paramDefs = new Map<string, ParamDef>();
  readonly rights = new Map<string, RightRecord>();
  readonly deletionGrounds = new Map<string, GroundRecord>();
  readonly objectionGrounds = new Map<string, GroundRecord>();
  readonly contentLabels = new Map<string, { iri: string; label: string }>();
  readonly classes = new Set<string>(); // T-kutusundaki sınıflar + kategoriler
  readonly subjects = new Set<string>(); // A-kutusunda özne olarak geçen IRI'ler
  private ancestorCache = new Map<string, string[]>();

  constructor(
    readonly tboxQuads: Quad[],
    readonly aboxQuads: Quad[],
  ) {
    this.store = new Store([...tboxQuads, ...aboxQuads]);
    for (const q of aboxQuads) if (q.subject.termType === "NamedNode") this.subjects.add(q.subject.value);
    this.readParamDefs();
    this.readClasses();
    this.readCategories();
    this.readArticles();
    this.readHolders();
    this.readRights();
    this.readGrounds();
  }

  private label(iri: string | Term): string {
    const s = typeof iri === "string" ? namedNode(iri) : iri;
    return str(this.store.getObjects(s, RDFS_LABEL, null)[0]);
  }

  private comment(iri: string): string {
    return str(this.store.getObjects(namedNode(iri), RDFS_COMMENT, null)[0]);
  }

  private typed(cls: string): string[] {
    return this.store
      .getSubjects(RDF_TYPE, fyN(cls), null)
      .filter((t) => t.termType === "NamedNode")
      .map((t) => t.value);
  }

  private readParamDefs(): void {
    const kinds: Record<string, ParamKind> = {
      OranTuru: "ratio",
      SaatTuru: "hours",
      SayiTuru: "count",
      MantiksalTuru: "bool",
    };
    for (const iri of this.typed("Parametre")) {
      const kindT = this.store.getObjects(namedNode(iri), fyN("parametreTuru"), null)[0];
      const kind = kinds[localName(str(kindT))] ?? "ratio";
      const sym = this.store.getObjects(namedNode(iri), fyN("sembol"), null)[0];
      const local = localName(iri);
      this.paramDefs.set(local, { iri, local, label: this.label(iri) || local, symbol: sym ? sym.value : null, kind });
    }
    const linkLabels: Record<string, string> = {
      dayanak: "Dayanak madde",
      uygulanirSinif: "Uygulandığı sınıf",
      asgariKatman: "Asgari katman",
      overrides: "Önceliklendirdiği hüküm (overrides)",
    };
    for (const l of LINK_PARAMS) this.paramDefs.set(l, { iri: FY_NS + l, local: l, label: linkLabels[l], symbol: null, kind: "link" });
  }

  private readClasses(): void {
    for (const t of this.store.getSubjects(RDF_TYPE, namedNode("http://www.w3.org/2002/07/owl#Class"), null)) this.classes.add(t.value);
  }

  private readCategories(): void {
    // Kategori: rdfs:subClassOf* fy:Kategori olan her sınıf (A-kutusunda)
    const parentOf = new Map<string, string>();
    for (const q of this.store.getQuads(null, RDFS_SUBCLASS, null, null)) {
      if (q.subject.termType === "NamedNode" && q.object.termType === "NamedNode") parentOf.set(q.subject.value, q.object.value);
    }
    const isCategory = (iri: string, seen = new Set<string>()): boolean => {
      const p = parentOf.get(iri);
      if (!p || seen.has(iri)) return false;
      if (p === FY_KATEGORI) return true;
      seen.add(iri);
      return isCategory(p, seen);
    };
    for (const iri of parentOf.keys()) {
      if (!isCategory(iri)) continue;
      const parent = parentOf.get(iri)!;
      const kw = this.store
        .getObjects(namedNode(iri), fyN("anahtarKelime"), null)
        .map((t) => t.value)
        .sort(trCompare);
      const rq = termBool(this.store.getObjects(namedNode(iri), fyN("bilirkisiGerekli"), null)[0]) === true;
      this.categories.set(iri, { iri, label: this.label(iri) || localName(iri), parent: parent === FY_KATEGORI ? null : parent, keywords: kw, requiresExpert: rq });
      this.classes.add(iri);
    }
    for (const c of this.categories.values()) {
      const key = c.parent ?? "";
      const arr = this.children.get(key) ?? [];
      arr.push(c.iri);
      this.children.set(key, arr);
    }
    for (const [k, arr] of this.children) {
      arr.sort((a, b) => trCompare(this.categories.get(a)!.label, this.categories.get(b)!.label));
      this.children.set(k, arr);
    }
  }

  private readArticles(): void {
    for (const iri of this.typed("Madde")) {
      const s = namedNode(iri);
      const prot = localName(str(this.store.getObjects(s, fyN("korumaDuzeyi"), null)[0])) as ProtectionLevel;
      const partT = this.store.getObjects(s, fyN("bolum"), null)[0];
      const order = termNumber(this.store.getObjects(s, fyN("sira"), null)[0]) ?? 999999;
      this.articles.set(iri, {
        iri,
        number: str(this.store.getObjects(s, fyN("maddeNo"), null)[0]),
        title: str(this.store.getObjects(s, fyN("baslik"), null)[0]),
        text: str(this.store.getObjects(s, fyN("metin"), null)[0]),
        protection: prot === "Degistirilemez" || prot === "Nitelikli" ? prot : "Olagan",
        part: partT ? this.label(partT) || undefined : undefined,
        order,
      });
    }
  }

  private readHolders(): void {
    const add = (iri: string, kind: HolderInfo["kind"]) => {
      if (this.holders.has(iri)) return;
      const s = namedNode(iri);
      const params = new Map<string, number | boolean | string>();
      for (const def of this.paramDefs.values()) {
        if (def.kind === "link") continue;
        const t = this.store.getObjects(s, namedNode(def.iri), null)[0];
        if (t) params.set(def.local, termValue(t));
      }
      const codeT = this.store.getObjects(s, fyN("katmanKodu"), null)[0];
      this.holders.set(iri, {
        iri,
        label: this.label(iri) || localName(iri),
        kind,
        article: str(this.store.getObjects(s, fyN("dayanak"), null)[0]) || null,
        params,
        appliesTo: this.store.getObjects(s, fyN("uygulanirSinif"), null).map((t) => t.value),
        minTier: str(this.store.getObjects(s, fyN("asgariKatman"), null)[0]) || null,
        overrides: this.store.getObjects(s, fyN("overrides"), null).map((t) => t.value),
        tierCode: codeT ? (codeT.value as Tier) : null,
        tierOrder: termNumber(this.store.getObjects(s, fyN("katmanSirasi"), null)[0]),
      });
    };
    for (const iri of this.typed("Katman")) add(iri, "tier");
    for (const iri of this.typed("ParametreKumesi")) add(iri, "set");
    for (const iri of this.typed("Kural")) add(iri, "rule");
  }

  private readRights(): void {
    for (const iri of this.typed("TemelHak")) {
      const s = namedNode(iri);
      this.rights.set(iri, {
        iri,
        label: this.label(iri),
        description: this.comment(iri),
        coreImmutable: termBool(this.store.getObjects(s, fyN("cekirdekDegistirilemez"), null)[0]) === true,
        keywords: this.store.getObjects(s, fyN("anahtarKelime"), null).map((t) => t.value),
        article: str(this.store.getObjects(s, fyN("dayanak"), null)[0]) || null,
      });
    }
  }

  private readGrounds(): void {
    const rec = (iri: string): GroundRecord => {
      const s = namedNode(iri);
      return {
        iri,
        label: this.label(iri),
        description: this.comment(iri),
        urgent: termBool(this.store.getObjects(s, fyN("acil"), null)[0]) === true,
        sealed: termBool(this.store.getObjects(s, fyN("muhurlu"), null)[0]) === true,
        invalid: this.store.countQuads(s, RDF_TYPE, fyN("GecersizGerekce"), null) > 0,
        article: str(this.store.getObjects(s, fyN("dayanak"), null)[0]) || null,
      };
    };
    for (const iri of this.typed("SilmeGerekcesi")) this.deletionGrounds.set(iri, rec(iri));
    for (const iri of this.typed("ItirazGerekcesi")) this.objectionGrounds.set(iri, rec(iri));
    for (const iri of this.typed("IcerikEtiketi")) {
      const name = str(this.store.getObjects(namedNode(iri), fyN("icerikEtiketiAdi"), null)[0]);
      this.contentLabels.set(iri, { iri, label: name || this.label(iri) });
    }
  }

  // ───────────── Sorgular ─────────────

  isCategory(iri: string): boolean {
    return this.categories.has(iri);
  }

  /** Kendisi + üstleri (en özelden genele). Bilinmeyen IRI için [iri]. */
  ancestors(iri: string): string[] {
    const cached = this.ancestorCache.get(iri);
    if (cached) return cached;
    const out: string[] = [iri];
    let cur = this.categories.get(iri)?.parent ?? null;
    const seen = new Set<string>([iri]);
    while (cur && !seen.has(cur)) {
      out.push(cur);
      seen.add(cur);
      cur = this.categories.get(cur)?.parent ?? null;
    }
    this.ancestorCache.set(iri, out);
    return out;
  }

  depth(iri: string): number {
    return this.categories.has(iri) ? this.ancestors(iri).length - 1 : 0;
  }

  /** Kategori ya da üstlerinden biri bilirkişi gerektiriyor mu (miras)? */
  effectiveRequiresExpert(iri: string): boolean {
    return this.ancestors(iri).some((a) => this.categories.get(a)?.requiresExpert === true);
  }

  articleLabel(iri: string | null | undefined): string | undefined {
    if (!iri) return undefined;
    return this.articles.get(iri)?.number || undefined;
  }

  articleProtection(iri: string | null | undefined): ProtectionLevel | null {
    if (!iri) return null;
    return this.articles.get(iri)?.protection ?? null;
  }

  /** Değiştirilemez maddeye dayanan (ya da kendisi değiştirilemez olan) hüküm mü? */
  isImmutable(iri: string): boolean {
    if (this.articles.get(iri)?.protection === "Degistirilemez") return true;
    const h = this.holders.get(iri);
    return !!h && this.articleProtection(h.article) === "Degistirilemez";
  }

  tierHolder(code: Tier): HolderInfo | null {
    for (const h of this.holders.values()) if (h.kind === "tier" && h.tierCode === code) return h;
    return null;
  }

  tierByIri(iri: string | null): HolderInfo | null {
    if (!iri) return null;
    const h = this.holders.get(iri);
    return h && h.kind === "tier" ? h : null;
  }

  /** Belirli bir parametreyi taşıyan ilk parametre kümesinin değeri (ör. koruma sınırları). */
  setParam(local: string): number | boolean | string | null {
    for (const h of this.holders.values()) if (h.kind === "set" && h.params.has(local)) return h.params.get(local)!;
    return null;
  }

  generalParams(): HolderInfo | null {
    return this.holders.get(FY_NS + "GenelParametreler") ?? null;
  }

  sortedArticles(): ArticleRecord[] {
    return [...this.articles.values()].sort((a, b) => a.order - b.order || (a.iri < b.iri ? -1 : 1));
  }
}
