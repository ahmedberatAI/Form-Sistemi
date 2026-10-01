// Yönetişim matematiği (saf): kümeleme (§9), vekâlet çözümü (§5), ağırlıklı kura (§8).
// Karar fonksiyonu (decide/evaluateObjection/verifyTally) istemciyle ortak olduğundan @forum/shared içindedir.
import { createRng, weightedSampleWithoutReplacement } from "@forum/shared";
import type { GovernanceMath } from "../core/contracts";
import { computeClusters } from "./clustering";
import { resolveEffectiveVotes } from "./delegation";

/** Tohumlu, ağırlıklı, yerine koymadan örnekleme. Adaylar önce kimliğe göre sıralanır (belirlenimcilik). */
export function drawWeighted<T extends { id: string; weight: number }>(candidates: T[], k: number, seed: string): T[] {
  const sorted = candidates.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return weightedSampleWithoutReplacement(
    sorted,
    sorted.map((c) => c.weight),
    k,
    createRng(seed),
  );
}

export function createGovernanceMath(): GovernanceMath {
  return { computeClusters, resolveEffectiveVotes, drawWeighted };
}

export { computeClusters, CLUSTER_ALGO } from "./clustering";
export { resolveEffectiveVotes, normalizeScopeOrder, scopeOrderFor } from "./delegation";
export { defaultDecisionParams } from "./params";
