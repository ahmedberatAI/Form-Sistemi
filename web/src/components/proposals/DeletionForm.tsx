// Silme (karartma) talebi formu: hedef mesaj(lar), silme gerekçesi, açıklama.
// "Görüş ayrılığı" değiştirilemez madde gereği seçilemez (devre dışı ve açıklamalı gösterilir).
// Aynı tartışmadaki aynı yazarın birden çok mesajı tek talepte toplanabilir.
// Sade düzen: 'Tartışma silinmez' tek cümledir (ayrıntısı açılırda); kurallar canlı sayaçlı tek satırdır ('Açık talepleriniz 1/3 ·
// son 24 saatte 2/5'), dört kural açılırdadır ve sınıra 1 kala ya da sınırda turuncu ve AÇIK gelir. Talep bir mesajdan başlatıldıysa
// 'Mesaj kimliğiyle ekle' alanı da açılırdadır.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DELETION_GROUND_VOCAB, expandIri, fy, type GroundInfo, type MessageView, type ProposalStatus, type ProposalSummary } from "@forum/shared";
import { getMessage, getThread, listProposals } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { useOntology } from "../../lib/categories";
import { formatPercent, proposalRef, truncate } from "../../lib/format";
import { routes } from "../../lib/routes";
import { useAsync } from "../../lib/useAsync";
import { Alert, Badge, Button, cx, Details, ErrorView, Icon, Input, RadioGroup, Spinner, StanceBadge, Textarea, Time } from "../../ui";
import { profileHref } from "../system/accountLogic";
import { UserLink } from "../UserLink";
import "./new-proposal.css";

export const GORUS_AYRILIGI_IRI = fy("GorusAyriligi");
export const MAX_OPEN_DELETIONS = 3;
export const MAX_DELETIONS_PER_DAY = 5;
const MAX_MESSAGES = 20;
const DAY_MS = 86_400_000;
/** Sunucuyla aynı: bu durumlardaki talepler 'açık' sayılmaz (server/src/forum/proposals.ts › CLOSED_SQL). */
const CLOSED_STATUSES: ProposalStatus[] = ["enacted", "rejected", "withdrawn", "expired", "inadmissible"];

export interface DeletionDraft {
  messageIds: string[];
  ground: string;
  statement: string;
}

type GroundExt = GroundInfo & { invalid?: boolean; sealed?: boolean };

export function isInvalidGround(g: GroundExt): boolean {
  return !!g.invalid || expandIri(g.iri) === GORUS_AYRILIGI_IRI;
}

/** Sunucudan (yoksa ortak sözlükten) silme gerekçeleri. */
export function useDeletionGrounds(): GroundExt[] {
  const { ontology } = useOntology();
  return useMemo(() => {
    const fromServer = ontology?.deletionGrounds as GroundExt[] | undefined;
    if (fromServer?.length) return fromServer;
    return DELETION_GROUND_VOCAB.map((g) => ({ iri: fy(g.local), label: g.label, description: g.description, urgent: g.urgent, sealed: g.sealed, invalid: g.invalid }));
  }, [ontology]);
}

/** İstemci tarafı hedef denetimi (sunucu da aynı kuralları uygular). */
export function deletionTargetProblems(messages: MessageView[], myId: string | null | undefined): string[] {
  const out: string[] = [];
  if (!messages.length) return out;
  const first = messages[0];
  if (messages.some((m) => m.threadType !== first.threadType || m.threadId !== first.threadId)) out.push("Tüm mesajlar aynı tartışmada olmalıdır.");
  if (messages.some((m) => m.authorId !== first.authorId)) out.push("Bir talep yalnızca tek bir yazarın mesajlarını kapsayabilir.");
  if (messages.some((m) => m.visibility === "hidden" || m.visibility === "sealed")) out.push("Seçilen mesajlardan biri zaten karartılmış.");
  if (myId && messages.some((m) => m.authorId === myId)) out.push("Kendi mesajınız için silme talebi açamazsınız; mesajınızı düzenleyebilirsiniz.");
  return out;
}

