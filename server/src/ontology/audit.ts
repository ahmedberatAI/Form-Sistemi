// Öneri denetimi: öneri alt grafı → N3 çıkarımı → SHACL → katman → "en koruyucu kazanır" parametre birleştirme.
import {
  FY_NS,
  expandIri,
  ratMax,
  sponsorsRequired,
  toRational,
  type AppliedRule,
  type AuditReport,
  type DecisionParams,
  type Finding,
  type ProposalKind,
  type Rational,
  type Tier,
} from "@forum/shared";
import type { ProposalAuditInput } from "../core/contracts";
import { DURATION_PARAMS, type BylawModel, type HolderInfo } from "./model";
import { T3_CODES, art, dedupFindings, fmtNum, makeFinding } from "./findings";
import { applyPatchOps, checkPatchedBylaw } from "./patch";
import {
  RDF_TYPE,
  Store,
  booleanLiteral,
  decimalLiteral,
  fyN,
  integerLiteral,
  literal,
  localName,
  namedNode,
  quad,
  type NamedNode,
  type Quad,
  type Term,
} from "./rdf";
import type { RuleEngine } from "./reasoner";
import type { ShaclChecker, ShaclFinding } from "./shacl";

export interface AuditEnv {
  model: BylawModel;
  engine: RuleEngine;
  shacl: ShaclChecker;
  /** Önceden çıkarımı yapılmış T-kutusu + A-kutusu üçlüleri (önbellek) */
  baseQuads: Quad[];
  version: number;
  hash: string;
  now: number;
}

const DATA_NS = "https://forumsistemi.org/veri/";

const KIND_CLASS: Record<ProposalKind, string> = {
  topic: "KonuOnerisi",
  subtopic: "AltKonuOnerisi",
  amendment: "DuzenlemeOnerisi",
  deletion: "SilmeOnerisi",
  regulation: "YonetmelikOnerisi",
};

const KIND_BASE_TIER: Record<ProposalKind, Tier> = {
  topic: "T0",
  subtopic: "T0",
  amendment: "T1",
  deletion: "DEL",
  regulation: "T2",
};

const TIER_RANK: Record<Tier, number> = { T0: 0, T1: 1, T2: 2, T3: 3, DEL: 10 };

const SOURCE_NODE: Record<string, string> = {
  author: "KaynakYazar",
  expert: "KaynakBilirkisi",
  ai: "KaynakYZ",
  member: "KaynakUye",
};

function ratGe(a: Rational, b: Rational): boolean {
  return a.num * b.den >= b.num * a.den;
}

function confidenceLevel(conf: number, high: number, mid: number): "YuksekGuven" | "OrtaGuven" | "DusukGuven" {
  const c = toRational(Math.min(1, Math.max(0, Number.isFinite(conf) ? conf : 0)));
  if (ratGe(c, toRational(high))) return "YuksekGuven";
  if (ratGe(c, toRational(mid))) return "OrtaGuven";
  return "DusukGuven";
}

interface ProposalGraph {
  node: NamedNode;
  quads: Quad[];
  findings: Finding[];
  explicitCategories: string[];
  rights: string[];
}

