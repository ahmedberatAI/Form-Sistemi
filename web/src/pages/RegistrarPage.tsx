// Kayıt memuru: doğrulama bekleyen üyeler, amaç belirtilerek kişisel veri görüntüleme (erişim kaydı), onay/red,
// kimlik verisi düzeltme talepleri (amaçlı inceleme + karar), "Üyeyi sisteme gir" (yüz yüze kayıt → doğrudan doğrulanmış).
// Denetçi yalnızca okuyabilir.
// Kişisel veri YALNIZCA bu sayfada, amaç belirtilerek ve geçici olarak gösterilir.
import { useState, type FormEvent, type ReactNode } from "react";
import type {
  AddressInput,
  CorrectableField,
  CorrectionRequestView,
  CorrectionReview,
  CorrectionStatus,
  IdentityCorrectionValues,
  PendingUser,
  PiiRecord,
} from "@forum/shared";
import { decideCorrection, getPendingUsers, getUserPii, listCorrections, registrarCreateUser, reviewCorrection, verifyUser } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { RegistrationForm } from "../components/RegistrationForm";
import { UserLink } from "../components/UserLink";
import "../components/system/system.css";
import { formatIsoDate } from "../lib/format";
import { useQueryState } from "../lib/hooks";
import { useAsync } from "../lib/useAsync";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorView,
  Input,
  KeyValue,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Table,
  Tabs,
  Time,
  useConfirm,
  useToast,
} from "../ui";

const PURPOSE_PRESETS = ["Kimlik doğrulaması: yüz yüze belge kontrolü", "Mükerrer üyelik şüphesinin incelenmesi", "Üyenin bilgi düzeltme talebi"];

