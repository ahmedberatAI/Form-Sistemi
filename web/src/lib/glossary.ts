// Sözlük: yönetmelik terimleri ve günlük karşılıkları. İlke: 'Terim korunur, günlük karşılık yanına eklenir' (docs/ARAYUZ_PLANI.md);
// terimler ekranda aynen kalır, açıklaması dokunmatikte de okunur (ui/Term → pencere) ve Keşfet sayfasının 'Sözlük' bölümünde listelenir.
//
// Kaynak: docs/YONETMELIK.md (Madde 2, 5, 6, 9, 11, 13, 15–20, 21–23), docs/ALGORITMA.md (§1–4, §8) ve docs/MIMARI.md (§4).
// Burada YALNIZ zamansız tanım durur: parametre değerleri (%60, 12 kişi …) yönetmelik değişince değişir, bu yüzden yazılmaz;
// güncel değerler öneri sayfasındaki 'Karar parametreleri' kartında ve Yönetmelik › Parametreler sekmesindedir.
//
// 'özet' sözcüğü hash anlamında YENİDEN ADLANDIRILMAZ (görünen etiketler ve testler aynen kalır); günlük karşılığı olan 'parmak izi'
// yalnızca burada ('ozet' girdisi) ve HashText açıklamasında eklenir.
import { normalizeSearch } from "./format";
import { routes } from "./routes";

/** Yönetmelik sayfasının sekme kimlikleri (pages/OntologyPage.tsx). */
export type BylawTab = "maddeler" | "kategoriler" | "haklar" | "gerekceler" | "katmanlar" | "parametreler" | "surumler" | "turtle";

/** 'Yönetmelikte ›' bağlantısı: dayanak madde (yazı) ve ilgili sekmeye giden uygulama yolu. */
export interface BylawLink {
  /** Dayanak: "Madde 16 — Karar kuralı" */
  label: string;
  /** Uygulama yolu: "/yonetmelik?sekme=maddeler" */
  to: string;
}

export type GlossaryGroupId = "karar" | "azinlik" | "oy" | "defter" | "yonetmelik" | "bilirkisi";

export interface GlossaryGroup {
  id: GlossaryGroupId;
  label: string;
  /** Bölüm başlığının altındaki tek cümle */
  hint: string;
}

/** Sözlüğün konu bölümleri (Keşfet sayfasında bu sırayla). */
export const GLOSSARY_GROUPS: readonly GlossaryGroup[] = [
  { id: "karar", label: "Karar kuralı", hint: "Bir önerinin nasıl kabul edildiği: katman, yeter sayı ve eşikler." },
  { id: "azinlik", label: "Azınlık koruması", hint: "Çoğunluğun yanında her görüş grubunun sesi: köprü testi ve küme ölçüleri." },
  { id: "oy", label: "Gizli oy ve doğrulama", hint: "Oyun gizli kalırken kaydedildiğinin kanıtlanması." },
  { id: "defter", label: "Dağıtık defter", hint: "Kayıtların kurcalanamaması: doğrulayıcılar, imzalar ve kanıtlar." },
  { id: "yonetmelik", label: "Yönetmelik ve tartışma", hint: "Kuralların makinece denetimi ve tartışma kayıtlarının korunması." },
  { id: "bilirkisi", label: "Bilirkişi", hint: "Danışman uzmanlar ve onları seçen çekiliş." },
];

export interface GlossaryEntry<Id extends string = string> {
  /** Kararlı, ASCII kimlik ('kopru-testi'); <Term id=…> bunu kullanır */
  id: Id;
  /** Yönetmelikteki terim; ekranda aynen yazıldığı gibi durur ve sözlük başlığıdır */
  term: string;
  /** Günlük karşılık: tek öbek, küçük harfle başlar, nokta yok ("… demektir" cümlesine uyar) */
  plain: string;
  /** 1–3 cümlelik tanım (zamansız; parametre değeri içermez) */
  definition: string;
  /** Terimin sembolü (φ, τ, K_s …); ParamsCard 'Sembolleri ve formülleri göster' açıkken yazılır */
  symbol?: string;
  group: GlossaryGroupId;
  /** Dayanak madde ve Yönetmelik sayfası bağlantısı; yoksa pencerede bağlantı çıkmaz */
  bylawLink?: BylawLink;
}