function buildProposalGraph(env: AuditEnv, input: ProposalAuditInput): ProposalGraph {
  const { model } = env;
  const pid = encodeURIComponent(input.id ?? "taslak");
  const pIri = `${DATA_NS}oneri/${pid}`;
  const p = namedNode(pIri);
  const qs: Quad[] = [];
  const findings: Finding[] = [];
  const add = (s: NamedNode, pred: NamedNode, o: Term) => qs.push(quad(s, pred, o as Quad["object"]));

  add(p, RDF_TYPE, fyN(KIND_CLASS[input.kind] ?? "Oneri"));
  add(p, RDF_TYPE, fyN("Oneri"));
  add(p, fyN("baslik"), literal(String(input.title ?? "").trim()));
  add(p, fyN("metin"), literal(String(input.body ?? "").trim()));
  add(p, fyN("dogrulanmisUyeSayisi"), integerLiteral(Math.max(0, input.verifiedMembers | 0)));
  if (input.requestExpert) add(p, fyN("bilirkisiTalebi"), booleanLiteral(true));

  // Kategoriler (yalnız tanımlı olanlar; bilinmeyenler uyarıyla yok sayılır)
  const explicit: string[] = [];
  for (const raw of input.categories ?? []) {
    const iri = expandIri(String(raw).trim());
    if (!iri) continue;
    if (!model.isCategory(iri)) {
      findings.push(makeFinding(model, "warning", "unknown_category", art("Madde_8_1"), `Tanımlı olmayan kategori yok sayıldı: ${localName(iri)}.`));
      continue;
    }
    if (!explicit.includes(iri)) explicit.push(iri);
    add(p, fyN("kategori"), namedNode(iri));
  }

  // Hak etkileri
  const rights: string[] = [];
  (input.rightsAffected ?? []).forEach((r, i) => {
    const iri = expandIri(String(r.right ?? "").trim());
    const right = model.rights.get(iri);
    if (!right) {
      findings.push(makeFinding(model, "warning", "unknown_right", art("Madde_4_2"), `Tanımlı olmayan temel hak yok sayıldı: ${localName(iri)}.`));
      return;
    }
    if (!rights.includes(iri)) rights.push(iri);
    const e = namedNode(`${pIri}/hak/${i + 1}`);
    add(p, fyN("hakEtkisi"), e);
    add(e, RDF_TYPE, fyN("HakEtkisi"));
    add(e, fyN("hak"), namedNode(iri));
    add(e, fyN("yon"), fyN(r.direction === "restrict" ? "Kisitlama" : "Genisletme"));
    add(e, fyN("kaynak"), fyN(SOURCE_NODE[r.source] ?? "KaynakUye"));
    if (r.direction === "restrict" && (r.source === "ai" || r.source === "member") && !right.coreImmutable) {
      findings.push(
        makeFinding(model, "info", "advisory_right_flag", art("Madde_14_2"), `${r.source === "ai" ? "Yapay zekâ" : "Bir üye"} "${right.label}" hakkının kısıtlanabileceğini işaretledi; danışma bayrağı öneriyi yalnızca nitelikli katmana (T1) yükseltir.`),
      );
    }
  });

  // İçerik etiketleri (güven düzeyi eşiklere göre burada atanır; N3 kuralları düzeyi kullanır)
  const ruleHolder = model.holders.get(FY_NS + "KuralIcerikEtiketi");
  const high = Number(ruleHolder?.params.get("yuksekGuvenEsigi") ?? 0.7);
  const mid = Number(ruleHolder?.params.get("ortaGuvenEsigi") ?? 0.4);
  (input.contentLabels ?? []).forEach((l, i) => {
    const iri = expandIri(String(l.label ?? "").trim());
    if (!model.contentLabels.has(iri)) {
      findings.push(makeFinding(model, "info", "unknown_content_label", art("Madde_12_1"), `Tanımlı olmayan içerik etiketi yok sayıldı: ${localName(iri)}.`));
      return;
    }
    const a = namedNode(`${pIri}/etiket/${i + 1}`);
    add(p, fyN("icerikEtiketAtamasi"), a);
    add(a, RDF_TYPE, fyN("IcerikEtiketiAtamasi"));
    add(a, fyN("etiket"), namedNode(iri));
    add(a, fyN("guven"), decimalLiteral(Math.round(Math.min(1, Math.max(0, Number(l.confidence) || 0)) * 10000) / 10000));
    add(a, fyN("guvenDuzeyi"), fyN(confidenceLevel(Number(l.confidence), high, mid)));
    // Kaynak: yalnız kural tabanlı tespit ve bilirkişi teyidi yüksek güvende ihlal doğurur; YZ etiketi danışmadır (K6).
    add(a, fyN("kaynak"), fyN(l.source === "rule" ? "KaynakKural" : l.source === "expert" ? "KaynakBilirkisi" : "KaynakYZ"));
  });

  // Üst konu (alt konu) / hedef konu (düzenleme)
  if (input.parentTopic && (input.kind === "subtopic" || input.kind === "amendment")) {
    const t = namedNode(`${DATA_NS}konu/${encodeURIComponent(input.parentTopic.id)}`);
    add(t, RDF_TYPE, fyN("KonuKaydi"));
    add(t, fyN("durum"), literal(String(input.parentTopic.status ?? "")));
    for (const raw of input.parentTopic.categories ?? []) {
      const iri = expandIri(String(raw).trim());
      if (model.isCategory(iri)) add(t, fyN("konuKategorisi"), namedNode(iri));
    }
    add(p, fyN(input.kind === "subtopic" ? "ustKonu" : "hedefKonu"), t);
  }

  if (input.kind === "amendment" && input.amendment) {
    add(p, fyN("tabanSurum"), integerLiteral(input.amendment.baseVersion));
    add(p, fyN("guncelSurum"), integerLiteral(input.amendment.currentVersion));
  }

  if (input.kind === "deletion" && input.deletion) {
    const g = expandIri(String(input.deletion.ground ?? "").trim());
    if (g) add(p, fyN("silmeGerekcesi"), namedNode(g));
    add(p, fyN("hedefMesajSayisi"), integerLiteral(Math.max(0, input.deletion.messageCount | 0)));
  }

  return { node: p, quads: qs, findings, explicitCategories: explicit, rights };
}