export interface DeletionLimits {
  /** Sonuçlanmamış silme talepleri (taslak dahil) */
  open: number;
  /** Son 24 saatte açılanlar */
  day: number;
}

/** Kullanıcının kendi silme taleplerinden sayaçlar (saf; sunucu da aynı sınırları aynı biçimde sayar). */
export function deletionLimits(mine: readonly Pick<ProposalSummary, "status" | "createdAt">[], now: number): DeletionLimits {
  return {
    open: mine.filter((p) => !CLOSED_STATUSES.includes(p.status)).length,
    day: mine.filter((p) => p.createdAt > now - DAY_MS).length,
  };
}

export type DeletionLimitLevel = "ok" | "near" | "at";

/** Sınıra uzaklık: 'at' sınırda (yeni talep reddedilir), 'near' sınıra 1 kala, 'ok' olağan. Sayaç yüklenmediyse 'ok'. */
export function deletionLimitLevel(limits: DeletionLimits | null): DeletionLimitLevel {
  if (!limits) return "ok";
  if (limits.open >= MAX_OPEN_DELETIONS || limits.day >= MAX_DELETIONS_PER_DAY) return "at";
  if (limits.open >= MAX_OPEN_DELETIONS - 1 || limits.day >= MAX_DELETIONS_PER_DAY - 1) return "near";
  return "ok";
}

/** Kurallar satırının metni: "Açık talepleriniz 1/3 · son 24 saatte 2/5" (sayaç yokken yalnız sınırlar). */
export function deletionLimitLine(limits: DeletionLimits | null): string {
  if (!limits) return `en çok ${MAX_OPEN_DELETIONS} açık talep · 24 saatte en çok ${MAX_DELETIONS_PER_DAY} talep`;
  return `Açık talepleriniz ${limits.open}/${MAX_OPEN_DELETIONS} · son 24 saatte ${limits.day}/${MAX_DELETIONS_PER_DAY}`;
}

export interface DeletionFormProps {
  value: DeletionDraft;
  onChange: (next: DeletionDraft) => void;
  errors?: Partial<Record<"messageIds" | "ground" | "statement", string>>;
  /** Yüklenen mesajlar (sayfa doğrulaması için) */
  onMessagesLoaded?: (messages: MessageView[]) => void;
}

