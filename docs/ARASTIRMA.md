# Benzer Çalışmalar ve Literatür Araştırması

> **Proje:** Katılımcı Yönetişim Forumu ("Form/Forum Sistemi"), web sitesi ve Android uygulaması
> **Belge:** Benzer sistemler ve literatür araştırması (ödev teslim belgesi)
> **Tarih:** 1 Ekim 2026
> **Kapsam:** Sekiz paralel araştırma alanının sentezi (yaklaşık 300 kaynak)

**Okuma notu:** Köşeli parantez içindeki numaralar [n], Bölüm 15'teki Kaynakça'yı gösterir. "Tasarım önerisi" veya "bizim değerimiz" diye işaretlenen sayılar kaynaklardan alınmamıştır. Bunlar simülasyonla ayarlanması gereken başlangıç değerleridir. Özel adlar (LiquidFeedback, Polis, Schulze vb.) özgün biçimleriyle bırakılmıştır.

## İçindekiler

1. Yönetici Özeti
2. Yöntem ve Kapsam
3. Katılımcı Demokrasi ve Müzakere Platformları
4. Köprü Kuran Uzlaşı (Bridging) ve Görüş Kümeleme
5. Dağıtık Defter, E-Oylama ve DAO Yönetişimi
6. Yönetmeliğin Ontoloji Olarak Modellenmesi
7. Bilirkişi Entegrasyonu
8. İnsanları Grafta Tutmak: Sosyal Graf, Sybil Direnci, Likit Demokrasi
9. Yapay Zekâ, KVKK ve Web/Android Mimarisi
10. Platform ve Gereksinim Karşılaştırma Tablosu
11. Çoğunluğun Azınlığı Ezmesi (Çoğunluk Tiranlığı) Problemi
12. Algoritmalar
13. Gereksinimlerden Tasarıma: Önerilen Sentez
14. Riskler ve Açık Sorunlar
15. Kaynakça

---

## 1. Yönetici Özeti

Hocamızın istediği sistem bir katılımcı yönetişim platformudur. İstenenler şunlardır:

- herkes konu ve düzenleme teklifi açabilmeli (1),
- kabul için çoğunluk aranmalı (2),
- üyelerin kimliği doğrulanmalı ama üyeler takma adla görünmeli (3),
- konu ve alt konular oylamayla resmîleşmeli (4–5),
- yönetmelik bir ontoloji olarak konuları denetlemeli (6),
- tartışmalar silinmemeli ve kısmi silme ancak oylamayla mümkün olmalı (7–8).

Ayrıca Android ve web istemcisi, dağıtık defter, bilirkişi, yapay zekâ ve insanların bir grafta tutulması isteniyor. Açık soru da şu: "Çoğunluk azınlığı tüketebilir; bunu nasıl çözeriz?"

Temel bulgular:

1. **Hiçbir mevcut sistem gereksinimlerin tamamını karşılamıyor** (Bölüm 10). Her parçanın en iyi örneği başka bir sistemde:
   - karar motoru: LiquidFeedback [1];
   - düzenleme teklifi (emendation) akışı: Decidim [8];
   - azınlığı hesaba katan ölçüm: Polis [49] ve X Community Notes [63];
   - "hiçbir şey kaybolmaz" ilkesi: Wikipedia'nın revizyon gizleme düzeni [40].
