# DEVAM PROMPTU (2) — Forum Sistemi (yeni sohbette ilk mesaj olarak ver)

> Proje: **Katılımcı Yönetişim Forumu** ("Form/Forum Sistemi") — üniversite ödevi. Uzak depo: https://github.com/ahmedberatAI/Form-Sistemi
> (kullanıcı push izni verdi). Yerel kopya (Windows): `C:\Users\omen\Desktop\formSistemi`.
> Kullanıcı Türkçe konuşur. Arayüz metinleri, belgeler, kod yorumları ve commit mesajları **Türkçe**dir (ç ğ ı ö ş ü İ doğru);
> kod tanımlayıcıları İngilizcedir.

---

## 0. Durum özeti — sistem büyük ölçüde BİTTİ

Önceki oturum (bulut ortamı) sistemin tamamını yazdı, test etti ve **`claude/stoic-ptolemy-wpk2z3`** dalına push etti
(son commit `221d47c`). Bu oturumun işi: **kalan işleri tamamlamak** — öncelikle Android APK derlemesi ve emülatör testi
(bulutta Android SDK indirilemedi), Windows/Node 24 doğrulaması, birkaç bilinen eksik, tarayıcı uçtan uca testlerinin depoya
eklenmesi, git geçmişinin düzenlenip `main`'e alınması.

Doğrulanmış durum (Linux, Node 22.22):

| Kontrol | Sonuç |
|---|---|
| `npm run typecheck` (shared + server + web) | ✔ 0 hata |
| `npm test` (sunucu, 42 dosya) | ✔ 619/619 |
| `npm run build` (web) | ✔ |
| `npm run seed -- --reset` (16 iç kontrol) | ✔ ~35 sn |
| `npm run sim -w server` | ✔ ~30 sn → `docs/SIMULASYON.md` |
| Tarayıcıda uçtan uca (Playwright, tohumlu sunucu) | ✔ kayıt → kayıt memuru PII (amaçlı) + onay → arayüzden öneri → destek → yönetici saat ileri → oy + makbuz → kapanış (köprü testi 3 kümede ✔) → tarayıcıda yeniden sayım ✔ → makbuz 6/6 ✔ → defter kurcala ✘ / onar ✔ / düğüm çökmesi |
| 360 px, 36 sayfa görünümü | ✔ taşma 0, konsol hatası 0 |
| Android | `npx cap sync android` ✔; **`gradlew assembleDebug` YAPILAMADI** (bulutta SDK yok) |

---

## 1. Ortam (yerel Windows makinesi)

| Araç | Durum |
|---|---|
| Node | v24.x (`node:sqlite` yerleşik). Önceki doğrulama Node 22'de yapıldı → Node 24'te yeniden doğrula |
| npm | 11, workspaces (`shared`, `server`, `web`) |
| TypeScript | 7.0.2 (`npx tsc -p tsconfig.json`), tsx, vitest 5, Vite 8, React 19, react-router-dom 7, Capacitor 8.5.2 |
| Java | Varsayılan JDK 17. **Android derlemesi JDK 21 ister:** `export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"` |
| Android SDK | `C:\Users\omen\AppData\Local\Android\Sdk` (platform 34–36). AVD: `Pixel_7_API_34`. Gradle 8.14.3 önbellekte |
| Docker | Kurulu ama çalışmıyor — kullanma |
| `ANTHROPIC_API_KEY` | Yok (varsa §4.3). Sistem çevrimdışı sezgisel modda tam çalışır |
| Kabuk | Git Bash ve PowerShell. Uzun heredoc'lar bozulabilir; dosya yazmak için Write aracını kullan |
| Playwright | Gerekirse `web` ya da kök için dev bağımlılığı olarak kur (`npx playwright install chromium`) — yerelde izin sorunu yok |

---

## 2. Depoyu yerelde hazırlama — DİKKAT: eski yerel commit'ler

Yerel klasörde, GitHub'a hiç gönderilmemiş **eski** iki commit olabilir: `2444339` (web temeli) ve `2d4ba5b` (WIP — doğrulanmamış,
yarım kalmış paralel ajan çıktıları). Yeni çalışma bunlardan bağımsız olarak `36d8e61`'den yeniden yazıldı. **Bunları yeni dalla
BİRLEŞTİRME** (dev çakışma çıkar ve yeni kod daha kapsamlı). Önce yedekle, sonra yeni dala geç:

