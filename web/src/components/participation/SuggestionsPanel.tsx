// Öneri içi metin önerileri: tartışma evresinde herkes değişiklik önerebilir (mevcut metin önceden doldurulur);
// yazar kabul ederse yeni sürüm oluşur. Reddedilen öneriler herkese açık kalır ve ayrı öneri olarak açılabilir.
// Yazar karar vermeden oylama başlarsa (ya da öneri kapanırsa) açık öneriler "Karar verilmeden kapandı" olur; bunlar da
// herkese açık kalır ve ayrı öneri olarak açılabilir.
// 'Eylem önce': [Metin önerisi gönder] düğmesi listenin önünde durur; boş durum tek satırdır (açıklama 'Metin önerileri nasıl
// işler?' açılırında); 3'ten uzun listede ilk 3 görünür, gerisi 'Tümünü göster (n)' ile açılır (yazarın karar bekleyen önerileri
// her zaman görünür; 'Tam' görünümde liste baştan tamdır).
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { TEXT_LIMITS, type ProposalDetail, type Suggestion } from "@forum/shared";
import { addSuggestion, decideSuggestion } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { useDetailLevel } from "../../lib/detailLevel";
import { routes } from "../../lib/routes";
import { useAction } from "../../lib/useAsync";
import { Badge, Button, CopyButton, Details, DiffView, LinkButton, Textarea, Time, useConfirm } from "../../ui";
import { UserLink } from "../UserLink";
import { piiFromError, PiiNotice, SubHeading } from "./common";
import "./panels.css";

const STATUS: Record<Suggestion["status"], { label: string; tone: "info" | "success" | "danger" | "neutral"; title?: string }> = {
  open: { label: "Yazarın kararını bekliyor", tone: "info" },
  accepted: { label: "Kabul edildi", tone: "success" },
  rejected: { label: "Reddedildi (herkese açık)", tone: "danger" },
  lapsed: { label: "Karar verilmeden kapandı", tone: "neutral", title: "Yazar karar vermeden tartışma evresi bitti; metin oylama başlarken kilitlendi." },
};

/** Listede ilk görünen metin önerisi sayısı; gerisi 'Tümünü göster (n)' ile. */
export const SUGGESTION_PREVIEW = 3;

/**
 * Kısaltılmış listeyi seçer: ilk `limit` öneri ve `keep` diyen (ör. yazarın karar bekleyen) öneriler görünür, sıra korunur.
 * Açıksa ya da liste `limit`'ten uzun değilse hepsi görünür.
 */
export function previewSuggestions<T>(list: readonly T[], opts: { expanded: boolean; keep?: (s: T) => boolean; limit?: number }): { shown: T[]; hidden: number } {
  const limit = opts.limit ?? SUGGESTION_PREVIEW;
  if (opts.expanded || list.length <= limit) return { shown: [...list], hidden: 0 };
  const shown = list.filter((s, i) => i < limit || !!opts.keep?.(s));
  return { shown, hidden: list.length - shown.length };
}

export interface SuggestionsPanelProps {
  proposal: ProposalDetail;
  /** Alt başlığı göster (kart başlığı zaten varsa false) */
  showHeading?: boolean;
  onUpdated: (p: ProposalDetail) => void;
  onAdded: (s: Suggestion) => void;
}

export function SuggestionForm({ proposal: p, onAdded, lead }: Pick<SuggestionsPanelProps, "proposal" | "onAdded"> & { lead?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(p.body);
  // Odak yönetimi: form açılınca metin alanına (autoFocus), 'Vazgeç' ya da gönderimle kapanınca tetikleyen düğmeye döner.
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) trigger.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const send = useAction(() => addSuggestion(p.id, body.trim()), {
    success: "Metin öneriniz yazara iletildi.",
    toastError: false,
    onSuccess: (s) => {
      setOpen(false);
      setBody(p.body);
      onAdded(s);
    },
  });
  const pii = piiFromError(send.error);

  if (!open) {
    return (
      <div className="panel-bar">
        {lead ? <p className="small muted">{lead}</p> : null}
        <Button ref={trigger} icon="proposals" onClick={() => setOpen(true)}>
          Metin önerisi gönder
        </Button>
      </div>
    );
  }
  const changed = body.trim() !== p.body.trim();
  return (
    <form
      className="stack-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void send.run();
      }}
    >
      <Textarea
        label="Önerdiğiniz metin"
        hint={`Mevcut metin önceden dolduruldu; değiştirmek istediğiniz yerleri düzenleyin (${TEXT_LIMITS.suggestion.min}–${TEXT_LIMITS.suggestion.max} karakter). Yazar kabul ederse yeni sürüm olur ve adınız anılır.`}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          send.reset();
        }}
        rows={10}
        maxLength={TEXT_LIMITS.suggestion.max}
        showCount
        autoFocus
      />
      {changed ? (
        <Details summary="Değişikliğinizi önizleyin" open>
          <DiffView before={p.body} after={body.trim()} context={2} label="Önerilen değişiklik" />
        </Details>
      ) : null}
      {pii ? <PiiNotice findings={pii} /> : send.error ? <p className="field-error">{(send.error as Error).message}</p> : null}
      <div className="form-actions">
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Vazgeç
        </Button>
        <Button type="submit" variant="primary" loading={send.loading} disabled={!changed || body.trim().length < 10}>
          Öneriyi gönder
        </Button>
      </div>
    </form>
  );
}

