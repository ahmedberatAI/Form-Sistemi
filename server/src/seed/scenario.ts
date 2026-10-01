// Tohum senaryosu: hesaplar, graf ve 1 Eylül'den "bugün"e uzanan karar geçmişi. Erken bölüm başlangıca (S),
// tohum sonunda açık kalacak öneriler bitişe (E) göre zamanlanır; her evre geçişinde ilgili kanca çalışır.
import { fy, type CreateProposalRequest, type RegistrationInput, type Role } from "@forum/shared";
import { DAY, HOUR } from "../core/clock";
import * as C from "./content";
import type { MsgSpec, ProposalSpec } from "./content";
import { SeedEngine, type PhaseEvent, type VoteSpec } from "./engine";
import { PEOPLE, registrationFor, type Person } from "./people";

interface ReportSpec {
  assessment: "feasible" | "infeasible" | "uncertain";
  confidence: number;
  risks: string[];
  body: string;
  dissent?: string;
  answers: string[];
}

interface Plan {
  spec: ProposalSpec;
  votes?: VoteSpec;
  votes2?: VoteSpec;
  expert?: { questions: MsgSpec[]; reports: ReportSpec[]; reportAfterHours: number };
  onEvent?: (ev: PhaseEvent) => Promise<void> | void;
}

/** Senaryonun önemli örnekleri (özet ve doğrulama için). */
export interface ScenarioKeys {
  contestedClosed: string;
  contestedRevote: string;
  contestedReconciliation: string;
  objectionPath: string;
  objectionWindow: string;
  voting: string;
  deliberationExpert: string;
  expertClosed: string;
  hiddenDeletion: string;
  piiDeletion: string;
  invalidDeletion: string;
  immutablePatch: string;
  regulation: string;
  amendment: string;
}

export const KEYS: ScenarioKeys = {
  contestedClosed: "C1",
  contestedRevote: "C2",
  contestedReconciliation: "C3",
  objectionPath: "O1",
  objectionWindow: "OW1",
  voting: "V1",
  deliberationExpert: "SG1",
  expertClosed: "EN1",
  hiddenDeletion: "D1",
  piiDeletion: "D2",
  invalidDeletion: "G1",
  immutablePatch: "RT3",
  regulation: "R1",
  amendment: "AM1",
};

