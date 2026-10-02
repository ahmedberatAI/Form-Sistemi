// Yönetmelik yaması: işlemlerin A-kutusuna uygulanması ve meta-kurallar
// (aralıklar, koruma tabanları, kalıcılaştırma sınırları, döngüsüz overrides, değiştirilemez çekirdeğin değişmezliği).
import { FY_NS, expandIri, type Finding, type RegulationPatch } from "@forum/shared";
import { BylawModel, DURATION_PARAMS, TIER_PARAMS, type HolderInfo, type ParamDef, type ParamKind } from "./model";
import { art, fmtNum, makeFinding } from "./findings";
import { isNewTermIri, isSafeIri } from "./iri";
import {
  RDF_TYPE,
  RDFS_LABEL,
  RDFS_SUBCLASS,
  Store,
  booleanLiteral,
  decimalLiteral,
  fyN,
  integerLiteral,
  literal,
  localName,
  namedNode,
  quad,
  quadToNt,
  type NamedNode,
  type Quad,
  type Term,
} from "./rdf";
import type { ShaclChecker } from "./shacl";

const FY_KATEGORI = FY_NS + "Kategori";
const VOTABLE_TIER_CODES = new Set(["T0", "T1", "T2"]);
const PROTECTION_LEVELS = ["Degistirilemez", "Nitelikli", "Olagan"];
const IRI_INVALID = "geçerli bir http(s) IRI'si değil (boşluk ile < > \" { } | ^ ` \\ karakterleri içeremez).";

export interface PatchApplication {
  aboxQuads: Quad[];
  opQuads: Quad[];
  findings: Finding[];
}

function resolveParam(model: BylawModel, param: string): ParamDef | null {
  const p = (param ?? "").trim();
  if (!p) return null;
  const full = expandIri(p);
  const local = full.startsWith(FY_NS) ? full.slice(FY_NS.length) : full;
  return model.paramDefs.get(local) ?? null;
}

function articleOrder(num: string, fallback: number): number {
  const m = /^Madde (\d+)(?: \((\d+)\))?/.exec(num);
  if (!m) return fallback;
  return Number(m[1]) * 100 + (m[2] ? Number(m[2]) : 0);
}

