# Yazılım Mühendisliği İlkeleri İncelemesi

> Tarih: 2 Ekim 2026.
> Yöntem: 18 ilke ayrı ayrı incelendi. Her ilke için bir inceleyici (Claude Sonnet 5.5) bütün depoyu salt okunur taradı ve her bulguya dosya, satır ve kanıt ekledi.
> Bulgular tekilleştirildi ve kod üzerinde doğrulandı. Önceliği en yüksek 15 sorun düzeltildi; diğerleri aşağıda kayıtlıdır.

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

## 4. Bilinçli olarak ertelenenler

Bunlar kayıt altında; kullanım sınırları nedeniyle bu turda yapılmadı.

- **Büyük servislerin parçalanması (SRP, KISS).** Öneri servisi yaklaşık 1100 satır, bilirkişi servisi 930, kimlik servisi 740. `decide()` 284 satır, `ValidatorNode` 1000 satır.
- **Kayıt (log) soyutlaması, şema göç mekanizması ve sıcak sorgular için eksik indeksler.**
- **Kapanış sırası.** HTTP en son kapanıyor ve kapanış zaman sınırsız.
- **Veri klasörü için tek örnek kilidi.** İki sunucu aynı klasörü paylaşırsa defter kaydı kaybolabiliyor.
- **Geri alınan veritabanı işleminden sonra deftere düşen "hayalet" kayıt.**
- **İç içe işlemde geri alınan bildirimlerin iletilmesi.**
- **Takma ad değişince bildirim metinlerinin metin eşleştirmesiyle yeniden yazılması.**
- **YZ uçlarında kullanıcı başına kota.**
- **Bilinçli tasarım kararı olarak bırakılanlar** (gerekçesi MIMARI.md'de):
  - modüllerin ortak SQLite tablolarını salt okunur sorgulaması (modüler monolit);
  - hata türünde HTTP durum kodunun taşınması;
  - tek `BALLOT_REVEAL` işleminin kapasite sınırı (yaklaşık 20 bin oy);
  - süreç içi 4 doğrulayıcılı defter.
- **Kalite kapıları.** Sıkı derleyici bayrakları, mimari bağımlılık testleri, CI iş akışı ve belgelerdeki diğer sayı ve iddia uyumsuzlukları.

Tam bulgu listesi (347 madde; dosya, satır, kanıt ve önerilen düzeltmeyle) inceleme oturumunda saklanmıştır. İstenirse sonraki turlarda öncelik sırasıyla işlenebilir.
