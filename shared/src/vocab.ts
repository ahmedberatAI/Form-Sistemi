// Ontolojinin SABİT kelime dağarcığı (IRI'ler). Tek doğruluk kaynağı server/ontology/*.ttl dosyalarıdır;
// bu dosya, IRI'lerin modüller (ontoloji, YZ sezgiselleri, tohum verisi, testler, web) arasında
// tutarlı kalması için ortak sabitleri içerir. Ontoloji testleri, buradaki her IRI'nin TTL'de
// tanımlı olduğunu doğrular.

export const FY_NS = "https://forumsistemi.org/ont#";
export const fy = (local: string): string => FY_NS + local;

/** Kısa ad ("fy:Ulasim") ↔ tam IRI dönüşümü */
export function expandIri(iri: string): string {
  if (iri === "*") return iri;
  return iri.startsWith("fy:") ? FY_NS + iri.slice(3) : iri;
}
export function compactIri(iri: string): string {
  return iri.startsWith(FY_NS) ? "fy:" + iri.slice(FY_NS.length) : iri;
}

export interface VocabCategory {
  local: string;
  label: string;
  parent: string | null; // local ad
  requiresExpert?: boolean;
  keywords: string[];
}

/** Kategori sınıf ağacı (fy:Kategori alt sınıfları). */
export const CATEGORY_VOCAB: VocabCategory[] = [
  { local: "Ulasim", label: "Ulaşım", parent: null, keywords: ["ulaşım", "trafik", "yol", "durak", "araç"] },
  { local: "TopluTasima", label: "Toplu taşıma", parent: "Ulasim", keywords: ["otobüs", "metro", "tramvay", "minibüs", "dolmuş", "sefer", "toplu taşıma", "hat"] },
  { local: "BisikletYaya", label: "Bisiklet ve yaya", parent: "Ulasim", keywords: ["bisiklet", "yaya", "kaldırım", "scooter", "yürüyüş"] },
  { local: "OtoparkTrafik", label: "Otopark ve trafik düzeni", parent: "Ulasim", keywords: ["otopark", "park yeri", "kavşak", "sinyalizasyon", "hız"] },

  { local: "Cevre", label: "Çevre", parent: null, keywords: ["çevre", "doğa", "kirlilik", "iklim"] },
  { local: "YesilAlan", label: "Parklar ve yeşil alanlar", parent: "Cevre", keywords: ["park", "ağaç", "yeşil alan", "bahçe", "fidan", "oyun alanı"] },
  { local: "AtikGeriDonusum", label: "Atık ve geri dönüşüm", parent: "Cevre", keywords: ["çöp", "atık", "geri dönüşüm", "kompost", "konteyner", "plastik"] },
  { local: "Enerji", label: "Enerji", parent: "Cevre", requiresExpert: true, keywords: ["enerji", "güneş paneli", "elektrik", "aydınlatma", "verimlilik", "yenilenebilir"] },
  { local: "HavaKalitesi", label: "Hava kalitesi", parent: "Cevre", keywords: ["hava kalitesi", "egzoz", "toz", "duman", "emisyon"] },

  { local: "Egitim", label: "Eğitim", parent: null, keywords: ["eğitim", "öğrenci", "öğretmen", "ders"] },
  { local: "Okullar", label: "Okullar", parent: "Egitim", keywords: ["okul", "sınıf", "veli", "teneffüs", "servis"] },
  { local: "Kutuphane", label: "Kütüphane ve yaşam boyu öğrenme", parent: "Egitim", keywords: ["kütüphane", "kitap", "kurs", "atölye", "yetişkin eğitimi"] },

  { local: "Saglik", label: "Sağlık", parent: null, requiresExpert: true, keywords: ["sağlık", "hastane", "doktor", "aşı", "hasta"] },
  { local: "HalkSagligi", label: "Halk sağlığı", parent: "Saglik", requiresExpert: true, keywords: ["halk sağlığı", "salgın", "hijyen", "su kalitesi", "ilaçlama"] },
  { local: "PsikolojikDestek", label: "Psikolojik destek", parent: "Saglik", requiresExpert: true, keywords: ["psikolojik", "ruh sağlığı", "danışmanlık", "stres", "terapi"] },

  { local: "Imar", label: "İmar ve kentsel dönüşüm", parent: null, requiresExpert: true, keywords: ["imar", "yapı", "bina", "kentsel dönüşüm", "ruhsat"] },
  { local: "Konut", label: "Konut", parent: "Imar", keywords: ["konut", "kira", "ev", "sosyal konut", "barınma"] },
  { local: "DepremGuvenligi", label: "Deprem güvenliği", parent: "Imar", requiresExpert: true, keywords: ["deprem", "güçlendirme", "toplanma alanı", "zemin", "afet"] },

  { local: "Butce", label: "Bütçe ve mali işler", parent: null, requiresExpert: true, keywords: ["bütçe", "harcama", "gelir", "maliyet", "ödenek", "kaynak"] },
  { local: "KatilimciButce", label: "Katılımcı bütçe", parent: "Butce", keywords: ["katılımcı bütçe", "proje bütçesi", "mahalle bütçesi", "öncelik"] },
  { local: "VergiHarc", label: "Vergi, harç ve ücretler", parent: "Butce", requiresExpert: true, keywords: ["vergi", "harç", "ücret", "tarife", "zam", "abonelik"] },

  { local: "SosyalHizmet", label: "Sosyal hizmetler", parent: null, keywords: ["sosyal yardım", "dayanışma", "gönüllü", "aşevi"] },
  { local: "EngelliErisimi", label: "Engelli erişimi", parent: "SosyalHizmet", keywords: ["engelli", "erişilebilirlik", "rampa", "asansör", "işaret dili", "tekerlekli sandalye"] },
  { local: "YasliBakim", label: "Yaşlı bakımı", parent: "SosyalHizmet", keywords: ["yaşlı", "huzurevi", "evde bakım", "emekli"] },
  { local: "CocukGenclik", label: "Çocuk ve gençlik", parent: "SosyalHizmet", keywords: ["çocuk", "genç", "kreş", "gençlik merkezi"] },

  { local: "KulturSpor", label: "Kültür, sanat ve spor", parent: null, keywords: ["kültür", "sanat", "festival", "konser"] },
  { local: "Etkinlik", label: "Etkinlikler", parent: "KulturSpor", keywords: ["etkinlik", "şenlik", "tiyatro", "sinema", "sergi"] },
  { local: "Spor", label: "Spor", parent: "KulturSpor", keywords: ["spor", "saha", "spor salonu", "yüzme", "turnuva"] },

  { local: "KamuGuvenligi", label: "Kamu güvenliği", parent: null, keywords: ["güvenlik", "kamera", "devriye", "zabıta"] },
  { local: "AcilDurum", label: "Acil durum ve afet hazırlığı", parent: "KamuGuvenligi", requiresExpert: true, keywords: ["acil", "yangın", "tahliye", "sel", "afet planı"] },

  { local: "Yonetisim", label: "Yönetişim ve şeffaflık", parent: null, keywords: ["yönetişim", "katılım", "karar", "forum"] },
  { local: "ForumYonetmeligi", label: "Forum yönetmeliği", parent: "Yonetisim", keywords: ["yönetmelik", "madde", "eşik", "yeter sayı", "oylama kuralı", "usul"] },
  { local: "Seffaflik", label: "Şeffaflık ve hesap verebilirlik", parent: "Yonetisim", keywords: ["şeffaflık", "açık veri", "hesap verebilirlik", "rapor", "denetim"] },
  { local: "VeriKoruma", label: "Kişisel verilerin korunması", parent: "Yonetisim", requiresExpert: true, keywords: ["kişisel veri", "kvkk", "gizlilik", "kamera kaydı", "veri paylaşımı", "fişleme"] },
];

