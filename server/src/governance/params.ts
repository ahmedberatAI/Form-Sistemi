// ALGORITMA.md §2 tablosundaki varsayılan karar parametreleri (KC-1.0).
// Bağlayıcı parametreleri ontoloji denetimi üretir; bu fonksiyon testler, simülasyon ve
// ontoloji modülünün karşılaştırma yapabileceği başvuru değerleri içindir.
import { rat, sponsorsRequired, type DecisionParams, type Rational, type Tier } from "@forum/shared";

type VotableTier = Exclude<Tier, "T3">;

const TIER_TABLE: Record<
  VotableTier,
  {
    quorum: Rational;
    threshold: Rational;
    strict: boolean;
    floor: Rational;
    override: Rational;
    revote: Rational;
    durations: DecisionParams["durationsHours"];
  }
> = {
  T0: {
    quorum: rat(1, 5),
    threshold: rat(1, 2),
    strict: true,
    floor: rat(3, 10),
    override: rat(2, 3),
    revote: rat(3, 5),
    durations: { sponsoring: 168, deliberation: 72, voting: 72, extension: 24, objection: 48, reconciliation: 72 },
  },
  T1: {
    quorum: rat(3, 10),
    threshold: rat(3, 5),
    strict: false,
    floor: rat(2, 5),
    override: rat(2, 3),
    revote: rat(3, 5),
    durations: { sponsoring: 168, deliberation: 96, voting: 96, extension: 24, objection: 72, reconciliation: 120 },
  },
  T2: {
    quorum: rat(2, 5),
    threshold: rat(2, 3),
    strict: false,
    floor: rat(2, 5),
    override: rat(3, 4),
    revote: rat(2, 3),
    durations: { sponsoring: 168, deliberation: 168, voting: 120, extension: 48, objection: 72, reconciliation: 168 },
  },
  // DEL: itiraz penceresi yok (0); uzlaşma süresi tabloda "—", burada 0 (doğrudan yeniden oylama).
  DEL: {
    quorum: rat(3, 10),
    threshold: rat(2, 3),
    strict: false,
    floor: rat(3, 10),
    override: rat(3, 4),
    revote: rat(3, 4),
    durations: { sponsoring: 72, deliberation: 24, voting: 48, extension: 24, objection: 0, reconciliation: 0 },
  },
};

/** §2 varsayılanları. `verifiedMembers` verilirse K_s ona göre hesaplanır. */
export function defaultDecisionParams(tier: VotableTier, opts: { verifiedMembers?: number } = {}): DecisionParams {
  const t = TIER_TABLE[tier];
  return {
    tier,
    quorum: t.quorum,
    threshold: t.threshold,
    thresholdStrict: t.strict,
    clusterFloor: t.floor,
    authorClusterFloor: tier === "DEL" ? rat(1, 2) : null,
    overrideThreshold: t.override,
    revoteThreshold: t.revote,
    significantShare: rat(1, 10),
    significantMinMembers: 3,
    minVotesPerCluster: 2,
    minClusteredForBridge: 12,
    coldStartBump: rat(1, 10),
    delegationCapFraction: rat(1, 20),
    delegationMaxHops: 3,
    sponsorsRequired: sponsorsRequired(opts.verifiedMembers ?? 0, tier),
    requiresExpert: false,
    expertCount: 3,
    expertDomains: [],
    durationsHours: { ...t.durations },
  };
}
