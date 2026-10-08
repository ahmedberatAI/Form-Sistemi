// shared/src/recommend.ts: kişisel sıralamanın SAF işlevi — aynı küme (hiçbir öğe düşmez), belirlenimcilik, çeşitlilik (üst
// kategoriler dahil dışlama), soğuk başlangıç, sönüm/üst sınır/hiyerarşi, katılınmış önerinin ilgi puanı almaması, gerekçe metni,
// oy verisinin girdi tiplerinde HİÇ olmaması ve ilgi örüntüsü olan yapay bir toplulukta ölçüm (gerileme koruması).
import { describe, expect, it } from "vitest";
import {
  buildInterestProfile,
  CATEGORY_VOCAB,
  fy,
  rankForUser,
  REC_PARAMS,
  REC_SIGNAL_KINDS,
  type RecCandidate,
  type RecCategory,
  type RecSignal,
  type RecSignalKind,
} from "@forum/shared";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 1, 12);
const CATS: RecCategory[] = CATEGORY_VOCAB.map((c) => ({ iri: fy(c.local), label: c.label, parent: c.parent ? fy(c.parent) : null }));

const sig = (kind: RecSignalKind, target: string, cats: string[], ageDays: number | null = 0): RecSignal => ({
  kind,
  target,
  categories: cats.map(fy),
  at: ageDays === null ? null : NOW - ageDays * DAY,
});
const cand = (id: string, cats: string[], o: Partial<RecCandidate> = {}): RecCandidate => ({
  id,
  categories: cats.map(fy),
  createdAt: NOW - 60 * DAY,
  phaseEndsAt: null,
  active: true,
  saved: false,
  ...o,
});
const rank = (signals: RecSignal[], candidates: RecCandidate[]) =>
  rankForUser({ profile: buildInterestProfile(signals, CATS, NOW), candidates, categories: CATS, now: NOW });
const ids = (r: ReturnType<typeof rank>) => r.items.map((i) => i.id);

