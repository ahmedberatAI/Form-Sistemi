// Görev deposunun iki okuyucusu (Faz 3 / madde 8): kabuktaki 'Ana sayfa' sayı rozeti (adı değişmez, aria-describedby; masaüstü alt
// bilgisinde 'Gösterim rehberi ve sözlük' bağlantısı) ve öneri kartındaki 'Sizden bekleniyor' satırı. Sunucu tarafı çizimle
// denetlenir (DOM gerekmez). Depo ve saf yardımcılar lib/taskStore.test.tsx'tedir.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { DashboardTask, ProposalSummary } from "@forum/shared";
import { afterEach, describe, expect, it } from "vitest";
import { AuthProvider } from "../../auth/AuthContext";
import { clearTasks, setTasks } from "../../lib/taskStore";
import { ProposalCard } from "../proposals/ProposalCard";
import { AppLayout } from "./AppLayout";

// e2e/tests/*.spec.ts'in düğme/bağlantı/bölge adı olarak aradığı dizeler: yeni adlar bunları içermemeli.
const RESERVED = ["destekle", "oyumu ver", "daha fazla", "sayımı kendim doğrulayayım", "kapat"];

const task = (over: Partial<DashboardTask> = {}): DashboardTask => ({
  kind: "vote",
  title: "#K-31 “Kütüphane” için oy verin",
  link: "/oneriler/p1",
  dueAt: Date.UTC(2099, 0, 1),
  ...over,
});

const summary = (over: Partial<ProposalSummary> = {}): ProposalSummary => ({
  id: "p1",
  seq: 31,
  kind: "topic",
  title: "Kütüphane hafta sonu açık olsun",
  status: "voting",
  tier: "T0",
  authorId: "u-yazar",
  authorNickname: "yazar",
  categories: [],
  parentTopicId: null,
  createdAt: Date.UTC(2026, 9, 1),
  phaseEndsAt: Date.UTC(2099, 0, 1),
  sponsorCount: 0,
  sponsorsRequired: 4,
  messageCount: 3,
  participation: { voted: 12, eligible: 40 },
  integrityWarningCount: 0,
  ...over,
});

afterEach(() => clearTasks());

const shell = () =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={["/oneriler"]}>
      <AuthProvider>
        <AppLayout>
          <p>içerik</p>
        </AppLayout>
      </AuthProvider>
    </MemoryRouter>,
  );

