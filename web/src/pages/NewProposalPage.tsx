// Yeni öneri: 5 tür (yeni konu, alt konu, düzenleme teklifi, silme talebi, yönetmelik değişikliği),
// türe göre form ve canlı ön denetim (POST /api/proposals/precheck, ~700 ms gecikmeyle).
// Ön doldurma: ?tur=<kind>&konu=<topicId>&mesaj=<messageId> (routes.newProposal).
// Sade düzen: tür seçilince türler tek satırlık radyolara daralır (KindPicker) ve form hemen başlar; ön denetim önce hükmü verir,
// ayrıntılar duruma göre açılır (PrecheckPanel); isteğe bağlı 'Ek kategoriler' kapalı başlar; gönderim notu tek satırdır
// ('Gönderince ne olur?' açılırında ayrıntı). 'Tam' görünümde bütün açılırlar açık gelir.
// Form yalnız bellekte tutulur: ön denetimdeki sözlük pencerelerinin ve madde atıflarının bağlantıları sayfadan çıkarmaz
// (TermLinksProvider: web'de yeni sekme, yerel uygulamada bağlantısız; benzer öneri önizlemesiyle aynı kural).
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { expandIri, PROPOSAL_KIND_LABELS, PROPOSAL_TEXT_LIMITS, type CreateProposalRequest, type MessageView, type ProposalKind, type TopicSummary } from "@forum/shared";
import { ApiError } from "../api/client";
import { createProposal, getTopic, listTopics, precheckProposal } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { CategoryPicker } from "../components/CategoryPicker";
import { DeletionForm, deletionTargetProblems, type DeletionDraft } from "../components/proposals/DeletionForm";
import { KIND_INFO, KIND_ORDER, KindPicker } from "../components/proposals/KindPicker";
import { draftToPatch, PatchBuilder, type PatchDraftOp } from "../components/proposals/PatchBuilder";
import { PII_KIND_LABELS, PrecheckPanel, PrecheckSummary } from "../components/proposals/PrecheckPanel";
import { useOntology } from "../lib/categories";
import { topicRef } from "../lib/format";
import { useDebounced, useQueryState } from "../lib/hooks";
import { isNativePlatform } from "../lib/prefs";
import { routes } from "../lib/routes";
import { useAsync } from "../lib/useAsync";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Details,
  DiffView,
  ErrorView,
  formTermLinkMode,
  Input,
  KeyValue,
  LinkButton,
  PageHeader,
  Select,
  Spinner,
  TermLinksProvider,
  Textarea,
  useConfirm,
  useToast,
} from "../ui";
import "../components/proposals/new-proposal.css";

type FieldKey = "title" | "body" | "categories" | "parentTopicId" | "messageIds" | "ground" | "statement" | "regulationPatch";
type PiiItem = { kind: string; masked: string };

/** Gönderim düğmelerinin altındaki tek satır; ayrıntısı 'Gönderince ne olur?' açılırında. */
const SUBMIT_NOTE = "Taslak yalnız size görünür; gönderince metin kilitlenir ve öneri destekçi toplamaya başlar.";

// Madde 7 (1) ile aynı sınırlar (sunucu ve SHACL de PROPOSAL_TEXT_LIMITS'i kullanır).
const { titleMin: TITLE_MIN, titleMax: TITLE_MAX, bodyMin: BODY_MIN } = PROPOSAL_TEXT_LIMITS;
const BODY_MAX = 20000;

