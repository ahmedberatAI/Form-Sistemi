// Kayıt memuru: doğrulama bekleyen üyeler, amaç belirtilerek kişisel veri görüntüleme (erişim kaydı), onay/red,
// "Üyeyi sisteme gir" (yüz yüze kayıt → doğrudan doğrulanmış). Denetçi yalnızca okuyabilir.
// Kişisel veri YALNIZCA bu sayfada, amaç belirtilerek ve geçici olarak gösterilir.
import { useState, type FormEvent } from "react";
import type { PendingUser, PiiRecord } from "@forum/shared";
import { getPendingUsers, getUserPii, registrarCreateUser, verifyUser } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { RegistrationForm } from "../components/RegistrationForm";
import { UserLink } from "../components/UserLink";
import "../components/system/system.css";
import { formatIsoDate } from "../lib/format";
import { useQueryState } from "../lib/hooks";
import { useAsync } from "../lib/useAsync";
import { Alert, Badge, Button, Card, EmptyState, ErrorView, Input, KeyValue, Modal, PageHeader, Spinner, Tabs, Time, useConfirm, useToast } from "../ui";

const PURPOSE_PRESETS = ["Kimlik doğrulaması: yüz yüze belge kontrolü", "Mükerrer üyelik şüphesinin incelenmesi", "Üyenin bilgi düzeltme talebi"];

export default function RegistrarPage() {
  const auth = useAuth();
  const canWrite = auth.can("R");
  const [tabRaw, setTab] = useQueryState("sekme", "bekleyenler");
  const tab = canWrite && tabRaw === "yeni" ? "yeni" : "bekleyenler";
  const pending = useAsync(() => getPendingUsers(), []);

  return (
    <div className="page">
      <PageHeader
        title="Kayıt memuru"
        subtitle="Her kişinin tek hesapla katılması için kimlik doğrulaması. Kişisel verilere yalnızca amaç belirtilerek erişilir; her erişim kayıt altına alınır."
        meta={!canWrite ? <Badge tone="accent">Denetçi — yalnızca okuma</Badge> : undefined}
      />
      <Tabs
        label="Kayıt memuru bölümleri"
        value={tab}
        onChange={setTab}
        tabs={[{ id: "bekleyenler", label: "Bekleyenler", count: pending.data?.length }, ...(canWrite ? [{ id: "yeni", label: "Üyeyi sisteme gir" }] : [])]}
      >
        {tab === "bekleyenler" ? (
          pending.loading && !pending.data ? (
            <Spinner block label="Bekleyen başvurular yükleniyor…" />
          ) : pending.error ? (
            <ErrorView error={pending.error} onRetry={pending.reload} />
          ) : !pending.data?.length ? (
            <EmptyState title="Doğrulama bekleyen başvuru yok" icon="check" />
          ) : (
            <ul className="list" aria-label="Doğrulama bekleyen üyeler">
              {pending.data.map((u) => (
                <PendingItem key={u.id} u={u} canWrite={canWrite} onDone={(id) => pending.setData((xs) => xs?.filter((x) => x.id !== id))} />
              ))}
            </ul>
          )
        ) : (
          <NewMemberTab />
        )}
      </Tabs>
    </div>
  );
}

