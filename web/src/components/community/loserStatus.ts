// Kalıcı kaybeden küme göstergesinin durumu (Ana sayfa ve Graf › İstatistikler aynı kuralı kullanır).
// Eşikler shared/limits.ts'tedir: en az LOSER_MIN_DECISIONS karar ve LOSER_WARN_SHARE kaybedilen pay.
import { LOSER_MIN_DECISIONS, LOSER_WARN_SHARE } from "@forum/shared";

export type LoserStatus = "warning" | "insufficient" | "normal";

export const LOSER_STATUS_LABELS: Record<LoserStatus, string> = {
  warning: "Uyarı",
  insufficient: "Yetersiz veri",
  normal: "Olağan",
};

/** Karar sayısı yetersizse oran anlamlı sayılmaz; yeterliyse eşiğe ulaşan küme "Uyarı"dır. */
export function loserStatus(x: { lostShare: number; decisions: number }): LoserStatus {
  if (x.decisions < LOSER_MIN_DECISIONS) return "insufficient";
  return x.lostShare >= LOSER_WARN_SHARE ? "warning" : "normal";
}
