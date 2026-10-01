import { describe, expect, it } from "vitest";
import { fy, generateTckn, OFFLINE_MODEL } from "@forum/shared";
import { createAiService, PROMPT_VERSION } from "../../src/ai";
import type { SummaryInputMessage } from "../../src/core/contracts";
import { makeCtx } from "../helpers/fakes";
import { classifyCtx, fakeClient, jsonResponse, moderateCtx } from "./fixtures";

const TCKN = generateTckn("567891234");
const IBAN = "TR33 0006 1005 1978 6457 8413 26";
const PHONE = "0532 987 65 43";
const EMAIL = "zeynep.kaya@ornek.com";

const classifyOk = {
  categories: [{ iri: fy("TopluTasima"), confidence: 0.92 }],
  rightsAffected: [{ right: fy("ErisimHakki"), direction: "expand", confidence: 0.4 }],
  contentLabels: [],
  rationale: "Öneri otobüs seferleriyle ilgilidir.",
};

const input = { title: "Otobüs seferleri artırılsın", body: "Akşamları otobüs az." };

describe("Claude çağrısı", () => {
  it("doğru parametrelerle çağırır ve yapılandırılmış yanıtı kullanır", async () => {
    const { client, calls } = fakeClient(() => jsonResponse(classifyOk));
    const ai = createAiService(makeCtx(), { client });
    expect(ai.mode()).toBe("claude");
    expect(ai.model()).toBe("claude-opus-5-5");
    const r = await ai.classifyProposal(input, classifyCtx);
    expect(r.offline).toBe(false);
    expect(r.model).toBe("claude-opus-5-5");
    expect(r.categories).toEqual([{ iri: fy("TopluTasima"), confidence: 0.92 }]);
    expect(r.rightsAffected).toEqual([{ right: fy("ErisimHakki"), direction: "expand", confidence: 0.4 }]);
    expect(r.rationale).toBe(classifyOk.rationale);

    expect(calls).toHaveLength(1);
    const p = calls[0].params;
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.max_tokens).toBe(16000);
    expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(p.fallbacks).toBe("default");
    expect(p.thinking).toEqual({ type: "adaptive" });
    expect(p.output_config.effort).toBe("low");
    expect(p.output_config.format.type).toBe("json_schema");
    expect(p.output_config.format.schema.additionalProperties).toBe(false);
    expect(p.output_config.format.schema.required).toEqual(["categories", "rightsAffected", "contentLabels", "rationale"]);
    expect(p.output_config.format.schema.properties.categories.items.properties.iri.enum).toContain(fy("TopluTasima"));
    for (const k of ["temperature", "top_p", "top_k", "budget_tokens"]) expect(p).not.toHaveProperty(k);
    expect(p.thinking).not.toHaveProperty("budget_tokens");
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].role).toBe("user");
    expect(p.messages.some((m: { role: string }) => m.role === "assistant")).toBe(false);
    expect(p.system).toContain("Yalnızca danışmansın");
    expect(p.system).toContain("Hukuki nitelendirme yapmazsın");
    expect(calls[0].opts.timeout).toBe(60_000);
    expect(PROMPT_VERSION).toBe("fy-ai/1");
  });

  it("şema JSON Schema kısıtları: her nesnede additionalProperties:false + required; sayısal sınır yok", async () => {
    const { client, calls } = fakeClient(() => jsonResponse({ issues: [] }));
    const ai = createAiService(makeCtx(), { client });
    await ai.lintExpertReport("Rapor metni.");
    const walk = (s: any): void => {
      if (!s || typeof s !== "object") return;
      if (s.type === "object") {
        expect(s.additionalProperties).toBe(false);
        expect(s.required).toEqual(Object.keys(s.properties));
      }
      for (const k of ["minimum", "maximum", "minItems", "maxItems", "minLength", "maxLength"]) expect(s).not.toHaveProperty(k);
      for (const v of Object.values(s)) walk(v);
    };
    walk(calls[0].params.output_config.format.schema);
  });

  it("görev başına effort: summarize/bridging medium", async () => {
    const { client, calls } = fakeClient((p) =>
      p.output_config.format.schema.properties.drafts
        ? jsonResponse({ drafts: Array.from({ length: 5 }, (_, i) => ({ title: `T${i}`, body: "Gövde", rationale: "Gerekçe" })) })
        : jsonResponse({ commonGround: [], contested: [], minorityViews: [{ text: "Azınlık", cites: ["m1"] }], openQuestions: [] }),
    );
    const ai = createAiService(makeCtx(), { client });
    const b = await ai.bridgingDrafts({ title: "X", body: "Y", majorityPoints: ["a"], minorityPoints: ["b"] });
    expect(b.offline).toBe(false);
    expect(b.drafts).toHaveLength(5);
    await ai.summarize({ topicTitle: "X", messages: [{ id: "id-1", pseudonym: "K1", clusterId: null, stance: "pro", body: "Merhaba" }] });
    expect(calls.map((c) => c.params.output_config.effort)).toEqual(["medium", "medium"]);
  });

  it("yedek modelin yanıtı: fallback/thinking blokları atlanır, yanıtlayan model yansıtılır", async () => {
    const { client } = fakeClient(() => ({
      ...jsonResponse(classifyOk),
      model: "claude-opus-5",
      content: [
        { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-5" } },
        { type: "thinking", thinking: "", signature: "s" },
        { type: "text", text: JSON.stringify(classifyOk).slice(0, 20) },
        { type: "text", text: JSON.stringify(classifyOk).slice(20) },
      ],
    }));
    const r = await createAiService(makeCtx(), { client }).classifyProposal(input, classifyCtx);
    expect(r.offline).toBe(false);
    expect(r.model).toBe("claude-opus-5");
    expect(r.categories[0].iri).toBe(fy("TopluTasima"));
  });
});