/** Yamanın işlemlerini yürürlükteki A-kutusunun bir kopyasına uygular. */
export function applyPatchOps(model: BylawModel, patch: RegulationPatch, proposalIri: string): PatchApplication {
  const st = new Store(model.aboxQuads);
  const opQuads: Quad[] = [];
  const findings: Finding[] = [];
  const created = new Set<string>(); // bu yamada oluşturulan IRI'ler
  const createdRules = new Set<string>();
  const createdCategories = new Set<string>();
  const p = namedNode(proposalIri);
  const ops = Array.isArray(patch?.ops) ? patch.ops : [];
  const A23_1 = art("Madde_23_1");

  const exists = (iri: string) => model.subjects.has(iri) || model.classes.has(iri) || created.has(iri);
  const isArticle = (iri: string) => st.countQuads(namedNode(iri), RDF_TYPE, fyN("Madde"), null) > 0;
  const replace = (s: NamedNode, pred: NamedNode, o: Term | null) => {
    st.removeQuads(st.getQuads(s, pred, null, null));
    if (o) st.addQuad(quad(s, pred, o as never));
  };

  ops.forEach((op, i) => {
    const node = namedNode(`${proposalIri}/islem/${i + 1}`);
    opQuads.push(quad(p, fyN("yamaIslemi"), node), quad(node, RDF_TYPE, fyN("YamaIslemi")), quad(node, fyN("islemTuru"), literal(String(op?.op ?? ""))));
    const bad = (code: string, text: string, article = A23_1, focus?: string) =>
      findings.push(makeFinding(model, "violation", code, article, `${i + 1}. işlem: ${text}`, focus));

    switch (op?.op) {
      case "setParam": {
        const holderIri = expandIri(String(op.rule ?? "").trim());
        const def = resolveParam(model, String(op.param ?? ""));
        if (!holderIri) return bad("patch_invalid_target", "parametresi değiştirilecek kural belirtilmedi.");
        if (!isSafeIri(holderIri)) return bad("patch_iri_invalid", `"${op.rule}" ${IRI_INVALID}`);
        const target = namedNode(holderIri);
        opQuads.push(quad(node, fyN("hedef"), target));
        if (!def) return bad("patch_unknown_param", `bilinmeyen parametre "${op.param}".`);
        opQuads.push(quad(node, fyN("param"), namedNode(def.iri)));

        const holder: HolderInfo | undefined = model.holders.get(holderIri);
        let kind: "tier" | "set" | "rule" | "article" | "new";
        if (holder) kind = holder.kind;
        else if (createdRules.has(holderIri)) kind = "rule";
        else if (isArticle(holderIri)) kind = "article";
        else if (exists(holderIri)) return bad("patch_invalid_target", `${localName(holderIri)} parametre taşıyan bir kural değil.`);
        else kind = "new";
        if (kind === "new" && !isNewTermIri(holderIri))
          return bad("patch_iri_invalid", `yeni kuralın IRI'si yönetmelik ad alanında (fy:) ve yalnız harf, rakam, "_" ya da "-" içeren bir adla olmalıdır.`);

        const allowed =
          kind === "article"
            ? def.local === "overrides"
            : kind === "tier"
              ? (TIER_PARAMS as readonly string[]).includes(def.local) && def.kind !== "link"
              : kind === "set"
                ? !!holder?.params.has(def.local)
                : (TIER_PARAMS as readonly string[]).includes(def.local) || def.kind === "link" || !!holder?.params.has(def.local);
        const immutableHolder = model.isImmutable(holderIri);
        if (!allowed && !immutableHolder) return bad("patch_param_not_applicable", `"${def.label}" parametresi ${localName(holderIri)} üzerinde ayarlanamaz.`);

        // Değeri tipine göre terime çevir
        let value: Term | null = null;
        const v = op.value;
        const asNum = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
        switch (def.kind) {
          case "ratio":
            if (asNum === null) return bad("patch_value_type", `"${def.label}" için sayısal bir değer gerekir.`);
            value = decimalLiteral(asNum);
            break;
          case "hours":
          case "count":
            if (asNum === null || !Number.isInteger(asNum)) return bad("patch_value_type", `"${def.label}" için tamsayı bir değer gerekir.`);
            value = integerLiteral(asNum);
            break;
          case "bool":
            if (typeof v === "boolean") value = booleanLiteral(v);
            else if (v === "true" || v === "false") value = booleanLiteral(v === "true");
            else return bad("patch_value_type", `"${def.label}" için doğru/yanlış değeri gerekir.`);
            break;
          case "link": {
            if (typeof v !== "string") return bad("patch_value_type", `"${def.label}" için bir IRI gerekir.`);
            const iri = expandIri(v.trim());
            if (iri) {
              if (!isSafeIri(iri)) return bad("patch_iri_invalid", `"${v}" ${IRI_INVALID}`);
              value = namedNode(iri);
              if (def.local === "uygulanirSinif" && !model.classes.has(iri) && !createdCategories.has(iri))
                return bad("patch_invalid_class", `"${v}" tanımlı bir öneri sınıfı ya da kategori değil.`, art("Madde_11_2"));
              if (def.local === "asgariKatman") {
                const t = model.tierByIri(iri);
                if (!t) return bad("patch_invalid_tier", `"${v}" tanımlı bir katman değil.`, art("Madde_9_1"));
                if (t.tierCode !== "T3" && !VOTABLE_TIER_CODES.has(t.tierCode ?? ""))
                  return bad("patch_invalid_tier", `bir kural yalnızca T0, T1 ya da T2 katmanına bağlanabilir.`, art("Madde_9_1"));
              }
            }
            break;
          }
        }
        if (value) opQuads.push(quad(node, fyN("yeniDeger"), value as never));

        if (kind === "new") {
          st.addQuad(quad(target, RDF_TYPE, fyN("Kural")));
          createdRules.add(holderIri);
          created.add(holderIri);
        }
        if (def.local === "overrides" && value) {
          st.removeQuads(st.getQuads(target, fyN("overrides"), null, null));
          st.addQuad(quad(target, fyN("overrides"), value as never));
        } else {
          replace(target, namedNode(def.iri), value);
        }
        return;
      }

      case "addCategory": {
        const iri = expandIri(String(op.iri ?? "").trim());
        const parent = expandIri(String(op.parent ?? "").trim());
        if (isSafeIri(iri)) opQuads.push(quad(node, fyN("hedef"), namedNode(iri)));
        if (isSafeIri(parent)) opQuads.push(quad(node, fyN("ustSinif"), namedNode(parent)));
        if (!iri) return bad("patch_category_iri", "yeni kategorinin IRI'si belirtilmedi.", art("Madde_8_1"));
        if (!isNewTermIri(iri))
          return bad("patch_iri_invalid", `yeni kategorinin IRI'si yönetmelik ad alanında (fy:) ve yalnız harf, rakam, "_" ya da "-" içeren bir adla olmalıdır.`, art("Madde_8_1"));
        if (parent && !isSafeIri(parent)) return bad("patch_iri_invalid", `üst kategori "${op.parent}" ${IRI_INVALID}`, art("Madde_8_1"));
        if (exists(iri)) return bad("patch_category_exists", `${localName(iri)} zaten tanımlı.`, art("Madde_8_1"));
        if (parent !== FY_KATEGORI && !model.isCategory(parent) && !createdCategories.has(parent))
          return bad("patch_category_parent", `üst kategori "${op.parent}" tanımlı değil.`, art("Madde_8_1"));
        const label = String(op.label ?? "").trim();
        if (!label) return bad("patch_category_label", "yeni kategorinin adı boş olamaz.", art("Madde_8_1"));
        const s = namedNode(iri);
        st.addQuad(quad(s, RDFS_SUBCLASS, namedNode(parent)));
        st.addQuad(quad(s, RDFS_LABEL, literal(label)));
        for (const k of Array.isArray(op.keywords) ? op.keywords : []) {
          const kw = String(k).trim().toLocaleLowerCase("tr-TR");
          if (kw) st.addQuad(quad(s, fyN("anahtarKelime"), literal(kw)));
        }
        if (op.requiresExpert) st.addQuad(quad(s, fyN("bilirkisiGerekli"), booleanLiteral(true)));
        created.add(iri);
        createdCategories.add(iri);
        return;
      }

      case "amendArticleText": {
        const iri = expandIri(String(op.article ?? "").trim());
        if (iri && !isSafeIri(iri)) return bad("patch_iri_invalid", `"${op.article}" ${IRI_INVALID}`);
        if (iri) opQuads.push(quad(node, fyN("hedef"), namedNode(iri)));
        if (!iri || !isArticle(iri)) return bad("patch_article_missing", `"${op.article}" maddesi bulunamadı.`);
        replace(namedNode(iri), fyN("metin"), literal(String(op.text ?? "")));
        return;
      }

      case "addArticle": {
        const iri = expandIri(String(op.iri ?? "").trim());
        const protection = String(op.protection ?? "Olagan");
        if (isSafeIri(iri)) opQuads.push(quad(node, fyN("hedef"), namedNode(iri)));
        if (PROTECTION_LEVELS.includes(protection)) opQuads.push(quad(node, fyN("yeniKoruma"), fyN(protection)));
        if (!iri) return bad("patch_article_iri", "yeni maddenin IRI'si belirtilmedi.");
        if (!isNewTermIri(iri))
          return bad("patch_iri_invalid", `yeni maddenin IRI'si yönetmelik ad alanında (fy:) ve yalnız harf, rakam, "_" ya da "-" içeren bir adla olmalıdır.`);
        if (exists(iri)) return bad("patch_article_exists", `${localName(iri)} zaten tanımlı.`);
        const number = String(op.number ?? "").trim();
        if (st.getSubjects(fyN("maddeNo"), literal(number), null).length > 0)
          return bad("patch_article_number_taken", `"${number}" numaralı bir madde zaten var.`);
        if (!PROTECTION_LEVELS.includes(protection))
          return bad("patch_invalid_protection", `"${protection}" geçerli bir koruma düzeyi değil.`, art("Madde_6_1"));
        const s = namedNode(iri);
        st.addQuad(quad(s, RDF_TYPE, fyN("Madde")));
        st.addQuad(quad(s, fyN("maddeNo"), literal(number)));
        st.addQuad(quad(s, fyN("baslik"), literal(String(op.title ?? "").trim())));
        st.addQuad(quad(s, fyN("metin"), literal(String(op.text ?? ""))));
        st.addQuad(quad(s, fyN("korumaDuzeyi"), fyN(protection)));
        st.addQuad(quad(s, fyN("sira"), integerLiteral(articleOrder(number, 9000 + i))));
        created.add(iri);
        return;
      }

      case "setProtection": {
        const iri = expandIri(String(op.article ?? "").trim());
        const protection = String(op.protection ?? "");
        if (iri && !isSafeIri(iri)) return bad("patch_iri_invalid", `"${op.article}" ${IRI_INVALID}`);
        if (iri) opQuads.push(quad(node, fyN("hedef"), namedNode(iri)));
        if (PROTECTION_LEVELS.includes(protection)) opQuads.push(quad(node, fyN("yeniKoruma"), fyN(protection)));
        if (!iri || !isArticle(iri)) return bad("patch_article_missing", `"${op.article}" maddesi bulunamadı.`);
        if (!PROTECTION_LEVELS.includes(protection))
          return bad("patch_invalid_protection", `"${protection}" geçerli bir koruma düzeyi değil.`, art("Madde_6_1"));
        replace(namedNode(iri), fyN("korumaDuzeyi"), fyN(protection));
        return;
      }

      default:
        return bad("patch_unknown_op", `bilinmeyen yama işlemi "${String((op as { op?: unknown })?.op ?? "")}".`);
    }
  });

  return { aboxQuads: st.getQuads(null, null, null, null), opQuads, findings };
}

