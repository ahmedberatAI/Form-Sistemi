// Yönetmelik değişikliği yaması oluşturucu: setParam, addCategory, amendArticleText, addArticle, setProtection.
// Değiştirilemez kurallar/maddeler kilitlidir. validatePatch ile canlı doğrulama (yan etkisiz).
import { useMemo } from "react";
import {
  expandIri,
  FY_NS,
  type ArticleInfo,
  type OntologyOverview,
  type ProtectionLevel,
  type RegulationPatch,
  type RegulationPatchOp,
} from "@forum/shared";
import { validatePatch } from "../../api/endpoints";
import { useOntology } from "../../lib/categories";
import { useDebounced } from "../../lib/hooks";
import { useAsync } from "../../lib/useAsync";
import { Badge, Button, Checkbox, DiffView, ErrorView, Input, Select, Spinner, Textarea, TierBadge, type SelectOption } from "../../ui";
import { FindingList } from "./PrecheckPanel";

export const PROTECTION_LABELS: Record<ProtectionLevel, string> = {
  Degistirilemez: "Değiştirilemez",
  Nitelikli: "Nitelikli",
  Olagan: "Olağan",
};

export type PatchOpKind = RegulationPatchOp["op"];

export const PATCH_OP_LABELS: Record<PatchOpKind, string> = {
  setParam: "Parametre değiştir",
  addCategory: "Kategori ekle",
  amendArticleText: "Madde metnini değiştir",
  addArticle: "Yeni madde ekle",
  setProtection: "Koruma düzeyini değiştir",
};

/** Formda tutulan düzenlenebilir işlem taslağı (tüm alanlar metin; yamaya draftToPatch ile çevrilir). */
export type PatchDraftOp =
  | { key: string; op: "setParam"; target: string; value: string }
  | { key: string; op: "addCategory"; iri: string; iriTouched: boolean; label: string; parent: string; keywords: string; requiresExpert: boolean }
  | { key: string; op: "amendArticleText"; article: string; text: string }
  | { key: string; op: "addArticle"; iri: string; iriTouched: boolean; number: string; title: string; text: string; protection: "Olagan" | "Nitelikli" }
  | { key: string; op: "setProtection"; article: string; protection: ProtectionLevel | "" };

type ParamInfo = OntologyOverview["params"][number];

let keySeq = 0;
const nextKey = () => `op${++keySeq}`;
const paramKey = (p: Pick<ParamInfo, "rule" | "param">) => `${p.rule}|${p.param}`;

const TR_MAP: Record<string, string> = { ç: "c", Ç: "C", ğ: "g", Ğ: "G", ı: "i", İ: "I", ö: "o", Ö: "O", ş: "s", Ş: "S", ü: "u", Ü: "U", â: "a", î: "i", û: "u" };
const ascii = (s: string) => s.replace(/[çÇğĞıİöÖşŞüÜâîû]/g, (c) => TR_MAP[c] ?? c);

/** "Gece pazarları" → "fy:GecePazarlari" */
export function categoryIriFromLabel(label: string): string {
  const words = ascii(label)
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "";
  const local = words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
  return "fy:" + (/^[0-9]/.test(local) ? "K" + local : local);
}

/** "Madde 24 (1)" → "fy:Madde_24_1" */
export function articleIriFromNumber(num: string): string {
  const local = ascii(num)
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return local ? "fy:" + (/^[0-9]/.test(local) ? "Madde_" + local : local) : "";
}

export function newDraftOp(kind: PatchOpKind): PatchDraftOp {
  const key = nextKey();
  switch (kind) {
    case "setParam":
      return { key, op: "setParam", target: "", value: "" };
    case "addCategory":
      return { key, op: "addCategory", iri: "", iriTouched: false, label: "", parent: "", keywords: "", requiresExpert: false };
    case "amendArticleText":
      return { key, op: "amendArticleText", article: "", text: "" };
    case "addArticle":
      return { key, op: "addArticle", iri: "", iriTouched: false, number: "", title: "", text: "", protection: "Olagan" };
    case "setProtection":
      return { key, op: "setProtection", article: "", protection: "" };
  }
}