export default function RegistrarPage() {
  const auth = useAuth();
  const canWrite = auth.can("R");
  const [tabRaw, setTab] = useQueryState("sekme", "bekleyenler");
  const tab = canWrite && tabRaw === "yeni" ? "yeni" : tabRaw === "duzeltmeler" ? "duzeltmeler" : "bekleyenler";
  const pending = useAsync(() => getPendingUsers(), []);
  const corrections = useAsync(() => listCorrections("pending"), []);

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
        tabs={[
          { id: "bekleyenler", label: "Bekleyenler", count: pending.data?.length },
          { id: "duzeltmeler", label: "Düzeltme talepleri", count: corrections.data?.length },
          ...(canWrite ? [{ id: "yeni", label: "Üyeyi sisteme gir" }] : []),
        ]}
      >
        {tab === "duzeltmeler" ? (
          <CorrectionsTab canWrite={canWrite} onPendingChange={corrections.reload} />
        ) : tab === "bekleyenler" ? (
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
          <Input
            label="Karar notu (isteğe bağlı)"
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            hint="En çok 1000 karakter. Not başvurana bildirim olarak gider; denetim günlüğüne yalnızca not olup olmadığı yazılır. Kişisel veri yazmayın."
          />
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

// ───────────── Kimlik verisi düzeltme talepleri (KVKK md. 11/1-d) ─────────────

const FIELD_LABELS: Record<CorrectableField, string> = {
  firstName: "Ad",
  lastName: "Soyad",
  tckn: "T.C. kimlik no (maskeli)",
  birthDate: "Doğum tarihi",
  email: "E-posta",
  phone: "Telefon",
  address: "Adres",
};

const STATUS_LABELS: Record<CorrectionStatus, { label: string; tone: "warning" | "success" | "danger" | "neutral" }> = {
  pending: { label: "Bekliyor", tone: "warning" },
  approved: { label: "Onaylandı", tone: "success" },
  rejected: { label: "Reddedildi", tone: "danger" },
  withdrawn: { label: "Geri çekildi", tone: "neutral" },
};

function formatAddress(a: AddressInput): string {
  return `${[a.mahalle, a.acikAdres].filter(Boolean).join(", ")}\n${[a.postaKodu, a.ilce, a.il].filter(Boolean).join(" ")}`;
}

function fieldValue(field: CorrectableField, v: IdentityCorrectionValues): ReactNode {
  const x = v[field];
  if (x === undefined) return <span className="muted">—</span>;
  if (field === "address") return <span className="sy-pre-wrap">{formatAddress(x as AddressInput)}</span>;
  if (field === "birthDate") return formatIsoDate(String(x));
  if (field === "tckn") return <span className="mono">{String(x)}</span>;
  return String(x);
}

function CorrectionsTab({ canWrite, onPendingChange }: { canWrite: boolean; onPendingChange: () => void }) {
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const list = useAsync(() => listCorrections(filter), [filter]);
  const [open, setOpen] = useState<CorrectionRequestView | null>(null);

  return (
    <div className="stack">
      <Alert tone="info">
        Üyeler kimlik bilgilerindeki yanlışlıkların düzeltilmesini gerekçesiyle talep eder (KVKK m. 11/1-d). Talep listesinde değer yoktur; önerilen ve
        mevcut değerleri görmek için amaç belirterek incelemeniz gerekir (erişim kaydı tutulur). Karar vermeden önce kişinin belgesini görün.
      </Alert>
      <div className="row">
        <Select
          label="Gösterilecek talepler"
          value={filter}
          onChange={(e) => setFilter(e.target.value === "all" ? "all" : "pending")}
          options={[
            { value: "pending", label: "Bekleyenler" },
            { value: "all", label: "Tümü (son 500)" },
          ]}
        />
      </div>
      {list.loading && !list.data ? (
        <Spinner block label="Düzeltme talepleri yükleniyor…" />
      ) : list.error ? (
        <ErrorView error={list.error} onRetry={list.reload} />
      ) : !list.data?.length ? (
        <EmptyState title={filter === "pending" ? "Bekleyen düzeltme talebi yok" : "Düzeltme talebi yok"} icon="check" />
      ) : (
        <ul className="list" aria-label="Düzeltme talepleri">
          {list.data.map((c) => (
            <li key={c.id} className="list-item stack-sm">
              <div className="row-between">
                <UserLink id={c.userId} nickname={c.nickname} />
                <Badge tone={STATUS_LABELS[c.status].tone}>{STATUS_LABELS[c.status].label}</Badge>
              </div>
              <div className="small">
                Düzeltilecek: <strong>{c.fields.map((f) => FIELD_LABELS[f].replace(" (maskeli)", "")).join(", ")}</strong>
              </div>
              <div className="small muted">
                Talep: <Time at={c.createdAt} mode="both" />
                {c.reviewedAt ? (
                  <>
                    {" "}
                    · son inceleme: <Time at={c.reviewedAt} />
                  </>
                ) : null}
                {c.decidedAt ? (
                  <>
                    {" "}
                    · karar: <Time at={c.decidedAt} />
                  </>
                ) : null}
              </div>
              {c.decisionNote ? <div className="small">Karar notu: {c.decisionNote}</div> : null}
              <div>
                <Button size="sm" icon="user" onClick={() => setOpen(c)}>
                  Talebi incele…
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <CorrectionModal
          c={open}
          canWrite={canWrite}
          onClose={() => setOpen(null)}
          onDecided={(updated) => {
            list.setData((xs) => (filter === "pending" ? xs?.filter((x) => x.id !== updated.id) : xs?.map((x) => (x.id === updated.id ? updated : x))));
            onPendingChange();
            setOpen(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** Amaç zorunlu; değerler yalnızca pencere açıkken bellekte tutulur. Karar yalnız inceledikten sonra verilebilir. */
function CorrectionModal({
  c,
  canWrite,
  onClose,
  onDecided,
}: {
  c: CorrectionRequestView;
  canWrite: boolean;
  onClose: () => void;
  onDecided: (c: CorrectionRequestView) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [purpose, setPurpose] = useState("Üyenin bilgi düzeltme talebi");
  const [purposeError, setPurposeError] = useState<string | null>(null);
  const [review, setReview] = useState<CorrectionReview | null>(null);
  const [requestError, setRequestError] = useState<unknown>(null);
  const [busy, setBusy] = useState<"review" | "approve" | "reject" | null>(null);
  const [note, setNote] = useState("");

  const doReview = async (e?: FormEvent) => {
    e?.preventDefault();
    if (purpose.trim().length < 5) {
      setPurposeError("Erişim amacını yazın (en az 5 karakter).");
      return;
    }
    setPurposeError(null);
    setRequestError(null);
    setBusy("review");
    try {
      setReview(await reviewCorrection(c.id, purpose.trim()));
    } catch (err) {
      setRequestError(err);
    } finally {
      setBusy(null);
    }
  };

  const decide = async (decision: "approve" | "reject") => {
    const ok = await confirm({
      title: decision === "approve" ? `@${c.nickname} için düzeltme onaylansın mı?` : `@${c.nickname} için düzeltme reddedilsin mi?`,
      message:
        decision === "approve"
          ? "Kimlik kasasındaki ilgili alanlar yeni değerlerle yeniden şifrelenir; önerinin kendisi imha edilir. Kişinin belgesini gördüğünüzden emin olun."
          : "Kayıtlı bilgiler değişmez; öneri imha edilir ve üyeye bildirim gider. Gerekçeyi not alanına yazmanız önerilir (kişisel veri yazmayın).",
      confirmLabel: decision === "approve" ? "Onayla" : "Reddet",
      tone: decision === "approve" ? undefined : "danger",
    });
    if (!ok) return;
    setBusy(decision);
    try {
      const updated = await decideCorrection(c.id, { decision, note: note.trim() || undefined });
      toast.success(decision === "approve" ? `@${c.nickname} bilgileri düzeltildi.` : "Düzeltme talebi reddedildi.");
      onDecided(updated);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const pending = (review?.request.status ?? c.status) === "pending";
  const close = () => {
    setReview(null);
    onClose();
  };

  return (
    <Modal
      open
      onClose={close}
      title={`Düzeltme talebi: @${c.nickname}`}
      dismissible={!busy}
      footer={
        review ? (
          canWrite && pending ? (
            <>
              <Button variant="ghost" onClick={close} disabled={!!busy}>
                Kapat ve gizle
              </Button>
              <Button variant="danger" loading={busy === "reject"} disabled={!!busy} onClick={() => void decide("reject")}>
                Reddet
              </Button>
              <Button variant="primary" loading={busy === "approve"} disabled={!!busy} onClick={() => void decide("approve")}>
                Onayla
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={close}>
              Kapat ve gizle
            </Button>
          )
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={!!busy}>
              Vazgeç
            </Button>
            <Button variant="primary" loading={busy === "review"} onClick={() => void doReview()}>
              Amacı kaydet ve incele
            </Button>
          </>
        )
      }
    >
      {review ? (
        <div className="stack">
          <Alert tone="warning">Bu erişim amacıyla birlikte kayıt altına alındı. Bilgileri kopyalamayın; yalnızca bu talebi sonuçlandırmak için kullanın.</Alert>
          <KeyValue items={[{ label: "Üyenin gerekçesi", value: <span className="sy-pre-wrap">{review.reason || "—"}</span> }]} />
          <Table
            caption="Mevcut ve önerilen değerler"
            rows={review.request.fields}
            rowKey={(f) => f}
            columns={[
              { key: "f", header: "Alan", render: (f) => FIELD_LABELS[f] },
              { key: "cur", header: "Kayıtlı", render: (f) => fieldValue(f, review.current) },
              { key: "new", header: "Önerilen", render: (f) => (pending ? <strong>{fieldValue(f, review.proposed)}</strong> : <span className="muted">imha edildi</span>) },
            ]}
          />
          {canWrite && pending ? (
            <Input label="Karar notu (isteğe bağlı)" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} hint="Not üyeye bildirilir; kişisel veri yazmayın." />
          ) : !pending ? (
            <p className="small muted mt-0">Bu talep sonuçlanmış: {STATUS_LABELS[review.request.status].label.toLocaleLowerCase("tr-TR")}.</p>
          ) : (
            <p className="small muted mt-0">Denetçi olarak yalnızca inceleyebilirsiniz; kararı kayıt memuru verir.</p>
          )}
        </div>
      ) : (
        <form className="stack" onSubmit={doReview} noValidate>
          <Alert tone="warning" title="Erişiminiz kayıt altına alınır">
            Düzeltme talebindeki önerilen ve mevcut kimlik bilgileri kişisel veridir. Kim, ne zaman, hangi amaçla eriştiği denetim kaydına yazılır.
          </Alert>
          <p className="mt-0 small">
            Düzeltilecek alanlar: <strong>{c.fields.map((f) => FIELD_LABELS[f].replace(" (maskeli)", "")).join(", ")}</strong>
          </p>
          <Input label="Erişim amacı" required value={purpose} maxLength={500} error={purposeError ?? undefined} onChange={(e) => setPurpose(e.target.value)} />
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