interface Limit {
  limit: string;
  param: string;
  kind: "min" | "max";
  article: string;
  code: string;
  scope: "tiers" | "all" | "votableTiers";
  /**
   * Sınır üçlüsü yürürlükteki sürümde yoksa (sınırdan önce kurulmuş eski bir veritabanı) uygulanan değer. Koruma
   * taşıyıcısı değiştirilemez olduğu için eksik sınır yamayla eklenemez; kod en koruyucu varsayılanı uygular.
   */
  fallback?: number;
}

const LIMITS: Limit[] = [
  { limit: "kumeTabaniAsgari", param: "kumeTabani", kind: "min", article: "Madde_5_1", code: "protection_floor", scope: "tiers" },
  { limit: "yazarKumesiTabaniAsgari", param: "yazarKumesiTabani", kind: "min", article: "Madde_5_1", code: "protection_floor", scope: "tiers" },
  { limit: "anlamliKumePayiAzami", param: "anlamliKumePayi", kind: "max", article: "Madde_5_1", code: "protection_floor", scope: "all" },
  { limit: "anlamliKumeAsgariUyeAzami", param: "anlamliKumeAsgariUye", kind: "max", article: "Madde_5_1", code: "protection_floor", scope: "all" },
  { limit: "kopruIcinAsgariKumelenmisAzami", param: "kopruIcinAsgariKumelenmis", kind: "max", article: "Madde_5_1", code: "protection_floor", scope: "all" },
  // μ_votes üst sınırı: aksi halde her küme uzatmadan sonra "nötr" sayılır ve köprü testi dolaylı olarak kapanır.
  { limit: "kumeBasinaAsgariOyAzami", param: "kumeBasinaAsgariOy", kind: "max", article: "Madde_5_1", code: "protection_floor", scope: "all", fallback: 3 },
  // Süre tabanları: tartışma/oylama/uzatma (her katman) ve uzlaşma (T0–T2) sıfırlanarak azınlık raporu, uzatma ve
  // köprü taslakları için süre ortadan kaldırılamaz.
  { limit: "sureTartismaAsgari", param: "sureTartisma", kind: "min", article: "Madde_5_1", code: "protection_floor", scope: "tiers", fallback: 24 },
  { limit: "sureOylamaAsgari", param: "sureOylama", kind: "min", article: "Madde_5_1", code: "protection_floor", scope: "tiers", fallback: 24 },
  { limit: "sureUzatmaAsgari", param: "sureUzatma", kind: "min", article: "Madde_5_1", code: "protection_floor", scope: "tiers", fallback: 24 },
  { limit: "sureUzlasmaAsgari", param: "sureUzlasma", kind: "min", article: "Madde_5_2", code: "protection_floor", scope: "votableTiers", fallback: 24 },
  { limit: "asmaEsigiAsgari", param: "asmaEsigi", kind: "min", article: "Madde_5_2", code: "protection_floor", scope: "tiers" },
  { limit: "sureItirazAsgari", param: "sureItiraz", kind: "min", article: "Madde_5_3", code: "protection_floor", scope: "votableTiers" },
  { limit: "yeterSayiAzami", param: "yeterSayi", kind: "max", article: "Madde_6_2", code: "entrenchment_cap", scope: "all" },
  { limit: "esikAzami", param: "esik", kind: "max", article: "Madde_6_2", code: "entrenchment_cap", scope: "all" },
  { limit: "asmaEsigiAzami", param: "asmaEsigi", kind: "max", article: "Madde_6_2", code: "entrenchment_cap", scope: "all" },
  { limit: "yenidenOyEsigiAzami", param: "yenidenOyEsigi", kind: "max", article: "Madde_6_2", code: "entrenchment_cap", scope: "all" },
  ...DURATION_PARAMS.map((d): Limit => ({ limit: "sureAzami", param: d, kind: "max", article: "Madde_6_2", code: "entrenchment_cap", scope: "all" })),
  { limit: "vekaletSiniriOraniAzami", param: "vekaletSiniriOrani", kind: "max", article: "Madde_3_2", code: "equal_vote_limit", scope: "all" },
  { limit: "vekaletAzamiAdimAzami", param: "vekaletAzamiAdim", kind: "max", article: "Madde_3_2", code: "equal_vote_limit", scope: "all" },
];

