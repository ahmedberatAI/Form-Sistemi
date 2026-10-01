// Çevrimdışı hak etkisi tespiti — "nesne gerektiren" kalıplar.
// Tek başına niceleyici ya da fiil (ör. "sadece", "kaldırılsın") zayıf sinyaldir (≤ 0,3); yüksek güven için
// kısıtlayıcı fiilin hakkın NESNESİNE (kamu hizmeti, ifade, mülk, oy …) ya da eşitlikte bir KİŞİ/GRUBA yönelmesi gerekir.
import { RIGHT_VOCAB } from "@forum/shared";
import { EXPAND_CUES, PROTECTED_GROUPS } from "./lexicons";
import { contentTokens, findPhrase, sentences, tokenize, type Token } from "./text";

export interface RightFinding {
  right: string;
  direction: "restrict" | "expand";
  confidence: number;
  evidence: string[];
}

// ───────────────────────── Türkçe fiil biçimleri ─────────────────────────

const lastVowel = (s: string): string => {
  for (let i = s.length - 1; i >= 0; i--) if ("aıoueiöü".includes(s[i])) return s[i];
  return "a";
};
/** Edilgen kök → emir (-sın) ve gereklilik (-malı) biçimleri: "kapatıl" → "kapatılsın", "kapatılmalı". */
const passive = (...stems: string[]): string[] =>
  stems.flatMap((s) => {
    const v = lastVowel(s);
    const imp = "aı".includes(v) ? "sın" : "ei".includes(v) ? "sin" : "ou".includes(v) ? "sun" : "sün";
    return [s + imp, s + ("aıou".includes(v) ? "malı" : "meli")];
  });

const CLOSE_VERBS = [
  ...passive("kapatıl", "kapan", "kaldırıl", "iptal edil", "durdurul", "kesil", "ücretlendiril", "özelleştiril", "satıl", "yıkıl", "sonlandırıl", "tasfiye edil", "lağvedil"),
  "ücretli olsun", "paralı olsun", "ücretli hale getirilsin", "paralı hale getirilsin", "hizmet vermesin",
];
const REDUCE_VERBS = passive("azaltıl", "kısıtlan", "sınırlandırıl", "kısaltıl", "seyrekleştiril");
const BAN_VERBS = [
  ...passive("yasaklan", "engellen", "sansürlen", "silin", "cezalandırıl", "toplatıl", "dağıtıl", "kısıtlan", "durdurul", "kapatıl", "kaldırıl"),
  "yasak", "yasak olsun", "izin verilmesin", "yapılamasın", "yapılmasın", "yasağı getirilsin",
];
const PARTIAL = ["bir kısmı", "bir kısmının", "bir bölümü", "bir bölümünün", "kısmen", "bazı", "bir parçası"];

// ───────────────────────── Kişi / grup ifadeleri (eşitlik) ─────────────────────────

const QUANTIFIERS = ["sadece", "yalnızca", "hariç", "harici", "haricindeki", "dışındakiler"];

/** Kendiliğinden kişiyi hedefleyen dışlama fiilleri (grup olmadan da zayıf sinyal). */
const EXCLUSIONS = [
  "giremesin", "girmesin", "giremez", "girilmesin", "yararlanamasın", "yararlanmasın", "faydalanamasın", "faydalanmasın",
  "katılamasın", "katılmasın", "oy kullanamasın", "kullanamasın", "ayrı tutulsun", "hariç tutulsun", "uzak tutulsun",
  "sokulmasın", "başvuramasın", "binemesin", "oturamasın", "kiralayamasın", "çalışamasın", "üye olamasın", "dışlansın",
  "dışarıda bırakılsın", "sınır dışı edilsin",
];
/** Yalnızca bir kişi/grupla birlikte dışlama sayılan genel kısıtlama fiilleri. */
const GROUP_RESTRICTIONS = ["yasaklansın", "engellensin", "izin verilmesin", "çıkarılsın", "kabul edilmesin", "kısıtlansın"];
/** Olumsuz yeterlilik emri: "gir-eme-sin", "yararlan-ama-sın", "bin-eme-sin". */
const NEG_ABILITY = /(?:[ae]m[ae]s[ıi]n|y[ae]m[ae]s[ıi]n)(?:lar|ler)?$/u;

