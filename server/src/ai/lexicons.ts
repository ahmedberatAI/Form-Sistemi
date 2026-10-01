// Çevrimdışı sezgiseller için Türkçe sözlükler. Eşleştirme `findPhrase` ile (kök ön eki) yapılır.

/** Tehdit ifadeleri (tümü yüksek risk). */
export const THREAT_PHRASES = [
  "öldürürüm", "öldüreceğim", "öldürecem", "öldürücem", "seni öldür", "sizi öldür", "seni bulacağım", "seni bulurum",
  "seni bulucam", "evini bulurum", "canını yakarım", "canını yakacağım", "canınızı yakarım", "evini yakarım",
  "evini yakacağım", "evinizi yakarım", "kafanı kırarım", "kafanı kıracağım", "kafanı koparırım", "gebertirim",
  "geberteceğim", "döverim", "döveceğim", "dövücem", "bıçaklarım", "vururum", "vuracağım",
  "seni mahvedeceğim", "seni mahvederim", "pişman ederim", "pişman edeceğim", "sonun olur", "sonunu getiririm",
  "ailene zarar", "çocuklarına zarar", "kanını dökerim", "gününü göstereceğim", "seni gömerim",
];

/** Hakaret (kişilik haklarına saldırı). */
export const INSULT_WORDS = [
  "aptal", "salak", "şerefsiz", "gerizekalı", "geri zekalı", "geri zekâlı", "ahmak", "dangalak", "beyinsiz", "haysiyetsiz",
  "alçak", "namussuz", "adi herif", "it herif", "pislik herif", "embesil", "mankafa", "denyo", "yavşak", "kalleş",
  "soysuz", "hödük", "budala",
];

/** Asılsız suçlama (iftira) göstergeleri — düşük güven. */
export const ACCUSATION_WORDS = ["hırsızsın", "hırsızın teki", "dolandırıcısın", "dolandırıcının teki", "rüşvetçi", "yalancısın", "sahtekar", "sahtekâr", "vatan haini", "terörist"];

/** Korunan gruplar (etnik köken, din, cinsiyet, engellilik, yönelim, göç). */
export const PROTECTED_GROUPS = [
  "kürtler", "kürt", "türkler", "araplar", "arap", "suriyeliler", "suriyeli", "afganlar", "afgan", "göçmenler", "göçmen",
  "mülteciler", "mülteci", "sığınmacılar", "sığınmacı", "yabancılar", "yahudiler", "yahudi", "ermeniler", "ermeni",
  "rumlar", "aleviler", "alevi", "sünniler", "hristiyanlar", "hıristiyanlar", "müslümanlar", "ateistler", "kadınlar",
  "eşcinseller", "eşcinsel", "lgbt", "trans", "engelliler", "romanlar", "çingeneler", "çingene", "zenciler", "siyahiler",
  "kafirler", "gavurlar",
];

/** Korunan gruba yönelik aşağılama/düşmanlık kalıpları (grup adıyla aynı cümlede geçerse). */
export const HATE_CUES = [
  "pislik", "pis", "defolsun", "defolup gitsin", "defolun", "sınır dışı edilsin", "istemiyoruz", "aşağılık", "hayvan",
  "hayvanlar", "mikrop", "virüs", "parazit", "haindir", "hepsi hain", "yok edilmeli", "yok edilsin", "temizlenmeli",
  "temizlensin", "atılsın", "sürülsün", "geberesice", "lanet olsun", "insan değil", "soysuz", "kökü kazınsın",
  "sokulmasın", "yaşamamalı", "değersiz", "ikinci sınıf",
];

/** Spam / reklam sözcükleri: güçlü (1 puan) ve zayıf (0,5 puan). Toplam ≥ 2 → Spam. */
export const SPAM_STRONG = [
  "indirim", "kampanya", "tıkla", "tıklayın", "bedava", "ücretsiz deneme", "promosyon", "kupon", "satın al", "satın alın",
  "abone ol", "takip et", "bahis", "casino", "yatırım fırsatı", "whatsapp hattı", "kazandınız",
];
export const SPAM_WEAK = ["kazan", "kazanç", "fırsat", "son gün", "sipariş", "kripto", "kredi", "link", "whatsapp", "acele"];