```bash
cd /c/Users/omen/Desktop/formSistemi
git status                                   # kaydedilmemiş değişiklik varsa: git stash -u  (kullanıcıya sor)
git branch yedek/eski-yerel-wip HEAD          # eski yerel durumu kaybetmemek için
git fetch origin
git checkout -B calisma origin/claude/stoic-ptolemy-wpk2z3
npm ci
```

Eski `2d4ba5b` içinde yeni kodda olmayan değerli bir parça olduğundan şüphelenirsen yalnızca **okuyarak** karşılaştır
(`git show 2d4ba5b --stat`), gerekirse elle taşı; birleştirme yapma.

---

## 3. Önce oku (bağlayıcı belgeler ve sözleşmeler)

- `README.md` — kurulum, demo hesapları, gereksinim → çözüm eşlemesi, azınlık koruması bölümü.
- `docs/ALGORITMA.md` — **bağlayıcı** "Köprülü Çoğunluk" KC-1.0 (revizyon r2). §12 = uygulama netleştirmeleri (en koruyucu yorumlar) —
  bunları GERİ ALMA.
- `docs/API.md` (95 uç nokta), `docs/MIMARI.md`, `docs/KVKK.md`, `docs/YONETMELIK.md`, `docs/SIMULASYON.md`, `docs/TEST_RAPORU.md`.
- Sözleşmeler: `shared/src/{types,api,vocab,decision,crypto}.ts`, `server/src/core/{contracts,forum-contracts}.ts`,
  `server/src/db/schema.sql`. Değiştirirsen tüm kullanıcılarını (sunucu, testler, web, sahteler `server/test/helpers/fakes.ts`,
  `server/test/http/stubs.ts`) güncelle.
- Web altyapı kılavuzu: `web/src/README.md` (`useAsync`, `useAction`, `useAuth().now()`, `useToast`, `useConfirm`, `useOntology`,
  ui bileşenleri, CSS sınıfları, `routes`).

### Klasör haritası
- `server/src/`: `core` (ScaledClock, Config, AppError, notifier, audit), `db`, `ledger` (4 doğrulayıcılı BFT), `ontology`
  (TTL + N3 Reasoner + SHACL), `governance` (decide çağıranları, PCA/k-means + sıfır modeli, vekâlet, kura), `graph`, `identity`
  (kasa/KVKK), `ai` (Claude + çevrimdışı), `experts`, `forum` (öneri, yaşam döngüsü, sayım, konu, tartışma, küme, topluluk),
  `http` (Fastify 5, 14 rota dosyası), `seed` + `seed.ts`, `app.ts` (bileşim kökü), `index.ts`.
- `server/ontology/*.ttl|n3`, `server/scripts/simulate.ts`, `server/test/<modül>/`.
- `web/src/`: `api`, `auth`, `ui`, `lib`, `components/{participation,proposals,community,system,layout}`, `pages` (21 sayfa).

### Korunacak tasarım ilkeleri (özet)
1. Köprülü Çoğunluk; azınlık gücü erteleyici ve tek seferlik; 2/3 aşma; değiştirilemez maddeler oylanamaz (T3).
2. Tartışma fiziksel olarak silinmez (`DELETE` yok); silme = karartma + mezar taşı; "görüş ayrılığı" gerekçe olamaz.
3. Defterde kişisel veri ve kullanıcı↔oy bağı YOK (doğrulayıcılar `email`, `body`, `nickname`… anahtarlı yükleri reddeder).
4. YZ ve bilirkişi danışmandır; YZ durum değiştirmez; her YZ çıktısı `aiLabel` etiketli; YZ/üye hak bayrağı yalnız T1'e yükseltir.
5. Alan mantığında `Date.now()`/`Math.random()` yok → `ctx.clock` (`ScaledClock`, TIME_SCALE=60) ve tohumlu RNG; rasyonel karşılaştırma.
6. Gizlilik: itiraz imzacıları anonim; görüş kümesi/koordinat yalnız kişinin kendisine; `RELATED_TO` yalnız denetçiye.
7. KVKK: alan bazında AES-256-GCM, kör indeks, aydınlatma ≠ açık rıza, kripto-imha (oylamaya konmaz).