export async function runScenario(e: SeedEngine, opts: { start: number; end: number }): Promise<void> {
  const { start: S, end: E } = opts;
  const s = e.s;
  const regs = await setupAccounts(e);
  setupGraph(e);
  await s.ledger.flush();
  e.log(`Hesaplar hazır: ${e.users.size} kişi; graf kenarları eklendi.`);

  // ───────────── Plan yardımcıları ─────────────

  const plans = new Map<string, Plan>();

  async function expertFlow(key: string, ex: NonNullable<Plan["expert"]>): Promise<void> {
    const id = e.proposalId(key);
    if (!(await e.ensurePanel(key))) {
      e.problem(`${key}: bilirkişi paneli çekilemedi`);
      return;
    }
    e.scheduleIn(2 * HOUR, `${key} bilirkişi kabulü ve sorular`, async () => {
      const panel = s.experts.panel(id);
      for (const a of panel?.assignments ?? []) {
        if (a.status === "invited") await s.experts.respond(a.id, a.expertId, "accept");
      }
      for (const q of ex.questions) {
        e.jitter(10 * 60_000, 40 * 60_000);
        s.forum.proposals.expertQuestion(e.auth(e.resolveAuthor(q.by)), id, q.text);
      }
    });
    e.scheduleIn(ex.reportAfterHours * HOUR, `${key} bilirkişi raporları`, async () => {
      const panel = s.experts.panel(id);
      if (!panel) return;
      const questions = panel.questions;
      const open = panel.assignments.filter((a) => a.status === "accepted" || a.status === "invited");
      for (let i = 0; i < ex.reports.length && i < open.length; i++) {
        const r = ex.reports[i];
        const a = open[i];
        e.jitter(30 * 60_000, 3 * HOUR);
        await s.experts.submitReport(a.id, a.expertId, {
          assessment: r.assessment,
          confidence: r.confidence,
          risks: r.risks,
          answers: questions.map((q, j) => (r.answers[j] ? { questionId: q.id, answer: r.answers[j] } : null)).filter((x): x is { questionId: string; answer: string } => !!x),
          body: r.body,
          dissent: r.dissent ?? null,
        });
      }
    });
  }

  function logSnapshot(key: string): void {
    const snap = s.forum.clusters.latest();
    if (!snap) return;
    const cOf = (n: string) => snap.points.find((p) => p.userId === e.user(n).id)?.clusterId ?? "—";
    const cMembers = e.blockMembers("C", { experts: true }).map(cOf).join(",");
    e.log(`    küme görüntüsü (${key}): k=${snap.k}, boyutlar ${snap.clusters.map((c) => `${c.clusterId}:${c.size}`).join(" ")}, C bloğu → ${cMembers}`);
  }

  function handlerFor(plan: Plan) {
    const key = plan.spec.key;
    return async (ev: PhaseEvent) => {
      const id = e.proposalId(key);
      if (ev.to === "deliberation" && ev.from === "sponsoring") {
        if (plan.spec.messages?.length && !e.threadMessages.has(key)) await e.postThread(key, "proposal", id, plan.spec.messages);
        if (plan.expert) await expertFlow(key, plan.expert);
      }
      if (ev.to === "voting" && ev.from === "deliberation") {
        logSnapshot(key);
        if (plan.votes) await e.castVotes(key, 1, plan.votes);
      }
      if (ev.to === "voting" && ev.from === "voting") e.log(`    ${key}: oylama bir kez uzatıldı (katılım ya da küme oyu yetersiz).`);
      if (ev.to === "revote" && plan.votes2) await e.castVotes(key, 2, plan.votes2);
      if (ev.to === "enacted" && (plan.spec.kind === "topic" || plan.spec.kind === "subtopic") && plan.spec.topicMessages?.length) {
        const msgs = plan.spec.topicMessages;
        e.scheduleIn(5 * HOUR, `${key} konu mesajları`, async () => {
          await e.postThread(`topic:${key}`, "topic", e.topicOf(key), msgs);
        });
      }
      await plan.onEvent?.(ev);
    };
  }

  async function create(plan: Plan, opts: { sponsors?: number; submit?: boolean; postNow?: boolean } = {}): Promise<void> {
    plans.set(plan.spec.key, plan);
    const spec = plan.spec;
    const input: CreateProposalRequest = {
      kind: spec.kind,
      title: spec.title,
      body: spec.body,
      categories: spec.categories.map((c) => fy(c)),
      submit: opts.submit !== false,
    };
    if (spec.parent) {
      const topicId = e.topicOf(spec.parent);
      input.parentTopicId = topicId;
      if (spec.kind === "amendment") input.amendment = { baseVersion: s.forum.topics.get(topicId, null).version, newTitle: spec.title, newBody: spec.body };
    }
    if (spec.patch) input.regulationPatch = spec.patch;
    const d = await s.forum.proposals.create(e.auth(spec.author), input);
    e.register(spec.key, d.id, handlerFor(plan));
    e.log(`  #K-${d.seq} (${spec.key}) oluşturuldu: ${spec.title}`);
    if (opts.submit === false) return;
    if (opts.postNow && spec.messages?.length) await e.postThread(spec.key, "proposal", d.id, spec.messages);
    await e.sponsor(spec.key, spec.author, opts.sponsors);
  }

  async function createDeletion(
    plan: Plan & { requester: string; targetMessageId: string; ground: string; statement: string; title: string },
  ): Promise<void> {
    plans.set(plan.spec.key, plan);
    const d = await s.forum.proposals.create(e.auth(plan.requester), {
      kind: "deletion",
      title: plan.title,
      body: plan.statement,
      categories: [],
      deletion: { messageIds: [plan.targetMessageId], ground: fy(plan.ground), statement: plan.statement },
      submit: true,
    });
    e.register(plan.spec.key, d.id, handlerFor(plan));
    e.log(`  #K-${d.seq} (${plan.spec.key}) silme talebi: ${plan.title}`);
    if (!plan.votes && plan.spec.messages?.length) await e.postThread(plan.spec.key, "proposal", d.id, plan.spec.messages);
    await e.sponsor(plan.spec.key, plan.requester, 1);
  }

  /** Üst konu henüz oluşmadıysa (gecikme) birkaç saat sonra yeniden dener. */
  function whenTopic(parent: string, label: string, run: () => Promise<void>, tries = 6): () => Promise<void> {
    return async () => {
      const st = e.status(parent);
      if (st === "enacted") return run();
      if (tries <= 0 || ["rejected", "inadmissible", "withdrawn", "expired"].includes(st)) {
        e.problem(`${label}: üst konu (${parent}) yürürlükte değil (durum: ${st})`);
        return;
      }
      e.scheduleIn(6 * HOUR, label, whenTopic(parent, label, run, tries - 1));
    };
  }

  const minorityReport = (key: string, preferred: string[]) => async () => {
    const id = e.proposalId(key);
    const noVoters = e.votersWith(key, 1, "no", "C");
    const author = preferred.find((n) => noVoters.includes(n)) ?? noVoters[0];
    if (!author) return e.problem(`${key}: azınlık raporu için ilk turda "hayır" diyen C üyesi yok`);
    s.forum.proposals.minorityReport(e.auth(author), id, C.MINORITY_REPORTS[key]);
  };

  const bridging = (key: string, by: string) => async () => {
    const a = await s.forum.proposals.aiBridging(e.auth(by), e.proposalId(key));
    e.log(`    ${key}: YZ köprü taslakları üretildi (${(a.output as { drafts?: unknown[] }).drafts?.length ?? 0} taslak).`);
  };

  /** Yazar köprü taslaklarından birini benimser (katmanı değiştirmeyen ilk taslak). */
  const adoptDraft = (key: string) => async () => {
    const id = e.proposalId(key);
    const author = plans.get(key)!.spec.author;
    const analysis = s.forum.proposals.get(id, e.auth(author)).aiAnalyses.filter((a) => a.task === "bridging_drafts").pop();
    if (!analysis) return e.problem(`${key}: benimsenecek köprü taslağı yok`);
    const n = (analysis.output as { drafts?: unknown[] }).drafts?.length ?? 0;
    for (const idx of [2, 0, 3, 1, 4, 5, 6, 7].filter((i) => i < n)) {
      try {
        await s.forum.proposals.approveAi(e.auth(author), analysis.id, idx);
        e.log(`    ${key}: yazar ${idx + 1}. köprü taslağını benimsedi (yeni sürüm).`);
        return;
      } catch (err) {
        e.log(`    ${key}: ${idx + 1}. taslak uygulanamadı (${err instanceof Error ? err.message : String(err)}).`);
      }
    }
    e.problem(`${key}: hiçbir köprü taslağı uygulanamadı`);
  };

  const summary = (key: string, by: string) => async () => {
    await s.forum.proposals.aiSummary(e.auth(by), e.proposalId(key));
  };

  const objections = (key: string, block: "B" | "C", list: { ground: string; statement: string }[], gapHours: number) => (ev: PhaseEvent) => {
    if (ev.to !== "objection_window") return;
    const signers = e.votersWith(key, 1, "no", block).slice(0, list.length);
    if (signers.length < list.length) e.problem(`${key}: itiraz için yeterli "hayır" oyu veren ${block} üyesi yok (${signers.length})`);
    signers.forEach((n, i) => {
      e.scheduleIn((i + 1) * gapHours * HOUR, `${key} itiraz ${i + 1}`, async () => {
        if (e.status(key) !== "objection_window") return;
        await s.forum.proposals.object(e.auth(n), e.proposalId(key), { ground: fy(list[i].ground.replace(/^fy:/, "")), statement: list[i].statement });
      });
    });
  };

  // ───────────── Oy eğilimleri (A: toplu taşıma/yeşil, B: araç/maliyet, C: erişilebilirlik/yaşlı) ─────────────

  const P = (spec: ProposalSpec, votes: VoteSpec, extra: Partial<Plan> = {}): Plan => ({ spec, votes, ...extra });

  // ───────────── Erken bölüm (başlangıca göre) ─────────────

  e.schedule(S + 0.25 * DAY, "1. dalga", async () => {
    await create(P(C.P1, { A: 0.97, B: 0.25, C: 0.9 }));
    await create(P(C.P2, { A: 0.97, B: 0.3, C: 0.95 }));
    await create(P(C.P3, { A: 0.9, B: 0.03, C: 0.05 }));
    await create(P(C.P4, { A: 0.95, B: 0.9, C: 0.05 }));
    await create(P(C.R1, { A: 0.96, B: 0.92, C: 0.96 }));
    await create({ spec: C.X1 }, { sponsors: 1, postNow: true });
  });

  e.schedule(S + 0.5 * DAY, "kendi kaydını yapan üyeler", async () => {
    for (const n of ["berk_n", "nisan_t", "tuna_m"]) {
      const { user } = await s.identity.register(regs.get(n)!);
      e.users.set(n, { id: user.id, person: PEOPLE.find((p) => p.nickname === n)! });
    }
  });
  e.schedule(S + 0.7 * DAY, "başvuru reddi", async () => {
    await s.identity.verify(e.user("kayitmemuru").id, e.user("tuna_m").id, "reject", "Kimlik belgesindeki bilgiler başvuru formuyla uyuşmuyor.");
  });

  e.schedule(S + 1.5 * DAY, "bilirkişi gerektiren öneri (enerji)", async () => {
    await create(P(C.EN1, { A: 0.95, B: 0.9, C: 0.1 }, { expert: { questions: C.EN1_QUESTIONS, reports: C.EN1_REPORTS, reportAfterHours: 36 } }));
  });

  e.schedule(S + 2.5 * DAY, "2. dalga", async () => {
    await create(P(C.P5, { A: 0.95, B: 0.2, C: 0.97 }));
    await create(P(C.P6, { A: 0.97, B: 0.35, C: 1 }));
    await create(P(C.P7, { A: 0.03, B: 0.97, C: 0.5 }));
    await create(P(C.P8, { A: 0.95, B: 0.25, C: 0.8 }));
    await create(P(C.P13, { A: 0.1, B: 0.05, C: 1 }));
  });

  e.schedule(S + 5.5 * DAY, "3. dalga", async () => {
    await create(P(C.P9, { A: 0.95, B: 0.9, C: 0.95 }));
    await create(P(C.P10, { A: 0.9, B: 0.8, C: 0.7 }));
    await create(P(C.P11, { A: 0.9, B: 0.55, C: 0.7 }));
    await create(P(C.P12, { A: 0.05, B: 0.95, C: 0.02 }));
  });

  e.schedule(S + 8.6 * DAY, "alt konular ve düzenleme", whenTopic("P1", "alt konular", async () => {
    await create(P(C.S1, { A: 0.95, B: 0.55, C: 0.6 }));
    await create(P(C.S2, { A: 0.85, B: 0.65, C: 0.8 }));
  }));
  e.schedule(S + 8.62 * DAY, "düzenleme teklifi", whenTopic("P2", "düzenleme teklifi", async () => {
    await create(P(C.AM1, { A: 0.92, B: 0.72, C: 0.88 }));
  }));

  e.schedule(S + 8.75 * DAY, "hakaret içeren mesaj", whenTopic("P1", "hakaret içeren mesaj", async () => {
    const parent = e.threadMessages.get("topic:P1")?.[2] ?? null;
    const m = await s.forum.messages.post(e.auth("sert_kaan"), "topic", e.topicOf("P1"), { body: C.INSULT_MESSAGE, stance: "con", parentId: parent });
    e.threadMessages.set("insult", [m.id]);
  }));

  e.schedule(S + 9.0 * DAY, "cep ormanı ve hakaret silme talebi", async () => {
    await whenTopic("P2", "cep ormanı", async () => create(P(C.S3, { A: 0.9, B: 0.55, C: 0.75 })))();
    const target = e.threadMessages.get("insult")?.[0];
    if (!target) return e.problem("hakaret mesajı bulunamadı; silme talebi açılmadı");
    await createDeletion({
      spec: { key: "D1", kind: "deletion", title: "", body: "", categories: [], author: "selin_a", messages: C.H1_MESSAGES },
      votes: { A: 0.88, B: 0.78, C: 0.9 },
      requester: "selin_a",
      targetMessageId: target,
      ground: "HakaretIftira",
      statement: C.H1_STATEMENT,
      title: "Kent İçi Ulaşım tartışmasındaki hakaret içeren mesajın gizlenmesi",
      onEvent: (ev) => {
        if (ev.to !== "enacted") return;
        e.scheduleIn(6 * HOUR, "D1 yazarın cevabı", () => {
          s.forum.messages.rebuttal(e.auth("sert_kaan"), target, C.REBUTTAL);
        });
        e.scheduleIn(8 * HOUR, "D1 denetçi okuması", () => {
          s.forum.messages.readHidden(e.auth("denetci"), target);
        });
      },
    });
  });

  e.schedule(S + 10.6 * DAY, "tartışmalı öneri ve itiraz yolu", async () => {
    await create(
      P(C.C1, { A: 0.88, B: 0.92, C: { yes: 0, no: 6 } }, {
        votes2: { A: 0.9, B: 0.92, C: { yes: 1, no: 5 } },
        onEvent: (ev) => {
          if (ev.to === "reconciliation") {
            e.scheduleIn(4 * HOUR, "C1 azınlık raporu", minorityReport("C1", ["zeynep"]));
            e.scheduleIn(8 * HOUR, "C1 köprü taslakları", bridging("C1", "ayse"));
            e.scheduleIn(20 * HOUR, "C1 taslak benimseme", adoptDraft("C1"));
          }
          if (ev.to === "enacted" || ev.to === "rejected") e.scheduleIn(3 * HOUR, "C1 YZ özeti", summary("C1", "ayse"));
        },
      }),
    );
    await create(
      P(C.O1, { A: 0.82, B: 0.8, C: { yes: 2, no: 4 } }, {
        votes2: { A: 0.5, B: 0.4, C: { yes: 0, no: 6 } },
        onEvent: async (ev) => {
          objections("O1", "C", C.O1_OBJECTIONS, 2)(ev);
          if (ev.to === "reconciliation") {
            e.scheduleIn(5 * HOUR, "O1 azınlık raporu", minorityReport("O1", ["sevgi_k", "ismail_g"]));
            e.scheduleIn(6 * HOUR, "O1 YZ özeti", summary("O1", "deniz_k"));
          }
        },
      }),
    );
  });

  e.schedule(S + 10.0 * DAY, "görüş ayrılığı gerekçeli silme talebi", async () => {
    const target = e.threadMessages.get("P7")?.[1];
    if (!target) return e.problem("P7 tartışmasındaki hedef mesaj bulunamadı");
    await createDeletion({
      spec: { key: "G1", kind: "deletion", title: "", body: "", categories: [], author: "tarik_o", messages: C.G1_MESSAGES },
      requester: "tarik_o",
      targetMessageId: target,
      ground: "GorusAyriligi",
      statement: C.G1_STATEMENT,
      title: "Katlı otopark tartışmasındaki karşı görüş mesajının gizlenmesi",
    });
  });

  e.schedule(S + 10.5 * DAY, "değiştirilemez maddeyi hedefleyen yama", async () => {
    await create({ spec: C.RT3 }, { postNow: true });
  });

  e.schedule(S + 11.0 * DAY, "geri çekilecek öneri", async () => {
    await create({ spec: C.W1 });
  });
  e.schedule(S + 12.0 * DAY, "öneri geri çekme", async () => {
    if (e.status("W1") === "deliberation" || e.status("W1") === "sponsoring") await s.forum.proposals.withdraw(e.auth(C.W1.author), e.proposalId("W1"));
  });

  e.schedule(S + 18.0 * DAY, "kapanmış öneri özeti", summary("P3", "elif_d"));

  // ───────────── Geç bölüm (bitişe göre; tohum sonunda açık kalır) ─────────────

  e.schedule(E - 11 * DAY, "yeniden oylamada kalacak tartışmalı öneri", async () => {
    await create(
      P(C.C2, { A: 0.9, B: 0.86, C: { yes: 0, no: 6 } }, {
        votes2: { A: 0.9, B: 0.85, C: { yes: 1, no: 4 }, fraction: 0.5, secondBatchHours: null },
        onEvent: (ev) => {
          if (ev.to === "reconciliation") {
            e.scheduleIn(4 * HOUR, "C2 azınlık raporu", minorityReport("C2", ["nur_a"]));
            e.scheduleIn(8 * HOUR, "C2 köprü taslakları", bridging("C2", "figen_s"));
            e.scheduleIn(24 * HOUR, "C2 taslak benimseme", adoptDraft("C2"));
          }
        },
      }),
    );
  });

  e.schedule(E - 8 * DAY, "uzlaşmada kalacak tartışmalı öneri ve itiraz süresi", async () => {
    await create(
      P(C.C3, { A: 0.88, B: 0.9, C: { yes: 0, no: 6 } }, {
        onEvent: (ev) => {
          if (ev.to === "reconciliation") {
            e.scheduleIn(4 * HOUR, "C3 azınlık raporu", minorityReport("C3", ["hulya_t"]));
            e.scheduleIn(6 * HOUR, "C3 köprü taslakları", bridging("C3", "zeynep"));
            e.scheduleIn(7 * HOUR, "C3 YZ özeti", summary("C3", "deniz_k"));
          }
        },
      }),
    );
    await create(P(C.OW1, { A: 0.85, B: 0.5, C: 0.7 }, { onEvent: objections("OW1", "B", C.OW1_OBJECTIONS, 5) }));
  });

  e.schedule(E - 4.5 * DAY, "oylamada kalacak öneri", async () => {
    await create(P(C.V1, { A: 0.9, B: 0.55, C: 0.85, fraction: 0.45, exclude: ["ayse"], secondBatchHours: null }));
  });

  e.schedule(E - 2.6 * DAY, "kişisel veri içeren mesaj", whenTopic("P2", "kişisel veri mesajı", async () => {
    const m = await s.forum.messages.post(e.auth("ozan_v"), "topic", e.topicOf("P2"), { body: C.PII_MESSAGE, stance: "con", acknowledgePii: true });
    e.threadMessages.set("pii", [m.id]);
  }));

  e.schedule(E - 2.3 * DAY, "acil silme talebi (kişisel veri)", async () => {
    const target = e.threadMessages.get("pii")?.[0];
    if (!target) return e.problem("kişisel veri mesajı bulunamadı");
    await createDeletion({
      spec: { key: "D2", kind: "deletion", title: "", body: "", categories: [], author: "zeynep", messages: C.PII_MESSAGES },
      votes: { A: 0.9, B: 0.82, C: 0.95, fraction: 0.5, secondBatchHours: null },
      requester: "zeynep",
      targetMessageId: target,
      ground: "KisiselVeriIfsasi",
      statement: C.PII_STATEMENT,
      title: "Mahalle parkları tartışmasında paylaşılan telefon numarasının gizlenmesi",
    });
  });

  e.schedule(E - 2.0 * DAY, "tartışmada kalacak bilirkişili öneri (sağlık)", async () => {
    await create(P(C.SG1, { A: 0.9, B: 0.6, C: 0.95 }, { expert: { questions: C.SG1_QUESTIONS, reports: C.SG1_REPORTS, reportAfterHours: 20 } }));
  });

  e.schedule(E - 1.0 * DAY, "destekçi bekleyen öneri ve yeni başvurular", async () => {
    await create({ spec: C.SP1 }, { sponsors: 2, postNow: true });
    for (const n of ["oguz_k", "ece_s"]) {
      const { user } = await s.identity.register(regs.get(n)!);
      e.users.set(n, { id: user.id, person: PEOPLE.find((p) => p.nickname === n)! });
    }
  });

  e.schedule(E - 0.8 * DAY, "taslak öneri", async () => {
    await create({ spec: C.DR1 }, { submit: false });
  });

  await e.runUntil(E);
  e.log(`Zaman çizelgesi tamamlandı (bekleyen ajanda: ${e.pendingAgenda()}).`);
}

