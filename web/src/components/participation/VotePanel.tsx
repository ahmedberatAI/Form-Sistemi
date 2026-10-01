// Oy paneli (voting / revote): gizli oy (taahhüt), makbuzun cihaza kaydı, "Oyum kayıtlı mı?" bağlantısı.
// Oylama sürerken yalnızca katılım gösterilir; sonuçlar oylama bitince açıklanır.
import { Link, useLocation } from "react-router-dom";
import { useState } from "react";
import { VOTE_LABELS, type BallotReceipt, type ProposalDetail, type VoteChoice } from "@forum/shared";
import { vote } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { formatPercent } from "../../lib/format";
import { listReceipts, saveReceipt } from "../../lib/receipts";
import { routes } from "../../lib/routes";
import { useAction, useAsync } from "../../lib/useAsync";
import { Alert, Button, Card, Countdown, HashText, KeyValue, LinkButton, ProgressBar, RadioGroup, Time, VoteBadge } from "../../ui";

const CHOICE_HINTS: Record<VoteChoice, string> = {
  yes: "Öneriyi kabul ediyorum.",
  no: "Karşıyım. İlk turda Red diyenler kabul hâlinde itiraz edebilir.",
  abstain: "Katılıma sayılır, onay oranına sayılmaz.",
};

export interface VotePanelProps {
  proposal: ProposalDetail;
  setProposal: (fn: (prev: ProposalDetail | undefined) => ProposalDetail | undefined) => void;
  reload: () => void;
}

