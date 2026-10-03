// Bilirkişi paneli (ALGORITMA §8): tohum ve kaynağı, adaylar (ağırlık, yumuşak çatışma, dışlanma), atamalar (çekinme
// gerekçeleriyle), kura kayıtları (ilk kura + yedek kuraların EXPERT_DRAW defter işlemleri), raporlar (YZ hukuki nitelendirme
// uyarılarıyla), sorular (azınlık güvenceli), askı bayrağı. Bilirkişi danışmandır; oyu 1'dir.
// Kapalı başlık cevap verir: kartın başlığında tek satırlık hüküm durur ("2 rapor: 2 uygulanabilir · ort. güven %80 · 2 soru").
// Kura kanıtı (tohum, atamalar, kura kayıtları, aday havuzu) tek "Kura ve adillik kanıtı" açılırındadır. Her rapor tek satırdır
// ("@bilirkişi · Uygulanabilir · güven %80 · tarih") ve [Raporu oku] gövdeyi, riskleri, karşı görüşü, YZ uyarısını, hash'leri ve
// sorulara yanıtları satır içinde açar; soru formu [Soru sor] ile açılır. 'Tam' görünümde ikisi de açık gelir.
// Görsel dil: rapor satırında tek renkli rozet hükümdür (uygulanabilir yeşil · uygulanamaz kırmızı · belirsiz turuncu); panel türü
// ve 'Azınlık güvenceli' gri rozettir (mor yalnız yapay zekâ içindir: hukuki nitelendirme uyarısı AiLabel ile gelir).
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ASSESSMENT_LABELS,
  ASSIGNMENT_STATUS_LABELS,
  TEXT_LIMITS,
  type ExpertAssessment,
  type ExpertDrawRecord,
  type ExpertPanelInfo,
  type ExpertQuestion,
  type ExpertReportView,
  type ProposalDetail,
} from "@forum/shared";
import { askExpertQuestion, requestExperts } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { resolveDefaultOpen, useDetailLevel } from "../../lib/detailLevel";
import { formatPercent } from "../../lib/format";
import { routes } from "../../lib/routes";
import { useAction } from "../../lib/useAsync";
import { AiLabel, Alert, Badge, Button, Card, cx, Details, HashText, Table, Term, Textarea, Time } from "../../ui";
import { UserLink } from "../UserLink";
import { fmtDecimal, PlainText, SubHeading } from "./common";
import "./participation.css";
import "./expert-ai.css";

const CLOSED = ["enacted", "rejected", "withdrawn", "expired", "inadmissible"];

const ASSESSMENT_ORDER: ExpertAssessment[] = ["feasible", "infeasible", "uncertain"];

// ───────────── Hüküm satırı (saf işlevler) ─────────────

