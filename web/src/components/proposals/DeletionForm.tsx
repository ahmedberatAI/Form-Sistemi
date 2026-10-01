// Silme (karartma) talebi formu: hedef mesaj(lar), silme gerekçesi, açıklama.
// "Görüş ayrılığı" değiştirilemez madde gereği seçilemez (devre dışı ve açıklamalı gösterilir).
// Aynı tartışmadaki aynı yazarın birden çok mesajı tek talepte toplanabilir.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DELETION_GROUND_VOCAB, expandIri, fy, type GroundInfo, type MessageView } from "@forum/shared";
import { getMessage, getThread, listProposals } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { useOntology } from "../../lib/categories";
import { formatPercent, proposalRef, truncate } from "../../lib/format";
import { routes } from "../../lib/routes";
import { useAsync } from "../../lib/useAsync";
import { Alert, Badge, Button, cx, ErrorView, Input, RadioGroup, Spinner, StanceBadge, Textarea, Time } from "../../ui";
import { UserLink } from "../UserLink";

export const GORUS_AYRILIGI_IRI = fy("GorusAyriligi");
export const MAX_OPEN_DELETIONS = 3;
export const MAX_DELETIONS_PER_DAY = 5;
const MAX_MESSAGES = 20;
const DAY_MS = 86_400_000;

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
  const limits = useMemo(() => {
    if (!mine.data) return null;
    const now = auth.now();
    const open = mine.data.filter((p) => !["enacted", "rejected", "withdrawn", "expired", "inadmissible"].includes(p.status)).length;
    const day = mine.data.filter((p) => p.createdAt > now - DAY_MS).length;
    return { open, day };
  }, [mine.data, auth]);

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

  return (
    <div className="del-form stack">
      <Alert tone="info" title="Tartışma silinmez">
        Talep kabul edilirse mesaj <strong>karartılır</strong>: yerinde “[#K-… kararıyla gizlendi — gerekçe: …]” mezar taşı kalır, eski sürümler ve
        defterdeki içerik özeti korunur. Asıl metin yalnızca denetçiye (erişim kaydıyla) açıktır; mesajın yazarı karartılamayan bir cevap metni
        ekleyebilir. Talep reddedilirse herkese açık arşivlenir.
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
                    <Badge tone="danger" title="Talep anında mesaj daraltılır">
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

      <Alert tone="info" title="Kurallar ve sınırlar">
        <ul className="mt-0">
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
            Kendi kişisel verilerinizin silinmesi oylamaya konmaz; <Link to={routes.profile()}>Profil</Link> sayfasındaki KVKK bölümünden yapılır.
          </li>
        </ul>
        {mine.data && limits && (limits.open >= MAX_OPEN_DELETIONS || limits.day >= MAX_DELETIONS_PER_DAY) ? (
          <p className="mt-0">
            <strong>Sınıra ulaştınız;</strong> yeni talep sunucu tarafından reddedilecektir. Açık talepleriniz:{" "}
            {mine.data
              .filter((p) => !["enacted", "rejected", "withdrawn", "expired", "inadmissible"].includes(p.status))
              .map((p) => (
                <Link key={p.id} to={routes.proposal(p.id)} className="del-ref">
                  {proposalRef(p.seq)}
                </Link>
              ))}
          </p>
        ) : null}
      </Alert>
    </div>
  );
}

export default DeletionForm;
