// Tohum içeriği: öneri metinleri, tartışma mesajları, bilirkişi raporları, azınlık raporları ve itirazlar.
// Metinler gerçekçi ve Türkçedir; kişisel veri içermez (tek kasıtlı istisna: PII_MESSAGE'daki uydurma telefon numarası).
import type { RegulationPatch, Stance } from "@forum/shared";

/** `by`: takma ad ya da "A" | "B" | "C" (o bloktan tohumlu seçilen bir üye). `reply`: aynı listedeki mesajın sırası. */
export interface MsgSpec {
  by: string;
  stance: Stance;
  text: string;
  reply?: number;
  /** Bloklar arası destek alan (köprü kuran) mesaj */
  bridge?: boolean;
}

export interface ProposalSpec {
  key: string;
  kind: "topic" | "subtopic" | "amendment" | "deletion" | "regulation";
  title: string;
  body: string;
  /** Yerel kategori adları (fy: öneki olmadan) */
  categories: string[];
  author: string;
  /** subtopic/amendment: üst/hedef konuyu oluşturan önerinin anahtarı */
  parent?: string;
  patch?: RegulationPatch;
  /** Öneri tartışmasında (tartışma evresinde) yazılan mesajlar */
  messages?: MsgSpec[];
  /** Öneri yürürlüğe girip konu oluşunca konu tartışmasında yazılan mesajlar */
  topicMessages?: MsgSpec[];
}

const P = (s: string) => s.trim().replace(/\n[ \t]+/g, "\n");

// ═══════════════════════════ Geçmiş: konu önerileri (1.–3. dalga) ═══════════════════════════

export const P1: ProposalSpec = {
  key: "P1",
  kind: "topic",
  author: "ayse",
  categories: ["Ulasim", "TopluTasima"],
  title: "Kent İçi Ulaşımın Yeniden Düzenlenmesi",
  body: P(`
    Mahallemizde toplu taşıma seferleri sabah ve akşam saatlerinde yetersiz kalıyor; duraklarda bekleme süreleri yirmi dakikayı aşabiliyor. Bu konu başlığı altında ulaşımla ilgili önerilerin bir arada tartışılmasını ve belediyeye iletilecek ortak bir öncelik listesinin oluşturulmasını öneriyorum.

    İlk aşamada otobüs hatlarının güzergâhları, sefer sıklıkları ve aktarma noktaları gözden geçirilmeli; ardından bisiklet ve yaya ulaşımı için ayrı alt başlıklar açılmalıdır. Her alt başlıkta somut veri (yolcu sayıları, bekleme süreleri, kaza kayıtları) paylaşılmasını teşvik edelim.

    Bu başlık bir uygulama kararı değil, bir çalışma alanı tanımıdır: kabul edilirse ulaşımla ilgili alt konu önerileri bu başlığın altında açılabilecek.`),
  messages: [
    { by: "B", stance: "question", text: "Bu başlık altında açılacak alt konular nasıl önceliklendirilecek? Her öneri ayrı ayrı mı oylanacak?" },
    { by: "ayse", stance: "neutral", reply: 0, text: "Evet, her alt konu ayrı bir öneri olarak açılıp oylanacak; bu başlık yalnızca çalışma çerçevesini çiziyor." },
    { by: "C", stance: "pro", bridge: true, text: "Durakların erişilebilirliğinin de bu başlığın kapsamında açıkça yer almasını istiyorum; oturma yeri ve sundurma olmayan durak sayısı az değil." },
  ],
  topicMessages: [
    { by: "A", stance: "pro", text: "Konu başlığının kabul edilmesi güzel oldu. İlk iş olarak duraklardaki bekleme sürelerini bir hafta boyunca not alıp burada paylaşmayı öneriyorum; elimizde veri olursa belediyeyle konuşmak kolaylaşır." },
    { by: "B", stance: "question", reply: 0, text: "Veri toplama fikri iyi ama kim, hangi duraklarda ölçecek? Gönüllü listesi açılabilir mi?" },
    { by: "A", stance: "neutral", reply: 1, text: "Ben istasyon ve çarşı duraklarını üstlenebilirim. Okul durağı için de bir veli gönüllü çıkarsa sabah ve akşam saatlerini kapsamış oluruz." },
    { by: "C", stance: "neutral", bridge: true, text: "Bekleme süresi kadar bekleme koşulları da ölçülmeli. Yaşlı komşularımız için yirmi dakika ayakta beklemek ciddi bir sorun." },
    { by: "B", stance: "con", text: "Toplu taşımayı iyileştirelim ama bunu araç trafiğini zorlaştırarak yapmayalım. Çarşı esnafının müşterilerinin önemli kısmı hâlâ araçla geliyor." },
  ],
};

export const P2: ProposalSpec = {
  key: "P2",
  kind: "topic",
  author: "elif_d",
  categories: ["YesilAlan"],
  title: "Mahalle Parkları ve Yeşil Alanların Korunması",
  body: P(`
    Mahallemizdeki üç park ve iki boş arsa, son yıllarda bakımsızlık nedeniyle kullanılamaz hâle geldi. Bu konu başlığının amacı yeşil alanların korunması, bakım takviminin belirlenmesi ve yeni ağaçlandırma alanlarının tespit edilmesidir.

    Öneri kapsamında her parkın bakım sorumluluğunun ve sulama düzeninin yazılı hâle getirilmesini, gönüllü park dostları gruplarının kurulmasını ve çocuk oyun alanlarının yılda iki kez güvenlik denetiminden geçirilmesini öneriyorum.

    Kabul edilirse bu başlık altında ağaçlandırma, cep ormanı ve oyun alanı gibi alt konular ayrıca tartışılabilir.`),
  messages: [
    { by: "A", stance: "pro", text: "Park dostları grupları kurulursa bakım sorunları çok daha hızlı fark edilir ve belediyeye düzenli bildirilir." },
    { by: "B", stance: "con", text: "Gönüllülere fazla sorumluluk yükleniyor; asıl görev belediyenin. Bu metin belediyenin işini gönüllülere devretmesine yol açabilir." },
    { by: "elif_d", stance: "neutral", reply: 1, bridge: true, text: "Metin belediyenin sorumluluğunu kaldırmıyor; gönüllüler izleme ve bildirim yapacak, bakım işleri belediyede kalacak." },
  ],
  topicMessages: [
    { by: "A", stance: "pro", text: "Park dostları grubunun ilk toplantısını önümüzdeki cumartesi parkın girişinde yapabiliriz. Sulama saatleri ve bank onarımları ilk gündem maddesi olsun." },
    { by: "C", stance: "pro", bridge: true, text: "Oyun alanının yanındaki banklar çok yıpranmış; torunlarını bekleyen yaşlı komşularımız oturacak yer bulamıyor. Bank onarımı önceliklendirilmeli." },
    { by: "B", stance: "question", text: "Bakım takvimi kimin sorumluluğunda olacak, belediye mi gönüllüler mi? Sorumluluk netleşmezse birkaç ay sonra yine aynı noktaya döneriz." },
    { by: "A", stance: "neutral", reply: 2, text: "Ağır işler belediyede kalmalı, gönüllüler ise düzenli kontrol ve bildirim yapmalı. Bunu bir sorumluluk tablosuyla netleştirebiliriz." },
  ],
};

export const P3: ProposalSpec = {
  key: "P3",
  kind: "topic",
  author: "burak_s",
  categories: ["OtoparkTrafik", "BisikletYaya"],
  title: "Çarşı Bölgesinin Hafta Sonları Araç Trafiğine Kapatılması",
  body: P(`
    Hafta sonları çarşı bölgesinde yaya yoğunluğu çok artıyor ve dar kaldırımlar yetersiz kalıyor. Cumartesi ve pazar günleri 10.00–20.00 saatleri arasında çarşı içindeki ana aksın yayalara ayrılmasını öneriyorum.

    Bu sürede esnafın mal kabulü sabah 08.00–10.00 arasında yapılabilir; acil durum araçları ve engelli araç kartı taşıyan araçlar için geçiş serbest kalır. Uygulama üç ay boyunca deneme olarak yürütülür ve sonuçları bu başlık altında paylaşılır.

    Benzer uygulamaların yapıldığı kentlerde yaya trafiğinin ve küçük esnafın cirosunun arttığı gözlemleniyor; ancak çevredeki yollarda park sorunu yaşanabileceği de göz önünde bulundurulmalıdır.`),
  messages: [
    { by: "A", stance: "pro", text: "Hafta sonu yaya bölgesi, çarşıyı ailelerin rahatça gezebileceği bir alana dönüştürür; çocuklu aileler için büyük kolaylık." },
    { by: "B", stance: "con", text: "Hafta sonu cironun büyük kısmı araçla gelen müşterilerden geliyor. Çevredeki yollarda park sorunu da katlanarak artacak." },
    { by: "C", stance: "con", text: "Yürüme güçlüğü çeken yaşlılar çarşıya araçla bırakılabilmeli; engelli kartı muafiyeti tek başına yeterli değil." },
    { by: "A", stance: "question", reply: 1, text: "Benzer uygulama yapılan ilçelerde esnafın cirosuna ilişkin bir veri var mı, paylaşabilir misiniz?" },
  ],
};

