// Tohum sonu doğrulaması (SEED_SPEC "Doğrulama") ve Türkçe özet. Yalnızca okuma: servisler + SELECT.
import { PROPOSAL_STATUS_LABELS, verifyTally, type ProposalStatus } from "@forum/shared";
import type { SeedEngine } from "./engine";
import { PASSWORDS, PEOPLE } from "./people";
import { KEYS } from "./scenario";

export interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

const ALL: ProposalStatus[] = [
  "draft",
  "sponsoring",
  "deliberation",
  "voting",
  "objection_window",
  "reconciliation",
  "revote",
  "enacted",
  "rejected",
  "inadmissible",
  "expired",
  "withdrawn",
];
const CLOSED = new Set<ProposalStatus>(["enacted", "rejected", "inadmissible", "withdrawn", "expired"]);

export function statusCounts(e: SeedEngine): Record<ProposalStatus, number> {
  const out = Object.fromEntries(ALL.map((s) => [s, 0])) as Record<ProposalStatus, number>;
  for (const r of e.s.ctx.db.all<{ status: ProposalStatus; n: number }>("SELECT status, COUNT(*) AS n FROM proposals GROUP BY status")) out[r.status] = Number(r.n);
  return out;
}

export function verifySeed(e: SeedEngine): Check[] {
  const { s } = e;
  const db = s.ctx.db;
  const checks: Check[] = [];
  const add = (label: string, ok: boolean, detail: string) => checks.push({ label, ok, detail });

  const counts = statusCounts(e);
  const missing = ALL.filter((st) => counts[st] < 1);
  add("Her evrede en az bir öneri", missing.length === 0, missing.length ? `eksik: ${missing.map((m) => PROPOSAL_STATUS_LABELS[m]).join(", ")}` : `${ALL.length} evrenin hepsi dolu`);

  const closed = ALL.filter((st) => CLOSED.has(st)).reduce((a, st) => a + counts[st], 0);
  add("En az 10 kapanmış öneri", closed >= 10, `${closed} kapanmış öneri`);

  const tallies = db.all<{ proposal_id: string; result: string }>("SELECT proposal_id, result FROM tallies WHERE interim = 0");
  const outcomes = tallies.map((t) => JSON.parse(t.result) as { outcome: string; totals: { delegated: number; unrouted: number } });
  const contested = outcomes.filter((o) => o.outcome === "contested").length;
  add("En az bir tartışmalı (contested) sayım", contested >= 1, `${contested} tartışmalı sayım`);

  const hidden = Number(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE visibility IN ('hidden', 'sealed')")?.n ?? 0);
  add("En az bir gizlenmiş mesaj", hidden >= 1, `${hidden} gizlenmiş mesaj`);

  const collapsed = Number(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE visibility = 'collapsed'")?.n ?? 0);
  add("Acil silme talebiyle daraltılmış mesaj", collapsed >= 1 || hidden >= 2, `${collapsed} daraltılmış mesaj`);

  const verified = Number(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE status = 'verified'")?.n ?? 0);
  const pending = s.identity.listPending().length;
  add("En az 40 doğrulanmış üye", verified >= 40, `${verified} doğrulanmış, ${pending} bekleyen başvuru`);

  const snap = s.forum.clusters.latest();
  add("Son küme anlık görüntüsünde k ≥ 2", !!snap && snap.k >= 2, snap ? `k=${snap.k}, ${snap.clusters.map((c) => `${c.label}: ${c.size}`).join(", ")}` : "anlık görüntü yok");

  const chain = s.ledger.verifyChain();
  add("Defter zinciri doğrulandı (verifyChain)", chain.length > 0 && chain.every((c) => c.ok), chain.map((c) => `${c.nodeId}: ${c.ok ? "✔" : "✘"} (${c.checkedBlocks} blok)`).join(", "));

  let tallyOk = 0;
  const tallyBad: string[] = [];
  for (const pid of [...new Set(tallies.map((t) => t.proposal_id))]) {
    for (const r of s.forum.proposals.bulletin(pid).rounds) {
      const v = verifyTally(r.tally, r.reveals, r.commitments);
      if (v.ok) tallyOk++;
      else tallyBad.push(`${pid.slice(0, 8)}/tur ${r.round}: ${v.mismatches.join("; ")}`);
    }
  }
  add("Her kesin sayım bültenden yeniden doğrulandı (verifyTally)", tallyBad.length === 0 && tallyOk === tallies.length, tallyBad.length ? tallyBad.join(" | ") : `${tallyOk}/${tallies.length} sayım ✔`);

  const topics = s.forum.topics.list();
  const parents = new Set(topics.map((t) => t.parentId).filter(Boolean));
  const revised = topics.filter((t) => t.version >= 2).length;
  add("En az 6 konu, 2'si alt konulu, biri 2. revizyonda", topics.length >= 6 && parents.size >= 2 && revised >= 1, `${topics.length} konu, ${parents.size} konunun alt konusu var, ${revised} konu revize edildi`);

  const bylaw = s.ontology.current().version;
  add("Yönetmelik yaması yürürlükte (sürüm 2)", bylaw >= 2, `yürürlükteki yönetmelik sürümü ${bylaw}`);

  const delegated = outcomes.some((o) => o.totals.delegated > 0);
  const unrouted = outcomes.some((o) => o.totals.unrouted > 0);
  add("Vekâletle sayılan oy ve vekâlet sınırı taşması", delegated && unrouted, `vekâletli oy: ${delegated ? "var" : "yok"}, sınır taşması: ${unrouted ? "var" : "yok"}`);

  const enPanel = e.ids.has(KEYS.expertClosed) ? s.experts.panel(e.proposalId(KEYS.expertClosed)) : null;
  const excluded = enPanel?.candidates.filter((c) => c.excludedReason).length ?? 0;
  const lint = enPanel?.reports.some((r) => r.lintIssues.some((i) => i.kind === "legal_qualification")) ?? false;
  add("Bilirkişi paneli: 2 rapor, hukuki nitelendirme uyarısı, çıkar çatışması dışlaması", (enPanel?.reports.length ?? 0) >= 2 && lint && excluded >= 1, `${enPanel?.reports.length ?? 0} rapor, ${excluded} dışlanan aday, hukuki nitelendirme uyarısı: ${lint ? "var" : "yok"}`);

  const sgPanel = e.ids.has(KEYS.deliberationExpert) ? s.experts.panel(e.proposalId(KEYS.deliberationExpert)) : null;
  add("Tartışmadaki öneride panel, rapor ve soru", !!sgPanel && sgPanel.reports.length >= 1 && sgPanel.questions.length >= 1, sgPanel ? `${sgPanel.reports.length} rapor, ${sgPanel.questions.length} soru` : "panel yok");

  const ai = Number(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ai_analyses")?.n ?? 0);
  const minority = Number(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM minority_reports")?.n ?? 0);
  add("YZ analizleri ve azınlık raporları", ai >= 3 && minority >= 3, `${ai} YZ analizi, ${minority} azınlık raporu`);

  if (e.ids.has(KEYS.voting)) {
    const id = e.proposalId(KEYS.voting);
    const ayse = e.user("ayse").id;
    const votedByAyse = !!db.get("SELECT 1 FROM ballots WHERE proposal_id = ? AND user_id = ?", id, ayse);
    add('Oylamadaki öneride "ayse" henüz oy vermedi', e.status(KEYS.voting) === "voting" && !votedByAyse, `durum: ${e.status(KEYS.voting)}`);
  }
  return checks;
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

export function printSummary(e: SeedEngine, checks: Check[], meta: { seconds: number; simNow: number; problems: string[] }): void {
  const { s } = e;
  const db = s.ctx.db;
  const out: string[] = [];
  const line = (x = "") => out.push(x);
  line("");
  line("══════════════════════════ Tohum verisi özeti ══════════════════════════");
  line(`Simüle saat  : ${new Date(meta.simNow).toISOString()}   Süre: ${meta.seconds.toFixed(1)} sn`);
  line("");
  line("Hesaplar (şifreler sabittir):");
  line(`  ${pad("Takma ad", 34)}${pad("Rol", 40)}Şifre`);
  const rows: [string, string, string][] = [
    ["yonetici", "yönetici (+üye)", PASSWORDS.admin],
    ["kayitmemuru", "kayıt memuru", PASSWORDS.registrar],
    ["denetci", "denetçi", PASSWORDS.auditor],
    ["bk_enerji1, bk_enerji2", "bilirkişi (Enerji, Çevre)", PASSWORDS.expert],
    ["bk_saglik1, bk_saglik2, bk_saglik3", "bilirkişi (Sağlık, Halk sağlığı)", PASSWORDS.expert],
    ["bk_imar1, bk_imar2", "bilirkişi (İmar, Deprem güv., Bütçe)", PASSWORDS.expert],
  ];
  const members = PEOPLE.filter((p) => p.kind === "member").length;
  rows.push(["ayse, mehmet, zeynep", `üye (+${members - 3} üye daha)`, PASSWORDS.member]);
  for (const [n, r, p] of rows) line(`  ${pad(n, 34)}${pad(r, 40)}${p}`);
  const pending = s.identity.listPending().map((u) => u.nickname);
  line(`  Bekleyen başvurular: ${pending.join(", ") || "—"}; reddedilen: 1; reşit olmayan: genc_ali, ada_k; siyasi rıza vermeyen: ozan_v, kerem_b, lale_y`);
  line("");
  const counts = statusCounts(e);
  line("Öneriler (evreye göre):");
  line("  " + Object.entries(counts).map(([k, v]) => `${PROPOSAL_STATUS_LABELS[k as ProposalStatus]}: ${v}`).join(" · "));
  const ex = (k: string) => (e.ids.has(k) ? `#K-${e.seq(k)}` : "—");
  line("  Örnekler:");
  line(`    Tartışmalı → uzlaşma → yeniden oylama (kapandı, ω): ${ex(KEYS.contestedClosed)} · yeniden oylamada: ${ex(KEYS.contestedRevote)} · uzlaşmada: ${ex(KEYS.contestedReconciliation)}`);
  line(`    İtiraz yolu (kural a → uzlaşma → yeniden oylama): ${ex(KEYS.objectionPath)} · itiraz süresinde (geçersiz itirazlar): ${ex(KEYS.objectionWindow)}`);
  line(`    Oylamada ("ayse" oy vermedi): ${ex(KEYS.voting)} · bilirkişili tartışma: ${ex(KEYS.deliberationExpert)} · panel + 2 rapor (kapandı): ${ex(KEYS.expertClosed)}`);
  line(`    Hakaret silme (gizlendi + cevap): ${ex(KEYS.hiddenDeletion)} · kişisel veri (daraltıldı, oylamada): ${ex(KEYS.piiDeletion)}`);
  line(`    Kural gereği geçersiz: "Görüş ayrılığı" ${ex(KEYS.invalidDeletion)}, değiştirilemez madde yaması ${ex(KEYS.immutablePatch)}`);
  line(`    Yönetmelik yaması (T0 tartışma 72→96 sa): ${ex(KEYS.regulation)} · konu düzenlemesi (sürüm 2): ${ex(KEYS.amendment)}`);
  line("");
  const topics = s.forum.topics.list();
  const msgs = Number(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM messages")?.n ?? 0);
  const ledger = s.ledger.status();
  const snap = s.forum.clusters.latest();
  line(`Konular: ${topics.length} (alt konu: ${topics.filter((t) => t.parentId).length}) · Mesajlar: ${msgs} · İşaretler: ${e.stats.endorsements} · Oylar: ${e.stats.votes}`);
  line(`Defter yüksekliği: ${ledger.height} (${ledger.validators.length} doğrulayıcı) · Yönetmelik sürümü: ${s.ontology.current().version}`);
  if (snap) line(`Görüş kümeleri: k=${snap.k}, siluet ${snap.silhouette.toFixed(3)} — ${snap.clusters.map((c) => `${c.label} (${c.size})`).join(", ")}`);
  line("");
  line("Doğrulama:");
  for (const c of checks) line(`  ${c.ok ? "✔" : "✘"} ${c.label} — ${c.detail}`);
  if (meta.problems.length) {
    line("");
    line(`Uyarılar (${meta.problems.length}):`);
    for (const p of meta.problems.slice(0, 40)) line(`  • ${p}`);
  }
  line("════════════════════════════════════════════════════════════════════════");
  console.log(out.join("\n"));
}
