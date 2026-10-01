// Bilirkişiler: liste, başvuru, görevlerim (rapor formu) ve yönetim (yalnız yönetici).
// Bilirkişi görüşü danışma niteliğindedir; oyu 1'dir. Seçim tohumlu kurayla yapılır (ALGORITMA §8).
import { useState, type FormEvent } from "react";
import { ASSIGNMENT_STATUS_LABELS, EXPERT_STATUS_LABELS, type AssignmentStatus, type ExpertStatus, type MyAssignment } from "@forum/shared";
import { applyExpert, getMyAssignments, listExperts, respondAssignment } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { CategoryPicker } from "../components/CategoryPicker";
import { UserLink } from "../components/UserLink";
import { DomainChips } from "../components/community/DomainChips";
import { ExpertAdminPanel } from "../components/community/ExpertAdminPanel";
import { ExpertReportForm, LegalQualificationNotice } from "../components/community/ExpertReportForm";
import { ReputationBar } from "../components/community/ReputationBar";
import "../components/community/community.css";
import { useOntology } from "../lib/categories";
import { proposalRef } from "../lib/format";
import { useQueryState } from "../lib/hooks";
import { routes } from "../lib/routes";
import { useAsync } from "../lib/useAsync";
import {
  Alert,
  Badge,
  Button,
  Card,
  Countdown,
  Details,
  EmptyState,
  ErrorView,
  ExpertStatusBadge,
  LinkButton,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Tabs,
  Textarea,
  useToast,
  type Tone,
} from "../ui";
import { Link } from "react-router-dom";

type TabId = "liste" | "basvur" | "gorevlerim" | "yonetim";

export default function ExpertsPage() {
  const auth = useAuth();
  const [tabRaw, setTab] = useQueryState("sekme", "liste");
  const tabs = [
    { id: "liste" as TabId, label: "Liste" },
    { id: "basvur" as TabId, label: "Başvur" },
    ...(auth.isExpert ? [{ id: "gorevlerim" as TabId, label: "Görevlerim" }] : []),
    ...(auth.isAdmin ? [{ id: "yonetim" as TabId, label: "Yönetim" }] : []),
  ];
  const tab = (tabs.some((t) => t.id === tabRaw) ? tabRaw : "liste") as TabId;

  return (
    <div className="page">
      <PageHeader
        title="Bilirkişiler"
        subtitle="Bilirkişiler önerilerin teknik uygulanabilirliği hakkında danışma görüşü verir. Görüşleri bağlayıcı değildir; oyları her üye gibi 1 sayılır."
      />
      <Tabs tabs={tabs} value={tab} onChange={(v) => setTab(v)} label="Bilirkişi bölümleri">
        {tab === "liste" ? <ExpertList /> : tab === "basvur" ? <ApplyTab /> : tab === "gorevlerim" ? <AssignmentsTab /> : <ExpertAdminPanel />}
      </Tabs>
      <ReputationInfo />
    </div>
  );
}

function ReputationInfo() {
  return (
    <Card title="İtibar nasıl hesaplanır?" tone="muted" headingLevel={2}>
      <div className="stack-sm">
        <p className="mt-0">
          Her rapordan sonra itibar güncellenir: <span className="cm-formula">R′ = 0,8·R + 0,2·S</span> (başlangıç R₀ = 0,75).
        </p>
        <p className="mt-0">S ∈ [0, 1] şu kontrol listesiyle hesaplanır:</p>
        <ul className="steps">
          <li>rapor zamanında teslim edildi mi,</li>
          <li>üyelerin tüm sorularına yanıt verildi mi,</li>
          <li>uzmanlık alanı içinde kalındı mı,</li>
          <li>hukuki nitelendirme yapılmadı mı (6754 s. Kanun md. 3/2).</li>
        </ul>
        <Alert tone="info" title="Çoğunlukla aynı fikirde olmak ödüllendirilmez">
          İtibar, raporun özenine bakar; sonucun oylamayla ya da diğer bilirkişilerle örtüşmesine bakmaz. Kura ağırlığı itibarla orantılıdır
          (0,5–1,5 arasında sınırlanır), aktif görev sayısı arttıkça azalır.
        </Alert>
      </div>
    </Card>
  );
}

// ───────────── Liste ─────────────