### Demo hesapları (`npm run seed -- --reset` sonrası)
`yonetici` / `Yonetici123!` · `kayitmemuru` / `Kayit123!` · `denetci` / `Denetci123!` · `bk_enerji1-2`, `bk_saglik1-3`, `bk_imar1-2` /
`Bilirkisi123!` · `ayse`, `mehmet`, `zeynep` + 43 üye / `Uye12345!`. Tohum: 34 öneri (her evrede en az bir; #K-24 tartışmalı→ω,
#K-25 itiraz yolu, #K-21 gizlenen mesaj, #K-27 yeniden oylama, #K-28 uzlaşma, #K-29 itiraz süresi, #K-30 oylama, #K-31 acil silme,
#K-22/#K-23 yönetmeliğe aykırı, #K-5 yönetmelik yaması, #K-7 bilirkişi paneli).

---

## 4. Yapılacaklar (öncelik sırasıyla)

### 4.1 Windows / Node 24 doğrulaması
```bash
npm run typecheck && npm test && npm run build
npm run seed -- --reset && npm start          # http://localhost:4000
```
- Windows'a özgü sorunları düzelt: yollar, satır sonları (`.gitattributes` LF), `seed --reset`'in dosya silmesi, `tsx` ile ESM,
  TS 7 farkları. Kök `npm run dev` betiği `&` kullanıyor (Windows `cmd`'de arka plana atmaz) → yeni bağımlılık eklemeden çözen bir
  Node betiği (`scripts/dev.mjs`, iki süreci başlatıp çıktılarını önekleyen) yaz ve README'yi güncelle.
- Tarayıcıda `http://localhost:4000` ile hızlı bir göz kontrolü yap.

### 4.2 Android APK + emülatör (EN ÖNEMLİ KALAN İŞ)
```bash
cd web && npx vite build && npx cap sync android
cd android && JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew.bat assembleDebug
# emülatör: Pixel_7_API_34 → adb install -r app/build/outputs/apk/debug/app-debug.apk
```
- Bilgisayarda sunucu `npm start` ile çalışırken uygulama `http://10.0.2.2:4000`'e bağlanmalı (Ayarlar → "Bağlantıyı sına").
  Manifest'te `android:usesCleartextTraffic="true"` var; sunucu CORS'u `http://localhost`, `capacitor://localhost`'a izin veriyor.
- Emülatörde dene: giriş (`ayse`), ana sayfa, öneri listesi, #K-30'da oy ver (makbuz `@capacitor/preferences` ile kaydediliyor mu?),
  "Oyum kayıtlı mı?" (doğrulayıcı anahtar sabitleme + kanıt ✔), bir öneride "Sayımı kendim doğrulayayım", tema, alt gezinme,
  güvenli alan (çentik), geri tuşu davranışı (HashRouter). Ekran görüntüleri: `adb exec-out screencap -p > docs/ekran/android-*.png`.
- Sorunları düzelt (ör. WebView'de `crypto`/`TextEncoder`, Preferences, klavye taşması). Sonuçları `docs/TEST_RAPORU.md` §1 ve §5'e
  işle ("Android: derlendi ve emülatörde sunucuya bağlandı ✔").

### 4.3 (İsteğe bağlı) Gerçek Claude API
`ANTHROPIC_API_KEY` varsa: her YZ görevini (sınıflandırma, moderasyon, özet, köprü taslakları, bilirkişi raporu denetimi) bir kez
gerçek API ile çalıştır; istek biçimi `server/src/ai/claude.ts`'de (`claude-opus-5-5`, `betas: ["server-side-fallback-2026-07-01"]`,
`fallbacks: "default"`, `thinking: {type: "adaptive"}`, `output_config: {effort, format: {type: "json_schema", schema}}`; temperature
ve prefill YOK). Maskeleme ve rıza (`forceOffline`) korunmalı. Anahtar yoksa bu adımı atla.

### 4.4 Bilinen eksikler (küçükten büyüğe; her biri için test ekle)
a. **`ProposalDetail`'e `rightsFlags`** (`{right, direction, source}[]`) ve **`canWriteMinorityReport`** ekle (sunucu `forum/detail.ts`
   + tip). Web: hak bayrağı kaldırma doğru yönü kullansın (`components/participation/RightsFlags.tsx`); azınlık raporu formu yalnız
   tur-1 etkin oyu "red" olan uygun seçmene görünsün (`ReconciliationPanel`/`ObjectionPanel`).
b. **Kilit adım (lockstep) tespiti** `graph.lockstep(proposalId)` var ama kullanılmıyor: oylama kapanışında çalıştır, sonucu karar
   DEĞİŞTİRMEDEN denetim uyarısı olarak `ProposalDetail` (ör. `integrityWarnings`) ve yönetim panelinde göster.
c. **Kefalet ve yakınlık beyanını geri alma**: `DELETE /api/users/:id/vouch`, `DELETE /api/users/:id/relate` (kenar silinmez,
   `revoked_at`), `docs/API.md` + `web/src/api/endpoints.ts` + `UserPage` + `server/test/http/routes.test.ts` (API.md ↔ rota eşleşme testi
   var — güncel tut).
d. **SybilRank kalibrasyonu**: küçük ağlarda fazla işaretliyor (bir denemede 15 düğümün 8'i). Tohum verisinde kaç hesap işaretlendiğine
   bak; tohum hesaplarının kefalet ağına bağlı olduğu durumda işaretlemenin makul kalmasını sağlayan eşik/normalizasyon yap (`graph/analytics.ts`).
e. **`/api/experts` `credentials` alanı** herkese açık: kişisel veri riski. Ya yalnız yöneticiye ve bilirkişinin kendisine göster ya da
   açık uçta kısa bir "alan/yeterlilik özeti"ne indir; karar ver ve belgeye yaz.
f. **Bilirkişi paneli**: çekinme gerekçesi (`recuse_reason`) ve yedek kura `EXPERT_DRAW` tx hash'leri `ExpertPanelInfo`'da görünsün
   (isteğe bağlı alanlar) ve `ExpertPanelCard`'da listelensin.
g. **`useQueryState`** (`web/src/lib/hooks.ts`): aynı anda iki anahtar güncellenince ikincisi birincisini eziyor — düzelt.
h. **Vekâlet izi kopyası**: `GovernanceMath.resolveEffectiveVotes` çıktısına `delegateOf: Record<string,string>` ekle; forumdaki
   `traceDelegations` (`forum/tally.ts`) kopyasını kaldır (mevcut özellik testi uyumu doğrular).
i. **YZ analiz yardımcıları sözleşmede değil**: `listAnalyses/getAnalysis/approveAnalysis` forumda `../ai`'dan doğrudan içe aktarılıyor →
   `AiRecordSink` arayüzüne taşı.
j. **Saat kalıcılığı**: `createApp` dışarıdan verilen saati kapanışta `meta.sim_clock`'a yazmıyor; `seed.ts` elle yazıyor → `createApp`'te
   genelleştir (`ScaledClock` ise kaydet), seed'deki elle yazımı kaldır (seed `advancedTotal: 0` yazmalı — yönetici ileri alması sayılmaz).
k. **Giriş hız sınırı ortam değişkeni**: uçtan uca testler için `RATE_LIMIT_GLOBAL` / `RATE_LIMIT_AUTH` (varsayılan 300 / 20) ekle
   (`index.ts` → `createApp({rateLimit})`), README ortam değişkenleri tablosuna yaz.
l. **KVKK eksikleri** (en az belgele, mümkünse uygula): kimlik verisini düzeltme talebi akışı (kayıt memuru üzerinden, gerekçeli,
   denetim kayıtlı), ana anahtar dönüşüm betiği (`server/scripts/rotate-master-key.ts`: DEK'leri yeni KEK ile yeniden sarar),
   personel için 2FA (isteğe bağlı; yapılmazsa KVKK.md §8'de gerekçeli sınırlama olarak kalsın).
m. (Zaman kalırsa) Defter "çok süreçli kip": `server/src/ledger/standalone.ts` şu an yalnız "desteklenmiyor" yazıyor; `Transport`
   arayüzü için HTTP taşıyıcı ve 4 ayrı süreçle çalıştırma. Yapılmazsa README/MIMARI'de sınırlama olarak kalsın.

### 4.5 Tarayıcı uçtan uca testlerini depoya ekle (`npm run e2e`)
Önceki oturumdaki Playwright betikleri geçici klasördeydi ve kayboldu. `web/e2e/` (ya da kökte `e2e/`) altında, tohumlu geçici veri
klasörüyle sunucuyu başlatan (`DATA_DIR=<geçici> npm run seed -- --reset`, `PORT=4100`) ve şu senaryoları koşan testler yaz:
1. 360 px sayfa taraması (tüm rotalar; `document.documentElement.scrollWidth - innerWidth === 0`, `pageerror`/konsol hatası yok).
2. Kayıt → kayıt memuru amaçlı PII görüntüleme + onay → giriş → yeni öneri (canlı ön denetim T0) → destek (K_s = 4) → yönetici
   +72/+24 saat → oy (`Oyumu ver`, makbuz cihazda) → `/oy-dogrula` (sürerken 4 ✔ + 2 "henüz") → +72 saat → kapanış → "Sayımı kendim
   doğrulayayım" ✔ → `/oy-dogrula` 6/6 ✔.
3. Silme talebi arayüzden (mesaj → "Silme talebi aç", "Görüş ayrılığı" seçilemez, acil gerekçede daraltma) → DEL oylaması → mezar taşı
   + yazarın tek cevabı + denetçinin kayıtlı okuması.
4. İtiraz (#K-29) ve uzlaşma (#K-28: azınlık raporu, YZ köprü taslağı benimseme) akışları.
5. Defter: kurcala → ✘ → onar → ✔; düğüm çökert → blok üretimi sürer → geri al.
Seçici ipuçları: form etiketlerinin erişilebilir adı "Takma ad * (zorunlu)" gibi; kayıt alanlarında `input[id$="-nickname"]`,
`-password`, `-password2`, `-firstName`, `-lastName`, `-tckn`, `-birthDate`, `-email`, `-phone`, `-il`, `-ilce`, `-mahalle`,
`[id$="-acikAdres"]` (textarea). Düğme adları: "Kaydol", "Kişisel veriyi görüntüle…", "Amacı kaydet ve görüntüle", "Onayla",
"Kaydet ve destekçi toplamaya gönder", "Destekle", "+72 saat", "+24 saat", "Oyumu ver", "Sayımı kendim doğrulayayım", "Bloğu kurcala",
"Düğümü onar". Belirteç `localStorage["forum.token"]`, makbuzlar `localStorage["forum.receipts"]`. Giriş hız sınırı 20/dk — 4.4k'yi
kullan. Testi README ve TEST_RAPORU'na ekle.

### 4.6 Git düzeni ve teslim
- Dal geçmişinde ~13 "Ara kayıt (WIP)" commit'i ve yanlışlıkla izlenip sonra kaldırılmış demo defter dosyaları (`server/data/ledger/*.db`,
  kişisel veri içermez) var. Kullanıcıya sorarak: anlamlı commit'lere **squash** edilmiş temiz bir dal oluştur (ör. `git reset --soft
  36d8e61` + mantıksal gruplar halinde commit ya da tek "Forum Sistemi v1.0" commit'i), testleri yeniden koştur, `main`'e push et
  (`git push origin calisma:main` — kullanıcı main'e push izni verdi; force-push gerekiyorsa ÖNCE kullanıcıya sor).
- Teslimden önce bu `DEVAM_PROMPTU.md` dosyasını sil.
- `docs/TEST_RAPORU.md` ve `README.md`'yi son durumla güncelle (Node 24/Windows, Android sonuçları, e2e).

---

## 5. Kabul ölçütleri
- `npm run typecheck`, `npm test`, `npm run build` (ve eklendiyse `npm run e2e`) Windows/Node 24'te hatasız.
- **Android APK derlendi, emülatörde kuruldu ve `10.0.2.2:4000` sunucusuna bağlanıp oy + makbuz doğrulama çalıştı** (ekran görüntüleriyle).
- §4.4'teki a–k tamam (l, m en az belgelenmiş).
- Tohumlu sistemde tüm sayfalar gerçek veriyle çalışıyor; 360 px'de taşma yok.
- README ve docs güncel; `main`'de temiz geçmiş; `DEVAM_PROMPTU.md` silinmiş.

## 6. Çalışma kuralları
- Alt ajan kullanırsan: her birine ayrık dosya/klasör ver, sözleşme dosyalarını yalnız sen değiştir, commit'i sen yap.
- Her mantıksal adımdan sonra Türkçe commit mesajıyla commit et; push etmeden önce testleri koştur.
- Bir tasarım kararını (ALGORITMA §12, gizlilik ilkeleri, "yalnızca yükseltme") değiştirmek gerekiyorsa önce kullanıcıya gerekçesiyle sor.