describe("çevrimdışı yedeğe düşme (asla hata fırlatmaz)", () => {
  const cases: [string, () => unknown][] = [
    ["stop_reason: refusal (içerik okunmaz)", () => ({ ...jsonResponse(classifyOk), stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" } })],
    ["stop_reason: max_tokens", () => ({ ...jsonResponse(classifyOk), stop_reason: "max_tokens" })],
    ["geçersiz JSON", () => ({ ...jsonResponse(null), content: [{ type: "text", text: "{bu json değil" }] })],
    ["şemaya uymayan JSON", () => jsonResponse({ categories: "TopluTasima", rationale: 5 })],
    ["listede olmayan IRI", () => jsonResponse({ ...classifyOk, categories: [{ iri: fy("Uydurma"), confidence: 0.9 }] })],
    ["metin bloğu yok", () => ({ ...jsonResponse(null), content: [{ type: "thinking", thinking: "" }] })],
    ["boş yanıt", () => null],
    [
      "istemci hata fırlatır",
      () => {
        throw new Error("529 overloaded");
      },
    ],
    ["istemci reddedilen söz döndürür", () => Promise.reject(new Error("ECONNRESET"))],
  ];
  for (const [name, respond] of cases) {
    it(name, async () => {
      const { client, calls } = fakeClient(respond);
      const ai = createAiService(makeCtx(), { client });
      const r = await ai.classifyProposal(input, classifyCtx);
      expect(calls).toHaveLength(1);
      expect(r.offline).toBe(true);
      expect(r.model).toBe(OFFLINE_MODEL);
      expect(r.categories[0].iri).toBe(fy("TopluTasima"));
    });
  }

  it("zaman aşımı → çevrimdışı (istek iptal edilir)", async () => {
    let signal: AbortSignal | undefined;
    const client = {
      beta: {
        messages: {
          create: (_p: unknown, opts: { signal: AbortSignal }) => {
            signal = opts.signal;
            return new Promise(() => {});
          },
        },
      },
    };
    const ai = createAiService(makeCtx(), { client, timeoutMs: 30 });
    const r = await ai.moderate("seni bulacağım", moderateCtx);
    expect(r.offline).toBe(true);
    expect(r.labels).toContain(fy("Tehdit"));
    expect(signal?.aborted).toBe(true);
  });

  it("diğer görevler de yedeğe düşer", async () => {
    const { client } = fakeClient(() => ({ ...jsonResponse({}), stop_reason: "refusal" }));
    const ai = createAiService(makeCtx(), { client });
    expect((await ai.moderate("aptal", moderateCtx)).offline).toBe(true);
    const s = await ai.summarize({ topicTitle: "X", messages: [{ id: "a", pseudonym: "K1", clusterId: null, stance: "pro", body: "Evet" }] });
    expect(s.offline).toBe(true);
    expect(s.minorityViews.length).toBeGreaterThan(0);
    const b = await ai.bridgingDrafts({ title: "X", body: "", majorityPoints: [], minorityPoints: [] });
    expect(b.offline).toBe(true);
    expect(b.drafts.length).toBeGreaterThanOrEqual(4);
    expect((await ai.lintExpertReport("Bu suç teşkil eder.")).issues[0].kind).toBe("legal_qualification");
  });

  it("bridging: 4'ten az taslak şemaya uymaz → çevrimdışı", async () => {
    const { client } = fakeClient(() => jsonResponse({ drafts: [{ title: "T", body: "B", rationale: "R" }] }));
    const b = await createAiService(makeCtx(), { client }).bridgingDrafts({ title: "X", body: "", majorityPoints: [], minorityPoints: [] });
    expect(b.offline).toBe(true);
    expect(b.drafts).toHaveLength(4);
  });
});

describe("forceOffline (YZ rızası yok)", () => {
  it("istemci varken bile Claude'a gitmez", async () => {
    const { client, calls } = fakeClient(() => jsonResponse(classifyOk));
    const ai = createAiService(makeCtx(), { client });
    const o = { forceOffline: true };
    const c = await ai.classifyProposal(input, classifyCtx, o);
    const m = await ai.moderate("aptal", moderateCtx, o);
    const s = await ai.summarize({ topicTitle: "X", messages: [{ id: "a", pseudonym: "K1", clusterId: null, stance: "pro", body: "Evet" }] }, o);
    const b = await ai.bridgingDrafts({ title: "X", body: "", majorityPoints: [], minorityPoints: [] }, o);
    const l = await ai.lintExpertReport("Rapor.", o);
    expect(calls).toHaveLength(0);
    for (const r of [c, m, s, b, l]) {
      expect(r.offline).toBe(true);
      expect(r.model).toBe(OFFLINE_MODEL);
    }
    await ai.classifyProposal(input, classifyCtx, { forceOffline: false });
    expect(calls).toHaveLength(1);
  });
});

describe("Claude'a gitmeden önce maskeleme", () => {
  const secrets = [TCKN, IBAN, IBAN.replace(/ /g, ""), PHONE, "987 65 43", EMAIL, "zeynep.kaya", "ahmet_b", "Atatürk Mah. Gül Sok."];
  const piiText = `Komşum @ahmet_b (TC ${TCKN}) parka çöp atıyor; telefonu ${PHONE}, e-postası ${EMAIL}, IBAN ${IBAN}, adresi Atatürk Mah. Gül Sok. No: 4.`;

  it("hiçbir istek gövdesinde TCKN/e-posta/telefon/IBAN/adres/takma ad yok", async () => {
    const { client, calls } = fakeClient(() => ({ ...jsonResponse({}), stop_reason: "refusal" }));
    const ai = createAiService(makeCtx(), { client });
    const msgs: SummaryInputMessage[] = [
      { id: "x1", pseudonym: "K1", clusterId: "g0", stance: "pro", body: piiText },
      { id: "x2", pseudonym: "K2", clusterId: "g1", stance: "con", body: `@ahmet_b yanılıyor, ${EMAIL} adresine yazdım.` },
    ];
    await ai.classifyProposal({ title: `Şikâyet: @ahmet_b ${PHONE}`, body: piiText }, classifyCtx);
    await ai.moderate(piiText, moderateCtx);
    await ai.summarize({ topicTitle: `Konu ${EMAIL}`, messages: msgs });
    await ai.bridgingDrafts({ title: "X", body: piiText, majorityPoints: [piiText], minorityPoints: [`${TCKN} numaralı kişi`] });
    await ai.lintExpertReport(`Bilirkişi notu: ${piiText}`);
    expect(calls).toHaveLength(5);
    for (const c of calls) {
      const body = JSON.stringify(c.params);
      for (const s of secrets) expect(body, s).not.toContain(s);
      expect(body).toContain("[TCKN]");
      expect(body).toContain("[TELEFON]");
      expect(body).toContain("[E-POSTA]");
      expect(body).toContain("@K");
    }
    const sum = JSON.stringify(calls[2].params);
    expect(sum).toContain("[IBAN]");
    expect(sum).toContain("[ADRES]");
    expect(sum).toContain('yazar=\\"K1\\"');
    expect(sum).not.toContain("x1");
  });

  it("K-kodu olmayan takma adlar da K-koduna çevrilir", async () => {
    const { client, calls } = fakeClient(() => ({ ...jsonResponse({}), stop_reason: "refusal" }));
    await createAiService(makeCtx(), { client }).summarize({
      topicTitle: "X",
      messages: [{ id: "a", pseudonym: "gercek_takma_ad", clusterId: null, stance: "pro", body: "Merhaba" }],
    });
    expect(JSON.stringify(calls[0].params)).not.toContain("gercek_takma_ad");
  });
});

describe("Claude çıktısının işlenmesi", () => {
  it("summarize: kısa kimlikler mesaj kimliklerine çevrilir, bilinmeyenler atılır, kapsama yerelde hesaplanır", async () => {
    const msgs: SummaryInputMessage[] = [
      { id: "u-1", pseudonym: "K1", clusterId: "g0", stance: "pro", body: "Seferler artsın." },
      { id: "u-2", pseudonym: "K2", clusterId: "g0", stance: "pro", body: "Kesinlikle artsın." },
      { id: "u-3", pseudonym: "K3", clusterId: "g1", stance: "con", body: "Gürültü olur." },
      { id: "u-4", pseudonym: "K4", clusterId: "g1", stance: "question", body: "Maliyeti nedir?" },
    ];
    const { client } = fakeClient(() =>
      jsonResponse({
        commonGround: [{ text: "Herkes ulaşımı önemsiyor.", cites: ["m1", "m3"] }],
        contested: [{ text: "Gürültü konusunda ayrışma var.", cites: ["m2", "m3", "m3"] }],
        minorityViews: [],
        openQuestions: [{ text: "Maliyet soruluyor.", cites: ["m4"] }],
      }),
    );
    const s = await createAiService(makeCtx(), { client }).summarize({ topicTitle: "Seferler", messages: msgs });
    expect(s.offline).toBe(false);
    expect(s.model).toBe("claude-opus-5-5");
    expect(s.commonGround[0].cites).toEqual(["u-1", "u-3"]);
    expect(s.contested[0].cites).toEqual(["u-2", "u-3"]);
    expect(s.openQuestions[0].cites).toEqual(["u-4"]);
    // Claude azınlık bölümünü boş bıraktı → çevrimdışı azınlık maddeleriyle doldurulur.
    expect(s.minorityViews.length).toBeGreaterThan(0);
    expect(s.coverage).toBe(1);
  });

  it("moderate: yerel PII tespiti eklenir, risk yükseltilir, alıntı konumları özgün metinde bulunur", async () => {
    const text = `Şu kişi çok kaba davranıyor, numarası ${PHONE}.`;
    const { client } = fakeClient(() =>
      jsonResponse({ risk: 1, labels: [fy("HakaretIftira")], articleIds: [fy("Madde4")], spans: [{ quote: "çok kaba davranıyor" }, { quote: "uydurma alıntı" }], rationale: "Kaba ifade." }),
    );
    const r = await createAiService(makeCtx(), { client }).moderate(text, moderateCtx);
    expect(r.offline).toBe(false);
    expect(r.risk).toBe(2);
    expect(r.labels).toEqual([fy("HakaretIftira"), fy("KisiselVeriIfsasi")]);
    expect(r.pii.map((p) => p.kind)).toEqual(["phone"]);
    expect(r.spans[0]).toEqual({ start: text.indexOf("çok kaba"), end: text.indexOf("çok kaba") + "çok kaba davranıyor".length, quote: "çok kaba davranıyor" });
    expect(r.spans).toHaveLength(2);
    expect(r.spans[1].quote).not.toContain("987");
    expect(r.articleIds).toEqual([fy("Madde4")]);
  });

  it("lint: Claude'un kaçırdığı hukuki nitelendirme yerel kuralla eklenir", async () => {
    const { client } = fakeClient(() => jsonResponse({ issues: [{ quote: "Proje kesinlikle başarılı olur.", kind: "overclaim", message: "Aşırı kesin." }] }));
    const r = await createAiService(makeCtx(), { client }).lintExpertReport("Proje kesinlikle başarılı olur. Uygulama hukuka aykırıdır.");
    expect(r.offline).toBe(false);
    expect(r.issues.map((i) => i.kind)).toEqual(["overclaim", "legal_qualification"]);
  });

  it("classify: güven 0..1 aralığına kırpılır; kişisel veri etiketi yerelde eklenir", async () => {
    const { client } = fakeClient(() => jsonResponse({ ...classifyOk, categories: [{ iri: fy("TopluTasima"), confidence: 1.7 }] }));
    const r = await createAiService(makeCtx(), { client }).classifyProposal({ title: "Otobüs", body: `Şoförün telefonu ${PHONE}` }, classifyCtx);
    expect(r.categories[0].confidence).toBe(1);
    expect(r.contentLabels.map((l) => l.label)).toContain(fy("KisiselVeriIfsasi"));
  });
});
