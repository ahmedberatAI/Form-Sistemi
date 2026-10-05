# Yazılım Mühendisliği İlkeleri İncelemesi

> Tarih: 2 Ekim 2026 (ilk üç tur); dördüncü tur: 5 Ekim 2026.
> Yöntem: 18 ilke ayrı ayrı incelendi. Her ilke için bir inceleyici (Claude Sonnet 5.5) bütün depoyu salt okunur taradı ve her bulguya dosya, satır ve kanıt ekledi.
> Bulgular tekilleştirildi ve kod üzerinde doğrulandı. Üç turda toplam 48 sorun düzeltildi (her turda 15–17); dördüncü turda 21 sorun grubu daha giderildi (§3d). Diğerleri aşağıda kayıtlıdır.

## 1. İncelenen ilkeler ve başlangıç puanları (0–10)

| İlke | Puan | İlke | Puan |
|---|---|---|---|
| SOLID – Tek sorumluluk (SRP) | 5,5 | Sorumlulukların ayrılığı / katmanlar | 6 |
| SOLID – Açık/kapalı (OCP) | 6 | Kapsülleme ve Demeter kuralı | 6 |
| SOLID – Liskov (LSP) | 7 | Hızlı başarısızlık ve hata yönetimi | 7 |
| SOLID – Arayüz ayrımı (ISP) | 5,5 | Tasarımda güvenlik | 6 |
| SOLID – Bağımlılığın tersine çevrilmesi (DIP) | 7 | Test edilebilirlik ve test kalitesi | 6,5 |
| DRY | 6,5 | Temiz kod | 6 |
| KISS | 5,5 | Veri bütünlüğü ve eşzamanlılık | 6 |
| YAGNI | 7,5 | Performans | 6 |
| Belge–kod tutarlılığı | 7,5 | Yapılandırma ve işletilebilirlik | 5,5 |

## 2. Bulgular

| Tür | Sayı | Açıklama |
|---|---|---|
| Hata iddiası | 64 | Farklı ilkelerden gelen aynı sorunlar birleştirilince yaklaşık 44 ayrı hata kaldı. |
| Tasarım | 252 | Çoğunlukla büyük servis kapanışları, katmanlar arası yinelenen kurallar, sözleşme dışı seçenekler. |
| Belge uyumsuzluğu | 31 | Sayılar, hata kataloğu, gizlilik ve katman iddiaları. |
| **Toplam** | **347** | |

## 3. Düzeltilenler (öncelik sırasıyla)

| # | Sorun | İlke | Düzeltme |
|---|---|---|---|
| 1 | **Kritik:** Yönetmelik yamasında IRI enjeksiyonu. `>` içeren IRI ile Turtle'a keyfi üçlü sızıyordu; geçersiz IRI'li yama veritabanını bozuyordu. | Güvenlik | IRI katı biçimde denetleniyor (`ontology/iri.ts`). Yeni yönetmelik sürümü kaydedilmeden önce yazılıp yeniden ayrıştırılıyor; hata olursa hiçbir şey kaydedilmiyor. |
| 2 | Tarayıcıda "sunucuya güvenmeden doğrulama" işlem içeriğini özete bağlamıyordu. | Güvenlik | İçerik–özet bağı ve kanıtın o işleme ait olduğu denetleniyor. Taahhütler defterden tek tek doğrulanıyor. |
| 3 | Boş doğrulayıcı kümesiyle imzasız kanıt kabul ediliyordu. | Güvenlik, LSP | Doğrulayıcı listesi boşsa kanıt reddediliyor (fail-closed). |
| 4 | Yöneticinin küme yeniden hesaplama ucu üyelerin siyasi kümesini kimlikleriyle döndürüyordu. | Güvenlik, sorumlulukların ayrılığı | Anonimleştirme servise taşındı; varsayılan görünüm anonim. |
| 5 | Herkese açık bilirkişi panelinde özel yakınlık ve "aynı hane" bilgisi görünüyordu. | Güvenlik | Ayrıntıyı yalnız görevliler görüyor; diğerleri genel bir gerekçe görüyor. |
| 6 | Üçüncü kişinin tek taraflı yakınlık beyanları başkasının önerisinden bilirkişiyi kesin olarak dışlayabiliyordu. | Güvenlik | Kesin çatışma yalnızca doğrudan bilirkişi–yazar beyanı ya da aynı hane. Zincirler yumuşak çatışma sayılıyor (ALGORITMA §8 güncellendi). |
| 7 | Kimliksiz `GET /api/ledger/verify` her çağrıda bütün zinciri yeniden doğruluyordu (DoS). | Güvenlik, performans | Doğrulama sonucu yükseklik, uç blok özeti ve kurcalama nesline göre önbellekleniyor; yalnızca yeni bloklar doğrulanıyor. |
| 8 | Anahtar dosyası eksikse dolu veritabanına rağmen yeni anahtar üretiliyordu; şifreli kimlik kasası kalıcı olarak okunamaz hale gelebiliyordu. | Hata yönetimi, bütünlük | Her anahtarın parmak izi `meta` tablosunda tutuluyor ve her açılışta doğrulanıyor. Veri varken anahtar eksikse sunucu açılmıyor. |
| 9 | `VOTE_KEY` doğrulanmıyordu; boş anahtar oy kimliklerini tahmin edilebilir kılıyordu. | Güvenlik | Bütün gizli anahtarların biçimi ve uzunluğu açılışta denetleniyor. |
| 10 | Ortam değişkenleri yanlış ayrıştırılıyordu: boş `PORT` rastgele port açıyordu, `TIME_SCALE=abc` NaN veriyordu, `AI_ENABLED=False` YZ'yi kapatmıyordu. | Hızlı başarısızlık | Sayılar aralık denetimiyle okunuyor. Mantıksal değerler büyük/küçük harf duyarsız. Geçersiz değerde açıklayıcı Türkçe hata veriliyor. |
| 11 | Eşzamanlı eklenen hak bayrağı, önerinin düzenlenmesi sırasında eski görüntüyle eziliyordu; bu, karar eşiğini düşürebiliyordu. | Bütünlük | YZ çağrılarından sonra satır işlem içinde yeniden okunuyor ve bayraklar üç yönlü birleştiriliyor. |
| 12 | Arayüz itiraz hakkını gösteriyordu, ama 30 günlük itiraz bütçesi dolduysa sunucu itirazı reddediyordu. | DRY | Tek kural (`forum/objection-budget.ts`) hem servis hem okuma modeli tarafından kullanılıyor. |
| 13 | Son yönetici kendi hesabını silebiliyordu. | Bütünlük | Rol değiştirmedeki "son yönetici" kuralı silmede de uygulanıyor. |
| 14 | Metin uzunluğu sınırları arayüz, HTTP şeması ve servis arasında çelişiyordu (öneri 10 bin / 20 bin, bilirkişi sorusu 2000 / 1000…). | DRY, temiz kod | Tek kaynak `TEXT_LIMITS` (shared); şemalar, servisler ve formlar bunu kullanıyor. |
| 15 | Web istemcisinde üç sorun vardı. Çıkış yapılmış cihazda bütün hesapların oy makbuzları görünüyordu. Hata sınırı yoktu; bir sayfa hatası uygulamayı boşaltıyordu. Sunucu 5xx verdiğinde kullanıcı oturumdan atılıyordu. | Güvenlik, hata yönetimi | Makbuzlar sahibine göre süzülüyor. Hata sınırı eklendi; yeniden yükleme ve ana sayfaya dönme seçenekleri sunuyor. Oturum yalnızca 401 yanıtında kapanıyor. |

