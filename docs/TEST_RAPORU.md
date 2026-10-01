# Test Raporu

> Tarih: 1 Ekim 2026 · Ortam: Linux, Node 22.22, TypeScript 7, vitest 5, Playwright (Chromium) · YZ: çevrimdışı sezgisel mod (`ANTHROPIC_API_KEY` yok).
> Yeniden üretmek için: `npm run typecheck && npm test && npm run build` (kökte), simülasyon için `npm run sim -w server`.

## 1. Özet

| Kontrol | Sonuç |
|---|---|
| `npm run typecheck` (shared + server + web) | ✔ 0 hata |
| `npm test` (sunucu, 42 dosya) | ✔ **619 / 619** test geçti |
| `npm run build` (web, Vite) | ✔ |
| `npm run seed -- --reset` (tohum doğrulamaları, 16 kontrol) | ✔ (~35 sn) |
| `npm run sim -w server` (Monte Carlo, belirlenimci) | ✔ (~30 sn) → [SIMULASYON.md](SIMULASYON.md) |
| Tarayıcıda uçtan uca senaryo (tohumlanmış sunucu) | ✔ (bkz. §3) |
| 360 px'de 36 sayfa görünümü: yatay taşma / konsol hatası | ✔ 0 / 0 |
| Android: `npx cap sync android` | ✔ · `gradlew assembleDebug` bu bulut ortamında çalıştırılamadı (Android SDK indirme sunucusu ağ politikasıyla engelli; bkz. §5) |

## 2. Birim ve entegrasyon testleri (modül bazında)

| Modül | Dosya | Test | Kapsam |
|---|---|---|---|
| `shared` (kripto, TCKN, RNG, rasyonel) | 1 | 7 | RFC 6962 Merkle kanıtı (1–17 yaprak, her indeks), kanonik JSON, TCKN, tohumlu RNG, ağırlıklı örnekleme, rasyonel karşılaştırmalar |
| `governance` (karar + matematik) | 3 | 103 | `decide`: tüm katmanlar, kesin/≥ eşik sınırları, soğuk başlangıç (`max(τ, min(τ+δ, 2/3))`), anlamlı küme sınırları, μ_votes uzatma, uzatma sonrası nötr küme, boykotun engel olamaması, aktif azınlık → contested, DEL yazar kümesi, yeniden oylama (ω, ρ, güçlü itiraz); `evaluateObjection` (a)/(b); `verifyTally` (kurcalanmış bülten, taahhüt uyuşmazlığı, eksik açıklama); PCA+k-means+siluet+sıfır modeli (homojen veride K=1, bloklu veride K=3, belirlenimcilik, 300×60 < 2 sn); vekâlet (öncelik, kapsam/rank sırası, H=3, döngü, cap → unrouted) |
| `ledger` (BFT defter) | 4 | 18 | 4 düğümlü commit, tekilleştirme, bir düğüm çökünce canlılık + senkron, öneren çökünce tur değişimi, bizans düğümde güvenlik + EVIDENCE, kurcalama tespiti + onarım, `verifyInclusionProof` (doğru/sahte/yanlış anahtar), yeniden başlatma (kalıcılık), kişisel veri anahtarı reddi, zamanlayıcı sızıntısı yok — 10+ ardışık çalıştırmada kararlı |
| `ontology` (yönetmelik) | 5 | 71 | vocab ↔ TTL tutarlılığı, katman belirleme, hak kısıtlaması (yazar/bilirkişi → T3; YZ/üye → yalnız T1), içerik etiketi eşikleri, "Görüş ayrılığı" ihlali, alt konu/üst konu, en koruyucu parametre birleştirme, K_s, `validatePatch` meta-kuralları (değiştirilemez hedef, iki adımlı atlatma, yeni değiştirilemez madde yasağı, üst/alt koruma sınırları, overrides döngüsü), `applyPatch` sürümleme, belge ↔ TTL madde metni eşitliği |
| `graph` | 2 | 39 | takip/kefalet/yakınlık, vekâlet döngü reddi, doğrulanmamış hedef, mesafe, çıkar çatışması (aile ≤3 adım, hane, yumuşak 1/0,5), DELEGATION yükünde ham kimlik yok (HMAC), Louvain belirlenimciliği, SybilRank, kilit adım, kalıcı kaybeden, özel kenarların gizlenmesi |
| `identity` (KVKK) | 2 | 49 | doğrulama hataları, veritabanında düz metin kişisel veri yokluğu, AAD bağlama, kör indeks tekilliği, oturum belirteci kurcalama/süre, onay/red akışı, PII erişim günlüğü, kripto-imha (sonrasında giriş/PII yok, aynı TCKN ile yeniden kayıt), KVKK döküm, şifre değiştirme |
| `ai` | 5 | 82 | Claude çağrı biçimi (model, `server-side-fallback`, `fallbacks:"default"`, adaptive thinking, `output_config.format`, temperature yok), `refusal`/geçersiz JSON/şema dışı/hata → çevrimdışı yedek, maskeleme (istekte TCKN/e-posta/telefon/IBAN/takma ad yok), `forceOffline`, çevrimdışı sınıflandırma kalibrasyonu (zararsız "sadece/yalnızca" < 0,5; grup hedefli dışlama ≥ 0,8), moderasyon, özet (azınlık bölümü), benzerlik, köprü taslakları, bilirkişi raporu denetimi (hukuki nitelendirme, alan dışı), kişisel veri tespiti |
| `experts` (bilirkişi) | 3 | 36 | başvuru/onay/yaptırım, aday havuzu (alt/üst kategori), kesin dışlamalar, yumuşak çatışma ağırlığı, tohum formülü ve belirlenimcilik, önceden taahhüt edilen blokla tohum doğrulaması, EXPERT_DRAW yükünde ham kimlik yok, genişleme, çekinme → yedek davet, rapor puanı S ve R′, askı kuralı sınırları, gecikme cezası, kapanan öneride itiraz cezasız iptal |
| `forum` (çekirdek) | 10 | 57 | §8'in 10 senaryosu: tam akış (öneri → yürürlük, gerçek BFT defterle), tartışmalı → uzlaşma → yeniden oylama (ω), itiraz yolu (bütçe, "no" şartı, kural a, ρ), silme yolu (acil daraltma, DEL, mezar taşı, tek cevap, denetçi okuma kaydı, "Görüş ayrılığı" → inadmissible, talep sınırı), yönetmelik yaması (T2, yeni sürüm, BYLAW_VERSION; değiştirilemez hedef → inadmissible), sürüm çakışması, uzatma ve oylama sürerken sonuç gizliliği, vekâlet + cap, kişisel veri 422, **defter taraması (hiçbir kayıtta kullanıcı kimliği/takma ad/yasak anahtar yok)**, itiraz imzacılarının anonimliği; her kesin turda `verifyTally(bülten)` ✔ |
| `http` | 5 | 155 | API.md'deki 95 uç noktanın her birinin kayıtlı olduğu (ve belgelenmemiş uç olmadığı), hata biçimi (400/401/403/404/409/413/415/422/429/500 — yığın izi yok), yetki matrisi, CORS (`http://localhost`, `capacitor://localhost`), SPA geri dönüşü, HTTP üzerinden tam öneri akışı + istemci tarafı `verifyTally` + makbuz kanıtı, saat kalıcılığı, görüş/oy gizliliği (küme haritası ve graf düğümleri yalnız kişinin kendisine) |
| `seed` | 1 | 1 | küçültülmüş tohumun bellek içinde zincir ve sayım doğrulaması |
| **Toplam** | **42** | **619** | |

