// Kişisel öneri sıralaması (Öneriler → "Size göre", ana sayfa "Şu an açık"): SAF, belirlenimci ve açıklanabilir bir işlev.
//
// GİRDİ yalnız şu etkileşim türleridir (REC_SIGNAL_KINDS): yazarlık, listeye ekleme, destekleme (eş imza), mesaj yazma ve
// istemcinin YALNIZ kendi cihazında tuttuğu "son açılanlar". Oy içeriği, oy verip vermediği, itiraz imzası ve azınlık raporu bu
// tiplerde BİLEREK YOKTUR (oy gizliliği; siyasi görüş KVKK md. 6 kapsamında özel nitelikli veridir) — bilinmeyen bir sinyal türü
// verilse bile yok sayılır. Ayrıntı: docs/ALGORITMA.md "Kişisel sıralama".
//
// YÖNTEM (içerik tabanlı; model ya da dış hizmet yok; maliyet O(sinyal + aday)):
//   1. İlgi profili: son 180 gündeki her sinyal, hedefinin (öneri ya da konu) kategori vektörüne eklenir. Kategori vektörü: açık
//      kategori 1, ontolojideki üst kategori yarısı (bir üst düzey bir öncekinin yarısı), birim uzunluğa ölçeklenmiş. Katkı =
//      tür ağırlığı × 0,5^(yaş / 30 gün). Bir hedefteki mesajların toplam katkısı üst sınırlıdır. Profil L2 normalize edilir.
//   2. Puan = 0,6 · kosinüs(profil, öneri) + 0,2 · aciliyet (evre bitişine yakınlık) + 0,2 · yenilik; süren (açık) öneriler —
//      ana sayfa "Şu an açık" ve kişisel listenin açık bölümü, "şimdi harekete geç" listesi — 0,3 / 0,3 / 0,4 ile sıralanır
//      (ağırlıklar ölçümle seçildi: docs/ALGORITMA.md "Kişisel sıralama" › ölçüm; çağıran `score` ile seçer). Görüntüleyenin ZATEN
//      katıldığı (yazdığı, desteklediği ya da mesaj yazdığı) öneride ilgi terimi 0 sayılır: profil o önerilerden kurulduğu için
//      kendi kategorileriyle en yüksek kosinüsü alır ve kişiye zaten bildiğini en başta gösterirdi (kendini besleyen döngü).
//   3. Çeşitlilik: her 4. konuma, profilin en güçlü 2 kategorisi ve bunların üst kategorileri DIŞINDAN en yüksek puanlı öneri
//      (varsa; katılınmış öneriler hariç) yerleşir.
//   4. Hiçbir öneri düşmez ya da gizlenmez: çıktı girdi kümesinin bir permütasyonudur. Profil boşsa (soğuk başlangıç) girdi sırası
//      aynen döner ve `personalized: false` olur.
//   Belirlenimcilik: sinyaller toplanmadan önce kanonik sıraya dizilir, puanlar 6 basamağa yuvarlanır, eşitlikte girdi sırası korunur.

const DAY_MS = 86_400_000;

/** Kullanılan etkileşim türleri (TAM liste; testler bu listenin dışına çıkılmadığını denetler). */
export const REC_SIGNAL_KINDS = ["author", "saved", "sponsor", "message", "open"] as const;
export type RecSignalKind = (typeof REC_SIGNAL_KINDS)[number];