Her düzeltmenin bir regresyon testi var. Doğrulama (2 Ekim 2026):

| Kontrol | Sonuç |
|---|---|
| Sunucu testleri | 63 dosya, 792/792 |
| Web birim testleri | 3 dosya, 9/9 (yeni) |
| Tip denetimi | temiz |
| Derleme | temiz |
| e2e | 9/9 |

e2e'deki oylama testinde K_s (gerekli destekçi sayısı) artık tohumdaki üye sayısından hesaplanıyor. Demo yönetici hesabı eklenince sabit beklenen değer bozulmuştu.

## 3b. İkinci tur düzeltmeler (15 sorun)

| # | Sorun | İlke | Düzeltme |
|---|---|---|---|
| 16 | Aynı veri klasörünü iki sunucu paylaşınca defter kaydı sessizce kayboluyordu. | İşletilebilirlik, bütünlük | Veri klasöründe özel kilit dosyası (`core/lock.ts`). Sunucu, tohum ve anahtar döndürme betiği bunu kullanıyor. Ölü süreçten kalan kilit uyarıyla devralınıyor. |
| 17 | Kapanış sırası yanlıştı (HTTP en son kapanıyordu) ve uçuştaki bir istek kapanışı yaklaşık 70 sn kilitliyordu. | İşletilebilirlik | Kapanış sırası: HTTP boşaltılır → yaşam döngüsü (uçuştaki tick beklenir) → defter → saat → veritabanı → kilit. Bağlantılar zaman sınırıyla kapanıyor; genel kapanış sınırı 8 sn. |
| 18 | Açılış hata verdiğinde açılmış defter dosyaları kapatılmıyordu. | Hata yönetimi | Hata yolunda her şey kapatılıyor. |
| 19 | İç içe işlem geri alındığında, o düzeyde kuyruğa alınmış bildirimler yine de gönderiliyordu. | Bütünlük | Kuyruk her kayıt noktasına (savepoint) göre ayrı tutuluyor; geri alınan düzeyin işleri atılıyor. |
| 20 | Geri alınan veritabanı işleminden sonra deftere "hayalet" kayıt düşüyordu. | Bütünlük | İşlem özeti önceden hesaplanıyor (isteğe bağlı nonce); gerçek gönderim en dıştaki işlem tamamlandıktan sonra yapılıyor. |
| 21 | Yaşam döngüsü hataları yutuluyor ve her saniye sonsuza dek yeniden deneniyordu. | Hata yönetimi | Öneri başına hata sayacı ve üstel geri çekilme (en fazla 10 dk). Hatalar denetim günlüğüne yazılıyor; yönetici tick yanıtı başarısız önerileri bildiriyor. |
| 22 | Ham istisna iletileri karar gerekçesine ve değiştirilemez deftere yazılıyordu. | Güvenlik | Kamuya genel bir Türkçe gerekçe ve hata kodu gidiyor; ham ileti yalnızca sunucu günlüğünde kalıyor. |
| 23 | YZ uçlarında kota yoktu; her çağrı kalıcı bir analiz ve defter kaydı üretiyordu. | Güvenlik, performans | Aynı girdi için önceki analiz yeniden kullanılıyor. Kullanıcı başına saatte 10 yeni analiz sınırı var (aşılırsa 429). |
| 24 | Kimlik doğrulama sırasındaki her hata kullanıcıyı anonim sayıyordu; geçici bir veritabanı hatası oturumu kapatıyordu. | Hata yönetimi | Yalnızca geçersiz, süresi dolmuş ya da iptal edilmiş belirteç anonim sayılıyor; altyapı hataları 5xx dönüyor. |
| 25 | Claude hataları iz bırakmadan yutuluyordu ve durum her zaman "claude" görünüyordu. | İşletilebilirlik | Hata nedeni (içeriksiz) günlüğe yazılıyor ve sayılıyor. `/api/ai/status` bozulmuş durumu gösteriyor. |
| 26 | KVKK dökümünde kişinin kendi görüş kümesi yoktu ve SQL hataları boş bölüm olarak yutuluyordu. | KVKK, hata yönetimi | Döküme yalnızca kişinin kendi görüş kümesi bilgisi ekleniyor; hata olursa döküm açıkça başarısız oluyor ve olay denetim günlüğüne yazılıyor. |
| 27 | Açık oylamadaki her oy, uzlaşı grafının O(P·V²) maliyetle yeniden hesaplanmasına yol açıyordu. | Performans | Önbellek anahtarı yalnızca kesinleşmiş turlara bağlı. |
| 28 | Bildirimler alıcı başına ayrı otomatik commit'le yazılıyordu; sık kullanılan sorgularda indeks yoktu. | Performans | Bildirimler tek işlemde tek INSERT ile yazılıyor. 20 indeks eklendi (EXPLAIN ile doğrulandı). |
| 29 | Android, oturum belirtecini ve oy makbuzlarını (seçim ve tuz) işletim sistemi yedeğine alıyordu. | Güvenlik | `allowBackup=false`; yedekleme ve cihaz aktarımı kuralları uygulama verisini dışarıda bırakıyor. |
| 30 | Blok sayfası, sabitlenmiş anahtarlar yoksa sunucunun verdiği anahtarlarla doğruluyordu (fail-open). | Güvenlik | Yalnızca sabitlenmiş anahtarlarla doğruluyor; anahtar yoksa "doğrulanamadı" gösteriyor. |
| 31 | İki test rastgele onaltılık dizilerle tesadüfen eşleşebiliyordu (kararsız testler). | Test kalitesi | Denetimler tam değer ya da sözcük sınırıyla yapılıyor. |

