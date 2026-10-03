// Görev deposu (Faz 3 / madde 8): saf yardımcılar (rozet metni, öneri kimliği ayrıştırma, 'Sizden bekleniyor' etiketleri) ve
// deponun bildirim davranışı. İki okuyucusu (kabuktaki 'Ana sayfa' sayı rozeti ve öneri kartındaki 'Sizden bekleniyor' satırı)
// bileşenleri içe aktardığı için components/layout/taskSurfaces.test.tsx'te sınanır (lib, components'i içe aktaramaz).
import { renderToStaticMarkup } from "react-dom/server";
import type { DashboardTask } from "@forum/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearTasks,
  countBadgeText,
  EXPECTATION_LABELS,
  EXPECTATION_ORDER,
  expectationText,
  getTasks,
  getTasksLoadedAt,
  isStale,
  proposalExpectations,
  sameTasks,
  setTasks,
  subscribeTasks,
  taskCountText,
  taskProposalId,
  useTaskCount,
} from "./taskStore";

// e2e/tests/*.spec.ts'in düğme/bağlantı/bölge adı olarak aradığı dizeler: yeni adlar bunları içermemeli.
const RESERVED = ["destekle", "oyumu ver", "daha fazla", "sayımı kendim doğrulayayım", "kapat"];

const task = (over: Partial<DashboardTask> = {}): DashboardTask => ({
  kind: "vote",
  title: "#K-31 “Kütüphane” için oy verin",
  link: "/oneriler/p1",
  dueAt: Date.UTC(2099, 0, 1),
  ...over,
});

afterEach(() => clearTasks());

describe("rozet metni", () => {
  it("0, eksi ve geçersiz sayıda rozet yok; 99'dan sonra '99+'; kesir aşağı yuvarlanır", () => {
    expect(countBadgeText(0)).toBeNull();
    expect(countBadgeText(-2)).toBeNull();
    expect(countBadgeText(Number.NaN)).toBeNull();
    expect(countBadgeText(1)).toBe("1");
    expect(countBadgeText(99)).toBe("99");
    expect(countBadgeText(100)).toBe("99+");
    expect(countBadgeText(3.7)).toBe("3");
  });

  it("ekran okuyucu açıklaması Ana sayfa selamıyla aynı söz dizimi", () => {
    expect(taskCountText(1)).toBe("1 iş sizi bekliyor");
    expect(taskCountText(4)).toBe("4 iş sizi bekliyor");
    expect(taskCountText(-1)).toBe("0 iş sizi bekliyor");
  });
});

describe("taskProposalId", () => {
  it("öneri bağlantısının bütün biçimlerinden kimlik çıkar", () => {
    expect(taskProposalId({ link: "/oneriler/p1" })).toBe("p1");
    expect(taskProposalId({ link: "/oneriler/p1/" })).toBe("p1");
    expect(taskProposalId({ link: "#/oneriler/p1" })).toBe("p1");
    expect(taskProposalId({ link: "/proposals/p1" })).toBe("p1");
    expect(taskProposalId({ link: "/api/proposals/p1" })).toBe("p1");
    expect(taskProposalId({ link: "/oneriler/p1?bolum=eylem" })).toBe("p1");
    expect(taskProposalId({ link: "/oneriler/a%20b" })).toBe("a b");
  });

  it("öneri dışı, yeni öneri formu, liste, boş ve dış bağlantıda null", () => {
    expect(taskProposalId({ link: "/kayit-memuru" })).toBeNull();
    expect(taskProposalId({ link: "/oneriler/yeni" })).toBeNull();
    expect(taskProposalId({ link: "/oneriler" })).toBeNull();
    expect(taskProposalId({ link: "/oneriler/p1/surumler" })).toBeNull();
    expect(taskProposalId({ link: "" })).toBeNull();
    expect(taskProposalId({ link: "https://example.org/oneriler/p1" })).toBeNull();
    expect(taskProposalId({ link: "/oneriler/%E0%A4%A" })).toBeNull();
  });
});

