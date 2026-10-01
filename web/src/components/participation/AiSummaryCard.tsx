// Tartışmanın YZ özeti (danışma): ortak zemin, tartışmalı noktalar, azınlık görüşleri (HER ZAMAN görünür), açık sorular.
// Her madde alıntıladığı mesajlara bağlanır (tartışmadaki mesaja kaydırır).
import type { AiAnalysisInfo, AiCitedPoint, DiscussionSummary, MessageView, ProposalDetail } from "@forum/shared";
import { requestAiSummary } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { useAction } from "../../lib/useAsync";
import { AiLabel, Button, Card, EmptyState, ProgressBar, useToast } from "../../ui";
import { SubHeading, scrollToMessage } from "./common";

type SummaryOutput = Partial<DiscussionSummary> & { note?: string | null; messageCount?: number; excludedMessages?: number };

function Points({ items, empty, messages }: { items: AiCitedPoint[] | undefined; empty: string; messages: Map<string, MessageView> }) {
  const toast = useToast();
  if (!items || !items.length) return <p className="small muted">{empty}</p>;
  return (
    <ul className="ai-points">
      {items.map((pt, i) => (
        <li key={i}>
          <span>{pt.text}</span>
          {pt.cites.length ? (
            <span className="ai-cites">
              {pt.cites.map((id) => {
                const m = messages.get(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className="cite-link"
                    onClick={() => {
                      if (!scrollToMessage(id)) toast.info("Alıntılanan mesaj tartışmada görüntülenemiyor (gizlenmiş ya da henüz yüklenmemiş olabilir).");
                    }}
                    aria-label={m ? `Alıntılanan mesaj: @${m.authorNickname}, #${m.seq}` : "Alıntılanan mesaja git"}
                  >
                    {m ? `#${m.seq}` : "mesaj"}
                  </button>
                );
              })}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function latestAnalysis(list: AiAnalysisInfo[], task: AiAnalysisInfo["task"]): AiAnalysisInfo | null {
  return list.filter((a) => a.task === task).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

export function AiSummaryCard({
  proposal: p,
  messages,
  onNewAnalysis,
}: {
  proposal: ProposalDetail;
  messages: Map<string, MessageView>;
  onNewAnalysis: (a: AiAnalysisInfo) => void;
}) {
  const auth = useAuth();
  const analysis = latestAnalysis(p.aiAnalyses, "summarize");
  const out = (analysis?.output ?? null) as SummaryOutput | null;
  const gen = useAction(() => requestAiSummary(p.id), { success: "Tartışma özeti üretildi.", onSuccess: onNewAnalysis });
  const canGen = auth.can("V") && p.status !== "draft";

  return (
    <Card
      title="Tartışma özeti (yapay zekâ)"
      subtitle="YZ danışmandır, karar vermez. Azınlık görüşleri bölümü her zaman gösterilir."
      actions={
        canGen ? (
          <Button size="sm" icon="ai" loading={gen.loading} onClick={() => void gen.run()}>
            {analysis ? "Yeniden üret" : "Özet üret"}
          </Button>
        ) : null
      }
    >
      {!analysis || !out ? (
        <div className="stack-sm">
          <EmptyState title="Henüz özet yok" icon="ai">
            <p>{canGen ? "“Özet üret” ile tartışmanın ortak zeminini, tartışmalı noktalarını ve azınlık görüşlerini çıkarabilirsiniz." : "Özeti doğrulanmış üyeler üretebilir."}</p>
          </EmptyState>
          <SubHeading level={4}>Azınlık görüşleri</SubHeading>
          <p className="small muted">Henüz azınlık görüşü yok.</p>
        </div>
      ) : (
        <AiLabel info={analysis}>
          <div className="stack">
            <section className="stack-sm">
              <SubHeading level={4}>Ortak zemin</SubHeading>
              <Points items={out.commonGround} empty="Ortak zemin bulunamadı." messages={messages} />
            </section>
            <section className="stack-sm">
              <SubHeading level={4}>Tartışmalı noktalar</SubHeading>
              <Points items={out.contested} empty="Belirgin bir tartışmalı nokta yok." messages={messages} />
            </section>
            <section className="stack-sm ai-minority" aria-label="Azınlık görüşleri">
              <SubHeading level={4}>Azınlık görüşleri</SubHeading>
              <Points items={out.minorityViews} empty="Henüz azınlık görüşü yok." messages={messages} />
            </section>
            <section className="stack-sm">
              <SubHeading level={4}>Açık sorular</SubHeading>
              <Points items={out.openQuestions} empty="Açık soru yok." messages={messages} />
            </section>
            {typeof out.coverage === "number" ? (
              <ProgressBar label="Kapsam (özette alıntılanan mesajların oranı)" value={out.coverage} tone="accent" valueText={`%${Math.round(out.coverage * 100)}`} />
            ) : null}
            {out.note ? <p className="small muted">{out.note}</p> : null}
            {typeof out.messageCount === "number" ? <p className="small muted">Özete giren mesaj: {out.messageCount}</p> : null}
          </div>
        </AiLabel>
      )}
    </Card>
  );
}