Doğrulama (2 Ekim 2026, ikinci tur sonrası):

| Kontrol | Sonuç |
|---|---|
| Sunucu testleri | 76 dosya, 863/863 |
| Web birim testleri | 5 dosya, 15/15 |
| Tip denetimi | temiz |
| Derleme | temiz |
| e2e | 9/9 |
| Android APK | derlendi |

Kısmi kalanlar:
- #23: `/api/experts/lint` için ek yetki ve eşzamanlı Claude çağrısı sınırı yok.
- #29: Açık metin trafiği demo için bırakıldı. Sunucu adresi değişince belirteç silme sonradan eklendi (test döngüsü tur 1):
  Ayarlar önce eski sunucuda oturumu kapatır, sonra adresi değiştirir; `client.setServerUrl` de bellekteki ve cihazdaki belirteci
  unutur, `AuthContext` oturumu kapatır. Eski sunucunun belirteci yeni adrese hiç gönderilmez.

## 3c. Üçüncü tur düzeltmeler (17 sorun)

| # | Sorun | İlke | Düzeltme |
|---|---|---|---|
| 32 | Şema sürümü ve göç mekanizması yoktu. Daha yeni bir yazılımın yazdığı veritabanı sessizce açılıyordu. | Bütünlük, işletilebilirlik | `db/migrations.ts`: `meta.schema_version` ve sıralı göç listesi. Eksik göçler tek işlemde uygulanıyor; biri hata verirse hepsi geri alınıyor. Daha yeni sürümlü veritabanı Türkçe hatayla reddediliyor ve tutamak kapatılıyor. |
| 33 | Kimlik bakımı (reşitlik bayrağı, bekleyen başvuru imhası) iki ayrı yerden zamanlanıyordu. Yaşam döngüsü bunu sözleşme dışı bir tür dönüştürmeyle çağırıyordu. | SRP, DIP | Tek zamanlayıcı: bileşim kökünde `startIdentityMaintenance`. Yalnız sözleşmedeki iki işlev çağrılıyor. Her iş ayrı korunuyor ve hatası denetim günlüğüne yazılıyor. |
| 34 | Yönetici kullanıcı listesi HTTP rotasında ham SQL ve kopya rol ayrıştırmayla yazılmıştı. | Sorumlulukların ayrılığı, DRY | `CommunityService.adminUsers` kullanılıyor; ortak kullanıcı izdüşümü yeniden kullanılıyor. Rota yalnız yetkilendirip devrediyor. |
| 35 | KVKK dökümü başarısız olunca hata gövdesi `kvkk-verilerim.json` adıyla iniyordu. | Hata yönetimi | İndirme başlığı yalnız döküm başarılı olunca ekleniyor. |
| 36 | `seed --reset`, `DB_PATH` ile verilen veritabanını silmiyordu. e2e kurulumu geliştiricinin `DB_PATH` ve `ANTHROPIC_API_KEY` değerlerini alt sürece geçiriyordu. | Test yalıtımı | `DB_PATH` dosyası ve `-wal`/`-shm` dosyaları kilit altında siliniyor. e2e tohumlama bu değişkenleri temizliyor. |
| 37 | Kalite kapısı yoktu. | Test, işletilebilirlik | GitHub Actions iş akışı (tip denetimi, testler, derleme) eklendi. Mimari bağımlılık testi (`test/architecture`) katman kurallarını zorluyor: shared server/web'e bağlanamaz; forum YZ'ye bağlanamaz; rotalar veritabanına yalnız tür olarak erişir; web'in alt katmanları sayfalara bağlanamaz. |
| 38 | Takma ad değişince ya da hesap imha edilince bildirim metinleri metin eşleştirmesiyle yeniden yazılıyordu. Takma adla aynı yazılan sözcükler de değişebiliyordu. | Bütünlük, KISS | Bildirimler `{{uye:<kimlik>}}` belirteci saklıyor. Belirteç okunurken güncel takma adla çözülüyor (`core/notification-text.ts`). Yeniden yazma kodu kaldırıldı. |
| 39 | Öneri ayrıntısındaki defter kayıtları 1000 ile kesiliyordu. Çok oylu önerilerde "öneri oluşturuldu" gibi kayıtlar listeden düşüyordu. | Bütünlük | Yalnız oy taahhütleri en yeni 1000 ile sınırlanıyor; diğer türlerin hepsi veriliyor. Gerçek toplamlar `ledgerTxCounts` alanında. |
| 40 | Kilit adım (lockstep) oy tespitinde bütün oy çiftleri bellekte tutuluyor ve diziler O(n²) kopyalanıyordu. | Performans | Kayan pencere ve akışlı değerlendirme kullanılıyor; yalnız kilitli kenarlar tutuluyor. 2 milyon çiftlik güvenlik tavanı var. Eski algoritmayla eşdeğerlik test edildi. |
| 41 | YZ özeti, Claude başarılı olsa bile çevrimdışı özeti tüm mesajlar üzerinde hesaplıyordu. | Performans | Çevrimdışı özet yalnız gerektiğinde ve en yeni 400 mesajla hesaplanıyor. Sezgisel modüldeki ikinci dereceden kopyalama giderildi. |
| 42 | Bilirkişi kurası bloğa girmeden önce panelde ve çekilme yanıtında kura kaydı görünmüyordu. | Bütünlük | Gönderilen kura kayıtları bekleyen listede tutuluyor ve işlenmiş kayıtlarla tekrar etmeden birleştiriliyor. |
| 43 | Graf görünürlük politikası rotada, sözleşme dışı bir ek alanla uygulanıyordu. Hizmet varsayılan olarak özel kenarları ve siyasi görüş alanlarını verebiliyordu. | Güvenlik, kapsülleme | Sözleşmeye belgelenmiş `includePrivate` ve `viewerId` seçenekleri eklendi; varsayılan kapalı. Politika hizmette uygulanıyor; rota yalnız savunma derinliği olarak süzüyor. |
| 44 | Web: düzenlemeden sonra sürüm geçmişi paneli sonsuza dek yükleniyordu. | Hata yönetimi | Yükleme saf bir yardımcıyla etkiye bağlandı. Bayat yanıtlar atılıyor; kapatıp açınca yeniden deneniyor. |
| 45 | Web: yönetmelik sürümü değişince ontoloji önbelleği eski kalıyordu. | Bütünlük | Sistem bilgisi yenilenince sürüm farklıysa önbellek geçersiz kılınıp yeniden yükleniyor. |
| 46 | Web: yanıt gövdesi okunurken zaman aşımı çalışmıyordu. Kullanıcı iptali "ağ hatası" olarak görünüyordu. | Hata yönetimi | Zamanlayıcı gövde okumasını da kapsıyor. İptal belgelendiği gibi `AbortError` olarak yeniden fırlatılıyor. |
| 47 | Geliştirme vekili sabit 4000 portuna gidiyordu; `PORT` değişince çalışmıyordu. | Yapılandırma | Hedef `VITE_API_TARGET` ya da `localhost:$PORT`. `dev.mjs` gerçek hedefi yazdırıyor. |
| 48 | Android şablon testleri anlamsızdı (`2+2` ve şablon paket adı). | Test kalitesi | Araç testi gerçek paket adını (`tr.edu.forumsistemi`) doğruluyor; anlamsız birim testi kaldırıldı. |