const bylaw = (label: string, tab: BylawTab): BylawLink => ({ label, to: `${routes.ontology()}?sekme=${tab}` });

const ENTRIES = [
  // ───────────── Karar kuralı ─────────────
  {
    id: "katman",
    term: "Katman",
    plain: "önerinin ne kadar ağır bir karar sayıldığını gösteren sınıf (T0, T1, T2, T3 ya da DEL)",
    definition:
      "Katman, bir önerinin yeter sayısını, onay eşiğini ve sürelerini belirleyen karar sınıfıdır: T0 olağan, T1 nitelikli, T2 yönetmelik değişikliği, T3 değiştirilemez (oylanamaz), DEL silme (karartma). Katmanı ontoloji denetimi belirler.",
    group: "karar",
    bylawLink: bylaw("Madde 9 — Katmanlar", "katmanlar"),
  },
  {
    id: "katman-t0",
    term: "T0 — Olağan karar",
    plain: "en hafif karar sınıfı: yeni konu ve alt konu önerileri",
    definition:
      "Yeni konu ve alt konu önerileri, bir hakkı kısıtlamıyorlarsa T0'dır. Karar sınıfları içinde en hafif yeter sayı ve onay eşiği bu katmanda uygulanır.",
    group: "karar",
    bylawLink: bylaw("Madde 9 — Katmanlar", "katmanlar"),
  },
  {
    id: "katman-t1",
    term: "T1 — Nitelikli karar",
    plain: "daha ağır sayılan, daha yüksek eşikli karar",
    definition:
      "Kabul edilmiş bir konunun düzenlenmesi ve bir temel hakkı ölçülü biçimde sınırlayan öneriler T1'dir. Yeter sayı ve onay eşiği T0'dan yüksektir; bir üyenin ya da yapay zekânın eklediği hak etkisi bayrağı da öneriyi en çok T1'e yükseltir.",
    group: "karar",
    bylawLink: bylaw("Madde 9 — Katmanlar", "katmanlar"),
  },
  {
    id: "katman-t2",
    term: "T2 — Yönetmelik değişikliği",
    plain: "kuralların kendisini değiştiren karar",
    definition:
      "Forum Yönetmeliğini değiştiren öneriler T2'dir. Yeter sayı ve eşikler yüksektir; 'nitelikli' korumalı bir hükmü ya da ona dayanan bir parametreyi değiştiren yamada onay eşiği en az 3/4'tür.",
    group: "karar",
    bylawLink: bylaw("Madde 23 — Değişiklik usulü", "maddeler"),
  },
  {
    id: "katman-t3",
    term: "T3 — Değiştirilemez hüküm",
    plain: "oylanamayan, kural gereği geçersiz öneri",
    definition:
      "Eşit oy, azınlık koruması ve temel haklar gibi 'değiştirilemez' maddeleri hedefleyen öneriler T3'tür. Oylamaya hiç girmez, kural gereği geçersiz sayılır ve gerekçesiyle 'yönetmeliğe aykırı' olarak kaydedilir.",
    group: "karar",
    bylawLink: bylaw("Madde 6 — Değiştirilemez hükümlerin korunması", "maddeler"),
  },
  {
    id: "katman-del",
    term: "DEL — Silme (karartma)",
    plain: "bir tartışma mesajını görünmez kılma oylaması",
    definition:
      "Bir tartışma mesajının silinmeden görünmez kılınması için açılan oylamanın katmanıdır. Yüksek onay eşiği, köprü testi ve mesaj yazarının kendi görüş grubundan asgari destek aranır; yazar bu oylamada seçmen değildir.",
    group: "karar",
    bylawLink: bylaw("Madde 20 — Silme (karartma)", "maddeler"),
  },
  {
    id: "yeter-sayi",
    term: "Yeter sayı",
    symbol: "q",
    plain: "oylamanın geçerli olması için katılması gereken en az seçmen oranı",
    definition:
      "Oylama, uygun seçmenlerin en az q oranı katılmadan sonuç vermez; ayrıca mutlak bir alt sınır (⌈1,5·√|E|⌉ kişi) aranır ve gereken sayı uygun seçmen sayısını aşamaz. Çekimser oylar katılıma sayılır, onay oranına sayılmaz. |E|, oylama açılırken dondurulan uygun seçmen sayısıdır.",
    group: "karar",
    bylawLink: bylaw("Madde 16 — Karar kuralı", "maddeler"),
  },
  {
    id: "onay-esigi",
    term: "Onay eşiği",
    symbol: "τ",
    plain: "kabul oylarının, kabul ve red oyları içindeki payının aşması gereken sınır",
    definition:
      "Onay oranı a = kabul / (kabul + red) olarak hesaplanır; çekimserler hesaba girmez. Karar için oranın katmanın eşiğini (τ) sağlaması gerekir; bazı katmanlarda 'eşitse yetmez' (kesin büyüklük), bazılarında 'eşit de yeter' kuralı geçerlidir.",
    group: "karar",
    bylawLink: bylaw("Madde 16 — Karar kuralı", "maddeler"),
  },
  {
    id: "asma-esigi",
    term: "Aşma eşiği",
    symbol: "ω",
    plain: "azınlığın durdurduğu kararı yeniden oylamada geçirmek için gereken nitelikli çoğunluk",
    definition:
      "Köprü testini geçemeyen (tartışmalı) bir karar uzlaşma turundan sonra yeniden oylanır. Kabul oranı aşma eşiğini (ω) tutturursa küme tabanları sağlanmasa da karar geçer; böylece azınlığın gücü erteleyicidir, mutlak veto değildir. ω hiçbir katmanda 2/3'ün altına inemez.",
    group: "karar",
    bylawLink: bylaw("Madde 5 — Azınlığın korunması", "maddeler"),
  },
  {
    id: "yeniden-oy-esigi",
    term: "Yeniden oylama eşiği",
    symbol: "ρ",
    plain: "geçerli bir itirazdan sonraki yeniden oylamada aranan onay oranı",
    definition:
      "Geçerli bir itiraz uzlaşma turu açar ve karar yeniden oylanır; bu oylamada küme tabanları aranmaz, yalnız kabul oranının ρ'yu tutturması gerekir. İtiraz imzalayanlar anlamlı bir görüş grubunun en az üçte ikisiyse (güçlü itiraz) eşik en az 2/3 olur.",
    group: "karar",
    bylawLink: bylaw("Madde 17 — Uzlaşma ve itiraz", "maddeler"),
  },
  {
    id: "gerekli-destekci",
    term: "Gerekli destekçi",
    symbol: "K_s",
    plain: "önerinin tartışmaya geçmesi için toplaması gereken eş imza sayısı",
    definition:
      "Öneri, süresi içinde yeterli sayıda üyenin desteğini (eş imza) toplayınca ontoloji denetimine girer; toplayamazsa düşer. Sayı üye sayısıyla yavaş artar: K_s = max(2, min(5, ⌈√|M|/2⌉)), |M| doğrulanmış üye sayısıdır. Silme taleplerinde talep edene ek olarak bir destekçi yeter.",
    group: "karar",
    bylawLink: bylaw("Madde 9 — Katmanlar", "maddeler"),
  },
  {
    id: "vekalet",
    term: "Vekâlet",
    symbol: "H",
    plain: "oyunuzu başka bir üyeye devretmeniz",
    definition:
      "Üye oyunu bir kategori için ya da genel olarak başka bir üyeye devredebilir; doğrudan oy her zaman vekâletten önce gelir. Vekâletle kullanılan oy vekâlet verenin kendi oyudur, onun görüş grubuna sayılır ve ağırlığı 1'dir. Bir delegenin taşıyabileceği oy sayısı ve zincirin uzunluğu (H adım) sınırlıdır; sınırı aşan oy kullanılmamış sayılır.",
    group: "karar",
    bylawLink: bylaw("Madde 18 — Vekâlet", "maddeler"),
  },
  {
    id: "soguk-baslangic",
    term: "Soğuk başlangıç",
    symbol: "δ",
    plain: "görüş grupları henüz güvenilir çıkarılamadığı için köprü testinin yapılamadığı durum",
    definition:
      "Kümelenmiş üye sayısı asgari sayıya (n_C,min) ulaşmadıysa ya da tek küme çıkıyorsa köprü testi uygulanamaz. Bu durumda onay eşiği δ kadar yükseltilir (en fazla 2/3'e; zaten daha yüksekse düşürülmez) ve sonuç kartında 'yeterli görüş verisi yok' notu görünür.",
    group: "karar",
    bylawLink: bylaw("Madde 16 — Karar kuralı", "maddeler"),
  },

  // ───────────── Azınlık koruması ─────────────
  {
    id: "kopru-testi",
    term: "Köprü testi",
    plain: "genel çoğunluğun yanında her büyük görüş grubundan da asgari destek aranması",
    definition:
      "Bir öneri, genel çoğunluğun yanında anlamlı büyüklükteki her görüş kümesinden de en az küme tabanı (φ) kadar destek almadıkça ilk oylamada kabul edilemez. Böylece büyük bir blok, öteki grupları tek başına ezemez. Testi geçemeyen öneri için uzlaşma turu açılır.",
    group: "azinlik",
    bylawLink: bylaw("Madde 5 — Azınlığın korunması", "maddeler"),
  },
  {
    id: "gorus-kumesi",
    term: "Görüş kümesi",
    plain: "benzer oy verme geçmişi olan üyelerin oluşturduğu grup",
    definition:
      "Oylama açılırken üyelerin geçmiş oylarından hesaplanan ve o anda dondurulan görüş gruplarıdır. Kümeleme kimseyi etiketlemez; yalnızca köprü testinde farklı bakış açılarının hepsinin sesi duyulsun diye kullanılır. Üyenin kümesini yalnız kendisi görebilir.",
    group: "azinlik",
    bylawLink: bylaw("Madde 2 — Tanımlar", "maddeler"),
  },
  {
    id: "anlamli-kume",
    term: "Anlamlı küme",
    symbol: "σ",
    plain: "köprü testine girecek kadar büyük görüş grubu",
    definition:
      "Kümelenmiş üyelerin belirli bir payını (σ) ve belirli bir asgari üye sayısını taşıyan görüş grubudur. Köprü testi yalnız anlamlı kümelere uygulanır; küçük, dağınık gruplar tek bir oyla kararı kilitleyemez.",
    group: "azinlik",
    bylawLink: bylaw("Madde 5 — Azınlığın korunması", "maddeler"),
  },
  {
    id: "kume-tabani",
    term: "Küme tabanı",
    symbol: "φ",
    plain: "her görüş grubundan beklenen asgari destek",
    definition:
      "Köprü testinde her anlamlı görüş kümesinin desteği (P_g) bu tabanın altına düşmemelidir; taban hiçbir katmanda 0,20'nin altına indirilemez. Silme kararlarında ayrıca mesaj yazarının kendi kümesi için en az 0,50'lik daha yüksek bir taban aranır.",
    group: "azinlik",
    bylawLink: bylaw("Madde 5 — Azınlığın korunması", "maddeler"),
  },
  {
    id: "kume-basina-asgari-oy",
    term: "Küme başına asgari oy",
    symbol: "μ",
    plain: "bir görüş grubunun sesinin duyulmuş sayılması için vermesi gereken en az kabul ya da red oyu",
    definition:
      "Anlamlı bir kümede kabul ve red oyu toplamı bu sayının altındaysa o kümenin sesi yeterince duyulmamıştır ve oylama bir kez uzatılır. Uzatmadan sonra da eksik kalırsa küme nötr sayılır ve köprü tabanından muaf tutulur; böylece neredeyse sessiz bir kümede tek bir oy kararı kilitleyemez.",
    group: "azinlik",
    bylawLink: bylaw("Madde 16 — Karar kuralı", "maddeler"),
  },
  {
    id: "p-g",
    term: "P_g (küme desteği)",
    plain: "bir görüş grubunun öneriye verdiği yumuşatılmış destek oranı",
    definition:
      "P_g = (1 + Kabul) / (2 + Kabul + Red); yalnız o gruptaki üyelerin kabul ve red oyları sayılır. Hiç oy vermeyen grubun P_g değeri 0,50'dir: boykot bir engel aracı değildir, bir grup kararı ancak açıkça 'Red' diyerek durdurabilir.",
    group: "azinlik",
  },
  {
    id: "gac",
    term: "GAC (grup bilgili uzlaşı)",
    plain: "grupların desteğinin ne kadar dengeli olduğunu gösteren gösterge",
    definition:
      "Anlamlı kümelerin P_g değerlerinin geometrik ortalamasıdır; bütün grupların öneriyi ne kadar dengeli desteklediğini tek sayıyla gösterir. Karar kuralına girmez, yalnızca göstergedir.",
    group: "azinlik",
  },

  // ───────────── Gizli oy ve doğrulama ─────────────
  {
    id: "taahhut",
    term: "Taahhüt",
    plain: "oyunuzun mühürlü zarfı: içeriği gizli, ama sonradan değiştirilemez",
    definition:
      "Oy verirken seçiminiz ve cihazınızdaki rastgele bir tuz birlikte özetlenir; deftere yalnız bu özet — taahhüt — yazılır. Oylama kapanınca açıklanan oyun taahhütle eşleşmesi gerekir. Böylece oylama sürerken kimse oyunuzu göremez, kapandıktan sonra da kimse onu sizin adınıza değiştiremez.",
    group: "oy",
    bylawLink: bylaw("Madde 15 — Gizli oy", "maddeler"),
  },
  {
    id: "makbuz",
    term: "Makbuz",
    plain: "oyunuzun deftere girdiğini sonradan kanıtlamanızı sağlayan, cihazınızda saklanan kayıt",
    definition:
      "Oy verince cihazınıza bir makbuz kaydedilir: oy pusulası kimliğini, taahhüdü ve defter işleminin özetini içerir. 'Oyum kayıtlı mı?' sayfası makbuzla oyunuzun deftere girdiğini ve sayıma katıldığını doğrular. Makbuz seçiminizi de içerdiği için kimseyle paylaşmanız gerekmez; Ayarlar sayfasından dışa aktarabilirsiniz.",
    group: "oy",
    bylawLink: bylaw("Madde 15 — Gizli oy", "maddeler"),
  },
  {
    id: "ozet",
    term: "Özet (hash)",
    plain: "parmak izi: veri değişirse tamamen değişen kısa kimlik",
    definition:
      "Özet, bir metnin ya da kaydın matematiksel parmak izidir (SHA-256): aynı veri her zaman aynı özeti verir, tek harf değişse özet tamamen değişir ve özetten veri geri üretilemez. Defter, sayım girdileri ve sürümler bu sayede kişisel veri tutmadan doğrulanır. Uzun özetler ekranda kısaltılır; tamamı kopyalanabilir.",
    group: "oy",
    bylawLink: bylaw("Madde 21 — Kişisel veriler", "maddeler"),
  },

  // ───────────── Dağıtık defter ─────────────
  {
    id: "dagitik-defter",
    term: "Dağıtık defter",
    plain: "kayıtların tek bir sunucuda değil, birbirini denetleyen birkaç doğrulayıcıda tutulduğu değiştirilemez kayıt defteri",
    definition:
      "Faz geçişleri, sayım sonuçları, bilirkişi kuraları ve yönetmelik sürümleri bu deftere blok blok yazılır. Her blok bir öncekinin özetini taşır, bu yüzden geçmiş bir kaydı değiştirmek zinciri bozar ve fark edilir; kişisel veri deftere girmez. Bu kurulumda dört doğrulayıcı aynı makinede çalışan bir simülasyondur.",
    group: "defter",
    bylawLink: bylaw("Madde 22 — Şeffaflık ve dağıtık defter", "maddeler"),
  },
  {
    id: "dogrulayici",
    term: "Doğrulayıcı",
    plain: "defterin bloklarını imzalayarak onaylayan bağımsız düğüm",
    definition:
      "Defteri tutan ve her bloğu imzalayarak onaylayan bağımsız düğümlerdir. Bir blok, doğrulayıcıların en az 2f+1'inin imzasıyla kesinleşir. Cihazınız bu imzaları, ilk kullanımda sabitlediği açık anahtarlarla denetler.",
    group: "defter",
  },
  {
    id: "2f1",
    term: "2f+1 imza",
    plain: "bir bloğun kesinleşmesi için gereken çoğunluk imzası",
    definition:
      "f, hatalı ya da kötü niyetli olabilecek doğrulayıcı sayısıdır. Dört doğrulayıcıda f = 1 olduğundan her blok en az 2f+1 = 3 imza taşımalıdır. Böylece tek bir doğrulayıcı çökse ya da yalan söylese de defter tutarlı kalır.",
    group: "defter",
  },
  {
    id: "merkle-yolu",
    term: "Merkle yolu",
    plain: "bir kaydın bloğa girdiğini, blok içeriğinin hepsini indirmeden kanıtlayan kısa özet zinciri",
    definition:
      "Bir bloktaki işlemlerin özetleri bir ağaçta birleştirilir ve tek bir kök özet imzalanır. Merkle yolu, bir işlemden bu köke giden kardeş özetlerdir; blokta binlerce kayıt olsa bile tek kaydın bloğa dahil olduğu, hepsini indirmeden doğrulanır.",
    group: "defter",
  },
  {
    id: "tofu",
    term: "TOFU (ilk kullanımda güven)",
    plain: "doğrulayıcı anahtarlarını ilk görüşte cihaza sabitleme",
    definition:
      "Cihazınız doğrulayıcıların açık anahtarlarını ilk doğrulamada kaydeder (Trust On First Use) ve sonrasında yalnız bu sabitlenmiş anahtarlara güvenir. Sunucu sonradan farklı anahtarlar bildirirse uyarı verilir; bu bir saldırı belirtisi olabilir. Sabitlemeyi Ayarlar sayfasından sıfırlayabilirsiniz.",
    group: "defter",
  },
  {
    id: "ed25519",
    term: "Ed25519 imzası",
    plain: "bir bloğun gerçekten doğrulayıcılardan geldiğini gösteren dijital imza",
    definition:
      "Her doğrulayıcının kendine ait bir Ed25519 anahtar çifti vardır. Blokları gizli anahtarıyla imzalar; herkes açık anahtarla imzayı denetleyebilir ama taklit edemez.",
    group: "defter",
  },

  // ───────────── Yönetmelik ve tartışma ─────────────
  {
    id: "ontoloji",
    term: "Ontoloji",
    plain: "yönetmeliğin bilgisayarın okuyabildiği hâli",
    definition:
      "Forum Yönetmeliği, bilgisayarın okuyup uygulayabildiği bir bilgi modeli (RDF/OWL) olarak tutulur. Böylece her öneri, oylamadan önce kuralların kendisine göre otomatik denetlenebilir ve her kural dayandığı maddeyi gösterir.",
    group: "yonetmelik",
    bylawLink: bylaw("Madde 1 — Amaç ve kapsam", "maddeler"),
  },
  {
    id: "ontoloji-denetimi",
    term: "Ontoloji denetimi",
    plain: "yönetmeliğin otomatik denetimi",
    definition:
      "Yeterli desteği toplayan her öneri oylamadan önce yönetmeliğe göre otomatik denetlenir: katman, hak etkisi, içerik etiketi ve usul. İhlal varsa öneri oylanamaz ('yönetmeliğe aykırı'); uyarılar öneriyle birlikte gösterilir, uygulanan kurallar dayandıkları maddelerle yazılır.",
    group: "yonetmelik",
    bylawLink: bylaw("Madde 11 — Ontoloji denetimi", "maddeler"),
  },
  {
    id: "karartma",
    term: "Karartma ve mezar taşı",
    plain: "tartışma mesajının silinmeden görünmez kılınması; yerinde bir iz kalır",
    definition:
      "Tartışma kayıtları silinmez. Silme oylaması kabul edilirse mesaj görünmez olur ama yerinde karar numarasını ve gerekçeyi gösteren bir iz — mezar taşı — kalır; eski sürümler ve içerik özeti saklanır, yazar karartılamayan bir cevap ekleyebilir.",
    group: "yonetmelik",
    bylawLink: bylaw("Madde 19 — Tartışma kayıtlarının korunması", "maddeler"),
  },

  // ───────────── Bilirkişi ─────────────
  {
    id: "bilirkisi",
    term: "Bilirkişi",
    plain: "kategorisinde uzman, panele çekilişle seçilen danışman",
    definition:
      "Bilirkişi danışmandır: raporu oylamayı bağlamaz, hukuki nitelendirme yapamaz ve oyu da her üyeninki gibi birdir. Bilirkişi gerektiren kategorilerde, yazar ya da uygun seçmenlerin en az onda biri istediğinde en az üç kişilik bir panel çekilir.",
    group: "bilirkisi",
    bylawLink: bylaw("Madde 13 — Bilirkişi", "maddeler"),
  },
  {
    id: "kura",
    term: "Bilirkişi kurası",
    plain: "paneli şansa ve adil ağırlıklara bırakan, herkesin yeniden üretebildiği çekiliş",
    definition:
      "Panel, aday havuzundan tohumlu ve ağırlıklı bir çekilişle seçilir. Tohum, önceden belirlenen bir defter bloğunun özetinden türer ve adaylarla birlikte deftere yazılır; bu yüzden çekilişi kimse yönlendiremez, herkes yeniden üretebilir. Yazarla aile, iş ya da hane bağı olanlar dışlanır.",
    group: "bilirkisi",
    bylawLink: bylaw("Madde 13 — Bilirkişi", "maddeler"),
  },
] as const satisfies readonly GlossaryEntry[];