/** Çoğul biçimde kişi/grup bildiren kökler ("kadın" → "kadınlar", "kadınların"…). */
const GROUP_STEMS = [
  "kadın", "erkek", "yabancı", "göçmen", "mülteci", "sığınmacı", "engelli", "kiracı", "öğrenci", "vatandaş", "emekli",
  "turist", "genç", "yaşlı", "çocuk", "sakin", "işsiz", "evsiz", "misafir", "aile", "kişi", "kürt", "arap",
  "suriyeli", "afgan", "alevi", "sünni", "hristiyan", "hıristiyan", "müslüman", "gayrimüslim", "yahudi", "ermeni", "rum",
  "çingene", "eşcinsel", "ateist", "trans", "azınlık", "yerli", "köylü", "işçi", "memur", "ev sahibi", "ev sahip",
];
const PLURAL_TAIL = /^(?:lar|ler)(?:[ıi]|[ıi]n|[ıi]n[ıi]n|[ıi]n[ae]|[ıi]nd[ae]n|[ıi]nd[ae]|[ıi]n[ıi]|[ae]|d[ae]|d[ae]n|l[ae]|[ıi]m[ıi]z|[ıi]m[ıi]z[ıi]n|[ıi]m[ıi]z[ae])?$/u;
/** Kişi bildiren çoğul sıfat-fiiller. */
const PARTICIPLES = [
  "olanlar", "olmayanlar", "gelenler", "gelmeyenler", "yaşayanlar", "yaşamayanlar", "oturanlar", "oturmayanlar", "edenler",
  "etmeyenler", "çalışanlar", "kullananlar", "doğanlar", "okuyanlar", "taşınanlar", "bulunanlar", "inananlar",
  "konuşanlar", "giyenler", "taşıyanlar", "ödeyenler", "ödemeyenler", "sahipleri", "sahipler",
];
/** "-lılar/-liler" (Ankaralılar, mahalleliler) ve "-cılar/-ciler" (kiracılar, taksiciler) kişi grupları. */
const DEMONYM = /^\p{L}{3,}(?:l[ıiuü]|[cç][ıiuü])(?:lar|ler)\p{L}{0,5}$/u;

function groupIndices(tokens: Token[]): number[] {
  const out = new Set<number>();
  tokens.forEach((t, i) => {
    if (DEMONYM.test(t.norm)) out.add(i);
    if (t.norm === "lgbt" || t.norm === "lgbti" || t.norm === "esnaf") out.add(i);
    for (const s of GROUP_STEMS) {
      const words = s.split(" ");
      const head = words[words.length - 1];
      if (t.norm.startsWith(head) && PLURAL_TAIL.test(t.norm.slice(head.length))) {
        if (words.length === 1 || (i > 0 && tokens[i - 1].norm === words[0])) out.add(i);
      }
    }
  });
  for (const p of [...PARTICIPLES, ...PROTECTED_GROUPS.filter((g) => /(lar|ler)$/u.test(g))]) for (const [a] of findPhrase(tokens, p)) out.add(a);
  return [...out].sort((a, b) => a - b);
}

// ───────────────────────── Nesne gerektiren hak kuralları ─────────────────────────

interface VerbClass {
  phrases: string[];
  conf: number;
}
interface RightRule {
  objects: string[];
  verbs: VerbClass[];
  /** Nesnesiz fiil de zayıf sinyal (≤ 0,3) üretsin mi? */
  weak?: boolean;
  /** Nesne + genişletme ipucu → "expand" (yalnızca hizmet niteliğindeki haklar). */
  expand?: boolean;
  /** Nesne gerektirmeyen, kendi başına hakkı hedefleyen ifadeler (ör. "susturulsun"). */
  self?: VerbClass;
}

const PUBLIC_SERVICES = [
  "hastane", "sağlık ocağı", "aile sağlığı merkezi", "sağlık merkezi", "okul", "kreş", "kütüphane", "durak", "hat", "hattı",
  "sefer", "otobüs", "metro", "tramvay", "dolmuş", "minibüs", "vapur", "toplu taşıma", "rampa", "asansör", "park",
  "oyun alanı", "su", "elektrik", "doğalgaz", "çeşme", "tuvalet", "hizmet", "spor salonu", "havuz", "aşevi", "yurt",
  "sosyal yardım", "muhtarlık", "pazar yeri", "kaldırım", "yaya geçidi", "gençlik merkezi", "huzurevi", "bakımevi",
  "ambulans", "itfaiye", "kurs", "internet", "kültür merkezi", "taziye evi", "sığınak", "toplanma alanı",
];

