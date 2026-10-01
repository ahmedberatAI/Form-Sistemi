// Bilirkişi yönetimi (yalnız yönetici): başvurulara onay/ret, yaptırımlar (uyar / askıya al / listeden çıkar / yeniden etkinleştir).
import { useState } from "react";
import type { ExpertInfo, ExpertSanctionRequest, ExpertStatus } from "@forum/shared";
import { decideExpert, listExperts, sanctionExpert } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { useAsync } from "../../lib/useAsync";
import { Alert, Badge, Button, Card, EmptyState, ErrorView, ExpertStatusBadge, Input, Modal, RadioGroup, Spinner, Textarea, useToast } from "../../ui";
import { UserLink } from "../UserLink";
import { DomainChips as Domains } from "./DomainChips";
import { ReputationBar } from "./ReputationBar";
import "./community.css";

type SanctionAction = ExpertSanctionRequest["action"];

const SANCTIONS: Record<SanctionAction, { label: string; hint: string; allowed: ExpertStatus[] }> = {
  warn: { label: "Uyar", hint: "Kayda geçen uyarı; durum değişmez.", allowed: ["active", "suspended"] },
  suspend: { label: "Askıya al", hint: "Yeni panellere seçilmez; açık görevleri başkasına devredilir.", allowed: ["active"] },
  remove: { label: "Listeden çıkar", hint: "Bilirkişi listesinden çıkarılır.", allowed: ["active", "suspended"] },
  reinstate: { label: "Yeniden etkinleştir", hint: "Askıdaki ya da çıkarılmış bilirkişiyi listeye geri alır.", allowed: ["suspended", "removed"] },
};

function ApplicationItem({ e, onDone }: { e: ExpertInfo; onDone: (x: ExpertInfo) => void }) {
  const toast = useToast();
  const auth = useAuth();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const self = auth.user?.id === e.userId;
  const decide = async (decision: "approve" | "reject") => {
    setBusy(decision);
    try {
      const r = await decideExpert(e.userId, { decision, note: note.trim() || undefined });
      toast.success(decision === "approve" ? `@${e.nickname} bilirkişi listesine alındı.` : `@${e.nickname} başvurusu reddedildi.`);
      onDone(r);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  return (
    <li className="list-item stack-sm">
      <div className="cm-expert-head">
        <UserLink id={e.userId} nickname={e.nickname} />
        <ExpertStatusBadge status={e.status} />
      </div>
      <Domains domains={e.domains} />
      <div>
        <span className="small muted">Yeterlilik beyanı</span>
        <p className="cm-prewrap">{e.credentials || "—"}</p>
      </div>
      <Input label="Karar notu (isteğe bağlı)" value={note} maxLength={2000} onChange={(x) => setNote(x.target.value)} />
      {self ? <p className="small muted">Kendi başvurunuz hakkında karar veremezsiniz.</p> : null}
      <div className="row">
        <Button variant="primary" size="sm" loading={busy === "approve"} disabled={!!busy || self} onClick={() => void decide("approve")}>
          Onayla
        </Button>
        <Button variant="danger" size="sm" loading={busy === "reject"} disabled={!!busy || self} onClick={() => void decide("reject")}>
          Reddet
        </Button>
      </div>
    </li>
  );
}

function SanctionModal({ expert, onClose, onDone }: { expert: ExpertInfo; onClose: () => void; onDone: (x: ExpertInfo) => void }) {
  const toast = useToast();
  const available = (Object.keys(SANCTIONS) as SanctionAction[]).filter((a) => SANCTIONS[a].allowed.includes(expert.status));
  const [action, setAction] = useState<SanctionAction | null>(available[0] ?? null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!action) return;
    if (!note.trim()) {
      setError("Yaptırım için gerekçe notu zorunludur.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await sanctionExpert(expert.userId, { action, note: note.trim() });
      toast.success(`@${expert.nickname}: ${SANCTIONS[action].label} işlemi uygulandı.`);
      onDone(r);
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      title={`Yaptırım: @${expert.nickname}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant={action === "reinstate" || action === "warn" ? "primary" : "danger"} loading={busy} disabled={!action || !note.trim()} onClick={() => void submit()}>
            Uygula
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="mt-0">
          Mevcut durum: <ExpertStatusBadge status={expert.status} />
        </p>
        {available.length ? (
          <RadioGroup<SanctionAction>
            label="İşlem"
            value={action}
            onChange={setAction}
            options={available.map((a) => ({ value: a, label: SANCTIONS[a].label, hint: SANCTIONS[a].hint }))}
          />
        ) : (
          <Alert tone="info">Bu durumdaki bilirkişiye uygulanabilecek yaptırım yok.</Alert>
        )}
        <Textarea
          label="Gerekçe notu"
          required
          rows={3}
          maxLength={2000}
          value={note}
          error={error ?? undefined}
          hint="Not zorunludur ve denetim günlüğüne yazılır. Kişisel veri yazmayın."
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}

export function ExpertAdminPanel() {
  const { data, error, loading, reload, setData } = useAsync(() => listExperts(), []);
  const [sanctioning, setSanctioning] = useState<ExpertInfo | null>(null);

  const replace = (x: ExpertInfo) => setData((prev) => prev?.map((e) => (e.userId === x.userId ? x : e)));

  if (loading && !data) return <Spinner block label="Bilirkişiler yükleniyor…" />;
  if (error) return <ErrorView error={error} onRetry={reload} />;
  const all = data ?? [];
  const applications = all.filter((e) => e.status === "applied");
  const listed = all.filter((e) => e.status === "active" || e.status === "suspended" || e.status === "removed");

  return (
    <div className="stack-lg">
      <Card title="Bekleyen başvurular" actions={<Badge tone={applications.length ? "info" : "neutral"}>{applications.length}</Badge>}>
        {applications.length ? (
          <ul className="list">
            {applications.map((e) => (
              <ApplicationItem key={e.userId} e={e} onDone={replace} />
            ))}
          </ul>
        ) : (
          <EmptyState title="Bekleyen başvuru yok" icon="check" />
        )}
      </Card>

      <Card title="Yaptırımlar" subtitle="Uyarı, askıya alma, listeden çıkarma ve yeniden etkinleştirme. Her işlem gerekçeli olmalıdır ve denetim günlüğüne yazılır.">
        {listed.length ? (
          <ul className="list">
            {listed.map((e) => (
              <li className="list-item stack-sm" key={e.userId}>
                <div className="cm-expert-head">
                  <UserLink id={e.userId} nickname={e.nickname} />
                  <ExpertStatusBadge status={e.status} />
                </div>
                <Domains domains={e.domains} />
                <ReputationBar value={e.reputation} />
                <div className="cm-expert-meta">
                  <span>Aktif görev: {e.activeAssignments}</span>
                  <span>Tamamlanan rapor: {e.completedReports}</span>
                </div>
                <div>
                  <Button size="sm" onClick={() => setSanctioning(e)}>
                    Yaptırım uygula…
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Listede bilirkişi yok" />
        )}
      </Card>
      {sanctioning ? <SanctionModal expert={sanctioning} onClose={() => setSanctioning(null)} onDone={replace} /> : null}
    </div>
  );
}

export default ExpertAdminPanel;
