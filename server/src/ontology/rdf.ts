// RDF yardımcıları: ayrıştırma, terimler, kanonik N-Triples özeti, Turtle yazımı.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DataFactory, Parser, Store, Writer, type Literal, type NamedNode, type Quad, type Term } from "n3";
import { FY_NS, sha256Hex } from "@forum/shared";
import { hasUnsafeIriChars } from "./iri";

const { namedNode, literal, quad } = DataFactory;

export const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
export const XSD_NS = "http://www.w3.org/2001/XMLSchema#";
export const SH_NS = "http://www.w3.org/ns/shacl#";

export const fyN = (local: string): NamedNode => namedNode(FY_NS + local);
export const RDF_TYPE = namedNode(RDF_NS + "type");
export const RDFS_SUBCLASS = namedNode(RDFS_NS + "subClassOf");
export const RDFS_LABEL = namedNode(RDFS_NS + "label");
export const RDFS_COMMENT = namedNode(RDFS_NS + "comment");
export const XSD_DECIMAL = namedNode(XSD_NS + "decimal");
export const XSD_INTEGER = namedNode(XSD_NS + "integer");
export const XSD_BOOLEAN = namedNode(XSD_NS + "boolean");

export const PREFIXES = { fy: FY_NS, rdf: RDF_NS, rdfs: RDFS_NS, xsd: XSD_NS };

export { namedNode, literal, quad };
export type { Quad, Term, NamedNode, Literal };

export function readOntologyFile(dir: string, name: string): string {
  return readFileSync(join(dir, name), "utf8");
}

export function parseTurtle(text: string, baseIRI?: string): Quad[] {
  return new Parser({ baseIRI }).parse(text);
}

export function parseN3(text: string): Quad[] {
  return new Parser({ format: "text/n3" }).parse(text);
}

export function localName(iri: string): string {
  return iri.startsWith(FY_NS) ? iri.slice(FY_NS.length) : iri;
}

export function decimalLiteral(x: number): Literal {
  let s = String(x);
  if (/e/i.test(s)) s = x.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  return literal(s, XSD_DECIMAL);
}

export function integerLiteral(x: number): Literal {
  return literal(String(Math.trunc(x)), XSD_INTEGER);
}

export function booleanLiteral(b: boolean): Literal {
  return literal(b ? "true" : "false", XSD_BOOLEAN);
}

export function termNumber(t: Term | undefined | null): number | null {
  if (!t || t.termType !== "Literal") return null;
  const n = Number(t.value);
  return Number.isFinite(n) ? n : null;
}

export function termBool(t: Term | undefined | null): boolean | null {
  if (!t || t.termType !== "Literal") return null;
  if (t.value === "true" || t.value === "1") return true;
  if (t.value === "false" || t.value === "0") return false;
  return null;
}

/** Literal değerini JS değerine çevirir (sayı / mantıksal / metin); IRI ise IRI metni. */
export function termValue(t: Term): number | boolean | string {
  if (t.termType === "Literal") {
    const dt = (t as Literal).datatype?.value ?? "";
    if (dt === XSD_BOOLEAN.value) return t.value === "true" || t.value === "1";
    if (dt === XSD_DECIMAL.value || dt === XSD_INTEGER.value || dt === XSD_NS + "double" || dt === XSD_NS + "float") return Number(t.value);
    return t.value;
  }
  return t.value;
}

function escapeNt(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

export function termToNt(t: Term): string {
  switch (t.termType) {
    case "NamedNode":
      return `<${t.value}>`;
    case "BlankNode":
      return `_:${t.value}`;
    case "Literal": {
      const l = t as Literal;
      if (l.language) return `"${escapeNt(l.value)}"@${l.language}`;
      const dt = l.datatype?.value;
      if (!dt || dt === XSD_NS + "string") return `"${escapeNt(l.value)}"`;
      return `"${escapeNt(l.value)}"^^<${dt}>`;
    }
    default:
      return `?${t.value}`;
  }
}

export function quadToNt(q: Quad): string {
  return `${termToNt(q.subject)} ${termToNt(q.predicate)} ${termToNt(q.object)} .`;
}

/** Sıralı, tekilleştirilmiş N-Triples satırlarının SHA-256 özeti (yönetmelik sürüm özeti). */
export function hashQuads(quads: Quad[]): string {
  const lines = [...new Set(quads.map(quadToNt))].sort();
  return sha256Hex(lines.join("\n") + "\n");
}

function sortQuads(quads: Quad[]): Quad[] {
  const keyed = quads.map((q) => ({ q, k: quadToNt(q) }));
  keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  const out: Quad[] = [];
  let last = "";
  for (const { q, k } of keyed) {
    if (k === last) continue;
    last = k;
    out.push(q);
  }
  return out;
}

/**
 * Belirlenimci Turtle çıktısı (öznelere göre sıralı). N3 yazıcısı IRI içindeki boşluk ve "<>\"{}|^`\\" karakterlerini
 * kaçırmadığı için bunlardan birini taşıyan her IRI reddedilir: aksi halde yazılan metne üçlü enjekte edilebilir.
 */
export function writeTurtle(quads: Quad[], header?: string): string {
  for (const q of quads)
    for (const t of [q.subject, q.predicate, q.object, q.graph] as Term[])
      if (t.termType === "NamedNode" && hasUnsafeIriChars(t.value)) throw new Error(`Turtle'a yazılamayan IRI: ${JSON.stringify(t.value)}`);
  const writer = new Writer({ prefixes: PREFIXES });
  writer.addQuads(sortQuads(quads));
  let out = "";
  writer.end((err, result) => {
    if (err) throw err;
    out = result;
  });
  return (header ? header.trimEnd() + "\n" : "") + out;
}

/** Bir öznenin belirli bir yüklemdeki nesneleri. */
export function objects(store: Store, s: Term | string, p: Term | string): Term[] {
  const sub = typeof s === "string" ? namedNode(s) : s;
  const pred = typeof p === "string" ? namedNode(p) : p;
  return store.getObjects(sub as NamedNode, pred as NamedNode, null);
}

export function firstObject(store: Store, s: Term | string, p: Term | string): Term | null {
  return objects(store, s, p)[0] ?? null;
}

export { Store };
