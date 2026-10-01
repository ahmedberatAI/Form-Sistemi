// Uzlaşma turu (ALGORITMA §7): köken, azınlık raporları, YZ köprü taslakları (yazar birini benimseyebilir),
// karşı bilirkişi talebi ve metin revizyonu. İnsan onayı olmadan hiçbir şey değişmez.
import { useState } from "react";
import type { AiAnalysisInfo, MinorityReport, ProposalDetail } from "@forum/shared";
import { addMinorityReport, approveAiAnalysis, requestAiBridging, requestExperts } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { formatPercent } from "../../lib/format";
import { useAction } from "../../lib/useAsync";
import { AiLabel, Alert, Button, Card, Countdown, Details, DiffView, Textarea, useConfirm } from "../../ui";
import { MinorityReportList } from "./ResultsCard";
import { PlainText, SubHeading } from "./common";
import { ProposalEditor } from "./ProposalEditor";

interface BridgingOutput {
  drafts?: { title: string; body: string; rationale?: string }[];
  baseVersion?: number;
  note?: string | null;
}

/**
 * Azınlık raporu formu: yalnızca sunucunun `canWriteMinorityReport` dediği görüntüleyene (uygun seçmen, tur-1 etkin oyu
 * "red" — vekâletle dahil —, rapor evresi, henüz yazmamış). Diğer oturum açmış üyelere kısa bir açıklama gösterilir.
 */
export function MinorityReportForm({ proposal: p, onAdded }: { proposal: ProposalDetail; onAdded: (r: MinorityReport) => void }) {
  const auth = useAuth();
  const [body, setBody] = useState("");
  const [open, setOpen] = useState(false);
  const send = useAction(() => addMinorityReport(p.id, body.trim()), {
    success: "Azınlık raporunuz karar kaydına eklendi.",
    onSuccess: (r) => {
      setBody("");
      setOpen(false);
      onAdded(r);
    },
  });
  // Eski sunucu alanı göndermezse önceki davranış (oy verebilir üye; sunucu yine denetler).
  const allowed = p.canWriteMinorityReport ?? auth.can("VV");
  if (!allowed) {
    if (!auth.user) return null;
    const mine = p.minorityReports.some((r) => r.authorId === auth.user?.id);
    return (
      <p className="small muted">
        {mine
          ? "Bu karar için azınlık raporunuzu yazdınız; rapor karar kaydına eklendi."
          : "Azınlık raporunu yalnızca ilk turda etkin oyu “Red” olan (vekâletle dahil) uygun seçmenler, bir kez yazabilir."}
      </p>
    );
  }
  if (!open)
    return (
      <div>
        <Button size="sm" icon="proposals" onClick={() => setOpen(true)}>
          Azınlık raporu yaz
        </Button>
      </div>
    );
  return (
    <form
      className="stack-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void send.run();
      }}
    >
      <Textarea
        label="Azınlık raporu"
        hint="50–5000 karakter. Yalnızca ilk turda etkin oyu “Red” olan seçmenler, bir kez yazabilir. Rapor karar kaydına kalıcı olarak eklenir."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={5000}
        showCount
        rows={6}
      />
      <Alert tone="warning">Raporunuz takma adınızla yayımlanır; bu, ilk turda “red” oyu verdiğinizi gösterir.</Alert>
      <div className="form-actions">
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Vazgeç
        </Button>
        <Button type="submit" variant="primary" loading={send.loading} disabled={body.trim().length < 50}>
          Raporu ekle
        </Button>
      </div>
    </form>
  );
}