export const P4: ProposalSpec = {
  key: "P4",
  kind: "topic",
  author: "selin_a",
  categories: ["AtikGeriDonusum"],
  title: "Atık Ayrıştırma ve Geri Dönüşüm Programı",
  body: P(`
    Mahallemizde geri dönüşüm kutuları az ve çoğu zaman yanlış atıklarla doluyor. Bu başlık altında kaynağında ayrıştırma için ortak bir program oluşturulmasını öneriyorum: her yapı grubunun yakınında kâğıt, cam ve plastik için ayrı konteynerler; apartmanlar için atık pil ve elektronik atık toplama günleri.

    Program kapsamında ayda bir kez okullarda ve mahalle evinde bilgilendirme atölyesi düzenlenmeli, toplanan atık miktarları her ay herkese açık biçimde paylaşılmalıdır.

    Organik atıklar için kompost denemesi de bu başlık altında ayrı bir alt konu olarak ele alınabilir.`),
  messages: [
    { by: "A", stance: "pro", text: "Kaynağında ayrıştırma olmadan geri dönüşüm oranı artmıyor; program tam yerinde." },
    { by: "B", stance: "question", text: "Konteyner alımı için kaynak nereden gelecek? Belediyenin bu yıl için ayrılmış bir ödeneği var mı?" },
    { by: "selin_a", stance: "neutral", reply: 1, text: "Çevre müdürlüğünün konteyner destek programı var; başvuru takvimini bu başlıkta paylaşacağım." },
    { by: "C", stance: "con", text: "Kaldırımlara konacak yeni konteynerler tekerlekli sandalye ve bebek arabası geçişini zorlaştıracak; yer seçimi ölçütleri metinde hiç yok." },
  ],
  topicMessages: [
    { by: "A", stance: "pro", text: "Konteyner yerleri belirlenirken kaldırımı daraltmayacak noktalar seçilmeli. Her konteyner noktasının fotoğrafını burada paylaşıp birlikte karar verelim." },
    { by: "C", stance: "pro", reply: 0, bridge: true, text: "Tekerlekli sandalye ve bebek arabası geçişi için en az bir buçuk metre boş kaldırım kalması şart; bunu seçim ölçütlerine ekleyelim." },
    { by: "B", stance: "neutral", text: "Ayrıştırma atölyelerinin akşam saatlerinde de yapılması iyi olur; çalışanlar gündüz katılamıyor." },
    { by: "A", stance: "question", text: "Atık pil toplama kutusu için okul ve muhtarlık dışında hangi noktaları öneriyorsunuz?" },
    { by: "B", stance: "neutral", reply: 3, bridge: true, text: "Mahalledeki iki eczane ve fırın uygun olabilir; işletmecilerle konuştum, ikisi de olumlu baktı." },
  ],
};

export const P5: ProposalSpec = {
  key: "P5",
  kind: "topic",
  author: "pinar_g",
  categories: ["Kutuphane"],
  title: "Mahalle Kütüphanesinin Hafta Sonu da Açık Olması",
  body: P(`
    Mahalle kütüphanemiz şu anda hafta içi 09.00–17.00 saatleri arasında hizmet veriyor. Çalışan üyeler ve öğrenciler için en uygun zaman olan cumartesi ve pazar günleri ise kütüphane kapalı.

    Kütüphanenin cumartesi 10.00–18.00, pazar 12.00–18.00 saatleri arasında da açık olmasını öneriyorum. Hafta sonu çalışacak personelin mesaisi, hafta içi bir gün geç açılışla dengelenebilir.

    Hafta sonu saatlerinde çocuklar için okuma saatleri ve gönüllü üyelerin yürüteceği ödev desteği de planlanabilir. Altı aylık kullanım verileri toplandıktan sonra saatler yeniden değerlendirilir.`),
  messages: [
    { by: "A", stance: "pro", text: "Hafta sonu açık bir kütüphane, evde sessiz çalışma ortamı olmayan öğrencilere büyük destek olur." },
    { by: "B", stance: "con", text: "Hafta içi bir gün geç açılış, sabah saatlerinde gelen emeklileri etkileyebilir; bu da hesaba katılmalı." },
    { by: "C", stance: "pro", bridge: true, text: "Hafta sonu okuma saatleri, torunlarıyla gelen yaşlılar için de güzel bir buluşma olur." },
  ],
  topicMessages: [
    { by: "A", stance: "pro", text: "İlk hafta sonu açılışında çocuk okuma saati düzenlemek için üç gönüllü bulduk. Cumartesi 11.00'de başlamayı düşünüyoruz." },
    { by: "C", stance: "pro", bridge: true, text: "Kütüphane girişindeki merdiven için seyyar rampa talep edilmeli; hafta sonu açılışı tekerlekli sandalye kullananlar için de anlamlı olsun." },
    { by: "B", stance: "question", text: "Hafta sonu personel gideri ne kadar tutacak? Belediyenin bu yılki bütçesinde karşılığı var mı?" },
    { by: "pinar_g", stance: "neutral", reply: 2, text: "Kütüphane müdürlüğü, hafta içi bir gün geç açılışla mevcut personelle karşılanabileceğini yazılı olarak bildirdi; ek gider çıkmıyor." },
  ],
};

export const P6: ProposalSpec = {
  key: "P6",
  kind: "topic",
  author: "nur_a",
  categories: ["EngelliErisimi", "YasliBakim"],
  title: "Yaşlı ve Engelli Dostu Mahalle Programı",
  body: P(`
    Mahallemizde yaşayan yaşlı ve engelli komşularımızın günlük hayatı; yüksek kaldırımlar, rampasız bina girişleri ve oturma yeri olmayan duraklar nedeniyle zorlaşıyor. Bu başlık altında erişilebilirlik sorunlarının mahalle ölçeğinde haritalanmasını ve çözüm önceliklerinin belirlenmesini öneriyorum.

    İlk adım olarak gönüllülerle birlikte bir erişilebilirlik yürüyüşü yapılması, sorunlu noktaların fotoğraflanarak bu başlık altında paylaşılması ve her ay en az bir noktanın düzeltilmesi için belediyeye başvurulması hedeflenir. Evde bakım desteğine ihtiyaç duyan yaşlılar için gönüllü ziyaret ağı da bu programın parçası olabilir.

    Program, karar süreçlerine engelli ve yaşlı üyelerin doğrudan katılımını kolaylaştıracak düzenlemeleri de kapsar.`),
  messages: [
    { by: "C", stance: "pro", text: "Bu program olmadan erişilebilirlik sorunları hep tek tek ve geç çözülüyor; ortak bir harita çok işe yarar." },
    { by: "A", stance: "pro", bridge: true, text: "Haritalama için ortak bir form hazırlayalım; fotoğraf ve yaklaşık konum bilgisiyle birlikte." },
    { by: "B", stance: "question", text: "Programın yıllık ölçülebilir bir hedefi olacak mı? Örneğin yılda kaç noktanın düzeltilmesi hedefleniyor?" },
  ],
  topicMessages: [
    { by: "C", stance: "pro", text: "Erişilebilirlik yürüyüşü için ilk rotayı sağlık evi, eczane ve pazar arası olarak belirledik. Katılmak isteyenler cumartesi sabahı mahalle evinde buluşabilir." },
    { by: "A", stance: "pro", reply: 0, bridge: true, text: "Ben de katılırım. Sorunlu noktaları işaretleyeceğimiz ortak bir harita hazırlayıp bu başlıkta paylaşabilirim." },
    { by: "B", stance: "neutral", text: "Rampa ve kaldırım düzenlemeleri için belediyenin yıllık programı var mı? Taleplerimizi o programa yetiştirmek gerekir." },
    { by: "C", stance: "neutral", reply: 2, text: "Fen işleri müdürlüğünün programı her yıl ocakta kesinleşiyor; ekim sonuna kadar listemizi iletmemiz gerekiyor." },
    { by: "A", stance: "pro", bridge: true, text: "Gönüllü ziyaret ağında bir eşleştirme çizelgesi tutulmalı; ziyaretlerin düzenli olması en az sıklığı kadar önemli." },
  ],
};

export const P7: ProposalSpec = {
  key: "P7",
  kind: "topic",
  author: "serkan_u",
  categories: ["OtoparkTrafik"],
  title: "Belediye Hizmet Binası Arkasına Katlı Otopark Yapılması",
  body: P(`
    Çarşı ve belediye hizmet binası çevresinde park yeri bulmak neredeyse imkânsız hâle geldi; araçlar kaldırımlara ve kavşak köşelerine park ediliyor. Hizmet binasının arkasındaki boş alana dört katlı, yaklaşık 300 araçlık bir otopark yapılmasını öneriyorum.

    Otopark ücretli işletilecek ve ilk yarım saat ücretsiz tutulacak; böylece kısa süreli işler için gelenlerin sirkülasyonu sağlanacak. Gelirin bir kısmı çevredeki yolların bakımına ayrılabilir.

    Projenin maliyeti ve finansman modeli ayrı bir alt başlıkta ayrıntılı olarak tartışılmalıdır; bu öneri yer seçimini ve ilkesel kararı kapsar.`),
  messages: [
    { by: "B", stance: "pro", text: "Çarşıya araçla gelenlerin park sorunu esnafın en büyük şikâyeti. Katlı otopark bu sorunu kökten çözer." },
    { by: "onur_h", stance: "con", text: "Katlı otopark merkeze daha fazla aracı çeker; trafik ve hava kirliliği artar. Aynı kaynak toplu taşımaya ayrılmalı." },
    { by: "C", stance: "neutral", text: "Yapılacaksa engelli park yerleri giriş katında ve asansöre yakın olmalı." },
    { by: "B", stance: "con", reply: 1, text: "Toplu taşıma her ihtiyaca yanıt vermiyor; ağır alışveriş yapanlar ve uzak semtlerden gelenler aracı tercih ediyor." },
  ],
};