2. **Yaşam döngüsü:** Tek bir durum makinesi kurulmalı ve politika tablosuyla yönetilmeli. Kaynakları şunlar: LiquidFeedback'in dört evresi (kabul, tartışma, dondurma, oylama) [1], CONSUL'ün belli destek sayısından sonra düzenlemeyi kilitlemesi [25] ve OpenGov'un onay penceresi [125].
3. **"Çoğunluk" tanımı:** Rakip alternatifler varsa, mevcut durumun (statüko) da seçenek olarak eklendiği Schulze yöntemi kullanılır [1][109][111]. Tek seçenekli oylarda kural "evet/(evet+hayır) > 1/2" ve katılım yeter sayısıdır.
4. **Çoğunluk tiranlığının tek bir çaresi yok; savunma katmanlı olmalı.** Literatür, nitelikli çoğunluğun tek başına azınlığı değil statükoyu koruduğu konusunda açıkça uyarıyor [1]. Önerdiğimiz katmanlar (ayrıntı Bölüm 11'de):
   - ontolojide, çoğunluğun değiştiremeyeceği bir haklar çekirdeği;
   - görüş kümelerinin eşzamanlı rızası (köprü testi);
   - bir kez kullanılabilen, süreli ve askıya alıcı azınlık itirazı;
   - gündeme orantılı erişim;
   - gizli oy;
   - azınlık gerekçelerinin karar kaydına geçmesi;
   - tamamen şeffaf bir defter.
5. **Tartışmada "silme", fiziksel silme değil karartmadır (redaction).** Bir silme talebi yalnızca sayılı gerekçelere (kişisel veri, tehdit, ağır hakaret vb.) dayanabilir. "Katılmıyorum" bir gerekçe değildir [40]. Silme oylaması 2/3 çoğunluk ister ve yazarın kendi görüş kümesinden de destek arar.
6. **Dağıtık defter:** Dört doğrulayıcılı, Tendermint tarzı BFT uzlaşı kullanılır (f=1, yeter sayı 3) [146]. Deftere yalnızca özetler (hash), taahhütler ve olaylar yazılır; kişisel veri asla yazılmaz [279].
7. **Ontoloji:** Yönetmelik RDF/Turtle ile modellenir. Sınıflandırma N3 kurallarıyla (N3.js), denetim SHACL ile (shacl-engine), sayısal işlemler TypeScript ile yapılır. Bu boru hattı bir prototipte çalıştırılıp doğrulandı (Bölüm 6.3).
8. **Bilirkişi:** Kurumsal modelimiz 6754 sayılı Bilirkişilik Kanunu ve Bilirkişilik Yönetmeliği'dir [202][204]. Bilirkişi, çıkar çatışması süzgecinden geçmiş, ağırlık tavanlı ve doğrulanabilir bir kurayla seçilir. Görüşü bağlayıcı değildir, danışma niteliğindedir; ancak oylamayı bir kez ertelettirebilir [208].
9. **Graf:** SQLite tek doğruluk kaynağıdır, hesaplar bellekte graphology ile yapılır. Grafta şunlar hesaplanır: görüş kümeleri, sahte hesap (Sybil) triyajı (SybilRank [231]), koordineli oy tespiti (SynchroTrap [255]) ve bilirkişi çıkar çatışması.
10. **Yapay zekâ yalnızca danışmandır.** Perspective API 31 Aralık 2026'da kapanıyor [259]. Moderasyon şu üç katmandan oluşur: kurallar, Claude sınıflandırıcısı ve insan kuyruğu. Özetlerde azınlık bölümü atılamaz; her cümle kaynak yorumun kimliğine bağlanır [82][52].
11. **KVKK:** Oylar ve gönderiler siyasi düşünceyi açığa çıkarabilir; siyasi düşünce özel nitelikli kişisel veridir (KVKK md. 6) [272]. Bu yüzden kimlik bilgileri ayrı ve şifreli bir kasada tutulmalı. TC kimlik numarası yalnızca anahtarlı özet (kör indeks, blind index) olarak saklanmalı [284].
12. **Mobil:** Tek bir React + TypeScript kod tabanı Capacitor 8 ile Android'e paketlenir [289]. İncelenen platformların hiçbirinde yerel (native) mobil uygulama kanıtı bulunmadı.

**Önerilen karar kuralı tek cümleyle:** *Çoğunluk karar verir ama sınırlar içinde: dokunamayacağı haklar vardır; ağır kararlarda görüş kümelerinin eşzamanlı rızası aranır; azınlık bir kez, inceleme ve daha yüksek eşikte yeniden oylama tetikleyen askıya alıcı bir itiraz yapabilir; gündeme erişim orantılıdır ve defter tamamen şeffaftır. Azınlığa verilen her yetki geçici, bütçeli ve aşılabilirdir; böylece azınlık tiranlığı (liberum veto) da önlenir.*

---

## 2. Yöntem ve Kapsam

Araştırma sekiz paralel alana bölündü. Her alanda birincil kaynaklar (makaleler, resmî dokümantasyon, kaynak kod, mevzuat) tercih edildi. Erişilemeyen kaynaklar ilgili bölümde belirtildi.

| # | Alan | Başlıca incelenen sistemler ve kaynaklar |
|---|---|---|
| 1 | Katılımcı demokrasi platformları | LiquidFeedback, Decidim, CONSUL, Loomio, Your Priorities, Citizen OS, DemocracyOS, adhocracy+, Kialo, Polis/vTaiwan, Wikipedia, Stack Exchange, Birleşik Krallık e-dilekçe sistemi |
| 2 | Çoğunluk tiranlığı: teori ve mekanizmalar | Madison, Tocqueville, Mill, Calhoun, Lijphart, Guinier; Türkiye, Almanya ve Belçika anayasaları; Kuzey İrlanda; Debian; Polkadot; kuadratik oy (QV); Eşit Paylar Yöntemi (MES); kura |
| 3 | Köprü kuran uzlaşı ve kümeleme | Polis, Community Notes, Bridging Systems, Talk to the City, Habermas Machine, Collective Constitutional AI, Meta Community Forums |
| 4 | Dağıtık defter ve e-oylama | PBFT, Tendermint/CometBFT, Clique/Aura, Raft, HotStuff, Fabric, Helios, Estonya, Voatz, Compound, Snapshot, OpenGov, Tezos, Aragon, Lido, MACI, EDPB |
| 5 | Ontoloji ve hukuk bilişimi | LKIF Core, LegalRuleML, Akoma Ntoso, ELI, SHACL, ODRL, Nomic, Türk mevzuat yapısı, JavaScript RDF araçları |
| 6 | Bilirkişi entegrasyonu | 6754 sayılı Kanun, Bilirkişilik Yönetmeliği, HMK, Kleros, Delphi, Metaculus, EigenTrust, hakem atama araştırmaları, drand |
| 7 | Sosyal graf | BrightID, SybilRank, SybilLimit, Proof of Humanity, Passport, likit demokrasi teorisi, Leiden, SynchroTrap |
| 8 | Yapay zekâ, KVKK, mobil | Perspective API, LLM moderasyon önyargısı, Talk to the City, Polis GIC, e5 gömmeleri, KVKK 6698, AB Yapay Zekâ Yasası md. 50, CipherSweet, Capacitor, React Native, Flutter |

**Doğrulama notları:**

- LiquidFeedback'in `core.sql` dosyası 404 döndürdü [6].
- Stack Exchange'in ayrıcalık sayfasına erişim engellendi; bu yüzden OSQA'nın değerleri kullanıldı [45].
- Metaculus sayfaları 403 döndürdü; formüller arama özetlerinden alındı [219].
- Kleros'un teknik makalesi (yellowpaper) 404 döndürdü [213].
- Science'taki Habermas Machine makalesi 403 döndürdü; ayrıntılar makalenin bir PDF kopyasından alındı [76].
- Optimism'in veto eşiği ve MolochDAO'nun süreleri yalnızca ikincil kaynaklarda görüldü.

---

## 3. Katılımcı Demokrasi ve Müzakere Platformları

### 3.1 LiquidFeedback (Public Software Group / Interaktive Demokratie e.V.)

**Ne yapar:** Bulduğumuz en titiz karar motoru [1][5]. Temel birim "issue" (mesele) adı verilen bir gruptur ve birbiriyle yarışan alternatif "initiative"lerden (girişimlerden) oluşur. Bir meseledeki tüm girişimler her zaman aynı durumda ilerler. Her mesele dört süreli evreden geçer:

1. kabul (admission): 1. yeter sayı aranır;
2. tartışma;
3. doğrulama/dondurma (frozen): 2. yeter sayı aranır;
4. oylama: mevcut durumun (statüko) örtük bir seçenek olarak eklendiği Schulze yöntemiyle.

Çekirdek kod PostgreSQL ve PL/pgSQL ile yazılmış. Bir `policy` tablosu her karar türü için süreleri, yeter sayıları ve gereken çoğunluğu tutar.

**Mekanizmalar:**

- **Kabul evresi:** Girişimlerden en az biri 1. yeter sayıya (issue_quorum) ulaşmalıdır; "potansiyel destekçiler" de sayılır. Yeter sayıya ulaşılınca evre hemen biter. Ulaşılamazsa mesele, izin verilen en uzun kabul süresi dolunca kapanır.
- **Tartışma evresi:** Girişimin sahibi metni düzenleyebilir ve her düzenleme destekçilere bildirilir.
- **Dondurma evresi:** Metin artık değişemez, ama yeni rakip alternatif eklenebilir. Böylece son dakikada değiştirilmiş bir öneriyi beğenmeyen herkes eski hâlini yeniden önerebilir. Evrenin sonunda her girişim 2. yeter sayıya ulaşmalıdır; burada yalnızca "memnun" destekçiler sayılır.
- **Oylama:** Oy pusulası onay, çekimser ve ret bölümlerinden oluşur; onay bölümünde tercih seviyeleri vardır. Atılan oylar oylama bitene kadar gizli kalır.
- **Öneriler (suggestions):** Destekçiler, girişime yapılan değişiklik önerilerini iki eksende derecelendirir: "mutlaka / olmalı / olmamalı / kesinlikle olmamalı" ve "uygulandı / uygulanmadı". Girişim sahibi bu önerileri uygulamak zorunda değildir, çoğunluk istese bile.
- **Politika alanları:** Kabul, tartışma, doğrulama ve oylama süreleri; iki yeter sayı; isteğe bağlı nitelikli çoğunluk. Kitaptaki örnek süreler 4/8/4/4 haftadır. Örnek yeter sayı %10'dur: 500 kişilik nüfusta 50 destekçi gerekir.
- **Beraberlik:** Önce oluşturulan girişim kazanır. Statükoyla berabere kalan girişim kaybeder.
- **Issue Limiter:** Açık mesele sayısı arttıkça kabul eşiği üstel olarak yükselir; böylece gündem doldurulamaz [4].
- **Azınlık koruması:** Kitapta bu konuya ayrılmış bir bölüm var. Önerilen araçlar: Harmonic Weighting ve Proportional Runoff ile adil sıralama [3], değişiklik isteği yerine rakip alternatifler, klon-bağımsız oylama ve gizli oy.

**Güçlü yönler:**

- Kurallar deterministik; beraberlik rastgele çözülmez.
- Dondurma evresi, son anda metni değiştirme hilesini ("yem ve değiştir", bait-and-switch) engeller.
- Statüko gerçek bir seçenektir; "hepsini reddet" her zaman mümkündür.
- Kategoriye göre farklı politika uygulanabilir (örneğin 2/3 yalnızca tüzük değişikliğinde).

**Zayıf yönler:**

- Oylar ve vekâletler herkese açıktır. Bu, mahremiyet ve baskı endişesi doğurur [2].
- Alman Korsan Partisi verisinde vekâlet gücü yoğunlaştı [7]:
  - vekâlet dağılımı üssü 1,38 olan bir kuvvet yasasına uydu;
  - yalnızca 38 kullanıcı 100'den fazla vekâlet aldı;
  - eşitsizliği ölçen Gini katsayısı zamanla arttı;
  - buna karşın sonuçların %84,9'u vekâlet olmasaydı da aynı çıkardı.
- Kitap, devredilemez hakların bir algoritmayla güvenceye alınamayacağını, bunun için bir anayasa ve insan yargıçlar gerektiğini söyler.

**Bizim sisteme etkisi:**

- Dört evreli makineyi konu, alt konu ve silme talepleri için kopyalayacağız. Süreler ve yeter sayılar kategori başına bir politika tablosunda tutulacak.
- Düzenleme tekliflerini aynı mesele içinde rakip alternatif olarak modelleyeceğiz.
- Oylamada statükolu Schulze kullanacağız. "Ters yenme yolu olmama" (no reverse beat path) güvencesini uygulayacağız. Beraberlikte en eski alternatif kazanacak.
- Gündeme kabulde yalnızca olumlu destek sayılacak; nihai oydan önce eksi oy olmayacak.
- Alternatifler ham beğeni sayısına göre değil, Harmonic Weighting ile sıralanacak.
- Nitelikli çoğunluğu azınlık koruması olarak değil, yönetmeliğin istikrarını koruyan bir araç olarak sunacağız.
- Azınlık haklarını, sistemin "anayasası" işlevini gören ontoloji ve bilirkişi katmanına yerleştireceğiz.

### 3.2 Decidim (Barselona)

**Ne yapar:** Modüler bir Ruby on Rails platformu [20]. Katılım alanları (süreçler, meclisler, girişimler) bileşenler içerir: öneriler, tartışmalar, yorumlar, sonuçlar. Süreçlerin zaman sıralı evreleri vardır ve bileşen izinleri her evre için ayrı ayarlanır [19].

**Mekanizmalar:**

- **Düzenleme teklifi (emendation) akışı** [8][9]:
  - taslak;
  - değerlendirme (asıl yazara bildirim gider);
  - kabul: öneri güncellenir, yeni sürüm teklif sahibine atfedilir ve sürüm geçmişi gösterilir;
  - ya da ret: reddedilen teklif isteğe bağlı olarak bağımsız bir öneriye "yükseltilebilir" (promote).

  Her evre için ayrı ayarlanabilenler: teklif oluşturma, tepki verme, yükseltme ve görünürlük.
- **Öneri ayarları** [10]: katılımcı başına oy limiti, öneri başına eşik, dakika cinsinden düzenleme penceresi, yönetici cevap verdikten sonra düzenleme yasağı. Resmî cevap durumları: değerlendiriliyor, kabul, ret [22][23].
- **Yorumlar:** İç içedir. Her yorum, yorum yapılan nesneye göre "lehte / aleyhte / nötr" diye işaretlenebilir. Yorum silme yumuşak silmedir: iplik yerinde kalır ve bir yorumun silindiğini gösteren yer tutucu görünür [21].
- **Moderasyon** [12][13]: Kullanıcılar gerekçe seçerek şikâyet eder. `max_reports_before_hiding = 3` (varsayılan) ayarıyla üç şikâyette içerik otomatik gizlenir [11]. Gizlenen içerik silinmez, bir listede durur.
- **Kimlik doğrulama** [14][15][16]: Form tabanlı doğrulama (örneğin kimlik numarası ve doğum tarihi) ve iş akışı tabanlı doğrulama (posta ile gönderilen kod veya yöneticinin incelediği kimlik belgesi). Yetki eylem bazında verilir (oy verme, öneri oluşturma, imza). Kimlik belgeleri doğrulamadan sonra silinir.
- **Girişim modülü** [17][18]: oluşturuldu → teknik doğrulama → yayımlandı / reddedildi / süresi doldu; ardından yeterli imza toplanırsa kabul, toplanmazsa ret. Varsayılanlar:
  - en az 2 komite üyesi;
  - 120 günlük imza süresi;
  - doğrulamada 60 günü aşan girişim iptal edilir;
  - `similarity_threshold = 0.25` ve en fazla 5 benzer girişimin gösterilmesi;
  - destekçilere %33 ve %66'da bildirim.
- **İstek sınırı:** dakikada 100 istek.

**Güçlü yönler:** Sürüm geçmişli, atıflı ve denetlenebilir bir düzenleme akışı. "Promote" kapısı, tek bir yazarın bir teklifi susturmasını engeller. Moderasyon içeriği gizler ama silmez. Kimlik doğrulama yöntemleri eklenebilir ve oluşturma anında benzer öneriler tespit edilir.

**Zayıf yönler:**

- Düzenleme teklifini yalnızca asıl yazar kabul veya ret eder; yani tek kişilik bir bekçi vardır.
- Üç şikâyette otomatik gizleme, bir grubun azınlığı susturması için kullanılabilecek bir kaldıraçtır.
- Resmî kabulü kurum verir; bağlayıcı bir oylama yoktur.
- İncelenen kaynaklarda yerel mobil uygulama kanıtı yoktur.

**Bizim sisteme etkisi:**

- Emendation durumlarını ve "promote" kapısını alacağız. Ancak tartışmalı teklifleri yazara bırakmak yerine rakip alternatif olarak oylamaya göndereceğiz.
- Her tartışma girdisine lehte/aleyhte/nötr işareti ekleyeceğiz.
- Yumuşak silme, yer tutucu ve sürüm geçmişi uygulayacağız.
- Sıradan içerikte "N şikâyette otomatik gizleme" yapmayacağız. Yalnızca kişisel veri ve tehdit gibi acil kategorilerde içeriği geçici olarak katlayacağız.
- Doğrulama tasarımını kopyalayacağız: ayrı yetkilendirme işleyicileri, tekil kimlik anahtarı, doğrulama sonrası belge silme ve eylem bazlı yetki.
- Oluşturma anında benzer öneri uyarısını alacağız.

### 3.3 CONSUL Democracy / Decide Madrid

**Ne yapar:** Madrid Belediyesi'nin 2015'te başlattığı ve 150'den fazla kurumun kullandığı açık kaynaklı bir Rails platformu [24]. Tartışmalar, vatandaş önerileri, anketler ve katılımcı bütçe içerir. Vatandaş önerileri bir eşiğe kadar destek toplar, eşiği geçince halk oylamasına gider. Madrid'de eşik, 16 yaş üstü nüfusun %1'iydi (27.064 destek) ve süre 12 aydı.

**Mekanizmalar:**

- **Kod varsayılanları** [25]:
  - `votes_for_proposal_success = 10000`;
  - `months_to_archive_proposals = 12`;
  - `max_votes_for_proposal_edit = 1000` (1000 destekten sonra öneri düzenlenemez);
  - `comments_body_max_length = 1000`;
  - `min_age_to_participate = 16`;
  - `direct_message_max_per_day = 3`.
- **Doğrulama seviyeleri** [26]: Seviye 2, ikamet ve SMS doğrulaması ister. Seviye 3 tam doğrulamadır. Belge numarası, belge türü başına tekildir.
- **Moderasyon:** Gizleme geri alınabilir (`acts_as_paranoid` ve `hidden_at`). Tüm moderasyon işlemleri kayda geçer [28].
- **Yorumlar:** Bir güven puanına göre sıralanır [27].

**Güçlü yönler:** Basit bir "eşik, sonra oylama" modeli; belli destekten sonra düzenleme kilidi; geri alınabilir gizleme; net doğrulama seviyeleri.

**Zayıf yönler:**

- Yalnızca iki öneri eşiğe ulaştı; ikisi de açılış günü yayımlanmıştı [29].
- "Hot Score" sıralaması, eskileri hep öne çıkarıp yeni önerileri gömen bir Matthew etkisi yarattı.
- Birbirinin tekrarı olan öneriler desteği böldü.
- Mutlak eşik, aktif katılımcı sayısıyla ölçeklenmediği için süreç işlemedi.

**Bizim sisteme etkisi:**

- Eşikleri aktif katılımcı sayısına göre göreli tanımlayacağız.
- Yalnızca popülerliğe göre sıralama yapmayacağız; benzer konuları YZ ile kümeleyeceğiz.
- Belli bir destek sayısından sonra veya dondurma evresinde metni kilitleyeceğiz.
- Üç seviyeli doğrulama uygulayacağız:
  - L1, e-posta/SMS: yorum yapabilir;
  - L2, adres doğrulanmış: konulara destek verebilir;
  - L3, kimlik doğrulanmış: oy verebilir ve silme talebi açabilir.

### 3.4 Loomio

**Ne yapar:** Tartışma ipliklerini türlere ayrılmış anketlerle birleştirir [30][31][33]. Anket şablonları arasında nabız yoklaması, tavsiye, rıza (consent), uzlaşı (consensus) ve çoğunluk oylaması vardır.

**Mekanizmalar:**

- **Uzlaşı seçenekleri:** katılıyorum, çekimser, katılmıyorum, blok. Blok seçeneği kötüye kullanılabildiği için şablondan kaldırılabilir.
- **Rıza süreci:** Geçerli bir itiraz açık, kişisel olmayan ve kanıta dayalı olmalıdır. Teklif sahibi itirazları metne yansıtıp yeni bir tur açar.
- **Ayarlar** [32]:
  - kapanış tarihi;
  - anonim oy (oylama başladıktan sonra açılamaz);
  - sonuçları kapanışa kadar gizleme;
  - ret veya blok oyları için gerekçe zorunluluğu (varsayılan 500 karakter);
  - kapanıştan 24 saat önce hatırlatma;
  - yeter sayı ve onay eşikleri;
  - kapanışta yazılan bir sonuç beyanı.

**Güçlü yönler:** Muhalif oylara gerekçe bağlandığı için azınlığın argümanı kayda geçer. Sonuçları gizlemek sürü etkisini azaltır.

**Zayıf yönler:** Küçük gruplara göre tasarlanmıştır. Blok, tek kişinin azınlık tiranlığına dönüşebilir. Eşikleri teklif sahibi belirler.

**Bizim sisteme etkisi:**

- "Ret" oylarında ve silme taleplerinde gerekçe zorunlu olacak.
- Çalışan sonuçlar kapanışa kadar gizli kalacak.
- Yapılandırılmış bir "itiraz" türü ekleyeceğiz. İtiraz, bir ontoloji sınıfına veya somut bir zarara atıf yapmak zorunda olacak. Geçerli bir itiraz oyla ezilmeyecek; konuyu bilirkişi incelemesine kadar duraklatacak. Bu bir veto değil, sınırlı bir azınlık sesidir.
- Sonuç beyanının taslağını YZ yazacak, insan onaylayacak; beyanın özeti deftere yazılacak.

### 3.5 Your Priorities / Better Reykjavik (Citizens Foundation)

**Ne yapar:** Reykjavik'in 2010'dan beri kullandığı fikir toplama platformu [34]. Yorum ipliği yerine ayrı "lehte noktalar" ve "aleyhte noktalar" sütunları vardır. Her nokta artı veya eksi oylanır. Noktalara doğrudan cevap yazılamaz; karşı bir nokta yazmak gerekir.

YZ işlevleri: çeviri, transkripsiyon, öneri ve zehirli içerik tespiti. Zehirli içerik tespiti moderatörü uyarır, içeriği otomatik silmez.

Sayfadaki rakamlar: 120.000 nüfustan 70.000'den fazla katılımcı, 10.000 fikir, 21.000 tartışma noktası ve 2011'den beri hayata geçirilmiş 798 proje.

**Güçlü yönler:** Yapılandırılmış lehte/aleyhte biçimi kavga ortamını azaltır. YZ moderatöre yardım eder ama onun yerine geçmez.

**Zayıf yönler:** Noktaların artı/eksi oylanması, çoğunluğun azınlık argümanlarını gömmesine izin verir.

**Bizim sisteme etkisi:** Serbest yanıtların yanında lehte ve aleyhte noktalar da olacak. İki sütun ayrı ayrı sıralanacak; böylece azınlık argümanı kendi sütununun başında görünebilecek. Zehirli içerik puanı yalnızca insana bildirilecek; içerik asla bu puana göre silinmeyecek.

### 3.6 Citizen OS

**Ne yapar:** Estonya kaynaklı açık kaynaklı bir e-demokrasi platformu [35]. Bir konu dört evreden geçebilir:

1. fikir toplama;
2. tartışma (lehte, aleyhte ve nötr bilgi noktaları);
3. oylama (tek veya çok seçim, vekâlet, isteğe bağlı veto);
4. eylem ve takip.

Oylar Estonya kimlik kartı, Mobile-ID veya Smart-ID ile dijital olarak imzalanır. Şikâyet edilen içerik gizlenir ama "Yine de göster" ile görülebilir; şikâyet edilen kullanıcıya içeriğini düzeltme fırsatı verilir. Oylar diğer katılımcılara anonimdir, ancak konu yöneticileri oylama sonrasında oy kayıtlarına erişebilir. Ayrı bir mobil uygulaması yoktur; duyarlı (responsive) bir web sitesidir.

**Bizim sisteme etkisi:**

- Bir silme oylaması sürerken içerik "katlanmış ama yine de gösterilebilir" olacak.
- Oylama başlamadan önce yazara bildirim gidecek ve yazar içeriği kendisi düzeltebilecek.
- Kabul edilen kararlar için bir uygulama takibi evresi olacak.
- Her oy cihaz anahtarıyla imzalanacak ve imzanın özeti deftere yazılacak.
- Yöneticinin oy kayıtlarına erişmesine izin vermeyeceğiz; bu, oy gizliliğini zayıflatıyor.

### 3.7 DemocracyOS (Partido de la Red, Arjantin)

2012'den beri var olan, açık kaynaklı bir "öner, tartış, oyla" platformu [36]. Vatandaşlar, parlamentodaki yasa tasarıları için partinin temsilcisine nasıl oy vereceğini söyler. Destek eşiğine ulaşan yasa önerileri resmen sunulur. Her oylamanın net bir son tarihi vardır. Participedia'ya göre konu başına geçişli vekâlet desteklenir [37]. Moderasyon ve azınlık güvenceleri belgelenmemiştir.

**Bizim sisteme etkisi:** Her evrenin kesin bir son tarihi olacak. Vekâlet eklenirse konu (ontoloji kategorisi) başına ve şeffaf olacak.

### 3.8 adhocracy+ (Liquid Democracy e.V., Berlin)

AGPLv3 lisanslı, kendi sunucunuzda barındırabileceğiniz modüler bir platform [38]. Modüller: beyin fırtınası (harita tabanlı olanı dahil), fikir yarışması, metin inceleme, anket, katılımcı bütçe ve önceliklendirme. Modüller zincirlenerek çok evreli süreçler kurulabilir. "Metin inceleme" modülü, bir yönetmelik taslağına paragraf düzeyinde yorum yapmayı sağlar. LiquidFeedback düzeyinde bağlayıcı bir karar motoru yoktur.

**Bizim sisteme etkisi:** Yönetmelik maddelerine madde ve paragraf bazında yorum yapılabilecek; yorumlar ilgili ontoloji düğümüne bağlanacak. Evre dizisi konu türüne göre yapılandırılabilecek.

### 3.9 Kialo

Bir argüman haritalama platformu [39]. Kökte bir tez, altında lehte ve aleyhte iddialardan oluşan bir ağaç vardır; her iddianın da kendi lehte ve aleyhte iddiaları olabilir. Kullanıcılar iddialara etki puanı verir; kardeş iddialar ortalama puana göre sıralanır. Birbirini tekrar eden iddialar birbirine bağlanır. Sahip, yönetici, editör, yazar ve öneren rolleri vardır; "yazar" yetkisi olmayanların iddiaları bekçi onayından geçer. İddialar yaklaşık 500 karakterlik kısa metinlerdir. Etki puanı ölçeği kaynaklarda doğrulanamadı.

**Bizim sisteme etkisi:** Tartışmayı DESTEKLER ve SALDIRIR kenarlarıyla bağlı iddia düğümlerinden oluşan bir graf olarak saklayacağız; bu, "insanları ve tartışmayı grafta tut" gereksinimine uyuyor. YZ serbest metni bu ağaca yerleştirmeyi önerebilir. Tek moderatörlü bekçilikten kaçınacağız.

### 3.10 Polis / vTaiwan

**Ne yapar:** Polis katılımcılardan kısa ifadeler toplar. Diğer katılımcılar bu ifadelere "katılıyorum" (+1), "katılmıyorum" (−1) veya "geç" (0) oyu verir. Ortaya çıkan katılımcı × ifade matrisi PCA ile 2 boyuta indirgenir ve k-means ile görüş gruplarına ayrılır. Sistem, her grubun büyük ölçüde katıldığı "grup-farkındalıklı uzlaşı" (group-aware consensus, GAC) ifadelerini öne çıkarır [49]. Yanıt ipliği yoktur.

vTaiwan, Polis'i dört aşamalı bir süreçte kullanır: öneri, görüş, yansıtma, yasama [62]. Kayıtlı sonuçlar:

- 26 mevzuat düzenlemesi ve 200.000'den fazla katılımcı;
- başlatılan süreçlerin %80'inden fazlası hükümet eylemine dönüştü;
- bakanlıklar yorumlara 7 gün içinde yanıt vermek zorunda.

Sonuçlar bağlayıcı değildir.

**Güçlü yönler:** Ham çoğunluk yerine gruplar arası uzlaşıyı doğrudan ölçer. Gruplar demografiden değil oylardan çıkarılır.

**Zayıf yönler:** Bağlayıcı değildir. Erken aşamada kümeler kararsızdır. Teknolojiye yatkın katılımcıları çeker.

**Bizim sisteme etkisi:**

- Görüş kümelerini kendi oy matrisimizden hesaplayıp insan grafında saklayacağız.
- Her kararla birlikte GAC değerini raporlayacağız.
- Hakları etkileyen kararlarda asgari düzeyde kümeler arası destek arayacağız.
- vTaiwan'daki gibi, bilirkişiler ve yansıtma aşaması oylamadan önce yazılı görüş yayımlayacak.

Ayrıntılar Bölüm 4'te.

### 3.11 Wikipedia (MediaWiki)

**Ne yapar:** Tüm revizyon geçmişini sonsuza dek saklar. Gizleme iki kademelidir [40][41]:

1. RevisionDelete: yöneticiler, kapalı bir ölçüt listesine göre gizler;
2. Suppression/Oversight: küçük ve denetlenen bir grup, yöneticilerden bile gizler.

Tüm işlemler kayıt altındadır ve geri alınabilir. Kararlar oy sayısıyla değil argümanların kalitesiyle verilir. Yerel bir uzlaşı, daha geniş topluluk politikasını geçersiz kılamaz (CONLEVEL ilkesi) [42][43].

**Mekanizmalar:**

- **RevisionDelete ölçütleri:**
  - RD1: açık telif hakkı ihlali;
  - RD2: ağır hakaret veya aşağılama içeren materyal (sıradan nezaketsizlik bu kapsamda değildir);
  - RD3: yalnızca yıkıcı amaçlı içerik (taciz, tehdit, zararlı yazılım);
  - RD4: gözetim incelemesini bekleyen bilgi;
  - RD5: silme politikası kapsamındaki geçerli silmeler;
  - RD6: tartışmasız bakım işleri.
- **Gizlenebilenler:** revizyon metni, düzenleme özeti, kullanıcı adı veya IP, kayıt ayrıntısı. Gizlenen revizyon geçmişte üstü çizili bir yer tutucu olarak kalır.
- **Suppression'ın 5 ölçütü:** kamuya açık olmayan kişisel bilgi, olası iftira, telif hakkı (hukuk danışmanı tavsiyesiyle), açıkça saldırgan kullanıcı adları, şiddet veya kendine zarar tehdidi.
- **Gözetmenler:** Yaklaşık 43 kişidir. Tahkim Komitesi tarafından en az %70 destekle atanırlar ve denetlenirler.

**Bizim sisteme etkisi:**

- Silme, gizleme (karartma) olarak uygulanacak; fiziksel silme hiç olmayacak.
- İplikte, neyin, neden ve hangi kararla gizlendiğini gösteren bir yer tutucu kalacak.
- Silme talebi, ontolojide sınıf olarak tanımlanmış sayılı bir ölçüte dayanmak zorunda olacak. "Katılmıyorum" veya sıradan nezaketsizlik gerekçe sayılmayacak. Çoğunluğun azınlık konuşmasını silmesine karşı ana savunma budur.
- CONLEVEL ilkesi: Konu düzeyindeki bir oy, ontolojideki yönetmeliği veya hakları geçersiz kılamayacak.
- İki görünürlük kademesi olacak:
  - kamudan gizli ama denetçi ve bilirkişiye açık;
  - kişisel veriler için mühürlü: yalnızca gözetim rolü görebilecek, her erişim kaydedilecek.

### 3.12 Stack Exchange ve OSQA klonu

Stack Exchange'de ayrıcalıklar itibar puanıyla açılır. Moderasyon topluluk tarafından yapılır: işaretleme, kapatma ve yeniden açma oyları, inceleme kuyrukları. Moderatörler seçimle belirlenir [44].

- **OSQA varsayılan itibar eşikleri** [45]: artı oy 15, işaretleme 15, yorum 50, eksi oy 100, başkasının gönderisini düzenleme 2000, yorum silme 2000, başkasının sorusunu kapatma 3000.
- **Stack Internal'da itibar** [46]: artı oy +10, kabul edilen cevap +15, eksi oy −2; oylardan günde en fazla 200 itibar kazanılır.
- **Yeni kullanıcı deneyimi:** Bir çalışmada yeni kullanıcıların %49'u, kapatılan soru veya açıklamasız eksi oy gibi engellerle karşılaştı.

**Bizim sisteme etkisi:** Konulardaki oy gücü hiçbir zaman itibara bağlanmayacak; ilke "bir kişi, bir oy"dur. İtibar yalnızca usul ayrıcalıklarında, spam'i sınırlamak için kullanılacak (örneğin kimin günde kaç silme talebi açabileceği).

### 3.13 Birleşik Krallık Parlamentosu e-dilekçeleri

**Yaşam döngüsü** [47]:

1. Dilekçeyi bir İngiliz vatandaşı veya Birleşik Krallık'ta yaşayan biri oluşturur.
2. 5 destekçi toplanır.
3. Yayımlanmış standartlara göre moderasyon yapılır.
4. Dilekçe 6 ay açık kalır.
5. 10.000 imzada hükümet yanıt verir.
6. 100.000 imzada Parlamentoda tartışılması değerlendirilir.

**Ret standartları** [48]: açık bir dilekçenin tekrarı; net bir eylem talebi olmaması; hükümetin veya parlamentonun sorumluluğunda olmayan konu; iftira veya yanlış içerik; süren yargılama; gizli bilgi; mahremiyet ihlali; tanımlanabilir kişilere suçlama; parti siyaseti; şaka veya anlamsız içerik; reklam veya spam; saldırgan dil; korunan özellikleri hedef alan aşırı görüşler.

Reddedilen dilekçeler, yayımlanmaları zarar vermeyecekse gerekçeleriyle birlikte görünür kalır.

**Bizim sisteme etkisi:**

- Ret ve silme ölçütlerinin makine tarafından okunabilir bir listesini yayımlayacağız; bu liste bizim ontolojimizdir.
- Ontoloji veya bilirkişi bir konuyu reddettiğinde de konu gerekçesiyle birlikte yayımlanacak.
- Kabul evresinden önce 3–5 doğrulanmış eş-sponsor isteyeceğiz; bu ucuz bir spam süzgecidir.

### 3.14 MIT Deliberatorium (IBIS argüman haritası)

Mark Klein'ın sistemi, büyük müzakereleri bir IBIS haritası olarak yapılandırır [89]. Haritada üç tür düğüm vardır: meseleler (sorular), pozisyonlar (olası cevaplar) ve lehte/aleyhte argümanlar. Her gönderi tekilleştirilir ve ağaçta yalnızca bir kez yer alır. Böylece azınlığın en iyi argümanı, çoğunluğun argümanı kadar görünür olur: ikisi de hacimle değil birer düğümle temsil edilir.

**Bizim sisteme etkisi:**

- Konu = mesele; öneri, alt konu ve düzenleme teklifi = pozisyon; tartışma girdisi = lehte veya aleyhte argüman.
- Duruşu (lehte/aleyhte) yazar seçecek, YZ yalnızca önerecek. LLM'ler uzun ve duygusal yorumlarda argüman çıkarmada zayıf kalıyor [265].
- Bir tarafın desteği gönderi sayısıyla değil, tekil argüman sayısıyla gösterilecek.

---

## 4. Köprü Kuran Uzlaşı (Bridging) ve Görüş Kümeleme

Bu alan, "çoğunluk azınlığı ezmesin" sorusuna verdiğimiz teknik cevabın çekirdeğidir. Ortak fikir şu: Bir kararın değeri yalnızca kaç kişinin desteklediğiyle değil, normalde birbirine katılmayan insanların da onu destekleyip desteklemediğiyle ölçülür [72][73].

### 4.1 Polis (Computational Democracy Project): boru hattının ayrıntıları

Aşağıdaki ayrıntılar Small ve arkadaşlarının makalesinden (2021) [49][50] ve Polis'in Clojure kaynak kodundan [54][55][56] doğrulandı:

- **Oy matrisi:** Satırlar katılımcı, sütunlar yorumdur. Oylar +1, −1 veya 0'dır; görülmemiş yorumlar eksik değer sayılır ve sütun ortalamasıyla doldurulur.
- **Analize dahil etme:** min(7, yorum sayısı) kadar oy veren katılımcı analize girer. 15 kişiden azsa, en çok oy verenler eklenerek 15'e tamamlanır. Bir kez dahil edilen katılımcı dahil kalır.
- **PCA:** Kuvvet yinelemesiyle (power iteration) hesaplanır: 2 bileşen, 100 yineleme, her seferinde önceki özvektörlerden başlanarak. Az oy veren katılımcının konumu √(C/n_p) ile çarpılır (C toplam yorum sayısı, n_p katılımcının oy verdiği yorum sayısı); bu, az oy verenlerin merkeze çekilmesini düzeltir.
- **İki aşamalı k-means:** Önce performans için 100 temel küme oluşturulur. Sonra k ∈ 2..min(5, 2+⌊n/12⌋) arasından siluet puanına göre seçim yapılır. Yeni bir k değeri ancak 4 kez üst üste kazanırsa benimsenir.
- **Grup olasılıkları ve temsil gücü:**
  - Laplace düzeltmeli katılma olasılığı: P_v(g,c) = (1+N_v)/(2+N).
  - Temsil gücü: R_v(g,c) = P_v(g,c) / P_v(¬g,c).
  - İki oran z-testiyle anlamlılık aranır: z > 1,2816 (%90).
  - Her grup için en fazla 5 temsil edici ifade seçilir.
- **Grup-farkındalıklı uzlaşı:** GAC(c) = Π_g P_agree(g,c). Yazarlar bunun çoğunluk tiranlığına karşı koruduğunu belirtir.
- **Yorum yönlendirme önceliği:** Az oy almış ve katılımcıları haritaya yerleştirmede yararlı yorumlar öne alınır (formül Bölüm 12.6'da).

**Zayıf yönler:**

- Gruplar yalnızca oy davranışından tanımlanır. Ayrı bir görüş kümesi oluşturmayan demografik bir azınlık GAC ile korunmaz.
- Ham GAC değeri, grup sayısı K arttıkça mekanik olarak düşer.
- k-means yeniden başlatmalarda deterministik değildir. Önceki çalışmadan kalan başlangıç durumu kaybolduğunda, Python'a aktarılmış sürümle Clojure sürümünün kümeleri arasında yalnızca %21 Jaccard uyumu görüldü [57][58].
- İşaret tuzağı: `repness.clj` dosyası "katılıyorum"u içeride −1 olarak sayar; makaledeki +1'in tersidir.

**Bizim sisteme etkisi:**

- Görüş kümelerini Polis boru hattıyla hesaplayacağız.
- Soğuk başlangıç sorunu için, yeni üyeler 7–10 tohum ifadeye oy verecek.
- GAC'yi K'dan bağımsız olsun diye geometrik ortalamayla normalize edeceğiz: GAC^(1/K).
- Her konu sayfasında, grup başına temsil edici ifadeleri gösteren bir "azınlık raporu" paneli olacak.
- Rastgele sayı üretecini tohumlayacağız ve önceki çalışmanın başlangıç durumunu saklayacağız.

### 4.2 X Community Notes (eski adıyla Birdwatch)

Kitle kaynaklı doğruluk notlarıdır. Bir not ancak normalde birbirine katılmayan değerlendiricilerin ikisi de onu "yararlı" bulursa gösterilir [63][66]. Kullanılan yöntem matris çarpanlarına ayırmadır (MF): uyumun görüşle açıklanan kısmı (faktörler), görüşten bağımsız kısmından (notun kesişim terimi, intercept) ayrılır.

- **Model:** r̂_un = μ + i_u + i_n + f_u·f_n. Üretimde faktörler 1 boyutludur. Puanlar: Yararlı = 1, Biraz = 0,5, Yararsız = 0.
- **Kayıp fonksiyonu:** Σ(r − r̂)² + λ_i(i_u² + i_n² + μ²) + λ_f(‖f_u‖² + ‖f_n‖²), λ_i = 0,15, λ_f = 0,03. Kesişim terimleri faktörlerden 5 kat daha fazla cezalandırılır; böylece model desteği önce görüşle açıklamaya çalışır.
- **Durum kuralları** [63]:
  - ≥5 puan gelene kadar not "daha fazla puan gerekli" durumundadır.
  - Yararlı: i_n ≥ 0,40, |f_n| < 0,50 ve iki faktör işaretinden de asgari net destek.
  - Yararsız: i_n ≤ −0,05 − 0,8·|f_n| ve her işaretten ≥3 puan.
- **İki geçişli süzgeç:** Değerlendirici puanı (s − 10h)/t ≥ 0,66 ve en az 10 puan vermiş olma şartı aranır [64]; ardından model süzülmüş veriyle yeniden eğitilir.
- **İşletim:** Bir notun durumu 2 hafta sonra kilitlenir; model her saat yeniden eğitilir [65].
- **Kanıt:** Notu görenlerin içeriği beğenme veya yeniden paylaşma olasılığı %25–34 düştü [66].

**Zayıf yönler:**

- Yoğun veri ister: Birdwatch'ta not başına medyan puan sayısı 4'tü.
- Kutuplaşmış konularda hiçbir not öne çıkmayabilir.
- 2026 çalışmalarına göre manipüle edilebilir. Koordineli hesaplar önce faktör uzayında farklı konumlara yerleşip sonra hedef notu birlikte yükseltebiliyor ("sentetik uzlaşı"). Medyanın altındaki notların %10,7'si, 10'dan az koordineli puanla eşiğin üstüne itilebildi; not başına maliyet yaklaşık 30 dolar [67][68].
- Kararsızdır: Gösterilen notların %30,2'si sonradan durumunu kaybetti [70].

QS-MF adlı bir varyant, her değerlendiriciye bir kalite kapısı ekleyerek %26–40 daha az puanla çalışıyor [69]. Yöntemin anlaşılır bir özeti için [71].

**Bizim sisteme etkisi:**

- MF'yi ikinci bir köprü sinyali olarak, yalnızca veri yeterince yoğunsa (öneri başına ≥5, kullanıcı başına ≥10 oy) kullanacağız.
- Asimetrik eşikleri ve "her taraftan asgari kanıt" kuralını kopyalayacağız.
- Oylama penceresi kapanınca sonucu kilitleyip deftere yazacağız.
- Kimlik doğrulama, sentetik uzlaşı saldırısının ana maliyet kalemi olan hesap maliyetini zaten yükseltiyor.
- Ham oy verisini oylama penceresi kapanana kadar yayımlamayacağız.

### 4.3 Bridging Systems (Ovadya ve Thorburn, 2023)

Bu çerçeve makalesi köprü sistemlerini, ayrışmış gruplar arasında karşılıklı anlayışı ve güveni artıran sistemler olarak tanımlar [72][73]. Üç motif sayar:

1. **Çeşitli onay:** Normalde anlaşamayan kişilerin aynı içeriği onaylaması.
2. **Yanıtların iki tepeli dağılımı:** U şeklinde bir dağılım, içeriğin bölücü olduğunu gösterir.
3. **Farklı görüşlere maruz bırakma:** Kanıtı zayıftır ve duygusal kutuplaşmayı artırabilir.

**Kritik uyarı:** Köprü, bir azınlığa karşı paylaşılan bir önyargı etrafında da kurulabilir. Makalenin örneği, sol ve sağın dezavantajlı bir gruba karşı ortak önyargısıdır. Yani köprü tek başına azınlık koruması değildir; ontolojideki hak temelli katı kısıtlarla desteklenmelidir.

Blair ve arkadaşları [74], GAC sıralamalarının kümeleme değişince değiştiğini gösterdi (Spearman 0,926). Önerdikleri "ikili anlaşmazlık" (pairwise disagreement) köprü puanı kümelemeye ihtiyaç duymaz.

### 4.4 Talk to the City, Jigsaw Sensemaking, Habermas Machine, Collective Constitutional AI, Meta Community Forums

- **Talk to the City (AI Objectives Institute)** [82][83][84][85]: Serbest metni konu → alt konu → iddia hiyerarşisine çeviren açık kaynaklı bir LLM boru hattı. Her iddia kaynak yoruma bağlanır.
  - Kümeleme: UMAP (2 boyut, random_state = 42), HDBSCAN (min_cluster_size = 2) ve SpectralClustering (varsayılan 8 konu).
  - Yazarlar nüans kaybı yaşandığını bildiriyor: Bir argüman, her biri doğru ama birlikte yanıltıcı parçalara bölündü.
  - Halef deposu tttc-light-js TypeScript ile yazılmış: Next.js istemci, Express sunucu ve ayrı bir işçi süreci.
- **Jigsaw Sensemaking** [86]: Konuları öğrenir, yorumları çok etiketli sınıflandırır ve özyinelemeli özet çıkarır. "Ortak zemin" ile "anlaşmazlık" alanlarını ayırır. Artık aktif olarak bakımı yapılmıyor.
- **Habermas Machine (DeepMind, Science 2024)** [75][76][77][78][79]:
  - Üretici bir model 16 aday grup ifadesi yazar. Kişiselleştirilmiş bir ödül modeli, her üyenin bu adayları nasıl sıralayacağını tahmin eder. Kazananı Schulze yöntemi seçer. Eleştiri turundan sonra ifade revize edilir.
  - 5.000'den fazla İngiliz katılımcı, YZ ifadelerini insan arabulucularınkine %56 oranında tercih etti.
  - İlk ifadeler azınlığa tam büyüklüğü oranında ağırlık verdi (0,29); revize ifadeler azınlığa fazla ağırlık verdi (0,36).
  - Yine de görüşler genel olarak çoğunluğa kaydı: Çoğunluk turların %29–32'sinde, azınlık %20–26'sında büyüdü.
  - Yazarlar doğruluk denetimi ve moderasyon eksikliğini kabul ediyor.
- **Collective Constitutional AI (Anthropic ve CIP)** [80][81]:
  - Yaklaşık 1.000 ABD'li yetişkin Polis üzerinden 1.127 ifade ve 38.252 oy üretti; 2 görüş grubu bulundu.
  - İfadeler GAC'ye göre sıralandı ve 95 fikre ulaşılana kadar listeden alındı. Bu da fiilî GAC kesim değerini 0,723 yaptı (ortalama 0,64, medyan 0,70).
  - Bir kalabalığın görüşlerini bir "anayasaya" dönüştürmek, bizim yönetmelik kullanımımıza çok yakın bir örnektir.
- **Meta Community Forums** [87][88]: Temsilî bir örneklem dengeli bilgi notlarını okur, küçük gruplarda müzakere eder, bir uzman paneline soru sorar ve müzakere öncesi ve sonrası ankete katılır. Bazı sorularda görüşler %20,5'e kadar değişti. Sonuçlar tavsiye niteliğindedir.

**Bizim sisteme etkisi:**

- Özet modülü "tartışma haritaları" üretecek; her cümle yorum kimliğine bağlanacak. Kaynağı olmayan cümle otomatik olarak reddedilecek.
- Habermas desenini yalnızca "tartışmalı" durumda (çoğunluk var ama köprü yok) uzlaşma metni taslağı yazmak için kullanacağız. Adayları insanlar sıralayacak, Schulze seçecek, sonuç yine bağlayıcı oylamaya gidecek.
- Yönetmelik değişiklikleri yüksek köprü puanı isteyecek. CCAI'de K=2 için kesim değeri yaklaşık 0,72 idi (geometrik ortalamayla yaklaşık 0,85).
- Bilirkişi, Meta'daki gibi oylamadan önce imzalı ve kaynaklı bir görüş yazacak; ek oy gücü almayacak.

---

## 5. Dağıtık Defter, E-Oylama ve DAO Yönetişimi

### 5.1 Uzlaşı protokolleri

- **PBFT (Castro ve Liskov, 1999)** [144][145]:
  - f adet Bizans (kötü niyetli veya hatalı) düğüme 3f+1 kopya ile dayanır; bu en iyi olası sınırdır.
  - Üç evre vardır: ön hazırlık (pre-prepare), hazırlık (prepare) ve işleme (commit). `prepared` = ön hazırlık + 2f eşleşen hazırlık mesajı; `committed` = prepared + 2f+1 işleme mesajı.
  - Görünüm değişiminde lider = görünüm numarası mod |R| olur.
  - Periyodik CHECKPOINT mesajlarında 2f+1 eşleşen imza toplanınca kararlı bir kontrol noktası oluşur ve eski günlük kayıtları budanır.
  - Zayıf yönleri: Görünüm değişimi alt protokolü doğru uygulanması en zor parçadır. MAC tabanlı kimlik doğrulama, üçüncü bir tarafa kanıtlanabilecek bir işlem sertifikası vermez.
- **Tendermint / CometBFT** [146][147][148]:
  - Her blok yüksekliği için öner → ön oy (prevote) → ön işleme (precommit) turları yapılır. n > 3f gerekir ve kısmi eşzamanlılık varsayılır.
  - Önericiler deterministik olarak sırayla değişir. Kilitleme kuralları (lockedValue/lockedRound, validValue/validRound) güvenliği sağlar. Algoritma 1 yaklaşık 60 satırlık sözde koddur.
  - Varsayılan zaman aşımları: öneri 3 sn (her turda +0,5 sn), ön oy ve ön işleme 1 sn (her turda +0,5 sn), işleme 1 sn.
  - Çatal hesap verebilirliği: İki çelişen işlem varsa doğrulayıcıların en az 1/3'ü çift imza atmıştır ve bu kanıtlanabilir.
  - Blok h'nin 2/3'ten fazla ön işleme imzası, blok h+1'de (LastCommit) saklanır.
- **Yetki Kanıtı (Clique EIP-225, Aura)** [149][150]: İzinli imzalayıcılar blokları sırayla imzalar. "Klonlama saldırısı"nda tek bir Bizans imzalayıcı tutarlılığı bozabilir: saldırı Aura'da her zaman, Clique'te çoğu durumda başarılı olur. BFT kesinliği yoktur.
- **Raft** [151]: Anlaşılır bir protokoldür ama yalnızca çökme hatalarına dayanır. Tek bir kötü niyetli düğüm kayıtları değiştirebilir.
- **HotStuff** [152]: Doğrusal iletişim ve iyimser duyarlılık sağlar; LibraBFT'nin temelidir. 4 düğüm için gereksiz karmaşıktır; raporda "sistem nasıl ölçeklenir?" sorusunun cevabı olarak anılmalıdır.
- **Hyperledger Fabric** [153]: Önce çalıştırır, sonra sıralar, sonra doğrular. Onay politikaları vardır ("3 kurumdan 2'si" gibi). Saniyede 3.500'den fazla işlem yapar. Öğrenci projesi için ağırdır; ancak onay politikası fikri uygulama düzeyinde alınabilir (örneğin bilirkişi veya kayıt yetkilisi imzası gerektiren işlemler).

**Seçimimiz:** Tendermint'in Algoritma 1'ini doğrudan TypeScript'e aktaracağız.

- 4 doğrulayıcı: f = 1, yeter sayı 2f+1 = 3, tur atlama f+1 = 2.
- Ed25519 imzalı mesajlar [155].
- Düğümler arasında WebSocket ile tam bağlantı.

Dört doğrulayıcıyı farklı "operatörler" çalıştırmalıdır: örneğin öğretim üyesi, bölüm, öğrenci konseyi ve kurayla seçilmiş bir öğrenci. Hepsi tek bir dizüstü bilgisayarda çalışıyorsa bu raporda dürüstçe belirtilmelidir; BFT yalnızca operatörler birbirinden bağımsızsa anlam taşır.

### 5.2 E-oylama güvenliği

- **Helios (Adida, 2008)** [156]: Oylar tarayıcıda şifrelenir ve herkese açık bir ilan panosunda yayımlanır. Sayımı herkes bir doğrulama programıyla kontrol edebilir. Benaloh meydan okuması sayesinde seçmen, oyunu atmadan önce "denetle" veya "at" seçeneklerinden birini seçebilir. Sistem baskıya direnç iddia etmez; açıkça çevrimiçi topluluklar, kulüpler ve öğrenci yönetimleri için tasarlanmıştır. Bu bizim tehdit modelimizle örtüşüyor.
- **Estonya internet oylaması** [157]:
  - Çift zarf kullanılır: İç zarf seçim anahtarıyla şifrelenmiş oydur, dış zarf dijital imzadır.
  - Seçmen yeniden oy verebilir ve yalnızca son oy sayılır; bu, baskıya karşı bir önlemdir.
  - Görevler ayrılmıştır: Toplayıcı, İşleyici, Sayıcı ve Denetçi.
  - Sayımdan önce imzalar oylardan ayrılır.
- **Voatz analizi (USENIX 2020)** [158]: Uygulama hiçbir blokzincir kaydını doğrulamıyordu ve oylar cihazda imzalanmıyordu. Sunucu oyları görebiliyor ve değiştirebiliyordu. Makalenin sonucu: oy pusulası blokzincire ulaşmadan bozuluyor.
- **Park, Specter, Narula, Rivest (2021)** [159][160]: Blokzincir oylaması, internet oylamasının tüm risklerini devralır ve yenilerini ekler (anahtar yönetimi, şifreli oyların kalıcılığı). Yazarlar kamu seçimlerinde kâğıt oy ve denetim öneriyor.

**Bizim sisteme etkisi:**

- Her oy, kullanıcının cihazında kendi Ed25519 anahtarıyla imzalanacak; sunucu yalnızca aktaracak.
- İstemci, Merkle dahil olma kanıtını ve 4 doğrulayıcıdan 3'ünün imzasını kendisi doğrulayacak ("Oyum kayıtlı mı?" ekranı).
- Oy yükleri sabit bir boyuta doldurulacak.
- Şifreli oy veya şifreli kişisel veri deftere kalıcı olarak yazılmayacak.
- Telefonunu kaybeden kullanıcı için, kayıt yetkilisinin imzaladığı bir anahtar değiştirme işlemi olacak.
- Raporda tehdit modeli açıkça yazılacak: Bu sistem düşük riskli topluluk yönetişimi içindir, siyasi seçimler için değildir.

### 5.3 DAO yönetişim mekanizmaları

| Sistem | Ana mekanizma | Ne alıyoruz | Ne almıyoruz |
|---|---|---|---|
| Compound Governor Bravo + Timelock [134][135][136] | Durumlar: Pending → Active → Canceled/Defeated/Succeeded → Queued → Expired/Executed. Oy ağırlığı, önerinin başlangıç bloğundaki anlık görüntüden alınır. Zaman kilidi 2–30 gün, ek tolerans 14 gün | Durum makinesi, uygunluk anlık görüntüsü, kişi başına tek canlı öneri, imzalı oyun başkası tarafından iletilmesi | Jeton ağırlığı |
| OpenZeppelin Governor [137] | Geç yeter sayı uzatması (`GovernorPreventLateQuorum`), yeter sayının arzın bir oranı olarak tanımlanması | Son L saatte yeter sayıya ulaşılırsa veya önde olan taraf değişirse süreyi L kadar uzatma | — |
| Snapshot + Shutter [138][139] | Zincir dışı imzalı oylar, IPFS'te makbuzlar. Dağıtık anahtar üretimiyle eşik şifreleme; sonuç kapanışa kadar gizli | Oy işlemimiz, BFT ile sıralanan Snapshot tarzı imzalı bir mesajdır; çalışan sayım gizlenir | Sonucun bağlayıcı olmaması |
| Polkadot OpenGov [125][126] | Her öneri "parçası" (track) için ayrı parametreler. Onay ve destek eğrileri. Onay penceresi boyunca sürekli geçer durumda kalma şartı (düşerse saat sıfırlanır). Kilitlemeye dayalı ağırlık (conviction) çarpanları 0,1x–6x | Ontolojiden gelen parçalar, onay penceresi, onay ile katılımın ayrı ölçülmesi | Jeton ve kilitleme ağırlığı |
| Polkadot Gov1 [122][123][124] | Uyarlanabilir yeter sayı yanlılığı (düşük katılımda daha büyük çoğunluk ister). Konsey önerisi yalnızca bir kez veto edilebilir | Tek seferlik veto fikri; isteğe bağlı, tavanlı katılım yanlılığı | — |
| Tezos [140] | Beş dönemli değişiklik süreci: öneri, keşif oyu, soğuma, terfi oyu, benimseme. %80 nitelikli çoğunluk. Hareketli ortalamayla (EMA) uyarlanan yeter sayı (0,2–0,7) | Yönetmelik değişikliğinde iki aşamalı oylama; EMA ile yeter sayı | Yaklaşık 2,5 aylık süre |
| Aragon TokenVoting [141] | Bölme işlemi içermeyen tam sayı eşitsizlikleri; sonuç kesinleşince erken bitirme; oy değiştirme modu | Sayım fonksiyonunun formülleri | Jeton ağırlığı |
| DAOstack Holographic Consensus [127] | Normalde mutlak çoğunluk; tahmin piyasasıyla öne çıkarılan ("boost") önerilerde göreli çoğunluk. Sessiz bitiş: son anda sonuç değişirse süre uzar | Sessiz bitiş; hızlı yola alınabilecek öneri sayısını sınırlayan üstel eşik | Göreli çoğunlukla hızlı yol; kaybeden tarafta oy verenlerin itibar kaybıyla cezalandırılması |
| Optimism (iki meclisli yapı) [128][129][130][131] | Jeton Meclisi ve "bir kişi, bir oy" ilkesiyle çalışan Vatandaşlar Meclisi; meclislerin birbirini veto edebilmesi; kategoriye göre %51 veya %76 eşik; itiraz edilmezse geçen iyimser onay | Askıya alıcı veto yetkisi olan ikinci bir meclis (bilirkişi konseyi veya kura jürisi) | Sayılar sezondan sezona değişiyor; veto eşiği yalnızca ikincil kaynaklarda görüldü |
| MolochDAO [132] | Oylamadan sonra bir tolerans süresi; muhalifler payını alıp çıkabilir ("ragequit") | Yürürlük gecikmesi; çıkış hakkı veya alt topluluk kurallarından muaf olma hakkı | Varlığa dayalı çıkış |
| Lido Dual Governance [133] | İkinci bir paydaş grubunun itiraz oranıyla orantılı gecikme (5–45 gün); itiraz %10'u bulunca yönetişim donar; 3 alt komiteli bir eşitlik bozucu | Kademeli itiraz: gecikme → bilirkişi raporu → nitelikli çoğunlukla yeniden oylama; kilitlenmeyi çözen bir eşitlik bozucu | Jeton kilitleme |
| MACI [142] | Anahtar değiştirmeyle rüşvete direnç; sayımın sıfır bilgi kanıtıyla (zk-SNARK) kanıtlanması | Raporda "gelecek çalışma" olarak anılacak | Ağır sıfır bilgi araçları |
| PLCR Voting [143] | Taahhüt-açıklama (commit-reveal) | Çalışan sayımı gizlemenin temel yöntemi | — |

### 5.4 Değişmezlik ve unutulma hakkı (EDPB, KVKK)

**EDPB'nin 02/2025 blokzincir rehberi** (v2.0, 7 Temmuz 2026) [279]:

- Teknik imkânsızlık, kurallara uymamayı haklı çıkaramaz.
- Şifreli kişisel veri hâlâ kişisel veridir. Zincir süresiz tutulursa şifreleme zamanla aşılır (para. 51).
- Zincirde yalnızca tuzlu veya anahtarlı bir özet ya da mükemmel gizleyen bir taahhüt saklanmalı; verinin kendisi ve tuz zincir dışında tutulmalıdır (para. 52–53).
- Tuzsuz özetler genellikle yeterli değildir.
- Silme hakkı tasarımın başından itibaren karşılanmalıdır (para. 102).
- Teknik bir silme çözümü yoksa zincire hiç kişisel veri yazılmamalıdır (Öneri 11).

**KVKK silme yönetmeliği** [273]:

- İşleme şartları ortadan kalkınca veri silinmeli, yok edilmeli veya anonimleştirilmelidir.
- Periyodik imha en fazla 6 ayda bir yapılmalıdır.
- İlgili kişinin talebine 30 günde cevap verilmelidir.
- Silme kayıtları en az 3 yıl saklanmalıdır.

**Bizim sisteme etkisi:**

- Deftere asla yazılmayacaklar: ad, adres, doğum tarihi, TC kimlik numarası, takma adın hangi kişiye ait olduğu bilgisi ve şifreli kişisel veri.
- Defter yalnızca takma adlı Ed25519 açık anahtarlarını, tuzlu taahhütleri ve içerik özetlerini tutacak.
- Kullanıcının kendi kişisel verisinin silinmesi KVKK'dan doğan yasal bir yükümlülüktür; çoğunluk oylamasına konulamaz. Bu silme anahtar imhasıyla (crypto-shredding) yapılacak.
- Oylamaya giden tek şey, tartışma içeriğinin karartılmasıdır (gereksinim 8).

---

## 6. Yönetmeliğin Ontoloji Olarak Modellenmesi

### 6.1 Hukuki ontolojiler ve standartlar

- **LKIF Core** [164][165]: Yaklaşık 15 modülden oluşan bir OWL-DL hukuk ontolojisidir. Bir norm, bir durumun "nitelendirmesi" olarak modellenir: Yükümlü veya izinli durumu "onaylar", yasak durumu "onaylamaz". Yazarlar iki sorun bildiriyor: Eşdeğer sınıf ve ters özellik aksiyomları DL akıl yürütücülerin performansını ciddi biçimde düşürüyor; OWL de aritmetik yapamıyor, yani yeter sayı ve eşik hesaplanamıyor.
  - **Etkisi:** Fikri alacağız, ontolojinin tamamını değil. fy:Yasak, fy:Yukumluluk ve fy:Izin sınıflarını ayrı bir hizalama dosyasında LKIF'e eşleyeceğiz. Sayısal mantığı OWL'ün dışında tutacağız.
- **OASIS LegalRuleML** [166][167]: Kurucu, buyurucu, olgusal ve yaptırım ifadelerini ayırır. Deontik operatörleri vardır. Bir kural kesin, bozulabilir (defeasible) veya bozucu (defeater) olabilir. Hangi kuralın hangisine üstün geldiği açık bir `Override` ilişkisiyle belirtilir. Aynı metnin farklı yorumları alternatif olarak tutulabilir ve kuralların zamansal durumu (yürürlükte, uygulanabilir) modellenir.
  - **Etkisi:** Bu kavramları RDF özellikleri olarak yansıtacağız: fy:overrides, koruma derecesi ve ELI tarihleri. "İzomorfizm" ilkesini uygulayacağız: Her biçimsel kural bir madde veya fıkra IRI'sidir ve her denetim mesajı "Madde 3 fıkra 2" gibi atıf yapar. Bilirkişi yorumları alternatif olarak saklanacak.
- **Robaldo ve Adebayo: SHACL ile uyum denetimi; DAPRECO** [168][169][170]: GDPR normları, düzenleyici kısım için SHACL şekilleri, kurucu kısım için SHACL-AF kuralları olarak kodlanmış. Ancak JavaScript SHACL motorları SHACL-AF kurallarını desteklemiyor.
  - **Etkisi:** Aynı ayrımı benimseyeceğiz: kurucu ve sınıflandırma kuralları N3'te (N3.js), düzenleyici denetimler SHACL Core'da (shacl-engine).
- **W3C SHACL** [171][172]: Kapalı dünya varsayımıyla doğrulama yapar. Her sonuç bir odak düğümü, bir önem derecesi (Violation, Warning, Info) ve bir mesaj taşır. `sh:deactivated` ile yürürlükten kalkan bir madde, geçmişi silinmeden kapatılabilir. SHACL 1.2 Rules hâlâ taslak aşamasında ve JavaScript uygulaması yok. OWL'ün açık dünya varsayımı "bu uyumlu mu?" sorusu için uygun değildir.
- **Akoma Ntoso adlandırma kuralları** [174][175]: FRBR katmanlarını kullanır. Öğe kimlikleri deterministiktir (örneğin `art_3__para_2__point_b`) ve sürümler @ işaretiyle gösterilir.
- **ELI ontolojisi** [176][177]: LegalResource, LegalResourceSubdivision, is_part_of, amends/repeals ⊑ changes, first_date_entry_in_force, date_no_longer_in_force, version_date terimlerini sağlar.
- **ODRL 2.2** [178]: İzin, yasak ve görev kurallarından oluşur. Çatışma stratejisi açıkça belirtilir: izin üstün (perm), yasak üstün (prohibit) veya politika geçersiz (invalid).
- **Bozulabilir deontik mantık** [179][180][181][182]:
  - DDIC, norm çatışmalarını kalıtım hiyerarşisinde özgüllükle (özel norm üstündür, lex specialis) ve zamanla (sonraki norm üstündür, lex posterior) çözer.
  - Dinamik öncelikli bozulabilir mantık, bu ilkeleri üst norm ilkesiyle (lex superior) birleştirir.
  - Catala, hukuku öncelikli varsayılan mantıkla programlamaya yarayan bir dildir.
- **Pandit ve arkadaşları** [183]: Her SHACL şekli belirli bir GDPR maddesine bağlıdır. Kanıtlar bir PROV grafında tutulur, gereksinimler maddelere bağlı şekillerdir.
- **Normatif çok ajanlı sistemler** [184][185]: Üç tür norm ayrılır: kurucu ("X, C bağlamında Y sayılır"), düzenleyici ve usul normları.

### 6.2 Türk mevzuat yapısı ve meta-yönetişim

**Mevzuat Hazırlama Usul ve Esasları Hakkında Yönetmelik (2006)** [186]:

- Md. 13: Taslaklar madde, fıkra, bent ve alt bentten oluşur. Fıkralar (1), (2)… diye numaralanır; bentler a), b)… diye, tüm Türk harfleriyle sıralanır.
- Çerçeve maddeler "eklenmiştir", "değiştirilmiştir" ve "yürürlükten kaldırılmıştır" kalıplarını kullanır.
- Md. 4: Taslaklar üst normlara aykırı olamaz (lex superior).

