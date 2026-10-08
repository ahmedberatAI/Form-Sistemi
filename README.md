# Forum Sistemi — Katılımcı Yönetişim Forumu

Herkesin konu açabildiği ve düzenleme teklif edebildiği bir katılımcı yönetişim platformu. Kararlar **"Köprülü Çoğunluk" (KÇ)**
algoritmasıyla alınır: genel çoğunluk gerekir ama yetmez, anlamlı her görüş grubundan da asgari destek aranır. Aynı React kodu
hem **web sitesi** hem **Android uygulaması** (Capacitor) olarak çalışır.

Sistemin bileşenleri:

- yönetmeliği denetleyen bir **ontoloji** (RDF/Turtle, N3 kuralları, SHACL),
- 4 doğrulayıcılı **dağıtık defter** (Tendermint tarzı BFT, Merkle kanıtları),
- tohumlu kurayla seçilen **bilirkişiler**,
- danışman **yapay zekâ** (Claude; anahtar yoksa tam işlevli çevrimdışı sezgisel mod),
- insan ilişkilerini tutan bir **graf** (takip, kefalet, vekâlet, yakınlık).

> **Belgeler:** [Karar algoritması (bağlayıcı)](docs/ALGORITMA.md) · [Mimari](docs/MIMARI.md) · [REST API](docs/API.md) ·
> [Yönetmelik ontolojisi](docs/YONETMELIK.md) · [KVKK](docs/KVKK.md) · [Simülasyon](docs/SIMULASYON.md) ·
> [Test raporu](docs/TEST_RAPORU.md) · [Araştırma raporu](docs/ARASTIRMA.md) · [Mühendislik ilkeleri incelemesi](docs/MUHENDISLIK.md) ·
> [Arayüz hafifletme planı](docs/ARAYUZ_PLANI.md) · [Sunum kopya kâğıdı](docs/SUNUM.md)

---

## 1. Kurulum ve çalıştırma

**Gereksinimler:** Node.js 22.16 ya da üstü (22.x serisinde) veya Node.js 24+ (yerleşik `node:sqlite`; yerel derleme gerekmez),
npm ≥ 10. Docker gerekmez. Veritabanı katmanı işlem durumunu `DatabaseSync.isTransaction` ile okur. Bu özellik Node 22.16.0 ve
24.0.0'da geldi; 22.13–22.15'te ve 23.x'te yoktur. Bu sürümlerde tohum ve sunucu ilk açılışta "Bu sunucu Node.js 22.16 ya da üstü
… gerektirir" iletisiyle durur (`package.json` `engines`: `^22.16.0 || >=24`). Sürümünüzü `node -v` ile denetleyin.

```bash
npm install                          # kökte (workspaces: shared, server, web)
npm run seed -- --reset              # demo verisi: server/data (≈35 sn; --reset mevcut demo verisini siler)
npm run build                        # web arayüzü → web/dist
npm start                            # sunucu: http://localhost:4000 (web/dist'i de sunar)
```

Tarayıcıda **http://localhost:4000** adresini açın.

**Windows'ta tek tıkla başlatma:** proje klasöründeki `baslat.cmd` dosyasına çift tıklayın (ya da ona bir masaüstü kısayolu verin; simge `scripts/forum.ico`). Sunucuyu küçültülmüş bir pencerede başlatır ve hazır olunca uygulamayı tarayıcıda açar; sunucu zaten açıksa yalnız tarayıcıyı açar. `setx` ile kaydedilmiş `ANTHROPIC_API_KEY` değerini kendisi bulur; ilk açılışta bağımlılıkları kurup web arayüzünü derler. Kapatmak için sunucu penceresini kapatın.

**Sunum modu:** `sunum.cmd` (ya da masaüstündeki "Forum Sistemi - Sunum" kısayolu) isteğe bağlı olarak mevcut veriyi yedekleyip taze demo verisi üretir (bütün hesapların şifresi `deneme123`; tohumda `TOHUM_SIFRE` ortam değişkeni) ve sunucuyu gerçek zamanlı saatle (`TIME_SCALE=1`) açar. Hesaplar ve önerilen gösterim akışı: [docs/SUNUM.md](docs/SUNUM.md).

**Arayüz:** varsayılan görünüm **Sade**dir: ilk ekran 'ne oldu, benden ne bekleniyor, ne kadar sürem var' sorularını yanıtlar;
tablo, formül ve hash gibi ayrıntılar adlandırılmış açılırlarda bir dokunuş ötededir. **Ayarlar › Görünüm › 'Tam — tüm ayrıntılar
açık'** bütün açılırları tek seçimle açar (gösterim için). Hocaya sistemi göstermek için **Keşfet ve doğrula** sayfası (`/kesfet`;
Ana sayfa vitrinindeki 'Gösterim rehberi ›', masaüstü alt bilgisi ya da mobil 'Daha fazla'): yedi bileşen canlı durumuyla, mevcut
veriden kurulan 7 adımlı gösterim rehberi, 8 temel ilke ve yönetmelik terimlerinin sözlüğü. Yönetmelik terimleri ekranda aynen
kalır; dokununca günlük karşılıkları açılır. Ayrıntı: [Arayüz hafifletme planı](docs/ARAYUZ_PLANI.md).

**Geliştirme modu** (sıcak yeniden yükleme):

```bash
npm run dev                          # ikisi birlikte: [sunucu] ve [web] önekli tek çıktı; Ctrl+C ikisini de kapatır
npm run dev:server                   # yalnız API, port 4000
npm run dev:web                      # yalnız Vite, port 5173 (/api → VITE_API_TARGET ya da localhost:$PORT, varsayılan 4000)
```