export const P8: ProposalSpec = {
  key: "P8",
  kind: "topic",
  author: "ceren_m",
  categories: ["Etkinlik", "KulturSpor"],
  title: "Mahalle Kültür ve Sanat Etkinlikleri Takvimi",
  body: P(`
    Mahallemizde yıl boyunca dağınık biçimde düzenlenen etkinlikler yeterince duyurulmadığı için az katılımla geçiyor. Bu başlık altında yıllık bir kültür ve sanat takvimi hazırlanmasını öneriyorum: her ay bir açık hava sinema gösterimi, mevsimlik mahalle şenlikleri ve yerel sanatçıların sergileri.

    Takvim, mahalle evindeki duyuru panosunda ve forumda herkese açık olarak yayımlanır. Etkinliklerin en az yarısı çocuklara ve gençlere yönelik olmalı, tüm etkinlik alanları tekerlekli sandalye ile erişilebilir seçilmelidir.

    Takvimin hazırlanmasında gönüllü bir çalışma grubu görev alır ve her çeyrek sonunda katılım sayıları paylaşılır.`),
  messages: [
    { by: "A", stance: "pro", text: "Düzenli bir takvim, etkinliklerin duyurulmasını kolaylaştırır ve katılımı artırır." },
    { by: "B", stance: "con", text: "Etkinlik giderleri ve kimin karşılayacağı netleşmeden bir takvim kabul edilmemeli." },
    { by: "C", stance: "pro", bridge: true, text: "Etkinlik alanlarının erişilebilir seçilmesi şartının metinde açıkça yer alması çok önemli." },
  ],
  topicMessages: [
    { by: "A", stance: "pro", text: "Ekim ayının açık hava sinema gösterimi için parkın amfi alanı uygun görünüyor. Film seçimini bu başlıkta birlikte yapabiliriz." },
    { by: "B", stance: "pro", bridge: true, text: "Yerel esnafın da şenliklerde tezgâh açabilmesi güzel olur; hem etkinlik canlanır hem de çarşıya katkı sağlar." },
    { by: "C", stance: "question", text: "Akşam etkinliklerinde oturma alanı ve aydınlatma yeterli olacak mı? Yaşlı katılımcılar için bu önemli." },
    { by: "ceren_m", stance: "neutral", reply: 2, text: "Mahalle evinden 60 sandalye ödünç alınabiliyor; aydınlatma için de belediyenin seyyar projektörlerini talep edeceğiz." },
  ],
};

/** Yalnız C bloğunun desteklediği (reddedilen) öneri: görüş kümelerinin ayrışmasına katkı verir. */
export const P13: ProposalSpec = {
  key: "P13",
  kind: "topic",
  author: "ismail_g",
  categories: ["OtoparkTrafik", "EngelliErisimi"],
  title: "Çarşı Açık Otoparkının Yarısının Yaşlı ve Engelli Sürücülere Ayrılması",
  body: P(`
    Çarşıdaki açık otoparkta yaşlı ve engelli sürücüler, girişe yakın yer bulamadıkları için çoğu zaman alışverişlerini yapamadan geri dönüyor. Otoparkın girişe en yakın yarısının 65 yaş üstü ve engelli araç kartı taşıyan sürücülere ayrılmasını öneriyorum.

    Ayrılan bölümde park süresi iki saatle sınırlanır ve denetim belediye zabıtası tarafından yapılır. Uygulama altı ay boyunca denenir; doluluk ve şikâyet verileri bu başlık altında paylaşılır.

    Bu düzenleme, çarşıya ulaşmakta en çok zorlanan komşularımızın kent merkezindeki hizmetlere erişimini kolaylaştırmayı amaçlıyor.`),
  messages: [
    { by: "ismail_g", stance: "pro", text: "Geçen ay annemi üç kez çarşıya götürmek istedim, üçünde de girişe yakın yer bulamadığımız için geri döndük." },
    { by: "B", stance: "con", text: "Otoparkın yarısını ayırmak genel park sorununu çok büyütür; esnafın müşterileri başka semtlere gider." },
    { by: "A", stance: "con", text: "Yaşlı ve engelli komşularımızın erişimi önemli ama çözüm otopark ayırmak değil, çarşıya ulaşan toplu taşımayı iyileştirmek olmalı." },
    { by: "C", stance: "neutral", reply: 1, text: "Ayrılan yerlerde süre sınırı olacağı için dolaşım devam eder; asıl sorun yer sayısı değil, girişe uzaklık." },
  ],
};

/** Bilirkişi gerektiren kategori: tartışma evresinde panel çekilir (yazarla aile bağı olan bilirkişi dışlanır). */
export const EN1: ProposalSpec = {
  key: "EN1",
  kind: "topic",
  author: "mehmet",
  categories: ["Enerji", "KatilimciButce"],
  title: "Okul Çatılarına Güneş Enerjisi Panelleri Kurulması",
  body: P(`
    Mahallemizdeki iki ilkokul ve bir ortaokulun çatıları güneş enerjisi panelleri için elverişli görünüyor. Okulların elektrik giderlerinin önemli bir kısmının bu yolla karşılanabileceğini ve öğrencilerin yenilenebilir enerji konusunda uygulamalı olarak bilgilenebileceğini düşünüyorum.

    Öneri, katılımcı bütçeden ayrılacak kaynakla önce bir okulda pilot kurulum yapılmasını, çatı taşıma kapasitesinin bağımsız bir mühendislik incelemesiyle doğrulanmasını ve üretim verilerinin okul panosunda ve forumda paylaşılmasını içerir.

    Pilot uygulamanın bir yıllık sonuçları olumlu olursa diğer okullara yaygınlaştırma ayrı bir öneriyle oylanır.`),
  messages: [
    { by: "mehmet", stance: "pro", text: "Pilot kurulum için katılımcı bütçeden ayrılacak tutar, okulun yaklaşık iki yıllık elektrik giderine denk geliyor." },
    { by: "A", stance: "pro", bridge: true, text: "Öğrencilerin üretim verilerini izleyebilmesi eğitim açısından da çok değerli." },
    { by: "C", stance: "con", text: "Panellerin bakım ve temizliği okulun teknik personeline ek yük getirecek; aynı kaynakla okulun asansörü onarılabilirdi." },
    { by: "B", stance: "question", text: "Statik inceleme raporu oylamadan önce paylaşılacak mı?" },
  ],
  topicMessages: [
    { by: "mehmet", stance: "pro", text: "Pilot okul için statik inceleme randevusu alındı; rapor geldiğinde burada paylaşacağım." },
    { by: "A", stance: "question", text: "Üretim verileri hangi sıklıkla yayımlanacak? Aylık bir özet yeterli olur mu?" },
    { by: "mehmet", stance: "neutral", reply: 1, text: "İnverterin kendi izleme ekranı var; aylık özet ve yıllık rapor yayımlamayı planlıyoruz." },
    { by: "C", stance: "pro", bridge: true, text: "Öğrencilerin üretim verilerini fen derslerinde kullanması çok güzel bir fikir; okul aile birliği de destek veriyor." },
  ],
};

export const P9: ProposalSpec = {
  key: "P9",
  kind: "topic",
  author: "emre_t",
  categories: ["Okullar", "OtoparkTrafik"],
  title: "Okul Çevrelerinde Trafik Güvenliği",
  body: P(`
    Okulların giriş ve çıkış saatlerinde okul önlerindeki yollarda araç yoğunluğu ve hız, çocuklar için ciddi risk oluşturuyor. Bu başlık altında okul çevrelerinde güvenli yürüme rotalarının belirlenmesini öneriyorum.

    Önerilen önlemler: okul önlerinde hız kesici ve yaya geçidi işaretlerinin yenilenmesi, giriş ve çıkış saatlerinde gönüllü veli nöbeti, servis araçları için ayrı indirme-bindirme noktası ve okul yolu haritasının velilerle paylaşılması.

    Uygulamanın etkisi, her dönem sonunda velilerden alınacak geri bildirimle değerlendirilir.`),
  messages: [
    { by: "A", stance: "pro", text: "Okul önlerinde hız kesicilerin yenilenmesi acil; geçen ay okul çıkışında iki kez ucuz atlatılan kaza yaşandı." },
    { by: "B", stance: "pro", bridge: true, text: "Servis araçları için ayrı indirme noktası çok yerinde bir öneri; sabah kuyruğunu da azaltır." },
    { by: "C", stance: "pro", text: "Okul yolu haritasında engelli öğrenciler için uygun rotalar ayrıca işaretlenmeli." },
  ],
  topicMessages: [
    { by: "A", stance: "pro", text: "Veli nöbeti çizelgesi hazır; ilk ay için 18 gönüllü veli var. Sabah 08.00–08.30 arası iki kişi okul girişinde olacak." },
    { by: "B", stance: "pro", bridge: true, text: "Servis araçları için ayrılan indirme noktası gerçekten işe yaradı; sabahları kuyruk kısaldı." },
    { by: "C", stance: "question", text: "Okul önündeki yaya geçidinin çizgileri silinmiş; yenileme ne zaman yapılacak?" },
    { by: "emre_t", stance: "neutral", reply: 2, text: "Belediye ay sonuna kadar çizgilerin yenileneceğini bildirdi; yapılmazsa bu başlıkta hatırlatacağız." },
  ],
};