const ENRICH_CODES = new Set([...T3_CODES, "advisory_core_right_flag", "content_label_high", "content_label_ai_high", "content_label_medium", "deletion_ground_invalid"]);

/** SHACL bulgusunu, ilgili değerlerin adlarıyla zenginleştirerek Finding'e çevirir. */
function toFinding(env: AuditEnv, store: Store, sf: ShaclFinding, proposalIri: string): Finding {
  const { model } = env;
  let message = sf.message;
  const describe = (iri: string): string => {
    const a = model.articles.get(iri);
    if (a) return a.number;
    const h = model.holders.get(iri);
    if (h) return h.label;
    const c = model.contentLabels.get(iri);
    if (c) return c.label;
    const r = model.rights.get(iri) ?? model.deletionGrounds.get(iri);
    if (r) return r.label;
    const hedef = store.getObjects(namedNode(iri), fyN("hedef"), null)[0];
    if (hedef) return describe(hedef.value);
    return localName(iri);
  };
  if (sf.code === "version_conflict") {
    const p = namedNode(sf.focus);
    const base = store.getObjects(p, fyN("tabanSurum"), null)[0]?.value;
    const cur = store.getObjects(p, fyN("guncelSurum"), null)[0]?.value;
    if (base && cur) message += ` (taban sürüm: ${base}, güncel sürüm: ${cur})`;
  } else if (sf.path && sf.focus === proposalIri && ENRICH_CODES.has(sf.code)) {
    const vals = store.getObjects(namedNode(sf.focus), namedNode(sf.path), null).map((t) => describe(t.value));
    const uniq = [...new Set(vals)];
    if (uniq.length) message += ` İlgili: ${uniq.join(", ")}.`;
  }
  const f: Finding = { severity: sf.severity, code: sf.code, message };
  if (sf.article) {
    f.article = sf.article;
    const label = model.articleLabel(sf.article);
    if (label) f.articleLabel = label;
  }
  if (sf.focus && sf.focus !== proposalIri) f.focus = sf.focus.startsWith(FY_NS) ? "fy:" + sf.focus.slice(FY_NS.length) : sf.focus;
  return f;
}