/** Taslağı yamaya çevirir. Eksik işlemler yamaya alınmaz, `incomplete` listesinde (1'den başlayan sıra) döner. */
export function draftToPatch(drafts: PatchDraftOp[], rationale: string, params: ParamInfo[]): { patch: RegulationPatch; incomplete: number[] } {
  const ops: RegulationPatchOp[] = [];
  const incomplete: number[] = [];
  const byKey = new Map(params.map((p) => [paramKey(p), p]));
  drafts.forEach((d, i) => {
    let op: RegulationPatchOp | null = null;
    switch (d.op) {
      case "setParam": {
        const def = byKey.get(d.target);
        const raw = d.value.trim();
        if (!def || raw === "") break;
        let value: number | boolean | string = raw;
        if (typeof def.value === "number") {
          const n = Number(raw.replace(",", "."));
          if (!Number.isFinite(n)) break;
          value = n;
        } else if (typeof def.value === "boolean") value = raw === "true";
        op = { op: "setParam", rule: def.rule, param: def.param, value };
        break;
      }
      case "addCategory": {
        if (!d.iri.trim() || !d.label.trim() || !d.parent) break;
        const keywords = d.keywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);
        op = { op: "addCategory", iri: d.iri.trim(), label: d.label.trim(), parent: d.parent, keywords, requiresExpert: d.requiresExpert || undefined };
        break;
      }
      case "amendArticleText":
        if (!d.article || !d.text.trim()) break;
        op = { op: "amendArticleText", article: d.article, text: d.text };
        break;
      case "addArticle":
        if (!d.iri.trim() || !d.number.trim() || !d.title.trim() || !d.text.trim()) break;
        op = { op: "addArticle", iri: d.iri.trim(), number: d.number.trim(), title: d.title.trim(), text: d.text, protection: d.protection };
        break;
      case "setProtection":
        if (!d.article || !d.protection) break;
        op = { op: "setProtection", article: d.article, protection: d.protection };
        break;
    }
    if (op) ops.push(op);
    else incomplete.push(i + 1);
  });
  return { patch: { ops, rationale }, incomplete };
}

function fmtValue(v: number | boolean | string): string {
  if (typeof v === "boolean") return v ? "evet" : "hayır";
  if (typeof v === "number") return String(v).replace(".", ",");
  return v.startsWith(FY_NS) ? "fy:" + v.slice(FY_NS.length) : v;
}

export interface PatchBuilderProps {
  drafts: PatchDraftOp[];
  onChange: (drafts: PatchDraftOp[]) => void;
  /** Yamanın gerekçesi (öneri metni); canlı doğrulamaya gönderilir */
  rationale: string;
  error?: string;
}

