// SHACL doğrulayıcısı (shacl-engine) ve sonuçların Türkçe bulgulara (Finding) çevrilmesi.
import Validator from "shacl-engine/Validator.js";
import rdfDataset from "@rdfjs/dataset";
import { DataFactory } from "n3";
import type { Severity } from "@forum/shared";
import { SH_NS, Store, fyN, type Quad, type Term } from "./rdf";

const factory = {
  namedNode: DataFactory.namedNode,
  blankNode: DataFactory.blankNode,
  literal: DataFactory.literal,
  variable: DataFactory.variable,
  defaultGraph: DataFactory.defaultGraph,
  quad: DataFactory.quad,
  triple: DataFactory.triple,
  dataset: (q?: Quad[]) => rdfDataset.dataset(q),
};

export interface ShaclFinding {
  severity: Severity;
  code: string;
  message: string;
  article: string | null;
  focus: string;
  path: string | null;
  value: string | null;
}

function severityOf(t: { value: string }): Severity {
  if (t.value === SH_NS + "Warning") return "warning";
  if (t.value === SH_NS + "Info") return "info";
  return "violation";
}

export type ShapeGroup = "oneri" | "yonetmelik";

export class ShaclChecker {
  private readonly validator: Validator;
  private readonly meta = new Map<string, { code: string | null; article: string | null }>();
  private readonly groups = new Map<ShapeGroup, { terms: Term[] }[]>();

  constructor(shapesQuads: Quad[]) {
    this.validator = new Validator(rdfDataset.dataset(shapesQuads), { factory: factory as never });
    const store = new Store(shapesQuads);
    const key = (t: Term) => `${t.termType}:${t.value}`;
    for (const q of store.getQuads(null, fyN("sekilGrubu"), null, null)) {
      const g = q.object.value as ShapeGroup;
      const arr = this.groups.get(g) ?? [];
      arr.push({ terms: [q.subject] });
      this.groups.set(g, arr);
    }
    for (const q of store.getQuads(null, fyN("bulguKodu"), null, null)) {
      const m = this.meta.get(key(q.subject)) ?? { code: null, article: null };
      m.code = q.object.value;
      this.meta.set(key(q.subject), m);
    }
    for (const q of store.getQuads(null, fyN("dayanak"), null, null)) {
      const m = this.meta.get(key(q.subject)) ?? { code: null, article: null };
      m.article = q.object.value;
      this.meta.set(key(q.subject), m);
    }
  }

  /** group verilirse yalnızca o gruptaki şekiller (fy:sekilGrubu) çalıştırılır. */
  async validate(quads: Quad[], group?: ShapeGroup): Promise<ShaclFinding[]> {
    const shapes = group ? this.groups.get(group) ?? [] : undefined;
    const report = await this.validator.validate({ dataset: rdfDataset.dataset(quads) }, shapes);
    const out: ShaclFinding[] = [];
    const seen = new Set<string>();
    for (const r of report.results) {
      const shapeTerm = r.shape.ptr.term;
      const meta = shapeTerm ? this.meta.get(`${shapeTerm.termType}:${shapeTerm.value}`) : undefined;
      const message = r.message[0]?.value ?? "Yönetmelik şekline aykırılık.";
      const focus = r.focusNode.term?.value ?? "";
      const path = r.path && r.path.length === 1 && r.path[0].predicates.length === 1 ? r.path[0].predicates[0].value : null;
      const code = meta?.code ?? "shacl";
      const dedup = `${code}|${focus}|${path ?? ""}|${message}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      out.push({
        severity: severityOf(r.severity),
        code,
        message,
        article: meta?.article ?? null,
        focus,
        path,
        value: r.value?.term?.value ?? null,
      });
    }
    return out;
  }
}
