# Test Raporu

> Tarih: 1 Ekim 2026 (ilk rapor) · Birim, entegrasyon ve e2e sonuçları 5 Ekim 2026 itibarıyla (test döngüsü tur 1); Android sonuçları 3 Ekim 2026 koşusundandır · Son doğrulama ortamı: **Windows 11, Node 24.15**, TypeScript 7, vitest 5, Playwright 1.63 (Chromium), Android Emulator (Pixel 7, API 34) · İlk doğrulama: Linux, Node 22.22 · YZ: çevrimdışı sezgisel mod (`ANTHROPIC_API_KEY` yok).
> Yeniden üretmek için: `npm run typecheck && npm test && npm run build` (kökte), simülasyon için `npm run sim -w server`.

## 1. Özet

| Kontrol | Sonuç |
|---|---|
| `npm run typecheck` (shared + server + web) | ✔ 0 hata |
| `npm test` (sunucu 110 dosya + web 54 dosya) | ✔ **1094 / 1094** sunucu ve **896 / 896** web testi geçti (Windows/Node 24; 5 Ekim 2026, test döngüsü tur 1 sonrası; önceki ölçümler: 1038 + 804, 1020 + 795, 907 + 668) |
| `npm run build` (web, Vite) | ✔ |
| `npm run seed -- --reset` (tohum doğrulamaları, 19 denetim) | ✔ (~30 sn, Windows) |
| `npm run sim -w server` (Monte Carlo, belirlenimci) | ✔ (~30 sn) → [SIMULASYON.md](SIMULASYON.md) |
| `npm run e2e` — tarayıcı uçtan uca test paketi (Playwright/Chromium, 8 dosya; Windows 11, Node 24) | ✔ **75 / 75** test (~10 dk; bkz. §3.1; biri — `06 › bütünlük uyarısı` — tohumun o günkü oy geçmişi örüntü üretmediği için kendi atlama dalına girer) |
| 360 px'de 219 sayfa/sekme görünümü (7 rol; 79'u 'Tam' görünümde, bütün açılırlar açık; 'Bu sayfada' tıklamaları, açık Term penceresi ve 'Süz' açılırı dahil): yatay taşma / sayfa-konsol hatası | ✔ 0 / 0 |
| Android: `npx cap sync android` + `gradlew assembleDebug` (JDK 21) | ✔ APK (~4,6 MB) derlendi, `Pixel_7_API_34` emülatöründe kuruldu ve `http://10.0.2.2:4000` sunucusuna bağlandı (bkz. §3.3) |

## 2. Birim ve entegrasyon testleri (modül bazında)