/** Bir sayının madde metinlerinde geçebileceği yazımlar: tamsayı (saat/sayı) ya da Türkçe ondalık, kesir, yüzde (oran). */
function numberForms(v: number, kind: ParamKind | undefined): string[] {
  if (kind !== "ratio") return Number.isInteger(v) ? [String(v)] : [v.toFixed(2).replace(".", ",")];
  const forms = new Set<string>([v.toFixed(2).replace(".", ","), String(Math.round(v * 10000) / 10000).replace(".", ",")]);
  for (const [n, d] of [[1, 2], [1, 3], [2, 3], [1, 4], [3, 4]] as const) if (Math.abs(v - n / d) < 5e-4) forms.add(`${n}/${d}`);
  const pct = v * 100;
  if (Math.abs(pct - Math.round(pct)) < 1e-6) forms.add(`%${Math.round(pct)}`);
  return [...forms].filter((f) => f !== "0" && f !== "1");
}

/** Metin, sayıyı yazımlarından biriyle (başka bir sayının parçası olmadan) anıyor mu? */
function mentionsNumber(text: string, v: number, kind: ParamKind | undefined): boolean {
  return numberForms(v, kind).some((f) => new RegExp(`(?<![\\d.,/])${f.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![\\d]|[.,/]\\d)`).test(text));
}