Doğrulama (2 Ekim 2026, üçüncü tur sonrası):

| Kontrol | Sonuç |
|---|---|
| Sunucu testleri | 85 dosya, 901/901 |
| Web birim testleri | 9 dosya, 26/26 |
| Tip denetimi | temiz |
| Derleme | temiz |
| e2e | 9/9 |
| Android APK | derlendi (araç testi kaynakları da derlendi) |

Kısmi kalanlar:
- #38: Belirteç öncesinde yazılmış eski bildirimler eski takma adı taşımaya devam ediyor; yeni bildirimler etkilenmiyor.
- #37: Mimari testte döngüsel bağımlılık denetimi yok. CI e2e ve Android derlemesini çalıştırmıyor.
- #48: Android `FileProvider` / `file_paths.xml` temizliği yapılmadı.

## 3d. Dördüncü tur: gerçek yayına hazırlık, dayanıklılık ve belge doğruluğu (21 sorun grubu, 5 Ekim 2026)

Bu tur, kullanıcı adına verilen altı karara göre yürüdü: rol görünürlüğü herkese açık kalır (yalnız belgelendi); bekleyen başvuru imhası gerçek
duvar saatiyle ölçülür; kura tohumu için belge ile kod arasında önce kodu belgeye uydurmak değerlendirilir, bir değişmezi ya da canlılığı bozuyorsa
belge gerekçesiyle düzeltilir; giriş güvenliği (`TRUST_PROXY`, hesap başına kilit); çift kayıt için `Idempotency-Key`; sert kapanışta kayıpsızlık.
Sütundaki `#n` numaraları bulgu kimlikleridir.

