// Tartışmanın YZ özeti (danışma): ortak zemin, tartışmalı noktalar, azınlık görüşleri (HER ZAMAN açık), açık sorular.
// Her madde alıntıladığı mesajlara bağlanır (tartışmadaki mesaja kaydırır). Düzen: önce azınlık görüşleri (hep açık), sonra
// 'Ortak zemin (n)', 'Tartışmalı noktalar (n)' ve 'Açık sorular (n)' başlık ve sayıyla açılırlar ('Tam' görünümde açık gelir);
// kapsam çubuğu yerine tek satır metin. Özet yoksa tek satır (azınlık görüşleri özet üretilince ayrı bölümde gösterilir).
// Derin bağlantı çapası #yz (?bolum=yz); 'danışmandır' notu yalnız altyazıdadır (AiLabel notu tekrar edilmez).
import type { AiAnalysisInfo, AiCitedPoint, DiscussionSummary, MessageView, ProposalDetail } from "@forum/shared";
import { requestAiSummary } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { useAction } from "../../lib/useAsync";
import { AiLabel, Button, Card, Details, useToast } from "../../ui";
import { SubHeading, scrollToMessage } from "./common";
import "./expert-ai.css";

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

/** Açılır bölümün başlığı: "Ortak zemin (3)". */
export function aiSectionLabel(title: string, items: AiCitedPoint[] | undefined): string {
  return `${title} (${items?.length ?? 0})`;
}

/** Kapsam ve özete giren mesaj sayısı tek satırda: "Kapsam: %67 (özette alıntılanan mesajların oranı) · özete giren mesaj: 12". Hiçbiri yoksa null. */
export function aiSummaryStats(out: Pick<SummaryOutput, "coverage" | "messageCount">): string | null {
  const parts = [
    typeof out.coverage === "number" && Number.isFinite(out.coverage) ? `Kapsam: %${Math.round(out.coverage * 100)} (özette alıntılanan mesajların oranı)` : null,
    typeof out.messageCount === "number" ? `özete giren mesaj: ${out.messageCount}` : null,
  ].filter((x): x is string => !!x);
  return parts.length ? parts.join(" · ") : null;
}

/** Özet yokken tek satır. Azınlık görüşleri kuralı burada da söylenir; üretemeyenlere kimin üretebileceği eklenir. */
export function aiEmptyLine(canGenerate: boolean): string {
  const base = "Henüz YZ özeti yok — azınlık görüşleri, özet üretilince ayrı bölümde gösterilir.";
  return canGenerate ? base : `${base} Özeti doğrulanmış üyeler üretebilir.`;
}

/** Madde varsa başlık ve sayıyla açılır; yoksa açılacak bir şey olmadığından tek satır. */
function AiSection({ title, items, empty, messages }: { title: string; items: AiCitedPoint[] | undefined; empty: string; messages: Map<string, MessageView> }) {
  if (!items || !items.length) {
    return (
      <p className="small muted ai-section-empty">
        <strong>{aiSectionLabel(title, items)}</strong> — {empty}
      </p>
    );
  }
  return (
    <Details summary={aiSectionLabel(title, items)} className="ai-section">
      <Points items={items} empty={empty} messages={messages} />
    </Details>
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
  const stats = out ? aiSummaryStats(out) : null;

  return (
    <Card
      title="Tartışma özeti (yapay zekâ)"
      subtitle="YZ danışmandır, karar vermez."
      anchor="yz"
      actions={
        canGen ? (
          <Button size="sm" icon="ai" loading={gen.loading} onClick={() => void gen.run()}>
            {analysis ? "Yeniden üret" : "Özet üret"}
          </Button>
        ) : null
      }
    >
      {!analysis || !out ? (
        <p className="small muted">{aiEmptyLine(canGen)}</p>
      ) : (
        // Danışma notu kartın altyazısında bir kez yazar ('YZ danışmandır, karar vermez.'); etiket ve data-ai-generated kalır.
        <AiLabel info={analysis} hideNote>
          <div className="stack-sm">
            <section className="stack-sm ai-minority" aria-label="Azınlık görüşleri">
              <SubHeading level={4}>Azınlık görüşleri</SubHeading>
              <Points items={out.minorityViews} empty="Henüz azınlık görüşü yok." messages={messages} />
            </section>
            <AiSection title="Ortak zemin" items={out.commonGround} empty="Ortak zemin bulunamadı." messages={messages} />
            <AiSection title="Tartışmalı noktalar" items={out.contested} empty="Belirgin bir tartışmalı nokta yok." messages={messages} />
            <AiSection title="Açık sorular" items={out.openQuestions} empty="Açık soru yok." messages={messages} />
            {stats ? <p className="small muted ai-stats">{stats}</p> : null}
            {out.note ? <p className="small muted">{out.note}</p> : null}
          </div>
        </AiLabel>
      )}
    </Card>
  );
}