export const P10: ProposalSpec = {
  key: "P10",
  kind: "topic",
  author: "onur_h",
  categories: ["CocukGenclik", "Kutuphane"],
  title: "Gençlik Merkezinde Ücretsiz Kodlama Atölyeleri",
  body: P(`
    Gençlik merkezimizin bilgisayar salonu akşam saatlerinde boş kalıyor. 12–18 yaş arası gençler için haftada iki akşam ücretsiz kodlama ve robotik atölyeleri düzenlenmesini öneriyorum. Atölyeler gönüllü yazılımcılar ve üniversite öğrencileri tarafından yürütülebilir.

    Her dönem sonunda gençlerin geliştirdiği projeler mahalle şenliğinde sergilenir. Katılımda kız ve erkek öğrenciler arasında denge gözetilir; kayıtlar herkese açık bir başvuru formuyla alınır.

    Atölye malzemeleri için mahalle esnafından ve üniversiteden bağış toplanabilir.`),
  messages: [
    { by: "A", stance: "pro", text: "Gençlerin akşamları güvenli bir ortamda üretmesi çok değerli; benzer atölyeler başka semtlerde çok ilgi görüyor." },
    { by: "C", stance: "con", text: "Kaynaklar sınırlıyken önce gençlik merkezinin asansör sorunu çözülmeli; tekerlekli sandalye kullanan gençler üst kata çıkamıyor." },
    { by: "B", stance: "question", text: "Gönüllü eğitmenlerin sürekliliği nasıl sağlanacak? Bir dönem sonra bırakırlarsa ne olacak?" },
  ],
  topicMessages: [
    { by: "A", stance: "pro", text: "İlk dönem için 24 kontenjan açtık ve kayıtlar iki günde doldu. Bekleme listesi için ikinci bir grup açmayı düşünüyoruz." },
    { by: "C", stance: "neutral", bridge: true, text: "Atölyelerde işitme engelli gençler için altyazılı materyal ya da işaret dili desteği sağlanabilir mi?" },
    { by: "onur_h", stance: "neutral", reply: 1, text: "Güzel öneri; üniversitedeki işaret dili kulübüyle görüşüp bir sonraki dönem için destek isteyeceğiz." },
    { by: "B", stance: "question", text: "Bilgisayarların bakımı ve yazılım lisansları kimin sorumluluğunda?" },
    { by: "A", stance: "neutral", reply: 3, text: "Kullanılan tüm yazılımlar açık kaynak; donanım bakımını gençlik merkezinin teknik personeli üstleniyor." },
  ],
};

export const P11: ProposalSpec = {
  key: "P11",
  kind: "topic",
  author: "ozge_b",
  categories: ["Cevre"],
  title: "Sahipsiz Hayvanlar İçin Mama ve Su Noktaları",
  body: P(`
    Mahallemizdeki sahipsiz hayvanlar özellikle kış aylarında yiyecek ve suya ulaşmakta zorlanıyor; düzensiz besleme ise hem temizlik sorunlarına hem de komşular arasında tartışmalara yol açıyor. Parklarda ve yeşil alanlarda belirlenecek noktalara düzenli temizlenen mama ve su istasyonları yerleştirilmesini öneriyorum.

    İstasyonların bakımını gönüllü bir hayvan dostları grubu üstlenir; belediyenin veteriner birimiyle iş birliği yapılarak kısırlaştırma ve aşılama çalışmaları da takip edilir. İstasyonlar çocuk oyun alanlarından ve bina girişlerinden uzak yerlere konur.

    Uygulamanın ilk altı ayında gelen şikâyet ve öneriler bu başlık altında toplanır.`),
  messages: [
    { by: "A", stance: "pro", text: "Düzenli besleme noktaları, apartman önlerindeki dağınık beslemeyi azaltır; temizlik de kolaylaşır." },
    { by: "B", stance: "con", text: "Besleme noktaları hayvanları belirli bölgelerde toplar; çocuk oyun alanlarına yakınlık konusunda çok dikkatli olunmalı." },
    { by: "C", stance: "question", text: "Kış aylarında suyun donmaması için bir çözüm düşünüldü mü?" },
  ],
  topicMessages: [
    { by: "A", stance: "pro", text: "İlk dört istasyon yerleştirildi. Temizlik çizelgesine katılmak isteyen gönüllüler bu başlıkta yazabilir." },
    { by: "B", stance: "con", text: "İstasyonlardan biri bir apartman girişine çok yakın kondu, komşular rahatsız. Yerinin değiştirilmesini öneriyorum." },
    { by: "ozge_b", stance: "neutral", reply: 1, bridge: true, text: "Haklısınız, o istasyonu parkın arka tarafına taşıyacağız; uyarınız için teşekkürler." },
    { by: "C", stance: "question", text: "Veteriner birimiyle yapılan kısırlaştırma çalışmalarının sayılarını düzenli paylaşabilir miyiz?" },
  ],
};

export const P12: ProposalSpec = {
  key: "P12",
  kind: "topic",
  author: "gokhan_r",
  categories: ["OtoparkTrafik"],
  title: "Semt Pazarının Çevre Yolu Kenarındaki Alana Taşınması",
  body: P(`
    Her çarşamba kurulan semt pazarı, mahalle içindeki dar yolları tamamen dolduruyor ve o gün araç trafiği kilitleniyor. Pazarın, çevre yolu kenarındaki geniş ve otoparklı alana taşınmasını öneriyorum.

    Yeni alanda tezgâhlar daha düzenli yerleştirilebilir, alışveriş yapanlar için geniş bir otopark sağlanabilir ve mahalle içi trafik rahatlar. Pazara ulaşım için pazar günlerine özel bir ring seferi konulabilir.

    Taşınmanın esnafa ve pazar alışverişini yürüyerek yapan komşulara etkisi bu başlık altında tartışılmalıdır.`),
  messages: [
    { by: "B", stance: "pro", text: "Pazar günü mahalle içi trafik tamamen kilitleniyor; taşınma herkes için rahatlama olur." },
    { by: "C", stance: "con", text: "Pazara yürüyerek giden yaşlılar için çevre yolu kenarı çok uzak; ring seferi bu ihtiyacı karşılamaz." },
    { by: "A", stance: "con", bridge: true, text: "Pazar mahallenin sosyal hayatının merkezi; onu kenara taşımak çarşı esnafını da olumsuz etkiler." },
  ],
};

// ═══════════════════════════ Yönetmelik yaması (yürürlüğe girer → sürüm 2) ═══════════════════════════

export const R1: ProposalSpec = {
  key: "R1",
  kind: "regulation",
  author: "tolga_a",
  categories: ["ForumYonetmeligi"],
  title: "Olağan Kararlarda Tartışma Süresinin 72 Saatten 96 Saate Çıkarılması",
  body: P(`
    Son haftalarda açılan önerilerin önemli bir kısmında tartışmanın ilk iki gününde mesajların yoğunlaştığı, çalışan üyelerin ise ancak hafta sonu katılabildiği görüldü. 72 saatlik tartışma süresi, özellikle hafta içi açılan önerilerde üyelerin bir kısmının görüş bildirmesine fırsat tanımıyor.

    Bu yönetmelik yaması, olağan karar katmanının (T0) tartışma süresini 72 saatten 96 saate çıkarır. Diğer süreler, eşikler ve yeter sayılar değişmez. Değişiklik yürürlüğe girdikten sonra tartışmaya açılan önerilere uygulanır; oylaması süren önerilerin parametreleri sabittir.

    Bir günlük ek süre karar sürecini hafifçe uzatır; ancak daha fazla üyenin tartışmaya katılması kararların meşruiyetini güçlendirir.`),
  patch: {
    ops: [{ op: "setParam", rule: "fy:KatmanT0", param: "sureTartisma", value: 96 }],
    rationale: "Hafta içi açılan önerilerde çalışan üyelerin tartışmaya katılabilmesi için olağan kararlarda tartışma süresi bir gün uzatılır.",
  },
  messages: [
    { by: "A", stance: "pro", text: "Hafta içi açılan önerilerde çalışanların görüş bildirmesi gerçekten zorlaşıyor; 96 saat makul bir süre." },
    { by: "B", stance: "question", text: "Bu değişiklik oylaması süren önerileri de etkileyecek mi?" },
    { by: "tolga_a", stance: "neutral", reply: 1, text: "Hayır; yönetmelik gereği parametreler oylama açıldığında sabitleniyor, değişiklik yalnızca yeni önerilere uygulanır." },
    { by: "C", stance: "pro", bridge: true, text: "Ek gün, yaşlı üyelerin tartışmaları okuyup katılabilmesi için de önemli." },
  ],
};

// ═══════════════════════════ Süresi dolan, geri çekilen, kural gereği geçersiz ═══════════════════════════

export const X1: ProposalSpec = {
  key: "X1",
  kind: "topic",
  author: "umut_f",
  categories: ["Spor"],
  title: "Mahalle Meydanına Satranç Masaları Yerleştirilmesi",
  body: P(`
    Mahalle meydanında oturma alanı az ve gün içinde meydanı kullanan emekliler ile gençlerin bir araya gelebileceği bir etkinlik alanı yok. Meydanın gölgelik bölümüne dört adet sabit satranç masası yerleştirilmesini öneriyorum.

    Masalar dayanıklı malzemeden yapılır; taşlar mahalle evinden ödünç alınabilir. Ayda bir kez açık satranç turnuvası düzenlenebilir.`),
  messages: [
    { by: "A", stance: "pro", text: "Meydana birkaç satranç masası konursa emekliler ve gençler bir arada vakit geçirebilir." },
    { by: "B", stance: "question", text: "Masaların bakımını ve taşların korunmasını kim üstlenecek?" },
  ],
};

export const W1: ProposalSpec = {
  key: "W1",
  kind: "topic",
  author: "sinem_a",
  categories: ["Etkinlik"],
  title: "Hafta Sonu Mahalle Şenliği İçin Cadde Düzenlemesi",
  body: P(`
    Yaz aylarında bir hafta sonu, çarşı içindeki ana cadde boyunca mahalle şenliği düzenlenmesini ve bu süre için cadde düzeninin geçici olarak değiştirilmesini öneriyorum. Şenlikte yerel üreticilerin tezgâhları, çocuk atölyeleri ve akşam konseri yer alabilir.

    Şenlik alanına girişler serbest olacak; trafik düzenlemesi için belediyenin zabıta ekibiyle önceden görüşülmesi gerekir.`),
  messages: [
    { by: "A", stance: "pro", text: "Şenlik fikri güzel ama kültür ve sanat takvimiyle birleştirilirse çok daha güçlü olur." },
    { by: "sinem_a", stance: "neutral", reply: 0, text: "Haklısınız; öneriyi geri çekip kültür ve sanat takvimi başlığı altında yeniden ele alacağım." },
  ],
};

