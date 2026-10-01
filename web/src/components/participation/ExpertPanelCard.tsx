// Bilirkişi paneli (ALGORITMA §8): tohum ve kaynağı, adaylar (ağırlık, yumuşak çatışma, dışlanma), atamalar (çekinme
// gerekçeleriyle), kura kayıtları (ilk kura + yedek kuraların EXPERT_DRAW defter işlemleri), raporlar (YZ hukuki nitelendirme
// uyarılarıyla), sorular (azınlık güvenceli), askı bayrağı. Bilirkişi danışmandır; oyu 1'dir.
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ASSESSMENT_LABELS,
  ASSIGNMENT_STATUS_LABELS,
  type ExpertDrawRecord,
  type ExpertPanelInfo,
  type ExpertQuestion,
  type ExpertReportView,
  type ProposalDetail,
} from "@forum/shared";
import { askExpertQuestion, requestExperts } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { formatPercent } from "../../lib/format";
import { routes } from "../../lib/routes";
import { useAction } from "../../lib/useAsync";
import { AiLabel, Alert, Badge, Button, Card, Details, HashText, Table, Textarea, Time } from "../../ui";
import { UserLink } from "../UserLink";
import { fmtDecimal, PlainText, SubHeading } from "./common";

const CLOSED = ["enacted", "rejected", "withdrawn", "expired", "inadmissible"];

function ReportView({ r, questions }: { r: ExpertReportView; questions: ExpertQuestion[] }) {
  const tone = r.assessment === "feasible" ? "success" : r.assessment === "infeasible" ? "danger" : "warning";
  return (
    <li className="list-item stack-sm">
      <div className="row small">
        <UserLink id={r.expertId} nickname={r.expertNickname} isExpert />
        <Badge tone={tone}>{ASSESSMENT_LABELS[r.assessment]}</Badge>
        <span>güven {formatPercent(r.confidence)}</span>
        <Time at={r.createdAt} className="muted" />
      </div>
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
        <Details summary={`Sorulara yanıtlar (${r.answers.length})`}>
          <dl className="qa-list small">
            {r.answers.map((a) => (
              <div key={a.questionId}>
                <dt>{questions.find((q) => q.id === a.questionId)?.body ?? "Soru"}</dt>
                <dd>{a.answer}</dd>
              </div>
            ))}
          </dl>
        </Details>
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

function PanelBody({ panel: e }: { panel: ExpertPanelInfo }) {
  const draws = e.draws ?? [];
  return (
    <div className="stack">
      <div className="row">
        <Badge tone="accent">{e.isCounterPanel ? "Karşı bilirkişi paneli" : "Bilirkişi paneli"}</Badge>
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

      <div className="small">
        <strong>Kura tohumu:</strong> <HashText hash={e.seed} chars={12} label="Kura tohumu" />
        <div className="muted">
          SHA256(blok hash ‖ öneri ‖ tur) — blok <Link to={routes.block(e.seedSource.blockHeight)}>#{e.seedSource.blockHeight}</Link> (
          <HashText hash={e.seedSource.blockHash} chars={8} copy={false} />
          ), tur {e.seedSource.round}. Blok önceden taahhüt edildiği için kura sonradan seçilemez; herkes çekilişi yeniden üretebilir.
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
  );
}

export function ExpertPanelCard({ proposal: p, onUpdated }: { proposal: ProposalDetail; onUpdated: (p: ProposalDetail) => void }) {
  const auth = useAuth();
  const [question, setQuestion] = useState("");
  const [extraQuestions, setExtraQuestions] = useState<ExpertQuestion[]>([]);
  const panel = p.expertPanel;
  const closed = CLOSED.includes(p.status);
  const canRequest = (p.status === "sponsoring" || p.status === "deliberation") && auth.can("V");

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

  return (
    <Card title="Bilirkişi görüşü" subtitle="Bilirkişi danışmandır; oy ağırlığı yoktur, oyu 1'dir. Hukuki nitelendirme yapmaz.">
      <div className="stack">
        {panel ? (
          <PanelBody panel={panel} />
        ) : (
          <div className="stack-sm">
            <p className="small">
              Henüz bilirkişi paneli çekilmedi.{" "}
              {p.params?.requiresExpert
                ? "Bu öneri bilirkişi görüşü gerektiriyor: panel tartışma evresinde, önceden taahhüt edilen blokla kurayla çekilir."
                : "Uygun seçmenlerin %10'u ya da yazar talep ederse panel çekilir."}
            </p>
            {canRequest ? (
              <div>
                <Button size="sm" icon="experts" loading={request.loading} onClick={() => void request.run()}>
                  Bilirkişi paneli talep et
                </Button>
              </div>
            ) : null}
          </div>
        )}

        {panel?.reports.length ? (
          <div className="stack-sm">
            <SubHeading>Raporlar ({panel.reports.length})</SubHeading>
            <ul className="list">
              {panel.reports.map((r) => (
                <ReportView key={r.id} r={r} questions={questions} />
              ))}
            </ul>
          </div>
        ) : panel && !panel.noExpertAvailable ? (
          <p className="small muted">Henüz rapor gelmedi. Süre içinde rapor gelmezse oylama raporsuz başlar ve bilirkişinin itibarı düşer.</p>
        ) : null}

        <div className="stack-sm">
          <SubHeading>Bilirkişiye sorular ({questions.length})</SubHeading>
          {questions.length ? (
            <ul className="list">
              {questions.map((q) => (
                <li key={q.id} className="list-item stack-sm">
                  <div className="row small">
                    <UserLink id={q.authorId} nickname={q.authorNickname} />
                    <Time at={q.createdAt} className="muted" />
                    {q.minorityGuaranteed ? (
                      <Badge tone="accent" title="En küçük anlamlı görüş grubundan ilk soru: bilirkişi yanıtlamak zorundadır">
                        Azınlık güvenceli
                      </Badge>
                    ) : null}
                  </div>
                  <PlainText text={q.body} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">Henüz soru yok.</p>
          )}
          {!closed && auth.can("V") ? (
            <form
              className="stack-sm"
              onSubmit={(e) => {
                e.preventDefault();
                void ask.run();
              }}
            >
              <Textarea
                label="Bilirkişiye soru sor"
                hint="10–2000 karakter. En küçük anlamlı görüş grubundan gelen ilk soru “azınlık güvenceli” olur ve yanıtlanması zorunludur."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={2000}
                showCount
                rows={3}
              />
              <div className="form-actions">
                <Button type="submit" loading={ask.loading} disabled={question.trim().length < 10}>
                  Soruyu gönder
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