| # | Sorun (bulgu) | İlke | Düzeltme |
|---|---|---|---|
| 49 | Ters vekil arkasında herkes tek IP sayılıyor; hesap başına deneme sınırı yok (#226, #343) | Güvenlik, işletilebilirlik | `TRUST_PROXY` (kapalı varsayılan; vekil adresi listesi önerilir, sayı ve `true` açılışta uyarı yazar) → Fastify `trustProxy`. Hesap başına giriş kilidi: tanımlayıcı başına 15 dk'da 5 başarısız → 15 dk kilit, 429 `login_locked` + `Retry-After`; var olmayan ad için aynı davranış (hesabın varlığı sızmaz); takma ad ve e-posta ayrı sayılır; sayaç bellekte |
| 50 | Son yöneticinin reddedilen hesap silme denemesi yine de vekâletleri düşürüyor ve yanlış bildirim gönderiyor (#14, #81, #159, #280) | Bütünlük | `eraseSelf` ön koşulları (hesap açık, son yönetici değil) her yan etkiden önce ve eşzamanlı denetler; imha ve vekâlet geri alma tek işlemde; bildirim ve `MEMBER_ERASED` işlem sonrası. Aynı ilke rol atama, rıza, doğrulama/red, PII erişimi ve bekleyen başvuru imhasına yayıldı: değişiklik ve denetim kaydı tek işlemde |
| 51 | Bekleyen başvurular demo hızıyla birkaç gerçek günde geri dönüşsüz imha ediliyor (#276) | KVKK, güvenlik | 180 gün gerçek duvar saatiyle ölçülür; gerçek açılış anı `meta` tablosundaki `identity.pending_since:<üye>`; kuraldan önceki başvurularda süre ilk bakımda başlar. KVKK.md §6 |
| 52 | Bağlantı kopunca yeniden gönderilen mesaj/öneri iki kez yayımlanıyor (#275) | Hata yönetimi, bütünlük | `Idempotency-Key`: istemci her denemeye UUID verir, belirsiz sonuçta aynı anahtarı kullanır; sunucu kullanıcı + yöntem + yol + anahtar için başarılı yanıtı 10 dk saklar, farklı gövdede 422 verir. API.md |
| 53 | Sert kapanışta (çökme, `taskkill /F`) bekleyen defter işlemleri kayboluyor; simüle saat geri gidiyor (#273, #281) | Bütünlük, işletilebilirlik | Şema sürümü 2: `ledger_outbox` (işlemsel outbox; açılışta yeniden gönderim, zincirdekiler ve bozuklar atılır). Saat `leaseUntil` kirasıyla ve veritabanındaki en son olay zamanından başlar: geri gitmez. Kimlik modülünün reddedilen defter kaydı artık yutulmaz (`identity.ledger_error`). MIMARI §4, §6 |
| 54 | Doğrulanmamış üyeye personel rolü verilince menüde görünüyor ama sayfalar hata veriyor (#106) | Tasarımda güvenlik, hızlı başarısızlık | Sunucu: 409 `not_verified` (rol geri almak serbest). İstemci: saf `derivePermissions` — görev rolleri ve bilirkişilik yalnız doğrulanmış hesapta geçerli |
| 55 | "Anlamlı görüş grubu" eşiği yönetmelikle değişince mesaj köprü puanı eski kuralla hesaplanıyor (#9, #251) | DRY, bütünlük | Tek kural `isSignificant` (`shared/src/decision.ts`): köprü puanı yürürlükteki yönetmeliğin σ_share/σ_min değerleriyle, öneri sayfası önerinin dondurulmuş parametreleriyle hesaplanır |
| 56 | İşlem sayfasındaki doğrulama gösterilen kaydın adresteki işleme ait olduğunu denetlemiyor (#218) | Güvenlik | `checkTxPage`: içerik–özet bağı, kanıtın işlem özeti ve imza adresteki özete bağlı |
| 57 | Disk dolunca gerçek neden yerine "no such savepoint" görünüyor (#212, #283) | Hata yönetimi | `Db.tx`: SAVEPOINT `try` içinde, geri alma hatası yutulup asıl hata iletilir; Promise döndüren geri çağrı reddedilir |
| 58 | Kayıt formu sunucunun kabul edeceği tam genişlikli takma adı reddediyor (#97, #166) | DRY, belge–kod tutarlılığı | Form kuralları sunucudakiyle aynı (NFKC, uzunluk sınırları, e-posta deseni); 80 girdilik eşitlik testi |
| 59 | Kura tohum bloğu bağlayıcı belgede `+2`, kodda `+1` (#286) | Belge–kod tutarlılığı, canlılık | **Karar: kod değişmedi, belge düzeltildi.** Defter boş blok üretmez; `+2` bloğu ek bir işlem gelmeden oluşmaz, boşta kalan defterde kura tartışma süresince beklerdi ve oylama raporsuz açılırdı. Güvenlik amacı `+1` ile de korunur (yükseklik taahhüt anında var olmayan bloğa işaret eder). Pay tek sabite bağlandı (`SEED_COMMIT_LEAD`); bilinen sınırlar ALGORITMA §12 madde 9'da |
| 60 | API belgesinde yanlış hata kodları; hesap silmede şifre yazmıyor (#310) | Belge–kod tutarlılığı | API.md hata kataloğu koddan çıkarıldı (`already_voted`, `inadmissible` kaldırıldı; `inadmissible_revision`, `consent_required`, `last_admin`… eklendi); `/api/me/erase` gövdesi |
| 61 | Mimari belge görüş grubu gizliliğini uygulamadan sıkı anlatıyor (#311) | Belge–kod tutarlılığı | MIMARI §5: iki dar istisna (silme oylamasında yazar kümesi, azınlık raporu) ve rollerin herkese açık olduğu |
| 62 | Algoritma belgesinde onay eşiği formülü yarım, karar kodunun yeri yanlış (#312) | Belge–kod tutarlılığı | ALGORITMA başlık notu ve §4.1: `Y·den > num·(Y+N)`; kod `shared/src/decision.ts`'te |
| 63 | README'deki "değiştirilemez maddeler" listesi yönetmelikle örtüşmüyor (#318) | Belge–kod tutarlılığı | 20 fıkra tek tek yazıldı (13 (2) ve 14 dahil; 20 ve 21'de yalnız korumalı fıkralar) |
| 64 | Test raporunda eski sayılar ve düzelmiş bir hatayı "düzeltilmedi" gösteren not (#242, #309, #319) | Belge–kod tutarlılığı | Modül tabloları koddan yeniden sayıldı (sunucu ve web), tohum denetimi 19, uç nokta 104; gözlem "düzeltildi" olarak yeniden yazıldı |
| 65 | Belgeler evre geçişlerinin yalnız zamanlayıcıdan geldiğini söylüyor (#21, #44) | Belge–kod tutarlılığı | README, ALGORITMA §3, MIMARI, `lifecycle.ts`/`forum-contracts.ts` yorumları ve Yönetim paneli: iki geçiş yazarın eylemidir; hepsi `applyTransition` ile yazılır |
| 66 | "Modüller yalnızca arayüzle görür" anlatımı kodla örtüşmüyor (#22, #78, #170, #191) | Belge–kod tutarlılığı | MIMARI §2: modüler monolit gerekçesi, tablo sahipliği haritası, zorlanan sınırlar ve HTTP katmanındaki iki istisna; küme yeniden hesabının anonim olduğu API.md'de |
| 67 | KVKK belgesi otomatik reşitlik güncellemesini işletmeci işi gibi anlatıyor (#315) | Belge–kod tutarlılığı | KVKK §8 madde 7: açılışta ve her 10 dakikada kendiliğinden (`startIdentityMaintenance`) |
| 68 | Web kılavuzu çağıranı olmayan işlevleri listeliyor, yenileri eksik (#153, #317) | Belge–kod tutarlılığı | `web/src/README.md`: 104 işlevin tamamı, çağıranı olmayanlar işaretli; düzeltme talebi, kefalet/yakınlık geri alma, `Idempotency-Key`, `derivePermissions`, `checkTxPage` eklendi |
| 69 | Kod yorumlarında eski ya da yanlış açıklamalar (#114, #262, #325) | Temiz kod | "wave-1/2" etiketleri, yanlış § atıfları, `LIMIT` ve `nickname_norm` yorumları, `applyTransition` açıklamasının yeri, `AiServiceExt` yorumu düzeltildi |

Doğrulama (5 Ekim 2026, dördüncü tur sonrası):

| Kontrol | Sonuç |
|---|---|
| Sunucu testleri | 100 dosya, 1020/1020 |
| Web birim testleri | 45 dosya, 795/795 |
| Tip denetimi | temiz |

Kısmi kalanlar:
- Giriş kilidi ve `Idempotency-Key` deposu süreç belleğindedir (yeniden başlatmada sıfırlanır, çok süreçli dağıtımda paylaşılmaz); kalıcılaştırma şema değişikliği ister.
- Elektrik kesintisinde (işletim sistemi düzeyi) doğrulayıcı depolarından son blok kaybolabilir (`synchronous=NORMAL`); giden kutusu satırı depolar diske indirilmeden silinmediğinden işlem kaybolmaz, ama kaybolan bloğun yüksekliği/kanıtı yeniden üretilen blokla değişebilir. Gerçek bir güç kesintisi sınanmadı (sıra birim testinde).
- Kura: taahhüt anında oylanmakta olan bir blok varsa tohum onun hash'i olabilir; yalnız doğrulayıcıları işleten sunucu bunu görebilir (ALGORITMA §12 madde 9, bilinen sınır a). Taahhüdün defter işlemi taşımaması sorunu `SEED_COMMIT` ile giderildi.
- Giriş kilidi belleği: 10 000 tanımlayıcının hepsi kilitliyse kilidi en erken bitecek olan atılır; bunun için ~50 000 başarısız deneme gerekir (kilitsiz kayıtlar önce atılır).
- Reşitlik hesabı simüle saatle yapılır (`TIME_SCALE > 1` iken gerçek takvimden hızlı).
- Kayıt formu kuralları sunucudaki doğrulamanın kopyasıdır (eşitlik testi var); kalıcı çözüm kuralları `shared`'e taşımaktır.
- Doğrulanmamış (bekleyen/askıdaki) hesaba görev rolü verilemez: sunucu 409 `not_verified` döner, Yönetim › Roller'de ilgili onay kutuları kapalıdır (`roleCheckbox`; verilmiş bir rolü kaldırmak serbest); rolü olan ama doğrulanmamış hesapta `RequireRole` asıl nedeni söyler ("görev rolleri yalnızca doğrulanmış hesapta geçerlidir").
- Vekâletle sayılan oylar (`via = "delegated"`) taahhütle denetlenemez; `verifyTally` yalnız `revealHash` eşleşmesini ve yeniden sayımı doğrular, arayüz bunu "Neyi denetler?" metninde söyler (ALGORITMA §11).
- e2e `06 › bütünlük uyarısı` testi tohumun oy geçmişine bağlıdır: demo verisinin zaman çizelgesi gerçek tarihe göre kurulduğundan oylar günden güne küçük farklarla değişir ve 14 üyenin ikili uyumu %90 eşiğini geçmeyebilir; o zaman test kendi atlama dalına girer (`[atlandı]` ek açıklaması, kural sunucu ve birim testlerinde sınanır). Kalıcı çözüm testin kendi oy geçmişini üretmesidir (yeni üyeler + üç ek oylama).
- `server/package.json` içindeki `rdf-canonize` ve `@rdfjs/data-model` kaynakta hiçbir yerde içe aktarılmaz (araştırma sırasında denendi; bkz. ARASTIRMA §6.3).

### Dördüncü turun bağımsız incelemesi (20 bulgu, 5 Ekim 2026)

Üç bağımsız inceleyici (güvenlik, bütünlük, belge) dördüncü turu yeniden denetledi. Bulguların hepsi önce doğrulandı; hiçbiri
reddedilmedi.

| # | Bulgu | Düzeltme |
|---|---|---|
| 70 | Web istemcisi belirsiz kalan eski isteğin anahtarını, aynı kaynağa sonradan başka istek gitse de yeniden kullanıyordu: "Evet (belirsiz) → Hayır → Evet" eski makbuzu döndürüyor, oy "Hayır" kalıyordu (takip/bırak, taslak A→B→A, vekâlet için de) | Anahtar yalnız o kaynağa (sorgusuz yol ya da doğrudan üst/alt kaynak) yapılan **en son** istek bu belirsiz denemeyse yeniden kullanılır; başka bir değiştiren istek eskisini unutturur (`client.ts`, 9 yeni test) |
| 71 | Giriş sayacı belleği dolunca kilitli kayıt da "en eski" diye atılıyordu (rastgele adlarla kilit silinebiliyordu) | Önce süresi dolmuşlar, sonra kilitsiz kayıtlardan en az denemesi olan atılır; kilitli kayıt ancak hepsi kilitliyse (`login-throttle.ts`) |
| 72–73, 76 | `InProcessLedger.submit` işlem içinden çağrılınca işlemi hemen doğrulayıcılara iletiyordu: hesap silme geri alınırsa `DELEGATION` "revoke" deftere yazılıyordu | `Db.afterCommit` (savepoint kapsamlı, geri almada atılır); işlem içinden gönderimde satır işlemde yazılır, iletim COMMIT'e ertelenir. Hesap silme artık defterde de atomik |
| 74 | Giden kutusu yazım hatası işlem içindeyken yutuluyordu: işlemin yarısı kalıcı oluyor, "no such savepoint" geri geliyordu | İşlem içinde hata yutulmaz; `Db`, SQLite işlemi kendiliğinden geri aldıysa iç hatayı yakalayıp devam eden kodun sonraki deyimlerinde de asıl hatayı fırlatır (autocommit'e taşma yok); günlüğe `errcode`/`errstr` |
| 75 | Kura canlılığı: uzlaşma, karşı panel, hak bayrağı ve bilirkişi talebi yollarındaki taahhüt bir defter işlemi taşımıyordu; boştaki defterde zorunlu panel çekilmeyebiliyordu | Her taahhüt yolunda aynı işlemde `SEED_COMMIT {proposalId, height, phase}` (`commitSeedBlock`); +1 bloğunu bu işlem oluşturur ve taahhüt defterde denetlenebilir. Pay `+1` kaldı (ALGORITMA §12 madde 9 güncellendi) |
| 77 | Elektrik kesintisinde giden kutusu satırı, blok diske yazılmadan siliniyordu | Satırlar doğrulayıcı depoları `sync()` (WAL denetim noktası = fsync) edildikten sonra silinir (tick, `flush`, kapanış) |
| 78 | Simüle saat çalışırken duvar saati geri alınınca geri gidebiliyordu | `ScaledClock.now()` son verdiği andan küçük değer vermez; "ileri al" bu sırada da tam etkilidir |
| 79 | Şema sürümü 2'den geri dönüş yolu yoktu | MIMARI §7: düzgün kapanış, yedek, boş giden kutusu denetimi, `DROP TABLE ledger_outbox` + `schema_version = 1` (belgelenen adımlar testle sınanır) |
| 80 | Belge tutarsızlıkları: web kılavuzunda rol kutuları ters anlatılıyordu; "roller kişisel veri değildir" KVKK envanteriyle çelişiyordu; var olmayan `decideRevote`/`drawExpertPanel` adları; TEST_RAPORU başlık tarihi; "güvenlik süreleri gerçek saatle" genellemesi (YZ kotası ve oturum süresi simüle saatle); KVKK §4.5 kapsam dışı listesi eksik; KVKK hesap silme satırı; `forum-contracts.ts` yorumu; ARASTIRMA'da `@rdfjs/data-model`; `schema.sql` yorumu | Hepsi koda göre düzeltildi. Bilirkişi yeterlilik metni uzunluk hatasının kodu `invalid_credentials` (girişteki 401 ile çakışıyordu) yerine `credentials_length` oldu |

Doğrulama (5 Ekim 2026, inceleme düzeltmeleri sonrası):

| Kontrol | Sonuç |
|---|---|
| Sunucu testleri | 100 dosya, 1038/1038 |
| Web birim testleri | 45 dosya, 804/804 |
| Tip denetimi (shared, server, web, e2e) | temiz |
| Derleme (web) | temiz |
| e2e | 68/68 (~10 dk) |

## 3e. Test döngüsü tur 1: canlı sunucuda doğrulanmış kusurlar (5 Ekim 2026)

Tohumlanmış geçici veriyle çalışan gerçek sunucular, büyük yapay veri ve tarayıcı taramalarıyla bulunan, yeniden üretilerek doğrulanmış
kusurlar. Her düzeltme kök nedeninden yapıldı ve bir regresyon testiyle bağlandı; e2e regresyonları `e2e/tests/08-tur1-regresyon.spec.ts`.

| Alan | Kusur | Düzeltme |
|---|---|---|
| KVKK | Hesabını silen bilirkişi "etkin bilirkişi" listeleniyor, yeterlilik beyanı düz metin kalıyor, kabul ettiği görev asılı kalıyordu | Silme işleminde aynı `db.tx` içinde kayıt kapanır (`removed`, beyan ve yaptırım notu imha, alanlar `[]`, bekleyen görev yedeğe, `EXPERT_IN` iptal); listeler ve profil kapanmış hesabı süzer; eski veri açılışta onarılır (KVKK §6) |
| Yetki | Rolü olan ama doğrulanmamış hesap gizli mesajın sürümlerini okuyabiliyordu | `forum/util.ts` `hasRole` doğrulanmış hesap ister; 403 `inactive` |
| Doğrulama | Bilirkişi alanı olarak keyfî URL/IRI; kapanmış hesaba takip/kefalet/yakınlık; alt konuda eksik `parentTopicId` 404; yalnız noktalama ad/takma ad/adres; dolu alana "zorunludur" | 400 `unknown_domain`; 409 `invalid_state`; 400 `validation` + alan; harf/rakam şartı (sunucu, kayıt formu ve Profil aynı kural); "… metin olmalıdır" |
| HTTP | Bozuk URL ve uzun parametre Fastify'ın İngilizce gövdesiyle dönüyordu; çerçeveleme koruması yoktu; boş `types=` varsayılan kenarları veriyordu | `frameworkErrors` → tek tip 400 `validation`, `maxParamLength` 256; her yanıtta `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`; boş liste hiç kenar (istemci de `types=` gönderir) |
| Güvenlik | Şifre teyidi isteyen uçlar kilitsizdi; şifre değişikliğiyle yarışan giriş iptalden kaçıyordu; tek kullanıcı Idempotency deposunu doldurup başkalarının çift kayıt korumasını düşürebiliyordu; düzeltme talebi üyelik kâhiniydi; Ayarlar'da adres değişince eski belirteç yeni adrese gidiyordu | Üye başına şifre teyidi kilidi (429 `login_locked`); koşullu oturum ekleme; gövde bırakma + kullanıcı başına 4 MB kota; çakışma karar anına taşındı; önce eski sunucuda çıkış, istemci belirteci unutur |
| Doğruluk | `verifyTally` taahhütlü oyun "vekâletle" yeniden etiketlenmesini ve \|E\|'yi aşan açıklamayı yakalamıyordu; "Oyum kayıtlı mı?" yalnız en yeni 500 taahhüde bakıyordu; tarayıcıdaki sayım doğrulaması hız sınırında sahte "BAŞARISIZ" veriyordu | Yapısal denetimler shared `verifyTally`'de (ALGORITMA §12.23; sunucu, tohum ve tarayıcı aynı işlev); `GET /api/ledger/txs` `ballotId`/`round` süzgeci; blok blok doğrulama, 429/ağ/5xx geçici ("sonuç alınamadı") |
| Gösterim | Sınıra yakın değer sınıra eşit görünüyordu ("%66,68 ≥ %66,7", "0,30 \| 0,30 ✘"); değişen oy "6 dakika sonra" görünüyordu | Değer ve sınır aynı hassasiyette (sunucu metni ve sonuç kartı); göreli zaman sunucu saatiyle |
| Başarım | Soğuk `GET /api/ledger/verify` sunucuyu saniyelerce donduruyordu; pano her yoklamada graf istatistiklerini hesaplıyordu; toplu evre geçişi olay döngüsünü kilitliyordu; 2000 mesajlı tartışma yavaş telefonda kullanılamıyordu | Yerel Ed25519 + açılışta arka planda ısınma; önbellekli `permanentLoser`; 10 ms dilimlerle yol verme ve yönetici isteğinde 20 sn bütçe (`pending: true`, arayüzde uyarı); bellekte tutulan ileti nesneleri ve ilk 50 ileti dizisi |
| Erişilebilirlik | 'Yaşanmadı' evre etiketi ve numarası < 4,5:1; odak yapışkan çubukların altında; sekme panelinde odak çerçevesi yok; yüklenen düğmede odak kayboluyor; durum iletileri duyurulmuyor; alan kenarı < 3:1; bulunamadı sayfasında başlık/h1 yok; kategori hatası bağlı değil; kaydırılabilir yük kutusu odaklanamıyor | Opaklık yok (numara için boş nokta + kesikli çerçeve); `scroll-padding`; `:focus-visible` çerçevesi; `aria-disabled` + bilinçli odak taşıma; `role=status` bölgeleri; `--input-border`; başlık ve h1; `aria-describedby`; `ScrollPre` |
| Belge ve dağıtım | API.md'de 405 ve `details` iddiaları koda uymuyordu; asgari Node sürümü yanlıştı (22.13–22.15'te `isTransaction` yok); `gradlew` çalıştırılabilir değildi | API.md düzeltildi ve sözleşme testiyle bağlandı; `engines` `^22.16.0 \|\| >=24`, açılışta anlaşılır ileti, CI matrisinde 22.16; `gradlew` 100755 |

Doğrulama (5 Ekim 2026, test döngüsü tur 1 sonrası):

| Kontrol | Sonuç |
|---|---|
| Tip denetimi (shared, server, web, e2e) | temiz |
| Sunucu testleri | 110 dosya, 1094/1094 |
| Web birim testleri | 54 dosya, 896/896 |
| Derleme (web) | temiz |
| e2e | 75/75 (9,8 dk; 8 dosya, yenisi `08-tur1-regresyon`) |

Kalanlar (bilinçli ya da ayrı iş):

- **Kayıtta üyelik sorgulanabilirliği.** `POST /api/auth/register` yinelenen TCKN/e-postayı 409 ile bildirmeye devam eder (KVKK §8.5'te
  bilinen sınır). Genel bir ileti yetmez; başvuruyu her durumda kabul edip çakışmayı kayıt memuruna işaretlemek kör indeks tekilliğini,
  ana anahtar dönüşümünü, e-postayla girişi ve kayıt formunu değiştirir: ürün kararı bekliyor. Düzeltme talebi ucu artık kâhin değildir.
- **Defter okuma bütçesi.** Tarayıcıdaki doğrulama istekleri taahhüt sayısıyla değil blok sayısıyla büyür; 500'lük listenin dışındaki eski
  taahhütler, doğrulanmış bir bloğu paylaşmıyorsa yine işlem başına bir istek tutar. Toplu kanıt ucu ya da salt okunur defter GET'leri
  için ayrı hız kovası ayrı iş olarak bırakıldı.
- **Mesaj listesi sayfalaması.** Sunucuda `messages.list()` hâlâ tüm diziyi döndürür (istemci ilk 50 ileti dizisini çizer); imleçli
  sayfalama ayrı iş.
- **Graf istatistikleri.** `/api/graph/stats` ve görselleştirme soğuk önbellekte uzlaşı grafını (Louvain) eşzamanlı hesaplar; panodan
  ayrıldı, işçi iş parçacığına taşımak ayrı iş. `vote_open` bildirimleri seçmen başına satırdır (şema değişikliği gerektirir).
- **CORS ön uçuşu.** Ön uçuş başlıkları olmayan `OPTIONS` isteği `@fastify/cors`'un düz metin 400'ünü alır (tek tip gövde değil).
- Daha önce alınmış yalnız ayraçlı takma adlar (`...`) olduğu gibi kalır; sahibi Profil'den değiştirebilir.

## 4. Bilinçli olarak ertelenenler

Bunlar kayıt altında; kullanım sınırları nedeniyle bu turlarda yapılmadı.

- **Büyük servislerin parçalanması (SRP, KISS).** Öneri servisi yaklaşık 1100 satır, bilirkişi servisi 930, kimlik servisi 740. `decide()` 284 satır, `ValidatorNode` 1000 satır.
- **Kayıt (log) soyutlaması.** Sunucu günlüğü hâlâ doğrudan `console` ve Fastify günlükçüsü üzerinden yazılıyor. Şema göç mekanizması 3. turda eklendi.
- **Bilinçli tasarım kararı olarak bırakılanlar** (gerekçe, tablo sahipliği ve zorlanan sınırlar: MIMARI.md §2):
  - modüllerin ortak SQLite tablolarını çoğunlukla salt okunur sorgulaması (modüler monolit; sütun düzeyinde iki yazma istisnası MIMARI §2.1'de);
  - hata türünde HTTP durum kodunun taşınması;
  - tek `BALLOT_REVEAL` işleminin kapasite sınırı (yaklaşık 20 bin oy);
  - süreç içi 4 doğrulayıcılı defter.
- **Kalite kapıları.** Sıkı derleyici bayrakları ve belgelerdeki diğer sayı ve iddia uyumsuzlukları. CI iş akışı ve mimari bağımlılık testi 3. turda eklendi.

Tam bulgu listesi (347 madde; dosya, satır, kanıt ve önerilen düzeltmeyle) inceleme oturumunda saklanmıştır. İstenirse sonraki turlarda öncelik sırasıyla işlenebilir.