export function PatchBuilder({ drafts, onChange, rationale, error }: PatchBuilderProps) {
  const { ontology, flat, loading, error: ontErr, reload } = useOntology();
  const params = ontology?.params ?? [];
  const articles = ontology?.articles ?? [];
  const { patch, incomplete } = useMemo(() => draftToPatch(drafts, rationale, params), [drafts, rationale, params]);

  const update = (key: string, patchFields: Partial<PatchDraftOp>) => onChange(drafts.map((d) => (d.key === key ? ({ ...d, ...patchFields } as PatchDraftOp) : d)));
  const remove = (key: string) => onChange(drafts.filter((d) => d.key !== key));
  const add = (kind: PatchOpKind) => onChange([...drafts, newDraftOp(kind)]);

  const paramOptions: SelectOption[] = params.map((p) => ({
    value: paramKey(p),
    label: `${p.immutable ? "🔒 " : ""}${p.label} — şu an: ${fmtValue(p.value)}${p.immutable ? " (değiştirilemez)" : ""}`,
    disabled: p.immutable,
  }));
  const articleOptions = (lockImmutable: boolean): SelectOption[] =>
    articles.map((a) => ({
      value: a.iri,
      label: `${a.protection === "Degistirilemez" ? "🔒 " : ""}${a.number} — ${a.title} (${PROTECTION_LABELS[a.protection]})`,
      disabled: lockImmutable && a.protection === "Degistirilemez",
    }));
  const parentOptions: SelectOption[] = [
    { value: FY_NS + "Kategori", label: "Kök kategori (üst kategori yok)" },
    ...flat.map((c) => ({ value: c.iri, label: `${"— ".repeat(c.depth)}${c.label}` })),
  ];
  const articleOf = (iri: string): ArticleInfo | undefined => articles.find((a) => expandIri(a.iri) === expandIri(iri));

  const debounced = useDebounced(JSON.stringify(patch), 700);
  const ready = patch.ops.length > 0;
  const check = useAsync(() => validatePatch(JSON.parse(debounced) as RegulationPatch), [debounced], { enabled: ready });
  const stale = ready && (debounced !== JSON.stringify(patch) || check.loading);

  if (loading && !ontology) return <Spinner block label="Yönetmelik yükleniyor…" />;
  if (ontErr && !ontology) return <ErrorView error={ontErr} title="Yönetmelik yüklenemedi" onRetry={reload} />;

  return (
    <div className="patch-builder stack">
      <p className="small muted mt-0">
        Yama, yönetmeliğin (ontolojinin) yapılandırılmış değişikliğidir. Değiştirilemez kurallar ve maddeler{" "}
        <strong>kilitlidir</strong>: onlara dokunan ya da korumayı zayıflatan bir yama oylanamaz (T3).
      </p>

      {drafts.length === 0 ? <p className="muted">Henüz işlem eklenmedi. Aşağıdan bir işlem türü seçin.</p> : null}

      <ol className="patch-ops">
        {drafts.map((d, i) => {
          const isIncomplete = incomplete.includes(i + 1);
          return (
            <li key={d.key} className="patch-op">
              <div className="patch-op-head">
                <span className="patch-op-title">
                  {i + 1}. {PATCH_OP_LABELS[d.op]}
                </span>
                {isIncomplete ? <Badge tone="warning">Eksik</Badge> : <Badge tone="success">Hazır</Badge>}
                <Button size="sm" variant="ghost" icon="close" onClick={() => remove(d.key)} aria-label={`${i + 1}. işlemi kaldır`}>
                  Kaldır
                </Button>
              </div>

              {d.op === "setParam" ? (
                (() => {
                  const def = params.find((p) => paramKey(p) === d.target);
                  return (
                    <div className="stack-sm">
                      <Select
                        label="Kural ve parametre"
                        placeholder="Seçin…"
                        options={paramOptions}
                        value={d.target}
                        onChange={(e) => {
                          const p = params.find((x) => paramKey(x) === e.target.value);
                          update(d.key, { target: e.target.value, value: p ? String(p.value) : "" });
                        }}
                        hint="🔒 işaretli parametreler değiştirilemez bir kurala aittir ve seçilemez."
                      />
                      {def ? (
                        typeof def.value === "boolean" ? (
                          <Select
                            label="Yeni değer"
                            options={[
                              { value: "true", label: "Evet" },
                              { value: "false", label: "Hayır" },
                            ]}
                            value={d.value || String(def.value)}
                            onChange={(e) => update(d.key, { value: e.target.value })}
                            hint={`Mevcut değer: ${fmtValue(def.value)}`}
                          />
                        ) : (
                          <Input
                            label="Yeni değer"
                            inputMode={typeof def.value === "number" ? "decimal" : undefined}
                            value={d.value}
                            onChange={(e) => update(d.key, { value: e.target.value })}
                            hint={`Mevcut değer: ${fmtValue(def.value)}${typeof def.value === "number" ? " · oranlar 0–1 arası ondalık (ör. 0,4), süreler saat" : ""}`}
                          />
                        )
                      ) : null}
                    </div>
                  );
                })()
              ) : null}

              {d.op === "addCategory" ? (
                <div className="form-grid">
                  <Input
                    label="Kategori adı"
                    value={d.label}
                    maxLength={200}
                    onChange={(e) =>
                      update(d.key, d.iriTouched ? { label: e.target.value } : { label: e.target.value, iri: categoryIriFromLabel(e.target.value) })
                    }
                  />
                  <Select label="Üst kategori" placeholder="Seçin…" options={parentOptions} value={d.parent} onChange={(e) => update(d.key, { parent: e.target.value })} />
                  <Input
                    label="IRI"
                    value={d.iri}
                    className="mono"
                    onChange={(e) => update(d.key, { iri: e.target.value, iriTouched: true })}
                    hint="Addan otomatik üretilir (ör. fy:GecePazarlari)."
                  />
                  <Input
                    label="Anahtar kelimeler"
                    value={d.keywords}
                    onChange={(e) => update(d.key, { keywords: e.target.value })}
                    hint="Virgülle ayırın; YZ ve sezgisel sınıflandırma bunları kullanır."
                  />
                  <Checkbox
                    label="Bu alandaki öneriler bilirkişi görüşü gerektirsin"
                    checked={d.requiresExpert}
                    onChange={(e) => update(d.key, { requiresExpert: e.target.checked })}
                  />
                </div>
              ) : null}

              {d.op === "amendArticleText" ? (
                (() => {
                  const art = articleOf(d.article);
                  return (
                    <div className="stack-sm">
                      <Select
                        label="Madde"
                        placeholder="Seçin…"
                        options={articleOptions(true)}
                        value={d.article}
                        onChange={(e) => {
                          const a = articleOf(e.target.value);
                          update(d.key, { article: e.target.value, text: a?.text ?? "" });
                        }}
                        hint="🔒 değiştirilemez maddeler kilitlidir: metinleri oylamayla değiştirilemez."
                      />
                      {art?.protection === "Nitelikli" ? (
                        <p className="small patch-note">Bu madde nitelikli korumadadır; değişikliği T2 eşikleriyle (en az 2/3 onay) oylanır.</p>
                      ) : null}
                      {art ? (
                        <>
                          <Textarea label="Yeni madde metni" value={d.text} rows={6} maxLength={20000} onChange={(e) => update(d.key, { text: e.target.value })} />
                          <DiffView before={art.text} after={d.text} context={2} label={`${art.number} metin farkı`} />
                        </>
                      ) : null}
                    </div>
                  );
                })()
              ) : null}

              {d.op === "addArticle" ? (
                <div className="form-grid">
                  <Input
                    label="Madde numarası"
                    value={d.number}
                    placeholder="Madde 24 (1)"
                    onChange={(e) =>
                      update(d.key, d.iriTouched ? { number: e.target.value } : { number: e.target.value, iri: articleIriFromNumber(e.target.value) })
                    }
                  />
                  <Input label="Başlık" value={d.title} maxLength={300} onChange={(e) => update(d.key, { title: e.target.value })} />
                  <Select
                    label="Koruma düzeyi"
                    options={[
                      { value: "Olagan", label: "Olağan" },
                      { value: "Nitelikli", label: "Nitelikli" },
                    ]}
                    value={d.protection}
                    onChange={(e) => update(d.key, { protection: e.target.value as "Olagan" | "Nitelikli" })}
                    hint="Yeni madde doğrudan değiştirilemez olarak eklenemez."
                  />
                  <Input
                    label="IRI"
                    value={d.iri}
                    className="mono"
                    onChange={(e) => update(d.key, { iri: e.target.value, iriTouched: true })}
                    hint="Numaradan otomatik üretilir (ör. fy:Madde_24_1)."
                  />
                  <Textarea
                    label="Madde metni"
                    value={d.text}
                    rows={5}
                    maxLength={20000}
                    onChange={(e) => update(d.key, { text: e.target.value })}
                    fieldClassName="form-grid-full"
                  />
                </div>
              ) : null}

              {d.op === "setProtection" ? (
                (() => {
                  const art = articleOf(d.article);
                  return (
                    <div className="form-grid">
                      <Select
                        label="Madde"
                        placeholder="Seçin…"
                        options={articleOptions(true)}
                        value={d.article}
                        onChange={(e) => update(d.key, { article: e.target.value })}
                        hint="Değiştirilemez maddelerin koruması kaldırılamaz ya da zayıflatılamaz."
                      />
                      <Select
                        label="Yeni koruma düzeyi"
                        placeholder="Seçin…"
                        options={(["Olagan", "Nitelikli", "Degistirilemez"] as ProtectionLevel[]).map((p) => ({ value: p, label: PROTECTION_LABELS[p] }))}
                        value={d.protection}
                        onChange={(e) => update(d.key, { protection: e.target.value as ProtectionLevel })}
                        hint={art ? `Mevcut: ${PROTECTION_LABELS[art.protection]}` : undefined}
                      />
                    </div>
                  );
                })()
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="patch-add">
        <span className="small muted">İşlem ekle:</span>
        {(Object.keys(PATCH_OP_LABELS) as PatchOpKind[]).map((k) => (
          <Button key={k} size="sm" icon="plus" onClick={() => add(k)}>
            {PATCH_OP_LABELS[k]}
          </Button>
        ))}
      </div>
      {error ? (
        <div className="field-error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="patch-check" aria-label="Yama doğrulaması" aria-live="polite">
        <div className="row">
          <strong>Yama doğrulaması</strong>
          {stale ? <Spinner size="sm" label="Doğrulanıyor…" showLabel /> : null}
          {ready && check.data && !stale ? (
            <>
              <TierBadge tier={check.data.tier} short />
              {check.data.admissible ? (
                <Badge tone="success" icon="check">
                  Meta-kurallara uygun
                </Badge>
              ) : (
                <Badge tone="danger" icon="error">
                  Geçersiz yama
                </Badge>
              )}
            </>
          ) : null}
        </div>
        {!ready ? <p className="small muted mt-0">Doğrulama için en az bir tamamlanmış işlem ekleyin.</p> : null}
        {incomplete.length ? <p className="small patch-note mt-0">Eksik işlemler ({incomplete.join(", ")}) doğrulamaya ve yamaya alınmaz.</p> : null}
        {ready && check.error ? <ErrorView error={check.error} compact onRetry={check.reload} /> : null}
        {ready && check.data ? (
          <FindingList
            findings={[...check.data.violations, ...check.data.warnings, ...check.data.infos]}
            empty={<p className="small muted mt-0">Yama meta-kuralları açısından bulgu yok.</p>}
          />
        ) : null}
      </section>
    </div>
  );
}

export default PatchBuilder;
