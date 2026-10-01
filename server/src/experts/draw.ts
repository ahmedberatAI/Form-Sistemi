// Bilirkişi kurası ve itibar hesabının saf (yan etkisiz) parçaları — ALGORITMA.md §8.
// Herkes bu fonksiyonlarla defterdeki EXPERT_DRAW kaydını ve API'deki aday listesini kullanarak
// çekilişi yeniden üretebilir.
import { fracAtLeast, rat, sha256Hex, type ExpertAssessment } from "@forum/shared";

/** Başlangıç itibarı R₀ */
export const REPUTATION_START = 0.75;
/** Uyarı yaptırımının itibardan düştüğü miktar */
export const WARN_PENALTY = 0.05;

const roundTo = (x: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

/** İtibar 4 basamağa yuvarlanır ve 0'ın altına inmez (kayan nokta gürültüsü deftere/arayüze taşınmasın). */
export function roundReputation(r: number): number {
  return roundTo(Math.max(0, r), 4);
}

/** §8 adım 4: w = clamp(R, 0,5, 1,5) / (1 + aktifGörev) · (1 − soft); 6 basamağa yuvarlanır ve çekilişte bu değer kullanılır. */
export function expertWeight(reputation: number, activeAssignments: number, softConflict: number): number {
  const r = Math.min(1.5, Math.max(0.5, reputation));
  const soft = Math.min(1, Math.max(0, softConflict));
  return roundTo((r / (1 + Math.max(0, activeAssignments))) * (1 - soft), 6);
}

/** §8 adım 5: tohum = SHA256(blokHash ‖ proposalId ‖ round) */
export function drawSeed(blockHash: string, proposalId: string, round: number): string {
  return sha256Hex(`${blockHash}|${proposalId}|${round}`);
}

/** Çekinme/yaptırım sonrası n'inci boşalan yer için yedek çekiliş tohumu */
export function substituteSeed(seed: string, n: number): string {
  return `${seed}|yedek|${n}`;
}

/** Defterde ham kullanıcı kimliği yerine kullanılan panel içi referans */
export function candidateRef(userId: string, panelId: string): string {
  return sha256Hex(`${userId}|${panelId}`);
}

export interface ReportChecklist {
  timely: boolean;
  allAnswered: boolean;
  inDomain: boolean;
  noLegalQualification: boolean;
}

/** §8 adım 11: S = kontrol listesindeki maddelerin ortalaması. Sonucun içeriği (feasible/infeasible) puana GİRMEZ. */
export function reportScore(c: ReportChecklist): number {
  return [c.timely, c.allAnswered, c.inDomain, c.noLegalQualification].filter(Boolean).length / 4;
}

/** R' = 0,8·R + 0,2·S */
export function updatedReputation(r: number, s: number): number {
  return roundReputation(0.8 * r + 0.2 * s);
}

/**
 * §8 adım 9 (askı kuralı): rapor verenlerin ≥ 2/3'ü "infeasible" (rasyonel karşılaştırma) VE
 * güven medyanı ≥ 0,8. Güvenler 1/10000 birimlik tamsayılara çevrilerek karşılaştırılır.
 */
export function suspensive(reports: { assessment: ExpertAssessment; confidence: number }[]): boolean {
  if (reports.length === 0) return false;
  const infeasible = reports.filter((r) => r.assessment === "infeasible").length;
  if (!fracAtLeast(infeasible, reports.length, rat(2, 3))) return false;
  const c = reports.map((r) => Math.round(r.confidence * 10000)).sort((a, b) => a - b);
  const n = c.length;
  return n % 2 === 1 ? c[(n - 1) / 2] >= 8000 : c[n / 2 - 1] + c[n / 2] >= 16000;
}