/** Algoritmanın tüm sabitleri (belgedeki değerlerle birebir; değiştirmek davranışı değiştirir). */
export const REC_PARAMS = {
  /** Sinyal ağırlıkları: yazarlık 3, listeye ekleme 3, destekleme 2, mesaj 2 (hedef başına üst sınırlı), açma 0,5 */
  weights: { author: 3, saved: 3, sponsor: 2, message: 2, open: 0.5 } as Readonly<Record<RecSignalKind, number>>,
  /** Bir hedefteki (öneri/konu) mesajların toplam katkı üst sınırı */
  messageCapPerTarget: 3,
  /** Yalnız bu kadar yeni sinyaller (ms) */
  windowMs: 180 * DAY_MS,
  /** Zaman sönümü yarı ömrü (ms) */
  halfLifeMs: 30 * DAY_MS,
  /** Üst kategoriye yayılma katsayısı (her düzeyde) */
  ancestorFactor: 0.5,
  /** Puan bileşenlerinin ağırlıkları (genel: kapanmış öneriler ve süzgeçli listeler) */
  score: { interest: 0.6, urgency: 0.2, novelty: 0.2 } as Readonly<RecScoreWeights>,
  /**
   * Süren (açık) önerilerin ağırlıkları: ana sayfa "Şu an açık" ve kişisel listenin açık bölümü aynı sırayı verir. Aciliyet ve
   * yenilik daha ağır basar; ilgi yine katkı verir ve gerekçe çipleri değişmez.
   */
  scoreOpen: { interest: 0.3, urgency: 0.3, novelty: 0.4 } as Readonly<RecScoreWeights>,
  /** Aciliyet ufku: evre bitişine bu süre ve daha fazlası varsa aciliyet 0, bittiği anda 1 (doğrusal) */
  urgencyHorizonMs: 7 * DAY_MS,
  /** Yenilik yarı ömrü (önerinin oluşturulmasından beri) */
  noveltyHalfLifeMs: 14 * DAY_MS,
  /** Çeşitlilik: her N. konum (1 tabanlı: 4, 8, 12, …) */
  diversityEvery: 4,
  /** "En çok ilgilenilen" kategori sayısı (çeşitlilik bunların dışından seçer) */
  topCategories: 2,
  /** "… ile ilgilendiğiniz için" gerekçesi için asgari kosinüs */
  interestReasonMin: 0.2,
  /** "Süresi yaklaşıyor" gerekçesi: evre bitişine en çok bu kadar kaldıysa */
  urgentWithinMs: 2 * DAY_MS,
  /** "Yeni" gerekçesi: en çok bu kadar önce oluşturulduysa */
  newWithinMs: 7 * DAY_MS,
  /** İstemcinin gönderebileceği "son açılanlar" sayısı üst sınırı */
  maxRecent: 20,
} as const;

/**
 * "Son açılanlar"ın (istemcinin YALNIZ kendi cihazında tuttuğu, en çok 20 öneri kimliği, virgülle ayrılmış) gittiği istek başlığı:
 * GET /api/proposals?sort=sana-gore ve GET /api/dashboard. Adres satırında (sorgu dizesinde) gönderilmez: ters vekil ve CDN erişim
 * günlükleri isteğin adresini düz yazar, başlık değerlerini varsayılan olarak yazmaz. Sunucu sorgu dizesindeki `recent`'i reddeder.
 */
export const REC_RECENT_HEADER = "X-Forum-Recent";

/** Bir etkileşim sinyali. Oy, itiraz ve azınlık raporu türü YOKTUR (bkz. dosya başı). */
export interface RecSignal {
  kind: RecSignalKind;
  /** Hedef anahtarı (ör. "proposal:<id>", "topic:<id>"); mesaj üst sınırı ve yinelenen "open" bu anahtara göre uygulanır */
  target: string;
  /** Hedefin ontoloji kategorileri (tam IRI) */
  categories: readonly string[];
  /** Sinyal anı (ms). null: zamanı bilinmeyen "son açılan" (istemcinin cihazında; sönüm uygulanmaz) */
  at: number | null;
}

/** Ontoloji kategorisi (sınıf hiyerarşisi için yalnız üst kategori ve etiket gerekir). */
export interface RecCategory {
  iri: string;
  label: string;
  parent: string | null;
}

export interface InterestProfile {
  /** L2 normalize kategori ağırlıkları (IRI → ağırlık); boşsa soğuk başlangıç */
  weights: Readonly<Record<string, number>>;
  /** En güçlü kategoriler (en çok REC_PARAMS.topCategories; ağırlık azalan, eşitlikte IRI) */
  top: readonly string[];
}

/** Sıralanacak öneri. */
export interface RecCandidate {
  id: string;
  categories: readonly string[];
  createdAt: number;
  phaseEndsAt: number | null;
  /** Evre süresi işleyen (taslak ve kapanmış olmayan) öneri mi; değilse aciliyet 0 */
  active: boolean;
  /** Görüntüleyenin listesinde mi ("Listenizde" gerekçesi) */
  saved: boolean;
  /**
   * Görüntüleyen bu öneriye zaten katıldı mı: yazarı, destekçisi ya da mesaj yazmış (son 180 gün). true ise ilgi terimi 0 sayılır,
   * çeşitlilik konumuna seçilmez ve gerekçesi (aciliyet yoksa) "Katıldığınız öneri" olur. Listeye ekleme ve açma katılım sayılmaz.
   * Oy, oy verip vermediği ve itiraz imzası burada da YOKTUR. Verilmezse false.
   */
  engaged?: boolean;
}