export interface VocabRight {
  local: string;
  label: string;
  /** Bu hakkı kısıtlamak değiştirilemez maddeye mi takılır (T3)? */
  coreImmutable?: boolean;
  keywords: string[];
}

/** Temel haklar (fy:TemelHak bireyleri). Kısıtlanırsa en az T1. */
export const RIGHT_VOCAB: VocabRight[] = [
  { local: "IfadeOzgurlugu", label: "İfade özgürlüğü", keywords: ["ifade", "eleştiri", "yasaklansın", "susturulsun", "konuşma yasağı"] },
  { local: "EsitlikAyrimcilikYasagi", label: "Eşitlik ve ayrımcılık yasağı", coreImmutable: true, keywords: ["yalnızca", "sadece", "hariç tutulsun", "giremesin", "ayrı tutulsun", "yabancılar", "kadınlar", "erkekler"] },
  { local: "OzelHayatinGizliligi", label: "Özel hayatın gizliliği ve kişisel verilerin korunması", keywords: ["kamera", "izlensin", "kayıt altına alınsın", "fişlensin", "kimlik bilgisi", "kişisel veri"] },
  { local: "KatilimHakki", label: "Katılım ve oy hakkı", coreImmutable: true, keywords: ["oy hakkı", "oy kullanamasın", "üyelikten çıkarılsın", "katılamasın"] },
  { local: "MulkiyetHakki", label: "Mülkiyet hakkı", keywords: ["kamulaştırma", "el konulsun", "yıkılsın", "mülk"] },
  { local: "ToplanmaHakki", label: "Toplanma ve örgütlenme hakkı", keywords: ["toplantı yasağı", "gösteri", "eylem", "dernek"] },
  { local: "ErisimHakki", label: "Hizmetlere erişim hakkı", keywords: ["kapatılsın", "kaldırılsın", "ücretli olsun", "erişim", "hizmet durdurulsun"] },
  { local: "SaglikHakki", label: "Sağlık hakkı", keywords: ["sağlık hizmeti", "aşı zorunlu", "tedavi"] },
];