function PendingItem({ u, canWrite, onDone }: { u: PendingUser; canWrite: boolean; onDone: (id: string) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [piiOpen, setPiiOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  const decide = async (decision: "approve" | "reject") => {
    if (decision === "reject") {
      const ok = await confirm({
        title: `@${u.nickname} başvurusu reddedilsin mi?`,
        message: "Reddedilen hesap kullanılamaz. Gerekçeyi not alanına yazmanız önerilir (kişisel veri yazmayın).",
        confirmLabel: "Reddet",
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusy(decision);
    try {
      await verifyUser(u.id, { decision, note: note.trim() || undefined });
      toast.success(decision === "approve" ? `@${u.nickname} doğrulandı.` : `@${u.nickname} başvurusu reddedildi.`);
      onDone(u.id);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="list-item stack-sm">
      <div className="row-between">
        <UserLink id={u.id} nickname={u.nickname} />
        <span className="small muted">
          Başvuru: <Time at={u.createdAt} mode="both" />
        </span>
      </div>
      <div className="row">
        <Button size="sm" icon="user" onClick={() => setPiiOpen(true)}>
          Kişisel veriyi görüntüle…
        </Button>
      </div>
      {canWrite ? (
        <div className="stack-sm">
          <Input label="Karar notu (isteğe bağlı)" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} hint="Not denetim günlüğüne yazılır; kişisel veri yazmayın." />
          <div className="row">
            <Button size="sm" variant="primary" loading={busy === "approve"} disabled={!!busy} onClick={() => void decide("approve")}>
              Onayla
            </Button>
            <Button size="sm" variant="danger" loading={busy === "reject"} disabled={!!busy} onClick={() => void decide("reject")}>
              Reddet
            </Button>
          </div>
        </div>
      ) : null}
      {piiOpen ? <PiiModal u={u} onClose={() => setPiiOpen(false)} /> : null}
    </li>
  );
}

/** Amaç zorunlu; kayıt yalnızca pencere açıkken bellekte tutulur. */
function PiiModal({ u, onClose }: { u: PendingUser; onClose: () => void }) {
  const [purpose, setPurpose] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<PiiRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState<unknown>(null);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (purpose.trim().length < 5) {
      setError("Erişim amacını yazın (en az 5 karakter).");
      return;
    }
    setError(null);
    setBusy(true);
    setRequestError(null);
    try {
      setRecord(await getUserPii(u.id, purpose.trim()));
    } catch (err) {
      setRequestError(err);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setRecord(null);
    onClose();
  };

  return (
    <Modal
      open
      onClose={close}
      title={`Kişisel veri: @${u.nickname}`}
      dismissible={!busy}
      footer={
        record ? (
          <Button variant="primary" onClick={close}>
            Kapat ve gizle
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Vazgeç
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void submit()}>
              Amacı kaydet ve görüntüle
            </Button>
          </>
        )
      }
    >
      {record ? (
        <div className="stack">
          <Alert tone="warning">Bu erişim amacıyla birlikte kayıt altına alındı. Bilgileri kopyalamayın ve yalnızca belirttiğiniz amaçla kullanın.</Alert>
          <KeyValue
            items={[
              { label: "Ad", value: record.firstName },
              { label: "Soyad", value: record.lastName },
              { label: "T.C. kimlik no (maskeli)", value: <span className="mono">{record.tcknMasked}</span> },
              { label: "Doğum tarihi", value: formatIsoDate(record.birthDate) },
              { label: "E-posta", value: record.email },
              { label: "Telefon", value: record.phone },
              {
                label: "Adres",
                value: (
                  <span className="sy-pre-wrap">
                    {[record.address.mahalle, record.address.acikAdres].filter(Boolean).join(", ")}
                    {"\n"}
                    {[record.address.postaKodu, record.address.ilce, record.address.il].filter(Boolean).join(" ")}
                  </span>
                ),
              },
            ]}
          />
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <Alert tone="warning" title="Erişiminiz kayıt altına alınır">
            Kim, ne zaman, hangi amaçla eriştiği denetim kaydına yazılır ve denetçi tarafından incelenebilir (KVKK m. 12). Yalnızca doğrulama için gerekli
            olduğunda görüntüleyin.
          </Alert>
          <Input
            label="Erişim amacı"
            required
            value={purpose}
            maxLength={500}
            error={error ?? undefined}
            onChange={(e) => setPurpose(e.target.value)}
            hint="ör. “Kimlik doğrulaması: yüz yüze belge kontrolü”"
          />
          <div className="row" aria-label="Hazır amaçlar">
            {PURPOSE_PRESETS.map((p) => (
              <Button key={p} size="sm" variant="ghost" onClick={() => setPurpose(p)}>
                {p}
              </Button>
            ))}
          </div>
          {requestError ? <ErrorView error={requestError} compact /> : null}
        </form>
      )}
    </Modal>
  );
}

function NewMemberTab() {
  const toast = useToast();
  const [last, setLast] = useState<string | null>(null);
  return (
    <Card title="Üyeyi sisteme gir" subtitle="Yüz yüze kimlik kontrolü yaptığınız kişiyi kaydedin; hesap doğrudan doğrulanmış olarak açılır.">
      <div className="stack">
        <Alert tone="info">
          Kişiden kimlik belgesini görün ve bilgileri belgeden girin. Aydınlatma metnini kişiye okutun; açık rızaları (siyasi görüş, yapay zekâ) kişinin
          kendi tercihine göre işaretleyin.
        </Alert>
        {last ? (
          <Alert tone="success" onClose={() => setLast(null)}>
            @{last} doğrulanmış üye olarak eklendi.
          </Alert>
        ) : null}
        <RegistrationForm
          mode="registrar"
          resetOnSuccess
          submitLabel="Üyeyi kaydet"
          onSubmit={async (input) => {
            const r = await registrarCreateUser(input);
            setLast(r.user.nickname);
            toast.success(`@${r.user.nickname} doğrulanmış üye olarak eklendi.`);
          }}
        />
      </div>
    </Card>
  );
}