function BridgingDrafts({ proposal: p, analysis, onReload }: { proposal: ProposalDetail; analysis: AiAnalysisInfo; onReload: () => void }) {
  const auth = useAuth();
  const confirm = useConfirm();
  const isAuthor = auth.user?.id === p.authorId;
  const [editing, setEditing] = useState<number | null>(null);
  const out = (analysis.output ?? {}) as BridgingOutput;
  const drafts = out.drafts ?? [];
  const adopt = useAction((i: number) => approveAiAnalysis(analysis.id, { draftIndex: i }), {
    success: "Taslak yeni sürüm olarak uygulandı (yeniden denetlendi).",
    onSuccess: () => onReload(),
  });
  const canAdopt = isAuthor && p.status === "reconciliation";

  return (
    <AiLabel info={analysis}>
      <div className="stack-sm">
        {out.baseVersion && out.baseVersion !== p.version ? (
          <Alert tone="info">Bu taslaklar sürüm {out.baseVersion} metnine göre üretildi; güncel sürüm {p.version}.</Alert>
        ) : null}
        {out.note ? <p className="small muted">{out.note}</p> : null}
        <ol className="draft-list">
          {drafts.map((d, i) => (
            <li key={i} className="stack-sm">
              <strong>
                Taslak {i + 1}: {d.title}
              </strong>
              {d.rationale ? <p className="small muted">{d.rationale}</p> : null}
              <Details summary="Taslak metni">
                <PlainText text={d.body} />
              </Details>
              <Details summary="Güncel metinle farkı">
                <DiffView before={p.body} after={d.body} context={2} label={`Taslak ${i + 1} farkı`} />
              </Details>
              {canAdopt ? (
                editing === i ? (
                  <ProposalEditor
                    proposal={p}
                    initialTitle={d.title || p.title}
                    initialBody={d.body}
                    note="Taslağı düzenleyerek yeni sürüm olarak kaydedebilirsiniz. Revizyon yeniden ontoloji denetiminden geçer."
                    onCancel={() => setEditing(null)}
                    onSaved={() => {
                      setEditing(null);
                      onReload();
                    }}
                  />
                ) : (
                  <div className="row">
                    <Button
                      size="sm"
                      variant="primary"
                      loading={adopt.loading}
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Taslak ${i + 1}'i benimse`,
                          message: "Taslak, yeni sürüm olarak uygulanır ve yeniden ontoloji denetiminden geçer. İhlal çıkarsa revizyon reddedilir ve eski metin oylanır.",
                          confirmLabel: "Benimse",
                        });
                        if (ok) void adopt.run(i);
                      }}
                    >
                      Bu taslağı benimse
                    </Button>
                    <Button size="sm" onClick={() => setEditing(i)}>
                      Düzenleyerek kullan
                    </Button>
                  </div>
                )
              ) : null}
            </li>
          ))}
        </ol>
        {!drafts.length ? <p className="small muted">Taslak üretilemedi.</p> : null}
      </div>
    </AiLabel>
  );
}

export interface ReconciliationPanelProps {
  proposal: ProposalDetail;
  onUpdated: (p: ProposalDetail) => void;
  onReload: () => void;
  onMinorityReport: (r: MinorityReport) => void;
  onNewAnalysis: (a: AiAnalysisInfo) => void;
}

