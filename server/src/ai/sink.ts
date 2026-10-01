// ai_analyses kayıtları ve AI_ANALYSIS defter girdileri. Defterde çıktı METNİ yoktur; yalnızca özetler.
import { aiLabel, hashCanonical, type AiAnalysisInfo, type AiTask } from "@forum/shared";
import type { AiRecordSink, CoreContext, LedgerService } from "../core/contracts";
import { notFound } from "../core/errors";
import { newId } from "../core/ids";
import { json } from "../db";

interface AiRow {
  id: string;
  task: string;
  target_type: string;
  target_id: string;
  model: string;
  prompt_version: string;
  offline: number;
  input_hash: string;
  output_hash: string;
  output: string;
  approved_by: string | null;
  ledger_tx: string | null;
  created_at: number;
}

function toInfo(r: AiRow): AiAnalysisInfo {
  return {
    id: r.id,
    task: r.task as AiTask,
    targetType: r.target_type,
    targetId: r.target_id,
    model: r.model,
    offline: !!r.offline,
    output: json<unknown>(r.output, null),
    label: aiLabel(r.model, Number(r.created_at)),
    approvedBy: r.approved_by ?? null,
    createdAt: Number(r.created_at),
    ledgerTx: r.ledger_tx ?? null,
  };
}

/** Girdi ve çıktının kanonik SHA-256 özetleri (record için). */
export function aiHashes(input: unknown, output: unknown): { inputHash: string; outputHash: string } {
  return { inputHash: hashCanonical(input ?? null), outputHash: hashCanonical(output ?? null) };
}

export function createAiRecordSink(ctx: CoreContext, deps: { ledger: LedgerService | null }): AiRecordSink {
  return {
    record(a) {
      const id = newId();
      const createdAt = ctx.clock.now();
      ctx.db.run(
        `INSERT INTO ai_analyses(id, task, target_type, target_id, model, prompt_version, offline, input_hash, output_hash, output, approved_by, ledger_tx, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        id,
        a.task,
        a.targetType,
        a.targetId,
        a.model,
        a.promptVersion,
        a.offline ? 1 : 0,
        a.inputHash,
        a.outputHash,
        JSON.stringify(a.output ?? null),
        a.approvedBy ?? null,
        createdAt,
      );
      if (deps.ledger) {
        try {
          const { txHash } = deps.ledger.submit("AI_ANALYSIS", {
            analysisId: id,
            task: a.task,
            targetType: a.targetType,
            targetId: a.targetId,
            model: a.model,
            offline: !!a.offline,
            inputHash: a.inputHash,
            outputHash: a.outputHash,
            promptVersion: a.promptVersion,
          });
          ctx.db.run("UPDATE ai_analyses SET ledger_tx = ? WHERE id = ?", txHash, id);
        } catch {
          // Defter erişilemezse analiz yine kaydedilir (YZ danışmandır); ledger_tx boş kalır.
        }
      }
      return getAnalysis(ctx, id)!;
    },
  };
}

export function getAnalysis(ctx: Pick<CoreContext, "db">, id: string): AiAnalysisInfo | null {
  const r = ctx.db.get<AiRow>("SELECT * FROM ai_analyses WHERE id = ?", id);
  return r ? toInfo(r) : null;
}

/** Hedefin (ör. "proposal", id) tüm analizleri, en yeniden eskiye. */
export function listAnalyses(ctx: Pick<CoreContext, "db">, targetType: string, targetId: string): AiAnalysisInfo[] {
  return ctx.db
    .all<AiRow>("SELECT * FROM ai_analyses WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC, id ASC", targetType, targetId)
    .map(toInfo);
}

/** İnsan onayı (yetki kontrolü çağıranındır). İlk onay kalıcıdır; tekrar çağrı mevcut kaydı döndürür. */
export function approveAnalysis(ctx: Pick<CoreContext, "db">, id: string, userId: string): AiAnalysisInfo {
  const cur = getAnalysis(ctx, id);
  if (!cur) throw notFound("Yapay zekâ analizi");
  if (!cur.approvedBy) ctx.db.run("UPDATE ai_analyses SET approved_by = ? WHERE id = ? AND approved_by IS NULL", userId, id);
  return getAnalysis(ctx, id)!;
}