/** Bir HTML parçasındaki <a> öğeleri: açılış etiketi ve görünür adı (etiketler atılmış). */
const links = (html: string) =>
  [...html.matchAll(/<a([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ attrs: m[1], name: m[2].replace(/<span class="count-badge"[^>]*>.*?<\/span>/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(), html: m[2] }));

describe("kabuk: 'Ana sayfa' sayı rozeti", () => {
  it("iş yokken rozet ve açıklama yok", () => {
    const html = shell();
    const home = links(html).filter((l) => l.attrs.includes('href="/"') && l.name === "Ana sayfa");
    expect(home.length).toBeGreaterThanOrEqual(2); // üst gezinme + alt gezinme
    for (const l of home) {
      expect(l.html).not.toContain("count-badge");
      expect(l.attrs).not.toContain("aria-describedby");
    }
    expect(html).not.toContain("iş sizi bekliyor");
  });

  it("iş varken üst ve alt gezinmede mavi sayı rozeti (aria-hidden); bağlantı adı 'Ana sayfa' kalır, sayı aria-describedby ile söylenir", () => {
    setTasks([task(), task({ kind: "sponsor", link: "/oneriler/p2" }), task({ kind: "registrar", link: "/kayit-memuru", dueAt: null })]);
    const html = shell();
    const home = links(html).filter((l) => l.attrs.includes('href="/"') && l.name === "Ana sayfa");
    expect(home).toHaveLength(2);
    const described = new Set<string>();
    for (const l of home) {
      expect(l.html).toContain('<span class="count-badge" aria-hidden="true">3</span>');
      const id = /aria-describedby="([^"]+)"/.exec(l.attrs)?.[1];
      expect(id).toBeTruthy();
      described.add(id!);
    }
    // İki bağlantı aynı gizli açıklamayı gösterir; açıklama görünmez (hidden) ve tek kopyadır
    expect(described.size).toBe(1);
    const [id] = [...described];
    expect(html).toContain(`<span id="${id}" hidden="">3 iş sizi bekliyor</span>`);
    expect(html.match(/iş sizi bekliyor/g)).toHaveLength(1);
    // Alt gezinmede simge sarmalayıcısının içinde (rozet simgenin köşesinde)
    expect(html).toMatch(/<span class="bottom-icon-wrap"><svg[^>]*>[\s\S]*?<\/svg><span class="count-badge" aria-hidden="true">3<\/span><\/span><span>Ana sayfa<\/span>/);
  });

  it("99'dan fazla işte '99+'", () => {
    setTasks(Array.from({ length: 120 }, (_, i) => task({ link: `/oneriler/p${i}` })));
    expect(shell()).toContain('<span class="count-badge" aria-hidden="true">99+</span>');
  });

  it("masaüstü alt bilgisinde 'Gösterim rehberi ve sözlük' bağlantısı /kesfet'e gider; üst gezinmede Keşfet öğesi yok (8 öğe)", () => {
    const html = shell();
    const footer = html.slice(html.indexOf('<footer class="app-footer"'), html.indexOf("</footer>"));
    expect(links(footer).map((l) => [l.name, /href="([^"]+)"/.exec(l.attrs)?.[1]])).toEqual([["Gösterim rehberi ve sözlük", "/kesfet"]]);
    const top = html.slice(html.indexOf('aria-label="Ana gezinme"'), html.indexOf("</nav>", html.indexOf('aria-label="Ana gezinme"')));
    expect(links(top)).toHaveLength(8);
    expect(top).not.toContain("/kesfet");
  });

  it("kabuktaki bütün adlar ayrılmış e2e adlarıyla çakışmaz ('Daha fazla' yalnız alt gezinme düğmesinde)", () => {
    setTasks([task()]);
    const html = shell();
    const names = links(html).map((l) => l.name);
    expect(names.filter((n) => RESERVED.some((r) => n.toLowerCase().includes(r)))).toEqual([]);
    expect(html.match(/<button[^>]*>[\s\S]*?Daha fazla[\s\S]*?<\/button>/g)).toHaveLength(1);
  });
});

describe("öneri kartı: 'Sizden bekleniyor'", () => {
  const card = (p: ProposalSummary) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <ProposalCard proposal={p} />
      </MemoryRouter>,
    );

  it("iş yokken satır yok", () => {
    const html = card(summary());
    expect(html).not.toContain("Sizden bekleniyor");
    expect(html).not.toContain("pcard-expect");
  });

  it("oturumdaki üyenin bu öneride işi varsa düz metin satırı (rozet değil); kart açıklamasına bağlı", () => {
    setTasks([task({ kind: "vote", link: "/oneriler/p1" }), task({ kind: "expert", link: "/oneriler/p1" }), task({ kind: "sponsor", link: "/oneriler/p2" })]);
    const html = card(summary());
    expect(html).toContain("<strong>Sizden bekleniyor:</strong> Oy · Bilirkişi görevi");
    const id = /<p class="pcard-expect" id="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    const describedBy = /<article[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1].split(" ") ?? [];
    expect(describedBy).toContain(id);
    expect(describedBy).toHaveLength(2); // 'ara sonuç gizli' notu da kalır
    // Satır rozet değildir; kartta tek renkli durum rozeti kalır
    expect(html.match(/class="badge badge-(info|success|warning|danger|accent)"/g)).toHaveLength(1);
    // Başka önerinin işi bu karta düşmez
    expect(card(summary({ id: "p2", status: "sponsoring", participation: null }))).toContain("<strong>Sizden bekleniyor:</strong> Destek");
    expect(card(summary({ id: "p3" }))).not.toContain("Sizden bekleniyor");
  });

  it("itiraz ve uzlaşma işlerinde simge turuncu (dikkat), diğerlerinde mavi", () => {
    setTasks([task({ kind: "object", link: "/oneriler/p1" })]);
    expect(card(summary({ status: "objection_window", participation: null }))).toContain('class="pcard-expect pcard-expect-attention"');
    setTasks([task({ kind: "vote", link: "/oneriler/p1" })]);
    expect(card(summary())).toContain('class="pcard-expect"');
  });

  it("rozet bütçesi: renkli durum rozeti yanında katman gri; katılım çubuğu birincil mavi (mor yalnız YZ)", () => {
    const html = card(summary({ tier: "T3", status: "voting" }));
    expect(html).toContain("badge badge-info");
    expect(html).not.toContain("badge-danger");
    expect(html).toContain("progress-primary");
    expect(html).not.toContain("progress-accent");
    // Durum rozeti gri iken (taslak) T3 kırmızı kalır: tek renkli rozet o olur
    expect(card(summary({ tier: "T3", status: "draft", participation: null }))).toContain("badge-danger");
  });
});
