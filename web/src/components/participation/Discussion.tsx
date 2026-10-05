// Tartışma bileşeni (konu ve öneri iş parçacıkları). İç içe yanıtlar, katılım bildirimleri, köprü skoru,
// karartılmış/daraltılmış mesajlar ve yeni mesaj formu. Mesajlar ASLA silinmez (mezar taşı + denetçi erişimi).
// Sıra: başlık 'Tartışma (n)' ve sıralama → tek satır istatistik → kapalı yazma kutusu (Composer) → mesajlar →
// 'Tartışma kuralları ve köprü skoru' açılırı EN ALTTA (köprü skoru notu da orada). Tartışma hiçbir zaman açılır içine alınmaz.
// Uzun tartışma (yüzlerce–binlerce mesaj): değişmeyen mesajın nesnesi yoklamada korunur, MessageItem memo'ludur ve oturum bağlamına
// tek tek abone olmaz (görüntüleyen bir kez hesaplanıp bağlamla verilir), geri çağırımlar kararlıdır; ilk ROOT_PAGE_SIZE ileti dizisi
// çizilir, fazlası "Daha fazla göster" ile açılır (derin bağlantı ve YZ alıntısı hedefin dizisini kendiliğinden açar).
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { MessageView, ThreadType } from "@forum/shared";
import { getThread, listProposals } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { useAsync } from "../../lib/useAsync";
import { Button, Details, EmptyState, ErrorView, Section, Select, Spinner } from "../../ui";
import { Composer } from "./Composer";
import { bridgeNote, discussionStats, newMessageCache, ROOT_PAGE_SIZE, rootIndexOf, stabilizeMessages, stanceSummary, visibleRootCount } from "./discussionLogic";
import { BRIDGE_EXPLANATION, DELETION_RULES, MessageItem, MessageViewerContext, messageViewerOf } from "./MessageItem";
import { messageAnchorId, REVEAL_MESSAGE_EVENT, scrollToMessage } from "./common";
import "./discussion.css";

const NO_MESSAGES: MessageView[] = [];

/** Bölüm açıklaması verilmezse kurallar açılırının ilk cümlesi olur (başlığın altında yer tutmaz). */
const DEFAULT_DESCRIPTION = "Tartışmalar silinmez; her mesajın özeti dağıtık deftere yazılır. Düzenlemeler yeni sürüm oluşturur.";

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