export interface VocabGround {
  local: string;
  label: string;
  description: string;
  urgent?: boolean; // talep anında daraltılır
  sealed?: boolean; // kabulde "sealed" (kişisel veri)
  invalid?: boolean; // geçersiz gerekçe (SHACL ihlali)
}

/** Silme (karartma) gerekçeleri — fy:SilmeGerekcesi. */
export const DELETION_GROUND_VOCAB: VocabGround[] = [
  { local: "KisiselVeriIfsasi", label: "Kişisel veri ifşası", description: "Bir kişinin kimlik, adres, telefon, sağlık vb. verilerinin rızası dışında paylaşılması.", urgent: true, sealed: true },
  { local: "Tehdit", label: "Tehdit", description: "Bir kişiye ya da gruba yönelik şiddet veya zarar tehdidi.", urgent: true },
  { local: "HakaretIftira", label: "Hakaret / iftira", description: "Kişilik haklarına saldırı, asılsız suçlama." },
  { local: "NefretSoylemi", label: "Korunan gruba nefret söylemi", description: "Etnik köken, din, cinsiyet, engellilik vb. nedeniyle aşağılama veya düşmanlık." },
  { local: "Spam", label: "Spam / reklam", description: "Konu dışı tekrarlayan içerik veya ticari reklam." },
  { local: "TelifIhlali", label: "Telif ihlali", description: "Hak sahibinin izni olmadan eser paylaşımı." },
  { local: "GorusAyriligi", label: "Görüş ayrılığı", description: "Bir görüşe katılmamak silme gerekçesi OLAMAZ (değiştirilemez madde).", invalid: true },
];

/** Azınlık itirazı gerekçeleri — fy:ItirazGerekcesi. */
export const OBJECTION_GROUND_VOCAB: VocabGround[] = [
  { local: "TemelHakIhlali", label: "Temel hak ihlali", description: "Karar bir temel hakkı ölçüsüzce kısıtlıyor." },
  { local: "OrantisizAzinlikEtkisi", label: "Azınlığa orantısız etki", description: "Kararın yükü ağırlıklı olarak belirli bir gruba düşüyor." },
  { local: "UsulHatasi", label: "Usul hatası", description: "Tartışma, bilgilendirme veya oylama usulüne uyulmadı." },
  { local: "BilgiEksikligi", label: "Bilgi / bilirkişi eksikliği", description: "Karar için gerekli uzman görüşü veya veri eksik." },
  { local: "YeniBilgi", label: "Yeni bilgi ortaya çıktı", description: "Oylamadan sonra kararı etkileyebilecek yeni bilgi ortaya çıktı." },
];

/** İçerik etiketleri (fy:IcerikEtiketi): moderasyon ve ontoloji denetiminde kullanılır. */
export const CONTENT_LABEL_VOCAB: { local: string; label: string }[] = [
  { local: "KisiselVeriIfsasi", label: "Kişisel veri ifşası" },
  { local: "Tehdit", label: "Tehdit" },
  { local: "HakaretIftira", label: "Hakaret / iftira" },
  { local: "NefretSoylemi", label: "Nefret söylemi" },
  { local: "Spam", label: "Spam / reklam" },
  { local: "TelifIhlali", label: "Telif ihlali" },
];

/** Katman IRI'leri */
export const TIER_IRIS = {
  T0: fy("KatmanT0"),
  T1: fy("KatmanT1"),
  T2: fy("KatmanT2"),
  T3: fy("KatmanT3"),
  DEL: fy("KatmanDEL"),
} as const;

/** Genel parametreler bireyi */
export const GENERAL_PARAMS_IRI = fy("GenelParametreler");

/**
 * Öneri başlığı ve metni için uzunluk sınırları — Madde 7 (1) ve SHACL `title_length` / `body_length` şekilleriyle aynı
 * (server/test/ontology/vocab.test.ts denetler). Sunucunun oluşturma/revizyon denetimi ve web formları bu sabiti kullanır;
 * böylece ön denetim ile kayıt aynı sınırı uygular.
 */
export const PROPOSAL_TEXT_LIMITS = { titleMin: 5, titleMax: 200, bodyMin: 20, bodyMax: 20000 } as const;
