// İtiraz imza bütçesi: bir üye son 30 günde en çok OBJECTION_BUDGET itiraz imzalayabilir.
// ProposalService.object() ve eligibility.canObject (ProposalDetail.canObject bayrağı ile Ana sayfa "itiraz hakkınız var"
// görevi) AYNI kuralı bu tek yerden uygular (arayüz "itiraz edebilirsin" deyip sunucu "bütçeniz doldu" demesin).
import { DAY } from "../core/clock";
import { json, type Db } from "../db";

export const OBJECTION_WINDOW_MS = 30 * DAY;
export const OBJECTION_BUDGET = 2;

export interface ObjectionBudgetState {
  /** Pencere içindeki imza zaman damgaları */
  used: number[];
  exhausted: boolean;
  /** Bütçe doluysa en eski imzanın pencereden düşeceği an; değilse null */
  nextAvailableAt: number | null;
}

export function objectionBudgetOf(db: Db, userId: string, now: number): ObjectionBudgetState {
  const raw = db.get<{ v: string }>("SELECT objection_budget_used AS v FROM users WHERE id = ?", userId)?.v ?? null;
  const used = json<number[]>(raw, []).filter((t) => Number.isFinite(t) && t > now - OBJECTION_WINDOW_MS);
  const exhausted = used.length >= OBJECTION_BUDGET;
  return { used, exhausted, nextAvailableAt: exhausted ? Math.min(...used) + OBJECTION_WINDOW_MS : null };
}