/**
 * Gerekçe türü (öncelik sırasıyla): saved = listenizde, diverse = çeşitlilik konumu, interest = ilgi alanı, urgent = süresi
 * yaklaşıyor, engaged = katıldığınız öneri, new = yeni, general = genel sıra.
 */
export type RankReasonKind = "diverse" | "saved" | "interest" | "urgent" | "engaged" | "new" | "general";

export interface RankReason {
  kind: RankReasonKind;
  /** Kısa Türkçe gerekçe (çip metni), ör. "Enerji (Çevre) ile ilgilendiğiniz için", "Listenizde", "Süresi yaklaşıyor" */
  text: string;
  /**
   * kind = "interest" ise eşleşen kategori IRI'leri (en çok 2): biri ötekinin üst kategorisiyse önce alt (özel) olan, değilse
   * güçlüden zayıfa; diğer türlerde boş.
   */
  categories: string[];
}

/** Puan bileşenlerinin ağırlıkları (toplamı 1). */
export interface RecScoreWeights {
  interest: number;
  urgency: number;
  novelty: number;
}

export interface RankedEntry {
  id: string;
  /** Kişisel puan [0, 1] (6 basamak); soğuk başlangıçta null */
  score: number | null;
  /** Kısa gerekçe; soğuk başlangıçta null */
  reason: RankReason | null;
}

export interface RankOutput {
  /** false: profil boş (soğuk başlangıç) — `items` girdi sırasındadır */
  personalized: boolean;
  /** Girdi kümesinin TAMAMI (hiçbir öğe düşmez), kişisel sırada */
  items: RankedEntry[];
}

const KIND_SET: ReadonlySet<string> = new Set(REC_SIGNAL_KINDS);
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function indexCategories(categories: readonly RecCategory[]): Map<string, RecCategory> {
  return new Map(categories.map((c) => [c.iri, c] as const));
}

/** Kategori vektörü: açık kategoriler 1; her üst kategori bir alt düzeyin `ancestorFactor` katı (en büyüğü tutulur). */
function categoryVector(cats: readonly string[], index: ReadonlyMap<string, RecCategory>): Map<string, number> {
  const v = new Map<string, number>();
  for (const c of [...new Set(cats)].filter(Boolean).sort(byString)) {
    v.set(c, 1);
    const seen = new Set([c]);
    let w = 1;
    for (let p = index.get(c)?.parent ?? null; p && !seen.has(p) && seen.size <= 32; p = index.get(p)?.parent ?? null) {
      seen.add(p);
      w *= REC_PARAMS.ancestorFactor;
      if ((v.get(p) ?? 0) < w) v.set(p, w);
    }
  }
  return v;
}

/** L2 birim vektör (anahtarlar IRI sırasında; boş/sıfır vektör boş döner). */
function unit(v: ReadonlyMap<string, number>): Map<string, number> {
  const keys = [...v.keys()].sort(byString);
  let sq = 0;
  for (const k of keys) sq += v.get(k)! * v.get(k)!;
  const out = new Map<string, number>();
  if (sq <= 0) return out;
  const n = Math.sqrt(sq);
  for (const k of keys) if (v.get(k)! > 0) out.set(k, v.get(k)! / n);
  return out;
}

const signalOrder = (a: RecSignal, b: RecSignal): number =>
  byString(a.target, b.target) || byString(a.kind, b.kind) || (a.at ?? -1) - (b.at ?? -1) || byString(a.categories.join(" "), b.categories.join(" "));

/**
 * İlgi profili. Bilinmeyen sinyal türleri, pencere dışındaki (180 günden eski) sinyaller ve kategorisi olmayan hedefler katkı
 * vermez. Sinyallerin sırası sonucu değiştirmez.
 */