**Anayasa** [100][101][102]:

- Md. 4: İlk üç madde "değiştirilemez ve değiştirilmesi teklif edilemez".
- Md. 13: Haklar özlerine dokunulmadan ve ölçülülük ilkesine uygun olarak sınırlanabilir.
- Md. 175: Değişiklik teklifi için üye tamsayısının 1/3'ü gerekir. 3/5 ile kabul edilen değişiklik halkoyuna gidebilir; 2/3 ile kabul edilen doğrudan yürürlüğe girebilir.

mevzuat.gov.tr, metinleri MevzuatNo, Tür ve Tertip ile tanımlar [187]. (2006 metni kullanıldı; madde numaraları güncel konsolide metinle doğrulanmalıdır.)

**Nomic (Peter Suber)** [121]: Kurallar değiştirilemez (100'lü numaralar) ve değiştirilebilir (200'lü numaralar) olarak ikiye ayrılır.

- Kural 109: Değiştirilemez bir kuralı değiştirilebilir hâle getirmek oybirliği ister.
- Kural 110: Çatışmada değiştirilemez kural üstün gelir.
- Kural 107: Kural değişiklikleri geriye yürümez.

**Bizim sisteme etkisi:**

- Bir maddenin korumasını kaldırmak ayrı ve daha zor bir öneri türü olacak.
- Koruma maddesi kendini de koruyacak. Böylece "önce korumayı kaldır, sonra maddeyi değiştir" şeklindeki iki adımlı atlatma kapanır.
- Açık oylamalar, açıldıkları andaki yönetmelik sürümüne göre sonuçlanacak.

### 6.3 JavaScript RDF yığını ve prototip

**Paket sürümleri** (registry.npmjs.org, 1 Ekim 2026) [188]–[197]:

- `n3` 2.7.12: Parser, Store, Writer ve yalnızca temel graf deseni kurallarını çalıştıran Reasoner; `maxDerivations` ile türetme bütçesi.
- `shacl-engine` 1.1.2: SHACL Core ve SPARQL eklentisi; SHACL-AF yok.
- `rdf-validate-shacl` 0.6.5: yalnızca SHACL Core.
- `eyereasoner` 21.1.24: WebAssembly ile EYE akıl yürütücüsü; ağır.
- `eyeling` 2.35.27: saf JavaScript N3 akıl yürütücüsü, yaklaşık 104 yerleşik fonksiyon; Aralık 2025'te çıktı, yani genç bir proje.
- `@comunica/query-sparql-rdfjs` 5.4.1.
- `rdflib` 2.4.1.
- `rdf-canonize` 5.0.0: RDFC-1.0 kanonikleştirme [198], SHA-256.

**Prototip** (bu araştırma sırasında çalıştırıldı): Ontoloji, yönetmelik, N3 kuralları, SHACL şekilleri ve örnek veri birlikte çalıştırıldı.

- Akıl yürütme sonrasında 156 dörtlü (quad) 218'e çıktı.
- Her öneri doğru uygulanabilir maddeleri ve doğru etkin parametreleri aldı. Örneğin `IlacPolitikasi`, `rdfs:subClassOf` ilişkisi sayesinde `Saglik` kategorisinin bilirkişi zorunluluğunu devraldı.
- SHACL raporu, bilerek yerleştirilen tüm ihlalleri doğru işaretledi:
  - değiştirilemez bir maddeyi değiştirmeye çalışan öneri;
  - eksik bilirkişi görüşleri;
  - yasak içerikli öneri;
  - kabul edilmiş bir silme oyu olmadan gizlenen tartışma parçası;
  - bir hak etkisi uyarısı.
- eyeling ile yürürlük süzgeci ve yeter sayı/eşik kuralı da doğru değerlendirildi [194].

**Bizim sisteme etkisi: üç katmanlı normatif model**

1. Kurucu ve sınıflandırma kuralları N3 ile yazılır (yalnızca temel graf deseni) ve N3.js ile çalıştırılır.
2. Düzenleyici denetimler SHACL Core şekilleri olarak yazılır ve shacl-engine ile çalıştırılır.
3. Usul sayıları (yeter sayı, eşik, süre) ve çatışma çözümü TypeScript'te hesaplanır.

Diğer kararlar:

- Kategoriler sınıf olarak modellenir (`rdfs:subClassOf`). Kurallar `fy:appliesTo` ile bir ata kategoriye bağlanır ve alt kategorilere kalıtılır.
- ELI ve PROV-O [199] (gerekirse SKOS [200]) yeniden kullanılır.
- Yönetmeliğin her sürümü ayrı bir adlandırılmış graf olarak tutulur. Sürüm RDFC-1.0 ile kanonikleştirilir ve SHA-256 özeti deftere yazılır.
- SHACL önem derecesi durum makinesini yönlendirir: Violation oylamayı engeller, Warning daha sıkı parametreler ekler, Info yalnızca ipucudur.
- İstemci aynı JavaScript doğrulamasını anlık ön kontrol için çalıştırır; ama geçerli olan yalnızca sunucunun sonucudur.

---

## 7. Bilirkişi Entegrasyonu

### 7.1 Türk bilirkişilik modeli (6754 sayılı Kanun, Bilirkişilik Yönetmeliği, HMK)

Devletin modeli, belgeli, listelenmiş, denetlenen ve performansı ölçülen bir uzman havuzudur [202][203][204]. Bilirkişilik bölge kurulları uzmanları temel ve alt uzmanlık alanlarına göre sicile ve kamuya açık listeye alır; onları denetler, uyarır, askıya alır veya listeden çıkarır. Bilirkişi raporu danışma niteliğindedir: Hâkim onu diğer delillerle birlikte serbestçe değerlendirir (HMK 282) [208].

**Temel ilkeler** (Kanun md. 3, Yönetmelik md. 5):

- Bilirkişi bağımsız, tarafsız ve nesnel olmalıdır.
- Uzmanlığı dışında açıklama yapamaz. Hukuki nitelendirme ve değerlendirme yapamaz.
- Genel bilgiyle veya hâkimin hukuki bilgisiyle çözülebilecek bir konuda bilirkişiye gidilmez.
- Görev başkasına devredilemez.
- Teknik soru ve kapsamı açıkça belirtilmeden görevlendirme yapılmaz.

**Tarafsızlık** (Yönetmelik md. 8–9):

- Bilirkişi görevi süresince taraflardan danışmanlık veya tahkim işi alamaz.
- Akrabası veya iş ilişkisi olduğu kişilerin dosyalarını kabul edemez.
- HMK 268/3: Kamu görevlisi, kendi kurumunu ilgilendiren davada bilirkişi olamaz.

**Ret ve çekinme** (HMK 272, Yönetmelik md. 11 ve 53) [209]: Hâkim için öngörülen yasaklılık ve ret sebepleri bilirkişiye de uygulanır. Sebebin öğrenilmesinden itibaren bir hafta içinde ileri sürülmelidir; bu süre hak düşürücüdür. Mahkeme dosya üzerinden karar verir.

**Listeye kabul** (Yönetmelik md. 38 ve 43):

- Sabıka şartı ve temel eğitim aranır.
- Alanında en az 5 yıl fiilen çalışmış olmak gerekir (Kanun md. 10).
- Mesleki belge istenir.
- Yetki belgesi 3 yıl geçerlidir; her yıl başvuru ilanı yapılır.

**Sicil** (Yönetmelik md. 45–46): Rapor sayısı, hükme esas alınan rapor sayısı, kusurdan doğan ek rapor sayısı ve denetim/performans verileri tutulur. Kamuya açık liste KVKK'ya uygun olarak süzülür.

**Görevlendirme ve süre** (Yönetmelik md. 50 ve 52; HMK 267 ve 273):

- Bilirkişi bölge listesinden seçilir.
- Heyet tek sayıda üyeden oluşur.
- Sorular, taraflar dinlendikten sonra belirlenir.
- Raporunu mazeretsiz geciktiren bilirkişiye, raporu teslim edene kadar yeni görev verilmez.

**Rapor** (Yönetmelik md. 55; HMK 281 ve 293):

- Rapor yöntemi, bilimsel dayanağı ve gerekçeli sonucu içerir.
- Heyette karşı oy ayrıca yazılır.
- Taraflar 2 hafta içinde itiraz edebilir; ek rapor veya yeni bilirkişi isteyebilir.
- Taraflar kendi uzman görüşlerini de sunabilir.

**Denetim** (Yönetmelik md. 59–63):

- Kurullar bilirkişinin davranışını ve usule uyumunu denetler. Raporların teknik içeriğini denetleyemez; teknik içeriğe yönelik şikâyetler incelenmeden reddedilir.
- Yazılı savunma süresi 1 hafta, soruşturma süresi 6 aydır.
- Yaptırımlar kademelidir: uyarı, en fazla 1 yıl listeden geçici çıkarma, kalıcı çıkarma.
- Kararlara 30 gün içinde itiraz edilebilir.

**Kurul oylaması** (Yönetmelik md. 26): Oylama açıktır. Başkan oyları en kıdemsiz üyeden başlayarak toplar ve kendi oyunu en son verir; bu, kıdemlilerin peşinden gitme eğilimini azaltır. Çekimser oy yoktur.

**2025 Performans Ölçme Formu** [205][206][207]: Karar kesinleştikten sonra 15 gün içinde UYAP üzerinden doldurulur. 8 ölçüt vardır, toplam 100 puan; her ölçüt "aykırılık var/yok" diye işaretlenir:

| # | Ölçüt | Puan |
|---|---|---|
| 1 | Rapor süresinde teslim edilmiş | 10 |
| 2 | Kısa, açık, şablona uygun dil | 15 |
| 3 | Hukuki nitelendirme yok | 15 |
| 4 | Uzmanlık dışı değerlendirme yok | 10 |
| 5 | Tüm sorular tam ve doğru cevaplanmış | 10 |
| 6 | Gerekçe belgeye dayalı ve denetlenebilir | 10 |
| 7 | Bilirkişinin kusurundan ek rapor gerekmemiş | 15 |
| 8 | Bilirkişinin kusurundan yeni rapor gerekmemiş | 15 |