/** Raporların ortalama güveni (0..1); rapor yoksa null. */
export function averageConfidence(reports: Pick<ExpertReportView, "confidence">[]): number | null {
  const xs = reports.map((r) => r.confidence).filter((c) => Number.isFinite(c));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export interface ExpertVerdict {
  text: string;
  /** warning yalnız askı kuralı uygulandıysa ya da uygun bilirkişi bulunamadıysa (renk her zaman metinle birlikte) */
  tone: "neutral" | "warning";
}

/**
 * Kartın başlığındaki tek satırlık hüküm.
 *  - rapor varsa: "2 rapor: 2 uygulanabilir · ort. güven %80 · 2 soru"
 *  - panel var, rapor yoksa: "Henüz rapor yok · 3 bilirkişiden rapor bekleniyor · soru yok"
 *  - panel yoksa: "Henüz panel çekilmedi" (öneri bilirkişi görüşü gerektiriyorsa " · bilirkişi görüşü gerekli")
 */
export function expertVerdict(input: {
  panel: Pick<ExpertPanelInfo, "reports" | "assignments" | "noExpertAvailable" | "suspensiveFlag"> | null;
  questionCount: number;
  requiresExpert?: boolean;
}): ExpertVerdict {
  const { panel, questionCount, requiresExpert } = input;
  const asks = questionCount ? `${questionCount} soru` : "soru yok";
  if (!panel) {
    const parts = ["Henüz panel çekilmedi", requiresExpert ? "bilirkişi görüşü gerekli" : null, questionCount ? asks : null];
    return { text: parts.filter((x): x is string => !!x).join(" · "), tone: "neutral" };
  }
  const parts: string[] = [];
  if (panel.reports.length) {
    const counts = ASSESSMENT_ORDER.map((a) => {
      const n = panel.reports.filter((r) => r.assessment === a).length;
      return n ? `${n} ${ASSESSMENT_LABELS[a].toLocaleLowerCase("tr-TR")}` : null;
    }).filter((x): x is string => !!x);
    parts.push(`${panel.reports.length} rapor: ${counts.join(" · ")}`);
    const avg = averageConfidence(panel.reports);
    if (avg !== null) parts.push(`ort. güven ${formatPercent(avg, 0)}`);
  } else if (panel.noExpertAvailable) {
    parts.push("Uygun bilirkişi yok", "rapor yok");
  } else {
    const waiting = panel.assignments.filter((a) => a.status === "invited" || a.status === "accepted").length;
    parts.push("Henüz rapor yok");
    if (waiting) parts.push(`${waiting} bilirkişiden rapor bekleniyor`);
  }
  parts.push(asks);
  if (panel.suspensiveFlag) parts.push("askı uyarısı var");
  return { text: parts.join(" · "), tone: panel.noExpertAvailable || panel.suspensiveFlag ? "warning" : "neutral" };
}

// ───────────── Satır içi açılım ([Raporu oku], [Soru sor]) ─────────────

/** Tarayıcı hidden="until-found" ve beforematch destekliyorsa true (ui/basic.tsx'teki kartlarla aynı denetim). */
function canFindInHidden(): boolean {
  try {
    return typeof document !== "undefined" && "onbeforematch" in document.documentElement;
  } catch {
    return false;
  }
}

/**
 * Açık/kapalı durum + gövde düğümü. İlk değer görünüm yoğunluğundan gelir ('sade' kapalı, 'tam' açık); kullanıcı dokunmadıysa
 * yoğunluk değişince uyar. Gövde DOM'da kalır (yazılmış soru, rapor metni kaybolmaz); destekleyen tarayıcıda hidden="until-found"
 * olur: sayfa içi arama bulur ve gövdeyi açar.
 */
function useInlineDisclosure() {
  const { level } = useDetailLevel();
  const [open, setOpenState] = useState(() => resolveDefaultOpen(undefined, level));
  const touched = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const setOpen = useCallback((next: boolean) => {
    touched.current = true;
    setOpenState(next);
  }, []);

  useEffect(() => {
    if (!touched.current) setOpenState(resolveDefaultOpen(undefined, level));
  }, [level]);

  useLayoutEffect(() => {
    if (open || !canFindInHidden()) return;
    bodyRef.current?.setAttribute("hidden", "until-found");
  }, [open]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onFound = () => setOpen(true);
    el.addEventListener("beforematch", onFound);
    return () => el.removeEventListener("beforematch", onFound);
  }, [setOpen]);

  return { open, setOpen, bodyRef };
}

// ───────────── Raporlar ─────────────

