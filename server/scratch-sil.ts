import { createRng } from "@forum/shared";
import { computeClusters } from "./src/governance";
function gen(blocks: number[], P: number, flip: number, part: number, seed: string, patterns: (b: number, p: number) => number) {
  const rng = createRng(seed);
  const entries: any[] = [];
  let u = 0;
  blocks.forEach((size, b) => {
    for (let i = 0; i < size; i++, u++) for (let p = 0; p < P; p++) {
      if (rng.next() >= part) continue;
      const s = patterns(b, p);
      entries.push({ userId: `u${String(u).padStart(3, "0")}`, proposalId: `p${String(p).padStart(2,"0")}`, value: rng.next() < flip ? -s : s });
    }
  });
  return entries;
}
// full-space silhouette of a given partition
function fullSil(entries: any[], assign: Record<string,string>) {
  const users = Object.keys(assign).sort(); const props = [...new Set(entries.map(e=>e.proposalId))].sort();
  const M: Record<string, Record<string, number>> = {}; for (const e of entries) (M[e.userId] ??= {})[e.proposalId] = e.value;
  const mean: Record<string, number> = {}; for (const p of props) { let s=0,c=0; for (const u of users) if (M[u][p]!==undefined){s+=M[u][p];c++;} mean[p]=c?s/c:0; }
  const X = users.map(u => props.map(p => (M[u][p] ?? mean[p]) - mean[p]));
  const lab = users.map(u => assign[u]); const gs = [...new Set(lab)]; if (gs.length<2) return 0;
  const d = (a:number[],b:number[]) => Math.sqrt(a.reduce((s,x,i)=>s+(x-b[i])**2,0));
  let tot=0; for (let i=0;i<users.length;i++){ const sums: Record<string,number>={}, cnt: Record<string,number>={}; for(let j=0;j<users.length;j++){ if(i===j) continue; sums[lab[j]]=(sums[lab[j]]??0)+d(X[i],X[j]); cnt[lab[j]]=(cnt[lab[j]]??0)+1;} if(!cnt[lab[i]]) continue; const a=sums[lab[i]]/cnt[lab[i]]; let b=Infinity; for(const g of gs) if(g!==lab[i]&&cnt[g]) b=Math.min(b,sums[g]/cnt[g]); tot+=(b-a)/Math.max(a,b);} return tot/users.length;
}
const walsh = (b: number, p: number) => ((p >> b) & 1) === 0 ? 1 : -1;
for (const flip of [0.05, 0.15, 0.25, 0.3, 0.35]) {
  const e = gen([60, 30, 10], 32, flip, 0.75, "x" + flip, walsh); const r = computeClusters(e, "s", {});
  console.log("blocks flip", flip, "k", r.k, "2D sil", r.silhouette, "full sil", fullSil(e, r.assignments).toFixed(3));
}
for (const flip of [0.05, 0.1, 0.2, 0.3, 0.5]) {
  const e = gen([100], 30, flip, 0.75, "h" + flip, (b, p) => (p % 2 ? 1 : -1)); const r = computeClusters(e, "s");
  console.log("homog flip", flip, "k", r.k, "2D sil", r.silhouette, "full sil", fullSil(e, r.assignments).toFixed(3));
}
