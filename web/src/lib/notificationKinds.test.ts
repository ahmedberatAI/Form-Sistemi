// Bildirim türü sınıfları, tarih grupları, süzgeç ve odak yardımcıları (lib/notificationKinds.ts) + sunucu türleriyle eşleşme.
// Sunucudaki her notify() türünün tabloda yazılı olması kilitlidir: yeni tür eklenip tabloya girmezse bu test düşer.
// Bkz. docs/ARAYUZ_PLANI.md (Faz 3 / madde 6).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Notification, NotificationList } from "@forum/shared";
import { describe, expect, it } from "vitest";
import {
  AGE_GROUP_LABELS,
  ageGroupOf,
  classifyKind,
  DEFAULT_NOTIFICATION_CLASS,
  defaultFilter,
  filterNotifications,
  focusCandidates,
  groupByAge,
  isKnownKind,
  KNOWN_KINDS,
  markReadLocally,
  NOTIFICATION_CLASSES,
  NOTIFICATION_KINDS,
  readButtonLabel,
  RESERVED_KINDS,
  type NotificationClassId,
} from "./notificationKinds";

// e2e/tests/*.spec.ts'in düğme/bağlantı/bölge adı olarak aradığı dizeler: yeni sabit adlar bunları içermemeli (küçük harfle).
const RESERVED_NAMES = ["destekle", "oyumu ver", "daha fazla", "sayımı kendim doğrulayayım", "kapat", "gerekçe", "açıklama", "azınlık raporu", "düğüm"];

const make = (id: string, over: Partial<Notification> = {}): Notification => ({ id, kind: "proposal_phase", title: `Başlık ${id}`, body: "", link: null, read: false, createdAt: 0, ...over });

// ───────────────────────── Tür sınıfları ─────────────────────────