const RULES: Record<string, RightRule> = {
  ErisimHakki: {
    objects: PUBLIC_SERVICES,
    verbs: [
      { phrases: CLOSE_VERBS, conf: 0.75 },
      { phrases: REDUCE_VERBS, conf: 0.45 },
    ],
    weak: true,
    expand: true,
  },
  SaglikHakki: {
    objects: ["sağlık hizmeti", "tedavi", "aşı", "ilaç", "muayene", "ambulans", "acil servis", "hastane", "sağlık ocağı", "aile hekimi", "psikolojik destek", "diyaliz"],
    verbs: [
      { phrases: [...CLOSE_VERBS, "verilmesin", "yapılmasın"], conf: 0.75 },
      { phrases: ["zorunlu", "zorunlu olsun", "zorunlu tutulsun", "mecburi olsun"], conf: 0.65 },
      { phrases: REDUCE_VERBS, conf: 0.45 },
    ],
    expand: true,
  },
  IfadeOzgurlugu: {
    objects: ["eleştiri", "ifade", "konuşma", "görüş", "düşünce", "yorum", "paylaşım", "pankart", "bildiri", "basın", "gazete", "protesto", "sosyal medya", "dilekçe"],
    verbs: [{ phrases: BAN_VERBS, conf: 0.75 }],
    self: { phrases: ["susturulsun", "sansürlensin", "konuşma yasağı", "eleştiri yasağı", "yayın yasağı", "ağzı kapatılsın"], conf: 0.75 },
  },
  OzelHayatinGizliligi: {
    objects: ["kamera", "güvenlik kamerası", "yüz tanıma", "kamera kaydı", "görüntü", "kişisel veri", "kimlik bilgisi", "kimlik numarası", "adres", "telefon numarası", "konum", "parmak izi", "üye listesi", "sağlık kaydı", "oy kaydı"],
    verbs: [
      { phrases: ["izlensin", "kaydedilsin", "kayıt altına alınsın", "fişlensin", "takip edilsin", "paylaşılsın", "yayımlansın", "yayınlansın", "açıklansın", "ifşa edilsin", "toplansın", "satılsın", "herkese açık olsun", "asılsın"], conf: 0.75 },
      { phrases: ["konulsun", "kurulsun", "takılsın", "yerleştirilsin", "yaygınlaştırılsın"], conf: 0.55 },
    ],
    self: { phrases: ["fişlensin", "fişleme", "gizlice izlensin"], conf: 0.7 },
  },
  KatilimHakki: {
    objects: ["oy hakkı", "üyelik", "forum", "oylama", "seçim", "söz hakkı", "karar süreci", "genel kurul", "toplantı"],
    verbs: [{ phrases: [...passive("kaldırıl", "alın", "kısıtlan", "engellen", "sınırlandırıl", "askıya alın"), "elinden alınsın", "verilmesin", "katılamasın", "katılmasın", "kullanamasın", "çıkarılsın"], conf: 0.8 }],
    self: { phrases: ["oy kullanamasın", "oy kullanmasın", "oy veremesin", "oy vermesin", "üyelikten çıkarılsın", "oylamaya katılamasın", "oy hakkı olmasın"], conf: 0.8 },
  },
  MulkiyetHakki: {
    objects: ["ev", "konut", "mülk", "arsa", "arazi", "tarla", "dükkan", "dükkân", "bina", "işyeri", "gecekondu", "bahçe", "taşınmaz"],
    verbs: [{ phrases: [...passive("kamulaştırıl", "yıkıl", "tahliye edil", "boşaltıl", "müsadere edil"), "el konulsun", "zorla alınsın", "elinden alınsın"], conf: 0.75 }],
    self: { phrases: ["kamulaştırılsın", "kamulaştırma", "el konulsun", "müsadere edilsin"], conf: 0.65 },
  },
  ToplanmaHakki: {
    objects: ["toplantı", "gösteri", "eylem", "yürüyüş", "miting", "dernek", "örgüt", "sendika", "protesto", "kooperatif", "basın açıklaması", "grev", "toplanma"],
    verbs: [{ phrases: BAN_VERBS, conf: 0.75 }],
    self: { phrases: ["toplantı yasağı", "gösteri yasağı", "eylem yasağı", "toplanma yasağı"], conf: 0.8 },
  },
};

const WINDOW = 5;
const WEAK_VERB = 0.2;

function hits(tokens: Token[], phrases: string[]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of phrases) for (const h of findPhrase(tokens, p, { strict: p.length <= 3 })) if (!out.some((o) => o[0] === h[0] && o[1] === h[1])) out.push(h);
  return out;
}

const quote = (text: string, tokens: Token[], a: number, b: number) => text.slice(tokens[a].start, tokens[b].end);

interface Best {
  restrict: number;
  expand: number;
  evidence: string[];
  expandEvidence: string[];
}

function bump(best: Best, conf: number, ev: string, dir: "restrict" | "expand" = "restrict"): void {
  if (dir === "restrict") {
    if (conf > best.restrict) {
      best.restrict = conf;
      best.evidence = [ev];
    } else if (conf === best.restrict && !best.evidence.includes(ev)) best.evidence.push(ev);
  } else if (conf > best.expand) {
    best.expand = conf;
    best.expandEvidence = [ev];
  }
}

