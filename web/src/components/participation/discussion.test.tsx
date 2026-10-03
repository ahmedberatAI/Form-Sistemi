// Tartışma bileşenlerinin sunucu tarafı çizimi (DOM gerekmez): kapalı yazma kutusu, tek cümlelik notlar, sade mesaj alt satırı.
// e2e'nin dayandığı yapılar (03-silme): #mesaj-<id>, .msg-body, .msg-tombstone, .msg-collapsed-bar, Katılıyorum/Katılmıyorum.
import type { MessageView } from "@forum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DetailLevelProvider } from "../../lib/detailLevel";
import { PREF_KEYS, removePref, setPrefSync } from "../../lib/prefs";
import { ToastProvider } from "../../ui/Toast";
import { Composer } from "./Composer";
import { UNVERIFIED_NOTE } from "./discussionLogic";
import { MessageItem } from "./MessageItem";

// Ortak oturum taklidi: testler kullanıcıyı ve yetkiyi değiştirir.
const auth = vi.hoisted(() => ({
  user: null as { id: string; status: string } | null,
  verified: true,
}));
vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ user: auth.user, can: (p: string) => (p === "V" ? auth.verified : false), now: () => Date.UTC(2026, 9, 2) }),
  useServerNow: () => () => Date.UTC(2026, 9, 2),
}));

const render = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <DetailLevelProvider>
      <ToastProvider>
        <MemoryRouter>{el}</MemoryRouter>
      </ToastProvider>
    </DetailLevelProvider>,
  );

const HASH = "a1b2c3" + "0".repeat(58);
const TX = "d4e5f6" + "1".repeat(58);

const msg = (over: Partial<MessageView> = {}): MessageView => ({
  id: "m1",
  seq: 7,
  threadType: "proposal",
  threadId: "p1",
  parentId: null,
  authorId: "u1",
  authorNickname: "ayse",
  stance: "pro",
  body: "Kütüphane cumartesi de açık kalmalı.",
  version: 1,
  visibility: "visible",
  tombstone: null,
  hiddenByProposalId: null,
  rebuttal: null,
  aiFlag: null,
  endorsements: { agree: 2, disagree: 1, mine: 0 },
  bridgingScore: 0.5,
  createdAt: Date.UTC(2026, 9, 1),
  updatedAt: Date.UTC(2026, 9, 1),
  contentHash: HASH,
  ledgerTx: TX,
  pendingDeletionProposalId: null,
  ...over,
});

const composer = (props: Partial<React.ComponentProps<typeof Composer>> = {}) => (
  <Composer threadType="proposal" threadId="p1" onDone={() => undefined} {...props} />
);

beforeEach(async () => {
  auth.user = { id: "u9", status: "verified" };
  auth.verified = true;
  await removePref(PREF_KEYS.detail);
});

describe("Composer: kapalı yazma kutusu", () => {
  it("sade kipte doğrulanmış üyede yeni mesaj kapalı başlar: aria-expanded=false düğme (asılı aria-controls yok), form ve metin alanı yok", () => {
    const html = render(composer());
    expect(html).toContain('class="composer-collapsed"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Görüşünüzü yazın…");
    // Form kapalıyken DOM'da yok: düğme var olmayan bir kimliğe aria-controls ile işaret etmez (açılınca formla yer değiştirir)
    expect(html).not.toContain("aria-controls=");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<textarea");
  });

  it("'Tam' kipte baştan açıktır (form, metin alanı, Vazgeç) ve düğme çizilmez", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    const html = render(composer());
    expect(html).toContain('aria-label="Yeni mesaj"');
    expect(html).toContain("<textarea");
    expect(html).toContain("Vazgeç");
    expect(html).toContain("Ön denetim");
    expect(html).not.toContain("composer-collapsed");
  });

  it("yanıt ve düzenleme sade kipte de doğrudan açılır", () => {
    const parent = msg();
    const reply = render(composer({ mode: "reply", parent, autoFocus: true }));
    expect(reply).toContain("<textarea");
    expect(reply).toContain("Yanıtlanan");
    expect(reply).not.toContain("composer-collapsed");
    const edit = render(composer({ mode: "edit", message: parent }));
    expect(edit).toContain("Mesajı düzenle");
    expect(edit).toContain("Kütüphane cumartesi de açık kalmalı.");
    expect(edit).not.toContain("composer-collapsed");
  });
});