export const RT3: ProposalSpec = {
  key: "RT3",
  kind: "regulation",
  author: "levent_c",
  categories: ["ForumYonetmeligi"],
  title: "Yanlış Bilgi İçeren Görüşlerin Silme Gerekçesi Sayılması",
  body: P(`
    Tartışmalarda bazı mesajların açıkça yanlış bilgi içerdiği hâlde görünür kalması, yeni katılan üyeleri yanıltıyor. Yönetmeliğin 20. maddesinin 2. fıkrasının, açıkça yanlış bilgi içeren görüşlerin üyelerin üçte iki çoğunluğuyla gizlenebilmesine izin verecek biçimde değiştirilmesini öneriyorum.

    Bu değişiklikle görüş ayrılığı tek başına silme gerekçesi olmayacak; ancak nitelikli çoğunluğun açıkça yanlış bulduğu görüşler karartılabilecektir.`),
  patch: {
    ops: [
      {
        op: "amendArticleText",
        article: "fy:Madde_20_2",
        text: "Görüş ayrılığı tek başına silme gerekçesi olamaz; ancak üyelerin üçte ikisinin açıkça yanlış bulduğu görüşler karartılabilir.",
      },
    ],
    rationale: "Açıkça yanlış bilgi içeren görüşlerin nitelikli çoğunlukla karartılabilmesi.",
  },
  messages: [
    { by: "A", stance: "con", text: "Görüş ayrılığının silme gerekçesi olamaması yönetmeliğin değiştirilemez hükümlerinden biri; bu öneri oylamaya bile giremez." },
    { by: "B", stance: "pro", text: "Yanlış bilgiyle mücadele için bir mekanizma gerekli; ama belki farklı bir yol bulunmalı." },
  ],
};

// ═══════════════════════════ Alt konular ve düzenleme teklifi ═══════════════════════════

export const S1: ProposalSpec = {
  key: "S1",
  kind: "subtopic",
  author: "cem_y",
  parent: "P1",
  categories: ["BisikletYaya"],
  title: "Bisiklet Yolu Ağı",
  body: P(`
    Kent içi ulaşım başlığı altında, mahalleyi metro istasyonuna, okullara ve sahile bağlayan kesintisiz bir bisiklet yolu ağı oluşturulmasını öneriyorum. Ağın ilk etabı, istasyon ile çarşı arasındaki 2,4 kilometrelik hat olabilir.

    Bisiklet yolları kaldırımdan ayrılmış ve fiziksel bariyerle korunan şeritler olarak tasarlanmalı; kavşaklarda bisiklet için ayrı bekleme alanları bulunmalıdır. Güzergâh boyunca bisiklet park yerleri ve küçük bir tamir istasyonu kurulabilir.

    Bazı noktalarda yol kenarı park yerlerinin azalacağı açıktır; bu nedenle güzergâh seçimi esnafla birlikte yapılmalı ve alternatif park çözümleri aynı zamanda planlanmalıdır.`),
  messages: [
    { by: "A", stance: "pro", text: "İstasyona bisikletle güvenli ulaşım sabah trafiğini doğrudan azaltır." },
    { by: "B", stance: "con", text: "Esnafın yükleme-boşaltma ihtiyacı çözülmeden bu güzergâh uygulanmamalı." },
    { by: "C", stance: "neutral", bridge: true, text: "Bisiklet yolu kavşaklarda yaya geçitleriyle çakışmamalı; görme engelliler için uyarı yüzeyi şart." },
  ],
  topicMessages: [
    { by: "A", stance: "pro", text: "İlk etap için önerilen güzergâhın haritasını hazırladık; istasyon ile çarşı arası 2,4 kilometre." },
    { by: "B", stance: "con", text: "Güzergâh üzerindeki 40 park yeri kalkacak. Esnafın yükleme-boşaltma ihtiyacı nasıl karşılanacak?" },
    { by: "cem_y", stance: "neutral", reply: 1, bridge: true, text: "Sabah 07.00–10.00 arası yükleme-boşaltma cepleri planlandı; ayrıntıları esnafla birlikte netleştireceğiz." },
    { by: "C", stance: "neutral", text: "Bisiklet yolu ile kaldırım arasındaki ayrımın görme engelliler için hissedilebilir bir şeritle yapılması gerekir." },
  ],
};

export const S2: ProposalSpec = {
  key: "S2",
  kind: "subtopic",
  author: "derya_n",
  parent: "P1",
  categories: ["TopluTasima"],
  title: "Gece Otobüs Seferleri",
  body: P(`
    Gece vardiyasında çalışan komşularımız ve geç saatte dönen öğrenciler için gece yarısından sonra toplu taşıma bulunmuyor. Mahalleyi merkeze bağlayan ana hatta 00.30–05.30 arasında saatte bir gece seferi konulmasını öneriyorum.

    Gece seferlerinde sürücünün yanında acil çağrı düğmesi bulunmalı ve duraklar iyi aydınlatılmalıdır. Altı aylık deneme süresinin sonunda yolcu sayıları değerlendirilerek sefer sıklığı yeniden belirlenir.

    Bu alt konu, kent içi ulaşım başlığında en çok dile getirilen ihtiyaçlardan birine yanıt vermeyi amaçlıyor.`),
  messages: [
    { by: "B", stance: "pro", text: "Gece vardiyasından dönen komşularımız taksiye her gece ciddi para ödüyor." },
    { by: "A", stance: "pro", bridge: true, text: "Deneme süresi ve yolcu sayımı şartı öneriyi çok makul kılıyor." },
    { by: "C", stance: "question", text: "Gece seferlerinin durakları aydınlatılacak mı?" },
  ],
  topicMessages: [
    { by: "derya_n", stance: "pro", text: "İlk gece seferi bu hafta başladı. İlk üç gecede toplam 112 yolcu taşındı." },
    { by: "A", stance: "pro", bridge: true, text: "Durak aydınlatmalarının da yenilenmesi gerekiyor; bazı duraklar gece çok karanlık." },
    { by: "C", stance: "question", text: "Gece seferlerinde alçak tabanlı araç kullanılıyor mu?" },
    { by: "derya_n", stance: "neutral", reply: 2, text: "Hattaki araçların tamamı alçak tabanlı ve rampalı; gece seferlerinde de aynı araçlar kullanılıyor." },
  ],
};

export const S3: ProposalSpec = {
  key: "S3",
  kind: "subtopic",
  author: "umut_f",
  parent: "P2",
  categories: ["YesilAlan"],
  title: "Cep Ormanı Uygulaması",
  body: P(`
    Mahalle parkları başlığı altında, ilkokulun yanındaki 600 metrekarelik boş arsada Miyawaki yöntemiyle bir cep ormanı oluşturulmasını öneriyorum. Bu yöntemde yerli türlerden oluşan sık dikim, birkaç yıl içinde kendi kendini sürdüren küçük bir orman sağlıyor.

    Dikim günleri okulla birlikte planlanır; öğrenciler ve gönüllü aileler fidan dikimine katılır. İlk üç yıl sulama ve yabani ot temizliği park dostları grubunca üstlenilir.

    Cep ormanı, yaz aylarında çevresindeki yolların sıcaklığını düşürür ve kuşlar için yaşam alanı oluşturur.`),
  messages: [
    { by: "A", stance: "pro", text: "Cep ormanları küçük bir alanda büyük bir yeşil etki yaratıyor; okulun yanında olması eğitim için de fırsat." },
    { by: "B", stance: "question", text: "Arsanın imar durumu bu kullanıma uygun mu?" },
    { by: "umut_f", stance: "neutral", reply: 1, text: "Arsa park alanı olarak ayrılmış; belediyeden yazılı teyit aldık." },
  ],
  topicMessages: [
    { by: "umut_f", stance: "pro", text: "Dikim günü için 600 fidan ayrıldı. Okulla birlikte iki cumartesi dikim yapacağız." },
    { by: "C", stance: "pro", bridge: true, text: "Cep ormanının çevresine birkaç bank ve gölgelik konursa yaşlı komşularımız da yararlanabilir." },
    { by: "B", stance: "question", text: "Sulama için şebeke suyu mu kullanılacak? Yaz aylarında gideri ne olur?" },
    { by: "A", stance: "neutral", reply: 2, text: "İlk iki yıl damla sulama yapılacak; okulun yağmur suyu deposundan da yararlanmayı planlıyoruz." },
  ],
};

/** Düzenleme teklifi: başlık/gövde konunun YENİ metnidir (konu sürüm 2'ye geçer). */
export const AM1: ProposalSpec = {
  key: "AM1",
  kind: "amendment",
  author: "elif_d",
  parent: "P2",
  categories: ["YesilAlan"],
  title: "Mahalle Parkları ve Yeşil Alanların Korunması ve Bakım Takvimi",
  body: P(`
    Mahallemizdeki üç park ve iki boş arsa, son yıllarda bakımsızlık nedeniyle kullanılamaz hâle geldi. Bu konu başlığının amacı yeşil alanların korunması, bakım takviminin belirlenmesi ve yeni ağaçlandırma alanlarının tespit edilmesidir.

    Her parkın bakım sorumluluğu ve sulama düzeni yazılı hâle getirilir; bakım takvimi her yıl mart ayında bu başlık altında yayımlanır. Gönüllü park dostları grupları kurulur ve çocuk oyun alanları yılda iki kez güvenlik denetiminden geçirilir.

    Yeni hüküm: Parklarda ağaç kesimi, bağımsız bir ağaç sağlığı raporu ve kesilen her ağaç yerine en az üç fidan dikilmesi koşuluyla yapılabilir. Rapor ve dikim planı kesimden önce bu başlık altında paylaşılır.

    Bu başlık altında ağaçlandırma, cep ormanı ve oyun alanı gibi alt konular ayrıca tartışılabilir.`),
  messages: [
    { by: "A", stance: "pro", text: "Ağaç kesimine rapor şartı getirilmesi, son yıllarda yaşanan gereksiz kesimlerin önüne geçer." },
    { by: "B", stance: "question", text: "Fırtınada devrilme riski olan ağaçlar için acil durumda da rapor beklenecek mi?" },
    { by: "elif_d", stance: "neutral", reply: 1, bridge: true, text: "Can güvenliğini tehdit eden acil durumlarda belediye hemen müdahale eder; rapor sonradan bu başlıkta paylaşılır." },
  ],
};