`npm run dev`, `scripts/dev.mjs` ile iki süreci başlatır (ek bağımlılık yok; Windows cmd/PowerShell, macOS ve Linux'ta aynı
çalışır). Süreçlerden biri beklenmedik biçimde biterse diğeri de kapatılır.

**Kontroller:**

```bash
npm run typecheck                    # shared + server + web
npm test                             # sunucu (110 dosya, 1094) + web (54 dosya, 896) testleri
npm run sim -w server                # Monte Carlo simülasyonu → docs/SIMULASYON.md
```

#### Uçtan uca testler

```bash
npx playwright install chromium      # bir kez: test tarayıcısı
npm run e2e                          # Playwright, 8 senaryo dosyası, 75 test (≈11 dk)
npm run e2e:typecheck                # e2e/ kaynaklarının tip denetimi
```

`e2e/` klasöründeki testler gerçek sunucuyu (`server/src/index.ts`) tarayıcıyla sürer. Küresel kurulum `web/dist` yoksa ya da
kaynaklardan eskiyse web'i derler, geçici bir klasörde demo verisini tohumlar (`DATA_DIR=<geçici> npm run seed -- --reset`); her test
dosyası bu verinin taze bir kopyasıyla **4100** portunda kendi sunucusunu açar (`TIME_SCALE=1`, yüksek `RATE_LIMIT_*`) ve sonunda
kapatır (Windows'ta `taskkill /T /F`). 4000'deki sunucunuza ve `server/data`'ya dokunulmaz. Senaryolar: 360 px'de tüm sayfaların
taraması, kayıttan kesin sayıma oylama akışı, silme talebi, itiraz/uzlaşma, defter kurcalama ve düğüm çökmesi, sade arayüz
sözleşmeleri (Sıradaki adım, 'Bu sayfada', derin bağlantılar, 'Tam' görünüm, kontrast; Faz 3: sözlük penceresi, Keşfet ve
gösterim rehberi, görev sayısı rozeti, bildirimler, yeni öneri formu, Profil/Ayarlar/Konular), hesap güvenliği (hesap başına giriş kilidi
429, hesap silme kaskadı, `Idempotency-Key`) ve test döngüsü regresyonları (çerçeveleme koruması, silinen bilirkişinin kaydı, boş graf
süzgeci, "Oyum kayıtlı mı?" pusula süzgeci, sunucu adresi değişince belirteç, kayıt formu kuralları, şifre teyidi kilidi)
([TEST_RAPORU §3](docs/TEST_RAPORU.md)). Seçenekler: `E2E_PORT` (taban port), `E2E_BUILD=1|0` (web'i her zaman derle / yalnız `web/dist` yoksa derle),
`E2E_KEEP=1` (geçici klasörü ve sunucu günlüklerini bırak). Rapor: `e2e/playwright-report/index.html`.

### Simüle saat

Demo için zaman **hızlandırılmıştır**: `TIME_SCALE=60` iken 1 simüle saat ≈ 1 gerçek dakika. Bu yüzden 72 saatlik bir tartışma
gerçekte 72 dakika sürer ve takvim tutarlı kalır. Yönetici **Yönetim** sayfasından saati ileri alabilir (+1, +6, +24, +72, +168 saat).

Evre geçişlerini çoğunlukla sunucudaki zamanlayıcı yürütür (süre dolunca, destek eşiği aşılınca, oylama kapanınca…). İki geçiş
yazarın kendi eylemiyle, zamanlayıcı beklenmeden olur: **'Destekçi toplamaya gönder'** (taslak → destek) ve **'Geri çek'**.
Bütün geçişlerin yazıldığı tek yer `applyTransition`'dır (durum, `phase_events` satırı ve `PHASE_CHANGED` defter kaydı); web ve
Android istemcileri bu yüzden hiçbir zaman farklı durum görmez ([ALGORITMA §3](docs/ALGORITMA.md)).

Alan mantığı simüle saati kullanır. **Dört süre gerçek duvar saatiyle ölçülür** ve `TIME_SCALE`'den ya da 'ileri al'dan etkilenmez:
doğrulanmayan başvurunun 180 günlük imhası, hesap başına giriş kilidi, `Idempotency-Key` saklama süresi ve IP hız sınırı (penceresi
ve `Retry-After`'ı). Oturum süresi (180 gün), reşitlik hesabı ve saatlik YZ analiz kotası ise simüle saatledir. Simüle saat geri
gitmez: ne sunucu sert biçimde kapanınca (çökme, `taskkill /F`) açılışta ne de çalışırken duvar saati geri alınınca
([MIMARI §6](docs/MIMARI.md)).

### Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT`, `HOST` | `4000`, `0.0.0.0` | Sunucu adresi |
| `DATA_DIR` | `server/data` | Veritabanı, defter düğümleri, anahtarlar |
| `TIME_SCALE` | `60` | Simüle saat hızı |
| `ANTHROPIC_API_KEY` | — | Varsa YZ Claude ile çalışır; yoksa çevrimdışı sezgisel mod |
| `AI_MODEL` | `claude-haiku-5-5` | Claude modeli. Sunucu tarafı ret yedeği yalnız destekleyen modellerde (Opus 5.5, Sonnet 5.5, Fable 5.1) gönderilir; Haiku 5.5'te ret, çevrimdışı sezgisele düşer |
| `AI_ENABLED` | `auto` | `false` → her zaman çevrimdışı |
| `MASTER_KEY`, `TOKEN_KEY`, `VOTE_KEY` | `DATA_DIR/keys/*` (otomatik üretilir) | Kimlik kasası, oturum, ballotId anahtarları (üretimde KMS/ortam değişkeni) |
| `NEW_MASTER_KEY` | — | Yalnız ana anahtar dönüşüm betiği için yeni anahtar (`server/scripts/rotate-master-key.ts`, [KVKK §8.1](docs/KVKK.md)) |
| `RATE_LIMIT_GLOBAL` | `300` | Genel hız sınırı (istek/dk/IP); `0` → kapalı |
| `RATE_LIMIT_AUTH` | `20` | `/api/auth/*` (giriş, kayıt, çıkış) hız sınırı; `0` → kapalı. Uçtan uca testlerde yükseltin, üretimde düşük tutun |
| `TRUST_PROXY` | kapalı | Ters vekil (nginx, Caddy…) arkasında istemci IP'sini `X-Forwarded-For`'dan okur; hız sınırı bu adrese göre sayar. `127.0.0.1` ya da `loopback,10.0.0.0/8` (vekil adresleri; **önerilen**), `1`–`32` (vekil sayısı), `true` (tüm vekiller). Ayrıntı ve nginx örneği: aşağıdaki "Ters vekil arkasında" |
| `CORS_ORIGINS` | `http://localhost,http://localhost:5173,capacitor://localhost,https://localhost` | İzin verilen kökenler |
| `LEDGER_BLOCK_MS` | `400` | Blok aralığı |
| `LOG_LEVEL` | `warn` | Sunucu günlük düzeyi (`info` her isteği yazar) |

Giriş kilidi ve `Idempotency-Key` saklama sınırları ortam değişkeni değil kod sabitidir ([API.md](docs/API.md)).

#### Ters vekil (nginx, Caddy) arkasında

Sunucu bir ters vekilin arkasındaysa tüm bağlantılar vekilin adresinden gelir; varsayılan kurulumda hız sınırı (`RATE_LIMIT_*`,
IP başına) bütün kullanıcıları **tek kova** sayar. Vekil gerçek istemci adresini `X-Forwarded-For` başlığıyla iletir; `TRUST_PROXY`
sunucuya bu başlığa **kimden** güveneceğini söyler:

| `TRUST_PROXY` | Anlamı |
|---|---|
| boş, `false`, `hayır`, `off`, `0` (varsayılan) | Kapalı. Bağlantının kendi adresi kullanılır, `X-Forwarded-For` yok sayılır. |
| `127.0.0.1`, `loopback,10.0.0.0/8` (**önerilen**) | Virgülle ayrılmış vekil adresleri: IP, IP/önek (CIDR) ya da `loopback`, `linklocal`, `uniquelocal`. Yalnız bu adreslerden gelen `X-Forwarded-For`'a güvenilir; istemcinin kendi yazdığı sahte adresler sağdan ayıklanır. |
| `1`–`32` | Bağlantıyı kuran adres doğrulanmadan en yakın n atlama vekil sayılır. Yalnız sunucuya vekili atlayarak ulaşılamıyorsa (`HOST=127.0.0.1` ya da güvenlik duvarı) kullanın. |
| `true`, `evet`, `on` | Tüm vekillere güven: `X-Forwarded-For`'un en soldaki adresi istemci sayılır. İstemci başlığı kendisi yazabiliyorsa hız sınırı atlatılabilir. |

Sayı ve `true` başlangıçta `[yapılandırma]` uyarısı yazar; geçersiz değer sunucuyu Türkçe bir hatayla durdurur. Vekilsiz yayında
**açmayın**: herkes `X-Forwarded-For` göndererek istediği IP'yi taklit eder. Aynı makinedeki nginx için:

```nginx
location / {
  proxy_pass         http://127.0.0.1:4000;
  proxy_set_header   Host $host;
  proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

```bash
HOST=127.0.0.1 TRUST_PROXY=127.0.0.1 npm start     # sunucu yalnız yerel vekile açık; yalnız onun başlığına güvenilir
```

Vekil `Idempotency-Key` ve `Authorization` başlıklarını olduğu gibi iletmelidir (varsayılan davranış). Üretimde TLS'i vekil sonlandırır;
sunucunun kendisi HTTPS konuşmaz.

## 2. Demo hesapları

`npm run seed` sonrası:

| Takma ad | Rol | Şifre |
|---|---|---|
| `admin` | Yönetici (kolay demo girişi) | `admin123` |
| `yonetici` | Yönetici | `Yonetici123!` |
| `kayitmemuru` | Kayıt memuru | `Kayit123!` |
| `denetci` | Denetçi | `Denetci123!` |
| `bk_enerji1`–`6`, `bk_saglik1`–`6`, `bk_imar1`, `bk_imar2` | Bilirkişi | `Bilirkisi123!` |
| `ayse`, `mehmet`, `zeynep` ve 43 üye daha | Üye | `Uye12345!` |

Tohum verisi gerçek servislerden geçirilerek üretilir; bütün kayıtlar gerçek BFT defterden geçer. İçeriği:

- **Hesaplar:** 64 doğrulanmış üye. Üç görüş bloğu (%60/%30/%10) ve bunlardan oluşan 3 görüş kümesi. 14 bilirkişi; Enerji ve
  Sağlık alanlarında 6'şar kişi olduğundan vitrin kuraları (#K-7, #K-32) uygun adayların bir kısmını dışarıda bırakır. Ek
  bilirkişiler (`bk_enerji3`–`6`, `bk_saglik4`–`6`) oy/görüş verisi rızası vermediği için oy kullanmaz; yalnız bilirkişilik yapar.
- **İçerik:** 14 konu (alt konular dahil), 34 öneri, 182 mesaj, 11 vekâlet.
- **Bekleyenler ve kısıtlılar:**
  - 4 doğrulama bekleyen başvuru,
  - 18 yaşından küçük ve siyasi rıza vermemiş üyeler (oy kullanamazlar).

**Her evreden en az bir öneri vardır:**

| Evre | Öneri |
|---|---|
| Taslak | #K-34 |
| Destekçi toplanıyor | #K-33 |
| Tartışmada (bilirkişi paneli ve raporla) | #K-32 |
| Oylamada | #K-30 (`ayse` henüz oy vermedi), #K-31 (acil silme talebi) |
| İtiraz süresinde | #K-29 |
| Uzlaşmada (azınlık raporu, YZ köprü taslakları) | #K-28 |
| Yeniden oylamada | #K-27 |
| Yönetmeliğe aykırı | #K-22 ("Görüş ayrılığı" gerekçesi), #K-23 (değiştirilemez madde) |
| Süresi doldu / geri çekildi | #K-6 / #K-26 |
| Kabul ve red | 17 kabul edilmiş, 5 reddedilmiş öneri |

**Öne çıkan örnekler:**

| Örnek | Öneri |
|---|---|
| Tartışmalı → uzlaşma → aşma eşiğiyle kabul | #K-24 |
| İtirazla yeniden oylama → red | #K-25 |
| Silme oylamasıyla gizlenen mesaj (mezar taşı ve yazarın cevabı) | #K-21 |
| Yürürlükteki yönetmelik yaması (sürüm 2) | #K-5 |
| Bilirkişi panelinden çıkar çatışmasıyla dışlanan aday | #K-7 |
| Tohumlu ağırlıklı kura: uygun adayların bir kısmı seçilmez (aday tablosu ve ağırlıklar) | #K-7, #K-32 |

## 3. Android uygulaması

Web kodu Capacitor 8 ile paketlenir (`web/android`). Uygulama içinde sunucu adresi **Ayarlar** sayfasından değiştirilebilir; emülatör
varsayılanı `http://10.0.2.2:4000`'dir. Sunucu CORS ayarında `http://localhost` ve `capacitor://localhost` kökenleri açıktır;
manifest, HTTP sunucuya bağlanmak için açık metin trafiğine izin verir.

```bash
cd web && npx vite build && npx cap sync android
cd android && ./gradlew assembleDebug          # Windows: gradlew.bat assembleDebug
# APK: web/android/app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

- `gradlew` depoda çalıştırılabilir (100755) olarak işlenmiştir. Çalıştırma biti kaybolmuş bir kopyada (ör. zip'ten açılmış)
  macOS/Linux "Permission denied" verirse `chmod +x gradlew` ya da `sh ./gradlew assembleDebug` kullanın.
- Gereksinimler: JDK 21 (Android Studio'nun `jbr`'si) ve Android SDK (platform 34–36). Windows'ta:
  `export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"`.
- Emülatör: `Pixel_7_API_34`. Sunucu bilgisayarda `npm start` ile çalışırken uygulama `10.0.2.2:4000`'e bağlanır.
- Gerçek telefonda: telefon ve bilgisayar aynı Wi-Fi ağında olmalı; uygulamada **Ayarlar → Sunucu adresi** alanına bilgisayarın yerel ağ
  adresini yazın (ör. `http://192.168.1.20:4000`) ve "Bağlantıyı sına" ile deneyin.
- Donanım geri tuşu önce açık pencereyi/alt sayfayı kapatır, sonra uygulama içinde geri gider (`@capacitor/app`).
- Uygulamada dosya indirme yoktur (WebView indirmeleri yok sayar): KVKK veri dökümü, Turtle ve makbuz yedeği kopyalanarak alınır;
  "İndir" düğmeleri gizlenir ve "indirildi" denmez. Ön denetimdeki benzer öneriler, yazılan form kaybolmasın diye alt sayfada önizlenir.
- Doğrulandı (Windows 11, Pixel 7 · API 34): giriş, oy + cihazda makbuz, "Oyum kayıtlı mı?", tarayıcıda yeniden sayım, geri tuşu,
  koyu tema. Ayrıntılar ve ekran görüntüleri: [TEST_RAPORU.md §3.3](docs/TEST_RAPORU.md), [`docs/ekran/`](docs/ekran/).
- Tam ekran arşivi (arayüz hafifletme Faz 3 sonrası, 3 Ekim 2026): [`gorseller/2026-10-01/index.html`](gorseller/2026-10-01/index.html) galerisi —
  106 web (Chrome, 1440×1000) ve 107 Android (kurulu APK, 1080×2400) görüntü, CSV envanteri ve derleme kaydı; zip: `gorseller/Forum-Sistemi-Ekran-Goruntuleri-2026-10-01.zip`.
  Yenileme: ayrı bir veri klasörüyle 4177 portunda sunucu başlatıp `node gorseller/2026-10-01/araclar/ekranlari-kaydet.mjs web|android`
  (her biri ardından `--details`), sonra `node gorseller/2026-10-01/araclar/galeriyi-olustur.mjs` ([yöntem](docs/ARAYUZ_PLANI.md)).

## 4. Gereksinim → çözüm eşlemesi

| # | Gereksinim | Çözüm | Nerede |
|---|---|---|---|
| 1 | Herkes konu açabilir ve düzenleme teklif edebilir | 5 öneri türü: yeni konu, alt konu, düzenleme teklifi, silme talebi, yönetmelik değişikliği. Canlı ön denetim; destekçi (eş imzacı) sayısı K_s = max(2, min(5, ⌈√üye/2⌉)). Tartışmada herkes metin önerebilir; yazarın tek başına vetosu yoktur. | Öneriler → Yeni öneri; `server/src/forum/proposals.ts` |
| 2 | Konunun kabulü için çoğunluk onayı | Köprülü Çoğunluk: yeter sayı (q ve mutlak taban ⌈1,5√\|E\|⌉) + onay eşiği (T0 > %50, T1 ≥ %60, T2 ≥ 2/3) + anlamlı her görüş kümesinde Laplace desteği P_g ≥ φ | `shared/src/decision.ts`, [ALGORITMA.md](docs/ALGORITMA.md) §4 |
| 3 | Adres, ad-soyad, doğum tarihi vb. bilgiler + takma ad | Kayıt formu; kimlik kasası alan bazında AES-256-GCM ile şifrelenir (kullanıcıya özel DEK, HKDF, AAD). TCKN ve e-posta için kör indeks var. Herkese açık yerlerde yalnız takma ad görünür. Takma ad tekildir (büyük/küçük harf ve I/ı farkı gözetilmez, "y0netici" gibi taklitler reddedilir) ve Profil'den şifre teyidiyle 30 günde bir değiştirilebilir. Kayıt memuru kişisel veriyi ancak amaç belirterek ve erişim kaydı tutularak görür; "Üyeyi sisteme gir" seçeneği de var. Üye kimlik verisinin düzeltilmesini gerekçesiyle talep eder; kayıt memuru amaçlı incelemeden sonra karar verir (KVKK md. 11/1-d). | Kayıt, Kayıt memuru; `server/src/identity/`, [KVKK.md](docs/KVKK.md) |
| 4 | Konular oylamaya girer, kabul edilirse resmî konu olur | Yaşam döngüsü: taslak → destek → ontoloji denetimi → tartışma → oylama → itiraz/uzlaşma → yürürlük. Kabul edilen öneri `topics` kaydı olur ve sürüm geçmişi tutulur. | `server/src/forum/lifecycle.ts`, Konular |
| 5 | Alt konular önerilip oylanır | `subtopic` önerisi: üst konu yürürlükte olmalı, kategoriler miras alınır. Kabul edilince konu ağacına eklenir. | Konu sayfası → "Alt konu öner" |
| 6 | Yönetmelik ontoloji olarak modellenir ve konuları denetler | 24 maddelik Forum Yönetmeliği RDF/Turtle (T-kutusu + A-kutusu), N3 çıkarım kuralları ve SHACL şekilleriyle modellenir. Her öneri birleştirilmiş veri kümesi üzerinde denetlenir; katman ve parametreler "en koruyucu kazanır" ilkesiyle belirlenir. Değiştirilemez maddeler oylanamaz (T3). Yönetmelik yaması sürümlenir ve meta-kurallar (iki adımlı atlatma, yeni değiştirilemez madde yasağı, koruma alt/üst sınırları) geçerlidir. | `server/ontology/*`, `server/src/ontology/`, Yönetmelik sayfası, [YONETMELIK.md](docs/YONETMELIK.md) |
| 7 | Her konuda tartışma alanı; tartışmalar silinmez | Konu ve öneri iş parçacıkları; yanıtlar, katılıyorum/katılmıyorum, köprü skoru. Düzenleme yeni sürüm üretir, eski sürümler saklanır. Veritabanında `DELETE` yoktur. İçerik özeti deftere yazılır. | Tartışma bileşeni; `server/src/forum/messages.ts` |
| 8 | Tartışmanın bir kısmının silinmesi oylamaya çıkar | Silme (karartma) talebi DEL katmanında oylanır: 2/3 onay + köprü testi + yazarın kendi kümesinde P ≥ 1/2. Kabul edilen mesaj gizlenir ve yerine mezar taşı konur; asıl metin denetçiye erişim kaydıyla açık kalır, yazar karartılamayan tek bir cevap ekleyebilir. **"Görüş ayrılığı" geçersiz bir gerekçedir** (değiştirilemez madde). Kişisel veri ve tehdit gerekçelerinde mesaj talep anında daraltılır. Spam sınırı vardır. | Mesaj → "Silme talebi aç"; [ALGORITMA.md](docs/ALGORITMA.md) §10 |
| + | Çoğunluk azınlığı tüketebilir — çözüm | Aşağıdaki §5 | |
| + | Android uygulaması ve web sitesi | Tek React kodu; Capacitor ile Android. Sunucu adresi ayarlanabilir. 360 px'de taşmasız. | `web/`, `web/android` |
| + | Dağıtık defter | 4 doğrulayıcılı BFT (propose/prevote/precommit, tur değişimi, kilitleme), RFC 6962 Merkle, Ed25519 commit imzaları, bizans kanıtı, kurcalama tespiti ve onarım. Oy makbuzu ve sayım tarayıcıda doğrulanır. **Defterde kişisel veri yoktur.** | Defter, Oyum kayıtlı mı?; `server/src/ledger/` |
| + | Bilirkişi entegrasyonu | Başvuru ve onay, alan eşleşmesi. Ağırlıklı kura: tohum önceden taahhüt edilen bloğun hash'inden alınır, çekiliş defterden yeniden üretilebilir. Graf tabanlı çıkar çatışması dışlaması, rapor şeması, hukuki nitelendirme denetimi (6754 s. Kanun md. 3/2), itibar formülü, askı kuralı. **Bilirkişi danışmandır, oyu 1'dir.** | Bilirkişiler; `server/src/experts/` |
| + | Yapay zekâ entegrasyonu | Claude (`claude-haiku-5-5`, yapılandırılmış çıktı; ret ya da hata durumunda çevrimdışı yedek) ya da çevrimdışı sezgisel mod: sınıflandırma, moderasyon, tartışma özeti (azınlık görüşleri bölümü her zaman var), benzer öneriler (salam taktiği uyarısı), uzlaşma için köprü taslakları, bilirkişi raporu denetimi. Kişisel veri maskelenir, takma adlar K1, K2… olur. YZ'ye gönderim ayrı açık rızaya bağlıdır. **YZ yalnızca danışmandır; durum değiştirmez:** yüksek güvenli bir YZ içerik etiketi bile öneriyi kendi başına "yönetmeliğe aykırı" yapamaz, yalnızca uyarı ve bilirkişi incelemesi doğurur (Madde 12 (2), 14 (1)). Her çıktı etiketlidir. | `server/src/ai/` |
| + | İnsanların grafta tutulması | graphology: takip, kefalet, vekâlet (likit demokrasi, cap ve H=3), yakınlık beyanı. PageRank, aracılar, Louvain (çapraz kontrol), SybilRank, kilit adım (lockstep) tespiti, kalıcı kaybeden göstergesi. | Graf; `server/src/graph/` |

## 5. Çoğunluk azınlığı nasıl tüketmez? (Ve azınlık çoğunluğu nasıl kilitleyemez?)

Basit çoğunluk kuralında %51, %49'u her konuda yenebilir: aynı grup sürekli kaybederse sistem fiilen ona kapanır ("kalıcı
kaybeden"). Öte yandan azınlığa mutlak veto vermek de liberum veto'ya, yani azınlık tiranlığına yol açar. Sistem iki ucu birlikte
dengeleyen katmanlı bir tasarım kullanır.

| Mekanizma | Çoğunluk tiranlığına karşı | Azınlık tiranlığına karşı |
|---|---|---|
| **Köprülü Çoğunluk** (ALGORITMA §4). Görüş kümeleri oylardan PCA + k-means ile hesaplanır ve oylama açılışında dondurulur. Anlamlı her kümede P_g = (1+Y_g)/(2+Y_g+N_g) ≥ φ aranır. | Azınlık kümesinin aktif "hayır"ı kararı **tartışmalı** yapar ve uzlaşma turu açılır. | Laplace yumuşatması sayesinde boykot (oy vermemek) P_g = ½ verir; engel olmaz. Azınlık ancak aktif "hayır" ile ve yalnızca bir kez erteleyebilir. |
| **Erteleyici, tek seferlik itiraz ("alarm zili")** (§6) | Kabulden sonra azınlık itiraz imzası toplayabilir: anlamlı bir kümede "hayır" verenlerin %75'i, ya da iki kümeden toplam %10 imza. | Her öneri yalnızca bir kez uzlaşmaya girer. İmza bütçesi 30 günde 2'dir. |
| **Uzlaşma ve yeniden oylama** (§7, §4.3) | Azınlık raporu kalıcı olarak kaydedilir. YZ köprü taslakları üretir, bilirkişi görüşü alınır, yazar metni revize edebilir. | Yeniden oylamada **2/3 aşma eşiği** (ω) ile çoğunluk sonuca ulaşır. Sonuç kesindir. |
| **Değiştirilemez çekirdek** (Yönetmelik'te 20 fıkra: Madde 3 (1–2), 4 (1–2), 5 (1–3), 6 (1–3), 13 (2), 14 (1–2), 15 (1–2), 19 (1–2), 20 (2), 21 (1) ve (3)) | Eşit oy, temel hakların özü, azınlık korumasının kendisi, değiştirilemez hükümlerin korunması, **bilirkişi ve yapay zekânın yalnızca danışman olması**, gizli oy, tartışmanın silinmezliği ve karartılan yazarın cevap hakkı, "görüş ayrılığı" silme gerekçesi olamaması, kişisel verinin defterde tutulmaması ve kendi verisini silme talebinin oylanmaması **oylanamaz** (T3). Madde 20 ve 21'in öbür fıkraları (20 (1), (3), (4); 21 (2)) değiştirilemez **değildir**; yalnızca listelenen fıkralar korumalıdır. | Çoğunluğun kendi politikasını "değiştirilemez" yapması (kalıcılaştırma) yasaktır. Koruma eşiklerinin üst sınırı da vardır: eşikler yükseltilerek azınlığa kalıcı veto verilemez. Köprü testi parametreyle dolaylı olarak da kapatılamaz: küme başına asgari oy (μ_votes) en çok 3'tür (daha büyüğü her kümeyi "nötr" saydırırdı); tartışma, oylama ve uzatma 24 saatten, T0–T2 uzlaşması 24 saatten kısa olamaz. |
| **Temel hak kısıtlaması → nitelikli çoğunluk** | Bir hakkı kısıtlayan öneri en az T1 (≥ %60, φ = 0,40) olur. YZ ve üyeler bu bayrağı ekleyebilir; yalnızca bilirkişi kaldırabilir ("yalnızca yükseltme"). | YZ ya da sıradan bir üye bayrağı öneriyi geçersiz (T3) yapamaz; bunun için bilirkişi teyidi gerekir. |
| **Silmede yazarın kümesi** (§10) | Bir görüşü susturmak için silme kullanılamaz: "görüş ayrılığı" gerekçe olamaz, 2/3 onay ve yazarın kendi kümesinde P ≥ ½ gerekir. | Acil daraltma süreli ve gerekçelidir. Talep sınırı vardır: açıkta en çok 3, günde 5. |
| **Gizli oy, açık sayım** (§11) | Oy kimliğe bağlanamaz (`ballotId = HMAC(...)`). İtiraz imzacıları anonimdir. Görüş kümesi bilgisi yalnızca kişinin kendisine gösterilir (KVKK md. 6); iki dar istisna: açık sayım için silme oylamasında hedef mesaj yazarının kümesi bültende durur (arayüz grubu adıyla anmaz) ve azınlık raporu, yazara önceden söylenerek takma ad ve görüş grubuyla yayımlanır ([KVKK §4.3](docs/KVKK.md)). | Herkes sayımı bültenden yeniden yapar (`verifyTally`); sonuç tartışmaya açık değildir. |
| **Vekâlet sınırı** (§5) | Tek bir delege en çok max(2, ⌈0,05·\|E\|⌉) başkasına ait oy taşır ve zincir en çok 3 adımdır. Doğrudan oy her zaman önceliklidir. | — |
| **Küme manipülasyonuna karşı** (§9, §12) | Kümeleme permütasyon sıfır modeliyle sahte küme üretmez. Yalnızca ≥ 3 gün önce doğrulanmış hesaplar kümelemeye girer; kilit adım oylama tespit edilir. | — |

**Simülasyon sonuçları** ([SIMULASYON.md](docs/SIMULASYON.md), gerçek karar kodu, |E| = 300, bloklar %60/%30/%10):

- **Çoğunluk tiranlığı:**
  - %10'luk bloğa zarar veren öneriler basit çoğunlukta %100 kabul edilir. KÇ'de ilk tur kabul oranı %9,6, nihai kabul %56,5'tir; bunların çoğu yalnızca 2/3 aşma eşiğiyle geçer.
  - Metin uzlaşmada yumuşatılınca kabul %96,9'a çıkar. Mekanizma önerileri öldürmez; azınlığı da kazanan bir metne zorlar.
- **İyi önerileri engellemez:** geniş destekli önerilerde her iki yöntemde kabul oranı %100'dür. Ek bedel 48 saatlik itiraz penceresidir (T0); oylamanın başından yürürlüğe kadar toplam süre ortalama ≈ 5,3 gündür (72 saat oylama + 48 saat itiraz + seyrek yeniden oylama).
- **Liberum veto yok:** %10'luk blok her öneriye "hayır" deyip itiraz etse bile çok popüler öneriler %100 oranında yürürlüğe girer.
- **Boykot işe yaramaz:** nihai kabul %100'dür.
- **Kalıcı kaybeden:** azınlığın istemediği halde kabul edilen kararların oranı %38,1'den %27,7'ye iner.
- **Vekâlet sınırı:** en yüklü delegenin payı %8,2'den %5,0'a iner.

## 6. Mimari

Ayrıntı: [MIMARI.md](docs/MIMARI.md).

```
  Web (React 19 + Vite)      Android (aynı kod, Capacitor 8)
  · verifyTally / verifyInclusionProof tarayıcıda · makbuzlar cihazda · doğrulayıcı anahtarları sabitlenir (TOFU)
                     │  REST/JSON (Bearer)  — docs/API.md (104 uç nokta)
┌────────────────────▼──────────────────────────────────────────────────────────┐
│ Fastify 5  http/  (yetki U/V/VV/R/D/A/E · zod · hata biçimi · CORS · hız sınırı · web/dist + SPA)  │
│ forum/   öneri · yaşam döngüsü (zamanlayıcı) · sayım · konu · tartışma · küme · topluluk          │
│ ─── arayüzlerle bağlı, ortak SQLite tabloları (core/contracts.ts; MIMARI §2) ───                   │
│ ledger/ BFT×4 · ontology/ TTL+N3+SHACL · governance/ PCA/k-means, vekâlet, kura · graph/          │
│ identity/ kasa+KVKK · ai/ Claude ya da çevrimdışı · experts/ kura+rapor+itibar                    │
│ core/ ScaledClock · Config · AppError · Notifier · AuditLogger      db/ SQLite (node:sqlite)      │
└───────────────┬───────────────────────────────────────────┬──────────────────────────────────────┘
                │ yalnız özet/taahhüt/ballotId               │ maskelenmiş metin (yalnız rızayla)
        defter düğümleri v0..v3                       Claude API (claude-haiku-5-5)
shared/  karar fonksiyonu (decide / evaluateObjection / verifyTally) · kripto · rasyonel · RNG · tipler — sunucu ve istemcide AYNI kod
```

**Klasörler:**

| Klasör | İçerik |
|---|---|
| `shared/src/` | Ortak tipler, API sözleşmesi, karar fonksiyonu, kriptografi, ontoloji IRI'leri |
| `server/src/` | Modüller: `core`, `db`, `ledger`, `ontology`, `governance`, `graph`, `identity`, `ai`, `experts`, `forum`, `http`, `seed` |
| `server/ontology/` | `fy-schema.ttl`, `yonetmelik.ttl`, `yonetmelik-sekiller.ttl`, `yonetmelik-kurallar.n3` |
| `server/test/` | Modül bazında testler (110 dosya, 1094 test; [TEST_RAPORU §2](docs/TEST_RAPORU.md)) |
| `server/scripts/simulate.ts` | Simülasyon betiği |
| `web/src/` | `api`, `auth`, `ui`, `lib`, `components`, `pages`; altyapı kılavuzu `web/src/README.md` |
| `web/android/` | Capacitor Android projesi |

## 7. Dürüst sınırlamalar

- Bu sistem düşük riskli topluluk yönetişimi içindir; siyasi seçim için tasarlanmamıştır. Sunucu, seçmen uygunluğu ve oy gizliliği
  konusunda güvenilir kabul edilir. Cihazda imzalı oy ve MACI benzeri zorlama direnci kapsam dışıdır (ALGORITMA §11).
- Demo kurulumunda dört defter doğrulayıcısı aynı süreçte çalışır (ayrı anahtar ve ayrı depo, bellek içi ağ); arayüz bunu açıkça
  belirtir. Doğrulayıcıyı ayrı süreçte başlatan bir komut yoktur; genişleme noktası `Transport` arayüzüdür ([MIMARI §4](docs/MIMARI.md)).
- Çevrimdışı YZ sözlük tabanlıdır ve yanlış pozitif üretebilir. Bu yüzden YZ'nin hem hak kısıtlaması tespiti hem içerik etiketi yalnızca yükseltir (uyarı + bilirkişi); geçersizlik kararını kural tabanlı tespit ya da bilirkişi verir.
  Yanlış pozitifleri azaltmak için sözlük eşleşmesi hedef çözümlemesiyle sınırlanır (`server/src/ai/targeting.ts`): nefret
  söylemi için korunan grup adına bitişik aşağılama, grubu doğrudan hedef alan dışlama ("göçmen istemiyoruz") ya da açık
  düşmanlık çağrısı gerekir; "göçmen çocukların okul dışında kalmasını istemiyoruz" gibi grubu koruyan cümleler etiketlenmez.
  Bir projeye, karara ya da kuruma yönelik sert eleştiri ("aptalca proje") kişiye hakaret sayılmaz. İçerik etiketinin güveni,
  modelin ya da sezgiselin o etiket için kendi bildirdiği güvendir (risk düzeyinden türetilmez); bildirilmemişse temkinli 0,5 kullanılır.
- Tartışma özetinin azınlık bölümü, küme anlık görüntüsündeki **nüfusa** göre en küçük anlamlı kümenin mesajlarını, karar
  kaydındaki azınlık raporlarını ve kesin sayım tartışmalıysa köprü testini geçemeyen kümenin "hayır" tarafını gösterir;
  bunlar yoksa sayıca az olan tutumu (lehte/aleyhte) aktarır. Özetin kendisi yine danışma niteliğindedir.
- Kategorileri yazar seçer (alt konu ve düzenleme üst konudan miras alır); üyeler başkasının önerisine kategori ekleyemez, yalnızca hak etkisi bayrağı ekleyebilir (Madde 8 (2)).
- Kimin yönetici, kayıt memuru ya da denetçi olduğu **herkese açıktır** (`PublicUser.roles`; üye listesi ve profil). Bu bilinçli bir
  yönetişim şeffaflığı kararıdır: yetkiyi kimin kullandığı bilinmeden denetlenemez. Roller takma adlı hesap verisidir (özel nitelikli
  değil); açıklanmaları meşru menfaate (KVKK md. 5/2-f) dayanır ([KVKK §4.2](docs/KVKK.md)).
- Dayanıklılık: bir blokta onaylanmamış defter işlemleri ana veritabanındaki `ledger_outbox` tablosunda tutulur ve sert kapanıştan
  (çökme, `taskkill /F`) sonra açılışta yeniden gönderilir; simüle saat açılışta geriye gitmez. Satır, doğrulayıcı depoları diske
  indirilmeden silinmez: elektrik kesintisinde depolardan son blok kaybolsa bile işlem açılışta yeniden gönderilir ve yeni bir bloğa
  girer (o bloğun yüksekliği ve kanıtı değişebilir). Bir veritabanı işlemi içinden gönderilen defter kaydı işlem COMMIT olunca
  iletilir; geri alınan işlem deftere kayıt bırakmaz ([MIMARI §4](docs/MIMARI.md)).
- Giriş kilidi (hesap başına) ve `Idempotency-Key` yanıt deposu **süreç belleğindedir**: yeniden başlatmada sıfırlanır, birden çok
  sunucu sürecinde paylaşılmaz. Yeniden başlatmadan sonra gelen bir yeniden gönderim baştan işlenir.
- Anahtarlar demo ortamında dosyada (`server/data/keys`, 0600) tutulur; üretimde KMS ya da ortam değişkeni kullanılmalıdır.
  Ana anahtar `server/scripts/rotate-master-key.ts` ile döndürülebilir (DEK'ler yeni KEK ile yeniden sarılır; `--dry-run`).
- Personel hesapları için iki faktörlü kimlik doğrulama yoktur; gerekçe ve telafi edici tedbirler [KVKK.md §8](docs/KVKK.md).
- Android demo derlemesi, bilgisayardaki HTTP sunucusuna bağlanabilmek için açık metin trafiğine izin verir; gerçek kullanımda sunucu
  HTTPS arkasında olmalı ve bu izin kaldırılmalıdır. Koyu temada sistem durum çubuğu açık renkte kalır (yalnızca görünüm).
