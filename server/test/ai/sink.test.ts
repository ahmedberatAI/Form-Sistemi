import { describe, expect, it } from "vitest";
import { AI_LABEL_PREFIX, OFFLINE_MODEL, hashCanonical } from "@forum/shared";
import { aiHashes, approveAnalysis, createAiRecordSink, createAiService, getAnalysis, listAnalyses, PROMPT_VERSION } from "../../src/ai";
import { AppError } from "../../src/core/errors";
import type { AiRecordSink } from "../../src/core/contracts";
import { FakeAiSink, FakeLedger, makeCtx } from "../helpers/fakes";

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
    expect(row.prompt_version).toBe("fy-ai/2");
    expect(row.input_hash).toBe(hashCanonical(input));
    expect(row.output_hash).toBe(hashCanonical(out));
    expect(row.offline).toBe(1);
    expect(JSON.parse(String(row.output))).toEqual(out);

    expect(ledger.txs).toHaveLength(1);
    const tx = ledger.txs[0];
    expect(tx.type).toBe("AI_ANALYSIS");
    expect(Object.keys(tx.payload).sort()).toEqual(["analysisId", "inputHash", "model", "offline", "outputHash", "promptVersion", "targetId", "targetType", "task"]);
    expect(tx.payload).toMatchObject({ analysisId: a.id, task: "summarize", targetType: "proposal", targetId: "p-1", model: OFFLINE_MODEL, offline: true, promptVersion: "fy-ai/2", ...hashes });
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

describe("AiRecordSink arayüzü: record/get/list/approve (gerçek ve sahte aynı sözleşme)", () => {
  const impls: { name: string; make: () => { sink: AiRecordSink; advance: (ms: number) => void } }[] = [
    {
      name: "createAiRecordSink",
      make: () => {
        const ctx = makeCtx();
        return { sink: createAiRecordSink(ctx, { ledger: new FakeLedger(ctx.clock) }), advance: (ms) => ctx.clock.advance(ms) };
      },
    },
    {
      name: "FakeAiSink",
      make: () => {
        const ctx = makeCtx();
        return { sink: new FakeAiSink(ctx.clock), advance: (ms) => ctx.clock.advance(ms) };
      },
    },
  ];
  for (const impl of impls) {
    it(`${impl.name}: en yeniden eskiye listeler, ilk onay kalıcı, bilinmeyende 404; promptVersion isteğe bağlı`, () => {
      const { sink, advance } = impl.make();
      const rec = (targetId: string) =>
        sink.record({ task: "summarize", targetType: "proposal", targetId, model: OFFLINE_MODEL, offline: true, output: { n: targetId }, approvedBy: null, inputHash: "0".repeat(64), outputHash: "1".repeat(64) });
      const a1 = rec("p-1");
      advance(60_000);
      const a2 = rec("p-1");
      rec("p-2");
      expect(sink.list("proposal", "p-1").map((x) => x.id)).toEqual([a2.id, a1.id]);
      expect(sink.list("proposal", "yok")).toEqual([]);
      expect(sink.get(a1.id)).toEqual(a1);
      expect(sink.get("yok")).toBeNull();
      expect(sink.approve(a2.id, "u-yazar").approvedBy).toBe("u-yazar");
      expect(sink.approve(a2.id, "u-baska").approvedBy).toBe("u-yazar");
      expect(sink.get(a1.id)?.approvedBy).toBeNull();
      expect(() => sink.approve("yok", "u")).toThrow(AppError);
      expect(a1.label.startsWith(AI_LABEL_PREFIX + " · ")).toBe(true);
    });
  }

  for (const impl of impls) {
    it(`${impl.name}: findByInput aynı görev + hedef + girdi özeti için en son kaydı bulur (#224)`, () => {
      const { sink, advance } = impl.make();
      const rec = (task: "summarize" | "bridging_drafts", targetId: string, inputHash: string) =>
        sink.record({ task, targetType: "proposal", targetId, model: OFFLINE_MODEL, offline: true, output: null, approvedBy: null, inputHash, outputHash: "1".repeat(64) });
      const h1 = "a".repeat(64);
      const h2 = "b".repeat(64);
      const first = rec("summarize", "p-1", h1);
      advance(60_000);
      const newest = rec("summarize", "p-1", h1);
      rec("summarize", "p-1", h2);
      rec("bridging_drafts", "p-1", h1);
      rec("summarize", "p-2", h1);
      expect(sink.findByInput("summarize", "proposal", "p-1", h1)?.id).toBe(newest.id);
      expect(sink.findByInput("summarize", "proposal", "p-1", h1)?.id).not.toBe(first.id);
      expect(sink.findByInput("bridging_drafts", "proposal", "p-1", h1)?.task).toBe("bridging_drafts");
      expect(sink.findByInput("summarize", "proposal", "p-1", "c".repeat(64))).toBeNull();
      expect(sink.findByInput("summarize", "proposal", "yok", h1)).toBeNull();
      expect(sink.findByInput("summarize", "message", "p-1", h1)).toBeNull();
    });
  }

  it("gerçek depo: promptVersion verilmezse güncel istem sürümü yazılır (defter kaydı dahil)", () => {
    const ctx = makeCtx();
    const ledger = new FakeLedger(ctx.clock);
    const a = createAiRecordSink(ctx, { ledger }).record({ task: "moderate", targetType: "message", targetId: "m", model: OFFLINE_MODEL, offline: true, output: null, approvedBy: null, inputHash: "a".repeat(64), outputHash: "b".repeat(64) });
    expect(ctx.db.get<{ v: string }>("SELECT prompt_version AS v FROM ai_analyses WHERE id = ?", a.id)?.v).toBe(PROMPT_VERSION);
    expect(ledger.txs[0].payload.promptVersion).toBe(PROMPT_VERSION);
  });
});
