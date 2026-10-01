import { Parser, Store, Reasoner, DataFactory } from "n3";
// @ts-ignore
import Validator from "shacl-engine/Validator.js";
// @ts-ignore
import rdfDataset from "@rdfjs/dataset";

const ttl = `@prefix fy: <https://forumsistemi.org/ont#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
fy:Saglik rdfs:subClassOf fy:Kategori ; fy:bilirkisiGerekli true .
fy:HalkSagligi rdfs:subClassOf fy:Saglik .
fy:p a fy:Oneri ; fy:kategori fy:HalkSagligi ; fy:taban 3 ; fy:guncel 4 ; fy:silme fy:GorusAyriligi .
fy:GorusAyriligi a fy:GecersizGerekce .
fy:KatmanT0 fy:yeterSayi "0.20"^^xsd:decimal .
`;
const rules = `@prefix fy: <https://forumsistemi.org/ont#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
{ ?a rdfs:subClassOf ?b . ?b rdfs:subClassOf ?c . } => { ?a rdfs:subClassOf ?c . } .
{ ?x a ?c . ?c rdfs:subClassOf ?d . } => { ?x a ?d . } .
{ ?p a fy:Oneri . ?p fy:kategori ?c . } => { ?p a ?c . } .
{ ?p a fy:Oneri . ?p a ?c . ?c rdfs:subClassOf fy:Kategori . } => { ?p fy:kategori ?c . } .
{ ?p a fy:Oneri . ?p a ?c . ?c fy:bilirkisiGerekli true . } => { ?p a fy:BilirkisiGerektirenOneri . ?p fy:bilirkisiAlani ?c . } .
{ ?p fy:silme ?g . ?g a fy:GecersizGerekce . } => { ?p fy:gecersiz ?g . } .
`;
const shapes = `@prefix fy: <https://forumsistemi.org/ont#> . @prefix sh: <http://www.w3.org/ns/shacl#> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
fy:S a sh:NodeShape ; sh:targetClass fy:Oneri ;
  sh:property [ sh:path fy:gecersiz ; sh:maxCount 0 ; sh:message "Madde 20 (2): gecersiz" ; fy:bulguKodu "x" ] ;
  sh:property [ sh:path fy:taban ; sh:equals fy:guncel ; sh:severity sh:Warning ; sh:message "surum" ] ;
  sh:property [ sh:path fy:bilirkisiAlani ; sh:in () ; sh:message "in-empty" ] .
fy:Y a sh:NodeShape ; sh:targetSubjectsOf fy:yeterSayi ; sh:property [ sh:path fy:yeterSayi ; sh:minExclusive 0 ; sh:maxInclusive 0.1 ; sh:message "range" ] .
`;
const t0 = performance.now();
const store = new Store(new Parser().parse(ttl));
const ruleStore = new Store(new Parser({ format: "text/n3" }).parse(rules));
new Reasoner(store).reason(ruleStore);
const t1 = performance.now();
for (const q of store.match(DataFactory.namedNode("https://forumsistemi.org/ont#p"))) console.log(q.predicate.value, q.object.value);
const factory = { namedNode: DataFactory.namedNode, blankNode: DataFactory.blankNode, literal: DataFactory.literal, variable: DataFactory.variable, defaultGraph: DataFactory.defaultGraph, quad: DataFactory.quad, triple: DataFactory.triple, dataset: (q?: any) => rdfDataset.dataset(q) };
const shapesDs = rdfDataset.dataset(new Parser().parse(shapes));
const v = new Validator(shapesDs, { factory });
const ds = rdfDataset.dataset([...store]);
const report = await v.validate({ dataset: ds });
console.log("reason ms", t1 - t0, "conforms", report.conforms);
for (const r of report.results) console.log(r.severity.value, r.message.map((m: any) => m.value), r.shape.ptr.term?.termType, r.shape.ptr.term?.value, r.focusNode.term?.value, r.value?.term?.value, r.path?.map((s: any) => s.predicates.map((p: any) => p.value)), r.constraintComponent.value);
