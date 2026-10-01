// N3 kural motoru: n3 paketinin Reasoner'ı (Horn kuralları, ileri zincirleme, sabit nokta).
import { Reasoner } from "n3";
import { Store, namedNode, type Quad } from "./rdf";

export class RuleEngine {
  private readonly rules: Store;
  readonly ruleCount: number;

  constructor(ruleQuads: Quad[]) {
    this.rules = new Store(ruleQuads);
    this.ruleCount = this.rules.countQuads(null, namedNode("http://www.w3.org/2000/10/swap/log#implies"), null, null);
  }

  /** Verilen üçlülerden bir depo kurar ve tüm kuralları sabit noktaya kadar uygular. */
  run(quads: Quad[]): Store {
    const store = new Store(quads);
    new Reasoner(store).reason(this.rules);
    return store;
  }
}
