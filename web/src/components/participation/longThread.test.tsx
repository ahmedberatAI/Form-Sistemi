// Uzun tartışma başarımı (2000 mesajlı öneride her yoklamada saniyelerce donma): değişmeyen mesaj nesnesi yoklamada korunur,
// MessageItem memo'ludur ve oturum bağlamına tek tek abone olmaz, ilk ROOT_PAGE_SIZE ileti dizisi çizilir. Ayrıca ön denetim sonucu
// ekran okuyucuya duyurulur (WCAG 4.1.3).
import type { MessagePrecheckResponse, MessageView } from "@forum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { DetailLevelProvider } from "../../lib/detailLevel";
import { ToastProvider } from "../../ui/Toast";
import { precheckAnnouncement } from "./Composer";
import { newMessageCache, ROOT_PAGE_SIZE, rootIndexOf, stabilizeMessages, visibleRootCount } from "./discussionLogic";
import { MessageItem, MessageViewerContext, messageViewerOf } from "./MessageItem";

const auth = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => {
    auth.calls++;
    return { user: { id: "u9" }, can: () => true, now: () => Date.UTC(2026, 9, 2) };
  },
  useServerNow: () => () => Date.UTC(2026, 9, 2),
}));

const msg = (id: string, over: Partial<MessageView> = {}): MessageView => ({
  id,
  seq: Number(id.replace(/\D/g, "")) || 1,
  threadType: "proposal",
  threadId: "p1",
  parentId: null,
  authorId: "u1",
  authorNickname: "ayse",
  stance: "pro",
  body: `Mesaj ${id}`,
  version: 1,
  visibility: "visible",
  tombstone: null,
  hiddenByProposalId: null,
  rebuttal: null,
  aiFlag: null,
  endorsements: { agree: 0, disagree: 0, mine: 0 },
  bridgingScore: null,
  createdAt: Date.UTC(2026, 9, 1),
  updatedAt: Date.UTC(2026, 9, 1),
  contentHash: "a".repeat(64),
  ledgerTx: null,
  pendingDeletionProposalId: null,
  ...over,
});

describe("stabilizeMessages: yoklamada değişmeyen mesajın nesnesi korunur", () => {
  it("aynı içerikli yeni nesneler gelince önceki nesneler ve DİZİNİN KENDİSİ döner (yeniden çizim ve üst bildirim yok)", () => {
    const cache = newMessageCache("proposal:p1");
    const first = stabilizeMessages(cache, [msg("m1"), msg("m2")]);
    const polled = stabilizeMessages(cache, [msg("m1"), msg("m2")]); // sunucudan gelen yeni (eşit) nesneler
    expect(polled).toBe(first);
    expect(polled[0]).toBe(first[0]);
  });

  it("yalnız değişen mesaj yeni nesne olur; ötekiler aynı nesne kalır", () => {
    const cache = newMessageCache("k");
    const first = stabilizeMessages(cache, [msg("m1"), msg("m2"), msg("m3")]);
    const next = stabilizeMessages(cache, [msg("m1"), msg("m2", { endorsements: { agree: 1, disagree: 0, mine: 1 } }), msg("m3")]);
    expect(next).not.toBe(first);
    expect(next[0]).toBe(first[0]);
    expect(next[1]).not.toBe(first[1]);
    expect(next[2]).toBe(first[2]);
  });

  it("yeni mesaj, silinen mesaj ve sıra değişimi değişiklik sayılır", () => {
    const cache = newMessageCache("k");
    const first = stabilizeMessages(cache, [msg("m1"), msg("m2")]);
    expect(stabilizeMessages(cache, [msg("m1"), msg("m2"), msg("m3")])).not.toBe(first);
    const two = stabilizeMessages(cache, [msg("m1"), msg("m2")]);
    expect(two).toHaveLength(2);
    expect(stabilizeMessages(cache, [msg("m2"), msg("m1")])).not.toBe(two);
  });
});

