# Test Raporu

> Tarih: 1 Ekim 2026 · Son doğrulama ortamı: **Windows 11, Node 24.15**, TypeScript 7, vitest 5, Playwright 1.63 (Chromium), Android Emulator (Pixel 7, API 34) · İlk doğrulama: Linux, Node 22.22 · YZ: çevrimdışı sezgisel mod (`ANTHROPIC_API_KEY` yok).
> Yeniden üretmek için: `npm run typecheck && npm test && npm run build` (kökte), simülasyon için `npm run sim -w server`.

## 1. Özet

| Kontrol | Sonuç |
|---|---|
| `npm run typecheck` (shared + server + web) | ✔ 0 hata |
| `npm test` (sunucu 86 dosya + web 40 dosya) | ✔ **907 / 907** sunucu ve **668 / 668** web testi geçti (Windows/Node 24; 3 Ekim 2026, arayüz hafifletme Faz 3 ve inceleme düzeltmeleri sonrası) |
| `npm run build` (web, Vite) | ✔ |
| `npm run seed -- --reset` (tohum doğrulamaları, 18 kontrol) | ✔ (~30 sn, Windows) |
| `npm run sim -w server` (Monte Carlo, belirlenimci) | ✔ (~30 sn) → [SIMULASYON.md](SIMULASYON.md) |
| `npm run e2e` — tarayıcı uçtan uca test paketi (Playwright/Chromium, 6 dosya; Windows 11, Node 24) | ✔ **61 / 61** test (~9,2 dk; bkz. §3.1) |
| 360 px'de 219 sayfa/sekme görünümü (7 rol; 79'u 'Tam' görünümde, bütün açılırlar açık; 'Bu sayfada' tıklamaları, açık Term penceresi ve 'Süz' açılırı dahil): yatay taşma / sayfa-konsol hatası | ✔ 0 / 0 |
| Android: `npx cap sync android` + `gradlew assembleDebug` (JDK 21) | ✔ APK (~4,6 MB) derlendi, `Pixel_7_API_34` emülatöründe kuruldu ve `http://10.0.2.2:4000` sunucusuna bağlandı (bkz. §3.3) |

## 2. Birim ve entegrasyon testleri (modül bazında)