export function VotePanel({ proposal: p, setProposal, reload }: VotePanelProps) {
  const auth = useAuth();
  const location = useLocation();
  const [choice, setChoice] = useState<VoteChoice | null>(p.myBallot?.choice ?? null);
  const current = p.myBallot;
  const local = useAsync(() => listReceipts(p.id), [p.id, current?.receipt.commitment, auth.user?.id]);
  const hasLocal = !!current && (local.data ?? []).some((r) => r.commitment === current.receipt.commitment);

  const cast = useAction(
    async (c: VoteChoice) => {
      const r = await vote(p.id, c);
      await saveReceipt(r, { proposalTitle: p.title, proposalSeq: p.seq });
      return r;
    },
    {
      success: (r: BallotReceipt) => `Oyunuz (${VOTE_LABELS[r.choice]}) kaydedildi; makbuz bu cihaza kaydedildi.`,
      onSuccess: (r) => {
        setProposal((prev) => (prev ? { ...prev, myBallot: { choice: r.choice, receipt: r } } : prev));
        void local.reload();
        reload();
      },
    },
  );
  const saveLocal = useAction(async () => {
    if (current) await saveReceipt(current.receipt, { proposalTitle: p.title, proposalSeq: p.seq });
    await local.reload();
  }, { success: "Makbuz bu cihaza kaydedildi." });

  const round = p.status === "revote" ? 2 : 1;
  const part = p.participation;
  const params = p.params;

  return (
    <Card
      title={round === 2 ? "Yeniden oylama" : "Oylama"}
      subtitle="Gizli oy: oyunuz deftere yalnızca taahhüt (özet) olarak yazılır; kimin ne oy verdiği açıklanmaz."
      actions={<Countdown to={p.phaseEndsAt} prefix="Kalan" />}
      tone="accent"
    >
      <div className="stack">
        {part ? (
          <ProgressBar label="Katılım" value={part.voted} max={Math.max(1, part.eligible)} valueText={`${part.voted}/${part.eligible} uygun seçmen`} tone="accent" />
        ) : null}
        <Alert tone="info">Oylama sürerken yalnızca katılım gösterilir. Sonuçlar oylama bitince açıklanır; ara sonuç kimseye gösterilmez.</Alert>

        {round === 2 && params ? (
          <p className="small">
            {p.reconciliationOrigin === "objection"
              ? `İtiraz sonrası yeniden oylama: kabul için onay oranı en az ${formatPercent(params.revoteThreshold.num / params.revoteThreshold.den)} olmalı (güçlü itirazda en az 2/3). Görüş grubu tabanları bu turda uygulanmaz, yalnızca gösterilir.`
              : `Yeniden oylama: genel eşik ve köprü testi birlikte sağlanırsa ya da onay oranı en az ${formatPercent(params.overrideThreshold.num / params.overrideThreshold.den)} olursa kabul edilir. Azınlığın gücü erteleyicidir, mutlak değildir.`}{" "}
            Sonuç kesindir.
          </p>
        ) : null}

        {p.expertPanel?.suspensiveFlag ? (
          <Alert tone="warning" title="Bilirkişi askı uyarısı">
            Rapor veren bilirkişilerin en az 2/3'ü öneriyi uygulanamaz buldu (yüksek güvenle). Eşik değişmez; kararınızı verirken bilirkişi raporlarını okuyun.
          </Alert>
        ) : params?.requiresExpert && !(p.expertPanel?.reports.length ?? 0) ? (
          <Alert tone="warning">Bu öneri bilirkişi görüşü gerektiriyordu ancak süre içinde rapor gelmedi; oylama raporsuz başladı.</Alert>
        ) : null}

        {!auth.user ? (
          <Alert tone="info" title="Oy vermek için giriş yapın">
            <Link to="/giris" state={{ from: location.pathname }}>
              Giriş yap
            </Link>
          </Alert>
        ) : !p.canVote ? (
          <Alert tone="info" title="Bu oylamada oy veremiyorsunuz">
            {!auth.can("VV")
              ? "Oy vermek için doğrulanmış, 18 yaşından büyük olmanız ve siyasi görüş verisi için açık rıza vermeniz gerekir (Profil → Rızalar)."
              : "Uygun seçmen listesi oylama açılırken dondurulur; öneri oluşturulduktan sonra doğrulanan üyeler ve (silme taleplerinde) hedef mesajın yazarı bu listede yer almaz."}
          </Alert>
        ) : (
          <form
            className="stack-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (choice) void cast.run(choice);
            }}
          >
            <RadioGroup<VoteChoice>
              label={current ? "Oyunuzu değiştirebilirsiniz" : "Oyunuz"}
              layout="cards"
              value={choice}
              onChange={setChoice}
              options={(["yes", "no", "abstain"] as VoteChoice[]).map((c) => ({ value: c, label: VOTE_LABELS[c], hint: CHOICE_HINTS[c] }))}
              hint="Süre bitene kadar oyunuzu değiştirebilirsiniz; geçerli olan en son oyunuzdur. Doğrudan oy verirseniz vekâletiniz bu oylamada askıya alınır."
            />
            <div className="form-actions">
              <Button type="submit" variant="primary" icon="vote" loading={cast.loading} disabled={!choice || choice === current?.choice}>
                {current ? "Oyumu değiştir" : "Oyumu ver"}
              </Button>
            </div>
          </form>
        )}

        {current ? (
          <div className="receipt-box stack-sm">
            <p>
              Geçerli oyunuz: <VoteBadge choice={current.choice} /> <span className="small muted">· <Time at={current.receipt.castAt} mode="both" /></span>
            </p>
            <KeyValue
              compact
              items={[
                { label: "Oy pusulası kimliği", value: <HashText hash={current.receipt.ballotId} chars={12} label="Oy pusulası kimliği" />, hint: "Öneriye özeldir; farklı önerilerdeki oylarınız birbirine bağlanamaz." },
                { label: "Taahhüt", value: <HashText hash={current.receipt.commitment} chars={12} label="Taahhüt" /> },
                {
                  label: "Defter işlemi",
                  value: current.receipt.txHash ? <HashText hash={current.receipt.txHash} chars={12} to={routes.tx(current.receipt.txHash)} label="Defter işlemi" /> : "bekleniyor",
                },
              ]}
            />
            <div className="row">
              {hasLocal ? (
                <span className="small receipt-saved">✔ Makbuz bu cihazda kayıtlı</span>
              ) : (
                <Button size="sm" onClick={() => void saveLocal.run()} loading={saveLocal.loading}>
                  Makbuzu bu cihaza kaydet
                </Button>
              )}
              <LinkButton size="sm" variant="primary" icon="verify" to={routes.verifyVote({ proposalId: p.id })}>
                Oyum kayıtlı mı?
              </LinkButton>
            </div>
            <p className="small muted">
              Makbuz (seçiminiz ve tuz) cihazınızda saklanır; onunla oyunuzun deftere doğru yazıldığını sunucuya güvenmeden doğrulayabilirsiniz. Oyu değiştirirseniz eski
              makbuz geçersiz olur.
            </p>
          </div>
        ) : auth.user && p.canVote ? (
          <p className="small muted">Doğrudan oy vermezseniz, varsa vekâletiniz uygulanır (en fazla {params?.delegationMaxHops ?? 3} adım). Doğrudan oy her zaman önceliklidir.</p>
        ) : null}
      </div>
    </Card>
  );
}
