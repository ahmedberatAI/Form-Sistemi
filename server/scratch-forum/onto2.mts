import { makeCtx } from "../test/helpers/fakes";
import { createOntologyService } from "../src/ontology/index";
import { fy } from "@forum/shared";
const ctx = makeCtx();
const o = createOntologyService(ctx);
await o.init();
const base = { title: "Tartışma süresi kısaltılsın", body: "Olağan kararlarda tartışma süresi 72 saatten 48 saate indirilsin.", verifiedMembers: 30, categories: [fy("ForumYonetmeligi")] };
const p1 = { ops: [{ op: "setParam", rule: fy("KatmanT0"), param: "sureTartisma", value: 48 }], rationale: "hız" };
const p2 = { ops: [{ op: "amendArticleText", article: fy("Madde_3_1"), text: "Yeni metin burada yazıyor." }], rationale: "x" };
const p3 = { ops: [{ op: "setProtection", article: fy("Madde_3_1"), protection: "Olagan" }], rationale: "x" };
for (const patch of [p1, p2, p3] as any[]) {
  const r = await o.audit({ ...base, kind: "regulation", regulationPatch: patch } as any);
  const v = await o.validatePatch(patch);
  console.log(r.admissible, r.tier, r.violations.map(x => x.code), "| validate:", v.admissible, v.violations.map(x => x.code));
}
const info = await o.applyPatch(p1 as any, "prop-1");
console.log(info, o.current().version, o.versions().length);
const r2 = await o.audit({ ...base, kind: "topic", categories: [fy("YesilAlan")] } as any);
console.log(r2.params?.durationsHours, r2.bylawVersion);
console.log(o.articles().find(a => a.iri === fy("Madde_3_1")));