/** Sözlükteki her terimin kimliği; <Term id=…> bunun dışında bir değer kabul etmez (derleme zamanı denetimi). */
export type TermId = (typeof ENTRIES)[number]["id"];

/** Sözlüğün tamamı (Keşfet 'Sözlük' bölümü): konu sırasıyla, her konu içinde tanım sırasıyla. */
export const GLOSSARY: readonly GlossaryEntry<TermId>[] = ENTRIES;

const BY_ID: ReadonlyMap<string, GlossaryEntry<TermId>> = new Map(GLOSSARY.map((e) => [e.id, e]));

/** Kimlikten girdi; bilinmeyen kimlik için undefined (çalışma anında gelen metinler için). */
export function findTerm(id: string): GlossaryEntry<TermId> | undefined {
  return BY_ID.get(id);
}

/** Sözlük teriminin çapası: `terim-<kimlik>` ('Keşfet ve doğrula' sözlüğünde terimin kimliği; routes.kesfet({ bolum }) ile derin bağlantı). */
export const termAnchor = (id: string): string => `terim-${id}`;

/** Tipli kimlikten girdi (her zaman vardır). */
export function getTerm(id: TermId): GlossaryEntry<TermId> {
  return BY_ID.get(id)!;
}

/** Konu bölümleri ve içindeki terimler; boş bölüm dönmez. */
export function glossaryByGroup(entries: readonly GlossaryEntry<TermId>[] = GLOSSARY): { group: GlossaryGroup; entries: GlossaryEntry<TermId>[] }[] {
  return GLOSSARY_GROUPS.map((group) => ({ group, entries: entries.filter((e) => e.group === group.id) })).filter((g) => g.entries.length > 0);
}

