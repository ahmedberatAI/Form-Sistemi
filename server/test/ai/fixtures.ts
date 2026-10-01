// YZ testleri için ortak veriler: ontoloji sözlüğünden bağlamlar ve sahte Anthropic istemcisi.
import { CATEGORY_VOCAB, CONTENT_LABEL_VOCAB, RIGHT_VOCAB, fy } from "@forum/shared";
import type { AnthropicLike } from "../../src/ai";

export const classifyCtx = {
  categories: CATEGORY_VOCAB.map((c) => ({ iri: fy(c.local), label: c.label, keywords: c.keywords })),
  rights: RIGHT_VOCAB.map((r) => ({ iri: fy(r.local), label: r.label })),
  contentLabels: CONTENT_LABEL_VOCAB.map((l) => ({ iri: fy(l.local), label: l.label })),
};

export const moderateCtx = {
  articles: [
    { iri: fy("Madde4"), number: "Madde 4", title: "Saygılı tartışma ve hakaret yasağı" },
    { iri: fy("Madde7"), number: "Madde 7", title: "Tehdit ve şiddet yasağı" },
    { iri: fy("Madde9"), number: "Madde 9", title: "Kişisel verilerin korunması" },
    { iri: fy("Madde12"), number: "Madde 12", title: "Spam ve reklam" },
  ],
  contentLabels: classifyCtx.contentLabels,
};

export interface FakeCall {
  params: any;
  opts: any;
}

/** Ağa çıkmayan sahte istemci; her çağrıyı kaydeder. */
export function fakeClient(respond: (params: any, n: number) => unknown): { client: AnthropicLike; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  return {
    calls,
    client: {
      beta: {
        messages: {
          async create(params: any, opts?: any) {
            calls.push({ params, opts });
            return respond(params, calls.length);
          },
        },
      },
    },
  };
}

/** Yapılandırılmış çıktı yanıtı (önde düşünce ve yedek blokları ile). */
export function jsonResponse(data: unknown, extra: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    stop_reason: "end_turn",
    content: [
      { type: "thinking", thinking: "", signature: "x" },
      { type: "text", text: JSON.stringify(data) },
    ],
    usage: { input_tokens: 10, output_tokens: 10 },
    ...extra,
  };
}
