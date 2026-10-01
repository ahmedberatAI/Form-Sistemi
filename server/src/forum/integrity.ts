// Bütünlük (denetim) uyarıları — ALGORITMA.md §12.10: kilit adım (lockstep) oy grupları graf modülünde işaretlenir.
//
// Kesin sayımda (oylama kapanışı, uzatma sonrası ya da yeniden oylama) graph.lockstep(proposalId) çalıştırılır. Sonuç
// KARARI DEĞİŞTİRMEZ: yalnızca denetim günlüğüne (audit_log, eylem "integrity.lockstep", hedef "proposal:<id>") yazılır ve
// ProposalDetail.integrityWarnings / ProposalSummary.integrityWarningCount olarak gösterilir.
//
// Gizlilik: grup üyeleri (kullanıcı kimlikleri) yalnızca sunucuda (denetim günlüğü) tutulur; deftere YAZILMAZ.
// Herkes yalnızca tur, grup sayısı ve büyüklüğünü görür; takma adlar yalnız denetçi ve yöneticiye açılır. Hiçbir görünümde
// grubun hangi seçeneği oyladığı yer almaz (yalnızca "aynı oyu verdiler" bilgisi).
import type { IntegrityWarning } from "@forum/shared";
import type { Viewer } from "../core/forum-contracts";
import { json } from "../db";
import { hasRole, jsonList, type ForumCore } from "./util";

export const INTEGRITY_LOCKSTEP_ACTION = "integrity.lockstep";

const targetOf = (proposalId: string): string => `proposal:${proposalId}`;

interface LockstepMeta {
  round: number;
  groups: string[][];
}

/** Temizlenmiş (yinelenmeyen, sıralı, en az 2 kişilik) gruplar; bozuk girdide boş. */
function cleanGroups(raw: unknown): string[][] {
  if (!Array.isArray(raw)) return [];
  const out: string[][] = [];
  for (const g of raw) {
    if (!Array.isArray(g)) continue;
    const ids = [...new Set(g.filter((x): x is string => typeof x === "string" && x.length > 0))].sort();
    if (ids.length >= 2) out.push(ids);
  }
  return out;
}

/**
 * Kesin sayımda kilit adım taraması (çağıranın işlemi içinde). Hata asla sayımı engellemez: istisna günlüğe yazılır ve
 * 0 döner. Grup bulunursa denetim günlüğüne tek kayıt yazılır. Dönen değer: bulunan grup sayısı.
 */
export function recordLockstep(core: ForumCore, proposalId: string, round: 1 | 2): number {
  let groups: string[][];
  try {
    groups = cleanGroups(core.deps.graph.lockstep(proposalId)?.groups);
  } catch (e) {
    console.error(`[forum] kilit adım taraması yapılamadı (${proposalId}):`, e);
    return 0;
  }
  if (groups.length === 0) return 0;
  const meta: LockstepMeta = { round, groups };
  core.audit.log(null, INTEGRITY_LOCKSTEP_ACTION, targetOf(proposalId), meta as unknown as Record<string, unknown>);
  return groups.length;
}

export function lockstepMessage(round: number, groupSize: number): string {
  return (
    `${round}. turda ${groupSize} kişilik bir grup çok kısa aralıklarla aynı oyu verdi ve geçmiş oylamalarda da büyük ölçüde birlikte oy kullandı ` +
    "(kilit adım örüntüsü). Bu bir bütünlük uyarısıdır: karar DEĞİŞTİRİLMEDİ; denetçi incelemesi için kaydedildi."
  );
}

/** Önerinin bütünlük uyarıları (tur ve tespit sırasıyla). Üye takma adları yalnız denetçi/yöneticiye. */
export function integrityWarnings(core: ForumCore, proposalId: string, viewer: Viewer): IntegrityWarning[] {
  const rows = core.db.all<{ meta: string | null; at: number }>(
    "SELECT meta, at FROM audit_log WHERE action = ? AND target = ? ORDER BY at ASC, rowid ASC",
    INTEGRITY_LOCKSTEP_ACTION,
    targetOf(proposalId),
  );
  if (rows.length === 0) return [];
  const privileged = hasRole(viewer, "auditor", "admin");
  const parsed = rows.map((r) => {
    const m = json<Partial<LockstepMeta>>(r.meta, {});
    return { round: Number(m.round) === 2 ? 2 : 1, groups: cleanGroups(m.groups), at: Number(r.at) } as const;
  });
  const nick = privileged ? core.nicknames(parsed.flatMap((p) => p.groups.flat())) : new Map<string, string>();
  const out: IntegrityWarning[] = [];
  for (const p of parsed) {
    for (const g of p.groups) {
      out.push({
        kind: "lockstep",
        round: p.round,
        groupSize: g.length,
        message: lockstepMessage(p.round, g.length),
        detectedAt: p.at,
        members: privileged ? g.map((id) => ({ userId: id, nickname: nick.get(id) ?? "(silinmiş üye)" })) : null,
      });
    }
  }
  return out;
}

/** Öneri kimliği → bütünlük uyarısı (grup) sayısı; uyarısı olmayanlar haritada yer almaz. Tek sorgu. */
export function integrityWarningCounts(core: ForumCore, proposalIds: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (proposalIds.length === 0) return out;
  const rows = core.db.all<{ target: string; meta: string | null }>(
    "SELECT target, meta FROM audit_log WHERE action = ? AND target IN (SELECT 'proposal:' || value FROM json_each(?))",
    INTEGRITY_LOCKSTEP_ACTION,
    jsonList(proposalIds),
  );
  for (const r of rows) {
    const n = cleanGroups(json<Partial<LockstepMeta>>(r.meta, {}).groups).length;
    if (n === 0) continue;
    const id = r.target.slice("proposal:".length);
    out.set(id, (out.get(id) ?? 0) + n);
  }
  return out;
}