function mergeParams(
  env: AuditEnv,
  tier: Tier,
  rules: HolderInfo[],
  requiresExpert: boolean,
  expertDomains: string[],
  verifiedMembers: number,
): DecisionParams | null {
  const { model } = env;
  const base = model.tierHolder(tier);
  if (!base || tier === "T3") return null;
  const num = (h: HolderInfo, k: string): number | null => {
    const v = h.params.get(k);
    return typeof v === "number" ? v : null;
  };
  const ratParam = (k: string, fallback: number): Rational => {
    let r = toRational(num(base, k) ?? fallback);
    for (const h of rules) {
      const v = num(h, k);
      if (v !== null) r = ratMax(r, toRational(v));
    }
    return r;
  };
  let strict = base.params.get("esikKesin") === true;
  let expert = requiresExpert || base.params.get("bilirkisiGerekli") === true;
  for (const h of rules) {
    if (h.params.get("esikKesin") === true) strict = true;
    if (h.params.get("bilirkisiGerekli") === true) expert = true;
  }
  const dur = (k: (typeof DURATION_PARAMS)[number]): number => {
    let v = num(base, k) ?? 0;
    for (const h of rules) {
      const x = num(h, k);
      if (x !== null && x > v) v = x;
    }
    return v;
  };
  const g = model.generalParams();
  const gnum = (k: string, fallback: number): number => (g ? num(g, k) : null) ?? fallback;
  return {
    tier,
    quorum: ratParam("yeterSayi", 0.2),
    threshold: ratParam("esik", 0.5),
    thresholdStrict: strict,
    clusterFloor: ratParam("kumeTabani", 0.3),
    authorClusterFloor: tier === "DEL" ? ratParam("yazarKumesiTabani", 0.5) : null,
    overrideThreshold: ratParam("asmaEsigi", 2 / 3),
    revoteThreshold: ratParam("yenidenOyEsigi", 0.6),
    significantShare: toRational(gnum("anlamliKumePayi", 0.1)),
    significantMinMembers: gnum("anlamliKumeAsgariUye", 3),
    minVotesPerCluster: gnum("kumeBasinaAsgariOy", 2),
    minClusteredForBridge: gnum("kopruIcinAsgariKumelenmis", 12),
    coldStartBump: toRational(gnum("sogukBaslangicArtisi", 0.1)),
    delegationCapFraction: toRational(gnum("vekaletSiniriOrani", 0.05)),
    delegationMaxHops: gnum("vekaletAzamiAdim", 3),
    sponsorsRequired: sponsorsRequired(verifiedMembers, tier),
    requiresExpert: expert,
    expertCount: gnum("bilirkisiSayisi", 3),
    expertDomains: expert ? expertDomains : [],
    durationsHours: {
      sponsoring: dur("sureDestek"),
      deliberation: dur("sureTartisma"),
      voting: dur("sureOylama"),
      extension: dur("sureUzatma"),
      objection: dur("sureItiraz"),
      reconciliation: dur("sureUzlasma"),
    },
  };
}