// ═══════════════════════════ Hesaplar ve graf ═══════════════════════════

export async function setupAccounts(e: SeedEngine): Promise<Map<string, RegistrationInput>> {
  const s = e.s;
  const usedTckn = new Set<string>();
  const addressOf = new Map<string, RegistrationInput["address"]>();
  const regs = new Map<string, RegistrationInput>();
  for (const p of PEOPLE) regs.set(p.nickname, registrationFor(p, e.rng, { usedTckn, addressOf }));
  const person = (n: string): Person => PEOPLE.find((p) => p.nickname === n)!;

  const admin = await s.identity.bootstrapAdmin(regs.get("yonetici")!);
  e.users.set("yonetici", { id: admin.user.id, person: person("yonetici") });
  const adminId = admin.user.id;

  const staff: [string, Role][] = [
    ["kayitmemuru", "registrar"],
    ["denetci", "auditor"],
  ];
  for (const [n, role] of staff) {
    const { user } = await s.identity.createByRegistrar(adminId, regs.get(n)!);
    s.identity.setRoles(adminId, user.id, [role]);
    e.users.set(n, { id: user.id, person: person(n) });
  }
  const registrarId = e.user("kayitmemuru").id;

  for (const p of PEOPLE) {
    if (p.kind !== "member" && p.kind !== "expert") continue;
    const { user } = await s.identity.createByRegistrar(registrarId, regs.get(p.nickname)!);
    e.users.set(p.nickname, { id: user.id, person: p });
  }
  for (const p of PEOPLE) {
    if (!p.expert) continue;
    const id = e.user(p.nickname).id;
    s.experts.apply(id, p.expert.domains, p.expert.credentials);
    s.experts.decideApplication(adminId, id, "approve", "Yeterlilik belgeleri incelendi ve uygun bulundu.");
  }
  return regs;
}

