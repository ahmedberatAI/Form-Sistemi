// N3 kural motoru: n3 paketinin Reasoner'ı (Horn kuralları, ileri zincirleme, sabit nokta).
import { Reasoner } from "n3";
import { Store, namedNode, type Quad } from "./rdf";

type Level2Fn = (rule: unknown, content: unknown, cb: unknown, i: number, last: boolean, val2: { value: number | null }, index2: Record<string, unknown>) => void;

/**
 * n3@2.7 Reasoner'ındaki bir eşleşme hatasına karşı korumalı alt sınıf.
 *
 * Öncülün öznesi ve nesnesi bağlıyken (sabit ya da önceki öncülden gelen değişken) Reasoner üç düzeyli dizinin son
 * düzeyindeki (yüklem) anahtarın varlığını denetlemiyordu ("Bound leaves run once even when the key is absent").
 * Sonuç: `?g fy:muhurlu true` öncülü, `?g` herhangi bir yüklemle `true` değerine bağlıysa eşleşiyordu (ör. Tehdit'in
 * `fy:acil true`'su yüzünden Tehdit gerekçeli talep "mühürlenir" sanılıyordu). Bu sınıf, bağlı son düzeyde anahtarın
 * dizinde gerçekten bulunduğunu denetler; bulunmazsa eşleşme yoktur. Kurallar dosyası da bu kalıptan kaçınır
 * (yonetmelik-kurallar.n3, K7); bu koruma diğer kuralları da aynı hataya karşı güvenceye alır.
 */
class GuardedReasoner extends Reasoner {}

const baseLevel2 = (Reasoner.prototype as unknown as { _evaluateLevel2?: Level2Fn })._evaluateLevel2;
if (typeof baseLevel2 === "function") {
  (GuardedReasoner.prototype as unknown as { _evaluateLevel2: Level2Fn })._evaluateLevel2 = function (this: unknown, rule, content, cb, i, last, val2, index2) {
    const bound = val2.value;
    if (bound && !(bound in index2)) return;
    baseLevel2.call(this, rule, content, cb, i, last, val2, index2);
  };
}

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
    new GuardedReasoner(store).reason(this.rules);
    return store;
  }
}