export function DeletionForm({ value, onChange, errors = {}, onMessagesLoaded }: DeletionFormProps) {
  const auth = useAuth();
  const grounds = useDeletionGrounds();
  const [manualId, setManualId] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Talep bir mesajdan başlatıldıysa (hedef önceden dolu) elle ekleme alanı açılırda durur. İlk değer sabittir: elle ilk mesajı
  // ekleyen kişinin alanı (ve odağı) ekleme anında kaybolmaz.
  const [startedWithTarget] = useState(() => value.messageIds.length > 0);

  const idsKey = value.messageIds.join(",");
  const msgs = useAsync(
    async () => {
      const list = await Promise.all(value.messageIds.map((id) => getMessage(id)));
      onMessagesLoaded?.(list);
      return list;
    },
    [idsKey],
    { enabled: value.messageIds.length > 0 },
  );
  const messages = useMemo(() => (msgs.data ?? []).filter((m) => value.messageIds.includes(m.id)), [msgs.data, value.messageIds]);
  const first = messages[0];

  const thread = useAsync(() => getThread(first!.threadType, first!.threadId), [first?.threadType, first?.threadId], { enabled: !!first });
  const siblings = useMemo(() => {
    if (!first || !thread.data) return [];
    const chosen = new Set(value.messageIds);
    return thread.data.messages.filter((m) => m.authorId === first.authorId && !chosen.has(m.id) && m.visibility !== "hidden" && m.visibility !== "sealed");
  }, [first, thread.data, value.messageIds]);

  const mine = useAsync(() => listProposals({ mine: true, kind: "deletion", limit: 200 }), [auth.user?.id], { enabled: !!auth.user });
  const limits = useMemo(() => (mine.data ? deletionLimits(mine.data, auth.now()) : null), [mine.data, auth]);
  const level = deletionLimitLevel(limits);

  const problems = deletionTargetProblems(messages, auth.user?.id);
  const selectedGround = grounds.find((g) => expandIri(g.iri) === expandIri(value.ground));

  const set = (patch: Partial<DeletionDraft>) => onChange({ ...value, ...patch });
  const removeId = (id: string) => set({ messageIds: value.messageIds.filter((x) => x !== id) });
  const addId = (id: string) => {
    if (value.messageIds.includes(id) || value.messageIds.length >= MAX_MESSAGES) return;
    set({ messageIds: [...value.messageIds, id] });
  };

  const addManual = async () => {
    const id = manualId.trim();
    setManualError(null);
    if (!id) return;
    if (value.messageIds.includes(id)) {
      setManualError("Bu mesaj zaten listede.");
      return;
    }
    setAdding(true);
    try {
      const m = await getMessage(id);
      const issues = deletionTargetProblems([...messages, m], auth.user?.id);
      if (issues.length) setManualError(issues[0]);
      else {
        addId(m.id);
        setManualId("");
      }
    } catch (e) {
      setManualError(e instanceof Error ? e.message : "Mesaj bulunamadı.");
    } finally {
      setAdding(false);
    }
  };

  const manualField = (
    <div className="del-manual">
      <Input
        label="Mesaj kimliğiyle ekle"
        value={manualId}
        onChange={(e) => setManualId(e.target.value)}
        error={manualError ?? undefined}
        hint={`Aynı tartışmadan, aynı yazarın mesajları; en çok ${MAX_MESSAGES} mesaj.`}
        className="mono"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void addManual();
          }
        }}
      />
      <Button icon="plus" onClick={() => void addManual()} loading={adding} disabled={!manualId.trim()}>
        Ekle
      </Button>
    </div>
  );
  const openRequests = mine.data?.filter((p) => !CLOSED_STATUSES.includes(p.status)) ?? [];

  return (
    <div className="del-form stack">
      <Alert tone="info" title="Tartışma silinmez" className="del-intro">
        <p className="mt-0">
          Talep kabul edilirse mesaj <strong>karartılır</strong>: yerinde mezar taşı kalır.
        </p>
        <Details summary="Karartma nasıl işler?" className="del-more">
          <p className="mt-0">
            Mesajın yerinde “[#K-… kararıyla gizlendi — gerekçe: …]” mezar taşı kalır, eski sürümler ve defterdeki içerik özeti korunur. Asıl metin
            yalnızca denetçiye (erişim kaydıyla) açıktır; mesajın yazarı karartılamayan bir cevap metni ekleyebilir. Talep reddedilirse herkese açık
            arşivlenir.
          </p>
        </Details>
      </Alert>

      <fieldset className="form-section">
        <legend>Hedef mesaj{value.messageIds.length > 1 ? "lar" : ""}</legend>
        {!value.messageIds.length ? (
          <p className="muted mt-0">
            Silme talebi genellikle tartışmadaki bir mesajın yanındaki “Silme talebi” bağlantısıyla başlatılır. Mesaj kimliğini biliyorsanız aşağıdan da
            ekleyebilirsiniz.
          </p>
        ) : null}
        {msgs.loading && !msgs.data ? <Spinner label="Mesajlar yükleniyor…" showLabel /> : null}
        {msgs.error ? <ErrorView error={msgs.error} title="Mesaj yüklenemedi" onRetry={msgs.reload} compact /> : null}
        {messages.length ? (
          <ul className="del-msgs">
            {messages.map((m) => (
              <li key={m.id} className="del-msg">
                <div className="del-msg-head">
                  <span className="mono muted small">#{m.seq}</span>
                  <UserLink id={m.authorId} nickname={m.authorNickname} />
                  <StanceBadge stance={m.stance} />
                  <Time at={m.createdAt} className="small muted" />
                  {m.visibility === "collapsed" ? <Badge tone="warning">Gözden geçiriliyor</Badge> : null}
                  {m.visibility === "hidden" || m.visibility === "sealed" ? <Badge tone="danger">Karartılmış</Badge> : null}
                </div>
                <p className="del-msg-body">{m.body != null ? truncate(m.body, 400) : <span className="muted">{m.tombstone ?? "Metin gösterilemiyor."}</span>}</p>
                <div className="row">
                  <Link className="small" to={m.threadType === "topic" ? routes.topic(m.threadId) : routes.proposal(m.threadId)}>
                    {m.threadType === "topic" ? "Konunun tartışmasına git" : "Önerinin tartışmasına git"}
                  </Link>
                  {m.pendingDeletionProposalId ? (
                    <span className="small">
                      <Link to={routes.proposal(m.pendingDeletionProposalId)}>Bu mesaj için zaten açık bir silme talebi var</Link>
                      {m.visibility === "collapsed" ? null : <span className="muted"> (kişisel veri ya da tehdit içeriyorsa acil talep yine açılabilir)</span>}
                    </span>
                  ) : null}
                  <Button size="sm" variant="ghost" icon="close" onClick={() => removeId(m.id)}>
                    Listeden çıkar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {problems.length ? (
          <Alert tone="error" title="Bu mesajlar için talep açılamaz">
            <ul className="mt-0">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {errors.messageIds ? (
          <div className="field-error" role="alert">
            {errors.messageIds}
          </div>
        ) : null}

        {siblings.length && value.messageIds.length < MAX_MESSAGES ? (
          <div className="stack-sm">
            <p className="small mt-0">
              <strong>@{first?.authorNickname}</strong> kullanıcısının bu tartışmadaki diğer mesajları (aynı talebe eklenebilir):
            </p>
            <ul className="del-siblings">
              {siblings.map((m) => (
                <li key={m.id}>
                  <span className="small">
                    <span className="mono muted">#{m.seq}</span> {truncate(m.body ?? "", 120)}
                  </span>
                  <Button size="sm" icon="plus" onClick={() => addId(m.id)}>
                    Ekle
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {startedWithTarget ? (
          <Details summary="Başka bir mesajı kimliğiyle ekle" className="del-manual-more">
            {manualField}
          </Details>
        ) : (
          manualField
        )}
      </fieldset>

      <fieldset className="form-section">
        <legend>Silme gerekçesi</legend>
        <RadioGroup
          label="Gerekçe"
          value={selectedGround ? selectedGround.iri : null}
          onChange={(v) => set({ ground: v })}
          error={errors.ground}
          required
          options={grounds.map((g) => {
            const invalid = isInvalidGround(g);
            return {
              value: g.iri,
              disabled: invalid,
              label: (
                <span className="del-ground">
                  <span className={cx(invalid && "del-ground-invalid")}>{g.label}</span>
                  {g.urgent ? (
                    // Turuncu: dikkat ve süre (kırmızı sonuç ve hata içindir). Anlamı ipucu satırında görünür metin olarak da yazar.
                    <Badge tone="warning" title="Talep anında mesaj daraltılır">
                      acil
                    </Badge>
                  ) : null}
                  {invalid ? (
                    <Badge tone="neutral" icon="close">
                      seçilemez
                    </Badge>
                  ) : null}
                </span>
              ),
              hint: invalid ? (
                <>
                  <strong>Değiştirilemez madde: görüş ayrılığı silme gerekçesi olamaz.</strong> Bir görüşe katılmamak, onu karartmak için yeterli değildir;
                  karşı görüşünüzü tartışmaya yazın.
                </>
              ) : g.urgent ? (
                <>
                  {g.description} <span className="del-urgent-note">Acil: talep açılınca mesaj hemen daraltılır.</span>
                </>
              ) : (
                g.description
              ),
            };
          })}
        />
        {selectedGround?.urgent ? (
          <Alert tone="warning" title="Acil gerekçe: mesaj talep anında daraltılır">
            Talep açıldığı anda mesaj silinmez ve gizlenmez; “Gözden geçiriliyor” etiketiyle katlanır. Daraltma karar çıkana kadar sürer; talep
            reddedilir, düşer ya da geri çekilirse kaldırılır. Bu yetki kötüye kullanılmamalıdır.
          </Alert>
        ) : null}
        {selectedGround?.sealed ? (
          <p className="small muted mt-0">Kişisel veri ifşası kabul edilirse mesaj mühürlenir: metni denetçiler de ancak erişim kaydıyla görebilir.</p>
        ) : null}
      </fieldset>

      <fieldset className="form-section">
        <legend>Açıklama</legend>
        <Textarea
          label="Talebin açıklaması"
          value={value.statement}
          onChange={(e) => set({ statement: e.target.value })}
          rows={5}
          maxLength={5000}
          showCount
          required
          error={errors.statement}
          hint="Mesajın neden bu gerekçeye girdiğini açıklayın (en az 20 karakter). Açıklama herkese açıktır; kişisel veri yazmayın."
        />
      </fieldset>

      {/* Kurallar: tek satır ve canlı sayaç (role=status; uyarı kutusu değil). Sınıra 1 kala ya da sınırda turuncu ve kurallar açık. */}
      <div className={cx("del-limits", level !== "ok" && "del-limits-warning")}>
        <p className="del-limits-line" role="status">
          <Icon name={level === "ok" ? "info" : "warning"} size={16} className="del-limits-icon" />
          <span>
            <strong>Kurallar ve sınırlar:</strong> {deletionLimitLine(limits)}
            {level === "near" ? <strong> · sınıra 1 talep kaldı</strong> : null}
          </span>
        </p>
        {level === "at" ? (
          <p className="del-limits-at">
            <strong>Sınıra ulaştınız;</strong> yeni talep sunucu tarafından reddedilecektir.
            {openRequests.length ? (
              <>
                {" "}
                Açık talepleriniz:{" "}
                {openRequests.map((p) => (
                  <Link key={p.id} to={routes.proposal(p.id)} className="del-ref">
                    {proposalRef(p.seq)}
                  </Link>
                ))}
              </>
            ) : null}
          </p>
        ) : null}
        <Details summary="Silme kuralları (4)" open={level !== "ok" ? true : undefined} className="del-rules">
          <ul className="del-rules-list">
            <li>
              Karar <strong>DEL</strong> katmanında oylanır: en az 2/3 onay, köprü testi ve mesaj yazarının kendi görüş kümesinde en az{" "}
              {formatPercent(0.5)} destek. Mesaj yazarına bildirim gider; tartışma süresinde mesajını kendisi düzenleyebilir.
            </li>
            <li>
              Aynı anda en çok {MAX_OPEN_DELETIONS} açık silme talebiniz olabilir; 24 saatte en çok {MAX_DELETIONS_PER_DAY} talep açabilirsiniz.
              {limits ? (
                <>
                  {" "}
                  Şu an: <strong>{limits.open}</strong>/{MAX_OPEN_DELETIONS} açık, son 24 saatte <strong>{limits.day}</strong>/{MAX_DELETIONS_PER_DAY}.
                </>
              ) : null}
            </li>
            <li>
              Bir mesaj için aynı anda tek bir silme talebi açık olabilir. Mevcut talep acil değilse kişisel veri ifşası ya da tehdit gerekçeli talep yine
              açılabilir ve mesaj hemen daraltılır; “Görüş ayrılığı” gibi geçersiz talepler başka talebi engellemez.
            </li>
            <li>
              Kendi kişisel verilerinizin silinmesi oylamaya konmaz; <Link to={profileHref("kvkk")}>Profil</Link> sayfasındaki KVKK bölümünden yapılır.
            </li>
          </ul>
        </Details>
      </div>
    </div>
  );
}

export default DeletionForm;
