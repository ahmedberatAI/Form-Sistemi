import { createRng } from "@forum/shared";
import { computeClusters } from "./src/governance";
const rng = createRng("blocks");
const blocks = [60, 30, 10];
const entries: any[] = [];
const P = 30;
const pref: number[][] = blocks.map(() => Array.from({ length: P }, () => (rng.next() < 0.5 ? 0.85 : 0.15)));
let u = 0;
blocks.forEach((size, b) => {
  for (let i = 0; i < size; i++, u++) {
    for (let p = 0; p < P; p++) {
      if (rng.next() < 0.3) continue;
      entries.push({ userId: `u${String(u).padStart(3, "0")}`, proposalId: `p${p}`, value: rng.next() < pref[b][p] ? 1 : -1 });
    }
  }
});
const t = performance.now();
const r = computeClusters(entries, "s1");
console.log(performance.now() - t, r.k, r.silhouette, r.sizes, r.excluded.length);
for (const s of ["s2", "s3", "s4", "x"]) { const r2 = computeClusters(entries, s); console.log(s, r2.k, r2.silhouette, JSON.stringify(r2.assignments) === JSON.stringify(r.assignments)); }
const conf: Record<string, number[]> = {};
let idx = 0;
blocks.forEach((size, b) => { for (let i = 0; i < size; i++, idx++) { const g = r.assignments[`u${String(idx).padStart(3, "0")}`]; (conf[g] ??= [0,0,0])[b]++; } });
console.log(conf);
const mis = Object.entries(r.assignments).filter(([u,g]) => { const n = +u.slice(1); return n>=60 && n<90 && g!=="g1"; });
console.log(mis, mis.map(([u])=>r.coords[u]), "g1 sample", r.coords["u061"], "g2 sample", r.coords["u095"]);
const agree = pref[1].filter((x, i) => x === pref[2][i]).length; console.log("B-C agree", agree, "A-B", pref[0].filter((x,i)=>x===pref[1][i]).length, "A-C", pref[0].filter((x,i)=>x===pref[2][i]).length);
