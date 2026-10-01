import { createRng } from "@forum/shared";
import { computeClusters } from "./src/governance";
function gen(blocks: number[], P: number, flip: number, part: number, seed: string, patterns?: (b: number, p: number) => number) {
  const rng = createRng(seed);
  const entries: any[] = [];
  let u = 0;
  blocks.forEach((size, b) => {
    for (let i = 0; i < size; i++, u++) for (let p = 0; p < P; p++) {
      if (rng.next() >= part) continue;
      const s = patterns ? patterns(b, p) : 1;
      entries.push({ userId: `u${String(u).padStart(3, "0")}`, proposalId: `p${String(p).padStart(2,"0")}`, value: rng.next() < flip ? -s : s });
    }
  });
  return entries;
}
const walsh = (b: number, p: number) => ((p >> b) & 1) === 0 ? 1 : -1;
for (const flip of [0.05, 0.15, 0.25, 0.35]) {
  const r = computeClusters(gen([60, 30, 10], 32, flip, 0.75, "x" + flip, walsh), "s");
  const conf: Record<string, number[]> = {};
  Object.entries(r.assignments).forEach(([u, g]) => { const n = +u.slice(1); const b = n < 60 ? 0 : n < 90 ? 1 : 2; (conf[g] ??= [0,0,0])[b]++; });
  console.log("blocks flip", flip, r.k, r.silhouette, JSON.stringify(conf));
}
for (const flip of [0, 0.1, 0.2, 0.3, 0.5]) {
  for (const P of [30]) {
    const r = computeClusters(gen([100], P, flip, 0.75, "h" + flip, (b, p) => (p % 2 ? 1 : -1)), "s");
    console.log("homog flip", flip, "P", P, r.k, r.silhouette, r.sizes);
  }
}