/** Terim, günlük karşılık, tanım ve sembolde Türkçe duyarsız arama; boş sorgu tümünü döner. */
export function searchGlossary(query: string, entries: readonly GlossaryEntry<TermId>[] = GLOSSARY): GlossaryEntry<TermId>[] {
  const q = normalizeSearch(query.trim());
  if (!q) return [...entries];
  return entries.filter((e) => normalizeSearch(`${e.term} ${e.symbol ?? ""} ${e.plain} ${e.definition}`).includes(q));
}

/**
 * Karar sonucundaki bir kontrolün (DecisionCheck.key) sözlük terimi. Sunucudan gelen etiket (ör. 'Onay oranı') aynen yazılır,
 * yalnız ilgili terimin açıklaması eklenir. Tanınmayan anahtar için null (düz metin).
 */
export function termForDecisionCheck(key: string): TermId | null {
  if (key.startsWith("bridge:")) return "kopru-testi";
  switch (key) {
    case "quorum":
      return "yeter-sayi";
    case "threshold":
      return "onay-esigi";
    case "cold_start":
      return "soguk-baslangic";
    case "participation_shortfall":
      return "kume-basina-asgari-oy";
    case "author_cluster":
      return "kume-tabani";
    case "override":
      return "asma-esigi";
    case "revote_threshold":
      return "yeniden-oy-esigi";
    default:
      return null;
  }
}

/** Katman kısaltmasının ('T0' … 'DEL') sözlük terimi; bilinmeyen için genel 'katman' terimi. */
export function termForTier(tier: string | null | undefined): TermId {
  switch (tier) {
    case "T0":
      return "katman-t0";
    case "T1":
      return "katman-t1";
    case "T2":
      return "katman-t2";
    case "T3":
      return "katman-t3";
    case "DEL":
      return "katman-del";
    default:
      return "katman";
  }
}
