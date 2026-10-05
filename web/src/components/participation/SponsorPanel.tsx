// Taslak ve destekçi toplama evresi: yazar için düzenle/gönder/geri çek; üyeler için destek (K_s ilerleme çubuğu).
// 'Eylem önce': Destekle düğmesi ilerleme çubuğunun hemen altındadır; K_s formülü ve evre açıklaması 'Kaç destekçi gerekir?'
// açılırında durur (kapalı gelir, 'Tam' görünümde açık).
import { useEffect, useRef, useState } from "react";
import type { ProposalDetail } from "@forum/shared";
import { sponsorProposal, submitProposal, withdrawProposal } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { useAction } from "../../lib/useAsync";
import { Alert, Button, Card, Countdown, Details, ProgressBar, useConfirm } from "../../ui";
import { ProposalEditor } from "./ProposalEditor";
import "./panels.css";

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

/** Odak kaybolduysa (ör. eylem paneli kalktı) sayfanın h1 başlığına taşır; ekran okuyucu bağlamı kaybetmez. */
export function focusPageHeading(): void {
  if (typeof document === "undefined") return;
  const active = document.activeElement;
  if (active && active !== document.body) return;
  const h1 = document.querySelector<HTMLElement>("main h1, h1");
  if (!h1) return;
  if (!h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
  h1.focus();
}

export function SponsorPanel({ proposal: p, onUpdated }: SponsorPanelProps) {
  const auth = useAuth();
  const [editing, setEditing] = useState(false);
  const isAuthor = auth.user?.id === p.authorId;
  const sponsored = !!auth.user && p.sponsors.some((s) => s.userId === auth.user!.id);

  // 'Destekle' düğmesi destek verilince kalkar: odak belgeye (body) düşmesin diye "desteklediniz" satırına taşınır (WCAG 2.4.3).
  // Son destekçiyle öneri tartışmaya geçerse bu panel hiç kalmaz; o durumda odak sayfa başlığına gider.
  const supportedRef = useRef<HTMLParagraphElement>(null);
  const focusAfterSupport = useRef(false);
  useEffect(() => {
    if (!focusAfterSupport.current || !sponsored) return;
    focusAfterSupport.current = false;
    supportedRef.current?.focus();
  }, [sponsored]);
  useEffect(
    () => () => {
      if (focusAfterSupport.current) focusPageHeading();
    },
    [],
  );
  const sponsor = useAction(() => sponsorProposal(p.id), {
    success: "Desteğiniz kaydedildi ve deftere imza olarak yazıldı.",
    onSuccess: (d) => {
      focusAfterSupport.current = true;
      onUpdated(d);
    },
  });
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
            <div className="row">
              <Button variant="primary" icon="proposals" loading={submit.loading} onClick={() => void submit.run()}>
                Destekçi toplamaya gönder
              </Button>
              <Button onClick={() => setEditing(true)}>Metni düzenle</Button>
              <WithdrawButton proposal={p} onUpdated={onUpdated} />
            </div>
            <p className="small">
              Gönderdiğinizde öneri destekçi toplamaya başlar ({p.sponsorsRequired} destekçi gerekir). Destekçiler belirli bir metni imzaladığı için destek toplanırken metin
              değiştirilemez.
            </p>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card title="Destekçi toplama" actions={<Countdown to={p.phaseEndsAt} prefix="Kalan" />} className="sponsor-panel">
      <div className="stack">
        <ProgressBar
          label="Destekçi"
          value={p.sponsorCount}
          max={Math.max(1, p.sponsorsRequired)}
          valueText={`${p.sponsorCount}/${p.sponsorsRequired}`}
          tone={p.sponsorCount >= p.sponsorsRequired ? "success" : "primary"}
        />
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
          <p ref={supportedRef} tabIndex={-1} className="small receipt-saved">
            ✔ Bu öneriyi desteklediniz.
          </p>
        ) : (
          <div>
            <Button variant="primary" icon="users" loading={sponsor.loading} onClick={() => void sponsor.run()}>
              Destekle
            </Button>
          </div>
        )}
        <p className="small muted">Destek oy değildir; lehte oy anlamına gelmez.</p>
        <Details summary="Kaç destekçi gerekir?" className="panel-details">
          <div className="stack-sm">
            <p className="small">
              Destek, önerinin oylanmaya değer olduğunu onaylar. Yeterli destekçi gelince ontoloji (yönetmelik) denetimi yapılır ve tartışma başlar.
            </p>
            <p className="small">Gerekli destekçi sayısı K_s = max(2, min(5, ⌈√üye/2⌉)); silme taleplerinde 1.</p>
          </div>
        </Details>
      </div>
    </Card>
  );
}