/** Belirlenimci sözde rastgele (testin kendisi de tekrarlanabilir olsun). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const LOCALS = CATEGORY_VOCAB.map((c) => c.local);

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Check<T extends true> = T;

describe("girdi tipleri: oy verisi YOK", () => {
  // Derleme zamanı denetimi (server typecheck testleri de derler): tür listesi ve alan adları tam olarak bunlardır.
  type _Types = [
    Check<Same<RecSignalKind, "author" | "saved" | "sponsor" | "message" | "open">>,
    Check<Same<keyof RecSignal, "kind" | "target" | "categories" | "at">>,
    Check<Same<keyof RecCandidate, "id" | "categories" | "createdAt" | "phaseEndsAt" | "active" | "saved" | "engaged">>,
  ];

  it("sinyal türleri yalnız yazarlık, listeye ekleme, destekleme, mesaj ve açma", () => {
    const _t: _Types = [true, true, true];
    expect(_t).toHaveLength(3);
    expect([...REC_SIGNAL_KINDS]).toEqual(["author", "saved", "sponsor", "message", "open"]);
    for (const k of REC_SIGNAL_KINDS) expect(k).not.toMatch(/vote|ballot|objection|minority|oy|itiraz|azinlik|choice/i);
  });

  it("bilinmeyen bir tür (ör. zorla verilen 'vote') yok sayılır: profil değişmez", () => {
    const base = [sig("author", "p:1", ["YesilAlan"])];
    const withVote = [...base, { kind: "vote", target: "p:2", categories: [fy("Spor")], at: NOW } as unknown as RecSignal];
    expect(buildInterestProfile(withVote, CATS, NOW)).toEqual(buildInterestProfile(base, CATS, NOW));
  });

  it("sabitler belgedeki değerlerle aynı", () => {
    expect(REC_PARAMS.weights).toEqual({ author: 3, saved: 3, sponsor: 2, message: 2, open: 0.5 });
    expect(REC_PARAMS.windowMs).toBe(180 * DAY);
    expect(REC_PARAMS.halfLifeMs).toBe(30 * DAY);
    expect(REC_PARAMS.score).toEqual({ interest: 0.6, urgency: 0.2, novelty: 0.2 });
    expect(REC_PARAMS.scoreOpen).toEqual({ interest: 0.3, urgency: 0.3, novelty: 0.4 });
    expect(REC_PARAMS.diversityEvery).toBe(4);
    expect(REC_PARAMS.topCategories).toBe(2);
    expect(REC_PARAMS.maxRecent).toBe(20);
  });
});

describe("soğuk başlangıç", () => {
  const candidates = [cand("a", ["Spor"]), cand("b", ["Enerji"]), cand("c", [])];

  it("sinyal yoksa varsayılan sıra aynen döner (personalized: false; puan ve gerekçe null)", () => {
    const r = rank([], candidates);
    expect(r.personalized).toBe(false);
    expect(r.items).toEqual([
      { id: "a", score: null, reason: null },
      { id: "b", score: null, reason: null },
      { id: "c", score: null, reason: null },
    ]);
  });

  it("yalnız 180 günden eski sinyaller ve kategorisiz hedefler de soğuk başlangıçtır", () => {
    expect(rank([sig("author", "p:1", ["Spor"], 181), sig("saved", "p:2", ["Enerji"], 400)], candidates).personalized).toBe(false);
    expect(rank([sig("author", "p:3", [])], candidates).personalized).toBe(false);
    expect(rank([sig("author", "p:1", ["Spor"], 179)], candidates).personalized).toBe(true);
  });
});

describe("ilgi profili", () => {
  it("L2 normalize; üst kategoriye yarı ağırlıkla yayılır", () => {
    const p = buildInterestProfile([sig("author", "p:1", ["YesilAlan"])], CATS, NOW);
    const sq = Object.values(p.weights).reduce((s, w) => s + w * w, 0);
    expect(sq).toBeCloseTo(1, 12);
    expect(p.weights[fy("Cevre")] / p.weights[fy("YesilAlan")]).toBeCloseTo(0.5, 12);
    expect(p.top).toEqual([fy("YesilAlan"), fy("Cevre")]);
  });

  it("zaman sönümü: 30 günlük sinyal yarı ağırlıktadır", () => {
    const p = buildInterestProfile([sig("author", "p:1", ["Spor"], 0), sig("author", "p:2", ["Enerji"], 30)], CATS, NOW);
    expect(p.weights[fy("Spor")] / p.weights[fy("Enerji")]).toBeCloseTo(2, 9);
  });

  it("ağırlıklar: yazarlık 3, destek 2, açma 0,5 (zaman bilinmeyen açma sönümsüz)", () => {
    const p = buildInterestProfile([sig("author", "p:1", ["Spor"]), sig("sponsor", "p:2", ["Enerji"]), sig("open", "p:3", ["Okullar"], null)], CATS, NOW);
    expect(p.weights[fy("Spor")] / p.weights[fy("Enerji")]).toBeCloseTo(3 / 2, 9);
    expect(p.weights[fy("Spor")] / p.weights[fy("Okullar")]).toBeCloseTo(3 / 0.5, 9);
  });

  it("bir hedefteki mesajların katkısı üst sınırlıdır; yinelenen açma bir kez sayılır", () => {
    const many = Array.from({ length: 10 }, (_, i) => sig("message", "p:1", ["Spor"], i * 0.01));
    const p = buildInterestProfile([...many, sig("sponsor", "p:2", ["Enerji"])], CATS, NOW);
    expect(p.weights[fy("Spor")] / p.weights[fy("Enerji")]).toBeCloseTo(REC_PARAMS.messageCapPerTarget / 2, 6);
    const once = buildInterestProfile([sig("open", "p:9", ["Spor"], null), sig("author", "p:2", ["Enerji"])], CATS, NOW);
    const twice = buildInterestProfile([sig("open", "p:9", ["Spor"], null), sig("open", "p:9", ["Spor"], null), sig("author", "p:2", ["Enerji"])], CATS, NOW);
    expect(twice).toEqual(once);
  });

  it("sinyal sırası profili değiştirmez", () => {
    const signals = [sig("author", "p:1", ["Spor", "Etkinlik"], 3), sig("saved", "t:1", ["YesilAlan"], 10), sig("message", "p:4", ["Enerji"], 1), sig("message", "p:4", ["Enerji"], 2)];
    const a = buildInterestProfile(signals, CATS, NOW);
    const b = buildInterestProfile([...signals].reverse(), CATS, NOW);
    expect(b).toEqual(a);
  });
});

describe("sıralama", () => {
  it("ilgi alanındaki öneri öne geçer; kardeş kategori ilgisizden öndedir (üst kategori yayılımı)", () => {
    const r = rank([sig("author", "p:1", ["YesilAlan"])], [cand("ilgisiz", ["Spor"]), cand("kardes", ["Enerji"]), cand("ayni", ["YesilAlan"])]);
    expect(r.personalized).toBe(true);
    expect(ids(r)).toEqual(["ayni", "kardes", "ilgisiz"]);
    const byId = new Map(r.items.map((i) => [i.id, i]));
    expect(byId.get("ayni")!.score!).toBeGreaterThan(byId.get("kardes")!.score!);
    expect(byId.get("kardes")!.score!).toBeGreaterThan(byId.get("ilgisiz")!.score!);
    for (const i of r.items) expect(i.score).toBeGreaterThanOrEqual(0);
    for (const i of r.items) expect(i.score).toBeLessThanOrEqual(1);
  });

  it("aynı ilgi düzeyinde evre bitişi yakın olan öndedir (aciliyet); kapanmış öneride aciliyet yoktur", () => {
    const r = rank(
      [sig("author", "p:1", ["Spor"])],
      [
        cand("uzak", ["Spor"], { phaseEndsAt: NOW + 6 * DAY }),
        cand("kapali", ["Spor"], { phaseEndsAt: NOW + 1 * DAY, active: false }),
        cand("yakin", ["Spor"], { phaseEndsAt: NOW + 1 * DAY }),
      ],
    );
    expect(ids(r)).toEqual(["yakin", "uzak", "kapali"]);
  });

  it("yenilik: eşit olanlarda yeni öneri öndedir", () => {
    const r = rank([sig("author", "p:1", ["Spor"])], [cand("eski", ["Spor"], { createdAt: NOW - 90 * DAY }), cand("yeni", ["Spor"], { createdAt: NOW - DAY })]);
    expect(ids(r)).toEqual(["yeni", "eski"]);
  });

  it("çeşitlilik: her 4. konuma en çok ilgilenilen 2 kategori dışından en yüksek puanlı öneri gelir", () => {
    const inside = Array.from({ length: 9 }, (_, i) => cand(`ic${i}`, [i % 2 ? "YesilAlan" : "AtikGeriDonusum"], { createdAt: NOW - (i + 1) * DAY }));
    const outside = [cand("dis-eski", ["Spor"], { createdAt: NOW - 50 * DAY }), cand("dis-yeni", ["TopluTasima"], { createdAt: NOW - 2 * DAY })];
    const r = rank([sig("author", "p:1", ["YesilAlan"]), sig("saved", "p:2", ["AtikGeriDonusum"])], [...outside, ...inside]);
    const order = ids(r);
    expect(order[3]).toBe("dis-yeni");
    expect(order[7]).toBe("dis-eski");
    expect(r.items[3].reason).toEqual({ kind: "diverse", text: "Farklı bir alandan", categories: [] });
    expect(order.slice(0, 3).every((id) => id.startsWith("ic"))).toBe(true);
    expect(order.filter((_, i) => (i + 1) % 4 !== 0).every((id) => id.startsWith("ic"))).toBe(true);
  });

  it("çeşitlilik konumundaki öneri listedeyse gerekçesi 'Listenizde' olur (öncelik)", () => {
    const inside = Array.from({ length: 3 }, (_, i) => cand(`ic${i}`, ["YesilAlan"], { createdAt: NOW - (i + 1) * DAY }));
    const r = rank([sig("author", "p:1", ["YesilAlan"])], [...inside, cand("dis-liste", ["Spor"], { saved: true })]);
    expect(r.items[3]).toMatchObject({ id: "dis-liste", reason: { kind: "saved", text: "Listenizde" } });
  });

  it("çeşitlilik dışlaması en güçlü kategorilerin ÜST kategorilerini de kapsar: aynı kökteki kardeş 'Farklı bir alandan' sayılmaz", () => {
    // Profil: Enerji ve Katılımcı bütçe en güçlü iki kategori (üstleri Çevre ve Bütçe). "Parklar" Enerji'nin kardeşidir (Çevre altında).
    const signals = [sig("author", "p:1", ["Enerji"]), sig("author", "p:2", ["KatilimciButce"])];
    const profile = buildInterestProfile(signals, CATS, NOW);
    expect(profile.top).toEqual([fy("Enerji"), fy("KatilimciButce")]);
    const inside = Array.from({ length: 3 }, (_, i) => cand(`ic${i}`, ["Enerji"], { createdAt: NOW - (i + 1) * DAY }));
    const r = rank(signals, [...inside, cand("kardes", ["YesilAlan"], { createdAt: NOW - DAY }), cand("dis", ["Spor"], { createdAt: NOW - 40 * DAY })]);
    expect(r.items[3]).toMatchObject({ id: "dis", reason: { kind: "diverse" } });
    expect(r.items.find((i) => i.id === "kardes")?.reason?.kind).not.toBe("diverse");
  });

  it("dışarıdan aday yoksa 4. konum olağan sırayla dolar", () => {
    const r = rank([sig("author", "p:1", ["YesilAlan"])], Array.from({ length: 6 }, (_, i) => cand(`ic${i}`, ["YesilAlan"], { createdAt: NOW - i * DAY })));
    expect(ids(r)).toEqual(["ic0", "ic1", "ic2", "ic3", "ic4", "ic5"]);
    expect(r.items.some((i) => i.reason?.kind === "diverse")).toBe(false);
  });

  it("gerekçeler: listenizde, ilgi (etiketlerle), süresi yaklaşıyor, yeni, genel", () => {
    const r = rank(
      [sig("author", "p:1", ["Enerji"]), sig("sponsor", "p:2", ["Enerji"])],
      [
        cand("enerji", ["Enerji"]),
        cand("liste", ["Okullar"], { saved: true }),
        cand("acil", ["Spor"], { phaseEndsAt: NOW + DAY }),
        cand("yeni", ["Spor"], { createdAt: NOW - DAY }),
        cand("genel", ["Spor"]),
      ],
    );
    const reason = (id: string) => r.items.find((i) => i.id === id)!.reason;
    expect(reason("enerji")).toEqual({ kind: "interest", text: "Enerji (Çevre) ile ilgilendiğiniz için", categories: [fy("Enerji"), fy("Cevre")] });
    expect(reason("liste")).toEqual({ kind: "saved", text: "Listenizde", categories: [] });
    expect(reason("acil")?.text).toBe("Süresi yaklaşıyor");
    expect(["Yeni", "Farklı bir alandan"]).toContain(reason("yeni")?.text);
    expect(["Genel sıralama", "Farklı bir alandan"]).toContain(reason("genel")?.text);
    expect(r.items.every((i) => i.reason !== null && i.reason.text.length > 0)).toBe(true);
  });

  it("gerekçe metni: üst-alt çifti 'Alt (Üst)'; virgüllü ya da 've'li etiketler tırnakla ayrılır (belirsizlik yok)", () => {
    expect(rank([sig("author", "p:1", ["YesilAlan"])], [cand("park", ["YesilAlan"])]).items[0].reason?.text).toBe("Parklar ve yeşil alanlar (Çevre) ile ilgilendiğiniz için");
    expect(rank([sig("sponsor", "p:1", ["Spor"])], [cand("s", ["Spor"])]).items[0].reason).toEqual({
      kind: "interest",
      text: "Spor (Kültür, sanat ve spor) ile ilgilendiğiniz için",
      categories: [fy("Spor"), fy("KulturSpor")],
    });
    const twoRoots = rank([sig("author", "p:1", ["KulturSpor"]), sig("author", "p:2", ["Ulasim"])], [cand("iki", ["KulturSpor", "Ulasim"])]);
    expect(twoRoots.items[0].reason?.text).toBe("‘Kültür, sanat ve spor’ ve ‘Ulaşım’ ile ilgilendiğiniz için");
    const plain = rank([sig("author", "p:1", ["Okullar"]), sig("author", "p:2", ["Spor"])], [cand("iki", ["Okullar", "Spor"])]);
    expect(plain.items[0].reason?.text).toMatch(/^(Okullar|Spor)/);
    expect(plain.items[0].reason?.text).not.toMatch(/,.*ile ilgilendiğiniz/);
  });

  it("gerekçede aynı ailenin sırası katkıdan bağımsızdır: her zaman önce alt kategori", () => {
    const cands = [cand("tt", ["TopluTasima"])];
    // Alt kategori baskın
    const a = rank([sig("author", "p:1", ["TopluTasima"])], cands).items[0].reason;
    // Üst kategori baskın (kök kategoride çok sinyal)
    const b = rank([sig("author", "p:1", ["TopluTasima"]), sig("author", "p:2", ["Ulasim"]), sig("author", "p:3", ["Ulasim"]), sig("author", "p:4", ["Ulasim"])], cands).items[0].reason;
    expect(a).toEqual({ kind: "interest", text: "Toplu taşıma (Ulaşım) ile ilgilendiğiniz için", categories: [fy("TopluTasima"), fy("Ulasim")] });
    expect(b).toEqual(a);
  });

  it("katılınmış öneri (yazdığı/desteklediği/mesaj yazdığı) yalnız ilgi puanıyla görülmemiş adayın önüne geçmez; çeşitliliğe seçilmez", () => {
    const signals = [sig("sponsor", "proposal:kendi", ["YesilAlan"]), sig("author", "proposal:baska", ["YesilAlan"], 2)];
    const r = rank(signals, [cand("kendi", ["YesilAlan"], { engaged: true }), cand("gorulmemis", ["YesilAlan"])]);
    expect(ids(r)).toEqual(["gorulmemis", "kendi"]);
    const byId = new Map(r.items.map((i) => [i.id, i]));
    expect(byId.get("kendi")!.reason).toEqual({ kind: "engaged", text: "Katıldığınız öneri", categories: [] });
    expect(byId.get("gorulmemis")!.reason?.kind).toBe("interest");
    // İlgi terimi 0: puan yalnız aciliyet + yenilik (ikisi de aynı; görülmemişin ilgi katkısı kadar geride)
    expect(byId.get("gorulmemis")!.score! - byId.get("kendi")!.score!).toBeGreaterThan(0.3);
    // Süresi yaklaşan katılınmış öneri: aciliyet gerekçesi önce gelir (gerçek sıralama nedeni)
    const urgent = rank(signals, [cand("kendi", ["YesilAlan"], { engaged: true, phaseEndsAt: NOW + DAY })]).items[0].reason;
    expect(urgent?.kind).toBe("urgent");
    // Çeşitlilik konumuna katılınmış öneri seçilmez
    const inside = Array.from({ length: 3 }, (_, i) => cand(`ic${i}`, ["YesilAlan"], { createdAt: NOW - (i + 1) * DAY }));
    const div = rank(signals, [...inside, cand("kendi-spor", ["Spor"], { engaged: true }), cand("spor", ["Spor"], { createdAt: NOW - 90 * DAY })]);
    expect(div.items[3]).toMatchObject({ id: "spor", reason: { kind: "diverse" } });
    expect(div.items.find((i) => i.id === "kendi-spor")?.reason?.kind).toBe("engaged");
    // engaged verilmezse false sayılır (eski çağıranlar)
    expect(rank(signals, [cand("x", ["YesilAlan"])]).items[0].reason?.kind).toBe("interest");
  });

  it("puan ağırlıkları çağırandan verilebilir (açık öneriler: REC_PARAMS.scoreOpen); küme ve gerekçe kuralları aynı kalır", () => {
    const signals = [sig("author", "p:1", ["Spor"])];
    const candidates = [cand("ilgili-eski", ["Spor"], { createdAt: NOW - 30 * DAY }), cand("ilgisiz-yeni", ["Okullar"], { createdAt: NOW })];
    const profile = buildInterestProfile(signals, CATS, NOW);
    const general = rankForUser({ profile, candidates, categories: CATS, now: NOW });
    const open = rankForUser({ profile, candidates, categories: CATS, now: NOW, score: REC_PARAMS.scoreOpen });
    expect(ids(general)).toEqual(["ilgili-eski", "ilgisiz-yeni"]);
    expect(ids(open)).toEqual(["ilgisiz-yeni", "ilgili-eski"]);
    expect(open.items.find((i) => i.id === "ilgili-eski")?.reason?.kind).toBe("interest");
  });
});

describe("özellikler (rastgele girdilerle, belirlenimci tohum)", () => {
  const kinds = REC_SIGNAL_KINDS;
  function scenario(seed: number): { signals: RecSignal[]; candidates: RecCandidate[] } {
    const rnd = lcg(seed);
    const pick = () => LOCALS[Math.floor(rnd() * LOCALS.length)];
    const signals = Array.from({ length: Math.floor(rnd() * 12) }, (_, i) =>
      sig(kinds[Math.floor(rnd() * kinds.length)], `p:${Math.floor(rnd() * 6)}`, rnd() < 0.1 ? [] : [pick(), ...(rnd() < 0.3 ? [pick()] : [])], rnd() < 0.15 ? null : rnd() * 240 + i * 0),
    );
    const candidates = Array.from({ length: Math.floor(rnd() * 25) }, (_, i) =>
      cand(`c${i}`, rnd() < 0.1 ? [] : [pick()], {
        createdAt: NOW - Math.floor(rnd() * 100) * DAY,
        phaseEndsAt: rnd() < 0.3 ? null : NOW + Math.floor((rnd() - 0.2) * 10 * DAY),
        active: rnd() < 0.7,
        saved: rnd() < 0.1,
        engaged: rnd() < 0.15,
      }),
    );
    return { signals, candidates };
  }

  it("aynı küme: çıktı girdinin permütasyonudur (hiçbir öneri düşmez, yinelenmez)", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { signals, candidates } = scenario(seed);
      const out = ids(rank(signals, candidates));
      expect(out.length, `tohum ${seed}`).toBe(candidates.length);
      expect([...out].sort(), `tohum ${seed}`).toEqual(candidates.map((c) => c.id).sort());
    }
  });

  it("belirlenimci: aynı girdi (sinyaller karıştırılmış olsa da) aynı sırayı, puanı ve gerekçeyi verir", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { signals, candidates } = scenario(seed);
      const a = rank(signals, candidates);
      const shuffled = [...signals].sort((x, y) => (x.target + x.kind + String(x.at)).localeCompare(y.target + y.kind + String(y.at))).reverse();
      expect(rank(shuffled, candidates), `tohum ${seed}`).toEqual(a);
      expect(rank(signals, candidates), `tohum ${seed}`).toEqual(a);
    }
  });

  it("çeşitlilik konumu her zaman profilin en güçlü 2 kategorisi ve bunların üst kategorileri dışından gelir; katılınmış öneri olmaz", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { signals, candidates } = scenario(seed);
      const profile = buildInterestProfile(signals, CATS, NOW);
      const r = rankForUser({ profile, candidates, categories: CATS, now: NOW });
      const top = new Set(profile.top);
      for (const t of profile.top) for (let p = CATS.find((k) => k.iri === t)?.parent ?? null; p; p = CATS.find((k) => k.iri === p)?.parent ?? null) top.add(p);
      for (const [pos, item] of r.items.entries()) {
        if (item.reason?.kind !== "diverse") continue;
        expect((pos + 1) % REC_PARAMS.diversityEvery, `tohum ${seed}`).toBe(0);
        const c = candidates.find((x) => x.id === item.id)!;
        const expanded = new Set<string>();
        for (const iri of c.categories) {
          expanded.add(iri);
          for (let p = CATS.find((k) => k.iri === iri)?.parent ?? null; p; p = CATS.find((k) => k.iri === p)?.parent ?? null) expanded.add(p);
        }
        expect([...expanded].some((k) => top.has(k)), `tohum ${seed}`).toBe(false);
        expect(c.engaged, `tohum ${seed}`).not.toBe(true);
      }
    }
  });
});

describe("ölçüm: ilgi örüntüsü olan yapay toplulukta (gerileme koruması)", () => {
  // Demo tohumunda etkileşimler ilgiden bağımsızdır (destekçiler görüş bloğuna göre karıştırılır), bu yüzden orada kişisel sıranın
  // faydası ölçülemez (docs/ALGORITMA.md "Ölçüm"). Burada her üyenin 1–2 ilgi kategorisi ve etkileşimlerinin %80'i bu kategorilerde;
  // önerilerin yaşı ilgiden bağımsız. Bir-dışarıda: her etkileşilen öneri sinyalleriyle birlikte saklanır, kalanlarla sıralanır.
  // Ağırlıklar yeniliğe kayıp ilgi işlevsizleşirse ya da katılınmış öneriler yine başa yerleşirse bu test kırılır.
  const LEAVES = CATEGORY_VOCAB.filter((c) => c.parent).map((c) => c.local);
  interface Item {
    id: string;
    cats: string[];
    createdAt: number;
  }
  function world(seed: number) {
    const rnd = lcg(seed);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
    const items: Item[] = Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, cats: [pick(LEAVES)], createdAt: NOW - Math.floor(rnd() * 60) * DAY }));
    const users = Array.from({ length: 40 }, () => {
      const interests = rnd() < 0.5 ? [pick(LEAVES)] : [pick(LEAVES), pick(LEAVES)];
      const liked = items.filter((it) => interests.includes(it.cats[0]));
      const touched = new Set<Item>();
      for (let k = 0; k < 7; k++) touched.add(rnd() < 0.8 && liked.length ? pick(liked) : pick(items));
      return [...touched].map((it) => ({ it, kind: pick(["sponsor", "message", "author"] as const), age: Math.floor(rnd() * 90) }));
    });
    return { items, users };
  }
  function mrr(seed: number, engagedFlags: boolean): { personal: number; newest: number; random: number; n: number } {
    const { items, users } = world(seed);
    const newestOrder = [...items].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    let personal = 0;
    let newest = 0;
    let random = 0;
    let n = 0;
    for (const touches of users) {
      if (touches.length < 3) continue;
      for (const held of touches) {
        const train = touches.filter((t) => t !== held);
        const signals = train.map((t) => sig(t.kind, `proposal:${t.it.id}`, t.it.cats, t.age));
        const engaged = new Set(train.map((t) => t.it.id));
        const candidates = newestOrder.map((it) => cand(it.id, it.cats, { createdAt: it.createdAt, engaged: engagedFlags && engaged.has(it.id) }));
        const out = ids(rank(signals, candidates));
        personal += 1 / (out.indexOf(held.it.id) + 1);
        newest += 1 / (newestOrder.findIndex((x) => x.id === held.it.id) + 1);
        let h = 0;
        for (let i = 1; i <= items.length; i++) h += 1 / i;
        random += h / items.length;
        n++;
      }
    }
    return { personal: personal / n, newest: newest / n, random: random / n, n };
  }

  it("kişisel sıra ilgi örüntüsünü bulur: MRR en yeniden ve rastgeleden belirgin biçimde yüksek (3 farklı tohum)", () => {
    for (const seed of [11, 22, 33]) {
      const m = mrr(seed, true);
      expect(m.n, `tohum ${seed}`).toBeGreaterThan(150);
      expect(m.personal, `tohum ${seed}: ${JSON.stringify(m)}`).toBeGreaterThan(m.newest * 1.5);
      expect(m.personal, `tohum ${seed}: ${JSON.stringify(m)}`).toBeGreaterThan(m.random * 2);
    }
  });

  it("katılınmış öneriler işaretlenince (ilgi 0) saklanan öneri daha iyi bulunur (kendini besleyen döngü yok)", () => {
    for (const seed of [11, 22, 33]) {
      const flagged = mrr(seed, true);
      const unflagged = mrr(seed, false);
      expect(flagged.personal, `tohum ${seed}`).toBeGreaterThan(unflagged.personal);
    }
  });
});