function holderName(h: HolderInfo): string {
  if (h.kind === "tier") return `${h.tierCode} katmanı (${h.label})`;
  if (h.kind === "rule") return `“${h.label}” kuralı`;
  return h.label;
}

function subjectLines(quads: Quad[], iri: string): string {
  return quads
    .filter((q) => q.subject.value === iri)
    .map(quadToNt)
    .sort()
    .join("\n");
}

/**
 * Yamalı yönetmeliği denetler: SHACL meta-şekilleri, koruma tabanları ve kalıcılaştırma sınırları,
 * overrides döngüsü/hedefi ve değiştirilemez çekirdeğin değişmezliği (iki adımlı atlatmalar dahil).
 */
export async function checkPatchedBylaw(current: BylawModel, patchedAbox: Quad[], shacl: ShaclChecker): Promise<Finding[]> {
  const out: Finding[] = [];
  const patched = new BylawModel(current.tboxQuads, patchedAbox);

  // 1. Meta-şekiller (yönetmeliğin kendisi)
  for (const sf of await shacl.validate([...current.tboxQuads, ...patchedAbox], "yonetmelik")) {
    const label = patched.articleLabel(sf.article) ?? current.articleLabel(sf.article);
    out.push({
      severity: sf.severity,
      code: sf.code,
      message: sf.message,
      article: sf.article ?? undefined,
      articleLabel: label,
      focus: sf.focus ? sf.focus.replace(FY_NS, "fy:") : undefined,
    });
  }

  // 2. Koruma tabanları ve kalıcılaştırma sınırları (değerleri değiştirilemez taşıyıcılardan okunur)
  for (const lim of LIMITS) {
    const declared = current.setParam(lim.limit);
    const bound = typeof declared === "number" ? declared : lim.fallback;
    if (typeof bound !== "number") continue;
    for (const h of patched.holders.values()) {
      if (lim.scope !== "all" && h.kind !== "tier") continue;
      if (lim.scope === "votableTiers" && !VOTABLE_TIER_CODES.has(h.tierCode ?? "")) continue;
      const v = h.params.get(lim.param);
      if (typeof v !== "number") continue;
      const okay = lim.kind === "min" ? v >= bound - 1e-9 : v <= bound + 1e-9;
      if (okay) continue;
      const def = current.paramDefs.get(lim.param);
      const what = def?.symbol ? `${def.label} (${def.symbol})` : def?.label ?? lim.param;
      const rel = lim.kind === "min" ? `${fmtNum(bound)} değerinin altına indirilemez` : `${fmtNum(bound)} değerinin üzerine çıkarılamaz`;
      const why =
        lim.code === "entrenchment_cap"
          ? " (kalıcılaştırma yasağı)"
          : lim.code === "equal_vote_limit"
            ? " (eşit oy ilkesi)"
            : " (azınlık koruması)";
      out.push(makeFinding(current, "violation", lim.code, art(lim.article), `${what} ${rel}${why}; ${holderName(h)} için önerilen değer ${fmtNum(v)}.`, h.iri));
    }
  }

  // 2b. Madde metni ↔ parametre tutarlılığı (Madde 23 (1)): değeri değişen sayısal parametreyi metninde anan dayanak
  //     madde aynı yamada yeni değere göre güncellenmelidir; aksi halde yönetmelik kendi içinde çelişir (ör. Madde 24 (4)
  //     "en az 96 saat" derken sağlık kuralının oylama süresi 72 saat olur). Değiştirilemez taşıyıcılar zaten T3'tür.
  for (const h of patched.holders.values()) {
    const before = current.holders.get(h.iri);
    if (!before || current.isImmutable(h.iri)) continue;
    const article = h.article ? patched.articles.get(h.article) : undefined;
    if (!article) continue;
    for (const [k, v] of h.params) {
      const old = before.params.get(k);
      if (typeof v !== "number" || typeof old !== "number" || Math.abs(v - old) < 1e-9) continue;
      const def = current.paramDefs.get(k);
      if (!mentionsNumber(article.text, old, def?.kind) || mentionsNumber(article.text, v, def?.kind)) continue;
      const what = def?.symbol ? `${def.label} (${def.symbol})` : def?.label ?? k;
      out.push(
        makeFinding(
          current,
          "violation",
          "article_text_stale",
          art("Madde_23_1"),
          `${article.number || localName(article.iri)} metni, ${holderName(h)} için ${what} değerini hâlâ ${fmtNum(old)} olarak anıyor; önerilen değer ${fmtNum(v)}. Aynı yamaya bu maddenin metnini yeni değere göre güncelleyen bir “Madde metnini değiştir” (amendArticleText) adımı ekleyin.`,
          article.iri,
        ),
      );
    }
  }

  // 3. overrides: hedef var mı, döngü var mı?
  const edges = new Map<string, string[]>();
  for (const q of patchedAbox) {
    if (q.predicate.value !== FY_NS + "overrides") continue;
    const arr = edges.get(q.subject.value) ?? [];
    arr.push(q.object.value);
    edges.set(q.subject.value, arr);
    const targetKnown = patched.holders.has(q.object.value) || patched.articles.has(q.object.value);
    if (!targetKnown)
      out.push(makeFinding(current, "violation", "overrides_target", art("Madde_6_3"), `Önceliklendirilen hüküm (${localName(q.object.value)}) Yönetmelikte tanımlı bir kural ya da madde değil.`, q.subject.value));
  }
  const color = new Map<string, number>();
  const cycles: string[][] = [];
  const dfs = (n: string, stack: string[]) => {
    color.set(n, 1);
    stack.push(n);
    for (const m of edges.get(n) ?? []) {
      const c = color.get(m) ?? 0;
      if (c === 1) cycles.push([...stack.slice(stack.indexOf(m)), m]);
      else if (c === 0) dfs(m, stack);
    }
    stack.pop();
    color.set(n, 2);
  };
  for (const n of [...edges.keys()].sort()) if (!color.get(n)) dfs(n, []);
  for (const c of cycles)
    out.push(makeFinding(current, "violation", "overrides_cycle", art("Madde_6_3"), `Önceliklendirme (overrides) ilişkileri döngü içeriyor: ${c.map(localName).join(" → ")}.`, c[0]));

  // 4. Değiştirilemez çekirdeğin değişmezliği (doğrudan ve iki adımlı atlatmalar)
  const currentAbox = current.aboxQuads;
  const immutableNow = new Set<string>();
  for (const a of current.articles.values()) if (a.protection === "Degistirilemez") immutableNow.add(a.iri);
  for (const h of current.holders.values()) if (current.isImmutable(h.iri)) immutableNow.add(h.iri);
  for (const iri of [...immutableNow].sort()) {
    if (subjectLines(currentAbox, iri) !== subjectLines(patchedAbox, iri))
      out.push(makeFinding(current, "violation", "immutable_target", art("Madde_6_1"), `Değiştirilemez hüküm ya da ona dayanan ${localName(iri)} değiştirilemez.`, iri));
  }
  for (const a of patched.articles.values()) {
    if (a.protection === "Degistirilemez" && !immutableNow.has(a.iri))
      out.push(makeFinding(current, "violation", "new_immutable", art("Madde_6_2"), `${a.number || localName(a.iri)} “Değiştirilemez” yapılamaz; yeni değiştirilemez hüküm üretilemez.`, a.iri));
  }
  for (const h of patched.holders.values()) {
    if (immutableNow.has(h.iri)) continue;
    if (patched.articleProtection(h.article) === "Degistirilemez" || current.articleProtection(h.article) === "Degistirilemez")
      out.push(makeFinding(current, "violation", "new_immutable", art("Madde_6_2"), `${h.label} değiştirilemez bir hükme dayandırılamaz.`, h.iri));
    if (h.kind === "rule" && h.minTier && patched.tierByIri(h.minTier)?.tierCode === "T3")
      out.push(makeFinding(current, "violation", "new_immutable", art("Madde_6_2"), `${h.label} bir öneri türünü değiştirilemez katmana (T3) bağlayamaz.`, h.iri));
  }
  const currentEdges = new Set(currentAbox.filter((q) => q.predicate.value === FY_NS + "overrides").map(quadToNt));
  for (const q of patchedAbox) {
    if (q.predicate.value !== FY_NS + "overrides" || currentEdges.has(quadToNt(q))) continue;
    if (immutableNow.has(q.object.value))
      out.push(makeFinding(current, "violation", "immutable_bypass", art("Madde_6_2"), `${localName(q.subject.value)}, değiştirilemez ${localName(q.object.value)} hükmünü önceliklendirme (overrides) yoluyla etkisizleştiremez.`, q.subject.value));
  }
  return out;
}