| Modül | Dosya | Test | Kapsam |
|---|---|---|---|
| `shared` (kripto, TCKN, RNG, rasyonel) + duman testi | 2 | 8 | RFC 6962 Merkle kanıtı (1–17 yaprak, her indeks), kanonik JSON, TCKN, tohumlu RNG, ağırlıklı örnekleme, rasyonel karşılaştırmalar |
| `governance` (karar + matematik) | 6 | 125 | `decide`: tüm katmanlar, kesin/≥ eşik sınırları, soğuk başlangıç (`max(τ, min(τ+δ, 2/3))`), anlamlı küme sınırları, μ_votes uzatma, uzatma sonrası nötr küme, boykotun engel olamaması, aktif azınlık → contested, DEL yazar kümesi, yeniden oylama (ω, ρ, güçlü itiraz); `evaluateObjection` (a)/(b); `verifyTally` (kurcalanmış bülten, taahhüt uyuşmazlığı, eksik açıklama); **anlamlı küme kuralı tek işlevde (`isSignificant`): σ_share ve σ_min yönetmelik yamasıyla değişince sonuç değişir**; PCA+k-means+siluet+sıfır modeli (homojen veride K=1, bloklu veride K=3, belirlenimcilik, 300×60 < 2 sn); vekâlet (öncelik, kapsam/rank sırası, H=3, döngü, cap → unrouted); **gösterilen değer ve sınır karşılaştırmayla çelişmez (`%66,68 ≥ %66,67`); `verifyTally`: taahhüdü olan pusulanın vekâletle açıklanması ve \|E\|'yi aşan açıklama uyuşmazlıktır (§12.23)** |
| `ledger` (BFT defter) | 12 | 47 | 4 düğümlü commit, tekilleştirme, bir düğüm çökünce canlılık + senkron, öneren çökünce tur değişimi, bizans düğümde güvenlik + EVIDENCE, kurcalama tespiti + onarım, `verifyInclusionProof` (doğru/sahte/yanlış anahtar), yeniden başlatma (kalıcılık), kişisel veri anahtarı reddi, zamanlayıcı sızıntısı yok, doğrulama önbelleği, nonce'lu gönderim; **giden kutusu (`ledger_outbox`): `submit` satırı yazar ve blokta onaylanınca siler; sert kapanışta bekleyen işlem açılışta yeniden gönderilir; zincirdeki ve bozuk satırlar atılır; forum kaydı ile satır aynı DB işleminde (COMMIT'te birlikte kalır, geri almada birlikte silinir); gerçek süreç öldürme (`crash-recovery`): çocuk süreç SIGKILL ile öldürülür, aynı veri klasörü yeniden açılınca bekleyen işlemler bloğa girer ve simüle saat son kaydın gerisine düşmez; kalıcı kipte satır, dört doğrulayıcı deposu diske indirilmeden (`sync`) silinmez; `Db.tx` içinden gönderim COMMIT'e dek iletilmez, işlem geri alınırsa ne satır ne defter kaydı kalır; işlem içinde disk dolu (SQLITE_FULL) hatası yutulmaz: asıl hata çıkar, satır, defter kaydı ve sonraki yazım kalıcı olmaz; işlem dışındaki yazım hatasının günlüğünde `errcode` var, yük yok**; **yerel Ed25519 ile soğuk doğrulamanın açılışta arka planda ısınması; `findTxs` pusula süzgeci (`ballotId`/`round`, sınır süzgeçten sonra) ve HTTP uçta `proposalId` zorunluluğu** |
| `ontology` (yönetmelik) | 7 | 88 | vocab ↔ TTL tutarlılığı, katman belirleme, hak kısıtlaması (yazar/bilirkişi → T3; YZ/üye → yalnız T1), içerik etiketi eşikleri, "Görüş ayrılığı" ihlali, alt konu/üst konu, en koruyucu parametre birleştirme, K_s, `validatePatch` meta-kuralları (değiştirilemez hedef, iki adımlı atlatma, yeni değiştirilemez madde yasağı, üst/alt koruma sınırları, overrides döngüsü), `applyPatch` sürümleme, IRI enjeksiyonu reddi, belge ↔ TTL madde metni eşitliği |
| `graph` | 5 | 55 | takip/kefalet/yakınlık, vekâlet döngü reddi, doğrulanmamış hedef, mesafe, çıkar çatışması (aile ≤3 adım, hane, yumuşak 1/0,5), DELEGATION yükünde ham kimlik yok (HMAC), Louvain belirlenimciliği ve uzlaşı önbelleği, SybilRank, kilit adım, kalıcı kaybeden, özel kenarların gizlenmesi; **kapanmış hesaba takip/kefalet/yakınlık 409; boş tür listesi hiç kenar vermez; kalıcı kaybeden önbelleği** |
| `identity` (KVKK) | 10 | 111 | doğrulama hataları, veritabanında düz metin kişisel veri yokluğu, AAD bağlama, kör indeks tekilliği, oturum belirteci kurcalama/süre, onay/red akışı, PII erişim günlüğü, kripto-imha (sonrasında giriş/PII yok, aynı TCKN ile yeniden kayıt), KVKK döküm bütünlüğü, şifre değiştirme, takma ad (tekillik, taklit, 30 günlük sınır), düzeltme talebi akışı, ana anahtar dönüşümü; **hesap başına giriş kilidi (5 başarısız → 15 dk, var olmayan ad için aynı, takma ad ve e-posta ayrı sayılır, başarılı giriş sıfırlar; bellek dolunca kilitli kayıt atılmaz, kilitsizlerden en az denemesi olan atılır); bekleyen başvurunun 180 GERÇEK gün sonra imhası (simüle saat 400 gün ileri alınsa da imha yok); değişiklik + denetim kaydı atomikliği (denetim yazılamazsa rol/rıza/doğrulama/PII erişimi/silme geri alınır); personel rolü yalnız doğrulanmış üyeye; son yönetici hesabını silemez** |
| `ai` | 7 | 132 | Claude çağrı biçimi (model, `server-side-fallback`, `fallbacks:"default"`, adaptive thinking, `output_config.format`, temperature yok), `refusal`/geçersiz JSON/şema dışı/hata → çevrimdışı yedek, sağlık durumu, maskeleme (istekte TCKN/e-posta/telefon/IBAN/takma ad yok), `forceOffline`, çevrimdışı sınıflandırma kalibrasyonu (zararsız "sadece/yalnızca" < 0,5; grup hedefli dışlama ≥ 0,8), moderasyon, özet (azınlık bölümü, tembel hesaplama), benzerlik, köprü taslakları, bilirkişi raporu denetimi (hukuki nitelendirme, alan dışı), kişisel veri tespiti, kayıt deposu (`AiRecordSink`) |
| `experts` (bilirkişi) | 8 | 58 | başvuru/onay/yaptırım, aday havuzu (alt/üst kategori), kesin dışlamalar, yumuşak çatışma ağırlığı, tohum formülü ve belirlenimcilik, önceden taahhüt edilen blokla tohum doğrulaması, bekleyen kuralar, EXPERT_DRAW yükünde ham kimlik yok, genişleme, çekinme → yedek davet, rapor puanı S ve R′, askı kuralı sınırları, gecikme cezası, kapanan öneride itiraz cezasız iptal, metin sınırları (yeterlilik metni uzunluk hatası `credentials_length`); **hesap silmede bilirkişi kaydının kapanması (bekleyen görev yedeğe, beyan imha, kenarlar iptal; eski veride açılış onarımı)** |
| `forum` (çekirdek) | 22 | 120 | §8'in 10 senaryosu: tam akış (öneri → yürürlük, gerçek BFT defterle), tartışmalı → uzlaşma → yeniden oylama (ω), itiraz yolu (bütçe, "no" şartı, kural a, ρ), silme yolu (acil daraltma, DEL, mezar taşı, tek cevap, denetçi okuma kaydı, "Görüş ayrılığı" → inadmissible, talep sınırı), yönetmelik yaması (T2, yeni sürüm, BYLAW_VERSION; değiştirilemez hedef → inadmissible), sürüm çakışması, uzatma ve oylama sürerken sonuç gizliliği, vekâlet + cap, kişisel veri 422, **defter taraması (hiçbir kayıtta kullanıcı kimliği/takma ad/yasak anahtar yok)**, itiraz imzacılarının anonimliği; her kesin turda `verifyTally(bülten)` ✔; yaşam döngüsü hataları ve geri çekilme, YZ kotası, metin sınırları; **bilirkişi tohumu taahhüdü (pay +1: taahhüt edilen bloğu taahhüdü taşıyan `SEED_COMMIT` oluşturur, kura o blok işlenmeden yapılmaz, tohum tam o bloktan alınır); gerçek defterle kura canlılığı: bilirkişi talebi, hak bayrağı ve uzlaşma turunda panel ilgisiz bir işlem beklemeden çekilir; anlamlı küme eşiklerinin (σ_share, σ_min) yürürlükteki yönetmelikten okunması**; **rolü olan ama doğrulanmamış hesaba gizli mesaj sürümleri 403 `inactive`; eksik `parentTopicId` 400; toplu evre geçişinde olay döngüsüne yol verme** |
| `http` | 17 | 247 | API.md'deki **104** uç noktanın her birinin kayıtlı olduğu (ve belgelenmemiş uç olmadığı), hata biçimi (400/401/403/404/409/413/415/422/429/500 — yığın izi yok), yetki matrisi, CORS (`http://localhost`, `capacitor://localhost`), SPA geri dönüşü, HTTP üzerinden tam öneri akışı + istemci tarafı `verifyTally` + makbuz kanıtı, saat kalıcılığı, görüş/oy gizliliği (küme haritası ve graf düğümleri yalnız kişinin kendisine; küme yeniden hesabı anonim), kapanış sırası; **`Idempotency-Key` (yeniden gönderim işlemi tekrarlamaz, farklı gövde 422, süre/boyut sınırı, kopan bağlantıda da saklanır, gerçek soketle) ve `TRUST_PROXY` (ayrıştırma, açılış uyarısı, `X-Forwarded-For` güveni, hız sınırının istemci başına sayması); hesap silme ve giriş kilidi uçtan uca (son yönetici 409, tek işlem — geri alınınca vekâletlerin `DELEGATION` kaydı da deftere ulaşmaz —, 429 `login_locked`)**; **API.md hata sözleşmesi (405 yok, bozuk URL ve uzun parametre 400 `validation`, güvenlik başlıkları her yanıtta, `types=`); şifre teyidi kilidi, eşzamanlı şifre değişikliğinde giriş, Idempotency kullanıcı kotası ve gövde bırakma** |
| `core` | 7 | 61 | ortam değişkenlerinin ayrıştırılması ve açık hata iletileri, veri klasörü kilidi, kapanış sırası, bildirimler, kimlik bakım zamanlayıcısı, şema indeksleri; **simüle saatin yeniden açılışta geriye gitmemesi (`clock-resume`): kayıtlı an, kira üst sınırı ve en son olay zamanı; düzgün kapanışta saat aynen sürer; çalışırken duvar saati geri adım atsa da `ScaledClock` geri gitmez, "ileri al" bu sırada da tam etkilidir** |
| `db` | 3 | 28 | şema sürümü ve göçler (taban, sıralı yükseltme, hata → hepsi geri alınır, daha yeni sürüm reddi, sürüm 2 = `ledger_outbox`, v1 → v2 yükseltme, belgelenen el ile 2 → 1 geri dönüş); **`Db.tx`: disk dolu (SQLITE_FULL) ve SAVEPOINT/RELEASE hatalarında asıl hata iletilir, iç hata yakalanıp devam edilse de sonraki deyim ve dış RELEASE asıl hatayı fırlatır (autocommit'e taşma yok), iç içe işlem, Promise döndüren geri çağrı reddi; `Db.afterCommit`: en dıştaki COMMIT'ten sonra, geri almada (iç savepoint dahil) atılır**; **asgari Node sürümü: `isTransaction` yoksa `Db` açılışta anlaşılır iletiyle durur; README/MIMARI/`engines` aynı sürümü söyler** |
| `architecture` | 1 | 6 | import yönlerini zorlar: `shared` sunucu/web'e bağlanmaz, `forum` `ai`'ya bağlanmaz, rotalar SQL katmanına bağlanmaz, web alt katmanları üst katmana bağlanmaz ([MIMARI §2.2](MIMARI.md)) |
| `seed` | 3 | 8 | küçültülmüş tohumun bellek içinde zincir ve sayım doğrulaması, saat kalıcılığı, `--reset` ile `DB_PATH` temizliği |
| **Toplam (5 Ekim, test döngüsü tur 1)** | **110** | **1094** | Tur 1 öncesi: 100 dosya / 1038 test; bağımsız inceleme düzeltmelerinden önce: 100 dosya / 1020 test; önceki tur: 86 dosya / 907 test. Sürüm geçmişi ve düzeltme turları: [MUHENDISLIK.md](MUHENDISLIK.md) |

### Web birim testleri (vitest)

| Konum | Dosya | Test | Kapsam |
|---|---|---|---|
| `api/` | 5 | 33 | istemci zaman aşımı (gövde okuması dahil), oturum hataları (yalnız 401'de oturum kapanır), **`Idempotency-Key` (otomatik UUID, belirsiz sonuçta aynı anahtar, kesin yanıtta unutma, hesap değişince temizlik; anahtar yalnız kaynağa yapılan en son istekse yeniden kullanılır: oy Evet→Hayır→Evet, takip/bırak, yakınlık `?kind`, taslak A→B→A, vekâlet ver/geri al yeni anahtar alır; ilgisiz kaynak belirsiz denemeyi bozmaz)**; **sunucu adresi değişince belirteç unutulur (`serverchange`); boş kenar türü listesi `types=` olarak gider** |
| `auth/` | 2 | 25 | **`derivePermissions`: görev rolleri ve bilirkişilik yalnız doğrulanmış hesapta geçerli (sunucudaki `requireRole`/`requireExpert` ile aynı)**; **`RequireRole`: rolü olan ama doğrulanmamış hesapta asıl neden söylenir**, yeni hata başlıkları (`login_locked`, `not_verified`), **Yönetim › Roller onay kutuları (doğrulanmamış üyeye görev rolü verilemez, verilmiş rol kaldırılabilir)** |
| `components/` | 3 | 108 | rozet bütçesi; **kayıt formu kuralları sunucudaki `parseRegistration` ile 80 girdi üzerinde karşılaştırılır (sapma testte kırılır)**; **yalnız noktalama ad/takma ad/adres iki tarafta da reddedilir; erişilebilirlik sözleşmeleri (yüklenen düğme `aria-disabled`, durum bölgesi, kaydırılabilir yük kutusu, bulunamadı h1'i, kategori hatası bağlantısı)** |
| `components/home`, `layout`, `community` | 4 | 83 | Ana sayfa yerleşimi, görev rozeti ve gezinme, kaybeden göstergesi |
| `components/participation` | 10 | 187 | öneri sayfası bölümleri ve çapaları, eylem panelleri, sonuç kartı, tartışma, bilirkişi/YZ, kanıt özetleri; "Sayımı kendim doğrulayayım" metni vekâletle sayılan oyların taahhütle denetlenemediğini söyler; **uzun tartışmada ilk 50 ileti dizisi ve değişmeyen mesaj nesnesinin korunması; sonuç kartında sınıra yakın değerin ayırt edilebilir hassasiyeti** |
| `components/proposals`, `components/system` | 7 | 127 | yeni öneri formu, konular, hesap/Ayarlar mantığı, ontoloji, hata sınırı; **yönetici 'ileri al' yanıtında `pending: true` uyarısı** |
| `lib/` | 12 | 184 | `ledgerVerify` (**`checkTxPage`: işlem sayfası doğrulaması adresteki özete bağlıdır**), `blockVerify`, makbuzlar, sözlük, görev deposu, bildirim sınıfları, sıradaki adım, kategori ağacı, çapa parametresi, Android otomatik yedeğinin belirteç ve makbuzları dışarı taşımaması (`androidBackup`); **tarayıcıda sayım doğrulaması blok blok (istek bütçesi), 429/ağ/5xx geçici: Retry-After beklenir, "sonuç alınamadı" asla "BAŞARISIZ" değildir** |
| `pages/`, `ui/` | 10 | 146 | Keşfet modeli, Bildirimler, Öneriler sekmeleri; temel bileşenler, `Term`, görsel dil (kontrast belirteçleri); **"Oyum kayıtlı mı?" son taahhüt denetimi (kesik liste kesin sonuç vermez, daha yeni taahhüt kesin ✘); göreli zaman geleceği göstermez; CSS sözleşmeleri (`--input-border` ≥ 3:1, 'yaşanmadı' evresinde opaklık yok, sekme paneli odak çerçevesi, scroll-padding)** |
| `vite.config.test.ts` | 1 | 3 | geliştirme vekili hedefi (`PORT`, `VITE_API_TARGET`; sabit 4000 değil) |
| **Toplam (5 Ekim, test döngüsü tur 1)** | **54** | **896** | Tur 1 öncesi: 45 dosya / 804 test; bağımsız inceleme düzeltmelerinden önce: 45 dosya / 795 test; önceki tur: 40 dosya / 668 test |

Bu belgedeki ve README'deki test, uç nokta ve denetim sayıları elle güncellenir; sayıları belgeye bağlayan otomatik bir kapı yoktur
(tek istisna: `http/routes.test.ts` API.md'deki uç noktaların kayıtlı olduğunu, belgelenmemiş uç olmadığını denetler).

## 3. Tarayıcıda uçtan uca senaryo (Playwright, tohumlanmış sunucu)

### 3.1 Depodaki test paketi: `npm run e2e`

Testler `e2e/` klasöründedir (Playwright 1.63, Chromium). Çalıştırma: kökte `npx playwright install chromium` (bir kez) ve
`npm run e2e`; tip denetimi `npm run e2e:typecheck`.

**Düzenek.** Küresel kurulum (`e2e/global-setup.ts`) `web/dist` yoksa ya da kaynaklardan eskiyse web'i derler (`vite build`) ve
geçici bir klasörde demo verisini tohumlar (`DATA_DIR=<geçici>/template/data`, `seed.ts --reset`; 19 tohum denetimi dahil, ~20–30 sn).
Her test dosyası bu şablonun **taze bir kopyasıyla** gerçek sunucuyu (`server/src/index.ts`, `node --import tsx`, kabuksuz süreç)
`PORT=4100`'de başlatır, `/api/system` yanıt verene kadar bekler ve dosya bitince süreç ağacını kapatır (Windows'ta
`taskkill /pid <pid> /T /F`). Senaryolar saati ileri aldığı için dosyalar birbirinin verisini bozmaz; her dosya tek başına da
koşabilir. Sunucu ayarları: `TIME_SCALE=1` (evre geçişleri yalnızca testin "saati ileri al" adımlarıyla olur; test süresi tohumdaki
açık önerilerin takvimini kaydırmaz), `AI_ENABLED=false`, `RATE_LIMIT_GLOBAL=100000`, `RATE_LIMIT_AUTH=10000`. Sabit bekleme yoktur:
arayüz durumları Playwright'ın otomatik beklemeleriyle, sayfa yerleşmesi yükleme göstergelerinin bitmesi ve ağ trafiğinin durulmasıyla,
defter kayıtları API yoklamasıyla beklenir. Senaryonun odağındaki kullanıcı adımları arayüzden, diğer üyelerin destek ve oyları API ile yapılır.
Her bağlamda sayfa hatası (`pageerror`) ve konsol hatası toplanır; testin sonunda boş olmalıdır. Başarısız testte ekran görüntüsü,
iz (trace) ve sunucu günlüğü rapora eklenir (`e2e/playwright-report`).

| Dosya | Test | Doğrulananlar | Süre |
|---|---|---|---|
| `01-tarama.spec.ts` | ziyaretçi | 360 px'de tüm genel sayfalar, tohumdaki **33 önerinin her biri** (her evre), sekmeli sayfaların her sekmesi, "Daha fazla" alt sayfası (en altında "Sistem durumu" bloğu), bulunamadı sayfası; tartışmadaki, oylamadaki ve kabul edilmiş birer öneride "Bu sayfada" gezinmesinin her bağlantısı (hedef görünür alana gelir, sabit üst çubuğun altında kalmaz, odak içine taşınır, `?bolum` silinir); Faz 3: Keşfet ve doğrula ('Bu sayfada' tıklamaları, sözlük araması, açık Term penceresi), Konular 'Süz' açılırı, konu ayrıntısı çapaları — 87 görünüm | 72 sn |
| | ziyaretçi (Tam görünüm) | Ayarlar'daki "Tam — tüm ayrıntılar açık" tercihiyle (sade görünümde kapalı gelen bütün kartlar ve açılırlar açık): 33 önerinin her biri, ana sayfa, iki konu ayrıntısı, Bilirkişiler, Graf, Defter ve Yönetmelik sekmeleri; tercihin gerçekten uygulandığı da denetlenir; Faz 3: Keşfet, sembol/formül anahtarı açık Karar parametreleri ve Term penceresi — 62 görünüm (aynı "Bu sayfada" tıklamaları dahil) | 57,8 sn |
| | üye ve bekleyen üye | profil, bildirimler, 5 öneri türünün formu, oy paneli, kendi görüş haritası; bekleyen hesap şeridi ve "doğrulama gerekli"; oylamadaki öneride "Bu sayfada" tıklamaları; Faz 3: Profil/Ayarlar çapaları, dolu canlı ön denetim paneli, `?mesaj=` ile silme talebi formu — 29 görünüm | 32,4 sn |
| | üye (Tam görünüm) | profil, ayarlar, bildirimler, yeni öneri formları, ön denetim paneli ve Keşfet, bütün açılırlar açık — 17 görünüm | 18,5 sn |
| | görevliler | kayıt memuru (amaçlı kişisel veri penceresi dahil), denetçi, yönetici (tüm sekmeler, kurcalama demosu, Keşfet'in yönetici adımı), bilirkişi — 24 görünüm | 14,2 sn |
| `02-oylama.spec.ts` | kayıttan kesin sayıma | `/kayit` formu (aydınlatma ≠ açık rıza, YZ rızası kapalı) → kayıt memuru: amaçsız erişim engellenir, amaçla kişisel veri (TCKN maskeli) → onay; `identity.pii_access` kaydında amaç var, TCKN yok → `/giris` → yeni konu önerisi: canlı ön denetim **T0 · Yönetmeliğe uygun**, K_s = 4 → "Destekle" (arayüz) + 3 destek → tartışma → yönetici **+72 sa** (hâlâ tartışma) ve **+24 sa** (oylama; geçiş listesinde "Tartışmada → Oylamada") → "Kabul" + "Oyumu ver": makbuz `localStorage["forum.receipts"]`'ta, sonuç gizli → 12 oy (API, her bloktan ≥ 2) → "Oyum kayıtlı mı?": **4 ✔ + 2 henüz** → **+72 sa**: kabul (yeter sayı ✔, eşik ✔; vekâletle sayılanlar dahil) → "Sayımı kendim doğrulayayım": **1. tur: sayım doğrulandı**, hiç ✘ yok → `/oy-dogrula` **6/6 ✔**; makbuz kurcalanınca "Kurcalama yakalandı" ✘ | 13,2 sn |
| `03-silme.spec.ts` | silme talebi | mesaj menüsü → "Silme talebi aç" → onay → form (hedef mesaj dolu): **"Görüş ayrılığı" seçilemez**, "Tehdit" acil uyarısı, ön denetim **DEL** → gönder (K_s = 1) → mesaj **"Gözden geçiriliyor" olarak katlanır** (silinmez) → destek (arayüz) → tartışma → oylama (yazar seçmen değil) → 16 "kabul" → kabul edildi → **mezar taşı** (asıl metin ziyaretçiye ve API'ye kapalı) → yazar **tek cevabını** ekler, ikinci cevap reddedilir → denetçi onaylı okuma: gizli metin görünür, `message.read_hidden` denetim günlüğünde (arayüz süzgeci + API) | 12,4 sn |
| `04-itiraz-uzlasma.spec.ts` | itiraz (#K-29) | ilk turda "Red" diyen uygun seçmen (yalnızca kendi görünümünde `canObject`) arayüzden imzalar; bir kez; ziyaretçiye ve API'de tüm imzacılar "Anonim imzacı"; geçerlilik koşulu sağlanana kadar hak sahipleri imzalar (tohumun zamana bağlı küçük farkları yüzünden kural a — tek kümede %75 — ya da kural b — iki kümeden 6 imza — gerekebilir; hak sahibi listesi 3'te kesilmez) ve zamanlayıcı süre dolmadan **uzlaşma turunu** başlatır (köken: itiraz) | 2,7 sn |
| | uzlaşma (#K-28) | "Red" diyen üye **azınlık raporu** yazar (takma adıyla listede) → yazar **YZ köprü taslakları** üretir ("Yapay zekâ ile üretildi" etiketi) → "Bu taslağı benimse" → **sürüm 2**, metin taslakla aynı, evre değişmez | 2,1 sn |
| | saat ileri | uzlaşma süresi biten #K-28 benimsenen metinle **yeniden oylamaya** girer ("Sonuç kesindir."); #K-29'un uzlaşması sürer | 1,1 sn |
| `05-defter.spec.ts` | defter | kurcalama demosu: v2'de #120 → **✘ bozuk** (diğer düğümler ✔) → "Düğümü onar" → **✔ Zincir yeniden geçerli** → zincir doğrulama 4/4 ✔ → v3 **çökertilir** → yeni işlemle bloklar 3 düğümle üretilir ("hata sürerken N yeni blok üretildi", v3 geride) → "Normale döndür" → v3 yetişir (yükseklik eşit, sağlıklı) → 4/4 ✔ | 10,7 sn |
| `06-sadelik.spec.ts` | Ana sayfa (4 test) | üye (375×812): "Merhaba, @ayse" + canlı özet + "Sizi bekleyenler (n)" ilk ekranda (alt gezinmenin üstünde), ilk 3 görev ve "Tümünü göster (n)", 'Daha fazla' adı yalnız alt gezinmede; görev bağlantısına **tek dokunuş**: odak "Oylama" bölgesinin ilk radyosunda, `?bolum` silinmiş; üye (1280×860): yan sütunda önce vitrin, sonra Topluluk durumu, vitrinin tamamı ilk ekranda; ziyaretçi: ≤ 14 kelimelik slogan, Giriş yap / Kayıt ol (ikincil) ve vitrin ilk ekranda, ilk ekranda tek birincil eylem (üst çubuktaki "Giriş yap"), "Neden kayıt gerekir?" kapalı açılır; siyasi rızası olmayan üye: oy hakkı notu "Notu gizle" ile cihazda gizlenir (`forum.dismissed`, yenilemede kalır), açıklama Sıradaki adım ve Oylama panelinde durur | 4,9 sn |
| | Öneriler | parametresiz açılışta (telefon ve masaüstü) tam bir sekme seçili ve en az bir kart görünür | 1,4 sn |
| | Öneri sayfası ilk ekranı (4 test) | oylamada: kompakt evre şeridi (yalnız güncel evrenin etiketi), "Sıradaki adım" kartı (tek cümle, kalan süre, **düğmesiz**, "Oy bölümüne git" ilk ekranda), "Bu sayfada" ilk ekranda; bağlantıya tıklayınca odak ilk radyoda; ziyaretçide "Oy için giriş yapın"; destek bekleyen öneride "Destek bölümüne git" → odak "Destekle" düğmesinde; kabul edilmişte: başlıkta T0 yok, Sıradaki adım + 2 soru bağlantısı ilk ekranda, tartışma ana sütunda kanıtlar sağda, **5 kanıt kartı kapalı ve her birinin tek satırlık hükmü görünür** (Destekçiler hep açık), tek kart açma/katlama, "Tümünü aç/katla" etiketi kartların gerçek durumunu izler | 6,8 sn |
| | Derin bağlantılar ve bilirkişi satırı (5 test) | 375 ve 360 px'de bilirkişi rapor satırında "Raporu oku" meta ile aynı satırda; `?bolum=` ile defter, ontoloji, sürümler, parametreler, evreler, sonuçlar, doğrula, metin, bilirkişi, YZ özeti (`yz`), tartışma, kanıtlar: kart açılır, kaydırılır, **sabit üst çubuğun altında kalmaz (masaüstünde gezinme satırı dahil)**, odak taşınır, parametre silinir; bilinmeyen çapa sessizce silinir; `?mesaj=` korunur ve odak mesaj gövdesine iner; "Bu sayfada" gezinmesinin her bağlantısı oylama (telefon), tartışma (telefon), kabul edilmiş (telefon ve masaüstü) için gezilir; "Tartışma" bağlantısı → tartışma görünür alanda, yazma kutusu kapalı (`aria-expanded`), açınca odak metin alanında, Vazgeç odağı geri verir, kurallar en altta | 45,9 sn |
| | 'Tam' görünüm (2 test) | Ayarlar'dan "Tam" seçilince kanıt kartlarının, açılırların, kırpılmış metnin ve bilirkişi raporlarının hepsi açık gelir, yazma kutusu açık (odak çalmaz); Ana sayfada bütün görevler açık | 4,5 sn |
| | Uyarı yalnız gerektiğinde bağırır (3 test) | yönetmeliğe aykırı öneride Ontoloji denetimi Destekçiler'in önünde ve açık, "Hangi madde?" kartı açıp odaklar; **bütünlük uyarısı** (14 üyenin saniyeler içinde aynı oyu vermesiyle üretilir): başlıkta rozet, kanıt sütununda en üstte açık kart, denetçiye "Bütünlük uyarısını incele"; bilirkişi görevi Ana sayfadan Bilirkişi görüşü kartına | 5,3 sn |
| | Taslak ve kabuk (2 test) | 5 kategorili taslak: ilk 3 etiket ve "+2" (`aria-expanded`), "Taslak işlemlerine git" → odak "Destekçi toplamaya gönder"; "Daha fazla" sayfasında Sistem durumu bloğu (5 satır, defter bağlantısı sayfayı kapatır) ve masaüstü gezinmede tek ayraç | 4,1 sn |
| | Ölçüm | ekran boyu, kelime, tıklanabilir öğe, rozet ve tartışmanın başladığı ekran **annotation** olarak kaydedilir (kesin beklenti değil) | 8,6 sn |
| | Kontrast | Ana sayfa ve 5 öneri sayfası, 360 px (yönetmeliğe aykırı öneri ayrıca 1280 px'de: 'yaşanmadı' evre etiketleri ve numaraları görünür), üç yolla (açık; sistem koyu; Ayarlar'dan koyu), 'Tam' kipte: her metin için WCAG AA (4,5:1; büyük metinde 3:1) ve yatay taşma 0 | 32,7 sn |
| | Sade dil (4 test) | Term düğmesi (dokunmatik, 360 px) pencere açar, Esc kapatır ve odak terime döner; 'Yönetmelikte ›' yönetmelik sekmesine, 'Sözlükte ›' Keşfet sözlüğündeki terime götürür; 'Karar parametreleri'nde Yunan sembolü ve formül ilk okumada yok, anahtar (klavyeyle) hepsini açar, 'Tam' kipte açık; Term düğmeleri ('Tam' görünümde taranır) ayrılmış ad parçası içermez ve başlık, bağlantı, düğme, `<summary>`, etiket ya da Uzlaşma/İtiraz paneli içinde değildir; T1 ve üstü katman rozeti sözlük penceresini açar | 13,7 sn |
| | Keşfet ve doğrula (7 test) | yedi bileşen canlı durumuyla (uyarı yalnız gerekince, mor yalnız YZ satırında) ve her satır tek dokunuşla ilgili yere; yedi adımlı rehberin her bağlantısı mevcut veriden kurulur ve doğru sekmeye/çapaya gider; erişim yolları (vitrin, masaüstü alt bilgisi, mobil 'Daha fazla'; üst gezinme 8 öğe kalır); 8 ilkenin tam metni ve 'Bu sayfada'; sözlük (Türkçe duyarsız arama, 'özet' aynen ve günlük karşılığı 'parmak izi', `?bolum=terim-…`); 360 px 'Tam' görünümde taşma yok | 36,7 sn |
| | Görev rozeti ve 'Sizden bekleniyor' (2 test) | 'Ana sayfa' rozeti sunucunun görev sayısıyla ve 'Sizi bekleyenler (n)' ile aynı; rozet `aria-hidden`, bağlantı adı değişmez, sayı `aria-describedby` ile okunur; alt gezinmede kesilmeden görünür; ziyaretçide yok; oy bekleyen kartta düz metin 'Sizden bekleniyor: Oy' | 4,1 sn |
| | Bildirimler | okunmamış varsa 'Okunmamış' açılır; Bugün / Bu hafta / Daha eski `h2` grupları; satırın tamamı bağlantı; satır başına tek 'Okundu işaretle: <başlık>' düğmesi | 3,7 sn |
| | Yeni öneri (4 test) | tür seçilince 5 radyo kompakt şeride iner (radyolar DOM'da, ok tuşları), 'Başlık' alanına uzaklık annotation; ön denetim 'önce hüküm' (hüküm → katman ve destekçi satırları → açılırlar), sade kipte kapalı, 'Tam'da açık; alt konu ve düzenlemede 'Ek kategoriler' kapalı; **sözlük penceresinin bağlantıları yeni sekmede açılır, form adresi ve yazılanlar yerinde kalır**; **'YZ önerileri' ilk 'Ekle'de kapanmaz, odak sıradaki 'Ekle'ye geçer**; silme talebinde 'Tartışma silinmez' tek cümle, kurallar canlı sayaçlı tek satır (`role="status"`), dört kural açılırda | 15,0 sn |
| | Profil, Ayarlar, Konular (5 test) | Profil: 'Oy hakkınız' kartı en üstte, eksik koşullar ve TEK eylem; seyrek işler başlığı görünür katlı kartlarda, `?bolum=` açar; Ayarlar: Görünüm → Sunucu → Makbuzlar → Gelişmiş, TOFU ve Ed25519 ilk okumada yok; Konular: tek satır sayaçlar, telefonda 'Süz'; Konu ayrıntısı: metin → açık öneriler → tartışma → alt konular → katlı sürüm geçmişi, çapalar | 19,6 sn |
| | Kontrast (Faz 3) | Keşfet, Öneriler, Konular, Bildirimler, Profil, Ayarlar, yeni öneri ve Term penceresi — açık ve iki koyu temada WCAG AA, 360 px'de taşma 0 | 28,3 sn |
| | Veri üreten (3 test) | bir iş tamamlanınca 'Ana sayfa' rozeti Ana sayfaya girmeden sayfa gezinince yenilenir; **iş tamamlanıp hemen Ana sayfaya dönülünce rozet panoyla eşitlenir (yoklamayı beklemez)**; 'Okundu işaretle' satırı süzgeçten çıkarır ve odağı sıradaki satıra taşır, satır bağlantısı okundu işaretler, 'Tümünü okundu işaretle' | 17,7 sn |
| `07-hesap-guvenligi.spec.ts` | giriş kilidi (5 test) | aynı takma ada 5 başarısız denemeden sonra **429 `login_locked` + `Retry-After`** (≈15 dk); kilitliyken doğru şifre de reddedilir, başka hesap etkilenmez; var olmayan ad için aynı yanıt ve aynı ileti (hesabın varlığı sızmaz); başarılı giriş sayacı sıfırlar; `identity.login_locked` denetim kaydı var ve tanımlayıcıyı içermez; giriş sayfası kilidi "Giriş geçici olarak durduruldu" başlığıyla gösterir | 1,5 sn |
| | hesap silme | iki ayrı vekâleti olan veren üyeye tek "Vekâletiniz düştü" bildirimi; yanlış şifrede yan etki yok (vekâletler yerinde); silinen hesapla giriş yapılamaz | 0,2 sn |
| | Idempotency-Key | aynı anahtarla yeniden gönderilen mesaj tek kez yayımlanır (`Idempotent-Replayed: true`), aynı anahtar farklı gövdeyle 422 `idempotency_key_reused` | 0,1 sn |
| `08-tur1-regresyon.spec.ts` | çerçeveleme koruması | `/`, `/api/health` ve hata gövdesinde `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`; başka kökendeki sayfanın iframe'inde uygulama belgesi yüklenmez (`#root` yok), aynı adres doğrudan açılınca yüklenir | 0,5 sn |
| | silinen bilirkişi | `bk_enerji2` hesabını siler → herkese açık ve kayıt memuru listesinde yok, profilde `isExpert: false`, alanlar boş; silinmiş hesaba takip/kefalet 409 `invalid_state`; Bilirkişiler sayfasında takma adı görünmez | 0,9 sn |
| | graf süzgeci | ziyaretçi tüm ilişki türlerini kaldırınca istek `types=` ile gider, düğümler gelir, kenar gelmez | 1,0 sn |
| | "Oyum kayıtlı mı?" | bir seçmen Kabul sonra Red oyu verir; `GET /api/ledger/txs?ballotId=&round=` yalnız bu pusulanın taahhütlerini (en yeni önce) verir; eski makbuz **✘ "daha yeni oyunuz var"**, güncel makbuz ✔ ve doğru taahhüt sayısı | 1,9 sn |
| | sunucu adresi değişimi | Ayarlar'da başka bir adres kaydedilince sahte sunucuya giden hiçbir istekte `Authorization` yok; eski sunucudaki belirteç iptal (401) ve kullanıcıya "oturumunuz kapatıldı" bildirimi | 0,9 sn |
| | kayıt formu kuralları | `...` takma adı, `-` ad, `'` soyad, `..` il ve `.....` açık adres satır içi iletilerle reddedilir; sunucuya istek gitmez | 0,8 sn |
| | şifre teyidi kilidi | oturumla 5 yanlış eski şifreden sonra 429 `login_locked` ("Şifre teyidinde…", `Retry-After`); kilitliyken doğru şifre de reddedilir; aynı hesabın girişi etkilenmez | 0,5 sn |

**Sonuç (5 Ekim 2026, Windows 11, Node 24.15, Playwright 1.63 / Chromium; test döngüsü tur 1
sonrası):** 75 / 75 test geçti, toplam 9,8 dk (küresel kurulum ~16–35 sn dahil). 360 px'de **219 görünüm, yatay taşma 0, sayfa/konsol hatası 0**. Koşu sonunda geçici klasör silinir,
4100 portunda dinleyen süreç kalmaz. (Tur 1 öncesi: 68 / 68; tur 1'in ilk tam koşusunda `06 › kontrast` 'yaşanmadı' evre numarasının soluk noktası (2,3–2,9:1) yüzünden kırmızıydı, düzeltildi. 3 Ekim, Faz 3 sonu: 61 / 61 test, ~9,2 dk; Faz 2 sonu: 33 / 33 test, 169 görünüm, ~5,3 dk.)
Faz 3'ün önce/sonra ölçümü aynı tohum ve aynı betikle (06 › 'ölçüm') alındı: [ARAYUZ_PLANI.md › Ölçüm](ARAYUZ_PLANI.md#ölçüm).
Not (3 Ekim): o turun ilk tam koşusunda `04-itiraz` testi, tohumun zamana bağlı küçük bir farkı yüzünden kırmızı çıktı (hak sahibi
listesi 3'te kesildiği için K-29'da yalnız 5 imza toplanabildi; çapraz küme kuralı 6 ister). Hak sahibi sınırı 8'e çıkarıldı (uygulama
değişmedi); sonraki tam koşu 61 / 61.

**Tohum tarihe bağlıdır (5 Ekim gözlemi).** Demo verisinin zaman çizelgesi gerçek tarihe göre kurulur (`Simüle zaman: 2026-09-01 → şimdi`);
aynı kod farklı günlerde tohumlandığında oylar küçük farklarla değişir (aynı gün tohumlandığında, yük altında da, birebir aynıdır). `06 › bütünlük
uyarısı` testi, 14 üyenin tohumdaki oy geçmişinin kilit adım örüntüsü (ikili uyum ≥ %90, en az 3 ortak oylama, 4 kişilik çekirdek) oluşturmasına
dayanır. Aynı kod (HEAD), tarihi 3 Ekim'e alınarak tohumlandığında 9 uyumlu çift ve 5 kişilik çekirdek verir (uyarı üretilir); gerçek tarih 5 Ekim
iken yalnız 6 çift uyumlu ve çekirdek yoktur — yani bu bir kod gerilemesi değil, tohumun tarihe bağlılığıdır. Test bu durumda önceden tasarlanmış
atlama dalına girer (`[atlandı]` ek açıklaması): uyarı kuralı sunucu ve birim testlerinde sınanır, arayüzde uyarının görünümü yalnız örüntü
oluştuğunda e2e'de sınanır. Kalıcı çözüm, testin kendi oy geçmişini üretmesidir ([MUHENDISLIK.md](MUHENDISLIK.md) › kısmi kalanlar).

Gözlem (uygulama, **düzeltildi**): oylama kapandıktan hemen sonra (yaklaşık bir blok aralığı, ~0,5 sn) bültendeki TALLY/BALLOT_REVEAL
işlemleri henüz bir bloğa girmemiş olabilir. "Sayımı kendim doğrulayayım" bunu artık hata saymaz: defterde bulunamayan işlem (404)
"henüz bloğa girmedi" (beklemede) sayılır, panel 1,2 sn arayla en çok 4 kez yeniden dener ve hâlâ beklemedeyse kırmızı "doğrulama
BAŞARISIZ" yerine mavi **"sayım hesaplandı, defter kaydı bekleniyor"** başlığını gösterir ("Oyum kayıtlı mı?" sayfası aynı durumu
"henüz" olarak gösterir; `web/src/lib/ledgerVerify.ts`, `VerifyTallyPanel.tsx`). Gerçek bir uyuşmazlık (özet tutmuyor, kanıt geçersiz)
ise yine kırmızı BAŞARISIZ'dır. Test, sayım işlemleri bloğa girene kadar API'yi yoklayarak bekler.

### 3.2 İlk koşu (bulut ortamı, geçici betiklerle)

Sunucu `npm run seed -- --reset` ile tohumlandı ve `npm start` ile 4000 portunda başlatıldı. Web, `web/dist` olarak aynı sunucudan sunuldu.

| # | Adım | Sonuç |
|---|---|---|
| 1 | Anonim kullanıcı `/kayit` formuyla kayıt olur (aydınlatma ↔ açık rıza kutuları ayrı; YZ rızası verilmedi) | ✔ "Kayıt memuru onayı bekleniyor" |
| 2 | Kayıt memuru `/kayit-memuru`: amaç girerek kişisel veriyi görüntüler (maskeli TCKN), ardından onaylar | ✔ üye `verified`; denetim günlüğünde `identity.pii_access` + amaç |
| 3 | Yeni üye girişi, `/oneriler/yeni`: başlık, metin, kategori ağacı; canlı ön denetim (T0, parametreler, bulgular) → "Kaydet ve destekçi toplamaya gönder" | ✔ öneri `sponsoring` |
| 4 | Destek: bir üye arayüzden, diğerleri API ile (K_s = 4) | ✔ ontoloji denetimi → `deliberation` |
| 5 | Yönetici `/yonetim`: +72 sa, +24 sa (tartışma 96 saat — tohumdaki yönetmelik yaması sonrası) | ✔ `voting`; parametreler sabitlendi; 52 uygun seçmen |
| 6 | Oy: üye arayüzden "Kabul" → makbuz cihaza kaydedildi; diğer oylar API ile (giriş hız sınırı 20/dk devrede — betik beklemek zorunda kaldı) | ✔ 49/52; oylama sürerken sonuç yok, yalnız katılım |
| 7 | `/oy-dogrula` (oylama sürerken) | ✔ anahtar sabitleme, dahil olma kanıtı, taahhüt, son taahhüt; açıklama/sayım "henüz yapılamaz" |
| 8 | Yönetici +72 sa → kapanış | ✔ Kabul: katılım 49/52 ≥ 11; onay %73,5 > %50; köprü testi A P=0,74, B P=0,77, C P=0,75 ≥ 0,30 → `objection_window` |
| 9 | "Sayımı kendim doğrulayayım" (tarayıcıda `verifyTally`) ve `/oy-dogrula` (kapanış sonrası) | ✔ TALLY/REVEAL defterle aynı, blok #371'de 3 doğrulayıcı imzası; makbuz 6/6 ✔ |
| 10 | Defter: v2'de blok 120 kurcalandı → `verifyChain` v2 ✘ ("işlem özeti tutmuyor") → onarım → 371 blok ✔; v3 çökertildi → blok üretimi sürdü (371→372) → v3 geri geldi ve yetişti | ✔ |
| 11 | Tohumdaki örnek sayfalar: tartışmalı (#K-24, ω ile kabul), itiraz yolu (#K-25), gizlenen mesaj (#K-21, mezar taşı + cevap), uzlaşma (#K-28, azınlık raporu + YZ köprü taslakları), yeniden oylama (#K-27), bilirkişi paneli (#K-7, çıkar çatışmasıyla dışlanan aday), yönetmeliğe aykırı (#K-22 "Görüş ayrılığı", #K-23 değiştirilemez madde) | ✔ görüntülendi, konsol hatası yok |

Sayfa taraması (360 px, oturumlu üye/yönetici/ziyaretçi): ana sayfa, konular, konu ayrıntısı, öneriler, yeni öneri, 13 farklı öneri ayrıntısı (her evreden), oy doğrulama, bilirkişiler, profil, üye, bildirimler, ayarlar, graf, defter, blok, işlem, yönetmelik, yönetim, kayıt memuru, giriş, kayıt — **36 görünüm, yatay taşma 0, sayfa/konsol hatası 0**. Sunucu günlüğünde 5xx yanıt yok.

### 3.3 Android emülatörü (Windows 11, Pixel 7 · API 34)

APK, JDK 21 (Android Studio `jbr`) ile `gradlew.bat assembleDebug` komutuyla derlendi ve `adb install -r` ile kuruldu. Sunucu
bilgisayarda `npm start` ile çalışırken uygulama varsayılan `http://10.0.2.2:4000` adresine ek ayar gerekmeden bağlandı.
Denenen akış ve sonuçlar:

| Adım | Sonuç |
|---|---|
| Açılış: canlı pano (simüle saat, defter yüksekliği, 4/4 doğrulayıcı, üye sayısı; bu bilgiler arayüz hafifletmeden sonra Ana sayfa vitrininde ve mobilde 'Daha fazla › Sistem durumu' bloğundadır) | ✔ |
| `ayse` ile giriş; oturum belirteci `@capacitor/preferences` ile saklanır, uygulama yeniden kurulunca da korunur | ✔ |
| #K-31'de oy: "Kabul" → "Oyumu ver" → makbuz cihaza kaydedildi | ✔ |
| "Oyum kayıtlı mı?": Merkle yolu, blok özeti, sabitlenmiş anahtarlarla 3 imza, taahhüt eşleşmesi, son taahhüt (oylama sürerken açıklama ve sayım adımları "henüz") | ✔ 4 + 2 bekliyor |
| #K-24'te "Sayımı kendim doğrulayayım": tartışmalı ilk tur WebView içinde yeniden sayıldı; TALLY/BALLOT_REVEAL defterle aynı, blok #218'e dahil (3 imza) | ✔ |
| Donanım geri tuşu: alt sayfa açıkken önce onu kapatır, sonra uygulama içinde geri gider, geçmiş yoksa uygulamadan çıkar | ✔ (ilk denemede uygulamadan çıkıyordu → `@capacitor/app` + `web/src/lib/native.ts` ile düzeltildi) |
| Ayarlar → "Bağlantıyı sına" | ✔ (5 ms) |
| Koyu tema | ✔ (durum çubuğu açık kalır; bkz. §5) |
| Sunucu verisi sıfırlanınca eski oturum | ✔ "Oturumunuz sona erdi" uyarısı ve yeniden giriş düğmesi |
| Alt gezinme, güvenli alan (çentik/gezinme çubuğu), 1080×2400 ekranda taşma | ✔ |

Ekran görüntüleri: [`docs/ekran/`](ekran/) (`android-01-acilis.png` … `android-08-koyu-tema.png`). Sekiz görüntü 3 Ekim 2026'da Faz 3
sonrası arayüzle, kurulu debug APK'dan (`Pixel_7_API_34`, 1080×2400; `http://10.0.2.2:4177` üzerindeki ayrı demo verisi) yeniden alındı;
tam arşiv (106 web + 107 Android görüntü, CSV envanteri, derleme ve doğrulama kaydı) `gorseller/2026-10-01/index.html` galerisindedir.
Çekilen görünümlerde (web 1440×1000, Android 1080×2400) yatay taşma 0 ve sayfa hatası 0 çıktı; tek konsol kaydı web'de tarayıcının
otomatik `/favicon.ico` 404'üdür (Android'de konsol kaydı yok). Araç: `gorseller/2026-10-01/araclar/ekranlari-kaydet.mjs` (yöntem: [ARAYUZ_PLANI.md](ARAYUZ_PLANI.md)).

## 4. Simülasyon (özet)

Ayrıntı ve tablolar: [SIMULASYON.md](SIMULASYON.md) (gerçek `decide()`/`computeClusters()` ile, tohumlu, |E| = 300, bloklar %60/%30/%10).

| Bulgu | Basit çoğunluk | Köprülü Çoğunluk |
|---|---|---|
| %10'luk azınlığa zarar veren öneriler — kabul | %100 | ilk tur %9,6; nihai %56,5 (çoğu ω = 2/3 ile) |
| Aynı öneri, uzlaşmada metin yumuşatılırsa | — | nihai %96,9 |
| Geniş destekli öneriler — kabul | %100 | %100 (bedel: 48 saatlik itiraz penceresi; oylamadan yürürlüğe toplam ~5,3 gün) |
| %10'luk blok çok popüler öneriyi engelleyebilir mi? | — | hayır: %100 yürürlüğe girer (erteleyici, tek seferlik) |
| Boykot engel olur mu? | — | hayır: nihai kabul %100 |
| Azınlığın istemediği halde kabul edilen karar oranı (kalıcı kaybeden) | %38,1 | %27,7 |
| Homojen nüfusta sahte küme (r2 sıfır modeli) | — | K = 1 (r1 kuralında 3–5 sahte küme) |

## 5. Bilinen sınırlamalar

- **Android durum çubuğu:** Koyu temada uygulama içeriği koyulaşır ancak sistem durum çubuğu açık renkte kalır (`@capacitor/status-bar` eklenmedi; yalnızca görünüm farkı).
- **Android açık metin trafiği:** Demo, HTTP sunucuya bağlanmak için `usesCleartextTraffic` kullanır; gerçek kullanımda sunucu HTTPS arkasında olmalı ve bu ayar kapatılmalıdır.
- **Gerçek Claude API çağrısı** bu ortamda yapılmadı (anahtar yok); Claude yolu sahte istemciyle birim testlerinde doğrulandı, çevrimdışı sezgisel mod uçtan uca çalıştı.
- **Defter düğümleri** aynı süreçte çalışır (arayüzde açıkça belirtilir); çok süreçli kip yoktur.
- **Elektrik kesintisi:** doğrulayıcı depoları her blokta fsync yapmaz (`synchronous=NORMAL`); işletim sistemi düzeyinde bir kesintide
  son blok depolardan kaybolabilir. Giden kutusu satırı depolar diske indirilmeden (`BlockStore.sync`) silinmediğinden işlem kaybolmaz,
  açılışta yeniden gönderilir; kaybolan bloğun yüksekliği ve kanıtı yeniden üretilen blokla değişebilir. Sıra (önce fsync, sonra
  satır silme) `ledger/outbox.test.ts`'te sınanır; gerçek bir elektrik kesintisi sınanmadı. Süreç ölümünde (çökme, `taskkill /F`,
  SIGKILL) kayıp yoktur ve gerçek süreç öldürülerek sınanır (`server/test/ledger/crash-recovery.test.ts`).
- **Bellek içi sınırlayıcılar:** hesap başına giriş kilidi, üye başına şifre teyidi kilidi ve `Idempotency-Key` yanıt deposu süreç
  belleğindedir; yeniden başlatmada sıfırlanır ve birden çok sunucu sürecinde paylaşılmaz.
- **Kayıtta üyelik sorgulanabilirliği:** `POST /api/auth/register` yinelenen TCKN/e-postayı 409 ile bildirir (KVKK §8.5, bilinen sınır;
  hız sınırı ve denetim kaydıyla hafifletilir). Kalıcı çözüm ürün kararı bekliyor ([MUHENDISLIK §3e](MUHENDISLIK.md)).
- **Belge sayıları elle güncellenir:** test, uç nokta ve denetim sayılarını belgeye bağlayan otomatik bir kapı yoktur (tek istisna
  `http/routes.test.ts`: API.md'deki uç noktalar).
