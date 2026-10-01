// Taslak ve destekçi toplama evresi: yazar için düzenle/gönder/geri çek; üyeler için destek (K_s ilerleme çubuğu).
import { useState } from "react";
import type { ProposalDetail } from "@forum/shared";
import { sponsorProposal, submitProposal, withdrawProposal } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { useAction } from "../../lib/useAsync";
import { Alert, Button, Card, Countdown, ProgressBar, useConfirm } from "../../ui";
import { ProposalEditor } from "./ProposalEditor";

export interface SponsorPanelProps {
  proposal: ProposalDetail;
  onUpdated: (p: ProposalDetail) => void;
}

export function WithdrawButton({ proposal: p, onUpdated }: SponsorPanelProps) {
  const confirm = useConfirm();
  const withdraw = useAction(() => withdrawProposal(p.id), { success: "Öneri geri çekildi.", onSuccess: onUpdated });
  return (
    <Button
      variant="ghost"
      size="sm"
      icon="close"
      loading={withdraw.loading}
      onClick={async () => {
        const ok = await confirm({
          title: "Öneriyi geri çek",
          message: "Öneri kapanır ve herkese açık arşivde kalır (silinmez). Destekçilere bildirim gider. Bu işlem geri alınamaz.",
          confirmLabel: "Geri çek",
          tone: "danger",
        });
        if (ok) void withdraw.run();
      }}
    >
      Geri çek
    </Button>
  );
}

export function SponsorPanel({ proposal: p, onUpdated }: SponsorPanelProps) {
  const auth = useAuth();
  const [editing, setEditing] = useState(false);
  const isAuthor = auth.user?.id === p.authorId;
  const sponsored = !!auth.user && p.sponsors.some((s) => s.userId === auth.user!.id);

  const sponsor = useAction(() => sponsorProposal(p.id), { success: "Desteğiniz kaydedildi ve deftere imza olarak yazıldı.", onSuccess: onUpdated });
  const submit = useAction(() => submitProposal(p.id), { success: "Öneri destekçi toplamaya gönderildi.", onSuccess: onUpdated });

  if (p.status === "draft") {
    return (
      <Card title="Taslak" subtitle="Bu öneri henüz yayımlanmadı; yalnızca siz görüyorsunuz." tone="muted">
        {editing ? (
          <ProposalEditor
            proposal={p}
            onCancel={() => setEditing(false)}
            onSaved={(d) => {
              setEditing(false);
              onUpdated(d);
            }}
          />
        ) : (
          <div className="stack-sm">
            <p className="small">
              Gönderdiğinizde öneri destekçi toplamaya başlar ({p.sponsorsRequired} destekçi gerekir). Destekçiler belirli bir metni imzaladığı için destek toplanırken metin
              değiştirilemez.
            </p>
            <div className="row">
              <Button variant="primary" icon="proposals" loading={submit.loading} onClick={() => void submit.run()}>
                Destekçi toplamaya gönder
              </Button>
              <Button onClick={() => setEditing(true)}>Metni düzenle</Button>
              <WithdrawButton proposal={p} onUpdated={onUpdated} />
            </div>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card title="Destekçi toplama" subtitle="Yeterli destekçi gelince ontoloji (yönetmelik) denetimi yapılır ve tartışma başlar." actions={<Countdown to={p.phaseEndsAt} prefix="Kalan" />}>
      <div className="stack">
        <ProgressBar
          label="Destekçi"
          value={p.sponsorCount}
          max={Math.max(1, p.sponsorsRequired)}
          valueText={`${p.sponsorCount}/${p.sponsorsRequired}`}
          tone={p.sponsorCount >= p.sponsorsRequired ? "success" : "primary"}
        />
        <p className="small muted">
          Destek, önerinin oylanmaya değer olduğunu onaylar; lehte oy anlamına gelmez. Gerekli destekçi sayısı K_s = max(2, min(5, ⌈√üye/2⌉)); silme taleplerinde 1.
        </p>
        {!auth.user ? (
          <Alert tone="info">Desteklemek için giriş yapın.</Alert>
        ) : isAuthor ? (
          <div className="row">
            <span className="small muted">Kendi önerinizi destekleyemezsiniz; destekçiler toplanınca bildirim alırsınız.</span>
            <WithdrawButton proposal={p} onUpdated={onUpdated} />
          </div>
        ) : !auth.can("V") ? (
          <Alert tone="info">Yalnızca doğrulanmış üyeler destek verebilir.</Alert>
        ) : sponsored ? (
          <p className="small receipt-saved">✔ Bu öneriyi desteklediniz.</p>
        ) : (
          <div>
            <Button variant="primary" icon="users" loading={sponsor.loading} onClick={() => void sponsor.run()}>
              Destekle
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