describe("classifyKind", () => {
  it("planın öneksiz türleri de açıkça eşlenir (önek yetmez)", () => {
    const expected: Record<string, NotificationClassId> = {
      lockstep: "yonetim",
      panel: "bilirkisi",
      deletion_request: "tartisma",
      delegation_unrouted: "vekalet",
      registration_pending: "yonetim",
      identity_correction: "hesap",
      identity_correction_pending: "yonetim",
      password_changed: "hesap",
      nickname_changed: "hesap",
      minority_report: "oneri",
    };
    for (const [kind, id] of Object.entries(expected)) {
      expect(classifyKind(kind).id, kind).toBe(id);
      expect(isKnownKind(kind), kind).toBe(true);
    }
  });

  it("önekli türler sınıflarına gider", () => {
    expect(classifyKind("vote_open").id).toBe("oylama");
    expect(classifyKind("vote_extended").id).toBe("oylama");
    expect(classifyKind("proposal_phase").id).toBe("oneri");
    expect(classifyKind("message_reply").id).toBe("tartisma");
    expect(classifyKind("expert_invited").id).toBe("bilirkisi");
    expect(classifyKind("account_verified").id).toBe("hesap");
  });

  it("tanınmayan tür varsayılan sınıfa düşer; fırlatmaz", () => {
    for (const kind of ["bilinmeyen_tur", "proposal_yeni_bir_sey", "VOTE_OPEN", "", "   ", null, undefined]) {
      expect(classifyKind(kind), String(kind)).toBe(DEFAULT_NOTIFICATION_CLASS);
    }
    expect(isKnownKind("bilinmeyen_tur")).toBe(false);
    expect(isKnownKind(null)).toBe(false);
  });

  it("nesne özelliği adlarına denk gelen tür varsayılan sınıfa düşer (constructor, __proto__, toString…)", () => {
    for (const kind of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      expect(classifyKind(kind), kind).toBe(DEFAULT_NOTIFICATION_CLASS);
      expect(isKnownKind(kind), kind).toBe(false);
    }
  });

  it("türün çevresindeki boşluk yok sayılır", () => {
    expect(classifyKind("  vote_open ").id).toBe("oylama");
  });

  it("tablo tutarlı: her tür var olan bir sınıfa gider; varsayılan sınıf dışında her sınıfın en az bir türü var", () => {
    const used = new Set<string>();
    for (const [kind, id] of Object.entries(NOTIFICATION_KINDS)) {
      expect(NOTIFICATION_CLASSES[id], kind).toBeDefined();
      used.add(id);
    }
    for (const id of Object.keys(NOTIFICATION_CLASSES)) {
      if (id === DEFAULT_NOTIFICATION_CLASS.id) continue;
      expect(used.has(id), `${id} sınıfına hiçbir tür eşlenmemiş`).toBe(true);
    }
    expect(KNOWN_KINDS).toEqual(Object.keys(NOTIFICATION_KINDS));
    expect(NOTIFICATION_KINDS).not.toHaveProperty(DEFAULT_NOTIFICATION_CLASS.id);
  });

  it("her sınıf bir ikon, ekran okuyucu metni ve ton taşır; metinler benzersiz ve e2e adlarıyla çakışmaz", () => {
    const labels = new Set<string>();
    for (const [id, cls] of Object.entries(NOTIFICATION_CLASSES)) {
      expect(cls.id).toBe(id);
      expect(cls.icon.length, id).toBeGreaterThan(0);
      expect(["neutral", "info", "warning"]).toContain(cls.tone);
      expect(cls.label.trim(), id).not.toBe("");
      expect(labels.has(cls.label), `yinelenen etiket: ${cls.label}`).toBe(false);
      labels.add(cls.label);
      expect(cls.label.endsWith("."), "etiketin sonuna noktayı bileşen ekler").toBe(false);
      for (const reserved of RESERVED_NAMES) expect(cls.label.toLowerCase(), `${cls.label} ~ ${reserved}`).not.toContain(reserved);
    }
  });

  it("renk tek başına anlam taşımaz: her sınıfın simgesi benzersiz (aynı tondaki sınıflar simgeyle ayrışır)", () => {
    const icons = Object.values(NOTIFICATION_CLASSES).map((c) => c.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

// ───────────────────────── Sunucu türleriyle eşleşme ─────────────────────────

/**
 * `(` sonrasındaki çağrının gövdesi (kapanış parantezine kadar); dizeler ve şablon dizeleri olduğu gibi kalır, yorumlar atılır.
 * Kapanış bulunamazsa null.
 */
function callBody(src: string, from: number): string | null {
  let depth = 1;
  let out = "";
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const begin = i;
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
      out += src.slice(begin, i + 1);
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      if (close < 0) return null;
      i = close + 1;
      out += " ";
    } else {
      if (c === "(") depth++;
      else if (c === ")" && --depth === 0) return out;
      out += c;
    }
  }
  return null;
}

/** Kaynak metindeki `.notify(…)` / `.notifyMany(…)` çağrılarının bağımsız değişkenlerinde geçen `kind: "…"` değerleri. */
function notifyKindsIn(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\.notify(?:Many)?\(/g)) {
    const body = callBody(src, m.index + m[0].length);
    if (body === null) continue;
    for (const k of body.matchAll(/\bkind:\s*"([a-z][a-z0-9_]*)"/g)) out.push(k[1]);
  }
  return out;
}

const SERVER_SRC = fileURLToPath(new URL("../../../server/src/", import.meta.url));

describe("sunucu bildirim türleri", () => {
  it("tarayıcı kendi başına doğru çalışır (sınama)", () => {
    const sample = `
      core.notify([a], { kind: "x_one", title: \`\${f(p)}: "tırnak" (parantez) ve Mesaj'ınız\`, body: "kapanış ) yok", link: null }); // kind: "yok_yorum"
      notifier.notifyMany(ids, { kind: "x_two", title: "t" /* kind: "yok_blok" */ , body: "b" });
      this.notify(u, n); function notify(userId: string, n: { kind: string; title: string }) {}
    `;
    expect(notifyKindsIn(sample)).toEqual(["x_one", "x_two"]);
  });

  it.skipIf(!existsSync(SERVER_SRC))("server/src altında notify()/notifyMany() ile gönderilen HER tür tabloda yazılı", () => {
    const files = (readdirSync(SERVER_SRC, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => join(SERVER_SRC, f));
    const sent = new Map<string, string>();
    for (const file of files) for (const kind of notifyKindsIn(readFileSync(file, "utf8"))) if (!sent.has(kind)) sent.set(kind, file);
    // Tarayıcı bozulursa 'hiç tür bulunamadı' sessizce geçmesin (bugün 31 tür var).
    expect(sent.size, `sunucuda bulunan türler: ${[...sent.keys()].join(", ")}`).toBeGreaterThanOrEqual(25);
    const missing = [...sent].filter(([kind]) => !isKnownKind(kind)).map(([kind, file]) => `${kind} (${file.slice(SERVER_SRC.length)})`);
    expect(missing, "notificationKinds.ts NOTIFICATION_KINDS tablosuna eklenmemiş sunucu türleri").toEqual([]);
  });

  it.skipIf(!existsSync(SERVER_SRC))("tabloda sunucunun göndermediği ad yok (ayrılmış adlar hariç): eskimiş girdi birikmez", () => {
    const files = (readdirSync(SERVER_SRC, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => join(SERVER_SRC, f));
    const sent = new Set<string>();
    for (const file of files) for (const kind of notifyKindsIn(readFileSync(file, "utf8"))) sent.add(kind);
    const stale = KNOWN_KINDS.filter((k) => !sent.has(k) && !RESERVED_KINDS.includes(k));
    expect(stale, "sunucuda artık gönderilmeyen ama tabloda duran türler").toEqual([]);
  });
});

// ───────────────────────── Tarih grupları ─────────────────────────

/** Yerel takvimle zaman damgası (testler saat diliminden bağımsızdır). */
const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0): number => new Date(y, mo - 1, d, h, mi, s, ms).getTime();

describe("ageGroupOf / groupByAge", () => {
  const now = at(2026, 10, 3, 15, 30); // 3 Ekim 2026, Cumartesi

  it("sınırlar: gece yarısı Bugün, bir ms öncesi Bu hafta; yedinci takvim günü Bu hafta, sekizincisi Daha eski", () => {
    expect(ageGroupOf(at(2026, 10, 3, 0, 0, 0, 0), now)).toBe("bugun");
    expect(ageGroupOf(at(2026, 10, 3, 15, 30), now)).toBe("bugun");
    expect(ageGroupOf(at(2026, 10, 2, 23, 59, 59, 999), now)).toBe("hafta");
    expect(ageGroupOf(at(2026, 9, 27, 0, 0, 0, 0), now)).toBe("hafta"); // bugün dahil 7. takvim günü
    expect(ageGroupOf(at(2026, 9, 26, 23, 59, 59, 999), now)).toBe("eski");
    expect(ageGroupOf(at(2025, 1, 1), now)).toBe("eski");
  });

  it("gelecekteki (saati ileri alınmış) ve geçersiz zaman damgaları", () => {
    expect(ageGroupOf(now + 3_600_000, now)).toBe("bugun");
    expect(ageGroupOf(Number.NaN, now)).toBe("eski");
    expect(ageGroupOf(Number.POSITIVE_INFINITY, now)).toBe("eski");
  });

  it("ay ve yıl başında da yedi takvim günü sayılır", () => {
    const jan3 = at(2026, 1, 3, 9);
    expect(ageGroupOf(at(2025, 12, 28, 0, 0, 0, 0), jan3)).toBe("hafta");
    expect(ageGroupOf(at(2025, 12, 27, 23, 59, 59, 999), jan3)).toBe("eski");
  });

  it("yaz/kış saati geçişi olan günlerde de sınır yerel takvim gününe göre (23/25 saatlik günler)", () => {
    for (const [y, mo, d] of [
      [2026, 3, 29],
      [2026, 10, 25],
      [2026, 3, 8],
      [2026, 11, 1],
    ] as const) {
      const n = at(y, mo, d, 12);
      expect(ageGroupOf(at(y, mo, d, 0), n), `${y}-${mo}-${d} 00:00`).toBe("bugun");
      expect(ageGroupOf(at(y, mo, d - 6, 0), n), `${y}-${mo}-${d} − 6 gün`).toBe("hafta");
      expect(ageGroupOf(at(y, mo, d - 6, 0) - 1, n), `${y}-${mo}-${d} − 6 gün − 1 ms`).toBe("eski");
    }
  });

  it("geçersiz 'şimdi' çökmez", () => {
    expect(ageGroupOf(Date.now(), Number.NaN)).toBe("bugun");
  });

  it("gruplar Bugün → Bu hafta → Daha eski sırasında, boş grup yok, grup içinde en yeni önce", () => {
    const items = [
      make("eski", { createdAt: at(2026, 8, 1) }),
      make("dun", { createdAt: at(2026, 10, 2, 20) }),
      make("sabah", { createdAt: at(2026, 10, 3, 8) }),
      make("aksam", { createdAt: at(2026, 10, 3, 14) }),
      make("hafta", { createdAt: at(2026, 9, 30, 10) }),
    ];
    const groups = groupByAge(items, now);
    expect(groups.map((g) => g.id)).toEqual(["bugun", "hafta", "eski"]);
    expect(groups.map((g) => g.label)).toEqual(["Bugün", "Bu hafta", "Daha eski"]);
    expect(groups[0].items.map((n) => n.id)).toEqual(["aksam", "sabah"]);
    expect(groups[1].items.map((n) => n.id)).toEqual(["dun", "hafta"]);
    expect(groups[2].items.map((n) => n.id)).toEqual(["eski"]);
    expect(AGE_GROUP_LABELS).toEqual({ bugun: "Bugün", hafta: "Bu hafta", eski: "Daha eski" });
  });

  it("boş girdi ve tek grup: boş grup başlığı dönmez", () => {
    expect(groupByAge([], now)).toEqual([]);
    expect(groupByAge([make("a", { createdAt: at(2026, 10, 3, 1) })], now).map((g) => g.id)).toEqual(["bugun"]);
    expect(groupByAge([make("a", { createdAt: at(2020, 1, 1) })], now).map((g) => g.id)).toEqual(["eski"]);
  });

  it("eşit zamanlı bildirimlerde sunucu sırası korunur; girdi değiştirilmez; geçersiz zaman en sona", () => {
    const t = at(2026, 10, 3, 9);
    const items = [make("a", { createdAt: t }), make("b", { createdAt: t }), make("bozuk", { createdAt: Number.NaN }), make("c", { createdAt: t })];
    const copy = items.map((n) => n.id);
    const groups = groupByAge(items, now);
    expect(groups[0].items.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(groups[1].id).toBe("eski");
    expect(groups[1].items.map((n) => n.id)).toEqual(["bozuk"]);
    expect(items.map((n) => n.id)).toEqual(copy);
  });
});

// ───────────────────────── Süzgeç ve yerel okundu durumu ─────────────────────────

describe("süzgeç", () => {
  it("okunmamış bildirim varsa varsayılan 'Okunmamış', yoksa 'Tümü'", () => {
    expect(defaultFilter({ items: [make("a", { read: false }), make("b", { read: true })], unread: 1 })).toBe("unread");
    expect(defaultFilter({ items: [make("a", { read: true })], unread: 0 })).toBe("all");
    expect(defaultFilter({ items: [], unread: 0 })).toBe("all");
  });

  it("sunucu sayısı listeye sığmayan eski okunmamışları sayıyorsa boş 'Okunmamış' sekmesiyle açılmaz", () => {
    expect(defaultFilter({ items: [make("a", { read: true })], unread: 4 })).toBe("all");
  });

  it("filterNotifications", () => {
    const items = [make("a", { read: false }), make("b", { read: true }), make("c", { read: false })];
    expect(filterNotifications(items, "all").map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(filterNotifications(items, "unread").map((n) => n.id)).toEqual(["a", "c"]);
    expect(filterNotifications(items, "all")).not.toBe(items);
  });
});

describe("markReadLocally", () => {
  const list = (): NotificationList => ({ items: [make("a"), make("b"), make("c", { read: true })], unread: 2 });

  it("tek bildirim: yalnız o okundu olur, sayı bir azalır; girdi değiştirilmez", () => {
    const before = list();
    const after = markReadLocally(before, ["a"]);
    expect(after.items.map((n) => n.read)).toEqual([true, false, true]);
    expect(after.unread).toBe(1);
    expect(before.items[0].read).toBe(false);
    expect(before.unread).toBe(2);
  });

  it("hepsi: sayı 0", () => {
    const after = markReadLocally(list(), null);
    expect(after.items.every((n) => n.read)).toBe(true);
    expect(after.unread).toBe(0);
  });

  it("zaten okunmuş ya da listede olmayan kimlik sayıyı düşürmez", () => {
    expect(markReadLocally(list(), ["c"]).unread).toBe(2);
    expect(markReadLocally(list(), ["yok"]).unread).toBe(2);
    expect(markReadLocally(list(), ["a", "a"]).unread).toBe(1);
  });

  it("sunucu sayısı listeden büyükse (100'den fazla bildirim) listeden yeniden SAYILMAZ", () => {
    const big: NotificationList = { items: [make("a"), make("b")], unread: 37 };
    expect(markReadLocally(big, ["a"]).unread).toBe(36);
    expect(markReadLocally(big, null).unread).toBe(0);
  });

  it("sayı asla negatif olmaz", () => {
    expect(markReadLocally({ items: [make("a")], unread: 0 }, ["a"]).unread).toBe(0);
  });
});

// ───────────────────────── Erişilebilir ad ve odak ─────────────────────────

describe("readButtonLabel", () => {
  it("'Okundu işaretle: <başlık>'", () => {
    expect(readButtonLabel("#K-7 oylamada")).toBe("Okundu işaretle: #K-7 oylamada");
  });
});

describe("focusCandidates", () => {
  const order = ["a", "b", "c", "d"];

  it("satır listeden kalkıyorsa (Okunmamış): önce aşağıdakiler, sonra yukarıdakiler yakından uzağa", () => {
    expect(focusCandidates(order, "b", false)).toEqual(["c", "d", "a"]);
    expect(focusCandidates(order, "d", false)).toEqual(["c", "b", "a"]);
    expect(focusCandidates(order, "a", false)).toEqual(["b", "c", "d"]);
  });

  it("satır kalıyorsa (Tümü): önce satırın kendisi", () => {
    expect(focusCandidates(order, "b", true)).toEqual(["b", "c", "d", "a"]);
  });

  it("tek satır ya da listede olmayan kimlik: aday kalmaz (odak sayfa paneline gider)", () => {
    expect(focusCandidates(["a"], "a", false)).toEqual([]);
    expect(focusCandidates(["a"], "a", true)).toEqual(["a"]);
    expect(focusCandidates(order, "yok", false)).toEqual([]);
  });
});