export function setupGraph(e: SeedEngine): void {
  const g = e.s.graph;
  const id = (n: string) => e.user(n).id;
  const voters = [...e.users.values()].filter((u) => u.person.block && u.person.kind !== "expert").map((u) => u.person.nickname);

  // Takipler: blok içi yoğun, bloklar arası seyrek. Bilirkişiler takip ağına katılmaz (çıkar çatışması ağırlığı temiz kalsın).
  for (const n of voters) {
    const block = e.user(n).person.block!;
    const same = e.rng.shuffle(e.blockMembers(block, { exclude: [n] })).slice(0, 3 + e.rng.int(3));
    for (const t of same) g.follow(id(n), id(t));
    if (e.rng.next() < 0.25) {
      const other = voters.filter((x) => e.user(x).person.block !== block);
      g.follow(id(n), id(e.pick(other)));
    }
  }

  // Kefaletler: kayıt memuru ve eski üyeler; iki hesap "şüpheli" kefalet alır.
  for (const n of e.rng.shuffle(voters).slice(0, 18)) g.vouch(id("kayitmemuru"), id(n), "known");
  const levels = ["close", "known", "just_met"] as const;
  for (let i = 0; i < 22; i++) {
    const a = e.pick(voters);
    const b = e.pick(voters);
    if (a !== b) g.vouch(id(a), id(b), levels[e.rng.int(levels.length)]);
  }
  g.vouch(id("volkan_i"), id("ozan_v"), "suspicious");
  g.vouch(id("tarik_o"), id("kerem_b"), "suspicious");
  g.vouch(id("deniz_k"), id("kerem_b"), "just_met");

  // Yakınlıklar: iki aile, bir hane (bk_enerji1 ↔ mehmet: enerji önerisinde çıkar çatışması).
  g.relate(id("mehmet"), id("bk_enerji1"), "family");
  g.relate(id("zeynep"), id("irem_c"), "family");
  g.relate(id("deniz_k"), id("cem_y"), "household");

  // Vekâletler: deniz_k'ye 5 genel vekâlet (sınırı zorlar: cap = max(2, ⌈0,05·|E|⌉) = 3) + kategori kapsamlı vekâletler.
  for (const n of ["bora_t", "sinem_a", "yusuf_c", "melis_o", "hakan_d"]) g.delegate(id(n), id("deniz_k"), "*", 1);
  g.delegate(id("aylin_s"), id("ayse"), fy("Ulasim"), 1);
  g.delegate(id("aylin_s"), id("mehmet"), "*", 2);
  g.delegate(id("gizem_e"), id("bk_imar1"), fy("Imar"), 1);
  g.delegate(id("gizem_e"), id("deniz_k"), "*", 2);
  g.delegate(id("kemal_b"), id("zeynep"), fy("SosyalHizmet"), 1);
  g.delegate(id("kemal_b"), id("mehmet"), "*", 2);
}