/** Etkin konuları ağaç sırasıyla (derinlikle) düzleştirir. */
function orderTopics(topics: TopicSummary[]): { t: TopicSummary; depth: number }[] {
  const active = topics.filter((t) => t.status === "active");
  const ids = new Set(active.map((t) => t.id));
  const kids = new Map<string | null, TopicSummary[]>();
  for (const t of active) {
    const p = t.parentId && ids.has(t.parentId) ? t.parentId : null;
    kids.set(p, [...(kids.get(p) ?? []), t]);
  }
  const out: { t: TopicSummary; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (p: string | null, depth: number) => {
    for (const t of (kids.get(p) ?? []).sort((a, b) => a.seq - b.seq)) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push({ t, depth });
      walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Sunucunun 400 doğrulama ayrıntılarını form alanlarına eşler. */
function mapServerErrors(details: unknown): Partial<Record<FieldKey, string>> {
  const out: Partial<Record<FieldKey, string>> = {};
  const put = (path: string, msg: string) => {
    const p = path.replace(/^body\./, "");
    const key: FieldKey | null = p.startsWith("title")
      ? "title"
      : p === "body"
        ? "body"
        : p.startsWith("categories")
          ? "categories"
          : p.startsWith("parentTopicId") || p.startsWith("amendment")
            ? "parentTopicId"
            : p.startsWith("deletion.messageIds")
              ? "messageIds"
              : p.startsWith("deletion.ground")
                ? "ground"
                : p.startsWith("deletion")
                  ? "statement"
                  : p.startsWith("regulationPatch")
                    ? "regulationPatch"
                    : null;
    if (key && !out[key]) out[key] = msg;
  };
  const list = Array.isArray(details) ? details : details && typeof details === "object" && Array.isArray((details as { issues?: unknown }).issues) ? (details as { issues: unknown[] }).issues : null;
  if (list) {
    for (const d of list) {
      if (!d || typeof d !== "object") continue;
      const o = d as { path?: unknown; message?: unknown };
      const path = Array.isArray(o.path) ? o.path.join(".") : typeof o.path === "string" ? o.path : "";
      if (path && typeof o.message === "string") put(path, o.message);
    }
  } else if (details && typeof details === "object") {
    for (const [k, v] of Object.entries(details as Record<string, unknown>)) if (typeof v === "string") put(k, v);
  }
  return out;
}

export default function NewProposalPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { ontology } = useOntology();
  const [search] = useSearchParams();
  const initialMsg = useRef(search.get("mesaj") ?? "").current;
  const [kindParam, setKindParam] = useQueryState("tur", "");
  const kind = (KIND_ORDER as string[]).includes(kindParam) ? (kindParam as ProposalKind) : null;

  useEffect(() => {
    if (!kindParam && initialMsg) setKindParam("deletion");
  }, [kindParam, initialMsg, setKindParam]);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [requestExpert, setRequestExpert] = useState(false);
  const [parentTopicId, setParentTopicId] = useState(() => search.get("konu") ?? "");
  const [deletion, setDeletion] = useState<DeletionDraft>({ messageIds: initialMsg ? [initialMsg] : [], ground: "", statement: "" });
  const [delMessages, setDelMessages] = useState<MessageView[]>([]);
  const [patchOps, setPatchOps] = useState<PatchDraftOp[]>([]);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [pii, setPii] = useState<PiiItem[] | null>(null);
  const [ackPii, setAckPii] = useState(false);
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const needsTopic = kind === "subtopic" || kind === "amendment";
  const topicsQ = useAsync(() => listTopics(), [], { enabled: needsTopic });
  const topicOptions = useMemo(() => orderTopics(topicsQ.data ?? []), [topicsQ.data]);
  const topicQ = useAsync(() => getTopic(parentTopicId), [parentTopicId], { enabled: needsTopic && !!parentTopicId });
  const topic = needsTopic && parentTopicId && topicQ.data?.id === parentTopicId ? topicQ.data : null;

  // Düzenleme teklifi: hedef konu seçilince güncel metin önceden doldurulur (konu başına bir kez).
  const prefilledFor = useRef<string | null>(null);
  useEffect(() => {
    if (kind !== "amendment" || !topic) return;
    const key = `${topic.id}@${topic.version}`;
    if (prefilledFor.current === key) return;
    prefilledFor.current = key;
    setTitle(topic.title);
    setBody(topic.body);
  }, [kind, topic]);

  const patchInfo = useMemo(() => draftToPatch(patchOps, body.trim(), ontology?.params ?? [], ontology?.articles ?? []), [patchOps, body, ontology]);

  const req = useMemo<CreateProposalRequest | null>(() => {
    if (!kind) return null;
    const r: CreateProposalRequest = { kind, title: title.trim(), body: body.trim(), categories };
    if (kind !== "deletion") r.requestExpert = requestExpert;
    if (kind === "subtopic" || kind === "amendment") r.parentTopicId = parentTopicId || undefined;
    if (kind === "amendment" && topic) r.amendment = { baseVersion: topic.version, newTitle: title.trim(), newBody: body.trim() };
    if (kind === "deletion") {
      // HTTP şeması başlığı zorunlu tutar; sunucunun varsayılanıyla aynı başlık üretilir, metin = açıklama.
      r.title = `Silme talebi: ${deletion.messageIds.length} mesaj`;
      r.body = "";
      r.categories = [];
      r.deletion = { messageIds: deletion.messageIds, ground: deletion.ground, statement: deletion.statement.trim() };
    }
    if (kind === "regulation") r.regulationPatch = patchInfo.patch;
    return r;
  }, [kind, title, body, categories, requestExpert, parentTopicId, topic, deletion, patchInfo]);

  const idleText = useMemo<string | null>(() => {
    if (!kind) return "Önce öneri türünü seçin.";
    switch (kind) {
      case "topic":
        return title.trim() || body.trim() ? null : "Ön denetim için başlık ya da metin yazmaya başlayın.";
      case "subtopic":
        return !parentTopicId ? "Ön denetim için üst konuyu seçin." : title.trim() || body.trim() ? null : "Ön denetim için başlık ya da metin yazmaya başlayın.";
      case "amendment":
        return !parentTopicId ? "Ön denetim için hedef konuyu seçin." : !topic ? "Hedef konu yükleniyor…" : null;
      case "deletion":
        return !deletion.messageIds.length ? "Ön denetim için en az bir hedef mesaj ekleyin." : !deletion.ground ? "Ön denetim için bir silme gerekçesi seçin." : null;
      case "regulation":
        return patchInfo.patch.ops.length ? null : "Ön denetim için en az bir tamamlanmış yama işlemi ekleyin.";
    }
  }, [kind, title, body, parentTopicId, topic, deletion, patchInfo]);

  // Ön denetim başlık yazılmadan da çalışsın (HTTP şeması boş başlığı reddeder): geçici başlık.
  const reqKey = useMemo(() => {
    if (!req || idleText) return "";
    const t = req.title || "Başlıksız öneri";
    return JSON.stringify({ ...req, title: t, amendment: req.amendment ? { ...req.amendment, newTitle: t } : undefined });
  }, [req, idleText]);
  const debKey = useDebounced(reqKey, 700);
  const canPropose = auth.can("V");
  const pre = useAsync(() => precheckProposal(JSON.parse(debKey) as CreateProposalRequest), [debKey], { enabled: !!debKey && canPropose });
  const preResult = debKey && pre.data ? pre.data : undefined;
  const preStale = !!reqKey && (reqKey !== debKey || pre.loading);

  // Tür değişince eski türün denetim sonucu gösterilmesin.
  const { setData: setPreData } = pre;
  useEffect(() => {
    setPreData(undefined);
    setErrors({});
    setSubmitError(null);
  }, [kind, setPreData]);

  const inherited = useMemo(() => (needsTopic && topic ? topic.categories : []), [needsTopic, topic]);
  const suggestions = useMemo(() => {
    const have = new Set(inherited.map(expandIri));
    return (preResult?.classification.categories ?? [])
      .filter((c) => !have.has(expandIri(c.iri)))
      .map((c) => ({ iri: c.iri, label: c.label, confidence: c.confidence }));
  }, [preResult, inherited]);
  const addCategory = (iri: string) => setCategories((prev) => (prev.includes(iri) ? prev : [...prev, iri]));

  if (!canPropose) {
    const st = auth.user?.status;
    return (
      <div className="page page-narrow">
        <PageHeader title="Yeni öneri" back={{ to: routes.proposals(), label: "Öneriler" }} />
        <Alert
          tone="warning"
          title={st === "pending" ? "Hesabınız henüz doğrulanmadı" : st === "suspended" ? "Hesabınız askıya alınmış" : "Öneri açmak için doğrulanmış üyelik gerekir"}
          actions={
            <LinkButton to={routes.proposals()} size="sm">
              Önerilere göz at
            </LinkButton>
          }
        >
          {st === "pending" ? (
            <p>Öneri açmak, desteklemek ve silme talebi oluşturmak için kayıt memurunun kimliğinizi doğrulaması gerekir. Doğrulanınca bu sayfayı kullanabilirsiniz.</p>
          ) : (
            <p>Yalnızca doğrulanmış üyeler öneri açabilir. Tartışmaları ve kararları herkes okuyabilir.</p>
          )}
        </Alert>
      </div>
    );
  }

  const validate = (): Partial<Record<FieldKey, string>> => {
    const e: Partial<Record<FieldKey, string>> = {};
    if (kind !== "deletion") {
      const t = title.trim();
      const b = body.trim();
      if (t.length < TITLE_MIN) e.title = `Başlık en az ${TITLE_MIN} karakter olmalıdır.`;
      else if (t.length > TITLE_MAX) e.title = `Başlık en çok ${TITLE_MAX} karakter olabilir.`;
      if (b.length < BODY_MIN) e.body = kind === "regulation" ? `Gerekçe en az ${BODY_MIN} karakter olmalıdır.` : `Metin en az ${BODY_MIN} karakter olmalıdır.`;
    }
    if (kind === "topic" && !categories.length) e.categories = "En az bir kategori seçin.";
    if (needsTopic && !parentTopicId) e.parentTopicId = kind === "subtopic" ? "Üst konuyu seçin." : "Hedef konuyu seçin.";
    if (kind === "amendment" && topic && title.trim() === topic.title.trim() && body.trim() === topic.body.trim()) e.body = "Konunun güncel metninde henüz bir değişiklik yapmadınız.";
    if (kind === "deletion") {
      if (!deletion.messageIds.length) e.messageIds = "En az bir hedef mesaj ekleyin.";
      else {
        const probs = deletionTargetProblems(delMessages, auth.user?.id);
        if (probs.length) e.messageIds = probs[0];
      }
      if (!deletion.ground) e.ground = "Bir silme gerekçesi seçin.";
      if (deletion.statement.trim().length < 20) e.statement = "Açıklama en az 20 karakter olmalıdır.";
    }
    if (kind === "regulation") {
      if (!patchOps.length) e.regulationPatch = "En az bir yama işlemi ekleyin.";
      else if (patchInfo.incomplete.length) e.regulationPatch = `Eksik işlemleri tamamlayın ya da kaldırın: ${patchInfo.incomplete.join(", ")}.`;
    }
    return e;
  };

  const scrollToError = () =>
    window.setTimeout(() => formRef.current?.querySelector(".field-error, [aria-invalid='true']")?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);

  const send = async (submit: boolean) => {
    if (!req || busy) return;
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      toast.warning("Formdaki eksikleri tamamlayın.");
      scrollToError();
      return;
    }
    if (submit && preResult && !preStale && !preResult.audit.admissible) {
      const ok = await confirm({
        title: "Ön denetim bu öneriyi yönetmeliğe aykırı buldu",
        message: "Destekçi toplasa bile oylamaya giremez ve “Yönetmeliğe aykırı” olarak kapanır. Yine de gönderilsin mi? (Taslak olarak kaydedip düzeltmeniz önerilir.)",
        confirmLabel: "Yine de gönder",
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusy(submit ? "submit" : "draft");
    setSubmitError(null);
    try {
      const p = await createProposal({ ...req, submit, acknowledgePii: ackPii || undefined });
      toast.success(submit ? "Öneri kaydedildi ve destekçi toplamaya gönderildi." : "Taslak kaydedildi; yalnızca siz görebilirsiniz.");
      navigate(routes.proposal(p.id));
    } catch (err) {
      if (err instanceof ApiError && err.code === "pii_detected") {
        const list = ((err.details as { pii?: PiiItem[] } | null)?.pii ?? []).map((x) => ({ kind: x.kind, masked: x.masked }));
        setPii(list);
        setAckPii(false);
        window.setTimeout(() => document.getElementById("np-pii")?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
      } else {
        if (err instanceof ApiError && err.status === 400) {
          const mapped = mapServerErrors(err.details);
          if (Object.keys(mapped).length) setErrors(mapped);
        }
        setSubmitError(err);
      }
    } finally {
      setBusy(null);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(true);
  };

  const versionConflict = submitError instanceof ApiError && submitError.code === "version_conflict";

  const titleField = (
    <Input
      label="Başlık"
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      maxLength={TITLE_MAX}
      required
      error={errors.title}
      hint={`${TITLE_MIN}–${TITLE_MAX} karakter; kısa ve açıklayıcı olsun.`}
    />
  );
  const bodyField = (label: string, hint: string) => (
    <Textarea label={label} value={body} onChange={(e) => setBody(e.target.value)} rows={10} maxLength={BODY_MAX} showCount required error={errors.body} hint={hint} />
  );
  const expertField = (
    <Checkbox
      label="Bilirkişi görüşü iste"
      checked={requestExpert}
      onChange={(e) => setRequestExpert(e.target.checked)}
      hint="Tartışma evresinde, çıkar çatışması olmayan etkin bilirkişiler arasından ağırlıklı kurayla panel çekilir. Bilirkişi danışmandır; oyu 1'dir."
    />
  );
  const topicSelect = (label: string, hint: string) => (
    <div className="stack-sm">
      {topicsQ.loading && !topicsQ.data ? <Spinner label="Konular yükleniyor…" showLabel /> : null}
      {topicsQ.error ? <ErrorView error={topicsQ.error} compact onRetry={topicsQ.reload} /> : null}
      {topicsQ.data && !topicOptions.length ? (
        <Alert tone="info" title="Yürürlükte konu yok">
          Alt konu ve düzenleme teklifi yalnızca yürürlükteki (oylamayla kabul edilmiş) bir konu için açılabilir. Önce bir “Yeni konu” önerin.
        </Alert>
      ) : null}
      <Select
        label={label}
        placeholder="Konu seçin…"
        required
        value={parentTopicId}
        onChange={(e) => setParentTopicId(e.target.value)}
        error={errors.parentTopicId}
        hint={hint}
        options={[
          ...topicOptions.map(({ t, depth }) => ({ value: t.id, label: `${"— ".repeat(depth)}${topicRef(t.seq)} ${t.title}` })),
          ...(parentTopicId && !topicOptions.some((o) => o.t.id === parentTopicId) && topic ? [{ value: topic.id, label: `${topicRef(topic.seq)} ${topic.title}` }] : []),
        ]}
      />
      {parentTopicId && topicQ.loading && !topic ? <Spinner label="Konu yükleniyor…" showLabel /> : null}
      {parentTopicId && topicQ.error ? <ErrorView error={topicQ.error} compact onRetry={topicQ.reload} /> : null}
      {topic && topic.status !== "active" ? (
        <Alert tone="error" title="Bu konu yürürlükte değil">
          Arşivlenmiş bir konu için alt konu ya da düzenleme teklifi açılamaz.
        </Alert>
      ) : null}
    </div>
  );
  const inheritedInfo = inherited.length ? <InheritedCategories iris={inherited} /> : null;

  return (
    <div className="page">
      <PageHeader
        title="Yeni öneri"
        subtitle="Forumda her değişiklik bir öneriyle başlar: destekçi toplar, tartışılır, köprülü çoğunlukla oylanır."
        back={{ to: routes.proposals(), label: "Öneriler" }}
      />
      <div className="form-section np-kinds">
        <KindPicker label="1. Öneri türü" value={kind} onChange={(k) => setKindParam(k)} disabled={!!busy} />
      </div>

      <TermLinksProvider mode={formTermLinkMode(isNativePlatform())}>
        <div className="split np-split">
          <form ref={formRef} className="stack" onSubmit={onSubmit} noValidate aria-label="Öneri formu">
            {kind ? (
              <fieldset className="form-section" disabled={!!busy}>
                <legend>2. {PROPOSAL_KIND_LABELS[kind]}</legend>
                {/* Tek cümle; türün uzun açıklaması seçicinin 'Türler ne demek?' açılırında. */}
                <p className="small muted mt-0">{KIND_INFO[kind].short}</p>

                {kind === "topic" ? (
                  <>
                    {titleField}
                    {bodyField("Öneri metni", "Konunun amacını, kapsamını ve gerekçesini yazın. Kişisel veri (ad, TCKN, telefon, adres) yazmayın.")}
                    <CategoryPicker
                      value={categories}
                      onChange={setCategories}
                      required
                      max={8}
                      error={errors.categories}
                      suggestions={suggestions}
                      hint="En özel kategoriyi seçmeniz yeterli; üst kategoriler ontoloji tarafından çıkarılır. YZ önerileri yalnızca tıklarsanız eklenir."
                    />
                    {expertField}
                  </>
                ) : null}

                {kind === "subtopic" ? (
                  <>
                    {topicSelect("Üst konu", "Yalnızca yürürlükteki konular listelenir.")}
                    {inheritedInfo}
                    {titleField}
                    {bodyField("Alt konu metni", "Alt konunun üst konuya göre neyi kapsadığını yazın. Kişisel veri yazmayın.")}
                    <CategoryPicker
                      label="Ek kategoriler (isteğe bağlı)"
                      collapsible
                      value={categories}
                      onChange={setCategories}
                      max={8}
                      error={errors.categories}
                      suggestions={suggestions}
                      hint="Üst konunun kategorileri otomatik miras alınır; burada yalnızca eklemeler seçilir."
                    />
                    {expertField}
                  </>
                ) : null}

                {kind === "amendment" ? (
                  <>
                    {topicSelect("Hedef konu", "Metni değiştirilecek yürürlükteki konu.")}
                    {topic ? (
                      <>
                        <KeyValue
                          compact
                          items={[
                            { label: "Dayandığı sürüm (baseVersion)", value: `sürüm ${topic.version}`, hint: "Kabul anında konu başka bir kararla değişmişse teklif “sürüm çakışması” ile reddedilir." },
                            { label: "Konu", value: `${topicRef(topic.seq)} ${topic.title}` },
                          ]}
                        />
                        {inheritedInfo}
                        {titleField}
                        {bodyField("Yeni metin", "Konunun güncel metni önceden dolduruldu; değiştirmek istediğiniz yerleri düzenleyin.")}
                        <div className="row">
                          <Button
                            size="sm"
                            variant="ghost"
                            icon="refresh"
                            onClick={() => {
                              setTitle(topic.title);
                              setBody(topic.body);
                            }}
                          >
                            Güncel metne sıfırla
                          </Button>
                        </div>
                        {title.trim() !== topic.title.trim() ? (
                          <div className="stack-sm">
                            <span className="field-label">Başlık farkı</span>
                            <DiffView before={topic.title} after={title.trim()} mode="inline" label="Başlık farkı" />
                          </div>
                        ) : null}
                        <div className="stack-sm">
                          <span className="field-label">Metin farkı (güncel sürüm → teklif)</span>
                          <DiffView before={topic.body} after={body} context={2} label="Metin farkı" />
                        </div>
                        <CategoryPicker
                          label="Ek kategoriler (isteğe bağlı)"
                          collapsible
                          value={categories}
                          onChange={setCategories}
                          max={8}
                          error={errors.categories}
                          suggestions={suggestions}
                          hint="Konunun kategorileri otomatik miras alınır; burada yalnızca eklemeler seçilir."
                        />
                        {expertField}
                      </>
                    ) : null}
                  </>
                ) : null}

                {kind === "deletion" ? (
                  <DeletionForm
                    value={deletion}
                    onChange={setDeletion}
                    onMessagesLoaded={setDelMessages}
                    errors={{ messageIds: errors.messageIds, ground: errors.ground, statement: errors.statement }}
                  />
                ) : null}

                {kind === "regulation" ? (
                  <>
                    {titleField}
                    {bodyField("Gerekçe", "Değişikliğin neden gerektiğini ve beklenen etkisini açıklayın; bu metin yamanın gerekçesi olarak da kaydedilir.")}
                    <PatchBuilder drafts={patchOps} onChange={setPatchOps} rationale={body.trim()} error={errors.regulationPatch} />
                    <p className="small muted mt-0">Kategori: Forum yönetmeliği (otomatik).</p>
                    {expertField}
                  </>
                ) : null}
              </fieldset>
            ) : null}

            {kind ? (
              <section className="stack-sm np-submit" aria-label="Gönderim">
                <div className="row-between">
                  <PrecheckSummary result={preResult} loading={pre.loading} stale={preStale} />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="chevronDown"
                    className="np-to-panel"
                    onClick={() => document.getElementById("np-precheck")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  >
                    Ön denetim ayrıntıları
                  </Button>
                </div>

                {pii ? (
                  <div id="np-pii">
                    <Alert tone="warning" title="Kişisel veri tespit edildi">
                      <p>Metinde kişisel veri olabilecek ifadeler bulundu:</p>
                      <ul>
                        {pii.map((p, i) => (
                          <li key={i}>
                            {PII_KIND_LABELS[p.kind] ?? p.kind}: <code className="mono">{p.masked}</code>
                          </li>
                        ))}
                      </ul>
                      <p>Kaldırmanız önerilir. Bilerek paylaşıyorsanız aşağıdaki kutuyu işaretleyip yeniden gönderin.</p>
                      <Checkbox
                        label="Bu bilgileri bilerek paylaşıyorum; yine de kaydet"
                        checked={ackPii}
                        onChange={(e) => setAckPii(e.target.checked)}
                        hint="Kişisel veri hiçbir zaman deftere yazılmaz; ancak tartışma metni herkese açıktır."
                      />
                    </Alert>
                  </div>
                ) : null}

                {submitError ? (
                  <ErrorView
                    error={submitError}
                    title={versionConflict ? "Konu bu arada güncellendi" : undefined}
                    onRetry={
                      versionConflict
                        ? () => {
                            prefilledFor.current = null;
                            setSubmitError(null);
                            void topicQ.reload();
                          }
                        : undefined
                    }
                  />
                ) : null}
                {versionConflict ? <p className="small muted mt-0">“Tekrar dene” konunun güncel sürümünü yükler ve metni ona göre yeniden doldurur.</p> : null}

                <div className="form-actions">
                  <Button onClick={() => void send(false)} loading={busy === "draft"} disabled={!!busy} icon="check">
                    Taslak kaydet
                  </Button>
                  <Button type="submit" variant="primary" loading={busy === "submit"} disabled={!!busy} icon="users">
                    Kaydet ve destekçi toplamaya gönder
                  </Button>
                </div>
                <p className="small muted mt-0">{SUBMIT_NOTE}</p>
                <Details summary="Gönderince ne olur?" className="np-submit-more">
                  <p className="small mt-0">
                    Taslak yalnızca size görünür ve sonradan düzenlenebilir. Gönderdiğinizde metin kilitlenir ve öneri, gerekli sayıda doğrulanmış üye eş
                    imzacı olana kadar “Destekçi toplanıyor” evresinde kalır; ardından ontoloji denetiminden geçip tartışmaya açılır.
                  </p>
                </Details>
              </section>
            ) : null}
          </form>

          <aside className="np-aside" id="np-precheck" aria-label="Ön denetim">
            {kind ? (
              <PrecheckPanel
                result={preResult}
                loading={pre.loading}
                error={debKey ? pre.error : null}
                stale={preStale}
                idleText={idleText}
                onRetry={() => void pre.reload()}
                selectedCategories={kind === "deletion" || kind === "regulation" ? undefined : [...categories, ...inherited]}
                onAddCategory={kind === "topic" || kind === "subtopic" || kind === "amendment" ? addCategory : undefined}
              />
            ) : (
              <Card title="Bir öneri nasıl karara dönüşür?" tone="muted">
                <ol className="steps">
                  <li>
                    <strong>Taslak</strong> — yalnızca siz görürsünüz; canlı ön denetim katmanı ve kuralları gösterir.
                  </li>
                  <li>
                    <strong>Destekçi toplama</strong> — yazar dışında birkaç doğrulanmış üye eş imzacı olur.
                  </li>
                  <li>
                    <strong>Ontoloji denetimi</strong> — yönetmeliğe aykırı öneriler oylamaya giremez.
                  </li>
                  <li>
                    <strong>Tartışma</strong> — metin önerileri, bilirkişi görüşü, YZ özeti (danışma).
                  </li>
                  <li>
                    <strong>Gizli oylama</strong> — genel onay + her görüş kümesinden asgari destek (köprü testi).
                  </li>
                  <li>
                    <strong>İtiraz / uzlaşma</strong> — azınlık kararı bir kez erteleyebilir; yeniden oylama kesin sonuçtur.
                  </li>
                </ol>
              </Card>
            )}
          </aside>
        </div>
      </TermLinksProvider>
    </div>
  );
}

function InheritedCategories({ iris }: { iris: string[] }) {
  const { categoryLabel, categoryPath } = useOntology();
  return (
    <div className="np-inherited">
      <span className="small muted">Konudan miras alınan kategoriler:</span>
      <div className="cat-tags">
        {iris.map((c) => (
          <span key={c} className="cat-tag" title={categoryPath(c)}>
            {categoryLabel(c)}
          </span>
        ))}
      </div>
      <Badge tone="neutral">otomatik</Badge>
    </div>
  );
}