describe("sayfalama", () => {
  const roots = Array.from({ length: 120 }, (_, i) => msg(`r${i + 1}`));
  const reply = msg("x1", { parentId: "r90" });
  const deep = msg("x2", { parentId: "x1" });
  const byId = new Map([...roots, reply, deep].map((m) => [m.id, m] as const));

  it("ilk ROOT_PAGE_SIZE ileti dizisi çizilir; azsa hepsi", () => {
    expect(ROOT_PAGE_SIZE).toBe(50);
    expect(visibleRootCount(120, ROOT_PAGE_SIZE)).toBe(50);
    expect(visibleRootCount(12, ROOT_PAGE_SIZE)).toBe(12);
  });

  it("derin bağlantı (?mesaj=) ya da alıntı hedefi kendi dizisine kadar açılır (yanıtın yanıtı da)", () => {
    expect(rootIndexOf("x2", roots, byId)).toBe(89);
    expect(visibleRootCount(120, ROOT_PAGE_SIZE, rootIndexOf("x2", roots, byId))).toBe(90);
    expect(rootIndexOf("yok", roots, byId)).toBe(-1);
    expect(visibleRootCount(120, ROOT_PAGE_SIZE, -1)).toBe(50);
  });
});

describe("MessageItem: memo ve görüntüleyen bağlamı", () => {
  const render = (el: React.ReactElement) =>
    renderToStaticMarkup(
      <DetailLevelProvider>
        <ToastProvider>
          <MemoryRouter>{el}</MemoryRouter>
        </ToastProvider>
      </DetailLevelProvider>,
    );

  it("memo'lu bileşendir (değişmeyen props'la yeniden çizilmez)", () => {
    expect((MessageItem as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
  });

  it("tartışma görüntüleyeni bağlamla verince mesaj oturum bağlamına (useAuth) abone olmaz", () => {
    auth.calls = 0;
    const viewer = messageViewerOf({ user: { id: "u9" }, can: () => true });
    const html = render(
      <MessageViewerContext.Provider value={viewer}>
        {Array.from({ length: 20 }, (_, i) => (
          <MessageItem key={i} message={msg(`m${i}`)} onUpdate={() => undefined} onReply={() => undefined} />
        ))}
      </MessageViewerContext.Provider>,
    );
    expect(auth.calls).toBe(0);
    expect(html.split("Katılıyorum").length - 1).toBe(20);
    expect(html).toContain("Yanıtla");
  });

  it("bağlam yoksa (tek başına çizim) oturumdan okur: yetkiler aynı", () => {
    auth.calls = 0;
    const html = render(<MessageItem message={msg("m1")} onUpdate={() => undefined} onReply={() => undefined} />);
    expect(auth.calls).toBeGreaterThan(0);
    expect(html).toContain("Yanıtla");
  });

  it("messageViewerOf: kendi mesajı, doğrulanmış ve denetçi bilgisi", () => {
    expect(messageViewerOf({ user: null, can: () => false })).toEqual({ id: null, loggedIn: false, verified: false, auditor: false });
    expect(messageViewerOf({ user: { id: "a" }, can: (p) => p === "V" })).toEqual({ id: "a", loggedIn: true, verified: true, auditor: false });
  });
});

describe("Composer: ön denetim sonucu duyurulur (WCAG 4.1.3)", () => {
  const check = (over: Partial<MessagePrecheckResponse> = {}) => ({ risk: 1, pii: [], labels: [], ...over }) as Pick<MessagePrecheckResponse, "risk" | "pii" | "labels">;

  it("denetim yokken boş; bitince risk ve kişisel veri özeti", () => {
    expect(precheckAnnouncement(null)).toBe("");
    expect(precheckAnnouncement(check())).toBe("Ön denetim bitti: düşük risk; kişisel veri bulunmadı. Bu denetim yalnızca uyarıdır.");
    const pii = check({ risk: 2, labels: ["insult"], pii: [{ kind: "phone", start: 0, end: 3, masked: "05** *** ** **" }] as MessagePrecheckResponse["pii"] });
    expect(precheckAnnouncement(pii)).toBe("Ön denetim bitti: orta risk, 1 içerik uyarısı; 1 olası kişisel veri ifadesi bulundu. Bu denetim yalnızca uyarıdır.");
  });
});