describe("Composer: tek cümlelik notlar", () => {
  it("anonim: giriş ve kayıt bağlantıları (adları aynen), form yok", () => {
    auth.user = null;
    const html = render(composer());
    expect(html).toContain("composer-note");
    expect(html).toContain(">Giriş yap</a>");
    expect(html).toContain(">Kayıt ol</a>");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("composer-collapsed");
  });

  it("doğrulanmamış üye: hesabın durumuna göre tek cümle", () => {
    auth.user = { id: "u9", status: "pending" };
    auth.verified = false;
    expect(render(composer())).toContain(UNVERIFIED_NOTE);
    auth.user = { id: "u9", status: "rejected" };
    expect(render(composer())).toContain("Kaydınız onaylanmadığı için");
  });

  it("taslak ve arşiv: sayfanın verdiği gerekçe olduğu gibi tek not olur", () => {
    const html = render(composer({ closedReason: "Bu konu arşivlendi; yeni mesaj yazılamaz." }));
    expect(html).toContain("composer-note");
    expect(html).toContain("Bu konu arşivlendi; yeni mesaj yazılamaz.");
    expect(html).not.toContain("<textarea");
    // Düzenleme kapalı tartışmada da çalışır (yazar kendi mesajını düzenleyebilir).
    expect(render(composer({ mode: "edit", message: msg(), closedReason: "taslak" }))).toContain("<textarea");
  });
});

describe("MessageItem: sade alt satır ve e2e yapıları", () => {
  it("gövde .msg-body içinde ClampText ile çizilir; odak alabilir (tabindex=-1) ve metin DOM'da tam kalır", () => {
    const html = render(<MessageItem message={msg()} onUpdate={() => undefined} />);
    expect(html).toContain('id="mesaj-m1"');
    expect(html).toMatch(/<div class="msg-body" tabindex="-1">\s*<div class="clamp-text/);
    expect(html).toContain("Kütüphane cumartesi de açık kalmalı.");
    expect((html.match(/class="msg-body"/g) ?? []).length).toBe(1);
  });

  it("hash alt bilgisi TEK sessiz satırdır: 'özet a1b2c3… · defter d4e5f6… ›'; kopyalama düğmesi yok, defter karması işlem sayfasına bağlanır", () => {
    const html = render(<MessageItem message={msg()} onUpdate={() => undefined} />);
    expect((html.match(/<footer class="msg-meta/g) ?? []).length).toBe(1);
    const footer = html.slice(html.indexOf('<footer class="msg-meta'), html.indexOf("</footer>"));
    const text = footer.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    expect(text).toBe("özet a1b2c3… · defter d4e5f6… ›");
    expect(footer).toContain(`href="/defter/islem/${TX}"`);
    expect(footer).toContain('aria-label="İçerik özeti: ' + HASH + '"');
    expect(footer).toContain('aria-label="Defter işlemi: ' + TX + '"');
    expect(footer).toContain('class="msg-meta-go" aria-hidden="true"');
    expect(footer).not.toContain("copy-btn");
  });

  it("deftere henüz girmediyse 'defter kaydı bekleniyor' yazar", () => {
    const html = render(<MessageItem message={msg({ ledgerTx: null })} onUpdate={() => undefined} />);
    expect(html).toContain("defter kaydı bekleniyor");
    expect(html).not.toContain("msg-meta-go");
  });

  it("Katılıyorum ve Katılmıyorum erişilebilir adları, köprü skoru ve 'Diğer işlemler' menüsü yerinde", () => {
    const html = render(<MessageItem message={msg()} onUpdate={() => undefined} onReply={() => undefined} />);
    expect(html).toMatch(/Katılıyorum <span class="msg-count">2<\/span>/);
    expect(html).toMatch(/Katılmıyorum <span class="msg-count">1<\/span>/);
    expect(html).toContain("Köprü skoru 0,50");
    expect(html).toContain("Mesaj #7 için diğer işlemler");
  });

  it("gizlenen mesaj: mezar taşı var, .msg-body yok; alt satır yine tek satır", () => {
    const html = render(<MessageItem message={msg({ visibility: "hidden", body: null, tombstone: "[#K-21 kararıyla gizlendi — gerekçe: Tehdit]" })} onUpdate={() => undefined} />);
    expect(html).toContain("msg-tombstone-text");
    expect(html).toContain("kararıyla gizlendi");
    expect(html).not.toContain('class="msg-body"');
    expect((html.match(/<footer class="msg-meta/g) ?? []).length).toBe(1);
  });

  it("daraltılmış mesaj: 'Gözden geçiriliyor' çubuğu ve 'Mesajı göster' düğmesi var, gövde (.msg-body) yok", () => {
    const html = render(<MessageItem message={msg({ visibility: "collapsed", pendingDeletionProposalId: "d1" })} deletionSeq={21} onUpdate={() => undefined} />);
    expect(html).toContain("msg-collapsed-bar");
    expect(html).toContain("Gözden geçiriliyor");
    expect(html).toContain("Mesajı göster");
    expect(html).not.toContain('class="msg-body"');
  });
});