/** Telif ihlali göstergeleri. */
export const COPYRIGHT_CUES = ["tüm hakları saklıdır", "izinsiz", "korsan", "full indir", "pdf indir", "film indir", "kitabın tamamı", "tam metni aşağıda", "telif hakkı", "kopyaladım"];

/** Hak genişletmesi ipuçları. */
export const EXPAND_CUES = ["ücretsiz", "erişilebilir", "herkese açık", "genişletilsin", "genişlet", "herkes yararlanabilsin", "kolaylaştırılsın", "erişime açılsın"];

/** Hukuki nitelendirme kalıpları (6754 s. Bilirkişilik Kanunu md. 3/2). Alt dize olarak aranır. */
export const LEGAL_QUALIFICATION_PATTERNS = [
  "hukuka aykırı", "suç teşkil", "suçtur", "suç işlemiş", "anayasaya aykırı", "kusurlu", "kusurludur", "tazminat",
  "hükmen", "yasaya aykırı", "kanuna aykırı", "mevzuata aykırı", "cezai sorumluluk", "hukuki sorumluluk", "ihlal etmiştir",
  "haksız fiil", "hukuken geçersiz", "hukuken sorumlu", "mahkûm", "mahkum edilmeli", "beraat",
];

/** Aşırı kesinlik ifadeleri. */
export const OVERCLAIM_PATTERNS = ["kesinlikle", "%100", "% 100", "yüzde yüz", "tartışmasız", "hiç şüphesiz", "şüphesiz", "kuşkusuz", "garanti eder", "asla yanılmaz"];

/** Bilirkişinin kendi beyanıyla alan dışına taştığını gösteren kalıplar (çevrimdışı "out_of_domain" sezgiseli). */
export const OUT_OF_DOMAIN_PATTERNS = [
  "uzmanlık alanım dışında", "uzmanlık alanımın dışında", "alanım dışında", "alanımın dışında", "uzmanlık alanım olmamakla",
  "uzmanlık alanım olmasa", "alanım olmasa da", "benim alanım değil", "alanıma girmemekle", "alanıma girmese de",
  "uzmanı olmamakla birlikte", "uzmanı olmasam da", "konusunda uzman olmasam da", "uzman değilim ama", "uzman değilim ancak",
];

export const LEGAL_MESSAGE =
  "6754 sayılı Bilirkişilik Kanunu md. 3/2: bilirkişi hukuki nitelendirme yapamaz; hukuki değerlendirme karar organına aittir. Bu ifadeyi teknik/olgusal bir tespitle değiştirin.";
export const OUT_OF_DOMAIN_MESSAGE =
  "Uzmanlık alanı dışı: bilirkişi yalnızca görevlendirildiği uzmanlık alanında görüş bildirir (6754 sayılı Bilirkişilik Kanunu). Bu değerlendirmeyi rapordan çıkarın ya da sınırlılık olarak belirtip ilgili alandan bilirkişi görüşü istenmesini önerin.";
export const OVERCLAIM_MESSAGE =
  "Aşırı kesinlik: bilirkişi raporu güven düzeyini ve belirsizlikleri açıkça belirtmelidir; kanıtla desteklenmeyen mutlak ifadelerden kaçının.";

/** İçerik etiketi → maddelerle eşleştirme için başlık anahtar kelimeleri. */
export const LABEL_ARTICLE_KEYWORDS: Record<string, string[]> = {
  KisiselVeriIfsasi: ["kişisel veri", "gizlilik", "mahremiyet", "kvkk"],
  Tehdit: ["tehdit", "şiddet", "güvenlik"],
  HakaretIftira: ["hakaret", "iftira", "kişilik hakları", "saygı"],
  NefretSoylemi: ["nefret", "ayrımcılık", "eşitlik"],
  Spam: ["spam", "reklam", "konu dışı"],
  TelifIhlali: ["telif", "fikri mülkiyet", "eser"],
};