| Modül | Dosya | Test | Kapsam |
|---|---|---|---|
| `shared` (kripto, TCKN, RNG, rasyonel) + duman testi | 2 | 8 | RFC 6962 Merkle kanıtı (1–17 yaprak, her indeks), kanonik JSON, TCKN, tohumlu RNG, ağırlıklı örnekleme, rasyonel karşılaştırmalar |
| `governance` (karar + matematik) | 3 | 104 | `decide`: tüm katmanlar, kesin/≥ eşik sınırları, soğuk başlangıç (`max(τ, min(τ+δ, 2/3))`), anlamlı küme sınırları, μ_votes uzatma, uzatma sonrası nötr küme, boykotun engel olamaması, aktif azınlık → contested, DEL yazar kümesi, yeniden oylama (ω, ρ, güçlü itiraz); `evaluateObjection` (a)/(b); `verifyTally` (kurcalanmış bülten, taahhüt uyuşmazlığı, eksik açıklama); PCA+k-means+siluet+sıfır modeli (homojen veride K=1, bloklu veride K=3, belirlenimcilik, 300×60 < 2 sn); vekâlet (öncelik, kapsam/rank sırası, H=3, döngü, cap → unrouted) |
| `ledger` (BFT defter) | 4 | 18 | 4 düğümlü commit, tekilleştirme, bir düğüm çökünce canlılık + senkron, öneren çökünce tur değişimi, bizans düğümde güvenlik + EVIDENCE, kurcalama tespiti + onarım, `verifyInclusionProof` (doğru/sahte/yanlış anahtar), yeniden başlatma (kalıcılık), kişisel veri anahtarı reddi, zamanlayıcı sızıntısı yok — 10+ ardışık çalıştırmada kararlı |
| `ontology` (yönetmelik) | 5 | 71 | vocab ↔ TTL tutarlılığı, katman belirleme, hak kısıtlaması (yazar/bilirkişi → T3; YZ/üye → yalnız T1), içerik etiketi eşikleri, "Görüş ayrılığı" ihlali, alt konu/üst konu, en koruyucu parametre birleştirme, K_s, `validatePatch` meta-kuralları (değiştirilemez hedef, iki adımlı atlatma, yeni değiştirilemez madde yasağı, üst/alt koruma sınırları, overrides döngüsü), `applyPatch` sürümleme, belge ↔ TTL madde metni eşitliği |
| `graph` | 2 | 45 | takip/kefalet/yakınlık, vekâlet döngü reddi, doğrulanmamış hedef, mesafe, çıkar çatışması (aile ≤3 adım, hane, yumuşak 1/0,5), DELEGATION yükünde ham kimlik yok (HMAC), Louvain belirlenimciliği, SybilRank, kilit adım, kalıcı kaybeden, özel kenarların gizlenmesi |
| `identity` (KVKK) | 4 | 60 | doğrulama hataları, veritabanında düz metin kişisel veri yokluğu, AAD bağlama, kör indeks tekilliği, oturum belirteci kurcalama/süre, onay/red akışı, PII erişim günlüğü, kripto-imha (sonrasında giriş/PII yok, aynı TCKN ile yeniden kayıt), KVKK döküm, şifre değiştirme |
| `ai` | 5 | 85 | Claude çağrı biçimi (model, `server-side-fallback`, `fallbacks:"default"`, adaptive thinking, `output_config.format`, temperature yok), `refusal`/geçersiz JSON/şema dışı/hata → çevrimdışı yedek, maskeleme (istekte TCKN/e-posta/telefon/IBAN/takma ad yok), `forceOffline`, çevrimdışı sınıflandırma kalibrasyonu (zararsız "sadece/yalnızca" < 0,5; grup hedefli dışlama ≥ 0,8), moderasyon, özet (azınlık bölümü), benzerlik, köprü taslakları, bilirkişi raporu denetimi (hukuki nitelendirme, alan dışı), kişisel veri tespiti |
| `experts` (bilirkişi) | 4 | 43 | başvuru/onay/yaptırım, aday havuzu (alt/üst kategori), kesin dışlamalar, yumuşak çatışma ağırlığı, tohum formülü ve belirlenimcilik, önceden taahhüt edilen blokla tohum doğrulaması, EXPERT_DRAW yükünde ham kimlik yok, genişleme, çekinme → yedek davet, rapor puanı S ve R′, askı kuralı sınırları, gecikme cezası, kapanan öneride itiraz cezasız iptal |
| `forum` (çekirdek) | 11 | 66 | §8'in 10 senaryosu: tam akış (öneri → yürürlük, gerçek BFT defterle), tartışmalı → uzlaşma → yeniden oylama (ω), itiraz yolu (bütçe, "no" şartı, kural a, ρ), silme yolu (acil daraltma, DEL, mezar taşı, tek cevap, denetçi okuma kaydı, "Görüş ayrılığı" → inadmissible, talep sınırı), yönetmelik yaması (T2, yeni sürüm, BYLAW_VERSION; değiştirilemez hedef → inadmissible), sürüm çakışması, uzatma ve oylama sürerken sonuç gizliliği, vekâlet + cap, kişisel veri 422, **defter taraması (hiçbir kayıtta kullanıcı kimliği/takma ad/yasak anahtar yok)**, itiraz imzacılarının anonimliği; her kesin turda `verifyTally(bülten)` ✔ |
| `http` | 6 | 169 | API.md'deki 95 uç noktanın her birinin kayıtlı olduğu (ve belgelenmemiş uç olmadığı), hata biçimi (400/401/403/404/409/413/415/422/429/500 — yığın izi yok), yetki matrisi, CORS (`http://localhost`, `capacitor://localhost`), SPA geri dönüşü, HTTP üzerinden tam öneri akışı + istemci tarafı `verifyTally` + makbuz kanıtı, saat kalıcılığı, görüş/oy gizliliği (küme haritası ve graf düğümleri yalnız kişinin kendisine) |
| `seed` | 2 | 5 | küçültülmüş tohumun bellek içinde zincir ve sayım doğrulaması |
| **Toplam (1 Ekim)** | **48** | **674** | 2 Ekim itibarıyla ilke incelemesi düzeltmeleriyle 76 dosya / 863 test; ayrıntı [MUHENDISLIK.md](MUHENDISLIK.md) |