// ═══════════════════════════ Tartışmalı (contested) öneriler ═══════════════════════════

/** A+B çoğunluğu destekler, C kümesi aktif olarak "hayır" der → uzlaşma → yeniden oylama (ω ile kabul). */
export const C1: ProposalSpec = {
  key: "C1",
  kind: "topic",
  author: "volkan_i",
  categories: ["OtoparkTrafik", "EngelliErisimi"],
  title: "Merkezdeki Engelli Otoparklarının Yarısının Genel Otoparka Dönüştürülmesi",
  body: P(`
    Çarşı merkezindeki açık otoparkta 24 engelli park yeri bulunuyor. Belediyenin geçen yıl yaptığı sayımlara göre bu yerlerin hafta içi ortalama doluluk oranı yüzde 30'un altında kalırken genel park yerleri sürekli dolu ve çevredeki yollarda çift sıra park yaygınlaşıyor.

    Bu öneri, merkezdeki engelli park yerlerinin yarısının (12 yer) genel park yerine dönüştürülmesini, kalan 12 yerin ise girişlere en yakın noktada toplanmasını öngörüyor. Dönüştürülen yerlerde ilk bir saat ücretsiz kısa süreli park uygulanır.

    Uygulama altı ay sonra doluluk verileriyle yeniden değerlendirilir; engelli park yerlerinin doluluk oranı yüzde 70'i aşarsa dönüştürülen yerler eski hâline getirilir.`),
  messages: [
    { by: "B", stance: "pro", text: "Hafta içi engelli park yerlerinin büyük kısmı boş duruyor; bu alan daha verimli kullanılmalı." },
    { by: "zeynep", stance: "con", text: "Doluluk oranının düşük olması ihtiyacın olmadığı anlamına gelmez; engelli kartı olan pek çok komşumuz merkezde yer bulamama kaygısıyla çarşıya hiç gelmiyor." },
    { by: "A", stance: "pro", text: "Kalan yerlerin girişlere en yakın noktada toplanması ve altı ay sonra veriyle değerlendirme şartı dengeli bir yaklaşım." },
    { by: "C", stance: "con", reply: 2, text: "Yüzde 70 doluluk eşiği çok yüksek; yer bulamayan kişi geri dönüyor ve bu durum doluluk verisinde hiç görünmüyor." },
    { by: "B", stance: "question", text: "Dönüştürülen yerlerde engelli kartlı araçlara da park önceliği tanınabilir mi?" },
    { by: "A", stance: "neutral", reply: 4, bridge: true, text: "Bu iyi bir uzlaşma noktası olabilir; dönüştürülen yerlerde engelli kartlı araçlara ücretsiz ve süresiz park hakkı eklenebilir." },
  ],
};

/** Yeniden oylamada bırakılan tartışmalı öneri. */
export const C2: ProposalSpec = {
  key: "C2",
  kind: "topic",
  author: "figen_s",
  categories: ["BisikletYaya", "OtoparkTrafik"],
  title: "Kaldırımlarda Elektrikli Scooter Park Noktaları Oluşturulması",
  body: P(`
    Mahallemizde paylaşımlı elektrikli scooter kullanımı hızla arttı; ancak araçlar rastgele bırakıldığı için kaldırımlar ve bina girişleri sık sık tıkanıyor. Bu öneri, kaldırım genişliğinin 3 metreyi aştığı bölümlerde boyalı ve işaretli scooter park noktaları oluşturulmasını öngörüyor.

    Toplam 25 park noktası, metro istasyonu, çarşı ve okul çevresinde konumlandırılır. Scooter işletmecileri, uygulamalarında kiralamanın bu noktalarda bitirilmesini zorunlu kılar.

    Park noktalarından alınacak kullanım ücreti kaldırım onarımlarına ayrılır. Uygulama bir yıl sonra kaza ve şikâyet kayıtlarıyla değerlendirilir.`),
  messages: [
    { by: "A", stance: "pro", text: "Scooterlar belirli noktalarda toplanırsa kaldırımlar şimdikinden çok daha düzenli olur." },
    { by: "B", stance: "pro", text: "Kullanım ücretinin kaldırım onarımına ayrılması öneriyi kendi kendini finanse eden bir uygulamaya dönüştürüyor." },
    { by: "nur_a", stance: "con", text: "Üç metre kaldırım genişliği yeterli değil; park noktaları tekerlekli sandalye kullananlar ve görme engelliler için yeni engeller oluşturacak." },
    { by: "C", stance: "con", reply: 2, text: "Hissedilebilir yüzeyler ve bina girişleri park noktalarından korunmalı; metin bunu güvence altına almıyor." },
    { by: "A", stance: "question", reply: 2, text: "Park noktaları kaldırım yerine yol kenarındaki eski park cepleri üzerinde kurulsa itirazınız devam eder mi?" },
    { by: "C", stance: "neutral", reply: 4, bridge: true, text: "Yol kenarında kurulursa kaygılarımızın büyük kısmı giderilir; kaldırım tamamen yayalara kalmalı." },
  ],
};

/** Uzlaşma evresinde bırakılan tartışmalı öneri (azınlık raporu + YZ köprü taslakları). */
export const C3: ProposalSpec = {
  key: "C3",
  kind: "topic",
  author: "tolga_a",
  categories: ["OtoparkTrafik", "BisikletYaya"],
  title: "Ana Caddedeki Yaya Geçitlerinin Işıklı Kavşaklarda Toplanması",
  body: P(`
    Ana caddenin 900 metrelik bölümünde ışıksız altı yaya geçidi bulunuyor ve araçlar her geçitte ani fren yapıyor; bu durum hem trafik akışını yavaşlatıyor hem de arkadan çarpma kazalarını artırıyor. Işıksız geçitlerin üç sinyalize kavşakta toplanmasını ve kavşaklardaki yaya ışıklarının süresinin uzatılmasını öneriyorum.

    Toplu taşıma araçlarının cadde üzerindeki seyahat süresinin yaklaşık yüzde 15 kısalması bekleniyor. Işıksız geçitlerin bulunduğu noktalara orta refüjde yaya bariyeri konur.

    Kavşaklar arasındaki en uzun yürüme mesafesi 300 metreyi geçmeyecek biçimde planlanmıştır.`),
  messages: [
    { by: "A", stance: "pro", text: "Işıksız geçitlerdeki ani frenler otobüs seferlerini ciddi biçimde geciktiriyor." },
    { by: "B", stance: "pro", text: "Trafik akışının düzelmesi hem sürücüler hem de toplu taşıma kullananlar için kazanç." },
    { by: "hulya_t", stance: "con", text: "Yaşlılar için 300 metre ek yürüme, çarşıya hiç gidememek anlamına gelebilir." },
    { by: "C", stance: "con", text: "Işıklı kavşaklarda yaya süresi uzatılsa bile yavaş yürüyenler için yeterli olmayabilir; geri sayım sayacı şart." },
    { by: "B", stance: "question", text: "Geçitlerden biri sağlık evinin önünde; bu geçidin korunması konusunda uzlaşabilir miyiz?" },
    { by: "A", stance: "neutral", reply: 4, bridge: true, text: "Sağlık evi önündeki geçidin ışıklı hâle getirilerek korunması makul bir orta yol olabilir." },
  ],
};

/** İtiraz yolu: ilk turda kabul → C kümesinden geçerli itiraz (kural a) → uzlaşma → yeniden oylama → red. */
export const O1: ProposalSpec = {
  key: "O1",
  kind: "topic",
  author: "baran_y",
  categories: ["TopluTasima", "YasliBakim"],
  title: "Ring Hattında Durakların Birleştirilerek Seferlerin Hızlandırılması",
  body: P(`
    Mahalle içinde dolaşan ring hattında 14 durak bulunuyor ve bir tur, trafiğe bağlı olarak 55 dakikayı buluyor. Birbirine 200 metreden yakın durakların birleştirilerek durak sayısının 9'a indirilmesini ve böylece tur süresinin yaklaşık 35 dakikaya düşürülmesini öneriyorum.

    Daha kısa tur süresi, aynı araç sayısıyla sefer aralığını 30 dakikadan 20 dakikaya indirir. Birleştirilen durakların yerine daha geniş, oturma yeri ve sundurması olan yeni duraklar yapılır.

    Birleştirme sonrasında yürüme mesafelerinin artacağı noktalar haritada gösterilmiş ve bu başlık altında paylaşılmıştır.`),
  messages: [
    { by: "A", stance: "pro", text: "Tur süresi 35 dakikaya inerse ring hattı gerçekten kullanılabilir hâle gelir." },
    { by: "B", stance: "pro", text: "Daha sık sefer, araç kullanan pek çok komşuyu toplu taşımaya geçirebilir." },
    { by: "C", stance: "con", text: "Birleştirme nedeniyle sağlık evine en yakın durak 450 metre uzağa taşınıyor; yürüme güçlüğü çeken hastalar için bu ciddi bir kayıp." },
    { by: "C", stance: "con", text: "Yokuşlu bölümlerde 200 metrelik fark bile yaşlılar için çok şey değiştiriyor." },
    { by: "A", stance: "question", reply: 2, bridge: true, text: "Sağlık evinin önündeki durak korunarak diğer duraklar birleştirilse tur süresi ne kadar değişir?" },
  ],
};

// ═══════════════════════════ Tohum sonunda açık evrelerdeki öneriler ═══════════════════════════