function DiscussionImpl({ threadType, threadId, title = "Tartışma", description, closedReason, onMessagesChange }: DiscussionProps) {
  const { data, error, loading, reload, setData } = useAsync(() => getThread(threadType, threadId), [threadType, threadId], { pollMs: 60_000 });
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>("old");
  const [params] = useSearchParams();
  const focusId = params.get("mesaj");
  const focusedOnce = useRef<string | null>(null);

  // Görüntüleyen bir kez (ilkel değerlerle) hesaplanır; oturum bağlamının 30/60 sn'lik yenilemeleri mesajları yeniden çizmez.
  const auth = useAuth();
  const viewerNow = messageViewerOf(auth);
  const viewer = useMemo(() => viewerNow, [viewerNow.id, viewerNow.loggedIn, viewerNow.verified, viewerNow.auditor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Yoklama her mesaj için yeni nesne getirir: değişmeyenin önceki nesnesi korunur (memo'lu MessageItem yeniden çizilmez).
  const cacheRef = useRef(newMessageCache(""));
  const messages = useMemo(() => {
    if (!data) return NO_MESSAGES;
    const key = `${threadType}:${threadId}`;
    if (cacheRef.current.key !== key) cacheRef.current = newMessageCache(key);
    return stabilizeMessages(cacheRef.current, data.messages);
  }, [data, threadType, threadId]);
  const hasPending = messages.some((m) => !!m.pendingDeletionProposalId);
  const deletions = useAsync(() => listProposals({ kind: "deletion", status: "open", limit: 200 }), [hasPending], { enabled: hasPending });
  const deletionSeq = useMemo(() => new Map((deletions.data ?? []).map((p) => [p.id, p.seq] as const)), [deletions.data]);

  // Yalnız mesajlar gerçekten değişince bildirilir (değişmeyen yoklama üst sayfayı yeniden çizdirmez).
  useEffect(() => {
    if (messages !== NO_MESSAGES) onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  useEffect(() => {
    if (!focusId || !data || focusedOnce.current === focusId) return;
    focusedOnce.current = focusId;
    window.setTimeout(() => scrollToMessage(focusId), 150);
  }, [focusId, data]);

  const upsert = useCallback(
    (m: MessageView) => {
      setData((prev) => {
        if (!prev) return prev;
        const exists = prev.messages.some((x) => x.id === m.id);
        return { ...prev, messages: exists ? prev.messages.map((x) => (x.id === m.id ? m : x)) : [...prev.messages, m] };
      });
    },
    [setData],
  );
  const toggleReply = useCallback((x: MessageView) => setReplyTo((cur) => (cur === x.id ? null : x.id)), []);
  const closeReply = useCallback(() => setReplyTo(null), []);
  const replyDone = useCallback(
    (nm: MessageView) => {
      setReplyTo(null);
      upsert(nm);
    },
    [upsert],
  );

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

  const stats = useMemo(() => {
    const { counts, hidden } = discussionStats(messages);
    return stanceSummary(counts, hidden);
  }, [messages]);
  const bridgeHint = bridgeNote(
    messages.length,
    messages.some((m) => m.bridgingScore !== null),
  );

  // Sayfalama: ilk ROOT_PAGE_SIZE ileti dizisi. Derin bağlantının (?mesaj=) ve YZ alıntısının hedefi kendi dizisine kadar açılır.
  const [limit, setLimit] = useState(ROOT_PAGE_SIZE);
  useEffect(() => setLimit(ROOT_PAGE_SIZE), [threadType, threadId]);
  const focusRoot = focusId ? rootIndexOf(focusId, roots, byId) : -1;
  const shownCount = visibleRootCount(roots.length, limit, focusRoot);
  const remaining = roots.length - shownCount;
  const latest = useRef({ roots, byId });
  latest.current = { roots, byId };
  useEffect(() => {
    const onReveal = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      const { roots: rs, byId: map } = latest.current;
      const i = id && map.has(id) ? rootIndexOf(id, rs, map) : -1;
      if (i < 0) return;
      e.preventDefault();
      setLimit((l) => Math.max(l, i + 1));
    };
    window.addEventListener(REVEAL_MESSAGE_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_MESSAGE_EVENT, onReveal);
  }, []);
  // "Daha fazla göster" sonrası odak, açılan ilk yeni mesaja taşınır (düğme son sayfada kalkar; odak belgeye düşmesin).
  const focusAfterMore = useRef<string | null>(null);
  useEffect(() => {
    const id = focusAfterMore.current;
    if (!id) return;
    focusAfterMore.current = null;
    document.getElementById(messageAnchorId(id))?.querySelector<HTMLElement>(".msg-body, .msg-tombstone")?.focus();
  }, [shownCount]);
  const showMore = () => {
    focusAfterMore.current = roots[shownCount]?.id ?? null;
    setLimit(shownCount + ROOT_PAGE_SIZE);
  };

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
          onReply={toggleReply}
          canReply={!closedReason}
        />
        {replyTo === m.id ? (
          <div className="msg-reply-box">
            <Composer threadType={threadType} threadId={threadId} mode="reply" parent={m} autoFocus onCancel={closeReply} onDone={replyDone} />
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
      description={description}
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
      {data && stats ? <p className="small muted discussion-stats">{stats}</p> : null}

      <div className="discussion-composer">
        <Composer threadType={threadType} threadId={threadId} closedReason={closedReason} onDone={upsert} />
      </div>

      {loading && !data ? <Spinner block label="Tartışma yükleniyor…" /> : null}
      {error && !data ? <ErrorView error={error} onRetry={reload} /> : null}

      {data && messages.length ? (
        <MessageViewerContext.Provider value={viewer}>
          <ul className="msg-thread">{roots.slice(0, shownCount).map((m) => renderNode(m, 0))}</ul>
        </MessageViewerContext.Provider>
      ) : null}
      {data && remaining > 0 ? (
        <div className="discussion-more">
          <Button onClick={showMore} icon="chevronDown">
            Daha fazla göster ({remaining} ileti dizisi daha)
          </Button>
        </div>
      ) : null}
      {data && !messages.length ? (
        <EmptyState title="Henüz mesaj yok" icon="topics">
          <p>{closedReason ? "Bu tartışmada henüz mesaj yazılmadı." : "İlk görüşü siz yazın: tutumunuzu seçip gerekçenizi paylaşın."}</p>
        </EmptyState>
      ) : null}

      <Details summary="Tartışma kuralları ve köprü skoru" className="discussion-guide">
        <div className="stack-sm">
          {description ? null : <p className="small mt-0">{DEFAULT_DESCRIPTION}</p>}
          <ul className="small stack-sm discussion-rules">
            <li>{BRIDGE_EXPLANATION}</li>
            {bridgeHint ? <li>{bridgeHint}</li> : null}
            <li>{DELETION_RULES}</li>
            <li>Yapay zekâ uyarıları yalnızca danışma niteliğindedir; hiçbir mesajı gizlemez.</li>
            <li>Kendi mesajınıza katılım bildiremezsiniz; katılım bildirimleri görüş gruplarını belirlemek için de kullanılır.</li>
          </ul>
        </div>
      </Details>
    </Section>
  );
}

/** memo: üst sayfanın 30 sn'lik yoklaması (props değişmedikçe) tartışmayı yeniden çizmez. */
export const Discussion = memo(DiscussionImpl);

export default Discussion;