export function SuggestionsPanel({ proposal: p, onUpdated, onAdded, showHeading = true }: SuggestionsPanelProps) {
  const auth = useAuth();
  const confirm = useConfirm();
  const listId = useId();
  const { full } = useDetailLevel();
  // null: kullanıcı dokunmadı → görünüm yoğunluğuna uyar ('Tam' kipte bütün öneriler çizilir)
  const [choice, setChoice] = useState<boolean | null>(null);
  const expanded = choice ?? full;
  const isAuthor = auth.user?.id === p.authorId;
  const canDecide = isAuthor && (p.status === "deliberation" || p.status === "reconciliation");
  const canPropose = p.status === "deliberation" && auth.can("V") && !isAuthor;
  const decide = useAction((sid: string, d: "accept" | "reject") => decideSuggestion(p.id, sid, d), {
    success: (r) => `Karar kaydedildi (güncel sürüm ${r.version}).`,
    onSuccess: onUpdated,
  });
  const list = p.suggestions.slice().sort((a, b) => b.createdAt - a.createdAt);
  // Yazarın karar vermesi gereken öneriler kısaltmada gizlenmez.
  const { shown, hidden } = previewSuggestions(list, { expanded, keep: (s) => canDecide && s.status === "open" });
  const showToggle = list.length > SUGGESTION_PREVIEW && (expanded || hidden > 0);

  return (
    <div className="stack">
      {canPropose && list.length ? <SuggestionForm proposal={p} onAdded={onAdded} /> : null}
      {showHeading ? <SubHeading>Metin önerileri ({list.length})</SubHeading> : null}
      {!list.length ? (
        <div className="stack-sm">
          {canPropose ? <SuggestionForm proposal={p} onAdded={onAdded} lead="Henüz metin önerisi yok." /> : <p className="small muted">Henüz metin önerisi yok.</p>}
          <Details summary="Metin önerileri nasıl işler?" className="panel-details">
            <p className="small">
              Tartışma evresinde herkes metne değişiklik önerebilir; yazarın tek başına veto hakkı yoktur — reddedilen öneri ayrı bir öneri olarak açılabilir.
            </p>
          </Details>
        </div>
      ) : (
        <>
          <ul className="list" id={listId}>
            {shown.map((s) => {
              const via = p.versions.find((v) => v.viaSuggestionId === s.id);
              return (
                <li key={s.id} className="list-item stack-sm">
                  <div className="row small">
                    <UserLink id={s.authorId} nickname={s.authorNickname} />
                    <Time at={s.createdAt} className="muted" />
                    <Badge tone={STATUS[s.status].tone} title={STATUS[s.status].title}>
                      {STATUS[s.status].label}
                    </Badge>
                    {via ? <span className="muted">sürüm {via.version} olarak eklendi</span> : null}
                  </div>
                  <Details summary={s.status === "accepted" ? "Önerilen metin" : "Önerilen değişiklik (güncel metinle farkı)"}>
                    <DiffView before={p.body} after={s.body} context={2} label="Önerilen değişiklik" />
                  </Details>
                  {canDecide && s.status === "open" ? (
                    <div className="row">
                      <Button
                        size="sm"
                        variant="primary"
                        loading={decide.loading}
                        onClick={async () => {
                          if (await confirm({ title: "Öneriyi kabul et", message: "Önerilen metin yeni sürüm olarak uygulanır ve yeniden denetlenir; öneren kişi sürüm geçmişinde anılır.", confirmLabel: "Kabul et" }))
                            void decide.run(s.id, "accept");
                        }}
                      >
                        Kabul et (yeni sürüm)
                      </Button>
                      <Button size="sm" variant="secondary" loading={decide.loading} onClick={() => void decide.run(s.id, "reject")}>
                        Reddet
                      </Button>
                    </div>
                  ) : null}
                  {s.status === "rejected" || s.status === "lapsed" ? (
                    <div className="row small">
                      <span className="muted">
                        {s.status === "lapsed" ? "Yazar karar vermeden tartışma evresi bitti. " : ""}Öneren kişi bunu ayrı bir öneri olarak açabilir.
                      </span>
                      <CopyButton text={s.body} label="Metni kopyala" />
                      <LinkButton size="sm" to={routes.newProposal({ kind: p.kind, parentTopicId: p.parentTopicId ?? undefined })}>
                        Ayrı öneri olarak aç
                      </LinkButton>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {showToggle ? (
            <Button size="sm" variant="ghost" className="suggestions-more" aria-expanded={expanded} aria-controls={listId} onClick={() => setChoice(!expanded)}>
              {expanded ? "Daha az göster" : `Tümünü göster (${list.length})`}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
