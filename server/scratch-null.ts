import { createRng } from "@forum/shared";
import { computeClusters } from "./src/governance";
function gen(blocks: number[], P: number, flip: number, part: number, seed: string, patterns: (b: number, p: number) => number) {
  const rng = createRng(seed); const entries: any[] = []; let u = 0;
  blocks.forEach((size, b) => { for (let i = 0; i < size; i++, u++) for (let p = 0; p < P; p++) { if (rng.next() >= part) continue; const s = patterns(b, p);
    entries.push({ userId: `u${String(u).padStart(3, "0")}`, proposalId: `p${String(p).padStart(2,"0")}`, value: rng.next() < flip ? -s : s }); } });
  return entries;
}
function permute(entries: any[], seed: string) {
  const rng = createRng(seed); const byP: Record<string, any[]> = {};
  for (const e of entries) (byP[e.proposalId] ??= []).push(e);
  const out: any[] = [];
  for (const p of Object.keys(byP).sort()) { const es = byP[p]; const vals = rng.shuffle(es.map(e => e.value)); es.forEach((e, i) => out.push({ ...e, value: vals[i] })); }
  return out;
}
const walsh = (b: number, p: number) => ((p >> b) & 1) === 0 ? 1 : -1;
const run = (name: string, e: any[]) => {
  const r = computeClusters(e, "s"); const nulls = [0,1,2,3,4].map(i => computeClusters(permute(e, "perm" + i), "s").silhouette);
  const nm = nulls.reduce((a,b)=>a+b,0)/nulls.length;
  console.log(name.padEnd(22), "k", r.k, "sil", r.silhouette.toFixed(3), "null", nm.toFixed(3), "diff", (r.silhouette - nm).toFixed(3));
};
for (const flip of [0.05, 0.15, 0.25, 0.35]) run("blocks 60/30/10 f" + flip, gen([60, 30, 10], 32, flip, 0.75, "x" + flip, walsh));
for (const flip of [0.05, 0.15, 0.25, 0.35]) run("blocks 50/50 f" + flip, gen([50, 50], 32, flip, 0.75, "y" + flip, walsh));
for (const flip of [0.02, 0.05, 0.1, 0.2, 0.3, 0.5]) run("homog f" + flip, gen([100], 30, flip, 0.75, "h" + flip, (b, p) => (p % 2 ? 1 : -1)));