export function buildInterestProfile(signals: readonly RecSignal[], categories: readonly RecCategory[], now: number): InterestProfile {
  const index = indexCategories(categories);
  const perTarget = new Map<string, { cats: readonly string[]; weight: number; message: number }>();
  const opened = new Set<string>();
  for (const s of [...signals].sort(signalOrder)) {
    if (!KIND_SET.has(s.kind)) continue;
    let decay = 1;
    if (s.at !== null) {
      const age = Math.max(0, now - s.at);
      if (!(age <= REC_PARAMS.windowMs)) continue;
      decay = Math.pow(0.5, age / REC_PARAMS.halfLifeMs);
    }
    if (s.kind === "open") {
      if (opened.has(s.target)) continue;
      opened.add(s.target);
    }
    const c = REC_PARAMS.weights[s.kind] * decay;
    const t = perTarget.get(s.target) ?? { cats: s.categories, weight: 0, message: 0 };
    if (s.kind === "message") t.message += c;
    else t.weight += c;
    perTarget.set(s.target, t);
  }
  const acc = new Map<string, number>();
  for (const key of [...perTarget.keys()].sort(byString)) {
    const t = perTarget.get(key)!;
    const total = t.weight + Math.min(REC_PARAMS.messageCapPerTarget, t.message);
    if (!(total > 0)) continue;
    for (const [cat, w] of unit(categoryVector(t.cats, index))) acc.set(cat, (acc.get(cat) ?? 0) + total * w);
  }
  const normalized = unit(acc);
  const weights: Record<string, number> = {};
  for (const [k, w] of normalized) weights[k] = w;
  const top = [...normalized.entries()]
    .sort((a, b) => b[1] - a[1] || byString(a[0], b[0]))
    .slice(0, REC_PARAMS.topCategories)
    .map(([k]) => k);
  return { weights, top };
}

function labelOf(iri: string, index: ReadonlyMap<string, RecCategory>): string {
  const l = index.get(iri)?.label;
  if (l) return l;
  const hash = iri.lastIndexOf("#");
  return hash >= 0 ? iri.slice(hash + 1) : iri;
}

/** `anc`, `iri`nin (bir ya da daha çok düzey) üst kategorisi mi? */
function isAncestor(anc: string, iri: string, index: ReadonlyMap<string, RecCategory>): boolean {
  const seen = new Set([iri]);
  for (let p = index.get(iri)?.parent ?? null; p && !seen.has(p) && seen.size <= 32; p = index.get(p)?.parent ?? null) {
    if (p === anc) return true;
    seen.add(p);
  }
  return false;
}

/**
 * Eşleşen kategorilerin gerekçedeki sırası: biri ötekinin üst kategorisiyse önce ALT (özel) olan; değilse verilen (katkı) sırası.
 * Böylece aynı aile her zaman aynı sırayla yazılır ("Toplu taşıma (Ulaşım)"; hiçbir zaman "Ulaşım, Toplu taşıma").
 */
function orderMatched(cats: readonly string[], index: ReadonlyMap<string, RecCategory>): string[] {
  const [a, b] = cats;
  if (a && b && isAncestor(a, b, index)) return [b, a];
  return cats.slice(0, 2);
}

/**
 * Gerekçe metni (ör. "Enerji (Çevre) ile ilgilendiğiniz için"). Üst-alt çifti "Alt (Üst)" biçiminde; ilgisiz iki kategori "A ve B";
 * etiketlerden biri zaten virgül ya da "ve" içeriyorsa (ör. "Kültür, sanat ve spor") karışmasın diye tırnaklı: "‘A’ ve ‘B’".
 */
function interestText(cats: readonly string[], index: ReadonlyMap<string, RecCategory>): string {
  const [a, b] = cats;
  const la = labelOf(a, index);
  let joined = la;
  if (b) {
    const lb = labelOf(b, index);
    if (isAncestor(b, a, index)) joined = `${la} (${lb})`;
    else joined = [la, lb].some((l) => /,| ve /i.test(l)) ? `‘${la}’ ve ‘${lb}’` : `${la} ve ${lb}`;
  }
  return `${joined} ile ilgilendiğiniz için`;
}

const REASON_TEXT: Record<Exclude<RankReasonKind, "interest">, string> = {
  diverse: "Farklı bir alandan",
  saved: "Listenizde",
  urgent: "Süresi yaklaşıyor",
  engaged: "Katıldığınız öneri",
  new: "Yeni",
  general: "Genel sıralama",
};
const plainReason = (kind: Exclude<RankReasonKind, "interest">): RankReason => ({ kind, text: REASON_TEXT[kind], categories: [] });

interface Scored {
  c: RecCandidate;
  i: number;
  v: Map<string, number>;
  u: Map<string, number>;
  engaged: boolean;
  interest: number;
  score: number;
  outside: boolean;
}