function ReportRow({ r, questions }: { r: ExpertReportView; questions: ExpertQuestion[] }) {
  const tone = r.assessment === "feasible" ? "success" : r.assessment === "infeasible" ? "danger" : "warning";
  const { open, setOpen, bodyRef } = useInlineDisclosure();
  const bodyId = useId();
  const metaId = useId();
  return (
    <li className={cx("list-item expert-report", open && "is-open")}>
      <div className="expert-report-head">
        <div className="row small expert-report-meta" id={metaId}>
          <UserLink id={r.expertId} nickname={r.expertNickname} showExpert={false} />
          <Badge tone={tone}>{ASSESSMENT_LABELS[r.assessment]}</Badge>
          <span>güven {formatPercent(r.confidence)}</span>
          <Time at={r.createdAt} className="muted" />
          {r.lintIssues.length ? <span className="expert-report-flag">⚠ {r.lintIssues.length} hukuki nitelendirme uyarısı</span> : null}
        </div>
        <Button size="sm" aria-expanded={open} aria-controls={bodyId} aria-describedby={metaId} onClick={() => setOpen(!open)}>
          {open ? "Raporu gizle" : "Raporu oku"}
        </Button>
      </div>
      <div className="expert-report-body" id={bodyId} ref={bodyRef} hidden={!open}>
        <PlainText text={r.body} />
        {r.risks.length ? (
          <div className="small">
            <strong>Riskler:</strong>
            <ul>
              {r.risks.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {r.answers.length ? (
          <div className="small">
            <strong>Sorulara yanıtlar ({r.answers.length}):</strong>
            <dl className="qa-list">
              {r.answers.map((a) => (
                <div key={a.questionId}>
                  <dt>{questions.find((q) => q.id === a.questionId)?.body ?? "Soru"}</dt>
                  <dd>{a.answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
        {r.dissent ? (
          <div className="small">
            <strong>Karşı görüş:</strong> {r.dissent}
          </div>
        ) : null}
        {r.lintIssues.length ? (
          <AiLabel label="Yapay zekâ ile üretildi · hukuki nitelendirme denetimi" hideNote>
            <p className="small">
              <strong>Hukuki nitelendirme uyarıları ({r.lintIssues.length}).</strong> Bilirkişi hukuki nitelendirme yapamaz (6754 s. Kanun md. 3/2); aşağıdaki ifadeler
              danışma amacıyla işaretlendi:
            </p>
            <ul className="small">
              {r.lintIssues.map((l, i) => (
                <li key={i}>
                  “{l.quote}” — {l.message}
                </li>
              ))}
            </ul>
          </AiLabel>
        ) : null}
        <p className="small muted">
          Rapor özeti <HashText hash={r.contentHash} chars={8} copy={false} />
          {r.ledgerTx ? (
            <>
              {" "}
              · defter <HashText hash={r.ledgerTx} chars={8} to={routes.tx(r.ledgerTx)} copy={false} />
            </>
          ) : null}
        </p>
      </div>
    </li>
  );
}

/** Bir EXPERT_DRAW kaydının Türkçe açıklaması. */
export function drawLabel(d: ExpertDrawRecord): string {
  if (d.kind === "substitute") {
    const why = d.reason === "recused" ? "çekinme" : d.reason === "replaced" ? "görevden alma (askı/çıkarma)" : "boşalma";
    return `${d.round}. kuranın ${d.substitute ?? "?"}. yedek çekilişi (${why} sonrası)`;
  }
  return d.kind === "counter" ? `${d.round}. kura — karşı bilirkişi paneli` : `${d.round}. kura — panel çekilişi`;
}

function DrawList({ draws }: { draws: ExpertDrawRecord[] }) {
  return (
    <ol className="plain-list stack-sm small">
      {draws.map((d) => (
        <li key={d.txHash} className="stack-sm">
          <div className="row-between">
            <span>
              {drawLabel(d)} · {d.selected ? `${d.selected} kişi seçildi` : "kimse seçilemedi"}
            </span>
            <Time at={d.at} className="muted" />
          </div>
          <HashText hash={d.txHash} chars={12} to={routes.tx(d.txHash)} copy={false} label="EXPERT_DRAW işlemi" />
        </li>
      ))}
    </ol>
  );
}

function AssignmentStatusCell({ status, recuseReason }: { status: ExpertPanelInfo["assignments"][number]["status"]; recuseReason?: string | null }) {
  return (
    <div>
      {ASSIGNMENT_STATUS_LABELS[status] ?? status}
      {status === "recused" ? (
        <div className="small muted">{recuseReason ? `Gerekçe: ${recuseReason}` : "Gerekçe belirtilmedi"}</div>
      ) : null}
    </div>
  );
}

/** "Kura ve adillik kanıtı" açılırının sağındaki gri sayılar: "1. kura · 3 atama · 12 aday". */
export function expertEvidenceMeta(e: Pick<ExpertPanelInfo, "round" | "assignments" | "candidates">): string {
  return [`${e.round}. kura`, e.assignments.length ? `${e.assignments.length} atama` : null, e.candidates.length ? `${e.candidates.length} aday` : null]
    .filter((x): x is string => !!x)
    .join(" · ");
}

/** Kura ve adillik kanıtı: tohum ve kaynağı, atamalar, kura kayıtları, aday havuzu. İçerik eskisiyle birebir aynıdır; yalnız tek açılırda toplandı. */
function PanelEvidence({ panel: e }: { panel: ExpertPanelInfo }) {
  const draws = e.draws ?? [];
  return (
    <Details summary="Kura ve adillik kanıtı" meta={expertEvidenceMeta(e)} id="kura" className="expert-evidence">
      <div className="stack">
        <div className="small expert-seed">
          <strong>Kura tohumu:</strong> <HashText hash={e.seed} chars={12} label="Kura tohumu" />
          <div className="muted">
            SHA256(blok hash ‖ öneri ‖ tur) — blok <Link to={routes.block(e.seedSource.blockHeight)}>#{e.seedSource.blockHeight}</Link> (
            <HashText hash={e.seedSource.blockHash} chars={8} copy={false} />
            ), tur {e.seedSource.round}. Blok önceden taahhüt edildiği için <Term id="kura">kura</Term> sonradan seçilemez; herkes çekilişi yeniden üretebilir.
            {e.ledgerTx ? (
              <>
                {" "}
                Kayıt: <HashText hash={e.ledgerTx} chars={8} to={routes.tx(e.ledgerTx)} copy={false} />
              </>
            ) : null}
          </div>
        </div>

        {e.assignments.length ? (
          <div className="stack-sm">
            <SubHeading level={4}>Atamalar</SubHeading>
            <Table
              caption="Bilirkişi atamaları"
              rowKey={(a) => a.id}
              rows={e.assignments}
              columns={[
                { key: "n", header: "Bilirkişi", render: (a) => <UserLink id={a.expertId} nickname={a.nickname} isExpert /> },
                { key: "s", header: "Durum", render: (a) => <AssignmentStatusCell status={a.status} recuseReason={a.recuseReason} /> },
                { key: "d", header: "Son gün", render: (a) => <Time at={a.dueAt} mode="absolute" /> },
              ]}
            />
          </div>
        ) : null}

        {draws.length ? (
          <Details summary={`Kura kayıtları (${draws.length})`}>
            <div className="stack-sm">
              <DrawList draws={draws} />
              <p className="small muted">
                Çekinme ya da görevden alma ile boşalan yer için yedek kura aynı panelin aday listesinden, türetilmiş tohumla (tohum ‖ yedek ‖ sıra) yapılır ve ayrı bir
                EXPERT_DRAW kaydı olarak deftere yazılır. Kayıtta kişisel veri yoktur; adaylar öneriye özel takma değerlerle yer alır.
              </p>
            </div>
          </Details>
        ) : null}

        {e.candidates.length ? (
          <Details summary={`Aday havuzu (${e.candidates.length})`}>
            <Table
              caption="Bilirkişi adayları, kura ağırlıkları ve çıkar çatışmaları"
              rowKey={(c) => c.userId}
              rows={e.candidates}
              columns={[
                { key: "n", header: "Aday", render: (c) => <UserLink id={c.userId} nickname={c.nickname} showExpert={false} /> },
                { key: "w", header: "Ağırlık", align: "right", render: (c) => fmtDecimal(c.weight, 3) },
                { key: "s", header: "Yumuşak çatışma", align: "right", render: (c) => (c.softConflict ? fmtDecimal(c.softConflict, 1) : "—") },
                { key: "x", header: "Dışlanma", render: (c) => c.excludedReason ?? "—" },
              ]}
            />
            <p className="small muted">
              Ağırlık w = clamp(itibar, 0,5, 1,5) / (1 + aktif görev) · (1 − yumuşak çatışma). Yazarın kendisi, aile/iş/hane yakınları ve önceki panel üyeleri dışlanır.
            </p>
          </Details>
        ) : null}
      </div>
    </Details>
  );
}

function PanelBody({ panel: e }: { panel: ExpertPanelInfo }) {
  return (
    <div className="stack">
      <div className="row">
        <Badge tone="neutral">{e.isCounterPanel ? "Karşı bilirkişi paneli" : "Bilirkişi paneli"}</Badge>
        <span className="small muted">
          {e.round}. kura · <Time at={e.createdAt} />
        </span>
      </div>
      {e.noExpertAvailable ? (
        <Alert tone="warning" title="Bilirkişi bulunamadı">
          Alan (ve üst kategori) için uygun, çıkar çatışması olmayan etkin bilirkişi yok. Süreç durmaz; oylama raporsuz yapılır ve bu durum işaretlenir.
        </Alert>
      ) : null}
      {e.suspensiveFlag ? (
        <Alert tone="warning" title="Askı kuralı uygulandı">
          Rapor verenlerin en az 2/3'ü “uygulanamaz” dedi ve güven medyanı ≥ 0,8: tartışma bir kez uzatıldı ve oylama ekranında uyarı gösterilir. Eşik değişmez.
        </Alert>
      ) : null}
      <PanelEvidence panel={e} />
    </div>
  );
}

export function ExpertPanelCard({ proposal: p, onUpdated }: { proposal: ProposalDetail; onUpdated: (p: ProposalDetail) => void }) {
  const auth = useAuth();
  const [question, setQuestion] = useState("");
  const [extraQuestions, setExtraQuestions] = useState<ExpertQuestion[]>([]);
  const askForm = useInlineDisclosure();
  const askRef = useRef<HTMLTextAreaElement>(null);
  const focusAsk = useRef(false);
  const panel = p.expertPanel;
  const closed = CLOSED.includes(p.status);
  const canRequest = (p.status === "sponsoring" || p.status === "deliberation") && auth.can("V");
  const canAsk = !closed && auth.can("V");

  // [Soru sor] ile açılınca odak metin alanına geçer (alan açılmadan önce gizliydi; odak açıldıktan sonra verilir).
  useEffect(() => {
    if (askForm.open && focusAsk.current) {
      focusAsk.current = false;
      askRef.current?.focus();
    }
  }, [askForm.open]);

  const request = useAction(() => requestExperts(p.id, "panel"), {
    success: "Bilirkişi talebiniz kaydedildi. Eşiğe ulaşınca (ya da yazar talep ettiyse) kura çekilir.",
    onSuccess: onUpdated,
  });
  const ask = useAction(() => askExpertQuestion(p.id, question.trim()), {
    success: (q) => (q.minorityGuaranteed ? "Sorunuz azınlık güvencesiyle eklendi: bilirkişi yanıtlamak zorunda." : "Sorunuz bilirkişilere iletildi."),
    onSuccess: (q) => {
      setQuestion("");
      setExtraQuestions((xs) => [...xs, q]);
    },
  });

  const questions: ExpertQuestion[] = [];
  for (const q of [...(p.expertQuestions ?? []), ...(panel?.questions ?? []), ...extraQuestions]) {
    if (!questions.some((x) => x.id === q.id)) questions.push(q);
  }
  const verdict = expertVerdict({ panel: panel ?? null, questionCount: questions.length, requiresExpert: !!p.params?.requiresExpert });
  const formId = useId();

  return (
    <Card
      title="Bilirkişi görüşü"
      summary={verdict.text}
      summaryTone={verdict.tone}
      footer={<span className="small muted expert-role-note">Bilirkişi danışmandır; oy ağırlığı yoktur, oyu 1'dir. Hukuki nitelendirme yapmaz.</span>}
      anchor="bilirkisi"
    >
      <div className="stack">
        {panel ? (
          <PanelBody panel={panel} />
        ) : (
          <div className="stack-sm">
            {canRequest ? (
              <div>
                <Button size="sm" icon="experts" loading={request.loading} onClick={() => void request.run()}>
                  Bilirkişi paneli talep et
                </Button>
              </div>
            ) : null}
            <Details summary="Panel ne zaman çekilir?">
              <p className="small">
                {p.params?.requiresExpert
                  ? "Bu öneri bilirkişi görüşü gerektiriyor: panel tartışma evresinde, önceden taahhüt edilen blokla kurayla çekilir."
                  : "Uygun seçmenlerin %10'u ya da yazar talep ederse panel çekilir."}
              </p>
            </Details>
          </div>
        )}

        {panel?.reports.length ? (
          <div className="stack-sm">
            <SubHeading>Raporlar ({panel.reports.length})</SubHeading>
            <ul className="list">
              {panel.reports.map((r) => (
                <ReportRow key={r.id} r={r} questions={questions} />
              ))}
            </ul>
          </div>
        ) : panel && !panel.noExpertAvailable ? (
          <p className="small muted">Süre içinde rapor gelmezse oylama raporsuz başlar ve bilirkişinin itibarı düşer.</p>
        ) : null}

        <div className="stack-sm">
          <div className="row-between">
            <SubHeading>Bilirkişiye sorular ({questions.length})</SubHeading>
            {canAsk ? (
              <Button
                size="sm"
                aria-expanded={askForm.open}
                aria-controls={formId}
                onClick={() => {
                  focusAsk.current = !askForm.open;
                  askForm.setOpen(!askForm.open);
                }}
              >
                {askForm.open ? "Soru formunu gizle" : question.trim() ? "Soru sor (taslak var)" : "Soru sor"}
              </Button>
            ) : null}
          </div>
          {questions.length ? (
            <ul className="list">
              {questions.map((q) => (
                <li key={q.id} className="list-item stack-sm">
                  <div className="row small">
                    <UserLink id={q.authorId} nickname={q.authorNickname} />
                    <Time at={q.createdAt} className="muted" />
                    {q.minorityGuaranteed ? (
                      <>
                        <Badge tone="neutral" title="En küçük anlamlı görüş grubundan ilk soru: bilirkişi yanıtlamak zorundadır">
                          Azınlık güvenceli
                        </Badge>
                        {/* Açıklama dokunmatikte de okunsun (title yalnız masaüstünde görünür). */}
                        <span className="muted">ilk soru · bilirkişi yanıtlamak zorundadır</span>
                      </>
                    ) : null}
                  </div>
                  <PlainText text={q.body} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">Henüz soru yok.</p>
          )}
          {canAsk ? (
            <div id={formId} ref={askForm.bodyRef} hidden={!askForm.open}>
              <form
                className="stack-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask.run();
                }}
              >
                <Textarea
                  ref={askRef}
                  label="Bilirkişiye soru sor"
                  hint={`${TEXT_LIMITS.expertQuestion.min}–${TEXT_LIMITS.expertQuestion.max} karakter. En küçük anlamlı görüş grubundan gelen ilk soru “azınlık güvenceli” olur: henüz rapor vermemiş bilirkişiler bu soruyu yanıtlamadan rapor gönderemez.`}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  maxLength={TEXT_LIMITS.expertQuestion.max}
                  showCount
                  rows={3}
                />
                <div className="form-actions">
                  <Button type="submit" loading={ask.loading} disabled={question.trim().length < TEXT_LIMITS.expertQuestion.min}>
                    Soruyu gönder
                  </Button>
                </div>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
