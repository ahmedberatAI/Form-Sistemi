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

/**
 * Hakaret (kişilik haklarına saldırı). Yalnız bir KİŞİYE yöneldiğinde sayılır; bkz. OBJECT_CAPABLE_INSULTS.
 * "alçak" tek başına alınmaz ("alçak tabanlı araç", "alçak köprü" yanlış pozitifti); yalnız kişiye yönelik biçimleri.
 */
export const INSULT_WORDS = [
  "aptal", "salak", "şerefsiz", "gerizekalı", "geri zekalı", "geri zekâlı", "ahmak", "dangalak", "beyinsiz", "haysiyetsiz",
  "alçak herif", "alçaksın", "alçaksınız", "alçaklar", "seni alçak", "namussuz", "adi herif", "it herif", "pislik herif",
  "embesil", "mankafa", "denyo", "yavşak", "kalleş", "soysuz", "hödük", "budala",
];

/**
 * Bir kişiye değil bir şeye (proje, karar, kurum) de yönelebilen hakaret sözcükleri. Bunlar "-ca/-ce" biçiminde
 * ("aptalca proje") ya da bir nesne adını nitelediğinde ("aptal bir plan", "bu karar çok aptal") nesneye yönelik sert
 * eleştiri sayılır ve etiketlenmez. Diğer sözcükler (şerefsiz, namussuz …) yalnız kişiler için kullanıldığından her zaman sayılır.
 */
export const OBJECT_CAPABLE_INSULTS = [
  "aptal", "salak", "ahmak", "budala", "beyinsiz", "gerizekalı", "geri zekalı", "geri zekâlı", "mankafa", "dangalak", "embesil",
];

/** Nesneye yönelik eleştiriyi gösteren adlar (kişi değil): proje, karar, düzen, kurum … Kök ön ekiyle eşleşir. */
export const CRITIQUE_OBJECT_NOUNS = [
  "proje", "plan", "karar", "düzen", "uygulama", "fikir", "fikr", "öneri", "teklif", "kural", "yönetmelik", "madde", "sistem",
  "politika", "harcama", "bütçe", "ihale", "tasarım", "çözüm", "yaklaşım", "gerekçe", "iddia", "hesap", "rapor", "yasak",
  "tarife", "düzenleme", "değişiklik", "yol", "park", "bina", "inşaat", "belediye", "yönetim", "kurum", "idare", "meclis",
  "müdürlük", "bakanlık", "hükümet", "şirket", "iş", "durum", "saçmalık", "uygulam", "sefer", "güzergâh", "güzergah", "hat",
];

/** Kişiyi gösteren adlar/zamirler: "aptal adam", "aptal insanların" kişiye hakarettir (nesne istisnası uygulanmaz). */
export const PERSON_NOUNS = [
  "adam", "herif", "kadın", "insan", "kişiler", "kişiye", "kişiyi", "başkan", "müdür", "yönetici", "memur", "üye", "komşu", "sen", "siz", "seni",
  "sizi", "bunlar", "onlar", "herkes", "savunan", "yazan", "millet", "halk",
];

/** Nitelik zincirinde atlanan sözcükler ("aptal ve saçma bir proje", "bu karar gerçekten çok aptal"). */
export const INSULT_FILLERS = [
  "bir", "ve", "ile", "çok", "son", "derece", "gerçekten", "tamamen", "resmen", "düpedüz", "bence", "bu", "şu", "da", "de",
  "saçma", "gereksiz", "anlamsız", "kötü", "berbat", "mantıksız", "ne", "kadar", "en", "hem", "biraz", "fazlasıyla", "oldukça",
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

/*
 * Korunan gruba yönelik nefret söylemi kalıpları. Eski sürümde "istemiyoruz", "pis" gibi genel sözcüklerin grup adıyla
 * AYNI CÜMLEDE geçmesi yetiyordu; bu, grupları DESTEKLEYEN önerileri ("göçmen çocukların okul dışında kalmasını
 * istemiyoruz", "kadınların parkta kendini güvensiz hissetmesini istemiyoruz") nefret söylemi sayıyordu. Artık üç kalıp var:
 *  1. HATE_STRONG — açık düşmanlık/yok etme çağrısı; grup adıyla aynı cümlede geçmesi yeter.
 *  2. HATE_EPITHETS — aşağılayıcı nitelemeler; yalnız grup adına BİTİŞİKse sayılır ("pis göçmenler", "göçmenler pistir").
 *  3. HATE_EXCLUSION — dışlama fiilleri; yalnız korunan grup fiilin DOĞRUDAN nesnesi/öznesiyse sayılır ("göçmen
 *     istemiyoruz", "Suriyeliler mahalleye sokulmasın"); araya fiilimsi girerse ("… kalmasını istemiyoruz") sayılmaz.
 */

/** Açık düşmanlık ve yok etme çağrıları (grup adıyla aynı cümlede). */
export const HATE_STRONG = [
  "defolsun", "defolup gitsin", "defolun", "geberesice", "gebersin", "kökü kazınsın", "kökünü kazıyın", "hepsi hain",
  "hepsi haindir", "hepsi pislik",
];

/** Aşağılayıcı nitelemeler (yalnız grup adına bitişik; ardından "değil", "değildir", "muamelesi" gelirse sayılmaz). */
export const HATE_EPITHETS = [
  "pis", "pislik", "hayvan", "hayvanlar", "mikrop", "virüs", "parazit", "aşağılık", "değersiz", "soysuz", "hain", "haindir",
  "ikinci sınıf", "insan değil", "insan değiller", "çöp",
];

/** Bir nitelemenin olumsuzlandığını ya da reddedildiğini gösteren sözcükler ("ikinci sınıf vatandaş muamelesi görmesin"). */
export const HATE_NEGATORS = ["değil", "değildir", "değiller", "değillerdir", "sayılmaz", "sayılamaz", "muamelesi", "görülmemeli", "görülmesin", "mi", "mı", "mu", "mü", "midir", "mıdır"];

/** Dışlama fiilleri (yalnız grup doğrudan nesne/özneyse). */
export const HATE_EXCLUSION = [
  "istemiyoruz", "istemiyorum", "istenmiyor", "istenmesin", "atılsın", "atılmalı", "sürülsün", "kovulsun",
  "kovulmalı", "sınır dışı edilsin", "sınır dışı edilmeli", "temizlensin", "temizlenmeli", "sokulmasın", "sokulmamalı",
  "girmesin", "girmemeli", "yaşamasın", "yaşamamalı", "geri gönderilsin", "def edilsin", "yok edilsin", "yok edilmeli",
];

/** Dışlama fiili ile grup arasında atlanabilen sözcükler (yer/zaman belirteçleri, pekiştireçler). */
export const HATE_FILLERS = [
  "artık", "burada", "burda", "buradan", "orada", "hiç", "hiçbir", "asla", "kesinlikle", "derhal", "hemen", "bir", "daha",
  "hepsi", "hepsini", "tümü", "tümünü", "bütün", "da", "de", "bu", "şu", "geri", "aramızda", "içimizde",
];

/** Grup adını niteleyen baş ad ("göçmen çocuklar", "Suriyeli aileler"): grup sıfatıyla birlikte hedef sayılır. */
export const GROUP_HEAD_NOUNS = ["çocuklar", "çocuk", "aileler", "aile", "insanlar", "kişiler", "işçiler", "öğrenciler", "kadınlar", "erkekler"];

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
