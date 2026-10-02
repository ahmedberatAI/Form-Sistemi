# Yazılım Mühendisliği İlkeleri İncelemesi

> Tarih: 2 Ekim 2026.
> Yöntem: 18 ilke ayrı ayrı incelendi. Her ilke için bir inceleyici (Claude Sonnet 5.5) bütün depoyu salt okunur taradı ve her bulguya dosya, satır ve kanıt ekledi.
> Bulgular tekilleştirildi ve kod üzerinde doğrulandı. İki turda toplam 31 sorun düzeltildi (her turda yaklaşık 15); diğerleri aşağıda kayıtlıdır.

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
- #29: Açık metin trafiği ve sunucu adresi değişince belirteç silme demo için bırakıldı.

## 4. Bilinçli olarak ertelenenler

Bunlar kayıt altında; kullanım sınırları nedeniyle bu turda yapılmadı.

- **Büyük servislerin parçalanması (SRP, KISS).** Öneri servisi yaklaşık 1100 satır, bilirkişi servisi 930, kimlik servisi 740. `decide()` 284 satır, `ValidatorNode` 1000 satır.
- **Kayıt (log) soyutlaması ve şema göç mekanizması.** Eksik indeksler 2. turda eklendi.
- **Takma ad değişince bildirim metinlerinin metin eşleştirmesiyle yeniden yazılması.**
- **Bilinçli tasarım kararı olarak bırakılanlar** (gerekçesi MIMARI.md'de):
  - modüllerin ortak SQLite tablolarını salt okunur sorgulaması (modüler monolit);
  - hata türünde HTTP durum kodunun taşınması;
  - tek `BALLOT_REVEAL` işleminin kapasite sınırı (yaklaşık 20 bin oy);
  - süreç içi 4 doğrulayıcılı defter.
- **Kalite kapıları.** Sıkı derleyici bayrakları, mimari bağımlılık testleri, CI iş akışı ve belgelerdeki diğer sayı ve iddia uyumsuzlukları.

Tam bulgu listesi (347 madde; dosya, satır, kanıt ve önerilen düzeltmeyle) inceleme oturumunda saklanmıştır. İstenirse sonraki turlarda öncelik sırasıyla işlenebilir.
