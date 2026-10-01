// N3 kural motoru: n3@2.7 Reasoner'ının "bağlı özne + bağlı nesne öncülünde yüklem denetlenmiyor" hatasına karşı koruma.
// Hata yüzünden Tehdit gerekçeli silme talebi (yalnız `fy:acil true`) "mühürlenir" sanılıyordu (denetim bulgusu 14).
import { describe, expect, it } from "vitest";
import { FY_NS } from "@forum/shared";
import { RuleEngine } from "../../src/ontology/reasoner";
import { RDF_TYPE, namedNode, parseN3, parseTurtle } from "../../src/ontology/rdf";

const PFX = "@prefix fy: <https://forumsistemi.org/ont#> .\n";
const has = (engine: RuleEngine, data: string, s: string, cls: string) =>
  engine.run(parseTurtle(PFX + data)).countQuads(namedNode(FY_NS + s), RDF_TYPE, namedNode(FY_NS + cls), null) > 0;

describe("RuleEngine — bağlı özne ve nesneli öncülde yüklem denetimi", () => {
  it("`?x fy:muhurlu true` yalnız fy:muhurlu ile eşleşir; aynı nesneli başka yüklem (fy:acil true) eşleşmez", () => {
    const engine = new RuleEngine(parseN3(PFX + "{ ?p fy:g ?x . ?x fy:muhurlu true . } => { ?p a fy:M . } ."));
    expect(has(engine, "fy:p fy:g fy:T . fy:T fy:acil true .", "p", "M")).toBe(false);
    expect(has(engine, "fy:p fy:g fy:K . fy:K fy:muhurlu true .", "p", "M")).toBe(true);
  });

  it("IRI nesneli öncülde de yüklem denetlenir", () => {
    const engine = new RuleEngine(parseN3(PFX + "{ ?p fy:g ?x . ?x fy:hedef fy:Q . } => { ?p a fy:M . } ."));
    expect(has(engine, "fy:p fy:g fy:T . fy:T fy:diger fy:Q .", "p", "M")).toBe(false);
    expect(has(engine, "fy:p fy:g fy:T . fy:T fy:hedef fy:Q .", "p", "M")).toBe(true);
  });

  it("zincirleme çıkarımla bağlanan özne için de (türetilmiş üçlü kuralı tetiklediğinde)", () => {
    const engine = new RuleEngine(
      parseN3(PFX + "{ ?p fy:a ?x . } => { ?p fy:g ?x . } .\n{ ?p fy:g ?x . ?x fy:muhurlu true . } => { ?p a fy:M . } ."),
    );
    expect(has(engine, "fy:p fy:a fy:T . fy:T fy:acil true .", "p", "M")).toBe(false);
    expect(has(engine, "fy:p fy:a fy:K . fy:K fy:muhurlu true .", "p", "M")).toBe(true);
  });
});
