import { makeCtx } from "../test/helpers/fakes";
import { createOntologyService } from "../src/ontology/index";
import { fy } from "@forum/shared";
const ctx = makeCtx();
const o = createOntologyService(ctx);
const t0 = Date.now();
await o.init();
console.log("init ms", Date.now() - t0);
const base = { title: "Parka yeni banklar konulsun", body: "Mahalle parkına yaşlılar için gölgelik ve banklar konulması önerilir.", verifiedMembers: 30 };
for (const inp of [
  { kind: "topic", categories: [fy("YesilAlan")] },
  { kind: "topic", categories: [fy("Enerji")] },
  { kind: "deletion", categories: [fy("YesilAlan")], deletion: { ground: fy("GorusAyriligi"), messageCount: 1 } },
  { kind: "deletion", categories: [fy("YesilAlan")], deletion: { ground: fy("Tehdit"), messageCount: 1 } },
  { kind: "amendment", categories: [fy("YesilAlan")], parentTopic: { id: "t", categories: [fy("YesilAlan")], status: "active" }, amendment: { baseVersion: 1, currentVersion: 1 } },
] as any[]) {
  const t1 = Date.now();
  const r = await o.audit({ ...base, ...inp });
  console.log(inp.kind, r.admissible, r.tier, r.params?.sponsorsRequired, r.params?.requiresExpert, JSON.stringify(r.params?.durationsHours), r.violations.map(v => v.code), "ms", Date.now() - t1);
}
console.log(o.deletionGrounds().map(g => [g.iri.split("#")[1], g.urgent]));
console.log(o.objectionGrounds().map(g => g.iri.split("#")[1]));
console.log(o.adjustableParams().slice(0, 50).map(p => [p.rule.split("#")[1], p.param, p.value, p.immutable]));
console.log(o.articles().filter(a => a.protection === "Degistirilemez").map(a => [a.iri.split("#")[1], a.number]).slice(0,10));
console.log(o.current());
console.log(o.ancestors(fy("YesilAlan")), o.depth(fy("YesilAlan")), o.depth(fy("Cevre")));
console.log(o.rights().map(r => r.iri.split("#")[1]));
