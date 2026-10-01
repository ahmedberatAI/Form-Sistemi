// Tartışma bileşeni (konu ve öneri iş parçacıkları). İç içe yanıtlar, katılım bildirimleri, köprü skoru,
// karartılmış/daraltılmış mesajlar ve yeni mesaj formu. Mesajlar ASLA silinmez (mezar taşı + denetçi erişimi).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { MessageView, Stance, ThreadType } from "@forum/shared";
import { STANCE_LABELS } from "@forum/shared";
import { getThread, listProposals } from "../../api/endpoints";
import { useAsync } from "../../lib/useAsync";
import { Details, EmptyState, ErrorView, Section, Select, Spinner } from "../../ui";
import { Composer } from "./Composer";
import { BRIDGE_EXPLANATION, DELETION_RULES, MessageItem } from "./MessageItem";
import { scrollToMessage } from "./common";

type SortMode = "old" | "new" | "bridge";

export interface DiscussionProps {
  threadType: ThreadType;
  threadId: string;
  title?: string;
  description?: ReactNode;
  /** Yeni mesaj yazma kapalıysa gerekçe (ör. taslak öneri, arşiv konu) */
  closedReason?: string | null;
  /** Mesajlar yüklendiğinde/değiştiğinde (YZ özetindeki alıntıları eşlemek için) */
  onMessagesChange?: (messages: MessageView[]) => void;
}