/**
 * Kişisel sıra. Aynı girdi her zaman aynı çıktıyı verir; çıktı girdi kümesinin permütasyonudur (hiçbir öneri düşmez).
 * Profil boşsa girdi sırası (varsayılan sıra) aynen döner: `personalized: false`, puan ve gerekçe null.
 * `score`: puan ağırlıkları (verilmezse {@link REC_PARAMS}.score); ölçüm ve testler içindir.
 */
export function rankForUser(input: {
  profile: InterestProfile;
  candidates: readonly RecCandidate[];
  categories: readonly RecCategory[];
  now: number;
  score?: RecScoreWeights;
}): RankOutput {
  const { profile, candidates, now } = input;
  const pw = profile.weights;
  if (Object.keys(pw).length === 0) return { personalized: false, items: candidates.map((c) => ({ id: c.id, score: null, reason: null })) };

  const index = indexCategories(input.categories);
  const P = REC_PARAMS;
  const W = input.score ?? P.score;
  // Çeşitlilik dışlaması: en güçlü kategoriler VE üst kategorileri ("Enerji" güçlüyse "Çevre" altındaki kardeşler de içeride sayılır).
  const topSet = new Set<string>();
  for (const t of profile.top) {
    topSet.add(t);
    for (let p = index.get(t)?.parent ?? null; p && !topSet.has(p); p = index.get(p)?.parent ?? null) topSet.add(p);
  }
  const scored: Scored[] = candidates.map((c, i) => {
    const v = categoryVector(c.categories, index);
    const u = unit(v);
    const engaged = c.engaged === true;
    let dot = 0;
    if (!engaged) for (const [k, w] of u) dot += w * (pw[k] ?? 0);
    const interest = clamp01(dot);
    const remaining = c.phaseEndsAt === null ? null : c.phaseEndsAt - now;
    const urgency = c.active && remaining !== null && remaining > 0 ? 1 - Math.min(1, remaining / P.urgencyHorizonMs) : 0;
    const novelty = Math.pow(0.5, Math.max(0, now - c.createdAt) / P.noveltyHalfLifeMs);
    const score = round6(W.interest * interest + W.urgency * urgency + W.novelty * novelty);
    const outside = !engaged && v.size > 0 && ![...v.keys()].some((k) => topSet.has(k));
    return { c, i, v, u, engaged, interest, score, outside };
  });

  const reasonFor = (s: Scored): RankReason => {
    if (s.c.saved) return plainReason("saved");
    if (!s.engaged && s.interest >= P.interestReasonMin) {
      const matched = [...s.u.entries()]
        .filter(([k]) => (pw[k] ?? 0) > 0)
        .map(([k, w]) => [k, w * pw[k]] as const)
        .sort((a, b) => b[1] - a[1] || byString(a[0], b[0]))
        .slice(0, 2)
        .map(([k]) => k);
      if (matched.length > 0) {
        const cats = orderMatched(matched, index);
        return { kind: "interest", text: interestText(cats, index), categories: cats };
      }
    }
    const remaining = s.c.phaseEndsAt === null ? null : s.c.phaseEndsAt - now;
    if (s.c.active && remaining !== null && remaining > 0 && remaining <= P.urgentWithinMs) return plainReason("urgent");
    if (s.engaged) return plainReason("engaged");
    if (now - s.c.createdAt <= P.newWithinMs) return plainReason("new");
    return plainReason("general");
  };

  const main = [...scored].sort((a, b) => b.score - a.score || a.i - b.i);
  const pool = main.filter((s) => s.outside);
  const used = new Set<number>();
  const items: RankedEntry[] = [];
  let mi = 0;
  let pi = 0;
  for (let pos = 1; items.length < main.length; pos++) {
    let pick: Scored | null = null;
    let diverse = false;
    if (pos % P.diversityEvery === 0) {
      while (pi < pool.length && used.has(pool[pi].i)) pi++;
      if (pi < pool.length) {
        pick = pool[pi];
        diverse = true;
      }
    }
    if (!pick) {
      while (used.has(main[mi].i)) mi++;
      pick = main[mi];
    }
    used.add(pick.i);
    // Gerekçe önceliği: listenizde > çeşitlilik konumu > ilgi > süresi yaklaşıyor > katıldığınız öneri > yeni > genel.
    items.push({ id: pick.c.id, score: pick.score, reason: diverse && !pick.c.saved ? plainReason("diverse") : reasonFor(pick) });
  }
  return { personalized: true, items };
}