function ExpertList() {
  const { flat } = useOntology();
  const [status, setStatus] = useQueryState("durum", "active");
  const [domain, setDomain] = useQueryState("alan", "");
  const { data, error, loading, reload } = useAsync(
    () => listExperts({ status: status === "all" ? undefined : (status as ExpertStatus), domain: domain || undefined }),
    [status, domain],
  );

  return (
    <div className="stack">
      <div className="cm-filters">
        <Select
          label="Durum"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[{ value: "all", label: "Tümü" }, ...(Object.keys(EXPERT_STATUS_LABELS) as ExpertStatus[]).map((s) => ({ value: s, label: EXPERT_STATUS_LABELS[s] }))]}
        />
        <Select
          label="Uzmanlık alanı"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          options={[
            { value: "", label: "Tüm alanlar" },
            ...flat.map((c) => ({ value: c.iri, label: `${"  ".repeat(c.depth)}${c.depth ? "› " : ""}${c.label}` })),
          ]}
          hint="Alt ve üst kategorilerdeki bilirkişiler de eşleşir."
        />
      </div>
      {loading && !data ? (
        <Spinner block label="Bilirkişiler yükleniyor…" />
      ) : error ? (
        <ErrorView error={error} onRetry={reload} />
      ) : !data?.length ? (
        <EmptyState title="Bu süzgeçle eşleşen bilirkişi yok" icon="experts" />
      ) : (
        <ul className="list" aria-label="Bilirkişi listesi">
          {data.map((e) => (
            <li className="list-item stack-sm" key={e.userId}>
              <div className="cm-expert-head">
                <UserLink id={e.userId} nickname={e.nickname} showExpert={false} />
                <ExpertStatusBadge status={e.status} />
              </div>
              <DomainChips domains={e.domains} />
              <ReputationBar value={e.reputation} />
              <div className="cm-expert-meta">
                <span>Aktif görev: {e.activeAssignments}</span>
                <span>Tamamlanan rapor: {e.completedReports}</span>
              </div>
              {e.credentials ? (
                <Details summary="Yeterlilik beyanı">
                  <p className="cm-prewrap">{e.credentials}</p>
                </Details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────── Başvuru ─────────────

function ApplyTab() {
  const auth = useAuth();
  const toast = useToast();
  const [domains, setDomains] = useState<string[]>([]);
  const [credentials, setCredentials] = useState("");
  const [errors, setErrors] = useState<{ domains?: string; credentials?: string }>({});
  const [busy, setBusy] = useState(false);
  const mine = useAsync(() => listExperts(), [auth.user?.id], { enabled: !!auth.user });
  const own = mine.data?.find((e) => e.userId === auth.user?.id) ?? null;

  if (!auth.user) {
    return (
      <EmptyState title="Başvurmak için giriş yapın" icon="login" action={<LinkButton to={routes.login()} state={{ from: "/bilirkisiler?sekme=basvur" }} variant="primary">Giriş yap</LinkButton>}>
        <p>Bilirkişi başvurusu yalnızca kimliği doğrulanmış üyelere açıktır.</p>
      </EmptyState>
    );
  }
  if (!auth.can("V")) {
    return (
      <Alert tone="warning" title="Doğrulanmış üyelik gerekiyor">
        Bilirkişi başvurusu için kimliğinizin kayıt memurunca doğrulanmış olması gerekir.
      </Alert>
    );
  }
  if (mine.loading && !mine.data) return <Spinner block />;
  if (own && (own.status === "active" || own.status === "applied" || own.status === "suspended")) {
    return (
      <Card title="Bilirkişi durumunuz">
        <div className="stack-sm">
          <div className="row">
            <ExpertStatusBadge status={own.status} />
          </div>
          <DomainChips domains={own.domains} />
          {own.status === "applied" ? <p className="mt-0">Başvurunuz yönetici kararını bekliyor.</p> : null}
          {own.status === "active" ? <p className="mt-0">Listede etkin bilirkişisiniz. Görevlerinizi “Görevlerim” sekmesinde görebilirsiniz.</p> : null}
          {own.status === "suspended" ? <p className="mt-0">Bilirkişiliğiniz askıda; yeni başvuru yapılamaz.</p> : null}
        </div>
      </Card>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!domains.length) errs.domains = "En az bir uzmanlık alanı seçin.";
    if (credentials.trim().length < 5) errs.credentials = "Yeterliliğinizi kısaca açıklayın (en az 5 karakter).";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const r = await applyExpert({ domains, credentials: credentials.trim() });
      toast.success("Başvurunuz alındı; yönetici kararını bekliyor.");
      mine.setData((prev) => [...(prev ?? []).filter((x) => x.userId !== r.userId), r]);
    } catch (err) {
      toast.error(err, "Başvuru gönderilemedi");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {own?.status === "rejected" || own?.status === "removed" ? (
        <Alert tone="info">Önceki başvurunuz sonuçlandı ({EXPERT_STATUS_LABELS[own.status]}). Yeniden başvurabilirsiniz.</Alert>
      ) : null}
      <CategoryPicker
        label="Uzmanlık alanlarınız"
        hint="En özel alanı seçmeniz yeterli; üst kategoriler otomatik kapsanır. En fazla 10 alan."
        value={domains}
        onChange={setDomains}
        max={10}
        required
        error={errors.domains}
      />
      <Alert tone="warning" title="Kişisel veri yazmayın">
        Yeterlilik beyanınız bilirkişi listesinde herkese açık gösterilir. Adınızı, T.C. kimlik numaranızı, adresinizi, telefonunuzu, çalıştığınız kurumun
        adını ya da sizi tanımlayabilecek ayrıntıları yazmayın. Yeterliliğinizi genel ifadelerle anlatın (ör. “inşaat mühendisi, 12 yıl saha deneyimi”).
      </Alert>
      <Textarea
        label="Yeterlilik / özgeçmiş özeti"
        required
        rows={6}
        maxLength={5000}
        showCount
        value={credentials}
        error={errors.credentials}
        onChange={(e) => setCredentials(e.target.value)}
      />
      <LegalQualificationNotice />
      <div className="form-actions">
        <Button type="submit" variant="primary" loading={busy}>
          Başvuruyu gönder
        </Button>
      </div>
    </form>
  );
}

// ───────────── Görevlerim ─────────────

const ASSIGNMENT_TONE: Record<AssignmentStatus, Tone> = {
  invited: "info",
  accepted: "accent",
  recused: "neutral",
  reported: "success",
  overdue: "danger",
  replaced: "neutral",
};

function AssignmentsTab() {
  const { data, error, loading, reload } = useAsync(() => getMyAssignments(), []);
  if (loading && !data) return <Spinner block label="Görevler yükleniyor…" />;
  if (error) return <ErrorView error={error} onRetry={reload} />;
  if (!data?.length) {
    return (
      <EmptyState title="Size atanmış görev yok" icon="experts">
        <p>Bir öneri için kurayla seçildiğinizde görev burada görünür ve bildirim alırsınız.</p>
      </EmptyState>
    );
  }
  const order = (s: string) => (s === "invited" ? 0 : s === "accepted" ? 1 : 2);
  const sorted = [...data].sort((a, b) => order(a.status) - order(b.status) || a.dueAt - b.dueAt);
  return (
    <div className="stack">
      {sorted.map((a) => (
        <AssignmentCard key={a.assignmentId} a={a} onChanged={reload} />
      ))}
    </div>
  );
}

function AssignmentCard({ a, onChanged }: { a: MyAssignment; onChanged: () => void }) {
  const toast = useToast();
  const [writing, setWriting] = useState(false);
  const [recuseOpen, setRecuseOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"accept" | "recuse" | null>(null);
  const status = a.status as AssignmentStatus;
  const pending = status === "invited" || status === "accepted";

  const respond = async (decision: "accept" | "recuse") => {
    setBusy(decision);
    try {
      await respondAssignment(a.assignmentId, { decision, reason: decision === "recuse" ? reason.trim() || undefined : undefined });
      toast.success(decision === "accept" ? "Görevi kabul ettiniz. Raporunuzu süre dolmadan gönderin." : "Çekinme beyanınız kaydedildi; yerinize yeni bilirkişi çekilecek.");
      setRecuseOpen(false);
      onChanged();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title={
        <Link to={routes.proposal(a.proposalId)}>
          {proposalRef(a.proposalSeq)} {a.proposalTitle || "Öneri"}
        </Link>
      }
      actions={<Badge tone={ASSIGNMENT_TONE[status] ?? "neutral"}>{ASSIGNMENT_STATUS_LABELS[status] ?? a.status}</Badge>}
      headingLevel={3}
    >
      <div className="stack">
        <div className="row">
          {pending ? <Countdown to={a.dueAt} prefix="Rapor teslimine" /> : null}
          <span className="muted small">Soru sayısı: {a.questions.length}</span>
        </div>
        {status === "invited" ? (
          <p className="mt-0 small">
            Kurayla seçildiniz. Çıkar çatışmanız varsa (ör. öneri yazarıyla aile, iş ya da hane yakınlığı) görevi kabul etmeyip çekinmeniz gerekir.
          </p>
        ) : null}
        {pending ? (
          <div className="row">
            {status === "invited" ? (
              <Button variant="primary" loading={busy === "accept"} disabled={!!busy} onClick={() => void respond("accept")}>
                Görevi kabul et
              </Button>
            ) : (
              <Button variant={writing ? "ghost" : "primary"} onClick={() => setWriting((w) => !w)} aria-expanded={writing}>
                {writing ? "Rapor formunu gizle" : "Raporu yaz"}
              </Button>
            )}
            <Button variant="ghost" disabled={!!busy} onClick={() => setRecuseOpen(true)}>
              Çekin…
            </Button>
          </div>
        ) : null}
        {writing && status === "accepted" ? (
          <ExpertReportForm
            assignment={a}
            onCancel={() => setWriting(false)}
            onSubmitted={() => {
              setWriting(false);
              onChanged();
            }}
          />
        ) : null}
      </div>
      <Modal
        open={recuseOpen}
        onClose={() => setRecuseOpen(false)}
        dismissible={busy !== "recuse"}
        title="Görevden çekin"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRecuseOpen(false)} disabled={busy === "recuse"}>
              Vazgeç
            </Button>
            <Button variant="danger" loading={busy === "recuse"} onClick={() => void respond("recuse")}>
              Çekin
            </Button>
          </>
        }
      >
        <div className="stack">
          <p className="mt-0">Çekinirseniz yerinize yeni bir bilirkişi çekilir (kura defterdeki tohumla yeniden üretilebilir). Çıkar çatışması varsa çekinmek bir yükümlülüktür.</p>
          <Textarea
            label="Gerekçe (isteğe bağlı)"
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            hint="Kişisel veri yazmayın (ör. “Öneri yazarıyla aynı kurumda çalışıyorum”)."
          />
        </div>
      </Modal>
    </Card>
  );
}