(Puanların ölçütlerle eşleşmesi, PDF'nin ham metin sırasından yeniden kurulmuştur.)

**Güçlü yönler:**

- Teknik olgu (bilirkişi), hukuki ve normatif yargı (hâkim) ve karar birbirinden ayrılmıştır.
- Bilirkişi için usul güvenceleri vardır ve raporun teknik içeriği dokunulmazdır.
- Ölçülebilir performans ölçütleri ve karşı uzmanlık hakkı vardır.

**Zayıf yönler:** Hâkim bilirkişiyi listeden takdire göre seçer; açık bir rastgelelik şartı yoktur. Performansı da bilirkişiyi seçen makam puanlar.

**Bizim sisteme etkisi:**

- Teknik soruları bilirkişi cevaplayacak; yönetmeliğe uyumu ontoloji/SHACL motoru denetleyecek; değer kararını vatandaşların oyu verecek.
- Bilirkişi raporlarında hukuki veya normatif sonuç yasak olacak. Bunu bir YZ denetleyicisi ve performans ölçütleri 3 ile 4 denetleyecek.
- Bölge kurulu modelinde, kurayla seçilmiş bir Bilirkişi Kurulu kuracağız. Raporun teknik içeriği dokunulmaz olacak.
- Takdire dayalı seçim yerine doğrulanabilir, ağırlıklı bir kura kullanacağız.

### 7.2 Kleros (merkeziyetsiz mahkeme)

Kleros'ta jüri üyeleri, uzmanlaşmış alt mahkemelerde, yatırdıkları tutarla (stake) ağırlıklandırılmış bir kurayla seçilir [210][211][212][213][214]. Oylama isteğe bağlı olarak taahhüt-açıklama yöntemiyle gizli yapılır. Nihai karara aykırı oy verenler, yatırdıkları tutarın bir kısmını kaybeder.

- **Temyiz:** Her temyizde jüri 2n+1 kişiye büyür: 3 → 7 → 15 → 31… Belli bir eşikte dava üst mahkemeye sıçrar (Genel Mahkeme için 511).
- **Çekiliş veri yapısı:** K-li bir "sortition sum tree" ile ağırlıklı çekiliş O(K log n / log K) sürede yapılır.
- **Rastgele sayı kaynakları:** blok özeti (blok üreticisi tarafından manipüle edilebilir), Chainlink VRF, Randomizer.

**Alacaklarımız:**

- havuzdan kurayla seçim;
- tek sayılı jüri;
- temyizde 2n+1 büyüme ve her turda yeni jüri;
- gizli panel oyu;
- alt alanda uzman yoksa üst alana geçiş;
- çekilişin deftere kaydedilmesi.

**Almayacaklarımız:**

- Yatırılan tutara göre ağırlık. Doğrulanmış kimlikle buna gerek yoktur ve sonuç zenginlerin yönetimine (plütokrasi) varır.
- Çoğunlukla aynı oyu verene ödül. Bu, dürüst muhalefeti cezalandırır; tam da hocamızın çoğunluk tiranlığı kaygısıdır.
- Ücretle temyiz. Bu, zengin tarafı kayırır [215].

### 7.3 Delphi yöntemi, Metaculus, Decidim değerlendiricileri, epistokrasi tartışması

- **Delphi** [216][217][218]: Uzmanlar anonim olarak, birkaç turda ve kontrollü geri bildirimle görüş bildirir. 287 çalışmayı inceleyen taramaya göre:
  - En sık kullanılan uzlaşı tanımları %70, %75 ve %80 (medyan %75) uyum veya 9'luk ölçekte çeyrekler açıklığının (IQR) ≤ 1–2 olmasıdır.
  - Ortalama tur sayısı 2,8'dir; ilk turdaki panelin medyan büyüklüğü 31'dir.
  - Uzlaşma sağlanamayan maddeler zorlanmaz, olduğu gibi raporlanır.
- **Metaculus** [219][220]: Topluluk tahmini, en yeni tahminlerin yeniliğe göre ağırlıklandırılmış medyanıdır. Temel log puanı 100·(log₂ p_o + 1)'dir: %50'de 0, kusursuz tahminde 100. Bu puan dürüst olasılık vermeyi ödüllendirir, kalabalığa uymayı değil. (Birincil sayfa 403 döndürdü; formüller arama özetlerinden alındı.)
- **Decidim değerlendiricileri** [10][22]: Önerilere yapılandırılmış bir resmî cevap verirler: durum, açıklama, maliyet, uygulama süresi. Ancak değerlendiriciler atanır; rastgelelik ve çıkar çatışması denetimi yoktur. Resmî cevap da fiilen kararı belirler.
- **Epistokrasi tartışması** [221]: Brennan, bilgili olanlara daha çok söz hakkı verilmesini savunur (yetkinlik ilkesi). Estlund buna iki itiraz getirir: "uzman/patron yanılgısı" (uzman olmak yönetme yetkisi vermez) ve meşruiyetin tüm makul görüşlerce kabul edilebilir olması gerektiği. Boniolo ve arkadaşları, tekrar alınabilen ve hakları kısmayan bir "yumuşak epistokrasi" önerir.
  - **Etkisi:** Bilirkişi görüşünün oy ağırlığı sıfırdır. Bir "bilgili seçmen" adımı olacaksa tekrar alınabilir, oyu engellemeyen ve ağırlığını düşürmeyen bir rozet olmalıdır.
- **vTaiwan** [62]: Uzmanlar yansıtma aşamasında bilgi verir; ek oy almazlar.

### 7.4 İtibar, çıkar çatışması ve doğrulanabilir rastgelelik

- **EigenTrust** [222][223][224][225][226]: Kişiler arası yerel güven puanlarını normalize eder ve önceden güvenilen kişilere doğru sönümleyerek baskın özvektörü hesaplar. Bu, kötü niyetli grupların birbirini şişirmesini sınırlar.
  - **Etkisi:** Yalnızca vatandaşların bilirkişi raporlarına verdiği puanları ağırlıklandırmak ve organize puan saldırılarını tespit etmek için kullanılacak; oy ağırlığı için asla.
- **Stack Exchange itibarı** [46]: Günlük bir kazanç tavanı vardır.
  - **Etkisi:** Tek bir raporun bilirkişi itibarına etkisi dönem başına bir tavanla sınırlanacak.
- **Hakem atama araştırmaları** [227][228][229][230]:
  - OpenReview, kurum ve ortak yazarlık üzerinden çıkar çatışması arar; ICML 2026 3 yıllık bir pencere kullanır.
  - Ortak yazarlık mesafesi D = 1, 2, 3 diye derecelendirilir.
  - Jecmen ve arkadaşları her hakem-makale çiftinin seçilme olasılığına bir q tavanı koyar.
  - Grup kısıtları vardır (örneğin AAAI 2021'de hakemler en az 2 kıtadan olmalı).
  - UAI 2022'de hakemler birbirini görünce kararlar kıdemlilerin görüşüne yaklaştı.
  - Hakemlerin yaklaşık %7'si dürüst olmayan davranışla karşılaştığını bildirdi.
- **drand ve VRF** [161][162][163]: drand, League of Entropy'nin eşik-BLS tabanlı rastgelelik yayınıdır. quicknet ağı 3 saniyede bir, herkesin doğrulayabileceği bir değer yayımlar. Blok özetleri blok üreticisi tarafından seçilebilir (a16z). VRF (RFC 9381), kanıtlanabilir sözde rastgele çıktı üretir.

**Bizim sisteme etkisi:**

- Kesin çıkar çatışması kuralları uygulanacak: akrabalık, aynı hane, son 3 yılda aynı işveren, aynı önerinin sahibi olma, kendi kurumunu ilgilendiren konu. Bunlara insan grafındaki yumuşak mesafe, seçilme olasılığı tavanı ve çeşitlilik kısıtı eklenecek.
- Kura tohumu önceden taahhüt edilecek: Talep anında, henüz bilinmeyen gelecekteki bir drand turu ve gelecekteki bir blok yüksekliği deftere yazılacak. Tohum = SHA-256(drand ‖ blok özeti ‖ konu ‖ tur).
- Panel üyelerinin kimlikleri rapor teslim edilene kadar gizli kalacak; sonra itiraz penceresi açılacak.

Ayrıntılı algoritmalar Bölüm 12.9'da.

---

## 8. İnsanları Grafta Tutmak: Sosyal Graf, Sybil Direnci, Likit Demokrasi

### 8.1 Sybil (sahte hesap) direnci

- **SybilRank (Cao ve arkadaşları, NSDI 2012)** [231]: Güvenilir tohum hesaplardan başlayan kısa bir rastgele yürüyüş yapılır ve erken (O(log n) adım sonra) kesilir. Her hesabın puanı, yürüyüşün o hesapta bitme olasılığının hesabın derecesine bölünmesidir. Sahte bölgeye giden "saldırı kenarı" az olduğu için güven oraya sızmaya vakit bulamaz.
  - Tuenti'de (yaklaşık 11 milyon kullanıcı) en düşük puanlı aralıklardaki hesapların yaklaşık %90'ı sahteydi. Önceki şikâyet tabanlı yöntemde bu oran %5'ti.
  - Tohumlar farklı Louvain toplulukları arasına dağıtıldı.
- **BrightID ve AntiSybil** [232][233][234][235][236]:
  - Yüz yüze kurulan bağlantılar bir seviye taşır: Şüpheli, Yeni tanıştım, Zaten tanıyorum, Kurtarma.
  - Algoritmalar: SybilRank; GroupSybilRank (gruplar grafında çalışır, resmî algoritma oldu); WeightedSybilRank (kenar ağırlığı ortak komşu sayısıdır). Tohum derecesine sınırlar konur.
  - Bir saldırı simülasyon düzeneği vardır.
  - Sonradan insan değerlendiricilerin çalıştığı Aura katmanı eklendi. Bu, yalnızca graf algoritmalarının yetmediğinin işaretidir.
- **SybilGuard ve SybilLimit** [237]: Rastgele rotalar kullanır ve saldırı kenarı başına O(log n) sahte hesap kabul eder. Eşler arası (P2P) ağlar için tasarlanmıştır; merkezi bir sunucusu olan bizim sistemimiz için gereksiz karmaşıktır. Ancak "saldırı kenarı başına kabul edilen sahte hesap" sayısı iyi bir değerlendirme ölçütüdür.
- **Proof of Humanity** [238]:
  - Süreç: kefil bulma → 3,5 günlük itiraz penceresi → kayıt → 1 yıl sonra yenileme.
  - Bir kefil aynı anda yalnızca tek bir başvuruya kefil olabilir.
  - Başvuru "kopya hesap" çıkarsa kefiller de kayıttan çıkarılır.
- **Gitcoin/Human Passport** [239]: Bağımsız kimlik sinyallerinin ağırlıkları toplanır; toplam ≥ 20 ise kişi "benzersiz insan" sayılır. Ağırlıklar düzenli olarak yeniden ayarlanır (örneğin devlet kimliği 16,026).

### 8.2 Likit (vekâletli) demokrasi

- **LiquidFeedback ve Korsan Partisi verisi** [241][242]:
  - Vekâlet kapsamları birim, alan ve mesele düzeyindedir; daha özgül olan geçerlidir.
  - Kişi doğrudan oy verince, verdiği vekâlet o konu için askıya alınır.
  - Aynı alanda vekâlet döngüsü yasaktır.
  - Veri: 499.009 oy ve 14.964 vekâlet. Vekâlet ağırlığı kuvvet yasasına uydu (üs 1,38) ve Gini katsayısı zamanla arttı.
  - Çok vekâlet toplayan "süper seçmenler" çoğunlukla çoğunluğun tarafında oy verdi. Yine de bu konudaki tartışma üyeleri partiden uzaklaştırdı.
- **Google Votes ve genişlik öncelikli vekâlet** [243][244]: Seçmen birden çok vekili sıralayabilir. En kısa vekâlet zinciriyle ulaşılan vekil kazanır; döngü olduğunda oy kaybolmaz.
- **Dirençli Likit Demokrasi** [248]: Sıralı vekâlet ve yedek oy ile oy kaybı yaklaşık %3'te kaldı. Tek vekilli tasarımlarda, vekillere yönelik hedefli bir arıza senaryosunda kayıp %26–49'du.
- **Teori** [240][245][246][247]:
  - Kahng, Mackenzie ve Procaccia, hiçbir yerel vekâlet mekanizmasının iki özelliği birlikte sağlayamayacağını gösterdi: doğrudan oylamaya göre olumlu kazanç ve doğrudan oylamadan daha kötü olmama.
  - Merkezi olarak koordine edilen GreedyCap ikisini birden sağlar: yalnızca bir adımlık vekâlet ve her kişinin ağırlığına bir tavan, C(n) ∈ ω(1) ∩ o(log n).
  - Viskoz demokraside vekâlet ağırlığı her adımda α ile çarpılarak sönümlenir (α = 1 likit demokrasi, α = 0 doğrudan demokrasi). α < 1 çoğu zaman doğruluğu %10–20'ye kadar artırır.
  - Bağlantılar arttıkça güç dengesizliği büyür; vekâlet zincirinin uzunluğu sınırlanmalıdır.

### 8.3 Topluluk ve görüş kümesi tespiti, kutuplaşma, koordineli davranış

- **Leiden** [249][250]: Louvain yöntemi toplulukların %25'e kadarını kötü bağlı, %16'ya kadarını kopuk bırakabilir; Leiden iyi bağlı topluluklar garanti eder.
  - JavaScript'te `ngraph.leiden` kullanılabilir: MIT lisanslı, modularity veya CPM destekli, `randomSeed` varsayılanı 42 [254].
  - Neo4j GDS'in Leiden'ı yalnızca yönsüz graflarda çalışır.
- **graphology standart kütüphanesi** [251][252][253]: PageRank (α 0,85, 100 yineleme, 1e-6 tolerans), aradalık merkeziliği, modülerlik, en kısa yol, bağlı bileşenler, döngü tespiti (DAG) ve tohumlanabilir Louvain. Kişiselleştirilmiş PageRank seçeneği yoktur; yaklaşık 10 satırla yazılabilir.
- **Kutuplaşma ölçüleri** [257][258]: Rastgele Yürüyüş Tartışmalılığı (RWC, 0 ile 1 arası) ve Guerra'nın sınır ölçüsü. Çok küçük graflarda yanıltıcıdır (Karate kulübü örneği).
- **Koordineli davranış** [255][256]:
  - SynchroTrap, aynı nesneye Tsim süresi içinde yapılan eylemleri eşleştirir, kullanıcı çiftleri için Jaccard benzerliği hesaplar ve eşiği aşan çiftlerin bağlı bileşenlerini bulur. Facebook'ta 200'den büyük kümelerde %99'un üzerinde kesinlik elde edildi.
  - CopyCatch, 2Δt penceresinde n kullanıcının m sayfanın neredeyse hepsini beğendiği çekirdek grupları (n × m iki parçalı çekirdekler) bulur.
- **Köprü için ikili anlaşmazlık** [74]: Bir içeriği onaylayanların, başka konularda birbirine ne kadar katılmadığını ölçer; kümeleme gerektirmez.

**Bizim sisteme etkisi:**

- SQLite tek doğruluk kaynağı olacak. `graph_nodes` ve `graph_edges` tablolarına yalnızca ekleme yapılacak; kayıtlar silinmez, `revokedAt` ile geçersiz kılınır. Hesaplar bellekteki graphology grafı üzerinde yapılacak.
- Grafta yalnızca takma adlı UUID'ler bulunacak; kimlik verisi ayrı ve şifreli bir tabloda duracak.
- Sybil savunması katmanlı olacak: kimlik özetinin tekilliği → kefil durum makinesi → günlük SybilRank → uygunluk puanı kapısı → açık oylamalarda eşzamanlı (lockstep) oy tespiti.
  - Graf puanı hesabı yalnızca insan incelemesine sıraya koyar; otomatik yasaklama yapmaz.
  - Oylar hiçbir zaman güven puanıyla ağırlıklandırılmaz.
- Vekâlet isteğe bağlı bir modül olacak: kapsamlar, sıralı vekil listesi, döngü kontrolü, ağırlık tavanı, en fazla 3 adım, α = 0,9 ve bir Gini panosu.
- Her graf hesaplaması deftere yazılacak: algoritma, sürüm, parametreler, tohum, girdi ve çıktı özetleri.

---

## 9. Yapay Zekâ, KVKK ve Web/Android Mimarisi

### 9.1 Yapay zekâ ile moderasyon ve önyargı

- **Perspective API** [259][260][261][262]:
  - Resmî sayfaya göre hizmet 31 Aralık 2026'ya kadar çalışacak ve kota talepleri Şubat 2026'ya kadar kabul edildi. Ekim 2026'da başlayan bir proje için fiilen kullanılamaz.
  - Sap ve arkadaşları: Afro-Amerikan İngilizcesiyle yazılmış tweet'ler 2 kata kadar daha sık "saldırgan" etiketlendi.
  - 241 makaleyi inceleyen bir çalışmaya göre modelin habersizce yeniden eğitilmesi sonuçlarda kaymalara yol açtı.
- **LLM ile moderasyon** [266][263][264]:
  - Anthropic'in rehberi şunları önerir: istemde kategorilerin yalnızca adlarını değil tanımlarını vermek, JSON çıktısı almak ({ihlal, kategoriler, açıklama}) ve evet/hayır yerine 0–3 arası risk seviyeleri kullanmak.
  - Araştırmalar, konunun kendisinin tetiklediği yanlış pozitifler buldu; daha gelişmiş modellerde bu çarpıklık daha güçlüydü.
  - İdeolojik bir persona verilen model kendi tarafını savunuyor ve karşı görüşteki zararı küçümsüyor.
- **Santa Clara İlkeleri 2.0** [267]: Moderasyonda üç işletim ilkesi:
  - bildirim: hangi içerik, hangi kural, nasıl tespit edildi (insan mı, otomatik mi);
  - itiraz: itirazı, asıl kararda yer almamış bir insan inceler;
  - sayılar: düzenli şeffaflık raporu.

**Bizim sisteme etkisi:**

- Perspective API kullanılmayacak. Moderasyon üç katmanlı olacak:
  1. deterministik kurallar (TC kimlik numarası sağlama toplamıyla kişisel veri tespiti dahil);
  2. bir Claude sınıflandırıcısı: istemde yönetmelik maddeleri tanımlanır, çıktı yapılandırılmıştır ve madde ile metin aralığına atıf zorunludur;
  3. insan kuyruğu.
- İsteme olumsuz tanımlar yazılacak: Muhalefet, azınlık görüşü, çoğunluğu veya yöneticileri eleştirmek, ağız ve lehçe farkları ve kimseyi hedef almayan küfür ihlal sayılmaz.
- YZ en fazla bir girdiyi "inceleme bekliyor" diye katlayabilecek; hiçbir şeyi silemeyecek.
- Görüş kümeleri arasındaki işaretleme oranı farkı haftalık olarak denetlenecek.

### 9.2 Özetleme, gömmeler ve tekrar tespiti

- **Polis grup bilgili uzlaşı (GIC)** [52][53]: P_g = (a_g+1)/(n_g+2), GIC = Π_g P_g. Tek bir küçük grubun ortak itirazı GIC'yi düşük tutar.
- **multilingual-e5-small** [268][269][270][271]: 12 katman, 384 boyut ve Türkçe dahil yaklaşık 100 dil. Transformers.js ile Node'da çevrimdışı çalışır. Simetrik görevlerde metne "query: " öneki eklenir. Kosinüs benzerlikleri 0,7–1,0 aralığında toplandığından başka yerlerden alınan mutlak eşikler (örneğin 0,8) burada işe yaramaz; eşikler etiketli Türkçe örneklerle kalibre edilmelidir.

**Bizim sisteme etkisi:**

- Özet boru hattı:
  1. Her girdiden iddia ve birebir alıntı çıkarılır.
  2. Alıntının girdide gerçekten geçtiği deterministik olarak doğrulanır.
  3. İddialar yerel gömmelerle kümelenir.
  4. Sonuç sabit bir düzende yazılır: Ortak zemin / Tartışmalı noktalar / Azınlık görüşleri / Açık sorular.
- Özetteki her cümle girdi kimliğine atıf yapacak.
- Azınlık kümeleri hiçbir zaman atılmayacak; küçük kümeler örneklemle değil tüm üyeleriyle özetlenecek.
- Her özette "Görüşüm yanlış aktarıldı" düğmesi olacak.
- Tekrar tespiti, kullanıcı taslak yazarken "benzer öneriler" gösterecek ama hiçbir zaman otomatik birleştirme yapmayacak. Kullanıcı yine de devam ederse, önerisinin farkını anlatan bir metin istenecek.

### 9.3 Etiketleme: AB Yapay Zekâ Yasası md. 50

Bu madde 2 Ağustos 2026'dan itibaren uygulanıyor [280][281]:

- Sohbet botları, kullanıcıya bir YZ ile konuştuğunu bildirmelidir.
- Üretici YZ sistemlerinin sağlayıcıları sentetik çıktıyı makine tarafından okunabilir biçimde işaretlemelidir.
- Kamu yararını ilgilendiren konularda YZ ile üretilmiş metin yayımlayan kullanıcı kuruluşlar bunu açıklamalıdır. İstisna: metin, sorumlu bir kişinin gerçek editoryal denetiminden geçmişse.
- Açıklama ilk görüldüğü anda, açık ve ayırt edilebilir biçimde yapılmalıdır.

Türkiye AB üyesi olmasa da bu etiketlemeyi uygulamak ucuzdur ve KVKK'nın şeffaflık beklentisiyle örtüşür.

**Bizim sisteme etkisi:**

- Her YZ çıktısının başında "Yapay zekâ ile üretildi · model · tarih" rozeti ve makine tarafından okunabilir bir işaret olacak.
- Adı belli bir moderatör veya bilirkişi onayladıktan sonra rozet "İnsan editör onaylı" olacak; onaylayan kişi deftere yazılacak.

### 9.4 KVKK (6698 sayılı Kanun)

[272][274][275][276][277][278]

- **Özel nitelikli veri:** Siyasi düşünce özel nitelikli kişisel veridir (md. 6/1). Gerçek kimliğe bağlanmış yönetişim oyları ve gönderileri bunu açığa çıkarabilir. 2024 değişikliğinden sonraki istisnalar arasında şunlar var:
  - açık rıza (6/3-a);
  - siyasi veya felsefi amaçlı vakıf, dernek ve kâr amacı gütmeyen kuruluşların yalnızca kendi üyeleriyle sınırlı işlemesi (6/3-g).
- **Açık rıza:** Belirli bir konuya ilişkin, bilgilendirmeye dayanan ve özgür iradeyle verilen rızadır (md. 3).
  - Hizmet açık rıza şartına bağlanamaz. Başka bir hukuki sebep varken rıza istemek kötüye kullanımdır (Kurul kararı 2021/389).
  - Açık rıza aydınlatma metninden ayrı alınmalıdır.
- **Genel ilkeler (md. 4):** Veri amaçla bağlantılı, sınırlı ve ölçülü olmalı (veri minimizasyonu); gerektiği süre kadar saklanmalıdır.
- **Özel nitelikli veride yeterli önlemler (Kurul kararı 2018/10):**
  - ayrı bir politika;
  - personele eğitim ve gizlilik sözleşmeleri;
  - kriptografik saklama ve anahtarların ayrı tutulması;
  - tüm işlemlerin kaydı;
  - güvenlik testleri;
  - uzaktan erişimde iki faktörlü kimlik doğrulama.
- **Yurt dışına aktarım (md. 9, 2024 değişikliği):** Yeterlilik kararı veya uygun güvenceler gerekir. Standart sözleşme imzalanırsa 5 iş günü içinde Kurum'a bildirilmelidir. Aksi hâlde yalnızca arızi (ara sıra yapılan) aktarım mümkündür. Yabancı bir LLM API'sine forum metni göndermek de bir aktarımdır.
- **Haklar (md. 11):** (g) bendi, kişinin, verilerinin yalnızca otomatik sistemlerle analiz edilmesi sonucunda aleyhine çıkan bir sonuca itiraz hakkını tanır. Bu, YZ'yi danışman rolünde tutmanın hukuki dayanağıdır.
- **Süreler:**
  - başvurulara 30 gün içinde cevap (md. 13);
  - ihlali en kısa sürede bildirme; Kurul bunu 72 saat olarak yorumluyor (2019/10);
  - periyodik imha en fazla 6 ayda bir;
  - silme kayıtları en az 3 yıl saklanır;
  - istisna kapsamında değilse, veri işlemeye başlamadan önce VERBİS kaydı.

### 9.5 Kişisel veri mühendisliği

- **TC Kimlik No sağlama toplamı** [282][283]:
  - Numara 11 hanelidir ve ilk hanesi 0 olamaz.
  - 10. hane = (7·tek sıradaki haneler toplamı + 9·çift sıradaki haneler toplamı) mod 10.
  - 11. hane = ilk 10 hanenin toplamı mod 10.
  - Yayımlanmış üç formül varyantı 200.000 rastgele girdide eşdeğer bulundu.
  - Bu kontrol numaranın yalnızca biçimini doğrular, kişiye ait olduğunu değil. NVİ/e-Devlet entegrasyonu doğrulanamadı; uç nokta erişim hatası verdi.
  - Yaklaşık 900 milyon geçerli numara (~2³⁰) olduğundan, anahtarsız bir özet dakikalar içinde tersine çevrilebilir.
- **CipherSweet** [284][285]: Alanlar şifrelenir; ayrıca ayrı bir anahtarla üretilen "kör indeks" (blind index) sayesinde eşitlik araması ve tekillik kısıtı yapılabilir. Anahtarlar tablo, sütun ve indeks başına HKDF ile türetilir.
- **AES-256-GCM** [286][287]: Node.js'te `setAAD` çağrısı `update`'ten önce, `setAuthTag` çağrısı `final`'dan önce yapılmalıdır. Rastgele 96 bitlik IV, anahtar başına 2³² şifrelemeye kadar güvenlidir (NIST SP 800-38D).

### 9.6 Web ve Android mimarisi

| Seçenek | Artı | Eksi | Karar |
|---|---|---|---|
| Capacitor 8 (Ionic) [288][289][290][291] | Aynı React/TypeScript kodu web'de ve Android'de çalışır. Gerçek DOM sayesinde uzun metin seçilebilir ve erişilebilirdir. Node 22+, Android API 24+ | WebView açılışı daha yavaştır (blog ölçümleri [297][298]). `https://localhost` kökeninden yapılan `http` çağrıları karışık içerik olarak engellenir | **Seçildi** |
| React Native / Expo [295] | Yerel arayüz, daha akıcı kaydırma | Normal HTML/CSS yerine RN bileşenleri; bazı modüllerin web desteği eksik | Alternatif |
| Flutter [296] | Android'de iyi performans | Kendi dokümanı, metin ağırlıklı web siteleri için uygun olmadığını söylüyor; Dart dili gerekir | Önerilmez |

**Capacitor ayrıntıları:**

- Komutlar: `npx cap add android` → `npx cap sync` → `./gradlew assembleDebug` [293].
- Varsayılanlar: `androidScheme = 'https'`, `hostname = 'localhost'`, `cleartext = false`, `allowMixedContent = false`; `CapacitorHttp` kapalı.
- API 28'den itibaren şifresiz (cleartext) trafik varsayılan olarak engellenir. Geliştirme sırasında `network_security_config.xml` ile yalnızca `10.0.2.2` (emülatörden ana makineye erişim adresi) ve `localhost` için izin verilir [292][294].
- Ayrıca `CapacitorHttp` etkinleştirilir veya arka ucun CORS listesine `https://localhost` eklenir.

---

## 10. Platform ve Gereksinim Karşılaştırma Tablosu

Gösterim: **+** var veya güçlü, **~** kısmen veya dolaylı, **−** yok, **?** incelenen kaynaklarda doğrulanamadı.

| Platform | Konu açma | Düzenleme teklifi | Çoğunluk oyu | Alt konu | Ontoloji denetimi | Silinmez tartışma | Silme oylaması | Azınlık koruması | Dağıtık defter | Bilirkişi | Yapay zekâ | Sosyal graf | Mobil |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| LiquidFeedback | + | + (rakip alternatif) | + (Schulze + statüko) | ~ (konu alanları) | ~ (politika tablosu) | ? | − | + (adil sıralama, klon-bağımsızlık) | − | − | − | ~ (vekâlet grafı) | ? |
| Decidim | + | + (emendation) | ~ (destek eşiği, resmî cevap) | ~ (madde bazlı metin) | − | ~ (yumuşak silme) | − | ~ (promote) | − | ~ (değerlendirici) | ~ (benzerlik eşiği) | − | ~ (duyarlı web) |
| CONSUL / Decide Madrid | + | ~ (ortak yasama) | + (eşik → halk oylaması) | − | − | ~ (geri alınabilir gizleme) | − | − | − | − | − | − | ~ (duyarlı web) |
| Loomio | + | ~ (rıza turu) | + (anket türleri) | − | − | ? | − | ~ (gerekçe, blok) | − | − | − | − | ? |
| Your Priorities | + | − | ~ (artı/eksi) | − | − | ? | − | ~ (ayrı lehte/aleyhte) | − | − | + (zehirli içerik tespiti, çeviri) | − | ? |
| Citizen OS | + | − | + | − | − | ~ ("yine de göster") | − | − | ~ (eID imzalı oy) | − | − | − | ~ (duyarlı web) |
| DemocracyOS | + | − | + | − | − | ? | − | − | − | − | − | ~ (vekâlet) | ? |
| adhocracy+ | + | ~ (metin inceleme) | + (anket) | ~ (zincir evreler) | − | ? | − | − | − | − | − | − | ? |
| Kialo | + (tez) | ~ (düzenleme önerisi) | − | + (iç içe iddialar) | − | ~ (arşiv) | − | − | − | − | − | ~ (argüman ağacı) | ? |
| Polis / vTaiwan | ~ (ifade) | − | − (bağlayıcı değil) | − | − | ? | − | + (GAC) | − | ~ (yansıtma aşaması) | ~ (LLM deneyleri) | + (görüş kümeleri) | ? |
| Wikipedia | + | + | − (argüman kalitesi) | ~ | ~ (CONLEVEL) | + (tam geçmiş) | ~ (kapalı ölçüt, yönetici kararı) | ~ | − | − | − | − | ? |
| Stack Exchange / OSQA | + | + | ~ (sıralama oyu) | − | − | ~ | ~ (itibara bağlı silme oyu) | − | − | − | − | − | ? |
| Birleşik Krallık e-dilekçe | + | − | ~ (imza eşiği) | − | ~ (yayımlanmış standartlar) | − | − | − | − | − | − | − | ? |
| Community Notes | ~ (not) | − | − | − | − | − | − | + (MF ile köprü) | − | − | ~ (algoritmik) | ~ (değerlendirici faktörü) | ? |
| DAO'lar (Compound, OpenGov, Snapshot) | + | ~ | + | − | − | − | − | ~ (veto, onay penceresi) | + | − | − | − | ? |
| Kleros | − | − | + (jüri) | − | − | − | − | − | + | + (kura jürisi) | − | − | ? |
| **Bizim sistem (hedef)** | **+** | **+** | **+ (köprülü)** | **+** | **+** | **+** | **+** | **+** | **+** | **+** | **+ (danışman)** | **+** | **+ (Capacitor)** |

**Gözlemler:**

1. Bağlayıcı çoğunluk oyu ile ölçülmüş azınlık korumasını birlikte sunan tek sistem LiquidFeedback'tir. Ancak onda da ontoloji, defter, bilirkişi ve YZ yoktur.
2. "Silme oylaması" gereksinimini doğrudan karşılayan bir sistem bulunamadı. Moderasyon her yerde yöneticiye veya itibara bağlıdır. Bizim karartma durum makinemiz (Bölüm 12.10) bu alanda yeni bir katkıdır.
3. Ontolojiyle denetim yalnızca hukuk bilişimi literatüründe (Bölüm 6) var; hiçbir katılım platformu bunu kullanmıyor.
4. Dağıtık defter yalnızca DAO dünyasında var ve orada jeton ağırlığıyla (plütokratik) çalışıyor. "Bir kişi, bir oy" ilkesini kimlik doğrulamayla birleştiren izinli bir BFT defteri bu açığı kapatır.
5. Mobil konusunda incelenen hiçbir platformda yerel uygulama kanıtı yok. Tek kod tabanlı Capacitor yaklaşımı mevcut uygulamayla uyumlu.

---

## 11. Çoğunluğun Azınlığı Ezmesi (Çoğunluk Tiranlığı) Problemi

> Hocamızın sorusu: *"Çoğunluk azınlığı tüketebilir, nasıl çözeriz?"*

### 11.1 Kavram ve teori

**Madison (Federalist 10 ve 51)** [90][91]

- Fikir: Hiziplerin nedenlerini ortadan kaldırmak özgürlüğü de yok eder; bu yüzden hiziplerin etkileri kontrol edilmelidir. Azınlıktaki bir hizip olağan çoğunluk oyuyla yenilir; asıl tehlike çoğunluktaki hiziptir.
- Çareleri: geniş ve çeşitli bir cumhuriyet, temsil ve kuvvetler ayrılığı. Toplumda "çoğunluktan bağımsız bir irade" kurmak ya da haksız bir çoğunluk koalisyonunu "çok olasılık dışı" kılacak kadar çeşitli vatandaş grupları barındırmak.
- **Bize etkisi:**
  - Çoğunlukların konudan konuya değişen (kesişen) mi, yoksa sabit mi olduğunu ölçeceğiz. Görüş kümeleri her dönem yeniden hesaplanacak; aynı küme her oylamayı kazanıyorsa "kalıcı kaybeden" alarmı verilecek.
  - Ontoloji ve bilirkişi, "çoğunluktan bağımsız irade" rolünü üstlenecek.
  - Önermek, denetlemek, karar vermek ve yürürlüğe koymak ayrı adımlar olacak.

**Tocqueville ve J. S. Mill** [92][93][94]

- Fikir: Tocqueville'e göre "çoğunluğun her şeye gücünün yetmesi", tek bir zorba kadar tehlikelidir. Mill'e göre çoğunluk tiranlığı yalnızca yasalarla değil, toplumsal baskıyla da işler; çözüm olarak zarar ilkesini önerir. Olson ise iyi örgütlenmiş dar azınlıkların daha büyük tehdit olabileceğini savunur.
- **Bize etkisi:**
  - Tartışmalar konuşmadır; bunların çoğunluk oyuyla silinmesi tam da Mill'in örneğidir.
  - "Tartışmalar görüş nedeniyle silinemez" kuralı değiştirilemez madde olacak. Karartma yalnızca sayılı zarar gerekçeleriyle yapılabilecek.
  - Toplumsal baskıya karşı takma ad ve gizli oy kullanılacak.

**Calhoun'un eşzamanlı çoğunluğu** [95]

- Fikir: Kararlar için her büyük çıkar grubunun ayrı ayrı rızası aranır ve her grubun veto hakkı vardır.
- Eleştiri: Kuram köleliği korumak için tasarlanmıştı (köleleştirilenlerin vetosu yoktu) ve kilitlenmeye yol açar.
- **Bize etkisi:**
  - Eşzamanlı rızayı yumuşak biçimde uygulayacağız: Her grupta çoğunluk değil, her grupta bir taban (örneğin her önemli kümede en az %40 destek). Bu yalnızca üst karar kademelerinde aranacak.
  - Gruplar sabit kimliklere göre değil, gözlenen görüşlere göre tanımlanacak.
  - Her grup vetosu askıya alıcı olacak, mutlak değil.

**Lijphart'ın uzlaşmacı (consociational) demokrasisi** [96]

- Dört özellik: büyük koalisyon, karşılıklı veto, orantılılık ve kesimsel özerklik.
- Eleştiri: Hareketsizliğe yol açar, kimlikleri sertleştirir ve hiçbir kesime girmeyen "Diğerleri"ni dışlar (Lübnan ve Bosna örnekleri).
- **Bize etkisi:**
  - Kıt kaynaklar (gündem slotları, öne çıkan konular, bilirkişi zamanı) kümeler arasında orantılı dağıtılacak (Eşit Paylar Yöntemi).
  - Kesimsel özerkliğin karşılığı, yalnızca kendi katılımcılarını etkileyen alt konulardır.
  - Sabit kesimler olmayacak; yeterince oy veren herkes kümelenecek.

**Lani Guinier** [97]

- Fikir: Çoğunluk sabit ve kalıcıysa, %51 her şeyin %100'ünü kazanır. Çözüm önerileri: "sırayla yönetme" ilkesi, kümülatif oy, nitelikli çoğunluk ve azınlık için kritik konularda azınlık vetosu.
- **Bize etkisi:**
  - Gündem rotasyonu: Her döngüde, her önemli kümenin en öncelikli önerisinin oylanması garanti edilecek. Bu, zaferin değil söz hakkının garantisidir.
  - Bir konunun azınlık için "kritik" olup olmadığına ontoloji karar verecek: korunan bir hakkı etkileyen veya tanımlanabilir bir kümeyi hedef alan öneriler.

**Azınlık tiranlığı: liberum veto, filibuster, Kuzey İrlanda dilekçeleri** [106][107][108][104]

- Polonya'da 1652'den itibaren tek bir Sejm (meclis) üyesi oturumu bitirip o oturumun tüm kararlarını geçersiz kılabiliyordu. 1573–1763 arasındaki yaklaşık 150 Sejm'den 53'ü başarısız oldu; bunların 32'si veto ile dağıtıldı. Rusya ve Prusya vekillere rüşvet verdi. 1791 Anayasası vetoyu kaldırdı.
- ABD Senatosu'nda tartışmayı kapatmak (cloture) için üye tamsayısının 3/5'i (60 oy) gerekir.
- Kuzey İrlanda'da "endişe dilekçesi" 1998–2019 arasında 159 kez kullanıldı ve sonra kısıtlandı.
- **Ders:** Mutlak azınlık vetoları dışarıdan ele geçirilmeye açık noktalara dönüşür ve sistemi felç eder.

### 11.2 Gerçek dünyadaki kurumsal mekanizmalar

| Mekanizma | Kaynak | Ne korur | Risk | Kararımız |
|---|---|---|---|---|
| Değiştirilemez çekirdek | Anayasa md. 4; Alman Temel Yasası md. 79(3) [100][98][99] | Temel haklar ve usul | Çekirdek büyükse sistem donar | **Evet:** 5–8 madde; oylamaya bile sunulamaz |
| Kademeli nitelikli çoğunluk ve iki okuma | Anayasa md. 175 (3/5 → halkoyu, 2/3 → doğrudan yürürlük) [101]; Alman Temel Yasası md. 79(2) | Yönetmeliğin istikrarı | Statükoyu kayırır | **Evet (T2):** iki okuma, her biri ≥ %60; son okuma 2/3'ün altındaysa tüm üyelerin onay oylaması |
| Askıya alıcı veto ve ölçekli aşma | Belçika md. 54 (dil grubunun 3/4 imzası, 30 gün, tasarı başına bir kez) [103]; Almanya md. 77; Polkadot'ta tek seferlik veto [123] | Azınlığa zaman ve inceleme kazandırır | Taktik amaçla kullanılabilir | **Evet:** "alarm zili"; küme başına bir kez; bütçeli |
| Ağırlıklı çoğunluk (paralel rıza) | Kuzey İrlanda: toplam ≥ %60 ve her blokta ≥ %40 [104][105]; Belçika md. 4 | Kesimler arası rıza | Gruplar sabit ve kendi beyanına dayalı | **Evet (T1):** onay ≥ %60 ve her önemli görüş kümesinde ≥ %40 |
| Kare köklü yeter sayı; statükoya karşı oran | Debian Anayasası [111] | Küçük toplulukta anlamlı bir yeter sayı | Süreler uzun | **Evet:** Q = √N/2; 3Q yeter sayı tabanı |
| Uyarlanabilir katılım yanlılığı | Polkadot Gov1 [122] | Katılım düşükken küçük ve aktif bir grubun karar almasını önler | Düşük katılımda aşırı katı (%10 katılımda yaklaşık %92,5 evet gerekir) | **İsteğe bağlı**; %75 tavanlı |
| Onay penceresi, giriş süresi, sessiz bitiş | OpenGov [125], DAOstack [127], OpenZeppelin [137] | Son dakika baskınları | Süre uzar | **Evet** |
| Kurayla seçilmiş küçük vatandaş meclisi | İrlanda (99 kişi ve bir yargıç) [112]; LEXIMIN seçimi [113][114] | Kutuplaşmış konularda kilidi çözer | Danışma niteliğindedir | **Evet:** 12–24 kişilik arabulucu panel |
| Eşit Paylar Yöntemi (MES) | Wieliczka, Aarau, Winterthur [115] | Gündemde orantılılık | Yalnızca "hangilerini seçelim" türü kararlara uyar | **İsteğe bağlı:** gündem slotları |
| Kredi tabanlı kuadratik oy (QV) | Lalley-Weyl [116], Posner-Weyl [117], Colorado 2019 [118][119] | Tercihi yoğun azınlık | Gizli QV meşruiyet kaybettirdi (Colorado mahkeme kararı); işbirliği yapılabilir | **İsteğe bağlı:** yalnızca gündem önceliğinde; bağlayıcı oylamada asla |
| İkili koordinasyon indirimi | Buterin [120] | Blok hâlinde kullanılan kredileri dengeler | Gerçekten aynı görüşteki toplulukları da cezalandırır | İsteğe bağlı (QV ile birlikte) |
| İki meclis, iyimser onay | Optimism [128] | Kişileri ve çıkarları ayrı temsil eder | Karmaşık | **Hafif karşılığı:** "kümeler meclisi" = eşzamanlı taban kontrolü |
| Tolerans süresi ve çıkış hakkı | MolochDAO [132], Lido [133] | Veto vermeden koruma | Varlık gerektirir | **Evet:** 72 saatlik yürürlük gecikmesi, kalıcı "azınlık raporu" ve alt konu kurallarından muaf olma hakkı |
| Köprü ölçümü | Polis GAC [49], Community Notes [63] | Gruplar arası destek | Küçük N'de gürültü; manipülasyon | **Evet:** kabul koşulu (aşağıda) |
| ≥ %64 nitelikli çoğunluk | Caplin-Nalebuff [110] | Belli varsayımlar altında döngüsüz karar | Evrensel bir sonuç değil | Yönetmelik için 2/3 eşiğinin gerekçesi |

### 11.3 Üç kritik uyarı

1. **Nitelikli çoğunluk azınlık koruması değildir.** LiquidFeedback kitabı, 2/3 kurallarının statüko taraftarlarının oyuna fiilen çift ağırlık verdiğini belirtir [1]. Statüko bir azınlığa zarar veriyorsa, nitelikli çoğunluk o zararı korur. Bu yüzden bir hakkı genişleten öneriler T0 kademesinden, kısıtlayan öneriler T1 kademesinden geçmelidir.
2. **Köprü tek başına hak koruması değildir.** Görüş kümeleri oylardan çıkarılır. Blok hâlinde oy vermeyen demografik bir azınlık ya da kümelerin paylaştığı bir önyargı bu yolla korunmaz [72]. Ontolojideki katı kısıtlar şarttır.
3. **Azınlığa verilen her yetki azınlık tiranlığına dönüşebilir.** Liberum veto ve Kuzey İrlanda dilekçeleri bunu gösteriyor. Bu yüzden her azınlık yetkisi:
   - askıya alıcı olmalı,
   - öneri başına tek kullanımlık olmalı,
   - kişi başına bütçeli olmalı,
   - süreli olmalı (7–30 gün),
   - en fazla 2/3 ile aşılabilmeli,
   - ve kullanımı herkese açık istatistiklerle yayımlanmalıdır.

### 11.4 Seçtiğimiz katmanlı savunma ve gerekçeleri

| # | Katman | Ne yapar | Neden seçtik |
|---|---|---|---|
| 1 | **Değiştirilemez haklar çekirdeği** | Eşit oy, önerme hakkı, görüş nedeniyle silinmeme, itiraz hakkı, kimlik mahremiyeti gibi 5–8 madde `fy:Degistirilemez` olarak işaretlenir. Bunları hedefleyen bir öneri, kabul aşamasında SHACL ihlaliyle reddedilir. Koruma maddesi kendini de korur | Anayasa md. 4 ve Nomic. LiquidFeedback'e göre bunu bir algoritma değil, ancak bir anayasa sağlayabilir |
| 2 | **Gündeme erişim** | Kabulde yalnızca olumlu destek sayılır; yeter sayı düşük ve görelidir; Issue Limiter uygulanır. Her önemli kümeye her döngüde bir gündem slotu garanti edilir | Azınlık konusunu her zaman tartışmaya açabilmeli (Guinier, LiquidFeedback) |
| 3 | **Görünürlük** | Alternatifler Harmonic Weighting ile, tartışma girdileri köprü önceliğiyle sıralanır. Lehte ve aleyhte sütunlar ayrı sıralanır. Ham beğeni veya "hot score" hiç kullanılmaz | Decide Madrid'deki Matthew etkisi |
| 4 | **Rakip alternatifler ve klon-bağımsız Schulze** | Düzenleme teklifleri aynı mesele içinde yarışır. Birbirine benzeyen azınlık seçenekleri oyu bölmez | LiquidFeedback, Debian, Schulze |
| 5 | **Gizli oy; sonuçlar kapanışa kadar gizli** | Taahhüt-açıklama yöntemi. Toplumsal baskıyı ve sürü etkisini azaltır | Mill, Loomio, Shutter |
| 6 | **Köprülü çoğunluk (eşzamanlı rıza)** | Çoğunluk gereklidir ama yeterli değildir. Köprü testi başarısız olursa öneri reddedilmez, UZLAŞMA turuna gider | Polis, Kuzey İrlanda ağırlıklı çoğunluğu, Calhoun'un yumuşatılmış hâli |
| 7 | **Askıya alıcı azınlık itirazı ("alarm zili")** | Yürürlük gecikmesi süresince bir kez kullanılabilir. Soğuma süresi, bilirkişi raporu ve kurayla seçilmiş bir panel devreye girer. Yeniden oylamada eşik %60 veya %66,7'dir | Belçika md. 54, Almanya md. 77, Lido |
| 8 | **Konuşma koruması** | Silme yalnızca sayılı gerekçelerle yapılabilir. 2/3 çoğunluk ve yazarın kendi kümesinde ≥ %50 destek gerekir. Yazara bildirim, cevap hakkı ve itiraz vardır | Mill, Wikipedia RD2 |
| 9 | **Bilirkişi ve kura** | Bilirkişi kurayla seçilir. Azınlık bir kez ücretsiz karşı uzmanlık isteyebilir. Kutuplaşmış konularda kurayla seçilen bir panel devreye girer | Çoğunluk uzman kanalını kendi adamlarıyla dolduramaz |
| 10 | **Kayıt ve şeffaflık** | Ret gerekçeleri ve azınlık raporu resmî sonuca eklenir. Her kararın bir kontrol listesi yayımlanır. İtiraz ve veto kullanım istatistikleri ile "kalıcı kaybeden" ölçüsü deftere yazılır | Loomio, Guinier, Colorado kararı |

**Hocaya cevap (özet):** "Çoğunluk azınlığı tüketebilir" sorusunun tek bir algoritmik cevabı yok. Anayasal demokrasiler bu problemi yüzyıllardır katmanlar hâlinde çözüyor. Sistemimiz de beş düzeyde çözüyor:

1. **Anayasal düzey:** Çoğunluğun dokunamayacağı haklar ontolojide tanımlıdır.
2. **Usul düzeyi:** Gündemde ve görünürlükte orantılılık; gizli oy.
3. **Karar düzeyi:** Köprülü çoğunluk ve görüş kümelerinin eşzamanlı rızası.
4. **Zaman düzeyi:** Askıya alıcı ve tek kullanımlık itiraz; uzlaşma turu.
5. **Hesap verebilirlik düzeyi:** Azınlık raporu ve değiştirilemez defter.

Azınlık tiranlığına karşı da önlem var: Azınlığa verilen her yetki süreli, bütçeli ve 2/3 ile aşılabilirdir.

---

## 12. Algoritmalar

Bu bölümdeki formüller kaynaklardan alındığı şekliyle verilmiştir. Kaynakta olmayan değerler "bizim değerimiz" diye işaretlenmiştir. Tüm sayılar tam sayı aritmetiği veya sabit tohumlu deterministik hesapla uygulanmalıdır; çünkü defter doğrulayıcıları hesabı yeniden yapıp aynı sonuca ulaşmalıdır.

### 12.1 Konu yaşam döngüsü (durum makinesi)

LiquidFeedback, Compound, OpenGov ve Birleşik Krallık dilekçelerinin sentezi [1][134][125][47]:

```
TASLAK
 └─ gönder → ES_SPONSOR (K = min(5, ⌈√N/2⌉) doğrulanmış eş-sponsor, en fazla 7 gün)
     └─ DENETIM (ontoloji: N3 akıl yürütme + SHACL; YZ benzerlik/çatışma uyarısı yalnızca danışma amaçlı)
         ├─ Violation (değiştirilemez madde / yasak içerik) → REDDEDILDI_KURAL (gerekçesiyle yayımlanır, itiraz edilebilir)
         ├─ Violation (bilirkişi görüşü eksik)              → BILIRKISI_BEKLIYOR → DENETIM
         └─ uygun veya yalnızca Warning                     → KABUL_EVRESI
KABUL_EVRESI (yalnızca olumlu destek sayılır; Q1)
 ├─ bir alternatifin desteği ≥ Q1 → TARTISMA (hemen)
 └─ süre doldu                     → IPTAL_YETERSAYI_YOK
TARTISMA (sabit süre: düzenleme teklifi, öneri, yeni alternatif, alt konu önerisi, bilirkişi görüşü)
 └─ süre sonu → DONDURULMUS
DONDURULMUS (metin kilitli; yeni alternatif eklenebilir; destek geri çekilebilir; Q2'de yalnızca memnun destekçiler sayılır)
 ├─ Q2'yi geçen alternatif yok → IPTAL_ALTERNATIF_YOK
 └─ → OYLAMA (taahhüt) → ACIKLAMA (reveal) → SAYIM
SAYIM (deterministik; bkz. 12.2–12.9)
 ├─ KABUL_ADAYI → ITIRAZ_PENCERESI (72 sa) → YURURLUK | ASKIDA
 ├─ TARTISMALI (çoğunluk var, köprü yok) → UZLASMA (7 gün) → YENIDEN_OYLAMA
 └─ REDDEDILDI (statüko kazandı) | IPTAL_*
YURURLUK → UYGULAMA_TAKIBI
ASKIDA   → soğuma + bilirkişi raporu + kura paneli → YENIDEN_OYLAMA
```

- **Defter kaydı:** Her geçiş deftere {konuId, eskiDurum, yeniDurum, metinÖzeti, zaman} olarak yazılır.
- **Alt konu:** `parentId` taşıyan bir meseledir. Ebeveyni YURURLUK durumuna geçmeden KABUL_EVRESI'ne giremez. Kategoriyi ve politikayı ebeveynden devralır. Ontoloji, alt konunun ebeveyniyle veya yönetmelikle çelişmediğini denetler (CONLEVEL).
- **Yeter sayının referans nüfusu (LiquidFeedback):** `Q = ⌈q · |R|⌉`. Burada R; alana kayıtlı olanlar, meseleyle ilgilenenler ve bunlara vekâlet verenlerin birleşimidir.

### 12.2 Schulze yöntemi ve örtük statüko (LiquidFeedback, Debian)

```
her pusula: onaylananlar > SQ > reddedilenler; çekimser kalınanlar SQ ile eşit sayılır
d[X][Y] = X'i Y'ye tercih eden seçmen sayısı
güç(X,Y) = (d[X][Y], −d[Y][X])  eğer d[X][Y] > d[Y][X], aksi hâlde yok     // "tuple" yenilgi gücü
p[X][Y] = güç(X,Y)
for k: for i≠k: for j≠i,k: p[i][j] = max(p[i][j], min(p[i][k], p[k][j]))     // Floyd–Warshall ile en geniş yol
X, Y'nin üstündedir ⇔ p[X][Y] > p[Y][X]
kazanan = Schulze sırasında SQ'nun üstündeki ilk X; ek koşullar:
  doğrudan çoğunluk: d[X][SQ] / (d[X][SQ] + d[SQ][X]) > eşik   (katı eşitsizlik)
  ters yenme yolu yok: SQ, X ile bir yenme döngüsünde değil (Smith kümesi SQ'yu içeriyorsa SQ kazanır)
  yeter sayı (Debian): X'i SQ'nun üstüne koyan seçmen sayısı ≥ ⌈3Q⌉
  oran (Debian):       V(X,SQ) ≥ S · V(SQ,X);  S = 1 (T0), 1,5 (%60), 2 (%66,7), 3 (%75)
beraberlik: ilk taslağı en eski olan alternatif kazanır; SQ ile beraberlikte SQ kazanır
```

Karmaşıklık O(c³)'tür; 20'den az seçenek için önemsizdir [1][109][111]. Schulze klon-bağımsızdır: Birbirine çok benzeyen azınlık seçenekleri oyu bölmez.

### 12.3 Yeter sayı ve destek eşitsizlikleri (Debian, Aragon, Tezos)

```
Debian:  Q = √N / 2 ;  yeter sayı R = ⌈3Q⌉ ;  gereken sponsor K = min(5, ⌈Q⌉)
         örnek: N = 100 → Q = 5, R = 15, K = 5 ;  N = 36 → Q = 3, R = 9, K = 3
Aragon (bölme yok, tam sayı; destek eşiği s = S/D):
  destek:         (D − S)·evet > S·hayır
  katılım:        evet + hayır + çekimser ≥ ⌈q·E⌉          (E = anlık görüntüdeki uygun üye sayısı)
  erken kesinlik: hayır_en_kötü = E − evet − çekimser ;  (D − S)·evet > S·hayır_en_kötü ise sonuç artık değişemez
Tezos EMA ile uyarlanan yeter sayı:
  ema' = 0,8·ema + 0,2·son_katılım ;  q = q_min + (q_max − q_min)·ema     (Tezos: 0,2 ile 0,7 arası)
```

Tam sayı aritmetiği, doğrulayıcılar arasında kayan nokta farklılıklarını önler [111][141][140].

### 12.4 Katılım yanlılığı, onay penceresi ve sessiz bitiş (Polkadot, DAOstack)

```
Gov1 olumlu katılım yanlılığı:
  GEÇER ⇔ Hayır / (Evet + Hayır + Çekimser) < Evet / T          (T = seçmen kitlesi)
  N = 400, çekimser yok: katılım 40 → Evet ≥ 37 (%92,5); katılım 200 → Evet ≥ 134 (%67); katılım 400 → Evet > Hayır
  Bizim önerimiz: isteğe bağlı; örtük eşiğe %75 tavanı; arabulucu panelin desteklediği önerilerde yanlılık uygulanmaz
  (Substrate'in karekök varyantı bu araştırmada doğrulanmadı.)
OpenGov eğrileri (doğrusal sadeleştirme):
  gerekliOnay(t)   = max(taban, 1 − (1 − taban)·t/D)
  gerekliDestek(t) = max(minDestek, s0 − (s0 − minDestek)·t/D)
  onay = evet/(evet+hayır) ;  destek = (evet+çekimser)/seçmen     (hayır oyu desteğe sayılmaz)
  geçer durum C saat boyunca kesintisiz sürmeli; kesilirse saat sıfırlanır
Sessiz bitiş: son 12 saatte önde olan taraf değişirse süre 12 saat uzar (en fazla 3 kez)
```

[122][123][125][127]

### 12.5 Harmonic Weighting, Issue Limiter ve öneri derecelendirme (LiquidFeedback)

```
Harmonic Weighting (adil görüntüleme sırası):
  yerleşmemiş = tüm alternatifler ; pos = |yerleşmemiş|
  while yerleşmemiş boş değil:
    her destekçi s için: n_s = |destekledikleri(s) ∩ yerleşmemiş|; n_s > 0 ise w_s = d_s / n_s   // d_s = kendi + vekâlet ağırlığı
    her i için: W_i = Σ_{s, i'yi destekliyor} w_s
    j = argmin W_i (beraberlikte en yenisi) ; konum[j] = pos ; pos −= 1 ; yerleşmemiş'ten j'yi çıkar
  Güvence: tam olarak S kümesini destekleyen ve büyüklüğü P·M/(1+N)'den fazla olan bir grup,
           S'nin M alternatifini ilk N sırada görür (ilk 5'te 1 yer için %16,7, 2 yer için %33,3; ilk 20'de 1 yer için %4,8)
Issue Limiter: S = B0 · f1^n   (n = açık mesele sayısı) ;  çalışma süresine göre ayarlı hâli: S = Bn · fn^(n*/N − 1)
Öneri derecelendirme:
  potansiyel_destekçi(u,i) ⇔ ∃ öneri s: (mutlaka ∧ uygulanmadı) ∨ (kesinlikle_olmamalı ∧ uygulandı)
  memnun_destekçi = destekçi ∧ ¬potansiyel ;  Q1 ikisini de sayar, Q2 yalnızca memnunları sayar
```

[1][3][4]

### 12.6 Polis görüş kümeleme boru hattı

```
V[p][c] ∈ {+1, −1, 0, NaN}
dahil(p) ⇔ oy(p) ≥ min(7, nYorum)  (bir kez dahil olan kalır); |dahil| < 15 ise en çok oy verenlerle 15'e tamamla
eksik değer → sütun ortalaması
X = V − sütunOrtalaması
for bileşen in 1..2:
  v = öncekiÖzvektör ?? tohumluRastgele()
  100 kez: v = Xᵀ(Xv); v = v/‖v‖
  X = X − (Xv)vᵀ                                       // bir sonraki bileşen için deflasyon
izdüşüm_p = [x_p·v1, x_p·v2] · √(C / n_p)               // seyrek oy düzeltmesi; işaretler kanonik hâle getirilir
temel = kmeans(izdüşüm, k = min(100, n))
maxK = min(5, 2 + ⌊n/12⌋) ; k ∈ 2..maxK için siluet s(i) = (b − a)/max(a, b)
yeni k* ancak 4 ardışık hesaplamada en iyi çıkarsa benimsenir
pa(g,c) = (1 + na_g)/(2 + ns_g) ;  pd(g,c) = (1 + nd_g)/(2 + ns_g)
ra(g,c) = pa(g,c) / ((1 + Σ_{h≠g} na_h)/(2 + Σ_{h≠g} ns_h))
iki oran z-testi (tüm sayılara +1 eklenerek): z > 1,2816 ;  temsil gücü = ra·rat·pa·pat ;  grup başına en çok 5 ifade
Yorum yönlendirme: a = (A+1)/(S+2), p = (P+1)/(S+2), E = uçluk (PCA yükü)
  öncelik(c) = [ (1 − p)·(E + 1)·a · (1 + 8·2^(−S/5)) ]²          // S = 0'da 9 kat artış
  bizim eklememiz: × (1 + açık_g(c)), açık_g = max(0, 3 − izleyicinin grubundan c'ye gelen oy sayısı)
```

[49][54][55][56]. Small ve arkadaşları öncelik formülünü `[P_a(1 − P_p)(1 + E)(1 + 2^(3 − N/5))]²` biçiminde yazar. 2^(3−S/5) = 8·2^(−S/5) olduğundan iki ifade aynıdır.

### 12.7 Grup-farkındalıklı uzlaşı (GAC) ve varyantları

```
GAC(c)      = Π_g pa(g,c)
GACn(c)     = GAC(c)^(1/K)                            // geometrik ortalama; K'dan bağımsız eşik sağlar
GACagora(c) = ( Π_g pa(g,c)·(1 − pd(g,c)) )^(1/K)     // grup içi bölünmeyi cezalandırır (Red Dwarf/Agora)
Remesh varyantı: min_g onay_g(c)
Çalışılmış örnek (K = 2):
  çoğunluk 20 seçmen, 18'i katılıyor → pa = 19/22 = 0,864 ;  azınlık 6 seçmen, 1'i katılıyor → pa = 2/8 = 0,25
  Basit çoğunluk 19/26 = %73 → GEÇER ;  GAC = 0,216 ;  GACn = 0,465 → 0,5 köprü çıtasını GEÇEMEZ
  Azınlıktan 3 kişi katılırsa: pa = 4/8 = 0,5 → GAC = 0,432 ;  GACn = 0,657 → GEÇER
İkili anlaşmazlık (kümelemesiz köprü puanı):
  onaylayanlar(c) = {i : oy_i(c) = +1}
  d(i,j) = diğer maddelerden yalnızca birinin onayladığı maddelerin oranı (yalnızca ikisinin de oy verdiği maddelerde)
  PD(c) ∝ Σ_{i<j ∈ onaylayanlar(c)} d(i,j)
```

[49][58][74][81]. CCAI'de (K=2) fiilî kesim değeri GAC = 0,723 idi.

### 12.8 Community Notes matris çarpanlarına ayırma; küçük N için deterministik ALS

```
r̂_un = μ + i_u + i_n + f_u·f_n          (1 boyutlu)
L = ort (r − r̂)² + λ_i(ort i_u² + ort i_n² + μ²) + λ_f(ort f_u² + ort f_n²) ;  λ_i = 0,15 ; λ_f = 0,03
YARARLI  ⇔ ≥ 5 puan ∧ i_n ≥ 0,40 ∧ |f_n| < 0,50 ∧ her faktör işaretinden asgari net destek
YARARSIZ ⇔ (i_n ≤ −0,05 − 0,8|f_n| ∨ üstSınır(i_n) < −0,04) ∧ her işaretten ≥ 3 puan
Değerlendirici puanı = (s − 10h)/t ≥ 0,66 ve en az 10 puan ;  durum 2 haftada kilitlenir
Popülasyon örneklemi engeli: i_pop < i_n − 0,15 ∧ i_pop ≤ 0,3 → YARARLI durumu engellenir
QS-MF: r_ij = μ + α_i + ρ_i·β_j + γ_i·δ_j,  ρ_i ≥ 0
Deterministik ALS (20–500 kullanıcı; bizim uyarlamamız):
  öğe n güncellemesi: y = r_un − μ − i_u, x = f_u (n'yi puanlayanlar), k = puan sayısı, a = λ_i·M/N, b = λ_f·M/N
    [[k + a, Σx], [Σx, Σx² + b]] · [i_n, f_n]ᵀ = [Σy, Σxy]ᵀ   → 2×2 sistemi çöz
  kullanıcı güncellemesi simetrik (a = λ_i·M/U, b = λ_f·M/U) ;  μ = ort(r − i_u − i_n − f_u f_n)/(1 + λ_i)
  başlangıç: f_u = PCA'nın 1. bileşeni ;  dur: max|Δ| < 1e-7 veya 200 tur ;  çoğu değerlendiricide f_u < 0 olacak şekilde işareti çevir
  öğenin < 5 oyu veya kullanıcının < 10 oyu varsa → YETERSIZ_VERI
Sözde değerlendiricilerle güven aralığı: {i_u ∈ min,max} × {f_u ∈ min,0,max} × r ∈ {0,1} eklenir, yalnızca (i_n, f_n) yeniden çözülür → [alt, üst]
```

[63][64][65][69]

### 12.9 Eşzamanlı rıza, köprülü çoğunluk ve alarm zili

**Kuzey İrlanda ve Belçika kuralları** [104][103]:

```
PARALEL_RIZA:       toplam_evet/toplam > 0,5 ∧ ∀g: evet_g/n_g > 0,5
AĞIRLIKLI_ÇOĞUNLUK: toplam_evet/toplam ≥ 0,60 ∧ ∀g: evet_g/n_g ≥ 0,40
BELÇİKA md. 4:      ∀g: evet_g/oy_g > 0,5 ∧ mevcut_g/üye_g > 0,5 ∧ toplam_evet/toplam_oy ≥ 2/3
Forum uyarlaması (görüş kümeleri, düzeltilmiş): P_g = (1 + evet_g)/(2 + evet_g + hayır_g)
Önemli küme: kümelenen seçmenlerin ≥ %10'u ve ≥ 5 üye
Kümeleme ancak ≥ 15 uygun üye varken yapılır; tabanlar ancak ≥ 30 kümelenmiş üye varken uygulanır
```

**Köprülü Çoğunluk karar kuralı (bizim sentezimiz; Polis, Community Notes, Kuzey İrlanda ve Almanya md. 77'den):**

```
değerlendir(c), oylama kapanınca:
  if katılım < yeterSayı(kademe) or ∃ önemli g: oy_g(c) < 3
       → DAHA_FAZLA_OY (süre bir kez uzatılır; yorum yönlendirmesi eksik kümelere öncelik verir)
  if ontoloji ihlali → REDDEDILDI_KURAL (ihlal edilen madde atfıyla)
  çoğ   = evet/(evet+hayır) > eşik(kademe)          // T0: > 0,5 ; T1: ≥ 0,60 ; T2: her okumada ≥ 0,60
  köprü = T0: ∀ önemli g: P_g ≥ 0,30  ∨  GACn ≥ 0,45   (birkaç kümeleme tohumunun medyanı)
          T1/T2: ∀ önemli g: P_g ≥ 0,40
          kümelenmiş üye < 30 ise köprü yalnızca raporlanır, uygulanmaz; T1 eşiği 2/3'e çıkar
  jüri  = kurayla seçilen jürinin GACn değeri, tüm seçmenlerin GACn değerinden 0,15'ten fazla düşük değil
          (yalnızca jüri katılımı yeterliyse)
  if çoğ ∧ köprü ∧ jüri  → KABUL_ADAYI → ITIRAZ_PENCERESI
  if çoğ ∧ ¬(köprü ∧ jüri) → TARTISMALI → UZLASMA (7 gün: YZ uzlaşma taslakları, bilirkişi raporu, kura paneli)
       → YENIDEN_OYLAMA: (çoğ ∧ köprü) ∨ onay ≥ 2/3 → KABUL_ADAYI (azınlık raporu zorunlu olarak eklenir)
                         aksi hâlde → REDDEDILDI
  else → REDDEDILDI
Histerezis: Kabul edilmiş bir karar puanların kaymasıyla açılmaz; yalnızca aynı kuraldan geçen bir yürürlükten kaldırma önerisiyle açılır
Defter: {girdiMerkleKökü, algoritmaSürümü, parametreler, tohum, K, tüm puanlar, sonuç}
Küme anlık görüntüsü oylama AÇILIRKEN alınır ve özeti deftere yazılır (oylama sırasında kümeler oynanamasın diye)
```

**Alarm zili (askıya alıcı azınlık itirazı)** [103][98][123][133]:

```
geçerli itiraz ⇔ (önemli bir g kümesinde hayır oyu verenlerin ≥ %75'i imzalamış) ∨ (≥ 2 kümeden toplam N'nin ≥ %10'u imzalamış)
               ∧ g bu öneride hakkını daha önce kullanmamış
               ∧ her imzacının bütçesi var (30 günde en fazla 2 itiraz)
               ∧ ontolojideki bir fy:ItirazGerekcesi'ne atıf var
→ ASKIDA: 7 gün soğuma; bilirkişi raporu; her küme için YZ lehte/aleyhte haritası; kurayla seçilen arabulucu panel metni değiştirebilir
→ YENIDEN_OYLAMA: aşma eşiği = 0,60 (itiraz kümenin 2/3'ünden azınca imzalanmışsa) ; aksi hâlde 0,667 ; küme tabanları yeniden uygulanmaz
→ Bu öneri bundan sonra bir daha engellenemez. İtiraz kullanım istatistikleri küme bazında yayımlanır.
Lido tarzı kademeli alternatif: o = itiraz/E ; o ≥ 1/3 → 2/3 ile yeniden oylama ;
                                o ≥ 0,10 → zaman kilidi = 2 + (o − 0,10)/(1/3 − 0,10)·12 gün
```

**Kutuplaşma tetikleyicisi** [61][257]:

```
BC  = (çarpıklık² + 1) / (basıklık_fazlası + 3(n−1)²/((n−2)(n−3)))       // Sarle'ın iki tepelilik katsayısı
BC > 0,555 (5'li ölçekte) veya max_g |P_g − P_genel| > 0,35 → zorunlu müzakere turu
RWC = P_XX·P_YY − P_YX·P_XY      (yalnızca ≥ 50 seçmenli alanlarda raporlanır)
Caplin-Nalebuff: n boyutta gereken çoğunluk = 1 − (n/(n+1))^n → 1 − 1/e ≈ 0,632 (≈ %64)
```

### 12.10 Silme talebi (karartma) durum makinesi

Wikipedia, LiquidFeedback, Decidim, CONSUL, Citizen OS ve Loomio'nun sentezi; bizim tasarımımız [40][1][21][35][32]:

```
TALEP
  talep eden L3 doğrulanmış; kişi başına açık talep ≤ 3; günde ≤ 5 şikâyet
  gerekçe ∈ fy:SilmeGerekcesi = {kişisel veri, iftira, tehdit, korunan gruba nefret söylemi, spam, telif}
  "katılmıyorum" geçerli bir sınıf değildir
→ OTOMATIK_KONTROL
  SHACL gerekçeyi doğrular; YZ bir puan verir
  acil sınıflar (kişisel veri, tehdit) → KATLANMIŞ; kişisel veride "yine de göster" kapalı
→ YAZARA_BILDIRIM (24–72 sa)
  yazar içeriği düzeltebilir veya kendisi karartabilir; orijinal, denetçiler için şifreli olarak saklanır
→ BILIRKISI_GORUSU
  gerekçe karşılanıyor mu? Görüş yalnızca kişisel veri ve iftira gibi hukuki sınıflarda bağlayıcıdır
→ OYLAMA
  yeter sayı %30; onay ≥ 2/3 ∧ yazarın kendi kümesinde P_g ≥ 0,50
  sonuçlar kapanışa kadar gizli; seçmenler gerekçeyi, bilirkişi görüşünü ve yazarın cevabını görür
→ GIZLENDI
  yer tutucu: "[#id kararıyla gizlendi, gerekçe: X]"; orijinal şifreli kalır ve denetçi rolüne açıktır
  defter: orijinalin özeti + kararın özeti; yazar karartılamayan tek bir cevap ekleyebilir
  | KORUNDU (talep herkese açık olarak arşivlenir)
→ ITIRAZ (bir kez, soğuma süresinden sonra, bilirkişi paneline; yalnızca usul hatası veya yeni delil gerekçesiyle)
Hukuki hızlı yol: mahkeme veya KVKK kararı ya da bilirkişinin hukuka aykırılık tespiti → oylama yapılmaz, işlem kayda geçer
Fiziksel silme hiçbir zaman yapılmaz. Defter yalnızca özet tuttuğu için karartma zinciri bozmaz.
```

### 12.11 Vekâletin çözülmesi (isteğe bağlı modül)

LiquidFeedback, Kotsialou-Riley, Kahng ve arkadaşları ile Boldi ve arkadaşlarından [241][244][240][246]:

```
EKLE(u→v, kapsam s, sıra r): v = u ise, v uygun değilse veya s kapsamının grafında v ⇝ u yolu varsa reddet
OYLAMA KAPANIŞI (anlık görüntü alınır, özeti deftere yazılır):
  oy_verenler = doğrudan oy verenler (bu konu için verdikleri vekâletler askıya alınır)
  oy vermeyen her u için etkin liste: konu > alan > genel sırasıyla en özgül kapsamdaki, en çok 3 kişilik sıralı vekil listesi
  u'lar önce BFS derinliğine, sonra vekâlet tarihine göre deterministik olarak sıralanır
  her u için: ziyaret kümesiyle BFS, derinlik ≤ H
    ulaşılan ilk c ∈ oy_verenler için ağırlık(c) + α^derinlik ≤ TAVAN ise → u'yu c'ye ata
    uygun c yoksa → u'nun yedek oyu; o da yoksa → YONLENDIRILEMEDI (u'ya bildirilir)
  sayım = Σ_c ağırlık(c)·oy(c)
TAVAN: katı = ⌈√(ln N)⌉ (GreedyCap: C(n) ∈ ω(1) ∩ o(log n)) ; pratik = min(1 + 0,02·N, 50)
H = 3 ; α = 0,9    (bizim değerlerimiz)
Gini = Σ_iΣ_j |x_i − x_j| / (2n²·ort(x)) ; Gini 3 dönem üst üste artarsa uyarı verilir
Vekillerin oyları herkese açıktır (temsilci gibi); vekâlet vermeyen seçmenlerin oyları gizlidir
```

### 12.12 Sybil triyajı, uygunluk ve eşzamanlı oy tespiti

[231][232][222][238][239][255]

```
SybilRank:
  T0(v) = 1/|tohumlar| (v tohumsa, değilse 0)
  T_i(v) = Σ_{u∈N(v)} T_{i−1}(u)·w_uv / d_w(u) ;  W = ⌈log₂ n⌉ adım
  puan(v) = T_W(v) / d_w(v) ; artan sırala
  en alttaki %5 ve ≥ 2 "şüpheli" işareti almış hesaplar → inceleme kuyruğu
  tohum olmayan bir düğüm en fazla 4 tohum kenarından güven çekebilir (BrightID)
EigenTrust:
  c_ij = max(s_ij,0)/Σ_j max(s_ij,0) ;  t ← (1 − a)·Cᵀ·t + a·p ;  a = 0,15 ;  ‖Δt‖₁ < 1e-6 olunca dur
Uygunluk puanı (ağırlıklar bizim):
  E(v) = 6·kimlikGeçerli + 6·kimlikÖzetiTekil + 3·min(doğrulanmışKefil, 3)
       + 4·[sybilRankYüzdelik ≥ 20] + 1·[hesapYaşı ≥ 7 gün] − 10·[açıkİtiraz]
  oyVerebilir   = DOGRULANMIS ∧ E ≥ 20
  kefilOlabilir = oyVerebilir ∧ hesapYaşı ≥ 30 gün ∧ açıkKefalet < 5
Kefil durum makinesi (Proof of Humanity uyarlaması, parasız):
  KIMLIK_BEKLIYOR → KEFIL (2 doğrulanmış kefil; kefil başına ≤ 1 açık kefalet) → ITIRAZ_PENCERESI (72 sa)
  → DOGRULANMIS → (365 gün sonra) → YENILEME
  "kopya hesap" veya "gerçek kişi değil" itirazı onaylanırsa: ASKIYA_ALINDI ve kefillerin kefil olma hakkı 90 gün askıda
Eşzamanlı oy (lockstep) tespiti (SynchroTrap uyarlaması):
  iki eylem eşleşir ⇔ aynı nesne ∧ |t_i − t_j| ≤ Tsim (30–60 dk)
  Jaccard ≥ 0,8 ∧ ≥ 5 ortak eylem → çift kenar olur → bağlı bileşenler
  bileşen boyutu ≥ max(5, seçmenlerin %2'si) → eşleşen oylar GECICI olarak işaretlenir ve çıkar çatışması denetimli panele gider
  hiçbir oy silinmez
```

### 12.13 Defter: Tendermint, PBFT kontrol noktası, Merkle ağacı, imza, taahhüt-açıklama

[146][144][154][155][143]

```
N = 4 ; F = 1 ; Q = 2F + 1 = 3 ; ATLA = F + 1 = 2 ; önerici(h, r) = doğrulayıcılar[(h + r) mod N]
PROPOSAL(h,r,v,−1) ∧ adım = ÖNER:
  PREVOTE( geçerli(v) ∧ (kilitTur = −1 ∨ kilitDeğer = v) ? id(v) : nil )
PROPOSAL(h,r,v,vr) ∧ Q·PREVOTE(h,vr,id(v)) ∧ 0 ≤ vr < r:
  PREVOTE( geçerli(v) ∧ (kilitTur ≤ vr ∨ kilitDeğer = v) ? id(v) : nil )
PROPOSAL(h,r,v) ∧ Q·PREVOTE(h,r,id(v)) ∧ geçerli(v), ilk kez:
  adım = PREVOTE ise { kilitDeğer = v; kilitTur = r; PRECOMMIT(id(v)) } ; geçerliDeğer = v ; geçerliTur = r
Q·PREVOTE(h,r,nil): PRECOMMIT(nil)
PROPOSAL(h,r',v) ∧ Q·PRECOMMIT(h,r',id(v)) ∧ karar[h] boş:
  kalıcılaştır(v, işlemSertifikası = 3 imza) ; h++ ; kilitleri sıfırla ; StartRound(0)
ATLA sayıda daha yüksek tur mesajı gelirse → o tura atla
Zaman aşımları: öneri 3000 + 500r ms ; prevote/precommit 1000 + 500r ms ; commit 1000 ms
Kanıt: aynı (h, r, tür) için farklı id taşıyan iki imzalı oy → EVIDENCE işlemi
Blok: {yükseklik, tur, öncekiÖzet, zaman, önerici, txKök, durumKök, sonİşlem[3 imza], işlemler[]}
PBFT: prepared = PRE-PREPARE + 2f PREPARE ; committed = prepared + 2f+1 COMMIT
      2f+1 eşleşen CHECKPOINT → kararlı kontrol noktası (örneğin her 100 blokta)
RFC 6962 Merkle: MTH({}) = SHA-256() ; MTH({d0}) = SHA-256(0x00 ‖ d0)
                 MTH(D[n]) = SHA-256(0x01 ‖ MTH(D[0:k]) ‖ MTH(D[k:n])),  k = n'den küçük en büyük 2'nin kuvveti
Ed25519: tx = kanonikJSON({tür, zincirId, nonce, yük, pk}) ; imza = Ed25519.sign(sk, SHA-256(tx)) ; nonce = hesap.nonce + 1
Taahhüt-açıklama: c = SHA-256(öneriId ‖ seçim ‖ tuz32 ‖ seçmenPk) ; yeni taahhüt öncekinin yerine geçer (oy değiştirme)
  AÇIKLA geçerli ⇔ SHA-256(öneriId ‖ seçim ‖ tuz ‖ pk) = sonTaahhüt[pk]
  açıklanmayan taahhüt yalnızca katılıma sayılır ; tüm yükler sabit boyuta doldurulur
Makbuz: {txÖzeti, yükseklik, Merkle yolu, başlık, 3 precommit imzası} → istemci, genesis anahtarlarıyla doğrular
İleri seviye (isteğe bağlı): üstel ElGamal (a,b) = (g^r, g^m·y^r), 4 doğrulayıcıdan 3'ünün paylarıyla homomorfik sayım
```

Deftere yazılacak işlem türleri:

- Üyelik ve anahtarlar: REGISTER_MEMBER (yalnızca açık anahtar ve tuzlu doğrulama), ROTATE_KEY, REVOKE_KEY.
- Öneriler: CREATE_PROPOSAL{track, parentId?, contentHash}, AMEND{targetId, diffHash}, SPONSOR.
- Oylama ve itiraz: COMMIT_VOTE, REVEAL_VOTE, OBJECTION{proposalId, ontologyRuleId}, TALLY (durum makinesi deterministik olarak üretir).
- Tartışma: POST{topicId, contentHash}, REDACTION_REQUEST, REDACT.
- Bilirkişi, YZ ve ontoloji: EXPERT_OPINION (bilirkişi rolüyle imzalı, raporun özeti), AI_ANALYSIS{model, promptHash, outputHash}, ONTOLOGY_VERSION{ttlHash}.
- Yönetim: PARAM_CHANGE, EVIDENCE.

### 12.14 Bilirkişi seçimi, süreç ve performans

[202][204][208][210][216][219][227][161]

```
uygun(e, konu) := e.durum = AKTIF ∧ e.belgeBitiş > şimdi ∧ ontoloji.kapsar(e.alanlar, konu.gerekliAlan)
               ∧ e.gecikmişRapor = 0 ∧ e.aktifGörev < AYLIK_TAVAN (3) ∧ ¬kesinÇatışma(e, konu)
kesinÇatışma := e öneri sahiplerinden biri ∨ akrabalık ≤ 3. derece ∨ eş/nişanlı ∨ aynı hane
             ∨ son 3 yılda paydaş kurumla iş ilişkisi veya istihdam ∨ (kamu görevlisi ∧ kendi kurumu etkileniyor)
             ∨ konu süresince danışmanlık ∨ önceki panelde yer almış ∨ kendi beyanı
yumuşakÇatışma = min(1, [d=1]·1 + [d=2]·0,5 + 0,3·Jaccard(herkese açık onayları))   (d = işbirliği grafında en kısa yol)
Kura:
  E = uygun bilirkişiler ; |E| < ⌈k/q_max⌉ ise üst uzmanlık alanına genişlet
  hâlâ yetersizse → oylama BILIRKISI_YOK işaretiyle devam eder
  w_e = sınırla(R_e, 0,5, 1,5) · 1/(1 + aktifGörev_e) · (1 − yumuşakÇatışma_e)
  p = suDoldurma(w, k, q_max)           // p_e = min(q_max, c·w_e), Σp = k
  tohum = SHA-256(drand(r).rastgelelik ‖ blokÖzeti(h) ‖ konuId ‖ tur)
          // r en az 10 dk sonraki drand turu, h = mevcut yükseklik + 20; ikisi de önceden deftere taahhüt edilir
  sıralama = SHA-256(tohum ‖ e.id)'ye göre ; u = birimAralık(SHA-256(tohum ‖ 'u')) ; Madow sistematik örneklemesi
  çeşitlilik: iki panelist aynı işverenden veya aynı topluluktan çıkarsa tohum ‖ deneme ile yeniden çek (en fazla 5 kez)
  k = 3 (tek sayı, HMK 267), q_max = 0,5 ; temyizde 3 → 7 → 15
  drand'e erişilemezse yalnızca blok özeti kullanılır ve kayda zayifRastgelelik işareti düşülür
Süreç:
  SORU_ÇERÇEVESİ (48 sa; azınlık bloğu en az 2 soru ekleyebilir) → ÇEKİLİŞ → BEYAN (48 sa) → İNCELEME (7 + 7 gün)
  → DELPHI (en fazla 3 tur × 48 sa; 1. turda taahhüt-açıklama;
            uzlaşı = yanıtların ≥ %75'i medyanın ±1 içinde veya 9'luk ölçekte IQR ≤ 1)
  → RAPOR → İTİRAZ/RET (7 gün; bilirkişi olmayan, kurayla seçilmiş 5 kişilik jüri karar verir)
            ∥ KARŞI UZMANLIK (72 sa içinde; 2k+1 kişilik yeni panel)
  → OYLAMA → PERFORMANS DEĞERLENDİRMESİ (15 gün içinde)
Askıya alıcı bayrak: panelin ≥ 2/3'ü "olgusal öncül yanlış" veya "teknik olarak imkânsız" der ve medyan güven ≥ 0,8 ise
  → 7 günlük yeniden değerlendirme ; öneri sahibi metni değiştirebilir ; oylama eşiği varsayılan olarak değişmez
Performans: S = Σ puan_c · geçti_c (8 ölçüt, 100 puan) ; R' = 0,8·R + 0,2·S/100 (başlangıç R = 0,75)
  çözülebilir tahminler: B = 100·(log₂ p_o + 1), p_o ∈ [0,001; 0,999] ;  ≥ 5 çözülmüş iddia varsa R += 0,1·(F/100 − R)
  R < 0,60 → uyarı ; R < 0,50 veya 12 ayda 2 mazeretsiz gecikme → en fazla 1 yıl askı
  beyan edilmemiş çatışma veya sahtecilik → listeden çıkarma
  bilirkişi her durumda yazılı savunma hakkına (7 gün) ve 30 gün içinde itiraz hakkına sahiptir
```

### 12.15 Ontoloji denetimi (T-box, kurallar, şekiller, birleştirme, çatışma)

[164][166][168][171][176][121][198]

```turtle
@prefix fy:  <https://forum.example.org/ont#> .
@prefix ym:  <https://forum.example.org/yonetmelik#> .
@prefix eli: <http://data.europa.eu/eli/ontology#> .
fy:AltKonuOnerisi rdfs:subClassOf fy:KonuOnerisi .  fy:KonuOnerisi rdfs:subClassOf fy:Oneri .
fy:DuzenlemeTeklifi rdfs:subClassOf fy:Oneri .     fy:SilmeTalebi rdfs:subClassOf fy:Oneri .
fy:YonetmelikDegisikligi rdfs:subClassOf fy:Oneri . fy:KorumaKaldirmaOnerisi rdfs:subClassOf fy:YonetmelikDegisikligi .
fy:IlacPolitikasi rdfs:subClassOf fy:Saglik .       fy:Saglik rdfs:subClassOf fy:Kategori .
fy:Kural rdfs:subClassOf eli:LegalResourceSubdivision .
fy:hedefMadde rdfs:subPropertyOf eli:changes .
ym:art_1 a fy:Madde ; fy:koruma fy:Degistirilemez ; fy:priority 100 ;
    fy:protects fy:IfadeOzgurlugu , fy:EsitMuamele , fy:Mahremiyet .
ym:art_2 a fy:Madde ; fy:koruma fy:Degistirilemez ; fy:priority 100 .      # kendini de koruyan koruma maddesi
ym:art_3__para_2 a fy:Fikra , fy:UsulKurali ; fy:appliesTo fy:SilmeTalebi ;
    fy:quorum 0.30 ; fy:threshold 0.667 ; fy:minDeliberationHours 168 ; fy:koruma fy:Nitelikli .
ym:art_5 a fy:Madde , fy:UsulKurali ; fy:appliesTo fy:HakEtkileyenOneri ;
    fy:quorum 0.30 ; fy:threshold 0.60 ; fy:clusterFloor 0.40 ; fy:requiresExpert true ; fy:priority 90 .
```

N3 kuralları (yalnızca temel graf deseni; N3.js Reasoner):

```
{ ?c1 rdfs:subClassOf ?c2 . ?c2 rdfs:subClassOf ?c3 } => { ?c1 rdfs:subClassOf ?c3 } .
{ ?c1 rdfs:subClassOf ?c2 . ?x a ?c1 } => { ?x a ?c2 } .
{ ?p1 rdfs:subPropertyOf ?p2 . ?x ?p1 ?y } => { ?x ?p2 ?y } .
{ ?o fy:affectsRight ?h } => { ?o a fy:HakEtkileyenOneri } .
{ ?o fy:hedefMadde ?m . ?m fy:koruma fy:Degistirilemez } => { ?o a fy:DegistirilemezMaddeyiHedefleyen } .
{ ?k fy:appliesTo ?C . ?o a ?C . ?o a fy:Oneri } => { ?o fy:applicableRule ?k } .
{ ?o fy:applicableRule ?k . ?k fy:requiresExpert true } => { ?o a fy:BilirkisiGerektiren } .
{ ?y a fy:Yasak . ?y fy:prohibits ?C . ?o fy:icerikEtiketi ?C } => { ?o fy:ihlalEder ?y } .
```

SHACL şekilleri (örnek):

```turtle
fy:DegistirilemezShape a sh:NodeShape ; sh:targetClass fy:DegistirilemezMaddeyiHedefleyen ;
  sh:property [ sh:path fy:hedefMadde ; sh:maxCount 0 ; sh:severity sh:Violation ;
                sh:message "Madde 2: Değiştirilemez bir maddeyi hedefleyen öneri oylamaya sunulamaz." ] .
fy:GizlemeShape a sh:NodeShape ; sh:targetClass fy:GizlenmisParca ;
  sh:property [ sh:path fy:gizlemeKarari ; sh:minCount 1 ; sh:class fy:KabulEdilmisSilmeTalebi ] .
fy:TartismaShape a sh:NodeShape ; sh:targetClass fy:TartismaParcasi ;
  sh:property [ sh:path fy:icerikHash ; sh:minCount 1 ; sh:maxCount 1 ; sh:pattern "^[0-9a-f]{64}$" ] .
```

Birleştirme, çatışma çözümü ve zaman:

```
etkin = {yeterSayı: 0, eşik: 0,5, minMüzakereSaat: 0, bilirkişi: false, alanlar: ∅, kaynaklar: []}
uygulanabilir olan ve t_açılış anında yürürlükte bulunan her k kuralı için:
  yeterSayı, eşik, süre = max(...) ; bilirkişi ||= k.bilirkişi ; alanlar ∪= k.alanlar ; kaynaklar += k.eId
  ("en koruyucu kural kazanır": düşük öncelikli bir kural ancak sıkılaştırabilir, gevşetemez)
çatışmaÇöz(a, b):
  açık overrides → üst norm (öncelik/kademe) → özel norm (appliesTo'nun alt sınıf derinliği)
  → sonraki norm (aynı kademede yürürlük tarihi) → YASAKLA ve bilirkişiye gönder
overrides grafında döngü oluşturan yönetmelik değişikliği reddedilir
yürürlükte(k, t) = k.başlangıç ≤ t ∧ (k.bitiş yok ∨ k.bitiş > t)     // t = oylamanın açıldığı an (tempus regit actum)
Yönetmelik değişikliği kabul edilince:
  yeniİfade = yama(eskiİfade)
  meta-şekiller çalıştırılır: 0 < yeterSayı ≤ 1 ; 0,5 ≤ eşik ≤ 1 ; overrides döngüsüz ; Olağan bir kural Nitelikli tabanı düşüremez
  özet = SHA-256(RDFC-1.0(yeniİfade)) → defter {tür: BYLAW_VERSION, özet, önceki, oyId}
  açık oylamalar eski ifadeyle sonuçlanır
YZ etiketleri yalnızca yükseltme yönünde çalışır:
  hak etkisi bayrağını herkes ekleyebilir, kaldırmak bilirkişi kararı ister
  YZ güveni ≥ 0,7 → etiket kabul edilir ; [0,4; 0,7) → BilirkisiGerektiren
```

### 12.16 Kişisel veri: TCKN, alan şifreleme, kör indeks, anahtar imhası

[282][283][284][286][287]

```ts
function isValidTCKN(s: string): boolean {
  s = s.replace(/\D/g, '');
  if (!/^[1-9]\d{10}$/.test(s)) return false;          // 11 hane, ilk hane 0 değil
  const d = [...s].map(Number);
  const tek  = d[0] + d[2] + d[4] + d[6] + d[8];         // 1., 3., 5., 7., 9. haneler
  const cift = d[1] + d[3] + d[5] + d[7];                // 2., 4., 6., 8. haneler
  if ((tek * 7 + cift * 9) % 10 !== d[9]) return false;   // (7·tek − çift) mod 10 ile aynı; negatif mod sorunu yok
  return d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
}
// AES-256-GCM: anahtar = HKDF-SHA256(ANA_ANAHTAR, `forum:enc:${alan}:v${sürüm}`), IV = 12 rastgele bayt,
//   AAD = `${tablo}|${alan}|${satırId}|v${sürüm}` (şifreli metnin satırlar arasında yer değiştirmesini önler), etiket 16 bayt
// Kör indeks: HMAC-SHA256(HKDF(ANA_ANAHTAR, `forum:bidx:${alan}`), normalize(değer)); tam uzunlukta ve UNIQUE
//   normalize: TCKN ve telefon için yalnızca rakamlar; ad için NFKC + trim + toLocaleLowerCase('tr-TR')
// Anahtar imhası: kullanıcı başına rastgele bir veri anahtarı (DEK), ana anahtarla sarılı; silme = sarılı DEK'i silmek
// Ana anahtar asla veritabanında, git deposunda veya günlüklerde tutulmaz
```

### 12.17 Yapay zekâ: moderasyon triyajı, özet ve insan sıralamasıyla Schulze

[266][267][82][52][268][75]

```
Aşama 0 (kurallar, çevrimdışı): hız sınırı, bağlantı spamı;
  kişisel veri (TCKN, IBAN, telefon, e-posta) bulunursa yayından ÖNCE yazara düzeltme önerilir
Aşama 1 (YZ, kullanıcının rızasına bağlı): yapılandırılmış çıktı {risk: 0..3, maddeIdleri[], aralıklar[{başlangıç, bitiş, alıntı}], gerekçe}
  model reddederse veya hata olursa → risk = null (insana gider)
  alıntı metinle birebir aynı değilse veya madde ontolojide yoksa → risk = null
Aşama 2: risk 3 → KATLANMIŞ olarak yayımla + öncelikli insan kuyruğu (24 sa)
         risk 2 → yayımla + insan kuyruğu ;  risk 0–1 → yayımla
Aşama 3: insan karar verir: koru | karartma öner (→ silme oylaması) | hukuki kaldırma (kayda geçer)
  her işlem için bildirim {girdi, madde, tespit yöntemi, itirazUrl} ; itirazı ilk kararı vermeyen biri inceler
Aşama 4: haftalık denetim: kümeler arasında max/min işaretlenme oranı > 1,25 ise istem ve kararlar denetlenir
Defter: {tür: AI_CALL veya MOD_ADVICE, model, istemSürümü, SHA-256(girdi), SHA-256(çıktı), kararVeren}
Özet:
  iddia + alıntı çıkar → alıntıyı doğrula → e5 gömmesi ('query: ', ortalama havuzlama, normalize) → kümele
  → her küme için GIC_k = Π_g (a_g+1)/(n_g+2)
  → ORTAK ZEMİN (GIC ≥ τ) / TARTIŞMALI (gruplar arası yüksek varyans) / AZINLIK GÖRÜŞLERİ (geri kalan her küme)
  → her cümle [#girdiId] atfıyla biter ; tüm kümeler kapsanmalı (kapsama = 1,0)
  → her grubun çoğunluk olduğu en az bir küme özette yer almalı
  çevrimdışı mod: her kümenin en yüksek GIC'li 3 girdisi ve en merkezî girdisi birebir gösterilir
Düzenleme metni:
  YZ 4–8 uzlaşma taslağı yazar; asıl insan metni de aday listesine eklenir → insanlar sıralar → Schulze seçer
  → kazanan normal bağlayıcı oylamaya gider
KVKK sarmalayıcısı:
  yalnızca rıza vermiş yazarların girdileri gönderilir ; takma adlar istek başına K1, K2… ile değiştirilir ; kişisel veri maskelenir
  yurt dışına aktarım için hukuki dayanak yoksa çevrimdışı yol kullanılır
```

**Eşit Paylar Yöntemi ve kuadratik oy (isteğe bağlı modüller)** [115][120][118]:

```
MES: b_i = B/N
  döngü: her p için Σ_{i∈S_p} b_i ≥ maliyet(p) ise p karşılanabilir
         Σ_{i∈S_p} min(b_i, ρ) = maliyet(p) eşitliğini en küçük ρ ile sağlayan p seçilir ; b_i −= min(b_i, ρ)
QV: kişi başına ayda B = 100 kredi ; v oy = v² kredi ; ham öncelik = Σ v
  ikili indirim: k_ij = M / (M + Σ_p √(c_ip)·√(c_jp)) ; puan(p) = Σ_i c_ip + Σ_{i≠j} k_ij·√(c_ip)·√(c_jp)
```

---

## 13. Gereksinimlerden Tasarıma: Önerilen Sentez

### 13.1 Gereksinim ve çözüm eşlemesi

| Gereksinim | Tasarım kararı | Dayanak |
|---|---|---|
| 1. Herkes konu açabilir; düzenleme teklifi | Eş-sponsor kapısı. Emendation: yazar kabul ederse yeni sürüm olur ve teklif sahibine atfedilir; reddederse veya T süresinde cevap vermezse teklif rakip alternatife yükseltilir. LiquidFeedback tarzı öneri derecelendirme. Dondurma evresinde ve N destekten sonra metin kilidi | Decidim [8], LiquidFeedback [1], CONSUL [25], Birleşik Krallık dilekçeleri [47] |
| 2. Kabul için çoğunluk | Statükolu Schulze; evet/(evet+hayır) > 1/2; katılım yeter sayısı; köprülü çoğunluk | [1][109][111][49] |
| 3. Kimlik + takma ad | Şifreli kimlik kasası; TCKN için kör indeks (UNIQUE); L1/L2/L3 doğrulama seviyeleri; kefil durum makinesi; herkese yalnızca takma ad görünür | CONSUL [26], Decidim [14], Proof of Humanity [238], CipherSweet [284] |
| 4. Oylamaya giren konu kabul edilirse resmî konu olur | Politika tablosuyla yönetilen durum makinesi (Bölüm 12.1) | LiquidFeedback, Compound, OpenGov |
| 5. Alt konular | `parentId`; ebeveyn kabul edilmeden alt konu açılmaz; politika kalıtımı; CONLEVEL denetimi | [1][42] |
| 6. Ontoloji denetimi | N3 + SHACL + TypeScript; ELI; kademeler; en koruyucu kuralın kazanması; değiştirilemez çekirdek | [164]–[201] |
| 7. Tartışmalar silinmez | Yalnızca ekleme yapılan girdiler; sürüm geçmişi; deftere bağlı özet zinciri; IBIS/argüman grafı | Wikipedia [40], Decidim [21], Kialo [39], Deliberatorium [89] |
| 8. Silme oylaması | Karartma durum makinesi (Bölüm 12.10) | Wikipedia, Citizen OS, Loomio |
| Çoğunluk tiranlığı | 10 katmanlı savunma (Bölüm 11.4) | Bölüm 11 |
| Android + web | React + TypeScript + Capacitor 8 | [288]–[294] |
| Dağıtık defter | Tendermint tarzı 4 doğrulayıcı; yalnızca özetler | [146][154][279] |
| Bilirkişi | Kurayla seçim; danışma niteliğinde görüş; askıya alıcı bayrak; karşı uzmanlık | [202]–[230] |
| Yapay zekâ | Yalnızca danışman; etiketli; çevrimdışı yedek | [259]–[271][280] |
| İnsan grafı | SQLite + graphology; görüş kümeleri, Sybil triyajı, çıkar çatışması, vekâlet | [231]–[258] |

### 13.2 Önerilen başlangıç parametreleri

Değerler ödev ölçeği içindir (N ≈ 30–500). Hepsi ayarlanabilir; kendileri de T2 (yönetmelik) kademesinde değiştirilebilen parametrelerdir. Demoda süreler dakikaya ölçeklenebilir.

| Parametre | Değer | Kaynak / not |
|---|---|---|
| Eş-sponsor sayısı | K = min(5, ⌈√N/2⌉), en az 2 | Debian [111]; Birleşik Krallık'ta 5 [47] |
| Kabul yeter sayısı Q1 | Referans nüfusun %10'u (küçük sınıfta daha düşük) + Issue Limiter | LiquidFeedback [1][4] |
| Q2 | Memnun destekçilerin %10'u | LiquidFeedback [1] |
| Süreler | Kabul ≤ 7 gün; tartışma 3–7 gün; dondurma 24 sa–3 gün; oylama 3–7 gün + 24 sa açıklama; onay penceresi 12–24 sa; sessiz bitiş 12 sa × 3; itiraz/yürürlük gecikmesi 72 sa; soğuma 7 gün | LiquidFeedback'in 4/8/4/4 haftası ölçeklendi [1]; OpenGov [125]; Compound [136] |
| Katılım yeter sayısı | T0 %20; T1 %30; silme %30; T2 %50; küçük N için Debian 3Q tabanı; isteğe bağlı EMA [0,20; 0,60] | Tasarım önerisi; [111][140] |
| T0 olağan konu | evet/(evet+hayır) > %50 + köprü (önemli her kümede P_g ≥ 0,30 veya GACn ≥ 0,45) | Tasarım önerisi; [49] |
| T1 hak etkileyen konu / kabul edilmiş konunun değiştirilmesi | Onay ≥ %60 ve önemli her kümede P_g ≥ 0,40 | Kuzey İrlanda [104] |
| T2 yönetmelik değişikliği | En az 7 gün arayla iki okuma, her biri ≥ %60. Son okuma ≥ 2/3 ise doğrudan kabul; %60 ile 2/3 arasındaysa tüm üyelerin onay oylaması | Anayasa md. 175 [101]; Caplin-Nalebuff [110] |
| T3 değiştirilemez madde | Kabul aşamasında reddedilir | Anayasa md. 4 [100] |
| Koruma kaldırma önerisi | ≥ %90 ve iki okuma; koruma maddesinin kendisi kaldırılamaz | Nomic [121] |
| Silme (karartma) | Onay ≥ 2/3; yazarın kendi kümesinde P_g ≥ 0,50; yeter sayı %30; yazara bildirim 24–72 sa; bir kez itiraz | Tasarım önerisi; [40] |
| TARTIŞMALI sonrası aşma eşiği | ≥ 2/3 ve azınlık raporu | Almanya md. 77 [98] |
| Alarm zili | Kümenin hayır oyu verenlerinin %75'i veya ≥ 2 kümeden N'nin ≥ %10'u; küme başına öneri başına 1 kez; kişi başına 30 günde 2; aşma eşiği %60 veya %66,7 | Belçika md. 54 [103]; tasarım önerisi |
| Kümeleme | ≥ 7 oy; ≥ 15 uygun üye; K 2..5; 4 turluk kararlılık; önemli küme ≥ %10 ve ≥ 5 üye; tabanlar ≥ 30 kümelenmiş üyede; küme başına ≥ 3 oy | Polis [49][56]; tasarım önerisi |
| Kura jürisi sapması | GACn farkı > 0,15 → TARTISMALI | Community Notes [63] |
| MF | ≥ 5 / ≥ 10 oy; λ_i 0,15; λ_f 0,03; eşikler 0,40 / 0,50 | [63] |
| Defter | 4 doğrulayıcı; f = 1; yeter sayı 3; öneri 3 sn, ön oy ve ön işleme 1 sn (+0,5 sn/tur); kontrol noktası her 100 blok | [146][148][144] |
| Bilirkişi | k = 3; q_max 0,5; ağırlık [0,5; 1,5]; aylık tavan 3; drand ≥ 10 dk; h + 20; beyan 48 sa; inceleme 7 + 7 gün; Delphi ≤ 3 × 48 sa; itiraz 7 gün; karşı uzmanlık 72 sa; λ 0,8; R0 0,75 | [204][208][216]; tasarım önerisi |
| Sybil | SybilRank W = ⌈log₂ n⌉, en alttaki %5 incelenir; 2 kefil; 72 sa itiraz; 365 gün geçerlilik; uygunluk eşiği 20 | [231][238][239] |
| Vekâlet (isteğe bağlı) | ≤ 3 sıralı vekil; H = 3; α = 0,9; tavan ⌈√(ln N)⌉ veya min(1 + 0,02N, 50) | [240][246][244] |
| Eşzamanlı oy tespiti | Tsim 30–60 dk; Jaccard ≥ 0,8; ≥ 5 ortak eylem; bileşen ≥ max(5, %2) | SynchroTrap [255] |
| Kura paneli | 12–24 kişi; küme, yaş bandı ve bölgeye göre katmanlı | İrlanda [112]; LEXIMIN [113] |
| QV / MES (isteğe bağlı) | Ayda 100 kredi; haftada 5 gündem slotu | Colorado [118]; MES [115] |
| KVKK | Başvuru 30 gün; ihlal 72 sa; periyodik imha ≤ 6 ay; silme kayıtları ≥ 3 yıl | [272][273][276] |
| YZ | Risk 0–3; insan inceleme süresi 24 sa; eşitsizlik oranı 1,25; güven 0,7 / 0,4; e5 eşikleri kalibre edilir | [266][268]; tasarım önerisi |

### 13.3 Demo için öneriler

- **Simüle üyeler:** Köprü ve küme tabanları ancak ≥ 30 kümelenmiş üyede devreye girer. Bu yüzden demoya en az 40 simüle üye ve 2–3 görüş bloğu (örneğin %60/%30/%10) yüklenmelidir.
- **Bilirkişi havuzu:** Her uzmanlık alanında en az 6 bilirkişi olmalıdır; k = 3 ve q_max = 0,5 olduğu için gereken sayı ⌈k/q_max⌉ = 6'dır.
- **Simülasyon düzeneği:** BrightID-AntiSybil benzeri bir düzenek [232] şunları rapor etmelidir:
  - SybilRank'in kesinlik ve duyarlılığı;
  - saldırı kenarı başına kabul edilen sahte hesap;
  - köprü kuralının yalnızca çoğunluğa dayanan önerileri hangi oranda durdurduğu;
  - 3–5 hesaplık koordineli bir bloğun sonucu değiştirip değiştiremediği.

---

## 14. Riskler ve Açık Sorunlar

### 14.1 Karar algoritması ve azınlık koruması

1. **Otomatik gizleme bir susturma aracına dönüşebilir.** Decidim'in varsayılan "3 şikâyette gizle" ayarı, bir grubun azınlık konuşmasını herhangi bir insan veya oylama bakmadan susturmasına izin verir [11]. Otomatik katlama yalnızca kişisel veri ve tehdit kategorilerinde yapılmalıdır.
2. **Nitelikli çoğunluk azınlık koruması değildir** [1]. Profesöre yalnızca yönetmeliğin istikrarını koruyan bir araç olarak sunulmalıdır.
3. **Mutlak veya yüksek eşikler hiçbir şeyin geçmemesine yol açar** (Decide Madrid'de yalnızca 2 öneri eşiğe ulaştı [29]). Eşik çok düşükse de gündem dolar. Çözüm: aktif katılımcılara göre göreli yeter sayı ve Issue Limiter.
4. **Popülerliğe göre sıralama Matthew etkisi yaratır.** Çözüm: Harmonic Weighting ve köprü önceliğiyle sıralama.
5. **Son anda metni değiştirme hilesi** (bait-and-switch). Çözüm: dondurma evresi ve belli destekten sonra düzenleme kilidi.
6. **Küçük N'de istatistiksel gürültü.** 20–50 kullanıcıda 3–5 kişilik bir küme P_g'yi oy başına 0,1–0,2 oynatır. Laplace düzeltmesi küçük kümeleri 0,5'e çeker. Önlemler: önemli küme alt sınırı, küme başına asgari oy, sözde değerlendirici ve bootstrap güven aralıkları, 30 üyenin altında tabanların kapatılması.
7. **Kümelerin manipüle edilmesi.** Koordineli hesaplar sahte bir "azınlık kümesi" oluşturup köprü kuralıyla önerileri engelleyebilir veya bir kümeyi doldurabilir [67]. Önlemler:
   - yalnızca doğrulanmış ve uygun üyelerin kümelenmesi;
   - asgari hesap yaşı;
   - oylama açılırken alınan dondurulmuş küme anlık görüntüsü;
   - birkaç kümeleme tohumunun medyanı;
   - ikili anlaşmazlık puanıyla çapraz kontrol.
8. **Azınlık vetosunun kötüye kullanılması** (liberum veto; Kuzey İrlanda'da 159 dilekçe). Her azınlık yetkisi askıya alıcı, tek kullanımlık, bütçeli, süreli ve aşılabilir kalmalı; kullanımı yayımlanmalıdır.
9. **Statüko yanlılığı da baskıcı olabilir.** Statüko bir azınlığa zarar veriyorsa, katılım yanlılığı ve nitelikli çoğunluk o zararı korur. Önlemler: kümeler için garantili gündem slotu, katılım yanlılığına tavan ve hakları genişleten önerilerin T0'dan geçmesi.
10. **Kutuplaşmış konular hiç köprü kuramayabilir** [66]. Uzlaşma turu ve 2/3 ile aşma yolu bu yüzden zorunludur.
11. **Condorcet döngüleri ve kararsız sonuçlar.** Önlemler: "ters yenme yolu olmama" kontrolü ve belgelenmiş beraberlik kuralları.
12. **Taktik oy tamamen önlenemez** (Gibbard–Satterthwaite teoremi). Sonuçları gizlemek bunu azaltır.
13. **Kimlikleri sertleştirme riski.** Kümeler öne çıkarılır ve onlara yetki verilirse üyeler stratejik olarak "taraf seçebilir" (Lijphart eleştirisi). Kümeler kimlik adlarıyla değil görüş haritası olarak gösterilmeli ve her dönem yeniden hesaplanmalıdır.
14. **Karar sonrası kayma.** Community Notes'ta gösterilen notların %30,2'si sonradan durumunu kaybetti [70]. Önlemler: sonucu kilitleme ve histerezis.
15. **Karmaşıklık meşruiyeti zedeleyebilir.** Önlem: her karar sayfasında bir kontrol listesi (yeter sayı, eşik, her kümenin P_g değeri, onay penceresi, itiraz durumu) ve sade dilde YZ açıklaması.

### 14.2 Kimlik, graf ve vekâlet

16. **Kopya hesaplar tüm adalet güvencelerini bozar** (yeter sayılar, Harmonic Weighting, Schulze, köprü). Kimlik doğrulama bir özellik değil, ön koşuldur. TCKN sağlama toplamı kimliği doğrulamaz; gerçek doğrulama NVİ/e-Devlet entegrasyonu veya yöneticinin kontrolü gerektirir.
17. **Graf algoritmalarının küçük graflardaki güvenilmezliği.** SybilRank ve SybilLimit'in güvenceleri büyük ve hızlı karışan grafları varsayar. Graf puanları yalnızca triyaj aracıdır.
18. **Az bağlantılı yeni üyelere karşı yanlış pozitifler.** Önlemler: manuel inceleme, itiraz penceresi ve oyların silinmeden "geçici" işaretlenmesi.
19. **Vekâlette güç yoğunlaşması.** Bkz. Kahng ve arkadaşlarının Teorem 1'i ve Korsan Partisi'nde artan Gini. Tavan ve sönüm bunu azaltır ama bir miktar oy ağırlığı kaybolur. Önlemler: deterministik ve yayımlanmış atama sırası; yönlendirilemeyen vekâlet sahiplerine bildirim.
20. **İkili benzerlik hesabı O(n²)'dir.** Birkaç bin seçmene kadar sorun değil; ötesinde yalnızca aynı nesnelere oy verenler karşılaştırılmalı veya kNN/LSH kullanılmalıdır.

### 14.3 Defter ve oylama güvenliği

21. **Tek operatör sorunu.** Dört doğrulayıcıyı tek bir öğrenci veya tek bir makine çalıştırıyorsa BFT güvencesi yalnızca görünüştedir. Bu raporda dürüstçe belirtilmelidir.
22. **Kilitleme kurallarındaki hatalar güvenliği bozar.** Önlemler: özellik tabanlı testler ve çift imza atan bir Bizans test düğümü.
23. **Doğrulayıcılar arasında belirlenimsizlik.** `Date.now()`, kayan nokta sayım, JSON anahtar sırası ve yerel ayara bağlı sıralama, doğrulayıcıların farklı durum kökleri üretmesine ve zincirin durmasına yol açar. Önlemler: kanonik JSON, tam sayı aritmetiği ve blok başlığındaki zaman.
24. **İstemci imzalamaz ve doğrulamazsa sunucu oyları değiştirebilir** (Voatz [158]).
25. **Kimliksizleştirmenin geri alınması.** Takma adlı anahtarlar zamanlama, sosyal graf veya küçük seçmen kitlesiyle birleşince kimin ne oy verdiği anlaşılabilir.
26. **Baskı ve oy satın alma uzaktan oylamada çözülemez** [156][159]. Oy değiştirme hakkı bunu yalnızca hafifletir; MACI tarzı makbuzsuzluk kapsam dışıdır.
27. **Taahhüt-açıklamada açıklanmayan oylar.** Tuzu kaybolan veya çevrimdışı kalan telefonların oyları çekimsere döner. Önlemler: otomatik açıklama, kullanıcı anahtarıyla şifrelenmiş tuz yedeği veya eşik şifreleme.
28. **Kayıp veya çalınmış Android anahtarı.** Anahtar değiştirmeyi kayıt yetkilisi yaptığı için yetkili merkezi bir güven noktasıdır. Her anahtar değişikliği deftere yazılmalı ve kullanıcıya bildirilmelidir.

### 14.4 Ontoloji

29. **Açık dünya varsayımı.** OWL'de eksik bir bilirkişi görüşü "ihlal" sayılmaz. Bu yüzden tüm uyum denetimleri SHACL veya kodla yapılmalıdır.
30. **N3.js Reasoner'ın sınırları.** Olumsuzlama, tarih ve aritmetik desteklenmez. Bunlar TypeScript'e (veya eyeling'e) taşınmazsa kurallar sessizce hiç çalışmaz.
31. **SHACL-AF ve SHACL 1.2 Rules'un JavaScript uygulaması yok.** Tasarım bunlara dayandırılmamalıdır.
32. **`sh:targetClass` yalnızca veri grafındaki alt sınıf ilişkilerini izler.** T-box doğrulanan veri kümesine eklenmezse alt sınıf hedefli şekiller örnekleri kaçırır.
33. **İki adımlı atlatma ve meta-yönetişim.** Koruma maddesi kendini korumazsa, önce koruma kaldırılıp sonra korunan madde değiştirilebilir. Override döngüleri ve tutarsız parametreler meta-şekillerle engellenmelidir.
34. **YZ etiketleme hataları.** Yanlış kategori veya eksik hak etiketi uygulanacak kuralları değiştirir. Önlemler: etiketlerin yalnızca yükseltme yönünde çalışması, kaldırmanın yalnızca bilirkişiye ait olması ve güven bantları.
35. **eyeling genç bir projedir.** Sürüm sabitlenmelidir.

### 14.5 Bilirkişi

36. **Küçük havuz.** Az sayıda uzman varsa q_max sağlanamaz ve aynı kişiler tekrar tekrar seçilir.
37. **Eksik çıkar çatışması verisi.** Akrabalık ve iş ilişkileri çoğunlukla beyana dayanır.
38. **Soru çerçevesi üzerinden teknokratik ele geçirme.** Soruları yazan cevapları da şekillendirir.
39. **Denetim mekanizmasının çoğunluk tarafından ele geçirilmesi.** Bilirkişi Kurulu çoğunluk oyuyla seçilirse, çoğunluk sevmediği uzmanları tasfiye edebilir. Önlemler: kurayla oluşturulan kurul ve içerik dokunulmazlığı.
40. **Bilirkişiyi geciktirme aracı olarak kullanmak.** Raporlar geciktirilerek oylama ertelenebilir. Önlemler: kesin süreler ve raporsuz devam eden oylama.
41. **Panelistlere baskı.** Önlem: kimlikler rapor teslim edilene kadar gizli tutulur [227].
42. **Hukuki kapsam.** 6754 sayılı Kanun mahkemelerin atadığı bilirkişileri düzenler. Platform yalnızca bu tasarımı ödünç alır; kendi uzmanlarını yasal olarak tanınmış bilirkişi gibi sunmamalıdır. HMK 34 ve 36'daki ret sebepleri doğrudan getirilemedi; kontrol edilmelidir.

### 14.6 Yapay zekâ ve mahremiyet

43. **Görüşe ve lehçeye dayalı önyargı** [261][263][264]. YZ hiçbir şeyi otomatik silmemeli; kümeler arası eşitsizlik denetlenmeli; itirazı ilk kararı vermeyen bir insan incelemelidir.
44. **Özetlerde azınlık görüşlerinin yassılaşması veya yanlış atfedilmesi** [77][82]. Önlemler: birebir alıntı doğrulaması, zorunlu atıf ve çıkarılamayan bir azınlık bölümü.
45. **Habermas tarzı arabuluculuk görüşleri çoğunluğa doğru iter** [75]. YZ taslağı asla insanın asıl metninin veya bağlayıcı oylamanın yerine geçmemelidir.
46. **Gömme eşiklerinin yanlış kullanımı.** e5 benzerlikleri 0,7–1,0 aralığında toplandığı için hazır eşikler neredeyse her şeyi kopya sayar.
47. **KVKK özel nitelikli veri riski.** En kötü senaryo, oy ile kimlik arasındaki bağın sızmasıdır. Kimlik kasası, anahtarlar ve forum verisi ayrı tutulmalı; 72 saatlik ihlal planı hazır olmalıdır [272][274].
48. **Rıza hataları.** Açık rızayı aydınlatma metniyle birleştirmek veya hizmeti rızaya bağlamak geçersizdir (2021/389) [275]. Gereğinden fazla veri toplamak (tam adres, TCKN'nin kendisi) minimizasyon ilkesini ihlal eder.
49. **Yurt dışına aktarım.** ABD'de barındırılan bir LLM API'sine forum metni göndermek md. 9 kapsamında bir aktarımdır. Varsayılan yol çevrimdışı olmalıdır.
50. **Değiştirilemez defter ile silme hakkının çatışması.** Kişisel veri veya düşük entropili verinin tuzsuz özeti zincire girerse silme imkânsızlaşır [279]. Ayrıca CNIL'in, anahtar imhasının silme sayılıp sayılmayacağı konusunda farklı görüşte olduğu bildirildi.
51. **Anahtar yönetimi.** Ana anahtar SQLite dosyasında, git deposunda veya günlüklerde durursa şifreleme ve kör indeksler koruma sağlamaz.
52. **Sağlayıcı ve model kayması.** Perspective API'nin kapanması, kiralanan ölçüm altyapısının yok olabileceğini gösteriyor. Çevrimdışı yedek çalışır durumda tutulmalı; model ve istem sürümleri kaydedilmelidir.
53. **Mobil ağ tuzakları.** `https://localhost` kökeni nedeniyle karışık içerik engellenir; API 28'den itibaren şifresiz trafik engellidir; 10.0.2.2 adresi yalnızca emülatörde çalışır; üretimde genel `usesCleartextTraffic` açık bırakmak bir güvenlik açığıdır.

### 14.7 Doğrulanamayan veya sürüme bağlı bilgiler

- LiquidFeedback `core.sql` dosyasına erişilemedi (404) [6]. Kleros'un teknik makalesine erişilemedi (404) [213]. Metaculus sayfaları 403 döndürdü [219]. Science makalesine erişilemedi (403) [75].
- Optimism'in veto eşiği (%20 veya %30) ve hangi meclisin hangi vetoya sahip olduğu sezondan sezona değişiyor [128][131]. Polkadot Gov1'in yerini OpenGov aldı. Bu sayılar güncel şartname değil, örnek olarak anılmalıdır.
- MolochDAO'nun 7 günlük tolerans süresi ikincil kaynaklardan alındı [132].
- Polkadot'un karekök formülü (Substrate) doğrulanmadı.
- Bilirkişi performans formundaki puan-ölçüt eşleşmesi, PDF'nin ham metninden yeniden kurulmuştur [205].
- Mevzuat Hazırlama Yönetmeliği'nin 2006 metni kullanıldı; güncel konsolide metin mevzuat.gov.tr'den kontrol edilmelidir [186].
- KVKK'nın 72 saatlik ihlal yorumu ikincil bir özetten alındı [276].
- Kialo'nun etki puanı ölçeği ve Decidim'in mobil uygulama durumu doğrulanmadı.

---

## 15. Kaynakça

Numaralar metindeki [n] atıflarıyla eşleşir. Kaynaklar konu gruplarına ayrılmıştır; numaralandırma gruplar boyunca kesintisiz devam eder.

### A. Katılımcı demokrasi ve müzakere platformları

- [1] The Principles of LiquidFeedback (Behrens, Kistner, Nitsche, Swierczek, 2014). https://liquidfeedback.com/pub/The_Principles_of_LiquidFeedback_1st_edition_online_version.pdf
- [2] LiquidFeedback – Wikipedia. https://en.wikipedia.org/wiki/LiquidFeedback
- [3] The evolution of proportional representation in LiquidFeedback (Liquid Democracy Journal, Issue 1). https://liquid-democracy-journal.org/issue/1/The_Liquid_Democracy_Journal-Issue001-04-The_evolution_of_proportional_representation_in_LiquidFeedback.html
- [4] LiquidFeedback's Issue Limiter (Liquid Democracy Journal, Issue 5). https://liquid-democracy-journal.org/issue/5/The_Liquid_Democracy_Journal-Issue005-04-LiquidFeedbacks_Issue_Limiter.html
- [5] Public Software Group – LiquidFeedback-Core. https://www.public-software-group.org/liquid_feedback_core
- [6] liquid_feedback_core core.sql (arama sonucunda görüldü; doğrudan erişim 404). https://www.public-software-group.org/mercurial/liquid_feedback_core/file/tip/core.sql
- [7] Voting Behaviour and Power in Online Democracy: LiquidFeedback in Germany's Pirate Party (arXiv 1503.07723, ar5iv). https://ar5iv.labs.arxiv.org/html/1503.07723
- [8] Decidim Docs – Amendments. https://docs.decidim.org/en/develop/admin/components/proposals/special_configurations/amendments.html
- [9] Decidim issue #2292 – Amendments: Proposals on proposals. https://github.com/decidim/decidim/issues/2292
- [10] Decidim Docs – Proposals component. https://docs.decidim.org/en/develop/admin/components/proposals.html
- [11] Decidim Docs – Initializer (max_reports_before_hiding vb.). https://docs.decidim.org/en/develop/configure/initializer.html
- [12] Decidim Docs – Reported content moderation. https://docs.decidim.org/en/develop/admin/moderations/reported_content
- [13] Decidim Docs – Global moderations. https://docs.decidim.org/en/admin/global_moderations
- [14] Decidim verifications README. https://github.com/decidim/decidim/blob/develop/decidim-verifications/README.md
- [15] Decidim Docs – Identity documents authorization. https://docs.decidim.org/en/develop/admin/participants/authorizations/identity_documents.html
- [16] Decidim Docs – Code by postal letter authorization. https://docs.decidim.org/en/develop/admin/participants/authorizations/code_postal_letter.html
- [17] Decidim Docs – Initiatives. https://docs.decidim.org/en/develop/admin/spaces/initiatives.html
- [18] Decidim Docs – Initiatives initializer. https://docs.decidim.org/en/develop/admin/initiatives_initializer.html
- [19] Decidim Docs – Process phases. https://docs.decidim.org/en/develop/admin/spaces/processes/phases.html
- [20] Decidim Docs – General description. https://docs.decidim.org/en/develop/features/general-description.html
- [21] Decidim issue #7908 – Delete my comment (soft delete). https://github.com/decidim/decidim/issues/7908
- [22] Decidim Docs – Proposal answers (EN). https://docs.decidim.org/en/develop/admin/components/proposals/answers
- [23] Decidim Docs – Proposal answers (DE). https://docs.decidim.org/de/develop/admin/components/proposals/answers
- [24] CONSUL DEMOCRACY Demo – Help. https://demo.consuldemocracy.org/help
- [25] CONSUL Democracy – setting.rb (varsayılanlar). https://raw.githubusercontent.com/consuldemocracy/consuldemocracy/master/app/models/setting.rb
- [26] CONSUL Democracy – verification.rb. https://raw.githubusercontent.com/consuldemocracy/consuldemocracy/master/app/models/concerns/verification.rb
- [27] CONSUL Democracy – comment.rb. https://raw.githubusercontent.com/consuldemocracy/consuldemocracy/master/app/models/comment.rb
- [28] CONSUL Docs – Administration interface. https://docs.consuldemocracy.org/docs_general/interfaces/administration
- [29] Interactive Discovery System for Direct Democracy (Decide Madrid analizi, arXiv 1807.04448). https://arxiv.org/html/1807.04448
- [30] Loomio – Consensus process. https://www.loomio.com/docs/en/guides/making_decisions/consensus_process
- [31] Loomio – Consent process. https://www.loomio.com/docs/en/guides/making_decisions/consent_process
- [32] Loomio – Poll settings. https://www.loomio.com/docs/en/user_manual/polls/settings
- [33] Loomio – Proposals. https://www.loomio.com/docs/en/user_manual/polls/proposals
- [34] Citizens Foundation – Better Reykjavik. https://www.citizens.is/portfolio_page/better_reykjavik/
- [35] Citizen OS – Platform. https://citizenos.com/platform/
- [36] DemocracyOS – Wikipedia. https://en.wikipedia.org/wiki/DemocracyOS
- [37] DemocracyOS – Participedia. https://participedia.net/method/democracyos
- [38] adhocracy+. https://adhocracy.plus/
- [39] Kialo – Wikipedia. https://en.wikipedia.org/wiki/Kialo
- [40] Wikipedia: Revision deletion. https://en.wikipedia.org/wiki/Wikipedia:Revision_deletion
- [41] Wikipedia: Oversight. https://en.wikipedia.org/wiki/Wikipedia:Oversight
- [42] Wikipedia: Consensus. https://en.wikipedia.org/wiki/Wikipedia:Consensus
- [43] Wikipedia: Polling is not a substitute for discussion. https://en.wikipedia.org/wiki/Wikipedia:Polling_is_not_a_substitute_for_discussion
- [44] Stack Overflow – Wikipedia. https://en.wikipedia.org/wiki/Stack_Overflow
- [45] OSQA minrep.py (Stack Exchange tarzı itibar eşikleri). https://git.openstreetmap.org/osqa.git/blob_plain/47bc0543a1d3f25ec90311883b4e28186a3ddd7e:/forum/settings/minrep.py
- [46] Reputation and Voting – Stack Internal support. https://support.stackenterprise.co/support/solutions/articles/22000294430-reputation-and-voting
- [47] UK Parliament Petitions – How petitions work. https://petition.parliament.uk/help
- [48] UK Parliament Petitions – Standards. https://petition.parliament.uk/help/standards

### B. Köprü kuran uzlaşı, görüş kümeleme ve YZ destekli müzakere

- [49] Small ve ark. 2021, Polis: Scaling Deliberation by Mapping High Dimensional Opinion Spaces (PDF). https://gwern.net/doc/sociology/2021-small.pdf
- [50] Polis makalesi, RECERCA dergi sayfası. https://www.e-revistes.uji.es/index.php/recerca/article/view/5516
- [51] Computational Democracy Project – Opinion groups. https://compdemocracy.org/opinion-groups/
- [52] Computational Democracy Project – Group informed consensus. https://compdemocracy.org/group-informed-consensus/
- [53] Computational Democracy Project – Algorithms. https://compdemocracy.org/algorithms/
- [54] Polis kaynak kodu: repness.clj. https://raw.githubusercontent.com/compdemocracy/polis/edge/math/src/polismath/math/repness.clj
- [55] Polis kaynak kodu: stats.clj. https://raw.githubusercontent.com/compdemocracy/polis/edge/math/src/polismath/math/stats.clj
- [56] Polis kaynak kodu: conversation.clj. https://raw.githubusercontent.com/compdemocracy/polis/edge/math/src/polismath/math/conversation.clj
- [57] Polis issue #2358: Non-Deterministic K-Means Clustering Due to Worker Restart. https://github.com/compdemocracy/polis/issues/2358
- [58] Red Dwarf: Polis benzeri boru hattının yeniden uygulaması. https://github.com/polis-community/red-dwarf
- [59] Opportunities and Risks of LLMs for Scalable Deliberation with Polis (arXiv 2306.11932). https://arxiv.org/html/2306.11932
- [60] Bridging Voting and Deliberation with Algorithms: vTaiwan and Kultur Komitee (arXiv 2502.05017, HTML). https://arxiv.org/html/2502.05017
- [61] Bridging Voting and Deliberation with Algorithms (arXiv 2502.05017, PDF). https://arxiv.org/pdf/2502.05017
- [62] vTaiwan – CrowdLaw for Congress vaka çalışması. https://congress.crowd.law/case-vtaiwan.html
- [63] Community Notes – Note ranking algorithm (ranking-notes.md). https://github.com/twitter/communitynotes/blob/main/documentation/under-the-hood/ranking-notes.md
- [64] Community Notes – Contributor helpfulness scores. https://github.com/twitter/communitynotes/blob/main/documentation/under-the-hood/contributor-scores.md
- [65] Community Notes matrix_factorization.py. https://raw.githubusercontent.com/twitter/communitynotes/main/scoring/src/scoring/matrix_factorization/matrix_factorization.py
- [66] Wojcik ve ark. 2022, Birdwatch: Crowd Wisdom and Bridging Algorithms. https://arxiv.org/pdf/2210.15723
- [67] Gaming Consensus: Coordinated Manipulation in Crowdsourced Fact-Checking (arXiv 2607.01824, HTML). https://arxiv.org/html/2607.01824
- [68] Selvam ve ark. 2026, Gaming Consensus (arXiv 2607.01824, PDF). https://arxiv.org/pdf/2607.01824
- [69] Quality-Sensitive Matrix Factorization for Community Notes. https://arxiv.org/html/2604.11224
- [70] Consensus Stability of Community Notes on X. https://arxiv.org/abs/2601.14002
- [71] Jonathan Warden, Understanding Community Notes and Bridging-Based Ranking. https://jonathanwarden.com/understanding-community-notes/
- [72] Ovadya ve Thorburn, Bridging Systems: Open Problems for Countering Destructive Divisiveness (arXiv). https://arxiv.org/abs/2301.09976
- [73] Bridging Systems (Knight First Amendment Institute). https://knightcolumbia.org/content/bridging-systems
- [74] Blair ve ark., The Structure of Bridging. https://www.cs.toronto.edu/~nisarg/papers/bridging.pdf
- [75] Tessler ve ark. 2024, AI can help humans find common ground in democratic deliberation (Science). https://www.science.org/doi/10.1126/science.adq2852
- [76] Habermas Machine makalesinin PDF kopyası. https://www.rivista.ai/wp-content/uploads/2024/10/science.adq2852.pdf
- [77] Can AI Mediation Improve Democratic Deliberation? (Knight Columbia). https://knightcolumbia.org/content/can-ai-mediation-improve-democratic-deliberation
- [78] The Habermas Machine: an AI mediator that beat humans at finding common ground (Designing Open Democracy). https://www.designingopendemocracy.com/blog/2026/08/16/the-habermas-machine-an-ai-mediator-that-beat-humans-at-finding-common-ground/
- [79] google-deepmind/habermas_machine (GitHub). https://github.com/google-deepmind/habermas_machine
- [80] Anthropic: Collective Constitutional AI. https://www.anthropic.com/news/collective-constitutional-ai-aligning-a-language-model-with-public-input
- [81] Collective Constitutional AI makalesi (arXiv 2406.07814). https://arxiv.org/html/2406.07814v1
- [82] Talk to the City: an open-source AI tool to scale deliberation (AOI). https://ai.objectives.institute/blog/talk-to-the-city-an-open-source-ai-tool-to-scale-deliberation
- [83] AIObjectives/talk-to-the-city-reports (GitHub). https://github.com/AIObjectives/talk-to-the-city-reports
- [84] Talk to the City clustering.py. https://github.com/AIObjectives/talk-to-the-city-reports/blob/main/scatter/pipeline/steps/clustering.py
- [85] AIObjectives/tttc-light-js (GitHub). https://github.com/AIObjectives/tttc-light-js
- [86] Jigsaw-Code/sensemaking-tools (GitHub). https://github.com/Jigsaw-Code/sensemaking-tools
- [87] Meta: Community Forums on AI. https://about.fb.com/news/2024/04/leading-the-way-in-governance-innovation-with-community-forums-on-ai/
- [88] Stanford FSI: Meta Community Forum Results Analysis (Nisan 2025). https://fsi.stanford.edu/publication/meta-community-forum-results-analysis-april-2025
- [89] The MIT Deliberatorium: Enabling Large-Scale Deliberation About Complex Systemic Problems. https://www.researchgate.net/publication/316655389_The_MIT_Deliberatorium_Enabling_Large-Scale_Deliberation_About_Complex_Systemic_Problems

### C. Çoğunluk tiranlığı: teori, anayasal ve kurumsal mekanizmalar

- [90] Federalist No. 51 – Bill of Rights Institute. https://billofrightsinstitute.org/primary-sources/federalist-no-51/
- [91] Federalist 10 – National Constitution Center. https://constitutioncenter.org/the-constitution/historic-document-library/detail/james-madison-federalist-10-1788
- [92] Tocqueville's Democracy in America – Online Library of Liberty. https://oll.libertyfund.org/pages/tocqueville-s-democracy-in-america
- [93] Mill's Defence of Individual Freedom – PolSci Institute. https://polsci.institute/modern-political-philosophy/foundations-of-liberty-mill-individual-freedom/
- [94] Tyranny of the majority – Wikipedia. https://en.wikipedia.org/wiki/Tyranny_of_the_majority
- [95] A Disquisition on Government (Calhoun) – Wikipedia. https://en.wikipedia.org/wiki/A_Disquisition_on_Government
- [96] Consociationalism – Wikipedia. https://en.wikipedia.org/wiki/Consociationalism
- [97] The New Republic – Voting Rites (Guinier üzerine inceleme). https://newrepublic.com/article/62574/voting-rites
- [98] German Basic Law – Constitute Project (md. 77, 79). https://www.constituteproject.org/constitution/German_Federal_Republic_2014
- [99] Basic Law for the Federal Republic of Germany – Wikipedia (ebedîlik maddesi md. 79(3)). https://en.wikipedia.org/wiki/Basic_Law_for_the_Federal_Republic_of_Germany
- [100] 1982 Türkiye Anayasası (2017 değişiklikleriyle) – Constitute Project (md. 4). https://www.constituteproject.org/constitution/Turkey_2017
- [101] 1982 Türkiye Anayasası (2011) PDF, md. 175 dahil. https://antislaverylaw.ac.uk/wp-content/uploads/2019/08/Turkey-Constitution.pdf
- [102] Türkiye Cumhuriyeti Anayasası (metin, İHD). https://www.ihd.org.tr/tke-cumhuretanayasasi/
- [103] Belgian Constitution – Constitutional Court (md. 4, 54). https://en.const-court.be/court/basic-text/constitution
- [104] Cross-community vote (Kuzey İrlanda) – Wikipedia. https://en.wikipedia.org/wiki/Cross-community_vote
- [105] Northern Ireland Assembly Education – Voting. https://education.niassembly.gov.uk/post-16/work-assembly/representation/voting
- [106] Liberum veto – Wikipedia. https://en.wikipedia.org/wiki/Liberum_veto
- [107] U.S. Senate – About Filibusters and Cloture. https://www.senate.gov/about/powers-procedures/filibusters-cloture.htm
- [108] CRS – Filibusters and Cloture in the Senate. https://www.congress.gov/crs-product/RL30360
- [109] Schulze method – Wikipedia. https://en.wikipedia.org/wiki/Schulze_method
- [110] Caplin ve Nalebuff, On 64%-Majority Rule (Econometrica 1988) – EconPapers. https://econpapers.repec.org/RePEc:ecm:emetrp:v:56:y:1988:i:4:p:787-814
- [111] Debian Constitution. https://www.debian.org/devel/constitution
- [112] Citizens' Assembly (Ireland) – Wikipedia. https://en.wikipedia.org/wiki/Citizens%27_Assembly_(Ireland)
- [113] Flanigan ve ark., Fair algorithms for selecting citizens' assemblies (Nature 2021). https://www.nature.com/articles/s41586-021-03788-6
- [114] citizensassemblies-replication (LEXIMIN kodu). https://github.com/pgoelz/citizensassemblies-replication
- [115] Method of Equal Shares – explanation. https://equalshares.net/explanation
- [116] Lalley ve Weyl, Quadratic Voting (arXiv 1409.0264v2). https://arxiv.org/pdf/1409.0264v2
- [117] Posner ve Weyl, Voting Squared: Quadratic Voting in Democratic Politics. https://www.vanderbilt.edu/lawreview-new/wp-content/uploads/sites/278/2015/04/Voting-Squared-Quadratic-Voting-in-Democratic-Politics.pdf
- [118] Marginal Revolution – Quadratic Voting in the Field (Colorado 2019). https://marginalrevolution.com/marginalrevolution/2019/04/quadratic-voting-in-the-field.html
- [119] Colorado Sun – Judge orders Democrats to stop using secret quadratic voting system (2024). https://coloradosun.com/2024/01/05/colorado-legisalture-quadratic-voting-lawsuit/
- [120] Buterin – Pairwise coordination subsidies (ethresear.ch). https://ethresear.ch/t/pairwise-coordination-subsidies-a-new-quadratic-funding-design/5553
- [121] Peter Suber, Nomic (değiştirilemez/değiştirilebilir kurallar, dönüştürme). https://legacy.earlham.edu/~peters/writing/nomic.htm

### D. DAO ve blokzincir yönetişimi

- [122] Polkadot governance spec (uyarlanabilir yeter sayı yanlılığı) – corepaper.org. https://corepaper.org/polkadot/governance/
- [123] Overview of Polkadot and its Design Considerations (arXiv 2005.13456). https://arxiv.org/pdf/2005.13456
- [124] Polkassembly docs – Governance V1. https://docs.polkassembly.io/jekyll/2023-08-31-governance-v1.html
- [125] Polkadot Wiki – Polkadot OpenGov. https://wiki.polkadot.com/learn/learn-polkadot-opengov/
- [126] Polkadot Wiki – OpenGov Origins (parça parametreleri). https://wiki.polkadot.com/learn/learn-polkadot-opengov-origins/
- [127] DAOstack Genesis Protocol / Holographic Consensus. https://daostack.github.io/DAOstack-Hackers-Kit/stack/infra/genesisProtocol/
- [128] Optimism OPerating Manual. https://github.com/ethereum-optimism/OPerating-manual/blob/main/manual.md
- [129] Optimism – The Future of Optimism Governance. https://www.optimism.io/blog/the-future-of-optimism-governance
- [130] Optimism governance FAQ. https://docs.optimism.io/governance/gov-faq
- [131] Optimism Citizens' House overview. https://community.optimism.io/citizens-house/citizen-house-overview
- [132] Gitcoin – MolochDAO mechanism. https://gitcoin.co/mechanisms/molochdao
- [133] Lido – Dual Governance 101 Explainer. https://blog.lido.fi/dual-governance-101-explainer/
- [134] Compound v2 Docs – Governance. https://docs.compound.xyz/v2/governance/
- [135] Compound GovernorBravoDelegate.sol. https://github.com/compound-finance/compound-protocol/blob/master/contracts/Governance/GovernorBravoDelegate.sol
- [136] Compound Timelock.sol. https://github.com/compound-finance/compound-protocol/blob/master/contracts/Timelock.sol
- [137] OpenZeppelin Contracts 4.x – Governance API. https://docs.openzeppelin.com/contracts/4.x/api/governance
- [138] Snapshot FAQ. https://docs.snapshot.box/faq
- [139] Shutter Brings Shielded Voting to Snapshot. https://blog.shutter.network/shutter-brings-shielded-voting-to-snapshot/
- [140] Octez docs – The Amendment (and Voting) Process. https://octez.tezos.com/docs/active/voting.html
- [141] Aragon Docs – Token Voting. https://docs.aragon.org/token-voting/1.x
- [142] MACI – What is MACI? https://maci.pse.dev/docs/introduction
- [143] ConsenSys PLCRVoting (Partial Lock Commit Reveal). https://github.com/ConsenSys/PLCRVoting

### E. Dağıtık defter, uzlaşı, e-oylama güvenliği ve rastgelelik

- [144] Castro ve Liskov – Practical Byzantine Fault Tolerance (yazarların OSDI'99 sunumu). https://people.eecs.berkeley.edu/~istoica/classes/cs268/06/notes/BFT-osdi99x2.pdf
- [145] Practical Byzantine Fault Tolerance (OSDI'99 makalesi, HTML). https://pmg.csail.mit.edu/papers/osdi99_html/osdi99.html
- [146] Buchman, Kwon, Milosevic – The latest gossip on BFT consensus (Tendermint, Algoritma 1). https://arxiv.org/pdf/1807.04938
- [147] Tendermint Wiki – Byzantine Consensus Algorithm. https://github.com/tendermint/tendermint/wiki/Byzantine-Consensus-Algorithm
- [148] CometBFT config.toml başvurusu (uzlaşı zaman aşımları). https://docs.cometbft.com/main/references/config/config.toml
- [149] EIP-225: Clique proof-of-authority consensus protocol. https://eips.ethereum.org/EIPS/eip-225
- [150] Ekparinya, Gramoli, Jourjon – The Attack of the Clones Against Proof-of-Authority (NDSS 2020). https://arxiv.org/abs/1902.10244
- [151] Raft Consensus Algorithm. https://raft.github.io/
- [152] Yin ve ark. – HotStuff: BFT Consensus with Linearity and Responsiveness. https://arxiv.org/abs/1803.05069
- [153] Androulaki ve ark. – Hyperledger Fabric: A Distributed Operating System for Permissioned Blockchains. https://arxiv.org/abs/1801.10228
- [154] RFC 6962 – Certificate Transparency (Merkle Hash Trees). https://www.rfc-editor.org/rfc/rfc6962
- [155] RFC 8032 – Edwards-Curve Digital Signature Algorithm (EdDSA). https://www.rfc-editor.org/rfc/rfc8032
- [156] Adida – Helios: Web-based Open-Audit Voting (USENIX Security 2008). https://www.usenix.org/legacy/event/sec08/tech/full_papers/adida/adida.pdf
- [157] State Electoral Service of Estonia – General Framework of Electronic Voting. https://www.regeringen.ax/sites/default/files/attachments/page/estonia-e-voting-2017.pdf
- [158] Specter, Koppel, Weitzner – The Ballot is Busted Before the Blockchain: A Security Analysis of Voatz (USENIX Security 2020). https://www.usenix.org/system/files/sec20-specter.pdf
- [159] Park, Specter, Narula, Rivest – Going from bad to worse: from Internet voting to blockchain voting (Journal of Cybersecurity 2021). https://academic.oup.com/cybersecurity/article/7/1/tyaa025/6137886
- [160] Going from bad to worse (MIT DSpace kaydı). https://dspace.mit.edu/handle/1721.1/143858
- [161] drand – quicknet is live on the League of Entropy mainnet. https://docs.drand.love/blog/2023/10/16/quicknet-is-live/
- [162] a16z crypto – Public randomness and randomness beacons. https://a16zcrypto.com/posts/article/public-randomness-and-randomness-beacons/
- [163] RFC 9381: Verifiable Random Functions (VRFs). https://www.rfc-editor.org/rfc/rfc9381.html

### F. Ontoloji, hukuk bilişimi ve RDF araçları

- [164] Hoekstra, Breuker, Di Bello, Boer – The LKIF Core Ontology of Basic Legal Concepts (CEUR Vol-321). https://ceur-ws.org/Vol-321/paper3.pdf
- [165] LKIF Core GitHub deposu (OWL + Turtle, CC BY 4.0). https://github.com/RinkeHoekstra/lkif-core
- [166] LegalRuleML Core Specification Version 1.0 (OASIS). https://docs.oasis-open.org/legalruleml/legalruleml-core-spec/v1.0/legalruleml-core-spec-v1.0.html
- [167] LegalRuleML Core Specification V1.0 OASIS Standard published. https://www.oasis-open.org/2021/09/08/legalruleml-core-specification-v1-0-oasis-standard-published/
- [168] Robaldo ve Adebayo – Compliance checking in reified I/O logic via SHACL. https://arxiv.org/pdf/2110.07033
- [169] Formalizing GDPR Provisions in Reified I/O Logic: The DAPRECO Knowledge Base. https://link.springer.com/article/10.1007/s10849-019-09309-z
- [170] The DAPRECO Knowledge Base: Representing the GDPR in LegalRuleML (LREC 2020). https://aclanthology.org/2020.lrec-1.698/
- [171] Shapes Constraint Language (SHACL) – W3C Recommendation. https://www.w3.org/TR/shacl/
- [172] SHACL 1.2 Rules – W3C Working Draft. https://www.w3.org/TR/shacl12-rules/
- [173] OWL 2 Web Ontology Language Profiles (OWL 2 RL kuralları). https://www.w3.org/TR/owl2-profiles/
- [174] Akoma Ntoso Naming Convention Version 1.0 (OASIS). https://docs.oasis-open.org/legaldocml/akn-nc/v1.0/akn-nc-v1.0.html
- [175] Akoma Ntoso Version 1.0 Part 1: XML Vocabulary. https://docs.oasis-open.org/legaldocml/akn-core/v1.0/csprd01/part1-vocabulary/akn-core-v1.0-csprd01-part1-vocabulary.html
- [176] ELI ontology (EU Open Data Portal). https://data.europa.eu/eli/ontology
- [177] ELI ontology OWL dosyası (Publications Office). http://publications.europa.eu/resource/distribution/eli/owl/owl/eli.owl
- [178] ODRL Information Model 2.2 (W3C Recommendation). https://www.w3.org/TR/odrl-model/
- [179] Olson, Salas-Damian, Forbus – A Defeasible Deontic Calculus for Resolving Norm Conflicts. https://arxiv.org/abs/2407.04869
- [180] Defeasible logic with dynamic priorities. https://www.researchgate.net/publication/220064039_Defeasible_logic_with_dynamic_priorities
- [181] Catala: A Programming Language for the Law. https://arxiv.org/pdf/2103.03198
- [182] Representing Normative Regulations in OWL DL for Automated Compliance Checking Supported by Text Annotation. https://arxiv.org/abs/2504.05951
- [183] Pandit ve ark. – Exploring GDPR Compliance Over Provenance Graphs Using SHACL (SEMANTiCS 2018). https://ceur-ws.org/Vol-2198/paper_120.pdf
- [184] Mahmoud ve ark. – A Review of Norms and Normative Multiagent Systems (2014). https://onlinelibrary.wiley.com/doi/10.1155/2014/684587
- [185] Substantive and procedural norms in normative multiagent systems. https://www.sciencedirect.com/science/article/pii/S1570868307000535
- [186] Mevzuat Hazırlama Usul ve Esasları Hakkında Yönetmelik (Resmî Gazete, 17.02.2006). https://www.resmigazete.gov.tr/eskiler/2006/02/20060217-4.htm
- [187] Mevzuat Bilgi Sistemi – örnek URL şeması. https://mevzuat.gov.tr/mevzuat?MevzuatNo=6098&MevzuatTur=1&MevzuatTertip=5
- [188] N3.js (Parser, Store, Writer, Reasoner). https://github.com/rdfjs/N3.js
- [189] n3 npm kayıt verisi (v2.7.12). https://registry.npmjs.org/n3
- [190] rdf-validate-shacl (zazuko). https://github.com/zazuko/rdf-validate-shacl
- [191] rdf-validate-shacl npm kayıt verisi (v0.6.5). https://registry.npmjs.org/rdf-validate-shacl
- [192] shacl-engine npm kayıt verisi ve README (v1.1.2). https://registry.npmjs.org/shacl-engine
- [193] eyereasoner (eye-js) npm kayıt verisi ve README (v21.1.24). https://registry.npmjs.org/eyereasoner
- [194] eyeling – JavaScript Notation3 akıl yürütücüsü. https://github.com/phochste/eyeling
- [195] @comunica/query-sparql-rdfjs npm kayıt verisi ve README (v5.4.1). https://registry.npmjs.org/@comunica/query-sparql-rdfjs
- [196] rdflib npm kayıt verisi ve README (v2.4.1). https://registry.npmjs.org/rdflib
- [197] rdf-canonize npm kayıt verisi ve README (v5.0.0). https://registry.npmjs.org/rdf-canonize
- [198] RDF Dataset Canonicalization (RDFC-1.0) – W3C Recommendation. https://www.w3.org/TR/rdf-canon/
- [199] PROV-O: The PROV Ontology (W3C). https://www.w3.org/TR/prov-o/
- [200] SKOS Simple Knowledge Organization System Reference (W3C). https://www.w3.org/TR/skos-reference/
- [201] Notation 3 Logic (log:notIncludes, kapsamlı başarısızlık olarak olumsuzlama). https://www.w3.org/DesignIssues/N3Logic

### G. Bilirkişi, itibar, hakemlik ve çıkar çatışması

- [202] 6754 sayılı Bilirkişilik Kanunu (Resmî Gazete 24.11.2016). https://www.resmigazete.gov.tr/eskiler/2016/11/20161124-1..htm
- [203] Bilirkişilik Kanunu PDF (Adalet Bakanlığı). https://bilirkisilik.adalet.gov.tr/Resimler/SayfaDokuman/16112023141252bilirki%C5%9Filik%20kanunu.pdf
- [204] Bilirkişilik Yönetmeliği (Bilirkişilik Daire Başkanlığı PDF). https://bilirkisilik.adalet.gov.tr/Resimler/SayfaDokuman/272020153902Bilirki%C5%9Filik%20Y%C3%B6netmeli%C4%9Fi.pdf
- [205] Bilirkişi Performans Ölçme Formu (2025). https://bilirkisilik.adalet.gov.tr/Resimler/SayfaDokuman/19032025163133Performans%20%C3%96l%C3%A7me%20Formu.pdf
- [206] Bilirkişilerin Performanslarının Ölçülmesi – Genel Yazı 19.03.2025. https://bilirkisilik.adalet.gov.tr/Resimler/SayfaDokuman/19032025163056Genel%20Yaz%C4%B1.pdf
- [207] Performans Ölçme Formunun UYAP'a Entegre Edilmesi Hakkında Duyuru. https://bilirkisilik.adalet.gov.tr/Home/SayfaDetay/bilirkisilerin-performanslarinin-degerlendirilmesi-amaciyla-hazirlanan-performans-olcme-formunun-uyap-a-entegre-edilmesi-hakkinda-duyuru19032025042502
- [208] HMK Bilirkişi İncelemesi md. 266–293 (Adalet Bakanlığı PDF). https://rayp.adalet.gov.tr/resimler/488/dosya/hukuk-muhakemeleri-kanunu29-06-202011-56.pdf
- [209] HMK Madde 272 – Bilirkişinin yasaklılığı ve reddi. https://barandogan.av.tr/blog/mevzuat/hmk-madde-272-bilirkisinin-gorevini-yapmaktan-yasakli-olmasi-ve-reddi.html
- [210] Kleros v2 Arbitrator specification. https://github.com/kleros/kleros-v2/blob/dev/contracts/specifications/arbitrator.md
- [211] Parameterization for Kleros courts. https://blog.kleros.io/parameterization-of-kleros-courts/
- [212] Kleros Sortition Sum Tree hata ödülü (issue #115). https://github.com/kleros/kleros/issues/115
- [213] Kleros Long Paper v2.0.2 (arama sonucu; erişim 404). https://kleros.io/yellowpaper.pdf
- [214] @kleros/kleros-v2-contracts (RNG modülleri). https://www.npmjs.com/package/@kleros/kleros-v2-contracts
- [215] Mechanism Institute – Appeal. https://mechanism.institute/library/appeal/
- [216] How Delphi studies in the health sciences find consensus: a scoping review. https://pmc.ncbi.nlm.nih.gov/articles/PMC11734368/
- [217] The Delphi Method: Building Expert Consensus in Rounds (CASRAI). https://casrai.org/guides/delphi-method
- [218] Diamond ve ark. 2014 – Defining Consensus (ResearchGate). https://www.researchgate.net/publication/260395627_Defining_Consensus_A_Systematic_Review_Recommends_Methodologic_Criteria_for_Reporting_of_Delphi_Studies
- [219] Metaculus Scores FAQ (arama sonucu; erişim engellendi). https://www.metaculus.com/help/scores-faq/
- [220] Metaculus FAQ (arama sonucu; erişim engellendi). https://www.metaculus.com/faq/
- [221] Epistocracy for Online Deliberative Bioethics (Cambridge Q. Healthcare Ethics 2015). https://kclpure.kcl.ac.uk/ws/files/37739945/Epistocracy_for_Online_Deliberative_Bioethics.pdf
- [222] Kamvar, Schlosser, Garcia-Molina – The EigenTrust Algorithm (WWW 2003, HTML). https://www.ra.ethz.ch/CDstore/www2003/papers/refereed/p446/p446-kamvar/index.html
- [223] The EigenTrust Algorithm (WWW 2003, HTML, alternatif yol). https://www.ra.ethz.ch/cdstore/www2003/papers/refereed/p446/p446-kamvar/index.html
- [224] EigenTrust makalesi PDF (Stanford NLP). https://nlp.stanford.edu/pubs/eigentrust.pdf
- [225] EigenTrust – Wikipedia. https://en.wikipedia.org/wiki/EigenTrust
- [226] graph-tool eigentrust dokümantasyonu. https://graph-tool.skewed.de/static/doc/autosummary/graph_tool.centrality.eigentrust.html
- [227] Shah – An Overview of Challenges, Experiments, and Computational Solutions in Peer Review. https://www.cs.cmu.edu/~nihars/preprints/SurveyPeerReview.pdf
- [228] OpenReview – Paper matching: affinity scores and conflicts. https://docs.openreview.net/how-to-guides/paper-matching-and-assignment/how-to-do-automatic-assignments/how-to-setup-paper-matching-by-calculating-affinity-scores-and-conflicts
- [229] ICML 2026 Conflict of Interest Definitions. https://icml.cc/Conferences/2026/ConflictOfInterestDefinitions
- [230] An automated conflict of interest based greedy approach for conference paper assignment system. https://www.researchgate.net/publication/340293048_An_automated_conflict_of_interest_based_greedy_approach_for_conference_paper_assignment_system

### H. Sosyal graf, Sybil direnci ve likit demokrasi

- [231] Cao ve ark., Aiding the Detection of Fake Accounts in Large Scale Social Online Services (SybilRank, NSDI 2012). https://www.usenix.org/system/files/conference/nsdi12/nsdi12-final42_2.pdf
- [232] BrightID-AntiSybil (SybilRank, GroupSybilRank, WeightedSybilRank, saldırı simülasyonları). https://github.com/BrightID/BrightID-AntiSybil
- [233] BrightID-AntiSybil sybil_rank.py. https://github.com/BrightID/BrightID-AntiSybil/blob/master/anti_sybil/algorithms/sybil_rank.py
- [234] BrightID-AntiSybil group_sybil_rank.py. https://github.com/BrightID/BrightID-AntiSybil/blob/master/anti_sybil/algorithms/group_sybil_rank.py
- [235] BrightID Connection Levels. https://brightid.gitbook.io/brightid/verifications/making-connections/connection-levels
- [236] BrightID Aura – How Aura works. https://brightid.gitbook.io/aura/intro/how-aura-works
- [237] Yu ve ark., SybilLimit: A Near-Optimal Social Network Defense against Sybil Attacks. https://nymity.ch/sybilhunting/pdf/Yu2008a.pdf
- [238] Kleros, A Proof of Humanity FAQ. https://blog.kleros.io/proof-of-humanity-faq/
- [239] Human (Gitcoin) Passport Stamp Weights. https://support.passport.human.tech/stamps/stamp-weights
- [240] Kahng, Mackenzie, Procaccia, Liquid Democracy: An Algorithmic Perspective (AAAI). https://cdn.aaai.org/ojs/11468/11468-13-14996-1-2-20201228.pdf
- [241] The Temporal Dimension in the Analysis of Liquid Democracy Delegation Graphs (Liquid Democracy Journal, Issue 7). https://liquid-democracy-journal.org/issue/7/The_Liquid_Democracy_Journal-Issue007-04-The_Temporal_Dimension_in_the_Analysis_of_Liquid_Democracy_Delegation_Graphs.html
- [242] Kling ve ark., Voting Behaviour and Power in Online Democracy (arXiv 1503.07723, PDF). https://arxiv.org/pdf/1503.07723
- [243] Hardt ve Lopes, Google Votes: A Liquid Democracy Experiment on a Corporate Social Network. https://www.tdcommons.org/dpubs_series/79/
- [244] Kotsialou ve Riley, Incentivising Participation in Liquid Democracy with Breadth-First Delegation (AAMAS 2020). https://www.ifaamas.org/Proceedings/aamas2020/pdfs/p638.pdf
- [245] Optimizing Viscous Democracy. https://arxiv.org/html/2405.06698
- [246] Boldi ve ark., Viscous Democracy for Social Networks (CACM). https://cacm.acm.org/magazines/2011/6/108653-viscous-democracy-for-social-networks/abstract
- [247] Power in Liquid Democracy. https://arxiv.org/html/2010.07070
- [248] Resilient Liquid Democracy: Mitigating Voting Power Imbalances via Secure Delegation Networks. https://arxiv.org/html/2607.01730v2
- [249] Traag, Waltman, van Eck, From Louvain to Leiden: guaranteeing well-connected communities. https://arxiv.org/pdf/1810.08473
- [250] Neo4j Graph Data Science – Leiden. https://neo4j.com/docs/graph-data-science/current/algorithms/leiden/
- [251] graphology standart kütüphanesi. https://graphology.github.io/standard-library/
- [252] graphology-communities-louvain. https://graphology.github.io/standard-library/communities-louvain.html
- [253] graphology-metrics. https://graphology.github.io/standard-library/metrics.html
- [254] ngraph.leiden. https://github.com/anvaka/ngraph.leiden
- [255] Cao ve ark., Uncovering Large Groups of Active Malicious Accounts in Online Social Networks (SynchroTrap, CCS 2014). https://users.cs.duke.edu/~xwy/publications/SynchroTrap-ccs14.pdf
- [256] Beutel ve ark., CopyCatch: Stopping Group Attacks by Spotting Lockstep Behavior. https://alexbeutel.com/papers/www2013_copycatch.pdf
- [257] Garimella ve ark., Quantifying Controversy in Social Media (RWC). http://users.ics.aalto.fi/gionis/garimella2016controversy.pdf
- [258] Guerra ve ark., A Measure of Polarization on Social Media Networks Based on Community Boundaries. https://ojs.aaai.org/index.php/ICWSM/article/view/14421

### I. Yapay zekâ, moderasyon, mahremiyet (KVKK), kriptografi ve mobil

- [259] Perspective API (resmî site; kapanış tarihleri). https://www.perspectiveapi.com/
- [260] Bye Bye Perspective API: Lessons for Building and Governing Measurement Infrastructure (arXiv 2604.25580). https://arxiv.org/abs/2604.25580
- [261] Sap ve ark. 2019, The Risk of Racial Bias in Hate Speech Detection (ACL). https://aclanthology.org/P19-1163/
- [262] A Comprehensive View of the Biases of Toxicity and Sentiment Analysis Methods Towards AAE (arXiv 2401.12720). https://arxiv.org/abs/2401.12720
- [263] Probing Association Biases in LLM Moderation Over-Sensitivity (arXiv 2505.23914). https://arxiv.org/abs/2505.23914
- [264] Ideology-Based LLMs for Content Moderation (arXiv 2510.25805). https://arxiv.org/abs/2510.25805
- [265] LLMs for Argument Mining: Detection, Extraction, and Relationship Classification (arXiv 2505.22956). https://arxiv.org/abs/2505.22956
- [266] Claude docs – Content moderation use-case guide. https://platform.claude.com/docs/en/docs/about-claude/use-case-guides/content-moderation
- [267] Santa Clara Principles 2.0. https://santaclaraprinciples.org/
- [268] intfloat/multilingual-e5-small model kartı. https://huggingface.co/intfloat/multilingual-e5-small
- [269] Xenova/multilingual-e5-small (Transformers.js ONNX). https://huggingface.co/Xenova/multilingual-e5-small
- [270] Transformers.js pipelines API (FeatureExtractionPipeline). https://huggingface.co/docs/transformers.js/api/pipelines
- [271] Sentence-Transformers – Paraphrase Mining. https://sbert.net/examples/sentence_transformer/applications/paraphrase-mining/README.html
- [272] 6698 sayılı Kişisel Verilerin Korunması Kanunu (mevzuat.gov.tr, 2024 değişiklikleriyle). https://mevzuat.gov.tr/MevzuatMetin/1.5.6698.pdf
- [273] Kişisel Verilerin Silinmesi, Yok Edilmesi veya Anonim Hale Getirilmesi Hakkında Yönetmelik (KVKK). https://www.kvkk.gov.tr/Icerik/5441/KISISEL-VERILERIN-SILINMESI-YOK-EDILMESI-VEYA-ANONIM-HALE-GETIRILMESI-HAKKINDA-YONETMELIK
- [274] KVK Kurulu 2018/10 – Özel nitelikli kişisel veriler için yeterli önlemler. https://www.kvkk.gov.tr/Icerik/4110/2018-10
- [275] KVK Kurulu 2021/389 – Hizmetin açık rıza şartına bağlanması. https://www.kvkk.gov.tr/Icerik/6967/2021-389
- [276] KVKK 2019/10 veri ihlali 72 saat (ikincil özet). https://www.nesilteknoloji.com/kisisel-veri-ihlal-bildirimi-nasil-olur/
- [277] Aydınlatma Yükümlülüğü Tebliği (Resmî Gazete 10.03.2018). https://www.resmigazete.gov.tr/eskiler/2018/03/20180310-5.htm
- [278] KVKK Aydınlatma Yükümlülüğünün Yerine Getirilmesi Rehberi. https://kvkk.gov.tr/SharedFolderServer/CMSFiles/a569a068-c079-4189-b134-f57bc727af7d.pdf
- [279] EDPB Guidelines 02/2025 on processing of personal data through blockchain technologies (v2.0, 7 Temmuz 2026). https://www.edpb.europa.eu/system/files/2026-07/edpb_guidelines_202502_blockchain_v2_en.pdf
- [280] EU AI Act Article 50 (AI Act Service Desk). https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50
- [281] European Commission FAQ – Transparency obligations under Article 50. https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act
- [282] T.C. Kimlik Numarası (Türkçe Vikipedi). https://tr.wikipedia.org/wiki/T.C._Kimlik_Numarası
- [283] C# TC Kimlik No Doğrulama Algoritması (Murat Öner). https://muratoner.net/csharp-tc-kimlik-no-dogrulama-algoritmasi
- [284] CipherSweet: Searchable Encryption Doesn't Have to be Bitter (Paragon IE). https://paragonie.com/blog/2019/01/ciphersweet-searchable-encryption-doesn-t-have-be-bitter
- [285] CipherSweet güvenlik özellikleri ve tehdit modeli. https://ciphersweet.paragonie.com/security
- [286] Node.js crypto dokümantasyonu. https://nodejs.org/api/crypto.html
- [287] NIST SP 800-38D (GCM). https://nvlpubs.nist.gov/nistpubs/legacy/sp/nistspecialpublication800-38d.pdf
- [288] Capacitor configuration reference. https://capacitorjs.com/docs/config
- [289] Capacitor Android getting started. https://capacitorjs.com/docs/android
- [290] Capacitor environment setup (v8). https://capacitorjs.com/docs/getting-started/environment-setup
- [291] Capacitor CLI – cap sync. https://capacitorjs.com/docs/cli/commands/sync
- [292] Android Network security configuration. https://developer.android.com/privacy-and-security/security-config
- [293] Android – Build your app from the command line. https://developer.android.com/build/building-cmdline
- [294] Android cleartext traffic and network_security_config.xml (10.0.2.2 notu). https://ptkd.com/journal/android-cleartext-traffic-network-security-config
- [295] Expo – Develop websites with Expo. https://docs.expo.dev/workflow/web/
- [296] Flutter web renderers / Flutter web ne zaman kullanılmalı. https://docs.flutter.dev/platform-integration/web/renderers
- [297] Capacitor vs Flutter: What CTOs Need to Know in 2026 (blog). https://openforge.io/capacitor-vs-flutter-what-ctos-need-to-know-in-2026/
- [298] Capacitor vs React Native: Complete Comparison (blog). https://nextnative.dev/comparisons/capacitor-vs-react-native