## 3. Tarayıcıda uçtan uca senaryo (Playwright, tohumlanmış sunucu)

### 3.1 Depodaki test paketi: `npm run e2e`

Testler `e2e/` klasöründedir (Playwright 1.63, Chromium). Çalıştırma: kökte `npx playwright install chromium` (bir kez) ve
`npm run e2e`; tip denetimi `npm run e2e:typecheck`.

**Düzenek.** Küresel kurulum (`e2e/global-setup.ts`) `web/dist` yoksa ya da kaynaklardan eskiyse web'i derler (`vite build`) ve
geçici bir klasörde demo verisini tohumlar (`DATA_DIR=<geçici>/template/data`, `seed.ts --reset`; 16 tohum denetimi dahil, ~20–30 sn).
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
| | Kontrast | Ana sayfa ve 5 öneri sayfası, 360 px, üç yolla (açık; sistem koyu; Ayarlar'dan koyu), 'Tam' kipte: her metin için WCAG AA (4,5:1; büyük metinde 3:1) ve yatay taşma 0 | 24,5 sn |
| | Sade dil (4 test) | Term düğmesi (dokunmatik, 360 px) pencere açar, Esc kapatır ve odak terime döner; 'Yönetmelikte ›' yönetmelik sekmesine, 'Sözlükte ›' Keşfet sözlüğündeki terime götürür; 'Karar parametreleri'nde Yunan sembolü ve formül ilk okumada yok, anahtar (klavyeyle) hepsini açar, 'Tam' kipte açık; Term düğmeleri ('Tam' görünümde taranır) ayrılmış ad parçası içermez ve başlık, bağlantı, düğme, `<summary>`, etiket ya da Uzlaşma/İtiraz paneli içinde değildir; T1 ve üstü katman rozeti sözlük penceresini açar | 13,7 sn |
| | Keşfet ve doğrula (7 test) | yedi bileşen canlı durumuyla (uyarı yalnız gerekince, mor yalnız YZ satırında) ve her satır tek dokunuşla ilgili yere; yedi adımlı rehberin her bağlantısı mevcut veriden kurulur ve doğru sekmeye/çapaya gider; erişim yolları (vitrin, masaüstü alt bilgisi, mobil 'Daha fazla'; üst gezinme 8 öğe kalır); 8 ilkenin tam metni ve 'Bu sayfada'; sözlük (Türkçe duyarsız arama, 'özet' aynen ve günlük karşılığı 'parmak izi', `?bolum=terim-…`); 360 px 'Tam' görünümde taşma yok | 36,7 sn |
| | Görev rozeti ve 'Sizden bekleniyor' (2 test) | 'Ana sayfa' rozeti sunucunun görev sayısıyla ve 'Sizi bekleyenler (n)' ile aynı; rozet `aria-hidden`, bağlantı adı değişmez, sayı `aria-describedby` ile okunur; alt gezinmede kesilmeden görünür; ziyaretçide yok; oy bekleyen kartta düz metin 'Sizden bekleniyor: Oy' | 4,1 sn |
| | Bildirimler | okunmamış varsa 'Okunmamış' açılır; Bugün / Bu hafta / Daha eski `h2` grupları; satırın tamamı bağlantı; satır başına tek 'Okundu işaretle: <başlık>' düğmesi | 3,7 sn |
| | Yeni öneri (4 test) | tür seçilince 5 radyo kompakt şeride iner (radyolar DOM'da, ok tuşları), 'Başlık' alanına uzaklık annotation; ön denetim 'önce hüküm' (hüküm → katman ve destekçi satırları → açılırlar), sade kipte kapalı, 'Tam'da açık; alt konu ve düzenlemede 'Ek kategoriler' kapalı; **sözlük penceresinin bağlantıları yeni sekmede açılır, form adresi ve yazılanlar yerinde kalır**; **'YZ önerileri' ilk 'Ekle'de kapanmaz, odak sıradaki 'Ekle'ye geçer**; silme talebinde 'Tartışma silinmez' tek cümle, kurallar canlı sayaçlı tek satır (`role="status"`), dört kural açılırda | 15,0 sn |
| | Profil, Ayarlar, Konular (5 test) | Profil: 'Oy hakkınız' kartı en üstte, eksik koşullar ve TEK eylem; seyrek işler başlığı görünür katlı kartlarda, `?bolum=` açar; Ayarlar: Görünüm → Sunucu → Makbuzlar → Gelişmiş, TOFU ve Ed25519 ilk okumada yok; Konular: tek satır sayaçlar, telefonda 'Süz'; Konu ayrıntısı: metin → açık öneriler → tartışma → alt konular → katlı sürüm geçmişi, çapalar | 19,6 sn |
| | Kontrast (Faz 3) | Keşfet, Öneriler, Konular, Bildirimler, Profil, Ayarlar, yeni öneri ve Term penceresi — açık ve iki koyu temada WCAG AA, 360 px'de taşma 0 | 28,3 sn |
| | Veri üreten (3 test) | bir iş tamamlanınca 'Ana sayfa' rozeti Ana sayfaya girmeden sayfa gezinince yenilenir; **iş tamamlanıp hemen Ana sayfaya dönülünce rozet panoyla eşitlenir (yoklamayı beklemez)**; 'Okundu işaretle' satırı süzgeçten çıkarır ve odağı sıradaki satıra taşır, satır bağlantısı okundu işaretler, 'Tümünü okundu işaretle' | 17,7 sn |

**Sonuç (3 Ekim 2026, Windows 11, Node 24.15, Playwright 1.63 / Chromium):** 61 / 61 test geçti, toplam ~9,2 dk (küresel
kurulum ~16–30 sn dahil); arayüz hafifletme Faz 3 ve inceleme düzeltmeleri sonrası tam koşu yeşil. 360 px'de **219 görünüm,
yatay taşma 0, sayfa/konsol hatası 0**. Koşu sonunda geçici klasör silinir, 4100 portunda dinleyen süreç kalmaz. (Faz 2 sonu:
33 / 33 test, 169 görünüm, ~5,3 dk.) Faz 3'ün önce/sonra ölçümü aynı tohum ve aynı betikle (06 › 'ölçüm') alındı:
[ARAYUZ_PLANI.md › Ölçüm](ARAYUZ_PLANI.md#ölçüm). Not: bu turun ilk tam koşusunda `04-itiraz` testi, tohumun zamana bağlı küçük bir
farkı yüzünden kırmızı çıktı (hak sahibi listesi 3'te kesildiği için K-29'da yalnız 5 imza toplanabildi; çapraz küme kuralı 6 ister).
Hak sahibi sınırı 8'e çıkarıldı (uygulama değişmedi); sonraki tam koşu 61 / 61.

Gözlem (uygulama, düzeltilmedi): oylama kapandıktan hemen sonra (yaklaşık bir blok aralığı, ~0,5 sn) bültendeki TALLY/BALLOT_REVEAL
işlemleri henüz bir bloğa girmemiştir; bu arada "Sayımı kendim doğrulayayım"a basılırsa panel "İşlem bulunamadı" ile kırmızı
**"doğrulama BAŞARISIZ"** gösterir ("Oyum kayıtlı mı?" sayfası aynı durumu "henüz" olarak gösterir). Test, sayım işlemleri bloğa
girene kadar API'yi yoklayarak bekler.

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