export function Discussion({ threadType, threadId, title = "Tartışma", description, closedReason, onMessagesChange }: DiscussionProps) {
  const { data, error, loading, reload, setData } = useAsync(() => getThread(threadType, threadId), [threadType, threadId], { pollMs: 60_000 });
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>("old");
  const [params] = useSearchParams();
  const focusId = params.get("mesaj");
  const focusedOnce = useRef<string | null>(null);

  const messages = useMemo(() => data?.messages ?? [], [data]);
  const hasPending = messages.some((m) => !!m.pendingDeletionProposalId);
  const deletions = useAsync(() => listProposals({ kind: "deletion", status: "open", limit: 200 }), [hasPending], { enabled: hasPending });
  const deletionSeq = useMemo(() => new Map((deletions.data ?? []).map((p) => [p.id, p.seq] as const)), [deletions.data]);

  useEffect(() => {
    if (data) onMessagesChange?.(data.messages);
  }, [data, onMessagesChange]);

  useEffect(() => {
    if (!focusId || !data || focusedOnce.current === focusId) return;
    focusedOnce.current = focusId;
    window.setTimeout(() => scrollToMessage(focusId), 150);
  }, [focusId, data]);

  const upsert = (m: MessageView) => {
    setData((prev) => {
      if (!prev) return prev;
      const exists = prev.messages.some((x) => x.id === m.id);
      return { ...prev, messages: exists ? prev.messages.map((x) => (x.id === m.id ? m : x)) : [...prev.messages, m] };
    });
  };

  const { roots, children, byId } = useMemo(() => {
    const byId = new Map(messages.map((m) => [m.id, m] as const));
    const children = new Map<string, MessageView[]>();
    const roots: MessageView[] = [];
    for (const m of messages.slice().sort((a, b) => a.seq - b.seq)) {
      if (m.parentId && byId.has(m.parentId)) {
        const list = children.get(m.parentId) ?? [];
        list.push(m);
        children.set(m.parentId, list);
      } else roots.push(m);
    }
    if (sort === "new") roots.reverse();
    else if (sort === "bridge") roots.sort((a, b) => (b.bridgingScore ?? -1) - (a.bridgingScore ?? -1) || a.seq - b.seq);
    return { roots, children, byId };
  }, [messages, sort]);

  const stanceCounts = useMemo(() => {
    const c: Record<Stance, number> = { pro: 0, con: 0, neutral: 0, question: 0 };
    for (const m of messages) if (m.visibility !== "hidden" && m.visibility !== "sealed") c[m.stance]++;
    return c;
  }, [messages]);
  const hiddenCount = messages.filter((m) => m.visibility === "hidden" || m.visibility === "sealed").length;
  const anyBridge = messages.some((m) => m.bridgingScore !== null);

  const renderNode = (m: MessageView, depth: number): ReactNode => {
    const kids = children.get(m.id) ?? [];
    const parent = m.parentId ? byId.get(m.parentId) : undefined;
    return (
      <li key={m.id} className="msg-node">
        <MessageItem
          message={m}
          parentNickname={depth >= 2 ? (parent?.authorNickname ?? null) : null}
          focused={focusId === m.id}
          deletionSeq={m.pendingDeletionProposalId ? (deletionSeq.get(m.pendingDeletionProposalId) ?? null) : null}
          onUpdate={upsert}
          onReply={(x) => setReplyTo((cur) => (cur === x.id ? null : x.id))}
          canReply={!closedReason}
        />
        {replyTo === m.id ? (
          <div className="msg-reply-box">
            <Composer
              threadType={threadType}
              threadId={threadId}
              mode="reply"
              parent={m}
              autoFocus
              onCancel={() => setReplyTo(null)}
              onDone={(nm) => {
                setReplyTo(null);
                upsert(nm);
              }}
            />
          </div>
        ) : null}
        {kids.length ? <ul className="msg-children">{kids.map((k) => renderNode(k, depth + 1))}</ul> : null}
      </li>
    );
  };

  return (
    <Section
      title={`${title}${data ? ` (${messages.length})` : ""}`}
      id="tartisma"
      description={description ?? "Tartışmalar silinmez; her mesajın özeti dağıtık deftere yazılır. Düzenlemeler yeni sürüm oluşturur."}
      actions={
        messages.length > 1 ? (
          <Select
            label="Sıralama"
            hideLabel
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            options={[
              { value: "old", label: "Eskiden yeniye" },
              { value: "new", label: "Yeniden eskiye" },
              { value: "bridge", label: "Köprü skoru yüksek önce" },
            ]}
          />
        ) : null
      }
    >
      <Details summary="Tartışma kuralları ve köprü skoru">
        <ul className="small stack-sm discussion-rules">
          <li>{BRIDGE_EXPLANATION}</li>
          <li>{DELETION_RULES}</li>
          <li>Yapay zekâ uyarıları yalnızca danışma niteliğindedir; hiçbir mesajı gizlemez.</li>
          <li>Kendi mesajınıza katılım bildiremezsiniz; katılım bildirimleri görüş gruplarını belirlemek için de kullanılır.</li>
        </ul>
      </Details>

      <div className="discussion-composer">
        <Composer threadType={threadType} threadId={threadId} closedReason={closedReason} onDone={upsert} />
      </div>

      {loading && !data ? <Spinner block label="Tartışma yükleniyor…" /> : null}
      {error && !data ? <ErrorView error={error} onRetry={reload} /> : null}

      {data && messages.length ? (
        <>
          <p className="small muted discussion-stats">
            {(Object.keys(stanceCounts) as Stance[]).map((s) => `${STANCE_LABELS[s]}: ${stanceCounts[s]}`).join(" · ")}
            {hiddenCount ? ` · Karar ile gizlenen: ${hiddenCount}` : ""}
            {!anyBridge ? " · Köprü skoru, en az iki anlamlı görüş grubu oluşunca hesaplanır." : ""}
          </p>
          <ul className="msg-thread">{roots.map((m) => renderNode(m, 0))}</ul>
        </>
      ) : null}
      {data && !messages.length ? (
        <EmptyState title="Henüz mesaj yok" icon="topics">
          <p>{closedReason ? "Bu tartışmada henüz mesaj yazılmadı." : "İlk görüşü siz yazın: tutumunuzu seçip gerekçenizi paylaşın."}</p>
        </EmptyState>
      ) : null}
    </Section>
  );
}

export default Discussion;
