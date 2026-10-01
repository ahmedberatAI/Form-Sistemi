import { createRng, type Rng } from "@forum/shared";
import { computeClusters } from "./src/governance";
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
function gauss(rng: Rng) { const u = Math.max(rng.next(), 1e-12); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next()); }
function trial(seed: string, H: number, spread: number, noise: number, bias: number, turnout: number) {
  const rng = createRng(seed);
  const sizes = [180, 90, 30]; const people: { id: string; b: number; bias: number }[] = [];
  sizes.forEach((s, b) => { for (let i = 0; i < s; i++) people.push({ id: `k${String(people.length).padStart(4, "0")}`, b, bias: bias * gauss(rng) }); });
  const entries: any[] = [];
  for (let h = 0; h < H; h++) { const c = 0.8 * gauss(rng); const L = [0, 1, 2].map(() => c + spread * gauss(rng));
    for (const p of people) { if (rng.next() >= turnout) continue; const v = rng.next() < 0.04 ? 0 : rng.next() < logistic(L[p.b] + p.bias + noise * gauss(rng)) ? 1 : -1; entries.push({ userId: p.id, proposalId: `h${h}`, value: v }); } }
  const r = computeClusters(entries, seed + "c");
  const counts: Record<string, number[]> = {}; for (const p of people) { const g = r.assignments[p.id]; if (!g) continue; (counts[g] ??= [0, 0, 0])[p.b]++; }
  let pure = 0; for (const c of Object.values(counts)) pure += Math.max(...c);
  return { k: r.k, sil: r.silhouette, purity: pure / r.clusteredTotal, counts };
}
for (const [H, spread, noise, bias, turnout] of [[40, 1.6, 0.6, 0.5, 0.55], [40, 2.5, 0.6, 0.5, 0.55], [60, 2.0, 0.6, 0.5, 0.55], [60, 2.5, 0.4, 0.3, 0.6], [80, 2.0, 0.6, 0.5, 0.55], [60, 3.0, 0.6, 0.5, 0.55]]) {
  const rs = [0, 1, 2, 3, 4].map((s) => trial(`t${s}`, H, spread, noise, bias, turnout));
  console.log(`H${H} spread${spread} noise${noise} bias${bias} t${turnout}:`, rs.map((r) => `K${r.k}/${r.sil.toFixed(2)}/${(r.purity * 100).toFixed(0)}%`).join("  "));
}