export async function runAudit(env: AuditEnv, input: ProposalAuditInput): Promise<AuditReport> {
  const { model } = env;
  const graph = buildProposalGraph(env, input);
  const pIri = graph.node.value;
  const extra: Finding[] = [...graph.findings];

  // Yönetmelik yaması: işlem düğümleri öneri alt grafına eklenir; yamalı yönetmelik ayrıca meta-denetlenir
  let patchFindings: Finding[] = [];
  if (input.kind === "regulation" && input.regulationPatch) {
    const applied = applyPatchOps(model, input.regulationPatch, pIri);
    graph.quads.push(...applied.opQuads);
    patchFindings = [...applied.findings, ...(await checkPatchedBylaw(model, applied.aboxQuads, env.shacl))];
  }

  // N3 çıkarımı + SHACL (birleştirilmiş veri kümesi)
  const store = env.engine.run([...env.baseQuads, ...graph.quads]);
  const shaclRaw = await env.shacl.validate(store.getQuads(null, null, null, null), "oneri");
  const shaclFindings = shaclRaw.map((sf) => toFinding(env, store, sf, pIri));

  // TS meta bulguları: N3/SHACL aynı kodu zaten raporladıysa tekrar etme
  const shaclCodes = new Set(shaclFindings.filter((f) => f.severity === "violation").map((f) => f.code));
  const all = dedupFindings([...shaclFindings, ...extra, ...patchFindings.filter((f) => !(T3_CODES.has(f.code) && shaclCodes.has(f.code)))]);

  // Çıkarılan sınıflar ve kategoriler
  const p = graph.node;
  const types = store.getObjects(p, RDF_TYPE, null).map((t) => t.value);
  const inferredClasses = [...new Set(types)].sort();
  const categories = [...new Set(store.getObjects(p, fyN("kategori"), null).map((t) => t.value).filter((c) => model.isCategory(c)))].sort(
    (a, b) => model.depth(b) - model.depth(a) || model.categories.get(a)!.label.localeCompare(model.categories.get(b)!.label, "tr"),
  );
  const inherited = store.getObjects(p, fyN("mirasKategori"), null).map((t) => t.value).filter((c) => model.isCategory(c));

  // Uygulanan kurallar ve "overrides" ile devre dışı kalanlar (değiştirilemez hükme dayananlar asla devre dışı kalmaz)
  const appliedIris = [...new Set(store.getObjects(p, fyN("uygulananKural"), null).map((t) => t.value))].filter((r) => model.holders.get(r)?.kind === "rule");
  const suppressed = new Set<string>();
  for (const r of appliedIris) {
    for (const target of model.holders.get(r)!.overrides) {
      for (const r2 of appliedIris) {
        if (r2 === r || model.isImmutable(r2)) continue;
        if (r2 === target || model.holders.get(r2)!.article === target) suppressed.add(r2);
      }
    }
  }
  const activeRules = appliedIris.filter((r) => !suppressed.has(r)).map((r) => model.holders.get(r)!);
  activeRules.sort((a, b) => (model.articles.get(a.article ?? "")?.order ?? 0) - (model.articles.get(b.article ?? "")?.order ?? 0) || (a.iri < b.iri ? -1 : 1));

  // Katman
  let tier: Tier = KIND_BASE_TIER[input.kind] ?? "T0";
  let tierRule: HolderInfo | null = null;
  if (input.kind !== "deletion") {
    for (const r of activeRules) {
      const t = model.tierByIri(r.minTier)?.tierCode;
      if (!t || t === "DEL") continue;
      if (TIER_RANK[t] > TIER_RANK[tier] || (TIER_RANK[t] === TIER_RANK[tier] && !tierRule)) {
        tier = t;
        tierRule = r;
      }
    }
    if (all.some((f) => f.severity === "violation" && T3_CODES.has(f.code))) tier = "T3";
  } else {
    tierRule = activeRules.find((r) => model.tierByIri(r.minTier)?.tierCode === "DEL") ?? null;
  }

  // Bilirkişi: yazar talebi, orta güvenli ya da YZ kaynaklı yüksek güvenli içerik etiketi veya bilirkişi gerektiren
  // (devre dışı kalmamış) bir kural
  const requiresExpertClass =
    !!input.requestExpert ||
    store.getObjects(p, fyN("ortaGuvenliEtiket"), null).length > 0 ||
    store.getObjects(p, fyN("danismaYuksekGuvenliEtiket"), null).length > 0;
  const explicit = [...new Set([...graph.explicitCategories, ...inherited])];
  let expertDomains = explicit.filter((c) => model.effectiveRequiresExpert(c));
  if (expertDomains.length === 0) expertDomains = explicit.length ? explicit : categories;
  expertDomains = [...new Set(expertDomains)].sort((a, b) => model.depth(b) - model.depth(a) || (a < b ? -1 : 1));

  const params = mergeParams(env, tier, activeRules, requiresExpertClass, expertDomains, input.verifiedMembers);
  const requiresExpert = params ? params.requiresExpert : requiresExpertClass || activeRules.some((r) => r.params.get("bilirkisiGerekli") === true);

  // Bilgilendirmeler
  const infos: Finding[] = [];
  const tierLabel = model.tierHolder(tier)?.label ?? tier;
  if (tierRule && tier !== "T3") {
    infos.push(makeFinding(model, "info", "tier", tierRule.article, `Katman ${tier} (${tierLabel}): ${tierRule.label}.`));
  } else if (tier === "T3") {
    infos.push(makeFinding(model, "info", "tier", art("Madde_6_1"), `Katman T3 (${tierLabel}): öneri değiştirilemez bir hükme aykırıdır ve oylanamaz.`));
  }
  if (inherited.length) {
    infos.push(makeFinding(model, "info", "inherited_categories", art("Madde_10_1"), `Üst konudan miras alınan kategoriler: ${inherited.map((c) => model.categories.get(c)!.label).join(", ")}.`));
  }
  if (requiresExpert) {
    const names = expertDomains.map((c) => model.categories.get(c)?.label ?? localName(c));
    infos.push(makeFinding(model, "info", "expert_required", art("Madde_13_1"), `Bilirkişi incelemesi gerekli${names.length ? ` (alan: ${names.join(", ")})` : ""}.`));
  }
  if (types.includes(FY_NS + "AcilSilmeTalebi")) {
    infos.push(makeFinding(model, "info", "deletion_urgent", art("Madde_20_3"), "Acil gerekçe: hedef mesajlar karar beklenirken daraltılır (gizlenmez)."));
  }
  if (types.includes(FY_NS + "MuhurluSilmeTalebi")) {
    infos.push(makeFinding(model, "info", "deletion_sealed", art("Madde_20_3"), "Kabul edilirse mesaj kişisel veri gerekçesiyle mühürlenir."));
  }
  if (types.includes(FY_NS + "NitelikliHukumDegisikligi") && params) {
    infos.push(makeFinding(model, "info", "qualified_change", art("Madde_23_1"), `Nitelikli hüküm değişikliği: onay eşiği ${fmtNum(params.threshold.num / params.threshold.den)}, yeter sayı ${fmtNum(params.quorum.num / params.quorum.den)}.`));
  }
  if (params && params.tier !== "T3") {
    infos.push(makeFinding(model, "info", "sponsors", art("Madde_9_3"), `Gerekli destekçi sayısı: ${params.sponsorsRequired}.`));
  }
  for (const r of suppressed) {
    const h = model.holders.get(r)!;
    infos.push(makeFinding(model, "info", "rule_overridden", art("Madde_6_3"), `${h.label} kuralı, öncelikli bir kural nedeniyle uygulanmadı.`, r));
  }

  const order = (f: Finding) => model.articles.get(f.article ?? "")?.order ?? 999999;
  const byArticle = (a: Finding, b: Finding) => order(a) - order(b) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  const violations = all.filter((f) => f.severity === "violation").sort(byArticle);
  const warnings = all.filter((f) => f.severity === "warning").sort(byArticle);
  const allInfos = dedupFindings([...all.filter((f) => f.severity === "info"), ...infos]);

  const appliedRules: AppliedRule[] = activeRules.map((r) => {
    const a: AppliedRule = { iri: r.iri, label: r.label };
    if (r.article) {
      a.article = r.article;
      const l = model.articleLabel(r.article);
      if (l) a.articleLabel = l;
    }
    return a;
  });

  return {
    admissible: violations.length === 0 && tier !== "T3",
    tier,
    params,
    categories,
    inferredClasses,
    rightsAffected: graph.rights,
    requiresExpert,
    violations,
    warnings,
    infos: allInfos,
    appliedRules,
    bylawVersion: env.version,
    bylawHash: env.hash,
    checkedAt: env.now,
  };
}

/** Bir yamanın yamalı A-kutusu (yalnız uygulama için; geçerlilik runAudit ile denetlenir). */
export function patchedAbox(model: BylawModel, patch: Parameters<typeof applyPatchOps>[1]): Quad[] {
  return applyPatchOps(model, patch, `${DATA_NS}oneri/yama`).aboxQuads;
}
