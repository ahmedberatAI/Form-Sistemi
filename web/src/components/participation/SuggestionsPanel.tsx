// Öneri içi metin önerileri: tartışma evresinde herkes değişiklik önerebilir (mevcut metin önceden doldurulur);
// yazar kabul ederse yeni sürüm oluşur. Reddedilen öneriler herkese açık kalır ve ayrı öneri olarak açılabilir.
import { useState } from "react";
import type { ProposalDetail, Suggestion } from "@forum/shared";
import { addSuggestion, decideSuggestion } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { routes } from "../../lib/routes";
import { useAction } from "../../lib/useAsync";
import { Badge, Button, CopyButton, Details, DiffView, EmptyState, LinkButton, Textarea, Time, useConfirm } from "../../ui";
import { UserLink } from "../UserLink";
import { piiFromError, PiiNotice, SubHeading } from "./common";

const STATUS: Record<Suggestion["status"], { label: string; tone: "info" | "success" | "danger" }> = {
  open: { label: "Yazarın kararını bekliyor", tone: "info" },
  accepted: { label: "Kabul edildi", tone: "success" },
  rejected: { label: "Reddedildi (herkese açık)", tone: "danger" },
};

export interface SuggestionsPanelProps {
  proposal: ProposalDetail;
  onUpdated: (p: ProposalDetail) => void;
  onAdded: (s: Suggestion) => void;
}

export function SuggestionForm({ proposal: p, onAdded }: Pick<SuggestionsPanelProps, "proposal" | "onAdded">) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(p.body);
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
      <Button icon="proposals" onClick={() => setOpen(true)}>
        Metin önerisi gönder
      </Button>
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
        hint="Mevcut metin önceden dolduruldu; değiştirmek istediğiniz yerleri düzenleyin (10–20000 karakter). Yazar kabul ederse yeni sürüm olur ve adınız anılır."
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          send.reset();
        }}
        rows={10}
        maxLength={20000}
        showCount
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

export function SuggestionsPanel({ proposal: p, onUpdated, onAdded }: SuggestionsPanelProps) {
  const auth = useAuth();
  const confirm = useConfirm();
  const isAuthor = auth.user?.id === p.authorId;
  const canDecide = isAuthor && (p.status === "deliberation" || p.status === "reconciliation");
  const decide = useAction((sid: string, d: "accept" | "reject") => decideSuggestion(p.id, sid, d), {
    success: (r) => `Karar kaydedildi (güncel sürüm ${r.version}).`,
    onSuccess: onUpdated,
  });
  const list = p.suggestions.slice().sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="stack">
      {p.status === "deliberation" && auth.can("V") && !isAuthor ? <SuggestionForm proposal={p} onAdded={onAdded} /> : null}
      <SubHeading>Metin önerileri ({list.length})</SubHeading>
      {!list.length ? (
        <EmptyState title="Henüz metin önerisi yok" icon="proposals">
          <p>Tartışma evresinde herkes metne değişiklik önerebilir; yazarın tek başına veto hakkı yoktur — reddedilen öneri ayrı bir öneri olarak açılabilir.</p>
        </EmptyState>
      ) : (
        <ul className="list">
          {list.map((s) => {
            const via = p.versions.find((v) => v.viaSuggestionId === s.id);
            return (
              <li key={s.id} className="list-item stack-sm">
                <div className="row small">
                  <UserLink id={s.authorId} nickname={s.authorNickname} />
                  <Time at={s.createdAt} className="muted" />
                  <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
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
                {s.status === "rejected" ? (
                  <div className="row small">
                    <span className="muted">Öneren kişi bunu ayrı bir öneri olarak açabilir.</span>
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
      )}
    </div>
  );
}