export function ReconciliationPanel({ proposal: p, onUpdated, onReload, onMinorityReport, onNewAnalysis }: ReconciliationPanelProps) {
  const auth = useAuth();
  const [revising, setRevising] = useState(false);
  const isAuthor = auth.user?.id === p.authorId;
  const active = p.status === "reconciliation";
  const bridging = p.aiAnalyses.filter((a) => a.task === "bridging_drafts").sort((a, b) => b.createdAt - a.createdAt);
  const gen = useAction(() => requestAiBridging(p.id), { success: "Köprü taslakları üretildi.", onSuccess: onNewAnalysis });
  const counter = useAction(() => requestExperts(p.id, "counter"), {
    success: "Karşı bilirkişi talebiniz kaydedildi (3 üye ya da yazar talep edince yeni panel çekilir).",
    onSuccess: onUpdated,
  });
  const params = p.params;

  return (
    <Card
      title="Uzlaşma turu"
      subtitle="Azınlığın gücü erteleyicidir: karar bir kez durdurulur, yeniden düşünülür ve yeniden oylanır."
      actions={active ? <Countdown to={p.phaseEndsAt} prefix="Yeniden oylamaya" /> : null}
      tone="warning"
    >
      <div className="stack">
        <Alert tone="info" title={p.reconciliationOrigin === "objection" ? "Köken: geçerli azınlık itirazı" : "Köken: tartışmalı sonuç (köprü testi sağlanamadı)"}>
          {p.reconciliationOrigin === "objection"
            ? `İlk turda kabul çıktı ancak geçerli bir azınlık itirazı geldi. Yeniden oylamada onay oranı en az ${params ? formatPercent(params.revoteThreshold.num / params.revoteThreshold.den) : "ρ"} olmalı (güçlü itirazda en az 2/3).`
            : `Genel çoğunluk sağlandı ancak en az bir anlamlı görüş grubunun desteği tabanın altında kaldı. Yeniden oylamada köprü testi ya da en az ${params ? formatPercent(params.overrideThreshold.num / params.overrideThreshold.den) : "ω"} onay gerekir.`}{" "}
          Uygun seçmen ve görüş grubu anlık görüntüleri ilk turla aynıdır.
        </Alert>

        <section className="stack-sm" aria-label="Azınlık raporları">
          <SubHeading>Azınlık raporları ({p.minorityReports.length})</SubHeading>
          {p.minorityReports.length ? <MinorityReportList reports={p.minorityReports} /> : <p className="small muted">Henüz azınlık raporu yok.</p>}
          {active ? <MinorityReportForm proposal={p} onAdded={onMinorityReport} /> : null}
        </section>

        <section className="stack-sm" aria-label="Köprü taslakları">
          <SubHeading>Yapay zekâ köprü taslakları</SubHeading>
          <p className="small muted">
            Çoğunluk ve azınlık gerekçelerini birlikte gözeten 4–8 alternatif metin. Yazar onaylamadıkça hiçbir şey değişmez; taslaklar yalnızca danışma niteliğindedir.
          </p>
          {active && auth.can("V") ? (
            <div>
              <Button size="sm" icon="ai" loading={gen.loading} onClick={() => void gen.run()}>
                {bridging.length ? "Yeni taslaklar üret" : "YZ köprü taslakları üret"}
              </Button>
            </div>
          ) : null}
          {bridging[0] ? <BridgingDrafts proposal={p} analysis={bridging[0]} onReload={onReload} /> : <p className="small muted">Henüz taslak üretilmedi.</p>}
          {bridging.length > 1 ? (
            <Details summary={`Önceki taslak setleri (${bridging.length - 1})`}>
              <div className="stack">
                {bridging.slice(1).map((a) => (
                  <BridgingDrafts key={a.id} proposal={p} analysis={a} onReload={onReload} />
                ))}
              </div>
            </Details>
          ) : null}
        </section>

        {active ? (
          <section className="stack-sm" aria-label="Bilirkişi ve revizyon">
            <SubHeading>Karşı bilirkişi ve revizyon</SubHeading>
            {auth.can("V") ? (
              <div>
                <Button size="sm" icon="experts" loading={counter.loading} onClick={() => void counter.run()}>
                  Karşı bilirkişi talep et
                </Button>
              </div>
            ) : null}
            {isAuthor ? (
              revising ? (
                <ProposalEditor
                  proposal={p}
                  note="Revizyon yeni bir sürüm üretir ve yeniden ontoloji denetiminden geçer. İhlal çıkarsa ya da karar katmanı değişirse revizyon reddedilir ve eski metin oylanır."
                  onCancel={() => setRevising(false)}
                  onSaved={(d) => {
                    setRevising(false);
                    onUpdated(d);
                  }}
                />
              ) : (
                <div>
                  <Button size="sm" variant="primary" onClick={() => setRevising(true)}>
                    Metni revize et
                  </Button>
                </div>
              )
            ) : null}
          </section>
        ) : null}
      </div>
    </Card>
  );
}