## 3. Tarayıcıda uçtan uca senaryo (Playwright, tohumlanmış sunucu)

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

## 4. Simülasyon (özet)

Ayrıntı ve tablolar: [SIMULASYON.md](SIMULASYON.md) (gerçek `decide()`/`computeClusters()` ile, tohumlu, |E| = 300, bloklar %60/%30/%10).

| Bulgu | Basit çoğunluk | Köprülü Çoğunluk |
|---|---|---|
| %10'luk azınlığa zarar veren öneriler — kabul | %100 | ilk tur %9,6; nihai %56,5 (çoğu ω = 2/3 ile) |
| Aynı öneri, uzlaşmada metin yumuşatılırsa | — | nihai %96,9 |
| Geniş destekli öneriler — kabul | %100 | %100 (bedel: ~5 gün itiraz gecikmesi) |
| %10'luk blok çok popüler öneriyi engelleyebilir mi? | — | hayır: %100 yürürlüğe girer (erteleyici, tek seferlik) |
| Boykot engel olur mu? | — | hayır: nihai kabul %100 |
| Azınlığın istemediği halde kabul edilen karar oranı (kalıcı kaybeden) | %38,1 | %27,7 |
| Homojen nüfusta sahte küme (r2 sıfır modeli) | — | K = 1 (r1 kuralında 3–5 sahte küme) |

## 5. Bilinen sınırlamalar

- **Android APK:** Bu bulut ortamında Android SDK yok ve SDK indirme sunucusu (`dl.google.com`) ağ politikasıyla engelli. `npx cap sync android` çalıştı ve Android projesi güncel; `gradlew assembleDebug` geliştirici makinesinde çalıştırılmalıdır (README'deki adımlar; JDK 21 + Android SDK 34–36). Manifest, emülatörde `http://10.0.2.2:4000`'e bağlanmak için açık metin trafiğine izin verir.
- **Gerçek Claude API çağrısı** bu ortamda yapılmadı (anahtar yok); Claude yolu sahte istemciyle birim testlerinde doğrulandı, çevrimdışı sezgisel mod uçtan uca çalıştı.
- **Defter düğümleri** aynı süreçte çalışır (arayüzde açıkça belirtilir); çok süreçli kip yoktur.
