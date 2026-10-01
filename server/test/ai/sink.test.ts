import { describe, expect, it } from "vitest";
import { AI_LABEL_PREFIX, OFFLINE_MODEL, hashCanonical } from "@forum/shared";
import { aiHashes, approveAnalysis, createAiRecordSink, createAiService, getAnalysis, listAnalyses, PROMPT_VERSION } from "../../src/ai";
import { AppError } from "../../src/core/errors";
import { FakeLedger, makeCtx } from "../helpers/fakes";

const SECRET_TEXT = "Gizli özet cümlesi: K3 akşam seferlerine karşı.";

async function summaryAnalysis() {
  const ctx = makeCtx();
  const ai = createAiService(ctx, { client: null });
  const input = { topicTitle: "Seferler", messages: [{ id: "m1", pseudonym: "K3", clusterId: null, stance: "con", body: SECRET_TEXT }] };
  const out = await ai.summarize(input);
  return { ctx, input, out };
}

describe("AiRecordSink", () => {
  it("ai_analyses satırı yazar, AI_ANALYSIS defter kaydında çıktı metni yoktur", async () => {
    const { ctx, input, out } = await summaryAnalysis();
    const ledger = new FakeLedger(ctx.clock);
    const sink = createAiRecordSink(ctx, { ledger });
    const hashes = aiHashes(input, out);
    const a = sink.record({
      task: "summarize",
      targetType: "proposal",
      targetId: "p-1",
      model: out.model,
      offline: out.offline,
      output: out,
      approvedBy: null,
      promptVersion: PROMPT_VERSION,
      ...hashes,
    });

    expect(a.id).toMatch(/[0-9a-f-]{36}/);
    expect(a.task).toBe("summarize");
    expect(a.model).toBe(OFFLINE_MODEL);
    expect(a.offline).toBe(true);
    expect(a.output).toEqual(out);
    expect(a.createdAt).toBe(ctx.clock.now());
    expect(a.label).toBe("Yapay zekâ ile üretildi · çevrimdışı sezgisel mod · 01.10.2026 09:00 UTC");
    expect(a.label.startsWith(AI_LABEL_PREFIX + " · ")).toBe(true);
    expect(a.approvedBy).toBeNull();

    const row = ctx.db.get<Record<string, unknown>>("SELECT * FROM ai_analyses WHERE id = ?", a.id)!;
    expect(row.prompt_version).toBe("fy-ai/1");
    expect(row.input_hash).toBe(hashCanonical(input));
    expect(row.output_hash).toBe(hashCanonical(out));
    expect(row.offline).toBe(1);
    expect(JSON.parse(String(row.output))).toEqual(out);

    expect(ledger.txs).toHaveLength(1);
    const tx = ledger.txs[0];
    expect(tx.type).toBe("AI_ANALYSIS");
    expect(Object.keys(tx.payload).sort()).toEqual(["analysisId", "inputHash", "model", "offline", "outputHash", "promptVersion", "targetId", "targetType", "task"]);
    expect(tx.payload).toMatchObject({ analysisId: a.id, task: "summarize", targetType: "proposal", targetId: "p-1", model: OFFLINE_MODEL, offline: true, promptVersion: "fy-ai/1", ...hashes });
    const payload = JSON.stringify(tx.payload);
    expect(payload).not.toContain("Gizli özet");
    expect(payload).not.toContain("akşam");
    expect(a.ledgerTx).toBe(tx.hash);
    expect(row.ledger_tx).toBe(tx.hash);
  });

  it("defter yoksa ya da hata verirse kayıt yine yapılır (ledgerTx null)", () => {
    const ctx = makeCtx();
    const base = { task: "moderate" as const, targetType: "message", targetId: "msg-1", model: "claude-opus-5-5", offline: false, output: { risk: 0 }, approvedBy: null, promptVersion: PROMPT_VERSION, inputHash: "a".repeat(64), outputHash: "b".repeat(64) };
    const a = createAiRecordSink(ctx, { ledger: null }).record(base);
    expect(a.ledgerTx).toBeNull();
    expect(a.label).toBe("Yapay zekâ ile üretildi · claude-opus-5-5 · 01.10.2026 09:00 UTC");
    const broken = new FakeLedger();
    broken.submit = () => {
      throw new Error("defter kapalı");
    };
    const b = createAiRecordSink(ctx, { ledger: broken }).record(base);
    expect(b.ledgerTx).toBeNull();
    expect(getAnalysis(ctx, b.id)?.id).toBe(b.id);
  });
});

describe("getAnalysis / listAnalyses / approveAnalysis", () => {
  it("listeler, onaylar, bulunamayınca 404 verir", () => {
    const ctx = makeCtx();
    const sink = createAiRecordSink(ctx, { ledger: null });
    const rec = (targetId: string, task: "summarize" | "bridging_drafts") =>
      sink.record({ task, targetType: "proposal", targetId, model: OFFLINE_MODEL, offline: true, output: { n: targetId }, approvedBy: null, promptVersion: PROMPT_VERSION, inputHash: "0".repeat(64), outputHash: "1".repeat(64) });
    const a1 = rec("p-1", "summarize");
    ctx.clock.advance(60_000);
    const a2 = rec("p-1", "bridging_drafts");
    rec("p-2", "summarize");

    expect(listAnalyses(ctx, "proposal", "p-1").map((x) => x.id)).toEqual([a2.id, a1.id]);
    expect(listAnalyses(ctx, "proposal", "yok")).toEqual([]);
    expect(getAnalysis(ctx, "yok")).toBeNull();
    expect(getAnalysis(ctx, a2.id)?.label).toBe("Yapay zekâ ile üretildi · çevrimdışı sezgisel mod · 01.10.2026 09:01 UTC");

    const ok = approveAnalysis(ctx, a2.id, "u-yazar");
    expect(ok.approvedBy).toBe("u-yazar");
    expect(approveAnalysis(ctx, a2.id, "u-baska").approvedBy).toBe("u-yazar");
    expect(getAnalysis(ctx, a1.id)?.approvedBy).toBeNull();

    try {
      approveAnalysis(ctx, "yok", "u");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).status).toBe(404);
      expect((e as AppError).message).toContain("Yapay zekâ analizi");
    }
  });
});