/** İtiraz süresinde (1–2 geçersiz itiraz imzası). */
export const OW1: ProposalSpec = {
  key: "OW1",
  kind: "topic",
  author: "murat_e",
  categories: ["Spor"],
  title: "Spor Salonunun Hafta Sonu Açılış Saatlerinin Uzatılması",
  body: P(`
    Mahalle spor salonu hafta sonları 10.00–16.00 arasında açık ve bu saatlerde salon çok kalabalık oluyor. Cumartesi ve pazar günleri açılış saatlerinin 08.00–21.00 olarak uzatılmasını öneriyorum.

    Ek saatlerin personel ihtiyacı, hafta içi öğle saatlerinde salonun bir saat kapalı tutulmasıyla kısmen dengelenebilir; kalan ihtiyaç için gönüllü antrenörlerle iş birliği yapılabilir.

    Uzatılmış saatler üç ay denenir ve giriş sayıları bu başlık altında paylaşılır.`),
  messages: [
    { by: "A", stance: "pro", text: "Hafta sonu sabah saatlerinde salonu kullanmak isteyen çok sayıda çalışan var." },
    { by: "B", stance: "con", text: "Hafta içi öğle kapanışı, o saatlerde salona gelen emeklileri ve vardiyalı çalışanları mağdur ediyor." },
    { by: "C", stance: "neutral", text: "Öğle kapanışı yerine hafta içi akşam saatleri biraz kısaltılabilir mi?" },
    { by: "murat_e", stance: "neutral", reply: 1, bridge: true, text: "Öğle saatlerindeki kullanım verisini isteyelim; gerçekten yoğunsa kapanış saatini birlikte değiştirebiliriz." },
    { by: "B", stance: "question", text: "Gönüllü antrenörlerin sigorta ve sorumluluk durumu nasıl olacak?" },
  ],
};

/** Oylamada (birkaç oy verilmiş; "ayse" henüz oy vermemiş). */
export const V1: ProposalSpec = {
  key: "V1",
  kind: "topic",
  author: "irem_c",
  categories: ["AtikGeriDonusum"],
  title: "Semt Pazarında Bez Torba Dağıtımı ve Plastik Poşet Kullanımının Azaltılması",
  body: P(`
    Semt pazarında her hafta binlerce plastik poşet kullanılıyor ve pazar sonrası bu poşetlerin önemli bir kısmı çevreye saçılıyor. Pazar girişinde bir stant kurularak ilk ay ücretsiz bez torba dağıtılmasını, esnafa ise plastik poşet yerine kâğıt torba kullanmaları için destek verilmesini öneriyorum.

    Bez torbaların gideri katılımcı bütçeden karşılanabilir; stantta gönüllüler atık ayrıştırma konusunda da bilgilendirme yapar. Üç ay sonunda kullanılan poşet sayısındaki değişim esnafla birlikte ölçülür.`),
  messages: [
    { by: "A", stance: "pro", text: "Pazar sonrası çevreye saçılan poşetler gerçekten büyük bir sorun; bez torba dağıtımı iyi bir başlangıç." },
    { by: "B", stance: "con", text: "Esnafa kâğıt torba gideri yüklenmemeli; verilecek destek miktarı net değil." },
    { by: "irem_c", stance: "neutral", reply: 1, text: "Destek miktarı ilk üç ay için torba giderinin yarısı olarak önerildi; esnaf derneğiyle de görüşüldü." },
    { by: "C", stance: "pro", bridge: true, text: "Bez torbaların hafif ve kolay taşınır olması yaşlılar için önemli; ağır torbalar tercih edilmemeli." },
    { by: "B", stance: "question", text: "Üç ay sonundaki ölçüm nasıl yapılacak?" },
    { by: "A", stance: "neutral", reply: 4, bridge: true, text: "Esnaftan haftalık poşet alım miktarlarını isteyip önceki üç ayla karşılaştıracağız." },
  ],
};

/** Tartışma evresinde; bilirkişi paneli çekilmiş, en az bir rapor ve sorular var. */
export const SG1: ProposalSpec = {
  key: "SG1",
  kind: "topic",
  author: "ece_p",
  categories: ["Saglik", "HalkSagligi"],
  title: "Mahalle Sağlık Evinde Ücretsiz Tansiyon ve Şeker Taraması",
  body: P(`
    Mahallemizde yaşlı nüfus arttıkça tansiyon ve şeker hastalığı gibi kronik rahatsızlıkların erken fark edilmesi önem kazanıyor. Mahalle sağlık evinde ayda iki gün, gönüllü sağlık profesyonellerinin desteğiyle ücretsiz tansiyon ve kan şekeri ölçümü yapılmasını öneriyorum.

    Ölçüm sonuçları kişinin kendisine verilir ve saklanmaz; riskli değer görülen kişiler aile hekimine yönlendirilir. Tarama günleri forumda ve muhtarlık panosunda duyurulur. Hareket kısıtlılığı olan yaşlılar için ayda bir gün evde ölçüm ziyareti planlanır.

    Uygulamanın sağlık açısından uygunluğu ve gönüllülerin görev sınırları için bilirkişi görüşü alınması önerilir.`),
  messages: [
    { by: "ece_p", stance: "pro", text: "İlk tarama gününe kırk kişi katılsa bile birkaç tanı almamış hastanın erken fark edilmesi büyük kazanç." },
    { by: "C", stance: "pro", bridge: true, text: "Evde ölçüm ziyaretleri hareket kısıtlılığı olan yaşlılar için çok değerli." },
    { by: "B", stance: "question", text: "Gönüllü sağlık profesyonellerinin mesleki sorumluluğu nasıl güvence altına alınacak?" },
    { by: "ece_p", stance: "neutral", reply: 2, text: "Bu konuyu bilirkişi paneline soru olarak ilettik; raporlarını bekliyoruz." },
    { by: "B", stance: "con", text: "Aile sağlığı merkezleri zaten bu hizmeti veriyor; aynı işi ikinci kez yapmak kaynak israfı olabilir." },
  ],
};

/** Destekçi bekleyen öneri. */
export const SP1: ProposalSpec = {
  key: "SP1",
  kind: "topic",
  author: "hulya_t",
  categories: ["SosyalHizmet", "YasliBakim"],
  title: "Kış Aylarında Mahalle Evinde Geçici Isınma Merkezi",
  body: P(`
    Kış aylarında evini yeterince ısıtamayan yaşlı komşularımız ve sokakta yaşayanlar için mahalle evinin bir salonunun gündüz saatlerinde ısınma merkezi olarak açılmasını öneriyorum. Merkezde sıcak çorba ve çay ikramı gönüllüler tarafından yapılabilir.

    Merkez, hava sıcaklığının sıfırın altına düştüğü günlerde 09.00–21.00 arasında açık olur. Gönüllü listesi ve nöbet çizelgesi forumda paylaşılır.`),
  messages: [
    { by: "hulya_t", stance: "pro", text: "Geçen kış iki yaşlı komşumuz evlerini ısıtamadıkları için hastaneye kaldırıldı; bu ihtiyaç gerçek." },
    { by: "A", stance: "pro", bridge: true, text: "Gönüllü çizelgesine ben de katılabilirim; çorba ikramı için fırınla da görüşebiliriz." },
    { by: "B", stance: "question", text: "Mahalle evindeki salonun ısıtma gideri kimin bütçesinden karşılanacak?" },
    { by: "hulya_t", stance: "neutral", reply: 2, text: "Muhtarlık kış aylarında ısıtma giderini karşılamayı kabul etti; yazılı onayı burada paylaşacağım." },
  ],
};

/** Taslak (yalnız yazarına görünür). */
export const DR1: ProposalSpec = {
  key: "DR1",
  kind: "topic",
  author: "ayse",
  categories: ["AtikGeriDonusum", "YesilAlan"],
  title: "Mahalle Bahçelerinde Kompost Atölyeleri",
  body: P(`
    Organik mutfak atıklarının kompostlanması için mahalle bahçelerinde aylık uygulamalı atölyeler düzenlenmesini öneriyorum. Atölyelerde ev tipi kompost kutusu yapımı, doğru atık karışımı ve kompostun bahçede kullanımı anlatılır.

    Taslak: atölye takvimi ve kompost kutularının yerleri park dostları grubuyla birlikte netleştirildikten sonra öneri gönderilecek.`),
};

// ═══════════════════════════ Silme (karartma) talepleri ═══════════════════════════

/** Hakaret içeren mesaj (Kent İçi Ulaşım konusunda, yanıt olarak). */
export const INSULT_MESSAGE =
  "Bu bisiklet yolu hayallerini savunanlar ya gerçekten aptal ya da bizi aptal yerine koyuyor; bu kadar beyinsiz bir plan görmedim.";
export const REBUTTAL =
  "Üslubum sert oldu, bunun için özür dilerim. Ancak eleştirimin özü, bisiklet yolu güzergâhında kalkacak park yerlerinin esnafa etkisiydi ve bu kaygı hâlâ geçerli.";

export const H1_STATEMENT =
  "Mesaj, öneriyi destekleyen üyelere doğrudan hakaret içeriyor. Eleştirinin içeriği değil, kişileri aşağılayan ifadeler gizlenmeli; mesaj sahibi görüşünü saygılı bir dille yeniden yazabilir.";
export const H1_MESSAGES: MsgSpec[] = [
  { by: "A", stance: "pro", text: "Eleştiri hakkı herkesin ama kişileri aşağılayan ifadeler tartışmayı zehirliyor." },
  { by: "B", stance: "neutral", bridge: true, text: "Mesajdaki otopark eleştirisi önemliydi; keşke aynı kaygı saygılı bir dille yazılsaydı." },
];

