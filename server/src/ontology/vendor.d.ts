// Tip bildirimi olmayan RDF/JS paketleri için asgari bildirimler (yalnızca kullandığımız yüzey).
declare module "shacl-engine/Validator.js" {
  import type { DatasetCore, Term } from "@rdfjs/types";

  export interface ShaclPtr {
    term?: Term;
    terms: Term[];
  }

  export interface ShaclPathStep {
    predicates: Term[];
    quantifier?: string;
    start?: string;
  }

  export interface ShaclResult {
    severity: Term;
    message: Term[];
    focusNode: ShaclPtr;
    value?: ShaclPtr;
    path?: ShaclPathStep[] | null;
    shape: { ptr: ShaclPtr };
    constraintComponent: Term;
  }

  export interface ShaclReport {
    conforms: boolean;
    results: ShaclResult[];
  }

  export interface ShaclFactory {
    namedNode: (...args: never[]) => unknown;
    blankNode: (...args: never[]) => unknown;
    literal: (...args: never[]) => unknown;
    variable: (...args: never[]) => unknown;
    defaultGraph: (...args: never[]) => unknown;
    quad: (...args: never[]) => unknown;
    triple: (...args: never[]) => unknown;
    dataset: (quads?: never[]) => DatasetCore;
  }

  export default class Validator {
    constructor(shapes: DatasetCore, options: { factory: ShaclFactory; debug?: boolean; details?: boolean });
    validate(data: { dataset: DatasetCore; terms?: Term[] }, shapes?: { terms: Term[] }[]): Promise<ShaclReport>;
  }
}

declare module "@rdfjs/dataset" {
  import type { DatasetCore, Quad } from "@rdfjs/types";
  const factory: { dataset(quads?: Quad[]): DatasetCore };
  export default factory;
}