function evalEquality(text: string, sents: Token[][], best: Best): void {
  for (const st of sents) {
    const groups = groupIndices(st);
    const q = hits(st, QUANTIFIERS);
    const x = hits(st, EXCLUSIONS);
    st.forEach((t, i) => {
      if (NEG_ABILITY.test(t.norm) && !x.some(([a, b]) => i >= a && i <= b)) x.push([i, i]);
    });
    if (groups.length) x.push(...hits(st, GROUP_RESTRICTIONS));
    const exp = hits(st, EXPAND_CUES);
    if (groups.length && (q.length || x.length)) {
      const conf = q.length && x.length ? 0.9 : x.length ? 0.85 : 0.8;
      const parts = [...q.map(([a, b]) => quote(text, st, a, b)), ...groups.map((g) => st[g].norm), ...x.map(([a, b]) => quote(text, st, a, b))];
      bump(best, conf, [...new Set(parts)].join(" … "));
    } else if (x.length) {
      bump(best, 0.25, quote(text, st, x[0][0], x[0][1]));
    } else if (q.length) {
      bump(best, WEAK_VERB, quote(text, st, q[0][0], q[0][1]));
    }
    if (groups.length && exp.length) bump(best, 0.5, `${st[groups[0]].norm} … ${quote(text, st, exp[0][0], exp[0][1])}`, "expand");
  }
}

function evalRule(text: string, sents: Token[][], rule: RightRule, best: Best): void {
  for (const st of sents) {
    const objs = hits(st, rule.objects);
    const partial = hits(st, PARTIAL);
    for (const vc of rule.verbs) {
      for (const [va, vb] of hits(st, vc.phrases)) {
        // Türkçe SOV: nesne fiilden önce ve yakın olmalı.
        const near = objs.filter(([, ob]) => ob < va && va - ob <= WINDOW);
        if (near.length) {
          const [oa] = near[near.length - 1];
          const isPartial = partial.some(([pa]) => pa >= oa - 1 && pa < va);
          const conf = isPartial ? Math.min(vc.conf, 0.4) : vc.conf;
          bump(best, conf, quote(text, st, oa, vb));
        } else if (objs.length) {
          bump(best, Math.min(vc.conf, 0.3), `${quote(text, st, objs[0][0], objs[0][1])} … ${quote(text, st, va, vb)}`);
        } else if (rule.weak) {
          bump(best, WEAK_VERB, quote(text, st, va, vb));
        }
      }
    }
    if (rule.self) for (const [a, b] of hits(st, rule.self.phrases)) bump(best, rule.self.conf, quote(text, st, a, b));
    const exp = hits(st, EXPAND_CUES);
    if (rule.expand && exp.length && objs.length) bump(best, 0.55, `${quote(text, st, objs[0][0], objs[0][1])} … ${quote(text, st, exp[0][0], exp[0][1])}`, "expand");
  }
}

/** Kuralı olmayan (ontolojiye sonradan eklenmiş) haklar: anahtar kelime + ipucu, en çok 0,3. */
function evalFallback(text: string, sents: Token[][], keywords: string[], best: Best): void {
  for (const st of sents) {
    const kw = hits(st, keywords);
    if (!kw.length) continue;
    const ev = quote(text, st, kw[0][0], kw[0][1]);
    if (hits(st, [...CLOSE_VERBS, ...BAN_VERBS, ...QUANTIFIERS, ...EXCLUSIONS]).length) bump(best, 0.3, ev);
    else if (hits(st, EXPAND_CUES).length) bump(best, 0.4, ev, "expand");
  }
}

/** Metindeki hak etkileri. Kısıtlama ve genişletmeden güveni yüksek olan seçilir (eşitlikte kısıtlama). */
export function detectRights(text: string, rights: { iri: string; label: string }[], localOf: (iri: string) => string): RightFinding[] {
  const tokens = tokenize(text);
  const sents = sentences(text).map((s) => tokens.filter((t) => t.start >= s.start && t.end <= s.end)).filter((s) => s.length);
  const out: RightFinding[] = [];
  for (const r of rights) {
    const local = localOf(r.iri);
    const best: Best = { restrict: 0, expand: 0, evidence: [], expandEvidence: [] };
    if (local === "EsitlikAyrimcilikYasagi") evalEquality(text, sents, best);
    else if (RULES[local]) evalRule(text, sents, RULES[local], best);
    else {
      const v = RIGHT_VOCAB.find((x) => x.local === local);
      evalFallback(text, sents, v ? v.keywords : contentTokens(r.label).filter((t) => t.length >= 5), best);
    }
    if (best.restrict === 0 && best.expand === 0) continue;
    if (best.restrict >= best.expand) out.push({ right: r.iri, direction: "restrict", confidence: best.restrict, evidence: best.evidence });
    else out.push({ right: r.iri, direction: "expand", confidence: best.expand, evidence: best.expandEvidence });
  }
  return out.sort((a, b) => b.confidence - a.confidence || a.right.localeCompare(b.right));
}