/** Kasıtlı kişisel veri ifşası örneği: üçüncü bir kişinin UYDURMA telefon numarası. */
export const PII_MESSAGE =
  "Parktaki kafeteryanın işletmecisi gece geç saatlere kadar yüksek sesle müzik açıyor ve şikâyetleri dikkate almıyor. Herkes doğrudan arasın, cep numarası 0555 010 20 30; belki o zaman ciddiye alır.";
export const PII_STATEMENT =
  "Mesajda üçüncü bir kişinin cep telefonu numarası açıkça paylaşılmış. Kişinin rızası olmadan yayımlanan bu bilgi, karar çıkana kadar daraltılmalı ve gizlenmelidir.";
export const PII_MESSAGES: MsgSpec[] = [
  { by: "A", stance: "pro", text: "Üçüncü kişilerin telefon numaraları paylaşılmamalı; talebi destekliyorum." },
  { by: "B", stance: "neutral", bridge: true, text: "Şikâyet haklı olabilir ama numara paylaşmak doğru değil; şikâyet muhtarlık üzerinden iletilebilir." },
  { by: "C", stance: "pro", text: "Kişisel veri içeren mesajın karar çıkana kadar daraltılmış durması doğru bir uygulama." },
  { by: "A", stance: "question", text: "Mesaj sahibi numarayı kendisi silerse talep düşer mi?" },
  { by: "B", stance: "neutral", reply: 3, text: "Mesaj sahibi mesajını düzenleyebilir; ancak eski sürümler saklandığı için gizleme kararı yine de gerekebilir." },
];

/** "Görüş ayrılığı" gerekçeli (geçersiz) silme talebi. */
export const G1_STATEMENT =
  "Bu mesajdaki görüşe katılmıyorum; otopark ihtiyacını küçümsüyor ve tartışmayı yanlış yönlendiriyor. Bu nedenle gizlenmesini talep ediyorum.";
export const G1_MESSAGES: MsgSpec[] = [
  { by: "A", stance: "con", text: "Bir görüşe katılmamak silme gerekçesi olamaz; bu talebin denetimden geçmeyeceğini düşünüyorum." },
];

// ═══════════════════════════ Azınlık raporları ve itirazlar ═══════════════════════════

export const MINORITY_REPORTS: Record<string, string> = {
  C1: "Engelli park yerlerinin düşük doluluk oranı ihtiyacın az olduğunu değil, yer bulamama kaygısıyla çarşıya gelmekten vazgeçen komşularımızın sayısını gösteriyor. Görüş grubumuz, dönüşümün engelli bireylerin kent merkezine erişimini kalıcı olarak zorlaştıracağını düşünüyor. Karar alınacaksa doluluk ölçümü engelli dernekleriyle birlikte yapılacak bir talep araştırmasıyla desteklenmeli ve dönüşüm geri alınabilir olmalıdır.",
  O1: "Durakların birleştirilmesi tur süresini kısaltıyor ancak sağlık evine en yakın durağı 450 metre uzaklaştırıyor. Yürüme güçlüğü çeken hastalar için bu mesafe, sağlık hizmetine erişimi doğrudan etkiliyor. Sağlık evi önündeki durağın korunması koşuluyla birleştirmeye karşı değiliz.",
  C2: "Scooter park noktalarının kaldırımlara yerleştirilmesi tekerlekli sandalye kullananlar, görme engelliler ve bebek arabalı aileler için yeni engeller yaratıyor. Park noktalarının yol kenarındaki eski park ceplerine taşınmasını ve hissedilebilir yüzeylerin korunmasını öneriyoruz.",
  C3: "Işıksız geçitlerin kaldırılması yaşlılar ve yürüme güçlüğü çekenler için yürüme mesafesini üç katına çıkarıyor. Sağlık evi ve pazar önündeki geçitlerin ışıklı hâle getirilerek korunmasını ve tüm yaya ışıklarına geri sayım sayacı eklenmesini talep ediyoruz.",
};

export const O1_OBJECTIONS: { ground: string; statement: string }[] = [
  { ground: "fy:OrantisizAzinlikEtkisi", statement: "Durak birleştirmesinin yükü ağırlıklı olarak sağlık evine giden yaşlı ve engelli komşularımıza düşüyor." },
  { ground: "fy:OrantisizAzinlikEtkisi", statement: "Sağlık evine en yakın durak 450 metre uzaklaşıyor; yürüme güçlüğü çekenler için bu orantısız bir etki." },
  { ground: "fy:YeniBilgi", statement: "Belediyenin yeni yolcu sayımına göre kaldırılacak duraklardan biri günde 300 yolcu alıyor; bu bilgi oylamadan sonra ortaya çıktı." },
];

export const OW1_OBJECTIONS: { ground: string; statement: string }[] = [
  { ground: "fy:OrantisizAzinlikEtkisi", statement: "Hafta içi öğle kapanışı, o saatlerde salonu kullanan emekliler ve vardiyalı çalışanlar için orantısız bir kayıp." },
  { ground: "fy:BilgiEksikligi", statement: "Öğle saatlerindeki kullanım verisi tartışma sürecinde paylaşılmadı; karar eksik bilgiyle alındı." },
];

// ═══════════════════════════ Bilirkişi soruları ve raporları ═══════════════════════════

export const EN1_QUESTIONS: MsgSpec[] = [
  { by: "C", stance: "question", text: "Çatıya panel kurulumu sırasında okulun eğitim faaliyetleri ve öğrenci güvenliği nasıl korunur?" },
  { by: "B", stance: "question", text: "Pilot kurulumun geri ödeme süresi okulun mevcut elektrik tüketimine göre ne kadar olur?" },
];

export const EN1_REPORTS: { assessment: "feasible" | "infeasible" | "uncertain"; confidence: number; risks: string[]; body: string; dissent?: string; answers: string[] }[] = [
  {
    assessment: "feasible",
    confidence: 0.8,
    risks: ["Kurulum sırasında çatı su yalıtımının zarar görmesi", "Panel temizliği ve bakım sorumluluğunun belirsiz kalması"],
    body: "Okul çatılarının güneş paneli için uygunluğu, çatı taşıma kapasitesine, yönlenmeye ve gölgelenmeye bağlıdır. İncelenen pilot okulun çatısı güney yönlü ve gölgelenmesi düşük; yaklaşık 30 kWp gücündeki bir kurulumun yıllık üretimi okulun elektrik tüketiminin yüzde 35–45'ini karşılayabilir. Statik inceleme raporunun olumlu çıkması koşuluyla pilot uygulama teknik olarak uygulanabilir görünmektedir.",
    answers: [
      "Kurulum yaz tatilinde ya da hafta sonlarında yapılmalı, çalışma alanı öğrenci erişimine kapatılmalı ve çatıya çıkış güvenlik halatıyla sağlanmalıdır.",
      "Mevcut tüketim ve kurulum gideri dikkate alındığında geri ödeme süresi yaklaşık 6–8 yıl olarak öngörülebilir; bakım giderleri bu süreyi bir yıl kadar uzatabilir.",
    ],
  },
  {
    assessment: "uncertain",
    confidence: 0.6,
    risks: ["Çatı onarım sözleşmesiyle çakışma", "İnverter arızalarında uzun bekleme süresi"],
    body: "Teknik açıdan kurulum mümkün görünmekle birlikte, pilot okulun çatısında yürüyen bir onarım sözleşmesi bulunuyor. Onarım tamamlanmadan çatıya ek yük getirilmesi hukuka aykırı olabilir; bu nedenle kurulum takvimi onarımın bitimine göre planlanmalıdır. Ayrıca inverter yedek parçalarının temin süresi, arızalarda üretim kaybına yol açabilecek düzeydedir.",
    dissent: "Geri ödeme süresi hesabında panel verimindeki yıllık düşüş dikkate alınmalıdır.",
    answers: ["Çalışma alanı kurulum boyunca kapatılmalı; vinç kullanılacaksa okul bahçesi o gün boşaltılmalıdır."],
  },
];

export const SG1_QUESTIONS: MsgSpec[] = [
  { by: "zeynep", stance: "question", text: "Hareket kısıtlılığı olan yaşlılar için evde ölçüm ziyaretlerinde hangi hijyen ve güvenlik kurallarına uyulmalı?" },
  { by: "A", stance: "question", text: "Gönüllü sağlık profesyonelleri ölçüm sırasında hangi değerlerde kişiyi acil servise yönlendirmeli?" },
];

export const SG1_REPORTS: { assessment: "feasible" | "infeasible" | "uncertain"; confidence: number; risks: string[]; body: string; dissent?: string; answers: string[] }[] = [
  {
    assessment: "feasible",
    confidence: 0.85,
    risks: ["Ölçüm cihazlarının düzenli kalibre edilmemesi", "Riskli değer görülen kişilerin takibinin yapılmaması"],
    body: "Toplum tabanlı tansiyon ve kan şekeri taramaları, yaşlı nüfusta tanı almamış hipertansiyon ve diyabetin erken saptanmasında etkili ve düşük maliyetli bir yöntemdir. Önerinin sonuçları saklamaması ve riskli kişileri aile hekimine yönlendirmesi uygun bir tasarımdır. Ölçümlerin kalibre edilmiş cihazlarla, eğitimli sağlık personeli tarafından yapılması ve yönlendirme ölçütlerinin yazılı hâle getirilmesi önerilir.",
    answers: [
      "Evde ölçüm ziyaretlerinde tek kullanımlık lanset ve eldiven kullanılmalı, cihazlar her ziyaret arasında dezenfekte edilmeli ve ziyaretler iki kişiyle yapılmalıdır.",
      "Belirgin yüksek tansiyon değerleri ya da göğüs ağrısı, nefes darlığı gibi yakınmalar eşlik ediyorsa kişi bekletilmeden acil servise yönlendirilmelidir; diğer yüksek değerlerde aile hekimine yönlendirme yeterlidir.",
    ],
  },
];