describe("'Sizden bekleniyor' etiketleri", () => {
  const tasks: DashboardTask[] = [
    task({ kind: "expert", link: "/oneriler/p1" }),
    task({ kind: "vote", link: "/oneriler/p1" }),
    task({ kind: "vote", link: "/oneriler/p1" }), // aynı tür iki kez → bir etiket
    task({ kind: "sponsor", link: "/oneriler/p2" }),
    task({ kind: "registrar", link: "/kayit-memuru", dueAt: null }),
    task({ kind: "object", link: "/proposals/p3" }),
    task({ kind: "author", link: "/oneriler/p3" }),
  ];

  it("tür başına bir kez, sabit sırayla (eylem önce); yalnız o önerinin işleri", () => {
    expect(proposalExpectations(tasks, "p1").map((e) => e.label)).toEqual(["Oy", "Bilirkişi görevi"]);
    expect(proposalExpectations(tasks, "p2").map((e) => e.kind)).toEqual(["sponsor"]);
    expect(proposalExpectations(tasks, "p3").map((e) => e.label)).toEqual(["İtiraz hakkı", "Yazar işlemi"]);
    expect(expectationText(proposalExpectations(tasks, "p1"))).toBe("Oy · Bilirkişi görevi");
  });

  it("işi olmayan öneri, kimliksiz çağrı ve boş liste boş döner; kayıt memuru görevi hiçbir karta düşmez", () => {
    expect(proposalExpectations(tasks, "p9")).toEqual([]);
    expect(proposalExpectations(tasks, null)).toEqual([]);
    expect(proposalExpectations(tasks, "")).toEqual([]);
    expect(proposalExpectations([], "p1")).toEqual([]);
    expect(proposalExpectations([task({ kind: "registrar", link: "/oneriler/p1" })], "p1")).toEqual([]);
  });

  it("her öneri görev türünün etiketi var; etiketler ayrılmış e2e adlarını içermez", () => {
    expect([...EXPECTATION_ORDER].sort()).toEqual(Object.keys(EXPECTATION_LABELS).sort());
    for (const label of Object.values(EXPECTATION_LABELS)) {
      expect(RESERVED.some((r) => label.toLowerCase().includes(r)), label).toBe(false);
    }
  });
});

describe("depo", () => {
  it("sameTasks: tür, bağlantı, başlık, süre ve sıra", () => {
    const a = [task(), task({ kind: "sponsor", link: "/oneriler/p2" })];
    expect(sameTasks(a, a.map((t) => ({ ...t })))).toBe(true);
    expect(sameTasks(a, [a[1], a[0]])).toBe(false);
    expect(sameTasks(a, [a[0]])).toBe(false);
    expect(sameTasks(a, [a[0], { ...a[1], dueAt: 1 }])).toBe(false);
    expect(sameTasks([], [])).toBe(true);
  });

  it("isStale: hiç yüklenmediyse ya da süre dolduysa bayat", () => {
    expect(isStale(null, 1_000, 10_000)).toBe(true);
    expect(isStale(1_000, 10_999, 10_000)).toBe(false);
    expect(isStale(1_000, 11_000, 10_000)).toBe(true);
  });

  it("yazınca abonelere bildirir; aynı içerikte bildirmez ama yükleme zamanını günceller; boşaltınca sıfırlanır", () => {
    let calls = 0;
    const off = subscribeTasks(() => calls++);
    expect(getTasks()).toEqual([]);
    expect(getTasksLoadedAt()).toBeNull();

    setTasks([task()], 1_000);
    expect(calls).toBe(1);
    expect(getTasks()).toHaveLength(1);
    expect(Object.isFrozen(getTasks())).toBe(true);
    const before = getTasks();

    setTasks([task()], 2_000);
    expect(calls).toBe(1);
    expect(getTasks()).toBe(before);
    expect(getTasksLoadedAt()).toBe(2_000);

    setTasks([task(), task({ kind: "sponsor", link: "/oneriler/p2" })], 3_000);
    expect(calls).toBe(2);

    clearTasks();
    expect(calls).toBe(3);
    expect(getTasks()).toEqual([]);
    expect(getTasksLoadedAt()).toBeNull();
    clearTasks(); // zaten boş: bildirim yok
    expect(calls).toBe(3);

    off();
    setTasks([task()]);
    expect(calls).toBe(3);
  });

  it("useTaskCount deponun sayısını okur", () => {
    function Count() {
      return <span>{useTaskCount()}</span>;
    }
    expect(renderToStaticMarkup(<Count />)).toBe("<span>0</span>");
    setTasks([task(), task({ kind: "sponsor" })]);
    expect(renderToStaticMarkup(<Count />)).toBe("<span>2</span>");
  });
});
