# Arayüz hafifletme planı

> Amaç: "Kullanıcıyı boğmasın ama ihtiyacı olan şeyi hemen yapsın" — hiçbir özellik silinmeden yalnız varsayılan görünürlük,
> sıra ve yoğunluk değişir. Plan 2 Ekim 2026'da 10 ajanlı bir inceleme ile hazırlandı (5 envanter, 3 bağımsız tasarım,
> eleştiri, birleştirme) ve kullanıcı onayıyla Faz 1 uygulandı.

## Verilen kararlar

- Kapsam: Faz 1, Faz 2 ve Faz 3 uygulandı (Faz 2 ve Faz 3 sonrası üçer bağımsız inceleme ve düzeltme turu yapıldı). Faz 3'ün onaya
  bağlı maddeleri (Keşfet ve doğrula sayfası ile gösterim rehberi, görev sayısı rozeti) kullanıcı onayıyla yapıldı.
- Renk: tek mavi (`--info` = `--primary`), mor yalnız yapay zekâ, nesne başına en çok 1 renkli durum rozeti; açık ve iki koyu temada WCAG AA.
- 'özet' sözcüğü hash anlamında yeniden adlandırılmadı ('terim korunur'); günlük karşılığı 'parmak izi' sözlükte ve hash ipucundadır.
- Görünüm yoğunluğu: varsayılan **Sade**; Ayarlar › Görünüm'de **Tam — tüm ayrıntılar açık** (gösterimde her şeyi tek seçimle açar).
- Ana sayfa görevleri ile öneri sayfası bayrakları sunucuda aynı kurala bağlandı (`server/src/forum/eligibility.ts`).
- Demo verisine dokunulmadı; doğrulama e2e'nin kendi geçici verisiyle yapıldı.

## Faz 1 — uygulandı

1. Ortak açılım altyapısı: katlanabilir Card, Details meta, ClampText, görünüm yoğunluğu tercihi, ?bolum= kancası, global [hidden]
2. Tasarımdan bağımsız doğruluk düzeltmeleri (Android menü, reddedilen hesap metni, kalıcı kaybeden eşikleri, görev–bayrak tutarlılığı)
3. Öneriler listesi: asla boş açılmayan akıllı varsayılan, 4 üst sekme ve evre çipleri, sade kart (rozet bütçesi)
4. Öneri sayfası: denetim kartları başlıkta hükümle katlanır, metin kırpılır, kura kanıtı tek açılırda
5. Ana sayfa hızlı düzen: görevler üste; sistem şeridi yerine vitrin; Pano yerine sayaç hapları; 8 ilke akordeonu
6. Keşif sayfalarındaki sabit açıklayıcılar sayfa başına ve kapalı; Yönetmelik maddeleri bölüm bölüm
7. Test kapsamı: 'Tam' görünümde tarama ve saf fonksiyon testleri

## Faz 2 — uygulandı

Sıradaki adım motoru (`web/src/lib/nextStep.ts`), öneri sayfasında tek akış (Sıradaki adım kartı, "Bu sayfada" kısa yolları,
kanıt sütunu, `?bolum=` derin bağlantıları), "eylem önce" paneller, hükümle açılan sonuç kartı, sade bilirkişi/YZ kartları,
kapalı yazma kutusuyla tartışma, role göre "Sizi bekleyenler" ana sayfası, "Daha fazla" sayfasında sistem durumu bloğu ve
masaüstü gezinme ayracı. Testler: `e2e/tests/06-sadelik.spec.ts` (23 test; kontrast dahil). Uygulamadan sonra üç bağımsız
inceleyici (doğruluk, özellik/sözleşme, telefon/görsel) yalnız düşük önemde 8 bulgu çıkardı; hepsi doğrulanıp düzeltildi.

## Faz 3 — uygulandı

Görsel dil (renk rolleri, rozet bütçesi, `--sp-*`/`--fs-*` belirteçleri), sade dil (`lib/glossary.ts` sözlüğü, `<Term>` penceresi,
ParamsCard sembol anahtarı), kompakt yeni öneri formu (tür radyoları, 'önce hüküm' ön denetim, duruma göre açılan kurallar), Konular ve
konu ayrıntısı (tek satır sayaçlar, tartışma yukarıda, katlı sürüm geçmişi), Profil ve Ayarlar (oy hakkı kartı önde, seyrek işler
katlı, tanılama 'Gelişmiş'te), Bildirimler (tür sınıfı, tarih grupları, satırın tamamı bağlantı), 'Keşfet ve doğrula' sayfası ve
7 adımlı gösterim rehberi, 'Ana sayfa' görev sayısı rozeti ve kartta 'Sizden bekleniyor', belgeler ve belgeleme aracı.

İnceleme turunda düzeltilenler: yeni öneri formunun yanındaki sözlük pencereleri ve madde atıfları formu terk ettirmez (web'de yeni
sekme, Android'de bağlantısız; `TermLinksProvider`); görev rozeti Ana sayfa panosuyla eşitlenir ve kişinin kendi eyleminden hemen
sonra yenilenir; 'YZ önerileri' ilk 'Ekle'de kapanmaz ve odak düşmez; rıza sonrası oy hakkı kartında odak kaybolmaz; Keşfet
sözlüğünde arama etkinken 'Sözlükte ›' çalışır; özet olmayan değerler (imza, açık anahtar, pusula kimliği) 'Özet' ipucu almaz;
ön denetimde başlık düzeyi atlanmaz; konu sayfasında açık önerilerin türü ve yazarı geri geldi; silinen iki eğitici cümle açılırda
ve alt başlıkta korundu; KVKK bağlantısı katlı karta derin bağlanır; itiraz hükmü, defter işlem türleri, hak etkisi ve 'Bilgi'
bulgusu rozet bütçesine ve renk rollerine uyar; çakışan CSS kuralları tek yere toplandı.

Belgeleme aracı (`gorseller/2026-10-01/araclar/ekranlari-kaydet.mjs`) yeni arayüze uyarlandı: katlı Profil kartları ve 'Uygulama
hakkında' `?bolum=` ile açık çekilir, /kesfet çekimleri eklendi, Android tercih yedeğine `forum.detail` ve `forum.dismissed` girdi
(çekimler her zaman 'Sade' görünümde). Araç ayrıca Öneriler listesindeki evre çiplerini ('Oylamada', 'İtiraz ve uzlaşma', 'Kabul
edilen' …) tek tek çeker, bilirkişi raporunu 'Raporu oku' ile açıp çeker, sözlük penceresini ('Karar parametreleri' › 'Onay eşiği')
ve 'Tam — tüm ayrıntılar açık' görünümünü (Ayarlar, öneri #K-7, Profil) çeker; 'Tam' çekimlerden sonra 'Sade'ye döner.

Ekran görüntüleri Faz 3 sonrası çalışma ağacıyla yeniden çekildi (3 Ekim 2026): **106 web** (Chrome, 1440×1000) ve **107 Android**
(Pixel 7 / Android 14 emülatöründe kurulu APK, 1080×2400) görüntü, `gorseller/2026-10-01/` (galeri `index.html`, CSV envanteri,
`surum-ve-dogrulama.json`, zip arşivi) ve Android'in sekiz öne çıkan ekranı `docs/ekran/`. Çekim ayrı bir geçici veri klasöründe
(`TIME_SCALE=1`, YZ çevrimdışı) 4177 portundaki sunucuyla yapıldı; `server/data` ve 4000 portuna dokunulmadı. Yenilemek için:
sunucuyu 4177'de başlatıp `node gorseller/2026-10-01/araclar/ekranlari-kaydet.mjs web` (ardından `web --details`), emülatörde
`… android` (ardından `android --details`) ve `node gorseller/2026-10-01/araclar/galeriyi-olustur.mjs` çalıştırılır.

## Ölçüm

Aynı veri (sonuçlanmış demo, @admin) ve aynı tarayıcı betiği; ekran = görünür yükseklik katı:

| Görünüm | Önce | Faz 1 sonrası | Faz 2 sonrası |
|---|---|---|---|
| Ana sayfa, telefon 375×812 | 6,3 ekran; ilk ekran sistem kutuları; açık öneriler 2,5. ekranda | 3,9 ekran; açık öneriler 0,8. ekranda | 2,9 ekran, 283 kelime; ilk ekranda selam + bekleyen işler + hızlı eylemler + son kararlar |
| Ana sayfa, masaüstü 1280×860 | 3,1 ekran, 632 kelime | 2,4 ekran, 374 kelime | 1,5 ekran, 283 kelime |
| Öneriler listesi | 9 sekme; 33 öneri varken boş açılıyor | 4 sekme + evre çipleri; boş açılmaz | aynı |
| Öneri #K-7 (kabul), telefon | 13,5 ekran; tartışma 11,5. ekranda | 9,4 ekran; tartışma 7,4. ekranda | 6,5 ekran; tartışma 4. ekranda |
| Öneri #K-7 (kabul), masaüstü | 6,2 ekran, 1439 kelime | 5,8 ekran, 988 kelime | 4,1 ekran, 670 kelime; tartışma 3. ekranda |

Taze tohumda oylamadaki öneri (#K-31, oy bekleyen üye @ayse): telefonda 5,2 ekran, tartışma 2,5. ekranda; ilk ekranda
"Oyunuz bekleniyor · kalan süre · Oy bölümüne git" ve "Bu sayfada: Metin · Oy ver · Tartışma (5) · Kanıtlar". Ana sayfa
görevine dokunmak öneriyi oylama paneline kaydırarak açar. Sonuçlanmış önerilerde tartışmadan önce sonuç kartı, sayım
doğrulama, bilirkişi ve YZ özeti geldiği için tartışma 4. ekranda kalıyor; "Bu sayfada" ile 1 dokunuştur.

### Faz 3 önce/sonra

Aynı e2e tohumu (taze demo verisi, `TIME_SCALE=1`), aynı betik (`e2e/tests/06-sadelik.spec.ts › ölçüm`, Chromium) ve aynı
sunucu; 'Önce' = Faz 2 sonu (925bd2d) derlemesi, 'Sonra' = Faz 3 ve inceleme düzeltmeleri (3 Ekim 2026). Ekran = sayfa boyu /
görünür yükseklik; 'rozet/etiket' renkli ve gri bütün rozetleri sayar. Yukarıdaki tablodan farklı veri (taze tohum, @ayse) olduğu
için Ana sayfa ve #K-7 değerleri o tabloyla değil, bu tablonun kendi sütunlarıyla karşılaştırılır.

| Görünüm (telefon 375×812, aksi yazmıyorsa) | Önce (Faz 2 sonu) | Sonra (Faz 3) | Plandaki hedef |
|---|---|---|---|
| Profil · @ayse | 5 ekran · 481 kelime · 17 tıklanabilir · 3 rozet | **3 ekran** · 250 kelime · 15 tıklanabilir · 2 rozet | ≈ 2,5 ekran |
| Profil · @ayse · 'Tam' | 6,6 ekran · 692 kelime · 17 tıklanabilir | 7,5 ekran · 773 kelime · 30 tıklanabilir (katlı kart başlıkları ve 'nasıl?' açılırları) | — |
| Ayarlar · ziyaretçi | 2,3 ekran · 165 kelime | **1,8 ekran** · 131 kelime; ilk okumada TOFU ve Ed25519 yok (06 testi) | TOFU/Ed25519 0 |
| Konular · ziyaretçi | 3 ekran · 377 kelime · 41 rozet/etiket | 2,8 ekran · 235 kelime · 28 rozet/etiket | — |
| Konu ayrıntısı (ilk konu) | 5 ekran · tartışma 3,3. ekranda | 4,3 ekran · **tartışma 2,2. ekranda** | tartışma 1,5–2 ekran yukarı (1,1 ekran yukarı geldi) |
| Bildirimler · @ayse | 21,3 ekran · 175 tıklanabilir | **18,2 ekran** · 175 tıklanabilir; satırda 'Git' düğmesi yerine satırın kendisi bağlantı, tek 'Okundu işaretle' simge düğmesi | satır başına düğme 2 → 1 |
| Yeni öneri: yeni konu (boş form) | 3,3 ekran · 333 kelime | 2,9 ekran · 265 kelime | — |
| Yeni öneri: seçili tür radyosundan 'Başlık' alanına (360 px) | 812 px (06 testindeki eski düzen notu) | **353 px** | ≈ 150 px (tür şeridi 360 px'de iki satıra sardığı için hedefe inmedi) |
| Yeni öneri: dolu ön denetim paneli (360 px, sade) | ≈ 1500 px (plan tahmini) | **632 px** | ≈ 500 px |
| Yeni öneri: silme talebi (`?mesaj=`) | 4,7 ekran · 477 kelime | **3,3 ekran** · 281 kelime | ≈ 2,5 ekran |
| Keşfet ve doğrula · ziyaretçi (telefon / masaüstü 1280×860) | yok | 6,3 / 4,1 ekran · 685 kelime · 40 tıklanabilir · 0 rozet; 7 bileşen her biri 1 dokunuş, 7 adımlı rehber | 7 bileşen tek sayfada |
| Ana sayfa · @ayse (telefon / masaüstü) | 3,4 / 1,7 ekran · 393 kelime · 41 tıklanabilir | 3,4 / 1,7 ekran · 395 kelime · 42 tıklanabilir ('Gösterim rehberi ›') | — |
| Öneri #K-7 (kabul, bilirkişili) · telefon | 6,6 ekran · 682 kelime · 58 tıklanabilir · 12 rozet/etiket · tartışma 5. ekranda | 6,6 ekran · 682 kelime · 62 tıklanabilir (sözlük terimleri) · 12 rozet/etiket · tartışma 5. ekranda | renkli rozet ≤ 5 (başlıkta ≤ 3: 06 testi; hüküm satırlarında ≤ 1: birim testleri) |
| Öneri #K-7 · masaüstü | 4,2 ekran · 678 kelime · 57 tıklanabilir | 4,1 ekran · 678 kelime · 61 tıklanabilir | — |
| Öneri #K-7 · telefon · 'Tam' | 17,3 ekran · 1982 kelime · 97 tıklanabilir | 17,5 ekran · 2047 kelime · 122 tıklanabilir (semboller ve formüller açık) | — |

Sade dil: dokunmatikte yalnız `title` ile verilen terim açıklamaları `<Term>` penceresine taşındı (masaüstü ipucu kalır); ilk
okumada Yunan sembolü ve formül yok, 'Sembolleri ve formülleri göster' anahtarı ve 'Tam' görünüm hepsini açar (06 testleri).
Görsel dil: üç tema bloğunda `--info` = `--primary`, mor yalnız YZ; kontrast 06'nın iki kontrast testiyle (açık + iki koyu yol)
ve `ui/visualLanguage.test.tsx` ile denetlenir.

## Yol gösteren ilkeler

- Hiçbir yetenek silinmez. Değişen yalnız varsayılan görünürlük, sıra ve yoğunluktur. Taşınan her öğenin yeni yeri ve dokunuş sayısı featureAccessMap'te yazılıdır.
- İlk ekran üç soruyu yanıtlar: 'Ne oldu?', 'Benden ne bekleniyor?' ve 'Ne kadar sürem var?'. İlk ekranda tek birincil eylem bulunur. Panel içindeki 'Oyumu ver' ve 'Destekle' gibi birincil düğmeler yerinde kalır; ilke 'ilk ekranda tek birincil' olarak uygulanır.
- Önce eylem ve hüküm, sonra kanıt. Form ve düğmeler açıklama paragraflarının üstünde durur. Tablo, formül ve hash bir dokunuş ötededir. Eğitici metin silinmez, adlandırılmış bir Details içinde ('Kaç destekçi gerekir?', 'Geçerlilik nasıl hesaplanır?') korunur.
- Kapalı başlık cevap verir. Her açılır kartın başlığının yanında tek satırlık bir hüküm durur (ör. 'Ontoloji denetimi — ✔ Uygun · Olağan karar (T0) · 1 uyarı'). Hüküm başlığın DIŞINDA durur, böylece bölge (region) adı değişmez.
- Uyarı yalnız gerektiğinde bağırır. Şu durumlarda ilgili bölüm kendiliğinden açık, renkli ve metinli gelir: bütünlük uyarısı, yönetmeliğe aykırılık, başarısız koşul ya da köprü testi, kalıcı kaybeden küme, sağlıksız doğrulayıcı, silme sınırına 1 kala. Olağan durumda bölüm tek satırdır.
- Öneri sayfası tek akıştır, sekme yoktur. Tartışma her zaman bağlıdır ve sayfa içi aramada bulunur. Tek derin bağlantı şeması ?bolum=<çapa>: kartı açar, oraya kaydırır, odağı taşır ve kendini replace ile siler. ?mesaj= aynen kalır.
- Karar mantığı sunucuda kalır. İstemci 'sıradaki adımı' yalnız sunucu bayraklarından türetir: canVote, canObject, canWriteMinorityReport, myBallot, sponsors, authorId, expertPanel.assignments, suggestions. Bunu saf ve birim testli lib/nextStep.ts yapar; istemci kural tahmini yapmaz.
- Her bilginin tek bir evi vardır. Sistem durumu: Ana sayfa vitrini, masaüstü alt bilgisi ve mobil 'Daha fazla'. Hesap durumu: '/' rotasında Ana sayfa kartı, diğer sayfalarda şerit. Evre: rozet ve şerit. Katman: T0 ontoloji hükmünde, T1 ve üstü başlıkta.
- Terim korunur, günlük karşılık yanına eklenir. Yönetmelik terimleri (köprü testi, ontoloji denetimi, dağıtık defter) başlıklarda kalır. Test ve yönetmelik metinlerini içeren 'dokunulmaz metin listesi' değiştirilmez.
- Rozet bütçesi ve renk rolleri: nesne başına en çok 1 renkli durum rozeti. Mavi eylem ve 'şu an' içindir, yeşil ve kırmızı sonuç için, turuncu dikkat ve süre için, mor yalnız yapay zekâ için. Renk her zaman metin ve simgeyle birlikte kullanılır.
- Ödev vitrini görünür, ayrıntı katlıdır. Yedi bileşen (defter, oy doğrulama, bilirkişi, YZ, graf, ontoloji, azınlık koruması) Ana sayfa vitrininde ve öneri sayfasında adıyla ve canlı değeriyle görünür. 'Tam' görünüm tercihi bütün ayrıntıyı tek seçimle açar.
- Test sözleşmeleri pazarlık dışıdır.
(a) Bölge adları ve test metinleri aynen kalır.
(b) Yeni düğme, bağlantı, region ve label adları şunları İÇERMEZ: 'Destekle', 'Oyumu ver', 'Daha fazla' (Ana sayfa regex'i), 'Sayımı kendim doğrulayayım', 'Kapat'.
(c) İtiraz ve uzlaşma panellerinde aria-label olarak 'Gerekçe', 'Açıklama' ya da 'Azınlık raporu' kullanılmaz.
(d) Yeni region adı şunları içermez: 'Oylama', 'Uzlaşma turu', 'Azınlık raporları', 'Destekçiler (', '1. tur sonucu', 'Azınlık itirazı'.
(e) '✔ Bu öneriyi desteklediniz.' ve '✔ Makbuz bu cihazda kayıtlı' sayfada bir kez geçer.
- Erişilebilirlik ve platform: akordeon <h2><button aria-expanded aria-controls> desenidir; sekmelerde ok tuşları çalışır; ?bolum sonrası odak taşınır; 360 px'de yatay taşma 0'dır. Yeni renk belirteçleri iki koyu tema bloğuna da eklenir (styles.css:67-96 ve 98-130). Android geri tuşu önce açık pencereyi ya da menüyü kapatır, sonra geri gider.
- Fazlı ve ölçülü teslim: her madde ayrı commit olur. Her fazın sonunda tam e2e (01–05), vitest ve web derlemesi çalışır. Önce ve sonra aynı tarayıcı ölçümü yapılır: ekran boyu, kelime sayısı, toplam ve ilk ekrandaki tıklanabilir öğe, rozet sayısı.

## Faz 2 — Ana yeniden düzenleme: öneri sayfası ve ana sayfa

**Hedef:** Faz 2'nin hedefleri:
- Öneri sayfasında ilk ekranda 'ne oldu / benden ne bekleniyor / ne kadar sürem var' sorularını tek kartta yanıtlamak.
- Birincil eylemi 1 dokunuş ve 0 kaydırma uzaklığa getirmek.
- Panelleri 'eylem önce' düzenine almak.
- Sonucu 'önce hüküm' yapmak.
- Tartışmayı telefonda yaklaşık 3. ekrana çıkarmak.
- Ana sayfayı role göre bir 'senden beklenenler' sayfasına dönüştürmek.
- Mobilde sistem durumunu her sayfadan 1 dokunuşla erişilir kılmak.

Öneri sayfası sekmesiz tek akıştır.

**Beklenen ölçüm:** K-7 (sonuçlanmış, bilirkişili):
- Telefonda 13,5 ekrandan en çok 5 ekrana iner.
- Tartışma 11,5. ekrandan yaklaşık 2,8. ekrana çıkar; 'Bu sayfada' ile 1 dokunuş.
- Masaüstünde 6,2 ekrandan en çok 3,2 ekrana iner.
- Varsayılan görünür tıklanabilir öğe 85'ten en çok 45'e iner.
- Rozet ve çip 19'dan en çok 8'e iner.
- İlk ekranda 'ne oldu' cümlesi, 1 birincil eylem ve 2 soru bağlantısı bulunur (bugün 5 tıklanabilir öğe var, hiçbiri eylem değil).

Oylamadaki öneri:
- Oy vermek 1 dokunuş ve 0 kaydırma (bugün yaklaşık 5 ekran kaydırma).
- Oylama kartı telefonda yaklaşık 900 px'ten yaklaşık 520 px'e iner.
- Telefonda eylem düğmesinin panel başından uzaklığı: 'Oyumu ver' yaklaşık 520'den yaklaşık 230 px'e, 'Destekle' yaklaşık 300'den yaklaşık 110 px'e, itiraz formu yaklaşık 700'den yaklaşık 120 px'e iner.

Sonuç ve tartışma:
- Sonuç kartı tur başına yaklaşık 1500 px'ten yaklaşık 450 px'e iner (olağan durumda).
- İlk mesaja kadarki yükseklik yaklaşık 500 px'ten yaklaşık 150 px'e iner.

Ana sayfa:
- Üye: telefonda 6,3 ekrandan en çok 2,8 ekrana, masaüstünde 3,1 ekrandan en çok 1,6 ekrana iner.
- Ziyaretçi: telefonda en çok 3,3 ekran.
- Ana içerik 632 kelimeden en çok 250 kelimeye iner.
- Tıklanabilir öğe 36'dan en çok 26'ya iner.
- İlk ekranda göreve dönük öğe vardır; görev yoksa role göre ipucu çıkar.
- Görevden ilgili panele 1 dokunuş ve 0 kaydırma.

Kabuk:
- Mobilde sistem durumu Ana sayfa dışından da 1 dokunuşla görülür (bugün görülmüyor).
- Ana sayfada çift hesap mesajı 2'den 1'e iner.

### 1. Sıradaki adım motoru: lib/nextStep.ts (saf, birim testli)

Emek: orta · Risk: düşük

proposalNextStep(p: ProposalDetail, v: Viewer) şu yapıyı döndürür: {tone, headline, detail?, cta?:{label, bolum|to}, links: ≤2}.

viewerOf(auth) yalnız şu alanları verir: id, status, can(V/VV/D/A), politicalConsent, isAdult.

Evre × rol matrisi
- draft, yazar: 'Taslak yalnız size görünür' → 'Taslak işlemlerine git'.
- sponsoring:
  - V, yazar değil, desteklememiş (p.sponsors içinde yoksa): 'Destekçi bekleniyor (x/y)' → 'Destek bölümüne git'.
  - Desteklemiş: 'Desteğiniz kayıtlı; destekçiler tamamlanınca tartışma açılır'. Panel metnini tekrar ETMEZ.
  - Yazar: 'Kendi önerinizi destekleyemezsiniz; destekçi bekleniyor'.
  - V değil: 'Doğrulandıktan sonra destek verebilirsiniz'.
- deliberation:
  - Yazar: 'n metin önerisi yanıtınızı bekliyor'.
  - Atanmış bilirkişi (expertPanel.assignments[].expertId): 'Raporunuz bekleniyor' → bilirkişi bölümü.
  - Diğerleri: 'Tartışmaya katılın (n mesaj) · oylamaya …'.
- voting ve revote:
  - canVote ve myBallot yok: 'Oyunuz bekleniyor' → 'Oy bölümüne git'.
  - myBallot var: 'Oyunuz kayıtlı (Kabul); süre bitene kadar değiştirebilirsiniz'.
  - V ama canVote yok: neden VotePanel'deki mantıkla aynı (rıza, 18 yaş ya da donmuş seçmen listesi) ve 'Profil › Rızalar'.
  - Anonim: 'Oy için giriş yapın'.
- objection_window:
  - canObject: 'İlk turda Red dediğiniz için itiraz hakkınız var' → 'İtiraz bölümüne git'.
  - Diğerleri: 'Karar itiraz süresinde'.
- reconciliation:
  - canWriteMinorityReport: 'Azınlık raporunuzu yazabilirsiniz'.
  - Yazar: 'Köprü taslaklarını inceleyin ya da metni revize edin'.
- Terminal evreler: EnactedEffect, ret, aykırı, geri çekildi ve süresi doldu metinleri birebir; ikincil bağlantılar 'Nasıl karar verildi?' (bolum=sonuclar) ve 'Sayımı doğrula' (bolum=dogrula). Aykırı öneride 'Hangi madde?' (bolum=ontoloji).
- D rolünde ve integrityWarnings varsa ikincil bağlantı: 'Bütünlük uyarısını incele'.

Etiket sözlüğü test adlarıyla çakışmaz. Etiketlerde şunlar geçmez: 'Destekle', 'Oyumu ver', 'Daha fazla', 'Sayımı kendim doğrulayayım', 'Kapat'.

nextStep.test.ts en az 25 vaka içerir: 12 evre × rol kombinasyonu, 5 kullanıcı durumu, anonim, D ve bütünlük.

- **Özellik korunumu:** Bu katman yalnız okur ve yönlendirir. Düğmeler kendi panellerinde kalır. Kurallar sunucu bayraklarından gelir; karar kuralları ve algoritma değişmez.
- **Dosyalar:** web/src/lib/nextStep.ts (yeni), web/src/lib/nextStep.test.ts (yeni)
- **e2e:** Yok; yeni vitest testleri eklenir.

### 2. Öneri sayfası iskeleti: Sıradaki adım kartı, 'Bu sayfada' gezinmesi, tek akış, kanıt sütunu

Emek: büyük · Risk: orta

Yeni sıra (DOM sırası = okuma sırası)

1) PageHeader
- .page-meta: #K-n, StatusBadge, KindBadge; koşullu olarak 'Süre uzatıldı' ve 'Bütünlük uyarısı (n)'.
- TierBadge yalnız T0 dışındaysa görünür.
- .page-subtitle ('… · sürüm N') aynen kalır.
- Kategoriler: ilk 3 .cat-tag ve '+n' (satır içinde açılır).

2) PhaseStrip
- 600 px'in altında kompakt olur: numaralı noktalar ve yalnız güncel evrenin etiketi.

3) NextStepCard
- <section aria-labelledby>, görsel olarak küçük h2 'Sıradaki adım'.
- İçerik: tek cümle, Countdown, CTA ve en çok 2 soru bağlantısı.
- Countdown başlıktaki header-countdown'dan buraya taşınır; onDone yenilemesi aynen çalışır.
- CTA bir bağlantıdır (?bolum=…), button değil.
- Terminal evrelerde StatusNotice, EnactedEffect ve InadmissibleNotice içeriği burada durur. Anayasa md. 4 paragrafları 'Bu ne demek?' Details içine birebir taşınır.

4) <nav aria-label='Bu sayfada'>
- Yalnız var olan bölümleri listeler: Metin · Eylem (evreye göre 'Oy ver', 'Destek', 'İtiraz', 'Uzlaşma') · Sonuç · Bilirkişi · Tartışma (n) · Kanıtlar.
- Bağlantılar ?bolum= üzerinden çalışır ve satıra sarar; yatay taşma yok.

5) .split ana sütun
- Öneri metni (ClampText).
- ActionArea (id=eylem).
- Sonuçlar (id=sonuclar), içinde VerifyTally (id=dogrula).
- Pasif İtiraz ve Uzlaşma.
- Bilirkişi görüşü (id=bilirkisi).
- 'Metin önerileri (n)' (terminalde).
- YZ özeti (id=yz).
- Discussion (id=tartisma). Tartışma ana sütuna taşınır: masaüstünde 2/3 genişlikte okunur, telefonda kanıtlardan ÖNCE gelir.

6) aside 'Kanıtlar ve denetim' (id=kanitlar)
- Başlıkta 'Tümünü aç / Tümünü kapat' bulunur.
- Sıra: Bütünlük uyarıları (varsa açık) · Destekçiler (n/m) (hep açık) · Zaman çizelgesi · Ontoloji denetimi · Karar parametreleri · Sürüm geçmişi · Defter kayıtları. Bu kartlar Faz 1'de katlanabilir hâle gelmişti.

Teknik notlar
- Discussion her zaman bağlı kalır. YZ alıntıları (scrollToMessage), onMessagesChange ve ?mesaj= aynen çalışır.
- useSectionParam veri yüklendikten sonra çalışır.
- 'Oy bölümüne git' bağlantısı odağı Oylama kartındaki ilk radyoya, 'İtiraz bölümüne git' Gerekçe alanına taşır.

- **Özellik korunumu:** Hiçbir kart kaldırılmaz; her biri akışta ya da kanıt sütununda 1 dokunuşla açılır.
- Başlıktaki bütün bilgiler metin olarak kalır: no, tür, durum, katman (T0 ontoloji hükmünde), uzatma, bütünlük, yazar, zaman, sürüm, üst konu, kategoriler.
- Geri sayım ve süre dolunca otomatik yenileme Sıradaki adım kartına taşınır.
- EnactedEffect bağlantıları ve 'N mesaj karartıldı' satırı birebir korunur.
- **Dosyalar:** web/src/pages/ProposalDetailPage.tsx, web/src/components/common/NextStepCard.tsx (yeni), web/src/components/participation/OnThisPage.tsx (yeni), web/src/components/participation/EvidenceColumn.tsx (yeni), web/src/components/participation/PhaseTimeline.tsx (PhaseStrip kompakt), web/src/components/participation/ProposalSubject.tsx (EnactedEffect gövdesi dışa aktarılır), web/src/styles.css (.next-step, .on-this-page, .evidence-*)
- **e2e:** Korunan sözleşmeler:
- Düzey 1 h1 (02:155).
- .page-meta evre metinleri (02:156,173,248; 03:73,105; 04:53,86,117,169).
- .page-subtitle 'sürüm N' (04:147).
- 'Destekçiler (n/m)' bölgesi görünür (02:174).
- Oylama sürerken '1. tur sonucu' başlığı 0 (02:204).

Adlandırma kuralları:
- Sıradaki adım kartının adı 'Oylama', 'Uzlaşma turu' ya da 'Destekçiler' içermez (02:192 ve 04:87 alt dize eşleşmesi).
- Kartın içinde button yok; 'Destekle' düğmesiyle çakışma olmaz (02:166, 03:93).
- Kart '✔ Bu öneriyi desteklediniz.' ve '✔ Makbuz bu cihazda kayıtlı' metinlerini tekrarlamaz (02:168 ve 02:197 getByText).

02:152 toHaveURL(/…{36}$/): gönderim sonrası yönlendirmeye ?bolum eklenmez.

ekranlari-kaydet.mjs'nin dayandığı başlıklar aynen kalır: /^Tartışma \(/, 'Bilirkişi görüşü', 'Uzlaşma turu', 'Tartışma özeti (yapay zekâ)'.

### 3. Eylem panelleri 'eylem önce': oy, destek, itiraz, uzlaşma, tartışma evresi

Emek: orta · Risk: orta

VotePanel
- Sıra: başlık ve 'Kalan' → katılım çubuğu → tek satırlık 'Ara sonuç gösterilmez; yalnız katılım görünür' (bilgi Alert'inin yerine) → RadioGroup ve 'Oyumu ver/değiştir' → makbuz satırı → koşullu uyarılar → yeniden oylama eşik paragrafı.
- Makbuz satırı: 'Geçerli oyunuz: Kabul · tarih', '✔ Makbuz bu cihazda kayıtlı' ya da 'Makbuzu bu cihaza kaydet', ve 'Oyum kayıtlı mı?'. Hepsi Details DIŞINDA kalır; .receipt-box ve .receipt-saved sınıfları korunur.
- Pusula kimliği, taahhüt, defter işlemi ve makbuz açıklaması Details 'Makbuz ayrıntıları (pusula, taahhüt, defter işlemi)' içine girer.
- Vekâlet cümlesi RadioGroup ipucuna eklenir.
- Bilirkişi askı uyarısı ve 'rapor gelmedi' uyarısı görünür kalır.
- Yeniden oylamada eşik paragrafı ve 'Sonuç kesindir.' görünür kalır.

SponsorPanel
- 'Destekle' düğmesi ilerleme çubuğunun hemen altına gelir.
- 'Destek oy değildir' tek satır olarak görünür kalır.
- K_s formülü Details 'Kaç destekçi gerekir?' içine girer.
- Destek evresindeki 'Hak etkisi' kartı tek satırlık özete iner ('İşaretlenmiş hak yok' ya da '2 hak işaretli · katmanı yükseltir') ve [Hak etkisi bayrağı ekle] düğmesiyle açılır.

ObjectionPanel (aktif evre)
- canObject ise 'İtiraz imzala' formu en üste gelir.
- Form içindeki bilgi Alert'i tek satır olur, kalanı Details'e girer.
- Değerlendirme rozetleri ve 'Toplam geçerli imza' görünür kalır.
- Grup tablosu ve (a)(b)(güçlü) kuralları Details 'Geçerlilik nasıl hesaplanır?' içine girer.
- İmza listesi görünür ve tam kalır.

ObjectionPanel (pasif)
- Kart katlanmaz.
- Rozet satırı ve toplam görünür kalır.
- Tablo ve kurallar Details içindedir. Terminal evrelerde imzalar da Details 'İtiraz imzaları (n)' içine girer.

ReconciliationPanel (etkin)
- Köken Alert'i (role=status) en üstte kalır, gövdesi kısalır.
- Ardından role göre ilk blok gelir: canWriteMinorityReport ise 'Azınlık raporu yaz', yazar ise 'Köprü taslakları'.
- Bölge ve başlık adları aynen kalır.

ReconciliationPanel (pasif, terminal)
- Azınlık raporları görünür kalır.
- Taslak setleri Details içine girer.

DeliberationPanel
- Yazar düğmeleri üstte durur.
- SuggestionsPanel boşken tek satır ve [Metin önerisi gönder] gösterir; 3'ten uzun listede 'Tümünü göster (n)' çıkar.
- RightsFlags tek satır özet ve düğmeyle açılan forma geçer.

- **Özellik korunumu:** Bütün alanlar, düğmeler, uyarılar ve açıklamalar aynı bileşende kalır; yalnız sıra ve varsayılan görünürlük değişir. Details'e girenler: makbuz hash'leri, K_s formülü, itiraz kuralları ve grup tablosu, köprü taslak setleri. Azınlık raporları hiçbir evrede gömülmez.
- **Dosyalar:** web/src/components/participation/VotePanel.tsx, web/src/components/participation/SponsorPanel.tsx, web/src/components/participation/ObjectionPanel.tsx, web/src/components/participation/ReconciliationPanel.tsx, web/src/components/participation/SuggestionsPanel.tsx, web/src/components/participation/RightsFlags.tsx, web/src/pages/ProposalDetailPage.tsx (DeliberationPanel, ActionArea)
- **e2e:** Bu kurallarla test değişikliği gerekmez.
- 02:192-197: region 'Oylama', radyo 'Kabul', 'Oyumu ver' ve '✔ Makbuz bu cihazda kayıtlı' görünür.
- 02:216: region içindeki 'Oyum kayıtlı mı?' bağlantısı Details dışında.
- 02:166-168: tek 'Destekle' düğmesi, '✔ Bu öneriyi desteklediniz.' tek eşleşme.
- 04:54-62: 'Gerekçe' ve 'Açıklama' etiketleri, devre dışı sonra etkin 'İtirazı imzala', '(sizin imzanız; başkalarına anonim görünür)', 'Toplam geçerli imza: n'.
- 04:68-69: 'Anonim imzacı' sayısı; aktif evrede liste tam.
- 04:87-89: uzlaşma evresinde 'Azınlık itirazı (alarm zili)' kartı açık, 'İtiraz geçerli — uzlaşma turu' ve 'Küme kuralı (a)' görünür.
- 04:118-127: köken status, 'Azınlık raporu yaz', 'Raporu ekle', region 'Azınlık raporları' ve başlığı 'Azınlık raporları (n)'.
- 04:137-146: region 'Köprü taslakları', /taslak(lar)?ı? üret/i, 'Bu taslağı benimse'.
- 04:170-172: 'Yeniden oylama' (exact) ve 'Sonuç kesindir.'.

### 4. Sonuç kartı ve sayım doğrulama: önce hüküm, köprü testi ve başarısız koşul duruma göre açık

Emek: orta · Risk: orta

ResultsCard
- Başlık ('1. tur sonucu' / 'Yeniden oylama sonucu') ve card-actions'taki OutcomeBadge aynen kalır.
- Gövde sırası:
  1. 'Gerekçe' cümlesi.
  2. Tek satır toplamlar: 'N uygun · K katıldı · Kabul a · Red b · Çekimser c'.
  3. İki işaretli çubuk: katılım/yeter sayı ve onay/eşik.
  4. 'Neden bu sonuç?' bölümü (section aria-label aynen), tek satırlık kontrollerle görünür.
  5. Details 'Görüş grupları ve köprü testi': özet satırında 'n/n anlamlı grup tabanı aştı · GAC x' yazar; tablo, P_g ve boykot açıklaması içeride. Köprü sağlanmadıysa ya da bir grup tabanı geçemediyse varsayılan açık.
  6. Details 'Ayrıntılı sayılar': 7 kutu ve soğuk başlangıç notu. Bugün yalnız title ile verilen açıklamalar görünür metne çevrilir.
  7. myEffectiveVia (vekâlet) notu görünür.
  8. Azınlık raporları görünür; ilk 2'den fazlası 'Tümünü göster' ile açılır.
  9. Algoritma ve girdi özeti alt satırı aynen.

VerifyTallyPanel
- Başlık ve düğme 'Sayımı kendim doğrulayayım' aynen kalır.
- Önce tek cümle gelir: 'Bülteni defterden alıp sayımı bu cihazda yeniden yapın; sunucuya güvenmeniz gerekmez.' Ardından düğme.
- 5 satırlık teknik giriş Details 'Neyi denetler?' içine girer.
- Çalıştırma sonrası adımlar, işlem bağlantıları ve son not değişmez.

- **Özellik korunumu:** Bütün sayılar, küme tablosu (P_g, taban φ, Geçti mi?), GAC, kontrol listesi, azınlık raporları, girdi özeti ve tarayıcıda yeniden sayım korunur. Olağan durumda adlandırılmış Details içinde, azınlık koruması ilgili olduğunda açık gelirler.
- **Dosyalar:** web/src/components/participation/ResultsCard.tsx, web/src/components/participation/VerifyTallyPanel.tsx, web/src/styles.css (.result-summary)
- **e2e:** 02:249-257 korunur:
- region '1. tur sonucu' görünür ve .card-actions 'Kabul' içerir.
- region ve aynı adlı düğme 'Sayımı kendim doğrulayayım' görünür.
- status '1. tur: sayım doğrulandı' çıkar; li.vstep-ok en az 5, li.vstep-fail 0.
- toContainText 'Bu hesap sunucuya güvenmeden tarayıcınızda yapıldı.' geçer.

Details özet adları bölge adlarıyla çakışmaz.

ekranlari-kaydet.mjs:150 düğmeyi exact adla tıklar; değişmez.

### 5. Bilirkişi ve YZ özeti kartları: özet satırları, azınlık görüşleri hep açık, boş durum tek satır

Emek: orta · Risk: düşük

ExpertPanelCard ('Bilirkişi görüşü')
- Altbaşlığın yerine hüküm gelir: '2 rapor: 2 uygulanabilir · ort. güven %80 · 2 soru'.
- Askı kuralı ve 'Bilirkişi bulunamadı' uyarıları görünür kalır.
- 'Raporlar (n)' SubHeading'i korunur. Her rapor tek satırdır: '@bilirkişi · Uygulanabilir · güven %80 · tarih' ve [Raporu oku]. Düğme gövdeyi, riskleri, karşı görüşü, YZ uyarısını, hash'leri ve 'Sorulara yanıtlar'ı satır içinde açar.
- 'Bilirkişiye sorular (n)' listesi ve 'Azınlık güvenceli' rozeti görünür kalır. Soru formu [Soru sor] ile açılır.
- 'Kura ve adillik kanıtı' Faz 1'deki gibi kalır.
- Panel yoksa tek satır ve V için [Bilirkişi paneli talep et].

AiSummaryCard ('Tartışma özeti (yapay zekâ)', tartışmanın hemen önünde)
- Özet varsa AiLabel kalır. 'Azınlık görüşleri' HER ZAMAN açıktır. 'Ortak zemin', 'Tartışmalı noktalar' ve 'Açık sorular' başlık ve sayıyla açılır. Kapsam çubuğu metne iner.
- Özet yoksa EmptyState ve boş başlık yerine tek satır: 'Henüz YZ özeti yok — azınlık görüşleri, özet üretilince ayrı bölümde gösterilir.' V için [Özet üret].

- **Özellik korunumu:** - Panel talebi, kura kanıtı, raporlar, sorular ve azınlık güvencesi, askı uyarısı korunur.
- YZ tarafında 4 bölüm, alıntı düğmeleri, kapsam, AiLabel, data-ai-generated ve 'danışmandır' ifadesi korunur.
- 'Azınlık görüşleri her zaman gösterilir' kuralı korunur.
- **Dosyalar:** web/src/components/participation/ExpertPanelCard.tsx, web/src/components/participation/AiSummaryCard.tsx
- **e2e:** Doğrudan test yok.
- 04:141'deki [data-ai-generated='true'] köprü taslaklarındaki ortak AiLabel'a bağlı; değişmez.
- 01-tarama:226 bilirkişi oturumunda tartışmadaki öneri 360 px'de taranır.
- ekranlari-kaydet.mjs 'Raporlar (1)' ve 'Tartışma özeti (yapay zekâ)' başlıklarına dayanır; ikisi de korunur.

### 6. Tartışma (öneri ve konu sayfası): kapalı yazma kutusu, sade mesaj alt satırı, kurallar en altta

Emek: orta · Risk: orta

Discussion
- Sıra: başlık 'Tartışma (n)' ve sıralama → tek satır istatistik ('Lehte 2 · Aleyhte 1 · Soru 1', sıfırlar gizli) → kapalı yazma kutusu → mesajlar → 'Tartışma kuralları ve köprü skoru' Details'i en altta.
- Köprü skoru notu bu Details'e taşınır.

Composer
- Doğrulanmış üyede kapalı başlar: tek satır görünümlü 'Görüşünüzü yazın…' düğmesi (aria-expanded).
- Tıklanınca bugünkü form açılır ve odak metin alanına geçer.
- Metin yazılmışsa açık kalır.
- Yanıtla ve Düzenle bugünkü gibi doğrudan açılır.
- Anonim, doğrulanmamış, taslak ve arşiv uyarıları tek cümleye iner.

MessageItem
- İki satırlık hash alt bilgisi tek sessiz satıra iner: 'özet a1b2c3 · defter d4e5f6 ›'. Kopyalama işlem sayfasında yapılır.
- 12 satırı aşan gövde ClampText ile kısaltılır; .msg-body sınıfı gövde düğümünde kalır.
- Katılıyorum ve Katılmıyorum erişilebilir adları aynen kalır.

- **Özellik korunumu:** Bütün tartışma işlevleri aynen kalır:
- Yazma, yanıtlama, düzenleme, tutum, YZ ön denetimi, PII uyarısı ve 'Yine de gönder'.
- Katılıyorum/Katılmıyorum, köprü skoru ve sıralaması.
- Silme talebi, mezar taşı ve tek cevap, denetçinin kayıtlı okuması, sürüm geçmişi.
- Defter bağlantısı, ?mesaj= derin bağlantısı, 60 sn yoklama.

Hash'ler görünür satırda kalır.
- **Dosyalar:** web/src/components/participation/Discussion.tsx, web/src/components/participation/Composer.tsx, web/src/components/participation/MessageItem.tsx, web/src/styles.css (.msg-*, .composer-collapsed)
- **e2e:** 03-silme sözleşmelerinin hepsi aynen kalır:
- #mesaj-<id> (:48-50)
- 'Mesaj #n için diğer işlemler' (:51)
- 'Silme talebi aç' ve onay penceresi (:52-53)
- .msg-collapsed-bar 'Gözden geçiriliyor'; daraltılmışken .msg-body sayısı 0; 'Mesajı göster' (:82-87)
- .msg-tombstone ve .msg-tombstone-text, 'Kararı görüntüle' (:111-117)
- 'Cevap ekle (bir kez)', 'Cevabınız (yalnızca bir kez eklenebilir)', 'Cevabı ekle', .msg-rebuttal (:127-132)
- 'Gizli metni oku (erişim kaydedilir)' (:142-144)

Composer'a dayanan e2e yok. Tartışma hiçbir zaman Details içine alınmaz.

### 7. Ana sayfa yeniden kurulum: role göre 'senden beklenenler'

Emek: büyük · Risk: orta

DOĞRULANMIŞ ÜYE
1) H1 'Merhaba, @ad'. Altında tek satır canlı özet: '2 iş sizi bekliyor · 3 öneri oylamada' ya da 'Bekleyen işiniz yok · şu an açık öneri yok'. Üyede slogan kalkar.
2) 'Sizi bekleyenler (n)' kartı, yalnız görev varsa çizilir:
- En yakın 3 görev gösterilir; satırın tamamı bağlantıdır: tür etiketi, başlık, geri sayım.
- Bağlantılar ?bolum=eylem alır; bilirkişi görevi ?bolum=bilirkisi.
- Fazlası 'Tümünü göster (n)' ile açılır; asla 'Daha fazla' kullanılmaz.
3) Görev yoksa rol ipucu satırı:
- A rolü: 'Süreleri ilerletmek için simüle saati ileri alın › Yönetim'.
- V rolü: 'İlk öneriyi siz açın'.
- Diğerleri: 'Son kararlara göz atın'.
4) Hızlı eylemler:
- [+ Yeni öneri] (V).
- [Oylamadakiler (n)]; n=0 ise [Tüm öneriler].
- 'Oyum kayıtlı mı? (n makbuz)' bağlantısı; listReceipts ile sayılır.
- Rol eylemi en çok 1: R için 'Bekleyen üyeler', D için 'Denetim günlüğü'.
5) Rıza ve 18 yaş: tek satır not ve Profil bağlantısı.
- Gizleme düğmesinin adı 'Notu gizle' olur (tool'daki 'Kapat' ile çakışmasın).
- Tercih forum.dismissed'da tutulur, try/catch ile.
- VotePanel ve Profil'deki 'oy hakkınız yok' açıklaması her zaman görünür kalır.
6) 'Şu an açık (n)': ProposalRow ile en çok 5 satır, sunucunun bitiş sırasıyla. 'Tümü (süreye göre)' bağlantısı /oneriler?sekme=acik&sirala=sure adresine gider. Boşsa tek satır.
7) 'Son kararlar': 5 satır ✔/✘ ve 'Tüm kabul edilenler ›'.
8) Topluluk durumu (CountPills ve azınlık koruması hükmü), Faz 1'deki gibi.
9) Vitrin ve 'Sistem nasıl çalışır?' Faz 1'deki gibi.

BEKLEYEN ÜYE
- Kart: 3 adım kısaltılmış, 2. adım 'şimdi'. İkincil bağlantı 'Profil ve rızalar'.

ASKIDAKİ VE REDDEDİLMİŞ ÜYE
- Neyin yapılamadığını söyleyen Alert kalır; ret metni düzeltilmiş hâliyle.

ZİYARETÇİ
- H1 'Forum Sistemi', en çok 14 kelimelik slogan, [Giriş yap] [Kayıt ol].
- 'Okumak için hesap gerekmez.' ve Details 'Neden kayıt gerekir?' (bugünkü 47 kelime).
- Ardından vitrin → Şu an açık → Son kararlar → Topluluk durumu → ilkeler.

MASAÜSTÜ (900 px ve üstü)
- .split: solda görevler, açık öneriler ve son kararlar; sağda vitrin ve topluluk durumu.
- İlkeler tam genişlikte, 2 sütunlu başlık akordeonu olur.

YÜKLEME
- auth.loading sırasında üst blok min-height ile yer tutar, düzen kaymaz.
- Spinner yalnız liste alanında çıkar.

- **Özellik korunumu:** Her öğenin yeni yeri:
- 7 görev türü, geri sayım ve en yakın önce sırası: ilk 3 satır görünür, tamamı 'Tümünü göster' ile.
- Açık öneriler: ilk 5, aynı sırayla 'Tümü (süreye göre)'.
- Son kararlar: 5'in 5'i.
- Pano ve ilkeler: Faz 1'deki yerlerinde.
- 3 hızlı eylem ('Oyum kayıtlı mı?' dahil) korunur.
- Rıza, 18 yaş, bekleyen, askı ve ret mesajları korunur.
- Slogan ziyaretçi başlığında kalır.
- **Dosyalar:** web/src/pages/HomePage.tsx, web/src/components/home/Greeting.tsx (yeni), web/src/components/home/TaskList.tsx (yeni), web/src/components/home/QuickActions.tsx (yeni), web/src/components/home/SetupNotes.tsx (yeni), web/src/components/home/OpenNow.tsx (yeni), web/src/components/home/RecentDecisions.tsx (yeni), web/src/components/proposals/ProposalCard.tsx (ProposalRow), web/src/lib/prefs.ts (forum.dismissed), web/src/styles.css (.home-*)
- **e2e:** 01-tarama'nın 4 Ana sayfa görünümü yalnız taşma ve konsol hatası denetler.

Kısıtlar:
- Adında 'Daha fazla' geçen düğme ya da özet yok.
- 'Notu gizle' adı tool'daki /Kapat/ seçicisiyle çakışmaz.
- Kalıcı Spinner yok.

ekranlari-kaydet.mjs'deki 'Ana sayfa — ziyaretçi/üye' çekimleri yeni içerikle yeniden alınır.

### 8. Kabuk: mobil 'Daha fazla' sistem bloğu ve masaüstü gezinme ayracı

Emek: küçük · Risk: düşük

- MoreSheet'in en altına 'Sistem durumu' bloğu eklenir:
  - Defter: N. blok · x/y doğrulayıcı (sağlıksızsa uyarı rengi ve metni) › /defter
  - YZ kipi
  - Simüle saat ve ölçek
  - Yönetmelik sürümü
  - İstemci sürümü
  Veri auth.system'den gelir; her sayfada var ve 30 sn'de bir yenilenir. Blok, masaüstü alt bilgisinin mobildeki karşılığıdır.
- Masaüstü üst gezinmede 'Katılım' öğeleri ile 'Keşfet ve doğrula' öğeleri arasına görsel bir ayraç gelir. 8 öğe ve etiketleri aynen kalır.
- Alt çubuk değişmez.

- **Özellik korunumu:** Hiçbir gezinme öğesi kalkmaz. Mobilde sistem durumu, bugün yalnız Ana sayfada görünürken, her sayfadan 1 dokunuşla görülür. Masaüstü alt bilgisi aynen kalır.
- **Dosyalar:** web/src/components/layout/AppLayout.tsx, web/src/components/layout/nav.ts, web/src/styles.css (.more-*, .app-nav)
- **e2e:** - 01:69-75 moreSheet: 'Daha fazla' düğmesi ve dialog adı korunur.
- Yeni blok .modal-body içinde 360 px'de ölçülür; metin sarmalı, uzun hash olmamalı.
- Üst çubuktaki 'Giriş yap' bağlantı (link) olarak kalır; 02:125 ile çakışmaz.

### 9. Faz 2 testleri: 06-sadelik.spec.ts ve tarama eklemeleri

Emek: orta · Risk: düşük

Yeni e2e/tests/06-sadelik.spec.ts:
(a) 375×812 ekranda ayse'nin Ana sayfasında 'Sizi bekleyenler' ya da 'Bekleyen işiniz yok' özeti ilk ekranda: boundingBox.y < 812−62.
(b) /oneriler parametresiz açılınca bir sekme aria-selected olur ve en az 1 kart görünür.
(c) Oylamadaki öneride 'Oy bölümüne git' tıklanınca odak region 'Oylama' içindeki ilk radyodadır ve URL'de ?bolum kalmaz.
(d) 'Bu sayfada › Tartışma' tıklanınca #tartisma görüş alanına girer.
(e) ?bolum=defter, 'Defter kayıtları' kartını aria-expanded=true olarak getirir.
(f) ?mesaj=<id> ile #mesaj-<id> görünür olur.
(g) 'Tam' kipte kanıt kartlarının hepsi açık gelir.
(h) scrollHeight/innerHeight bütçeleri annotation olarak kaydedilir; ölçüm için, kesin beklenti değil.

01-tarama'ya Tam kip ve tartışmadaki, oylamadaki ve kabul edilmiş birer öneri için 'Bu sayfada' bağlantı tıklamaları extra olarak eklenir.

- **Özellik korunumu:** Yalnız yeni davranışı kilitler; mevcut beklentiler değişmez.
- **Dosyalar:** e2e/tests/06-sadelik.spec.ts (yeni), e2e/tests/01-tarama.spec.ts, web/src/lib/nextStep.test.ts
- **e2e:** Yalnız ekleme; toplam süre yaklaşık 20-30 sn uzar.

## Faz 3 — Cilalama: görsel dil, sade dil, ikincil sayfalar, gösterim rehberi ve belgeler

**Hedef:** Aynı desenleri kalan sayfalara yaymak. Renk ve rozet gürültüsünü kurala bağlamak. Jargonu dokunmatikte de açıklanır kılmak. Hocaya 7 bileşeni sırayla gösterecek bir rehber sunmak (onaya bağlı). Teslim belgelerini ve ekran görüntülerini güncellemek.

**Beklenen ölçüm:** Görsel dil:
- K-7'de renkli rozet ve çip en çok 8'den en çok 5'e iner.
- Ekran başına renk tonu en çok 4; mor yalnız YZ'de.
- Kart başına renkli öğe 1.

Sade dil:
- Dokunmatikte yalnız title ile verilen açıklama yaklaşık 15'ten 0'a iner.
- İlk okumada görünen Yunan sembolü ve formül yaklaşık 15'ten 0'a iner; anahtarla hepsi açılır.

Yeni öneri:
- Tür seçildikten sonra ilk alana kaydırma yaklaşık 600 px'ten yaklaşık 150 px'e iner.
- Ön denetim paneli yaklaşık 1500 px'ten yaklaşık 500 px'e iner.
- Silme formu yaklaşık 4 ekrandan yaklaşık 2,5 ekrana iner.

Diğer sayfalar:
- Profil telefonda yaklaşık 5-7 ekrandan yaklaşık 2,5 ekrana iner.
- Ayarlar'ın ilk ekranında TOFU ve Ed25519 terimi 0.
- Konu ayrıntısında tartışma 1,5-2 ekran yukarı gelir.
- Bildirim satırı başına düğme 2'den 1'e iner.

Rehber (onaylanırsa): 7 bileşen tek sayfada, her biri 1 dokunuşta; 7 adımlı gösterim rehberi.

Belgeler, ekran görüntüleri ve belgeleme aracı yeni arayüzle tutarlı; araç hatasız koşar.

10/10 e2e dosyası yeşil.

### 1. Görsel dil: renk rolleri, rozet bütçesi, tipografi belirteçleri

Emek: orta · Risk: orta

Renk rolleri
- mavi = eylem ve 'şu an'
- yeşil ve kırmızı = sonuç
- turuncu = dikkat ve süre
- mor (accent) = YALNIZ yapay zekâ (AiLabel, .ai-*)

badges.tsx STATUS_TONE yeni eşlemesi:
- sponsoring, deliberation, voting, revote → info
- objection_window, reconciliation → warning
- enacted → success
- rejected, inadmissible → danger
- draft, withdrawn, expired → neutral

Diğer ton değişiklikleri:
- KindBadge her zaman neutral; TierBadge T3 dışında neutral.
- VotePanel ve VerifyTally kartlarındaki tone='accent' kalkar; ince mavi kenarlı 'action' tonu gelir.
- ProgressBar accent → primary.
- 'Bilirkişi gerekli' ve 'Sürüm vN' gibi mor rozetler neutral olur.

Belirteçler ve CSS:
- Tek mavi için --info ve --info-soft, üç tema bloğunda da primary değerlerine eşitlenir.
- :root'a boşluk ve yazı belirteçleri eklenir (--sp-*, --fs-*, --measure 70ch). Bunlar takma ad olduğu için iki koyu tema bloğu kendiliğinden uyar.
- .badge yazısı küçülür; BÜYÜK HARF etiketler kalkar.

Kontrast:
- WCAG AA, açık tema ve iki koyu tema bloğunda (67-96, 98-130) ölçülür.

- **Özellik korunumu:** Yalnız görünüm değişir. Durumların anlamı zaten metin ve simgeyle veriliyor. Sınıf adları (.badge-*, .card-*, .page-meta) ve <section aria-labelledby> yapısı aynı kalır.
- **Dosyalar:** web/src/styles.css, web/src/ui/badges.tsx, web/src/ui/basic.tsx, web/src/components/participation/VotePanel.tsx, web/src/components/participation/VerifyTallyPanel.tsx, web/src/components/participation/ExpertPanelCard.tsx, web/src/components/participation/AuditCard.tsx, web/src/README.md ('Görsel dil')
- **e2e:** Yok, çünkü renk ya da sınıf tonuna bakan test yok. Ekran görüntüleri yenilenir.

### 2. Sade dil: terim korunur ve günlük karşılık eklenir; Term bileşeni; ParamsCard sembol anahtarı

Emek: orta · Risk: düşük

Sözlük ve Term bileşeni
- lib/glossary.ts yaklaşık 25 terim içerir: köprü testi, görüş kümesi, katman T0–T3/DEL, yeter sayı, onay eşiği, φ, ω, K_s, taahhüt, makbuz, doğrulayıcı, 2f+1, Merkle yolu, TOFU, ontoloji, karartma/mezar taşı, vekâlet, bilirkişi kurası, P_g, GAC.
- ui/Term.tsx satır içi bir <button aria-haspopup=dialog> çizer ve mevcut Modal sheet'i açar. Pencerede 1-3 cümle tanım ve 'Yönetmelikte ›' bağlantısı bulunur.
- Term yalnız 4 yerde kullanılır: TierBadge açıklaması (bugün yalnız title), ParamsCard etiketleri, ResultsCard kontrol satırları, VerifyTally 'Neyi denetler?'.
- Term şunların içine konmaz: başlık, form etiketi, düğme, Uzlaşma ve İtiraz panelleri.

ParamsCard
- Satırlar sade adla başlar: 'Onay eşiği: %60 (τ)'.
- kv-hint formülleri tek bir 'Sembolleri ve formülleri göster' anahtarının arkasına girer; Tam kipte açık gelir.

Görünen metinler
- Görünen etiketlerde yalnız terimin yanına günlük karşılık eklenir, ör. 'Ontoloji denetimi — yönetmeliğin otomatik denetimi'.
- Dokunulmaz metin listesi değişmez: 'Simüle saat … ileri alındı', 'Gerekli destekçi', 'Yönetmeliğe uygun', 'T0', 'DEL', 'Sonuç kesindir.', 'Toplam geçerli imza', köken başlıkları, 'İtiraz geçerli — uzlaşma turu', 'Küme kuralı (a)', '1. tur: sayım doğrulandı', 'Bu hesap sunucuya güvenmeden tarayıcınızda yapıldı.', 'Şimdilik doğrulandı', 'Oyunuz kayıtlı ve sayıma girdi', 'Kurcalama yakalandı', '✔ Makbuz bu cihazda kayıtlı', '✔ Bu öneriyi desteklediniz.', '(sizin imzanız; başkalarına anonim görünür)', 'Anonim imzacı'.
- 'özet' sözcüğünün hash anlamında 'parmak izi' olarak yeniden adlandırılması onaya bağlıdır.

- **Özellik korunumu:** Hiçbir terim ve sembol silinmez; semboller 1 dokunuşta, Tam kipte açık gelir. Masaüstündeki title ipuçları kalır, dokunmatikte Term ile okunur.
- **Dosyalar:** web/src/lib/glossary.ts (yeni), web/src/ui/Term.tsx (yeni), web/src/ui/badges.tsx, web/src/components/participation/ParamsCard.tsx, web/src/components/participation/ResultsCard.tsx, web/src/components/participation/VerifyTallyPanel.tsx, web/src/ui/HashText.tsx (onaya bağlı)
- **e2e:** Term düğme adları şunları içermez: 'Destekle', 'Oyumu ver', 'Daha fazla', 'Sayımı kendim doğrulayayım', 'Kapat', 'Gerekçe', 'Açıklama', 'Azınlık raporu', 'Düğüm'.

02:42 (toast) ve 02:149 ('Gerekli destekçi') metinleri değişmediği için testler geçer.

### 3. Yeni öneri formu: kompakt tür seçici, hüküm önce ön denetim, kurallar duruma göre açık

Emek: orta · Risk: orta

KindPicker
- Tür seçilince 5 büyük kart, tek satırlık 5 küçük radyoya daralır (ad ve katman). Radyolar DOM'da ve işaretli kalır.
- Açıklamalar Details 'Türler ne demek?' içinde okunur.
- 'Bir öneri nasıl karara dönüşür?' kartı bugün de yalnız tür seçilmeden önce görünüyor (NewProposalPage.tsx:574-608); değişmez.

PrecheckPanel
- Görünür kalanlar: hüküm Alert'i, katman, 'Bilirkişi gerekli' ve 'Gerekli destekçi (Kₛ)' satırları.
- Açılır olanlar: 'Karar parametreleri', 'Bulgular (n)', 'YZ önerileri', 'Benzer öneriler (n)'.
- Duruma göre açık gelir: ihlal ya da uyarı varsa Bulgular, YZ kategori önerisi varsa YZ, yüksek benzerlik varsa Benzer öneriler.

DeletionForm
- 'Tartışma silinmez' Alert'i tek cümle olur, ayrıntısı Details'e girer.
- 'Kurallar ve sınırlar' canlı sayaçlı tek satır olur ('Açık talepleriniz 1/3 · bugün 2/5'). 4 kural Details içine girer; sınıra 1 kala ya da sınırda warning olarak açılır.

CategoryPicker
- Yeni Konu'da ağaç bugünkü gibi açık kalır.
- Alt konu ve Düzenleme'de 'Ek kategoriler (isteğe bağlı)' kapalı başlar.

Gönderim paragrafı tek satır olur; ayrıntı Details 'Gönderince ne olur?' içindedir.

- **Özellik korunumu:** - 5 tür ve ?tur=, ?konu=, ?mesaj= ön doldurma korunur.
- Canlı ön denetimin bütün çıktıları korunur.
- PII akışı, 'Yine de gönder', taslak ve gönderim ayrımı, sürüm çakışması kurtarma, PatchBuilder korunur.
- Silme kuralları ve sayaçlar korunur.
- **Dosyalar:** web/src/pages/NewProposalPage.tsx, web/src/components/proposals/KindPicker.tsx, web/src/components/proposals/PrecheckPanel.tsx, web/src/components/proposals/DeletionForm.tsx, web/src/components/CategoryPicker.tsx, web/src/styles.css (.radio-cards-compact)
- **e2e:** - 02:138-141: radyo /Yeni Konu/ görünür ve toBeChecked; URL'de tur=topic.
- 02:142-144: 'Başlık' ve 'Öneri metni' etiketleri tekil; kategori onay kutusu GÖRÜNÜR.
- 02:145-149 ve 03:66-68: .pre-summary 'T0', 'DEL' ve 'Yönetmeliğe uygun'; aside 'Ön denetim' içinde 'Gerekli destekçi'.
- 03:59-65: 'Görüş ayrılığı' devre dışı ve 'Değiştirilemez madde…' görünür; role=alert 'Acil gerekçe…' tek eşleşme (kurallar satırı role=status); 'Talebin açıklaması'.

### 4. Konular ve konu ayrıntısı: tek satır sayaçlar, tartışma yukarıda, sürüm geçmişi katlanır

Emek: küçük · Risk: düşük

TopicsPage
- 4 StatGrid kutusu tek satır bağlantılı sayaçlara iner.
- Mobilde Kategori ve Arşiv süzgeçleri Details 'Süz' içine girer; arama görünür kalır.

TopicTree
- 'sürüm n' yalnız n>1 ise görünür.
- Kategoriler en çok 2 ve '+n'.

TopicDetailPage
- Metin ClampText ile kısaltılır.
- Telefonda sıra: metin → Açık öneriler (ProposalRow; boşsa tek satır) → Tartışma → Alt konular → 'Sürüm geçmişi (n)' (katlanabilir, kapalı).
- Masaüstünde yan sütun korunur.

- **Özellik korunumu:** Ağaç, Tümünü aç/kapat, arama, ?kategori=, arşiv, sayaçlar, breadcrumb, kaynak öneri bağlantısı, 'Alt konu öner' ve 'Düzenleme teklif et', sürüm farkı ve bütün tartışma işlevleri korunur.
- **Dosyalar:** web/src/pages/TopicsPage.tsx, web/src/components/proposals/TopicTree.tsx, web/src/pages/TopicDetailPage.tsx
- **e2e:** 03-silme'nin konu sayfası adımları Tartışma'ya bağlı ve tartışma görünür kalır (?mesaj=, menü, mezar taşı, cevap, gizli metin). 01-tarama:137-139 ve 214 yalnız taşmaya bakar.

### 5. Profil ve Ayarlar: oy hakkı durumu önde, seyrek işler katlanır, tanılama 'Gelişmiş'te

Emek: orta · Risk: düşük

ProfilePage
- En üstte 'Oy hakkınız: Var/Yok' kartı. Eksik koşul için TEK eylem gösterilir: 'Siyasi görüş rızası ver' ya da 'Kayıt memuru onayı bekleniyor'.
- Açık kalan kartlar: Hesap özeti, Açık rızalar, Vekâletler.
- Katlanabilir olanlar: Bilirkişilik, Takma ad değiştir, Şifre değiştir, Kişisel verilerim (KVKK), Kimlik bilgilerimi düzelt. Başlıkları h2 olarak görünür kalır; ?bolum=kvkk ya da ?bolum=duzeltme ile açık gelir.
- Boş vekâlet tabloları tek satıra iner.
- Uzun ipuçları ilk cümle ve 'Ayrıntı' biçimine geçer.

SettingsPage
- Sıra: Görünüm (tema ve görünüm yoğunluğu) → Sunucu bağlantısı (açık) → Bu cihazdaki oy makbuzları.
- 'Gelişmiş' başlığı altında katlanabilir kartlar: Doğrulayıcı anahtarları (TOFU), Uygulama hakkında. Başlıkları görünür kalır.
- PinNotice'teki 'Ayarlar sayfasından sıfırlayabilirsiniz' cümlesi 'Ayarlar › Gelişmiş' olur.

- **Özellik korunumu:** PRF-1…9 ve SET-1…5 işlevlerinin hepsi korunur. Seyrek kartlar başlıklarıyla görünür ve 1 dokunuşta açılır. Hesap silme onayı (SİL ve şifre), döküm indirme ve düzeltme talebi aynen kalır.
- **Dosyalar:** web/src/pages/ProfilePage.tsx, web/src/pages/SettingsPage.tsx, web/src/components/system/pinned.tsx
- **e2e:** Yalnız 01-tarama'nın taşma taraması etkilenir.

ekranlari-kaydet.mjs:159-160 Profil başlıklarını getByRole('heading', exact) ile arar; başlıklar görünür kaldığı için bulunur, ama kapalı gövdeyi çekmek için kartı açan bir adım eklenmeli.

'Bağlantıyı sına' görünür kalır (Sunucu kartı açık). 'Uygulama hakkında' başlığı görünür kalır (katlanabilir kartın başlığı).

### 6. Bildirimler: tür sınıfı, tarih grupları, satırın tamamı bağlantı

Emek: küçük · Risk: düşük

- notificationKinds.ts açık bir eşleme tablosu tutar; öneki yetmeyen türler de içindedir: lockstep, panel, deletion_request, delegation_unrouted, registration_pending, identity_correction, password_changed, nickname_changed. Tanınmayan tür varsayılan sınıfa düşer.
- Her sınıf bir ikon ve sr-only tür metni alır; renk tek başına anlam taşımaz.
- Liste 'Bugün / Bu hafta / Daha eski' h2 başlıklarıyla gruplanır.
- Satırın tamamı 'Git' bağlantısıdır; tıklayınca okundu işaretler.
- 'Okundu' ikon düğmesine iner, erişilebilir adı 'Okundu işaretle: <başlık>'.
- Okunmamış bildirim varsa varsayılan filtre 'Okunmamış' olur.

- **Özellik korunumu:** Tümü/Okunmamış, Git, Okundu, Tümünü okundu işaretle, 60 sn yoklama, boş durumlar ve göreli/mutlak zaman korunur.
- **Dosyalar:** web/src/pages/NotificationsPage.tsx, web/src/lib/notificationKinds.ts (yeni), web/src/styles.css
- **e2e:** 01-tarama:167 (tabs:true) için ilk main tablist 'Bildirim filtresi' olarak kalır; tarih başlıkları tablist değildir.

### 7. [Onaya bağlı] 'Keşfet ve doğrula' sayfası ve gösterim rehberi

Emek: orta · Risk: düşük

Yeni /kesfet sayfası (React.lazy). Gezinme öğesi değildir; NavItem'a topNav:false eklenir.

Bağlantı verilen yerler:
- Ana sayfa vitrini ('Gösterim rehberi ›')
- Masaüstü alt bilgisi
- Mobil 'Daha fazla' sayfasındaki Keşfet grubu

Sayfa bölümleri:
(1) Kanıt listesi: 7 satır, canlı durumuyla. Veri auth.system ve getDashboard'dan gelir.
(2) Gösterim rehberi: 7 adım. Hepsi mevcut veriden türetilir; sabit seq kullanılmaz:
- Son kararın sayımını yeniden yap → recentEnacted[0] ?bolum=dogrula
- Oyunu makbuzla doğrula → /oy-dogrula
- Zinciri doğrula → /defter?sekme=dogrulama; yöneticiye ek olarak ?sekme=demo
- Köprü testi ve görüş grupları → recentEnacted[0] ?bolum=sonuclar
- Bilirkişi kurası → /bilirkisiler
- Ontoloji denetimi → listedeki ilk 'inadmissible' öneri ?bolum=ontoloji; yoksa /yonetmelik
- Kalıcı kaybeden küme göstergesi → /graf?sekme=istatistik
(3) 8 temel ilkenin tam metni.
(4) Sözlük bölümü (glossary).

- **Özellik korunumu:** Yeni bir sayfa; hiçbir şey taşınmaz. Ana sayfadaki vitrin ve ilkeler yerinde kalır.
- **Dosyalar:** web/src/pages/KesfetPage.tsx (yeni), web/src/App.tsx, web/src/lib/routes.ts, web/src/components/layout/nav.ts, web/src/components/layout/AppLayout.tsx, web/src/components/home/ShowcaseTiles.tsx
- **e2e:** 01-tarama'nın ziyaretçi listesine { label: 'Keşfet ve doğrula', path: '/kesfet' } eklenir. Başka teste etkisi yok.

### 8. [İsteğe bağlı] Görev sayısı rozeti ve listede 'Sizden bekleniyor'

Emek: küçük · Risk: düşük

- AuthContext'in 60 sn'lik okunmamış yoklamasına mevcut getMyTasks() eklenir (endpoints.ts:129, /api/me/tasks).
- Alt çubukta ve üst gezinmede 'Ana sayfa' sayı rozeti gösterilir.
- ProposalCard'da 'Sizden bekleniyor: Oy/Destek/İtiraz' görünür. Öneri kimliği görev bağlantısından (/oneriler/<id>) ayrıştırılır; sunucu değişikliği gerekmez.

- **Özellik korunumu:** Ek bilgi; hiçbir şey kalkmaz.
- **Dosyalar:** web/src/auth/AuthContext.tsx, web/src/lib/taskStore.ts (yeni), web/src/components/layout/AppLayout.tsx, web/src/components/proposals/ProposalCard.tsx
- **e2e:** 60 sn yoklama waitSettled'in 400 ms sessizlik penceresini etkilemez. Rozet aria-hidden olur ve bağlantı adını değiştirmez.

### 9. Belgeler, ekran görüntüleri, belgeleme aracı ve önce/sonra ölçümü

Emek: küçük · Risk: düşük

Belgeler:
- web/src/README.md: kabuk tarifi (235-236), 'Görsel dil', 'Test-güvenli adlandırma' ve 'görünür kalması gereken bölgeler' listeleri.
- README.md: Keşfet ve görünüm yoğunluğu.
- docs/TEST_RAPORU.md: satır 57, 94, 104, 113 ('canlı pano', mobil sistem durumu, alt gezinme, görünüm sayıları).

ekranlari-kaydet.mjs:
- Android tercih yedek listesine forum.detail ve forum.dismissed eklenir.
- 'Kura kayıtları'ndan önce 'Kura ve adillik kanıtı' açılır.
- Profil kartları açılır.
- /kesfet ekranı eklenir.
- Gerekirse 'Tam' kipte çekim yapılır.

Ekran görüntüleri: docs/ekran ve gorseller/2026-10-01 yeniden çekilir.

Ölçüm: bu çalışmanın tarayıcı ölçümü aynı demo verisi ve simüle saatle tekrarlanır ve rapora eklenir.

- **Özellik korunumu:** Yalnız belge ve araç güncellemesi.
- **Dosyalar:** web/src/README.md, README.md, docs/TEST_RAPORU.md, gorseller/2026-10-01/araclar/ekranlari-kaydet.mjs, docs/ekran/*, gorseller/2026-10-01/*
- **e2e:** Yok.

## Faz 2 sonu taslakları

### Ana sayfa

```
Gösterim: [..] düğme · › bağlantı · ▸ kapalı açılır · ▾ açık · ● durum noktası · ┃ vurgulu kenar.
Telefonda içerik alanı ≈ 694 px (812 − 56 üst çubuk − 62 alt çubuk). Sayılar tohumdan ve ölçümden alındı. Çizimler Faz 2 sonunu gösterir.

══════════════════════════════════════════════════════════
A) TELEFON 375×812 · doğrulanmış üye @ayse · taze tohum (2 görev, 6 açık öneri)
══════════════════════════════════════════════════════════
┌─────────────────────────────────────┐
│ [FS] Forum Sistemi     🔔2   @ayse ▾ │ 56 px, yapışkan
├─────────────────────────────────────┤
│ Merhaba, @ayse                      │ H1
│ 2 iş sizi bekliyor · 3 öneri oylamada│ canlı tek satır özet
│ ┌ Sizi bekleyenler (2) ────────────┐│
│ │ Oy ver · #K-31 Kütüphane hafta… ›││ satırın tamamı bağlantı
│ │   Kalan 2 sa 13 dk               ││ → öneri ?bolum=eylem
│ │ Destek ol · #K-33 Bisiklet yolu ›││
│ │   Kalan 1 g 3 sa                 ││
│ └──────────────────────────────────┘│
│ [+ Yeni öneri]  [Oylamadakiler (3)] │
│ Oyum kayıtlı mı? (2 makbuz) ›       │
│ Şu an açık (6)  Tümü (süreye göre) ›│
│ ● #K-31 Kütüphane…  Oylamada · 2 sa │ ProposalRow
│ ● #K-33 Bisiklet…   Destek 2/4 · 1 g│
├──────── İLK EKRAN SONU ─────────────┤
│ Ana sayfa│Konular│Öneriler│Oy doğrula│Daha fazla │ 62 px (değişmez)
└─────────────────────────────────────┘
İLK EKRANDA:
- Selam ve durum satırı.
- Geri sayımlı 2 görev.
- 2 hızlı eylem ve makbuz bağlantısı.
- İlk 2 açık öneri.

İLK EKRANDA OLMAYANLAR: 5 sistem kutusu, uzun slogan, 9 sayaç kutusu, ilke kartları.

Kaydırınca (≈1,6 ekran daha):
  ● #K-34 … ● #K-35 … ● #K-36 …   (en çok 5 satır)
  Son kararlar                    Tüm kabul edilenler ›
   ✔ #K-7  Kütüphane hafta sonu…   Kabul · 3 Eki
   ✘ #K-9  Park ücretleri          Red · 29 Eyl      (5 satır)
  Topluluk durumu
   (Destek 1)(Tartışma 2)(Oylama 3)(İtiraz/uzlaşma 0 · soluk)(Kabul 21)(Red/aykırı 9)(17 konu)
   ✔ Azınlık koruması: kalıcı kaybeden küme yok · 3 küme izleniyor ▸
  Neyi doğrulayabilirsiniz?                 Gösterim rehberi ›
   ┌ Defter ────────────┐┌ Oy doğrulama ──────┐
   │ 345. blok · 4/4 ✔ ›││ makbuzla, cihazda ›│
   ├ Bilirkişiler ──────┤├ Yapay zekâ ────────┤
   │ kura defterde     ›││ Çevrimdışı·danışma │
   ├ Graf ──────────────┤├ Yönetmelik ────────┤
   │ görüş kümeleri    ›││ v2 · ontoloji     ›│
   └────────────────────┘└────────────────────┘
   Simüle saat 2 Eki 14:05 (demo: 1 sa = 6 dk) · 57 doğrulanmış, 3 bekleyen üye · v1.x
  Sistem nasıl çalışır? (8 temel ilke)
   ▸ Çoğunluk gerekir ama yetmez — köprü testi
   ▸ Azınlığın gücü erteleyicidir, tek seferliktir
   ▸ … (8 başlık görünür; metin ve bağlantı açılınca)
Toplam ≈ 2,6 ekran (bugün 6,3).

══════════════════════════════════════════════════════════
B) TELEFON · ziyaretçi (hoca / jüri)
══════════════════════════════════════════════════════════
┌─────────────────────────────────────┐
│ [FS] Forum Sistemi        [Giriş yap]│
├─────────────────────────────────────┤
│ Forum Sistemi                       │ H1
│ Köprülü çoğunlukla karar veren, her │ ≤14 kelime
│ adımı defterden doğrulanan forum.   │
│ [Giriş yap]  [Kayıt ol]             │
│ Okumak için hesap gerekmez.         │
│ ▸ Neden kayıt gerekir?              │ bugünkü 47 kelime içeride
│ Neyi doğrulayabilirsiniz?           │
│ ┌ Defter ─────────┐┌ Oy doğrulama ─┐│
│ │345. blok · 4/4 ›││makbuzla      ›││
│ ├ Bilirkişiler ───┤├ Yapay zekâ ───┤│
│ │kura defterde   ›││Çevrimdışı     ││
│ ├ Graf ───────────┤├ Yönetmelik ───┤│
│ │görüş kümeleri  ›││v2 · ontoloji ›││
│ └─────────────────┘└───────────────┘│
├──────── İLK EKRAN SONU ─────────────┤
İLK EKRANDA:
- Sistemin ne olduğu (tek cümle).
- Giriş ve kayıt.
- Ödevin 6 bileşeni, canlı bilgisiyle ve her biri 1 dokunuşta.

Sonrasında: saat ve üye satırı · Şu an açık · Son kararlar · Topluluk durumu (azınlık koruması dahil) · 8 ilke başlığı.
Toplam ≈ 3 ekran.

══════════════════════════════════════════════════════════
C) TELEFON · @admin · ÖLÇÜLEN DEMO DURUMU (görev 0, açık öneri 0, siyasi rıza yok)
══════════════════════════════════════════════════════════
│ Merhaba, @admin                      │
│ Bekleyen işiniz yok · açık öneri yok │
│ ┃ Süreleri ilerletmek için simüle    │ role göre ipucu (A)
│ ┃ saati ileri alın.      Yönetim ›   │ V için: 'İlk öneriyi siz açın'
│ ⓘ Oy için siyasi görüş rızası yok ·  │ tek satır not
│   Profil'de ver ›      [Notu gizle]  │ (VotePanel/Profil'de hep var)
│ [+ Yeni öneri]  [Tüm öneriler]       │
│ Oyum kayıtlı mı? ›                   │
│ Şu an açık öneri yok.                │ tek satır, boş kart yok
│ Son kararlar     Tüm kabul edilenler ›│
│ ✔ #K-7  Kütüphane…     Kabul · 3 Eki │
│ ✔ #K-12 Gece otobüsü…  Kabul · 1 Eki │
│ ✘ #K-9  Park ücretleri Red · 29 Eyl  │
├──────── İLK EKRAN SONU ─────────────┤
Pending, askı ve ret şeritleri bu sayfada çıkmaz; bilgi sayfanın kendi kartında bir kez verilir.

══════════════════════════════════════════════════════════
D) MASAÜSTÜ 1280×860 · doğrulanmış üye
══════════════════════════════════════════════════════════
┌──────────────────────────────────────────────────────────────────────────────────┐
│ FS Forum Sistemi                                                   🔔2  @ayse ▾   │
│ Ana sayfa  Konular  Öneriler  Oyum kayıtlı mı?  │  Bilirkişiler  Graf  Defter  Yönetmelik │ 8 öğe + ayraç
├──────────────────────────────────────────────────────────────────────────────────┤
│ Merhaba, @ayse                               [+ Yeni öneri] [Oylamadakiler (3)]   │
│ 2 iş sizi bekliyor · 3 öneri oylamada                  Oyum kayıtlı mı? (2) ›      │
│ SOL (2/3)                                     │ SAĞ (1/3)                          │
│ ┌ Sizi bekleyenler (2) ────────────────────┐  │ Neyi doğrulayabilirsiniz?          │
│ │ Oy ver · #K-31 Kütüphane…   Kalan 2 sa › │  │ Defter       345. blok · 4/4 ✔   › │
│ │ Destek ol · #K-33 Bisiklet… Kalan 1 g  › │  │ Oy doğrulama makbuzla, cihazda   › │
│ └──────────────────────────────────────────┘  │ Bilirkişiler kurayla, danışman   › │
│ Şu an açık (6)           Tümü (süreye göre) › │ Yapay zekâ   Çevrimdışı · danışma  │
│ ● #K-31 …   Oylamada 23/57             2 sa   │ Graf         görüş kümeleri      › │
│ ● #K-33 …   Destek 2/4                 1 g    │ Yönetmelik   v2 · ontoloji       › │
│ ● #K-34 …   Tartışmada                 3 g    │ Saat 2 Eki 14:05 (demo) · 57 üye   │
│ Son kararlar              Tüm kabul edilenler ›│                Gösterim rehberi › │
│ ✔ #K-7  …  Kabul · 3 Eki                      │ Topluluk durumu                    │
│ ✔ #K-12 …  Kabul · 1 Eki                      │ (Destek 1)(Tartışma 2)(Oylama 3)   │
│ ✘ #K-9  …  Red · 29 Eyl     (5 satır)         │ (İtiraz 0)(Kabul 21)(Red 9)(17 konu)│
│                                               │ ✔ Azınlık koruması: uyarı yok ▸    │
│ Sistem nasıl çalışır? (8 temel ilke)   ▸ … ▸ … (2 sütun, 8 başlık)                │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Forum Sistemi · istemci v… · Sunucu saati … · YZ … · Defter: blok 345 · 4/4 (aynen) │
└──────────────────────────────────────────────────────────────────────────────────┘
İLK EKRANDA (≈760 px içerik):
- Görevler, açık öneriler ve son kararların başı.
- Ödev vitrininin tamamı ve topluluk durumu.

Toplam ≈ 1,4 ekran (bugün 3,1). Tıklanabilir ≈ 24 (bugün 36). Kelime ≈ 230 (bugün 632).

Ara durum, FAZ 1 SONU (yalnız sıra değişikliği ve katlama), telefonda yukarıdan aşağıya:
1. Başlık ve kısa slogan
2. Hesap çağrısı ve 'Bekleyen işleriniz'
3. Hızlı eylemler
4. Açık öneriler
5. Topluluk durumu hapları ve azınlık koruması hükmü
6. Vitrin
7. Son yürürlüğe girenler
8. 8 ilke başlığı

Toplam ≈ 3,5 ekran.
```

### Öneri sayfası

```
Gösterim: [..] düğme · › bağlantı · ▸ kapalı açılır · ▾ açık · ┃ vurgulu kenar.
Telefonda içerik alanı ≈ 694 px. Çizimler Faz 2 sonunu gösterir.

══════════════════════════════════════════════════════════
A) TELEFON 375×812 · #K-7 KABUL EDİLDİ, bilirkişili (hocanın büyük olasılıkla göreceği ekran)
══════════════════════════════════════════════════════════
┌─────────────────────────────────────┐
│ [FS] Forum Sistemi    🔔2  @admin ▾  │
├─────────────────────────────────────┤
│ ‹ Öneriler                          │
│ #K-7  ✔ Kabul edildi  Yeni Konu     │ .page-meta (T0 burada yok)
│ Kütüphane hafta sonu açık olsun     │ H1
│ @ayse · 12 gün önce · sürüm 2       │ .page-subtitle (aynen)
│ Kültür · Eğitim  +1                 │ .cat-tag, en çok 3
│ ✔─✔─✔─✔─● Kabul edildi              │ kompakt evre şeridi
│ ┌ Sıradaki adım ───────────────────┐│ section; ad: 'Sıradaki adım'
│ │ ✔ Kabul edildi; 3 Eki 14:05'ten  ││
│ │ beri yürürlükte. 1. turda %79    ││
│ │ onay; köprü testi 3/3 grup.      ││
│ │ [Oluşan konuya git]              ││ EnactedEffect düğmesi (aynı)
│ │ Nasıl karar verildi? › Sayımı doğrula ›││ ?bolum=sonuclar / dogrula
│ └──────────────────────────────────┘│
│ Bu sayfada: Metin · Sonuç · Bilirkişi│ nav, satıra sarar
│ · Tartışma (4) · Kanıtlar           │
│ Öneri metni                         │
│ Belediye kütüphanesi cumartesi ve…  │ ilk ~10 satır
├──────── İLK EKRAN SONU ─────────────┤
İLK EKRANDA:
- Ne oldu: tarih ve tek cümle neden.
- Ne yapabilirim: oluşan konuya git.
- İki soru bağlantısı ve 5 bölüm bağlantısı.
- Metnin başı.

Bugün ilk ekranda 5 tıklanabilir öğe var ve hiçbiri eylem değil. Yenisinde ≈ 10 öğe var, hepsi eylem ya da soru.

Kaydırınca:
 [Tamamını göster (240 kelime)]
 Sonuçlar
 ┌ 1. tur sonucu ─────────────────── [Kabul] ┐ region ve .card-actions aynen
 │ Gerekçe: eşik ve köprü testi sağlandı.     │
 │ 57 uygun · 41 katıldı · Kabul 30 · Red 8 · Çekimser 3 │
 │ Katılım ▓▓▓▓▓▓░ (yeter sayı)  Onay ▓▓▓▓▓▓▓░ %79 (eşik %60) │
 │ Neden bu sonuç?                            │ section aria-label aynen
 │  ✔ Yeter sayı  ✔ Onay oranı  ✔ Köprü testi │
 │ ▸ Görüş grupları ve köprü testi — 3/3 grup tabanı aştı · GAC 0,71 │ başarısızsa ▾
 │ ▸ Ayrıntılı sayılar (vekâletle, yönlendirilemeyen…) │
 │ Azınlık raporları (1): “…ilk 3 satır”  Tümünü göster │
 │ Algoritma KC-1.0 · girdi özeti a1b2c3…      │
 └────────────────────────────────────────────┘
 ┌ Sayımı kendim doğrulayayım ────────────────┐ region ve düğme aynen
 │ Bülteni defterden alıp sayımı bu cihazda   │
 │ yeniden yapın; sunucuya güvenmeniz gerekmez.│
 │ [Sayımı kendim doğrulayayım]  ▸ Neyi denetler? │
 └────────────────────────────────────────────┘
 ┌ Bilirkişi görüşü ──────────────────────────┐
 │ 2 rapor: 2 uygulanabilir · ort. güven %80 · 2 soru │
 │ Raporlar (2)                               │ SubHeading aynen
 │  @bk_a · Uygulanabilir · %80 · [Raporu oku] │
 │  @bk_b · Uygulanabilir · %75 · [Raporu oku] │
 │ Bilirkişiye sorular (2) …       [Soru sor]  │
 │ ▸ Kura ve adillik kanıtı (tohum, atamalar, kura kayıtları, aday havuzu) │
 └────────────────────────────────────────────┘
 ┌ Tartışma özeti (yapay zekâ) ── YZ etiketi ┐
 │ Azınlık görüşleri: • … #3       (hep açık) │
 │ ▸ Ortak zemin (3) ▸ Tartışmalı noktalar (2) ▸ Açık sorular (1) │
 └────────────────────────────────────────────┘
 Tartışma (4)              [Eskiden yeniye ▾]   ≈ 2,8. ekranda başlar (bugün 11,5)
  Lehte 2 · Aleyhte 1 · Soru 1
  [✎ Görüşünüzü yazın…]   (dokununca tam form açılır)
  @deniz · Lehte · 3 gün önce · #1
   mesaj gövdesi (12 satırdan uzunsa kısaltılır)
   [Katılıyorum 3] [Katılmıyorum 0] Köprü 0,72 · Yanıtla · ⋯
   özet a1b2c3 · defter d4e5f6 ›         (tek sessiz satır)
  … 3 mesaj daha …
  ▸ Tartışma kuralları ve köprü skoru
 Kanıtlar ve denetim                      [Tümünü aç]
  Destekçiler (4/4): @a · @b · @c · @d     (hep açık, region)
  ▸ Zaman çizelgesi — 5 evre geçişi, hepsi defterde
  ▸ Ontoloji denetimi — ✔ Uygun · Olağan karar (T0) · 1 uyarı
  ▸ Karar parametreleri — eşik ≥ %60 · yeter sayı uygun seçmenin %20'si · sabitlendi
  ▸ Sürüm geçmişi — 2 sürüm · son 10 Eyl
  ▸ Defter kayıtları — 64 işlem · son: Sayım
Toplam ≈ 4,5–5 ekran (bugün 13,5). Bütünlük uyarısı olan öneride 'Bütünlük uyarıları (n)' en üstte açık gelir. Aykırı öneride Ontoloji denetimi açık ve kırmızı gelir.

══════════════════════════════════════════════════════════
B) TELEFON · #K-31 OYLAMADA · oy hakkı olan ama henüz oy vermemiş üye
══════════════════════════════════════════════════════════
│ ‹ Öneriler                          │
│ #K-31  ● Oylamada  Yeni Konu        │
│ Kütüphane hafta sonu açık olsun     │
│ @deniz · 3 gün önce · sürüm 2       │
│ ✔─✔─●Oylama─○─○                     │
│ ┌ Sıradaki adım ───────────────────┐│
│ │ Oyunuz bekleniyor · Kalan 2 sa 13 dk││ Countdown buraya taşındı (onDone yenileme aynen)
│ │ Gizli oy; süre bitene kadar      ││
│ │ değiştirebilirsiniz.             ││
│ │ [Oy bölümüne git ↓]              ││ bağlantı; odak ilk radyoya taşınır
│ │ Bilirkişi: 2 rapor ›             ││
│ └──────────────────────────────────┘│
│ Bu sayfada: Metin · Oy ver ·        │
│ Bilirkişi · Tartışma (6) · Kanıtlar │
│ Öneri metni (ilk ~10 satır)…        │
├──────── İLK EKRAN SONU ─────────────┤
 ┌ Oylama ─────────────────── Kalan 2 sa ┐ sayfada adı 'Oylama' olan tek region
 │ Katılım ▓▓▓▓░░░ 23/57                  │
 │ Ara sonuç gösterilmez; yalnız katılım görünür. │
 │ ( ) Kabul  ( ) Red  ( ) Çekimser       │ ilk etkileşimli öğe radyo
 │ [Oyumu ver]                            │
 └────────────────────────────────────────┘
 Oy verdikten sonra panel:
 │ Geçerli oyunuz: Kabul · 14:05          │
 │ ✔ Makbuz bu cihazda kayıtlı  [Oyum kayıtlı mı?] │ ikisi de Details DIŞINDA
 │ ▸ Makbuz ayrıntıları (pusula kimliği, taahhüt, defter işlemi) │
 Sıradaki adım kartı o zaman: 'Oyunuz kayıtlı (Kabul); süre bitene kadar değiştirebilirsiniz.' Panel metinlerini tekrarlamaz.

══════════════════════════════════════════════════════════
C) MASAÜSTÜ 1280×860 · #K-7
══════════════════════════════════════════════════════════
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ‹ Öneriler                                                                        │
│ #K-7  ✔ Kabul edildi  Yeni Konu                                                   │
│ Kütüphane hafta sonu açık olsun                                                   │
│ @ayse · 12 gün önce · sürüm 2 · Kültür · Eğitim · +1                              │
│ ✔ Destek ── ✔ Tartışma ── ✔ Oylama ── ✔ İtiraz ── ● Kabul edildi                   │
│ ┃ ✔ Kabul edildi; 3 Eki 14:05'ten beri yürürlükte · %79 onay · köprü testi 3/3    │
│ ┃ [Oluşan konuya git]     Nasıl karar verildi? ›     Sayımı doğrula ›             │
│ Bu sayfada: Metin · Sonuç · Bilirkişi · Tartışma (4) · Kanıtlar                    │
│ ANA SÜTUN (2/3)                                   │ Kanıtlar ve denetim [Tümünü aç]│
│ Öneri metni                                       │ Destekçiler (4/4)              │
│ Belediye kütüphanesi … (ilk ~16 satır)            │ @a · @b · @c · @d              │
│ [Tamamını göster]                                 │ ▸ Zaman çizelgesi              │
│ ┌ 1. tur sonucu ─────────────────────── [Kabul] ┐ │   5 evre geçişi · defterde     │
│ │ Gerekçe … · 57 uygun · 41 katıldı · K30 R8 Ç3 │ │ ▸ Ontoloji denetimi            │
│ │ Katılım ▓▓▓▓▓▓░   Onay ▓▓▓▓▓▓▓░ %79 (≥ %60)    │ │   ✔ Uygun · Olağan karar (T0)  │
│ │ Neden bu sonuç? ✔ Yeter sayı ✔ Onay ✔ Köprü    │ │ ▸ Karar parametreleri          │
│ │ ▸ Görüş grupları ve köprü testi — 3/3 · GAC 0,71│ │   eşik ≥%60 · yeter sayı %20   │
│ │ ▸ Ayrıntılı sayılar                            │ │ ▸ Sürüm geçmişi — 2 sürüm      │
│ └───────────────────────────────────────────────┘ │ ▸ Defter kayıtları — 64 işlem  │
│ ┌ Sayımı kendim doğrulayayım ───────────────────┐ └────────────────────────────────│
├────────────────────────── İLK EKRAN SONU ────────────────────────────────────────┤
│ │ Bülteni defterden alıp … [Sayımı kendim doğrulayayım] ▸ Neyi denetler?          │
│ Bilirkişi görüşü — 2 rapor: 2 uygulanabilir · Raporlar (2) · Sorular (2) [Soru sor] │
│ Tartışma özeti (yapay zekâ) — Azınlık görüşleri açık                               │
│ Tartışma (4) · [✎ Görüşünüzü yazın…] · mesajlar (2/3 genişlikte, okunaklı ölçü)    │
└──────────────────────────────────────────────────────────────────────────────────┘
İLK EKRANDA:
- Sonuç ve yürürlük cümlesi, 3 eylem.
- Metnin başı.
- Sonuç hükmü ve 'Neden bu sonuç?'.
- Sağda ödev kanıtları: destekçiler, zaman, ontoloji, parametreler, sürüm, defter; her biri hükmüyle ve 1 dokunuşta.

Toplam ≈ 3 ekran (bugün 6,2). Görünür tıklanabilir ≈ 40 (bugün 85). Renkli rozet ≈ 5 (bugün 19).

══════════════════════════════════════════════════════════
D) TELEFON · #K-28 UZLAŞMA (azınlık raporu yazabilen üye), ilk ekranın altı
══════════════════════════════════════════════════════════
 ┌ Sıradaki adım ─┐ 'İlk turda Red dediğiniz için azınlık raporu yazabilirsiniz · Kalan 2 g' [Uzlaşma bölümüne git ↓]
 ┌ Uzlaşma turu ──────────────────────────────┐ region aynen
 │ Köken: tartışmalı sonuç (köprü testi sağlanamadı) │ role=status
 │ [Azınlık raporu yaz]                       │ role için ilk blok
 │ Azınlık raporları (2) …                    │ region aynen
 │ Köprü taslakları: [Taslakları üret] · en güncel set açık · ▸ Önceki taslak setleri │
 │ Karşı bilirkişi ve revizyon …              │
 └────────────────────────────────────────────┘
 ┌ Azınlık itirazı (alarm zili) ───────────────┐ katlanmaz (04:88-89)
 │ [İtiraz geçerli — uzlaşma turu] [Küme kuralı (a)] · Toplam geçerli imza: 7 │
 │ ▸ Geçerlilik nasıl hesaplanır? (grup tablosu, a/b/güçlü kuralları) │
 │ ▸ İtiraz imzaları (7)                       │
 └────────────────────────────────────────────┘

Ara durum, FAZ 1 SONU (yalnız katlama): sayfa iskeleti bugünküyle aynı. aside'daki 5 kart kapalı başlık ve hüküm satırı olarak görünür, metin kırpılmıştır, kura kanıtı tek bir açılırdadır. K-7 telefonda ≈ 8 ekran, Tartışma ≈ 6,5. ekranda.
```

## Özellik erişim haritası

Gösterim: 0 = varsayılan görünür (kaydırma gerekebilir) · 1 = bir dokunuş · 2 = iki dokunuş · ↓ = sayfanın aşağısında. 'Bugün → Yeni' Faz 2 sonunu gösterir (Faz 3 ile değişenler ayrıca belirtildi). Satır biçimi: YETENEK | BUGÜN | YENİ YER | DOKUNUŞ (bugün → yeni).

── KABUK VE GEZİNME ──
Ana sayfa, Konular, Öneriler, Oyum kayıtlı mı? | masaüstü üst gezinme; mobil alt çubuk | aynen | 1 → 1
Bilirkişiler, Graf, Defter, Yönetmelik | masaüstü üst gezinme; mobilde 'Daha fazla' | aynen (masaüstünde gruplar arası ayraç) + Ana sayfa vitrini | masaüstü 1 → 1 · mobil 2 → 2 (vitrinden 1)
Kayıt memuru, Yönetim, Profil, Ayarlar | kullanıcı menüsü; mobilde 'Daha fazla' | aynen | 2 → 2
Bildirimler | zil | aynen | 1 → 1
Sistem durumu (saat ve ölçek, ileri alma, YZ kipi ve modeli, defter yüksekliği ve doğrulayıcı sağlığı, yönetmelik sürümü, üye sayıları, istemci sürümü) | masaüstü alt bilgi 0 ve Ana sayfa şeridi 0; mobilde YALNIZ Ana sayfa | masaüstü alt bilgi 0; Ana sayfa vitrini ve alt satırı 0↓; mobil 'Daha fazla' sistem bloğu (yeni); Keşfet (Faz 3) | mobil, Ana sayfa dışından: yok → 1
Oturum süresi doldu / Sunucuya ulaşılamıyor şeritleri | her sayfa 0 | aynen | 0 → 0
Bekleyen, askıdaki, reddedilmiş hesap mesajı | her sayfada şerit, Ana sayfada çift | '/' dışında şerit; '/' rotasında yalnız Ana sayfa kartı | 0 → 0
Android geri tuşuyla açık kullanıcı menüsünü kapatma | çalışmıyor (hata) | çalışır | — → 1

── ANA SAYFA ──
Bekleyen işler (7 tür, geri sayım, en yakın önce) | 0↓ (telefonda 1. ekranın sonu) | 'Sizi bekleyenler': ilk 3 satır 0 (ilk ekran), 'Tümünü göster (n)' 1 | 0↓ → 0
Görevden ilgili panele gitmek | 1 + öneri sayfasında ≈5 ekran kaydırma | 1 (?bolum=eylem, panel görünür ve odaklı açılır) | 1+kaydırma → 1
Yeni öneri | 0 | hızlı eylem 0 + Öneriler başlığı 0 | 0 → 0
Oylamadaki öneriler | 0 | 'Oylamadakiler (n)' 0 (n=0 ise 'Tüm öneriler') | 0 → 0
Oyum kayıtlı mı? | 0 (düğme) + gezinme | 'Oyum kayıtlı mı? (n makbuz)' 0 + gezinme + vitrin | 0 → 0
Siyasi rıza ve 18 yaş bilgisi | 0 (iki Alert) | tek satırlık not 0 (cihazda gizlenebilir); VotePanel ve Profil'de her zaman | 0 → 0
Bekleyen hesabın doğrulama adımları | 0 | kart 0 (kısaltılmış 3 adım) | 0 → 0
Askı ve ret açıklaması | 0 (ret metni yanlış vaat içeriyor) | 0 (düzeltilmiş metin) | 0 → 0
Pano 9 sayaç ve ?sekme= bağlantıları | 0 (9 kutu) | 'Topluluk durumu' hapları 0 (sıfırlar soluk ama görünür; bağlantılar aynı) | 0 → 0
Doğrulanmış ve bekleyen üye sayısı | Pano 0 | vitrin alt satırı 0 | 0 → 0
Yürürlükteki konu sayısı | Pano 0 | '17 konu' hapı 0 | 0 → 0
Kalıcı kaybeden göstergesi (eşik %75, sınıf, çubuklar, açıklama, graf bağlantısı) | 0 (hep açık kart) | hüküm satırı 0, ayrıntı 1 (uyarıda kendiliğinden açık); ayrıca Graf › İstatistikler 'Durum' sütunu | 0 → 0/1
Açık öneriler (10, bitiş sırasıyla) | 0 (kart) | 'Şu an açık' 5 satır 0; 'Tümü (süreye göre)' → ?sekme=acik&sirala=sure 1 | 0 → 0 (ilk 5) / 1
Son yürürlüğe girenler (5) | 0 (tam kart) | 'Son kararlar' 5 satır 0 | 0 → 0
8 temel ilke: metin ve derin bağlantı | 0 (8 kart) | 8 başlık 0; metin ve bağlantı 1; Keşfet'te tam (Faz 3) | 0 → 0/1
Slogan | 0 | ziyaretçi başlığında (≤14 kelime) | 0 → 0
'Neden kayıt gerekir?' açıklaması (ziyaretçi) | 0 | 1 | 0 → 1

── ÖNERİLER LİSTESİ ──
Varsayılan görünüm | 'Açık' (demo verisinde boş) | Açık doluysa Açık, değilse Sonuçlanan + açıklama notu | —
Evre süzgeçleri (destek, tartışma, oylama, itiraz/uzlaşma, kabul, red/aykırı, geri çekilen/süresi dolan) | 1 (9 sekme, bazıları kaydırmada gizli) | üst sekme + evre çipi | 1 → 1–2
Benim (taslaklar dahil) | 1 | 1 | 1 → 1
Arama | 0 | 0 | 0 → 0
Tür ve Sırala | 0 | masaüstünde 0, telefonda 'Süz ve sırala' 1 | 0 → 0/1
Eski ?sekme= bağlantıları (Ana sayfa, ilkeler, dış) | çalışır | aynen çalışır (eşleme + birim testi) | —
Kartta tür, katman, kategori, 'ara sonuç gizli' | 0 (en çok 9 rozet) | tür meta satırında 0; T1+ katman 0, T0 öneri sayfasında; ilk 2 kategori + '+n'; 'ara sonuç gizli' çubuk etiketinde | 0 → 0
60 sn yenileme, 500 sınırı notu, Süzgeci temizle | 0 | aynen | 0 → 0

── ÖNERİ AYRINTISI ──
Durum ve evre | rozet + şerit 0 | aynen (telefonda kompakt şerit) | 0 → 0
'Şimdi ne yapmalıyım?' | yok | Sıradaki adım kartı 0 (ilk ekran) | yok → 0
Kalan süre | başlıktaki geri sayım 0 | Sıradaki adım kartı 0 (onDone yenileme aynen) | 0 → 0
Öneri metni | 0 (tamamı) | ilk ~10/16 satır 0, tamamı 1 | 0 → 0/1
Düzenleme farkı, silme hedefleri, yönetmelik yaması | 0 | 0 | 0 → 0
Destekle | 0↓ (formül paragrafının altında) | panelde çubuğun hemen altında 0; Sıradaki adım kartından 1 | 0↓ → 0/1
K_s formülü | 0 | 'Kaç destekçi gerekir?' 1 | 0 → 1
Hak etkisi bayrağı ekle/kaldır | 0 (form açık) | tek satır özet 0, form 1 | 0 → 1
Metin önerisi gönder/yanıtla, metni düzenle, geri çek (yazar) | 0 | 0 (yazar düğmeleri üstte) | 0 → 0
Oy ver / oyu değiştir | 0↓ (metin ve 3 bilgi bloğunun altında) | 'Oy bölümüne git' 1, sonra 0 kaydırma; panelde form en üstte | ≈5 ekran kaydırma → 1
'✔ Makbuz bu cihazda kayıtlı', Makbuzu kaydet, Oyum kayıtlı mı? | 0 | 0 (Details dışında) | 0 → 0
Makbuz hash'leri (pusula kimliği, taahhüt, defter işlemi) | 0 | 'Makbuz ayrıntıları' 1 | 0 → 1
İtiraz imzala | 0↓ (tablo ve kuralların altında) | panelin en üstü 0; Sıradaki adım kartından 1 | 0↓ → 0
İtiraz değerlendirmesi: rozetler ve 'Toplam geçerli imza' | 0 | 0 | 0 → 0
İtiraz grup tablosu ve (a)(b)(güçlü) kuralları | 0 | 'Geçerlilik nasıl hesaplanır?' 1 | 0 → 1
İtiraz imza listesi | 0 | açık evrede 0; sonuçlanmışta 'İtiraz imzaları (n)' 1 | 0 → 0/1
Azınlık raporu yaz ve raporlar | 0 | 0 | 0 → 0
Köprü taslakları üret/benimse | 0 | en güncel set 0; eski setler 1 (bugün de kapalı) | 0 → 0
Karşı bilirkişi ve revizyon | 0 | 0 | 0 → 0
Sonuç: gerekçe, toplamlar, iki çubuk, 'Neden bu sonuç?' | 0 | 0 | 0 → 0
7 sayı kutusu ve açıklamaları (bugün yalnız title) | 0 | 'Ayrıntılı sayılar' 1, açıklamalar görünür metin | 0 → 1
Görüş grupları tablosu (P_g, taban φ, geçti mi?), GAC | 0 | hüküm satırı 0, tablo 1 (köprü ya da taban başarısızsa 0) | 0 → 0/1
Sonuç kartındaki azınlık raporları | 0 | ilk 2 0, tümü 1 | 0 → 0/1
Algoritma sürümü ve girdi özeti | 0 | 0 | 0 → 0
Sayımı kendim doğrulayayım (çalıştırma, adımlar, işlem bağlantıları, taahhüt listesi) | 0↓ | 0 + 'Sayımı doğrula' kısayolu 1 | 0↓ → 0
'Neyi denetler?' teknik girişi | 0 | 1 | 0 → 1
Bilirkişi raporları | 0 | rapor başına özet satırı 0, tam rapor 1 | 0 → 0/1
Bilirkişiye soru sor (azınlık güvenceli) | 0 (form açık) | soru listesi 0, form 1 | 0 → 1
Kura tohumu, atamalar, kura kayıtları, aday havuzu | 0 / 1 | 'Kura ve adillik kanıtı' 1 (iç Details'ler 2) | 0/1 → 1/2
Bilirkişi paneli talep et | 0 | 0 | 0 → 0
YZ özeti üret; azınlık görüşleri | 0 | 0 (azınlık görüşleri hep açık) | 0 → 0
YZ özeti: ortak zemin, tartışmalı noktalar, açık sorular | 0 | başlık + sayı 0, maddeler 1 | 0 → 1
Tartışmayı okumak (telefon) | ≈11,5. ekran | ≈2,8. ekran; 'Bu sayfada' ile 1 | kaydırma → 1
Mesaj yazmak | 0↓ (form hep açık) | 'Görüşünüzü yazın…' 1 | 0 → 1
Yanıtla, düzenle, katılıyorum/katılmıyorum, köprü skoru, sıralama | 0 | 0 | 0 → 0
Mesajın 'Diğer' menüsü (sürüm geçmişi, silme talebi, defter kaydı) | 1 | 1 | 1 → 1
Mesaj içerik özeti ve defter bağlantısı | 0 (iki satır) | tek sessiz satır 0 | 0 → 0
Tartışma kuralları ve köprü skoru | 1 | 1 (en altta) | 1 → 1
?mesaj= derin bağlantısı, YZ alıntılarından mesaja gitme | çalışır | aynen (Discussion hep bağlı) | —
Zaman çizelgesi ve evre geçişlerinin defter hash'leri | 0↓ | hüküm 0, ayrıntı 1 | 0 → 1
Ontoloji denetimi (katman gerekçesi, ihlal, uyarı, bilgi, uygulanan kurallar) | 0↓ | hüküm 0, ayrıntı 1; aykırıysa 0 | 0 → 0/1
Karar parametreleri ve süreler | 0↓ | hüküm 0, ayrıntı 1 (Faz 3: semboller anahtarın arkasında, 2) | 0 → 1
Destekçiler (n/m) | 0 | 0 (hep açık) | 0 → 0
Sürüm geçmişi / iki sürüm farkı | 0 / 0 | 1 / 2 | 0 → 1/2
Defter kayıtları / tümü | 0 / 1 | 1 / 2 | 0/1 → 1/2
Bütünlük uyarısı | rozet 0 + kart 0 | rozet 0 + kart 0 (varsa açık) | 0 → 0
Kategoriler | 0 (hepsi) | ilk 3 0, tümü 1 | 0 → 0/1
Katman | rozet 0 | T1+ başlıkta 0; T0 ontoloji hükmünde 0 | 0 → 0
Her şeyi açmak | yok | kanıt sütununda 'Tümünü aç' 1; Ayarlar › Görünüm 'Tam' 2 | yok → 1/2

── DİĞER SAYFALAR (Faz 1 ve Faz 3 sonu) ──
Yeni öneri: 5 tür ve ?tur/?konu/?mesaj ön doldurma | 1 | 1; seçimden sonra kompakt radyo şeridi (tür değiştirmek 1) | 1 → 1
Ön denetim: hüküm, katman, gerekli destekçi | 0 | 0 | 0 → 0
Ön denetim: parametreler, bulgular, YZ önerileri, benzer öneriler | 0 | 1 (sorun ya da yüksek benzerlik varsa 0) | 0 → 0/1
Silme formu: sayaçlar / kurallar | 0 / 0 | 0 / 1 (sınıra 1 kala 0) | 0 → 0/1
Konular: ağaç, arama, kategori, arşiv, sayaçlar | 0 | 0 (sayaçlar tek satır; telefonda süzgeçler 1) | 0 → 0/1
Konu ayrıntısı: tartışma / sürüm geçmişi / fark | 0↓ / 0 / 0 | 0 (yukarıda) / 1 / 2 | —
Profil: oy hakkı, rızalar, vekâletler | 0 | 0 (oy hakkı kartı en üstte) | 0 → 0
Profil: takma ad, şifre, KVKK, kimlik düzeltme, bilirkişilik | 0 | 1 (başlık görünür; ?bolum ile açık gelir) | 0 → 1
Ayarlar: tema, sunucu bağlantısı, makbuzlar | 0 | 0 | 0 → 0
Ayarlar: TOFU anahtarları ve sıfırlama, uygulama hakkında | 0 | 1 (Gelişmiş; başlıklar görünür) | 0 → 1
Defter, Yönetmelik, Bilirkişiler açıklayıcıları | 0↓ (her sekmede) | sayfa başında 1 | 0 → 1
Yönetmeliğin 58 fıkrası | 0 | bölüm başına 1 (ilk bölüm açık; arama hepsini açar) | 0 → 0/1
Oy doğrula, makbuz yokken | boş durum | 'Oylamadaki öneriler (n)' 0 / 'Makbuzu elle yapıştır' 0 | — → 0
Kurcalama demoları (makbuz, defter) | 0 | 0 | 0 → 0
Bildirimler: Git, Okundu, Tümünü okundu | 0 | satırın kendisi 0, okundu ikonu 0 | 0 → 0
Gösterim rehberi ve sözlük | yok | /kesfet 1 (Ana sayfa vitrini 'Gösterim rehberi ›', masaüstü alt bilgisi, mobil 'Daha fazla') | yok → 1
Terimin günlük karşılığı ve tanımı | masaüstünde yalnız title | terime dokununca pencere 1 (title masaüstünde kalır); yeni öneri formunun yanında pencere bağlantıları yeni sekmede (Android'de madde düz metin, sözlük Keşfet'ten) | dokunmatikte yok → 1
Bekleyen iş sayısı | yalnız Ana sayfada | 'Ana sayfa' bağlantısında rozet 0 (her sayfa); öneri kartında 'Sizden bekleniyor' 0 | Ana sayfa dışından yok → 0
Konu ayrıntısı: açık önerilerin türü ve yazarı | 0 (rozet + @yazar) | satırın meta metninde 0 (düz metin) | 0 → 0
Profil: görüş kümesinin yöntemi (Polis benzeri kümeleme) ve köprü testindeki rolü | 0 (ipucu) | ilk cümle 0; 'Görüş kümesi nasıl hesaplanır?' 1 | 0 → 1
Silme formundan KVKK bölümüne | Profil'in başı (kaydırma) | /profil?bolum=kvkk (kart açık, odaklı) | 1+kaydırma → 1

## Elenen fikirler

- T2: Öneri sayfasında 3 üst sekme (Genel bakış / Tartışma / Denetim). Tartışma gizli bir panelde kalır ve sayfa içi aramaya ve ekran okuyucuya sekme değiştirmeden görünmez. Mesaj yazmak 2 dokunuş olur. ?mesaj= ile YZ alıntıları sekme eşitlemesi ister. 33 önerinin tartışma ve denetim panelleri 360 px taramasından çıkar. Ortak Tabs bileşeni 8 sayfada değişir. Yerine: tek akış, 'Bu sayfada' gezinmesi ve kanıt sütunu.
- T2: Tabs bileşenine keepMounted eklemek. Öneri sayfasında sekme olmadığı için gerek kalmadı; paylaşılan bileşen riske girmez.
- T1: Üst gezinmeyi 8 öğeden 4 öğeye indirmek, 'Keşfet' gezinme öğesi ve alt şerit. Ödev sayfaları masaüstünde 1 yerine 2 tık uzaklaşır, mobilde 'Oy doğrula' sekmesi kalkar, belgeler ve ekran görüntüleri toptan bayatlar. 8 öğe kalır; gruplar arasına ayraç gelir; Keşfet isteğe bağlı bir sayfa olur, gezinme öğesi olmaz.
- T1: ui/Menu.tsx'e role=menu ve menuitem eklemek. Menu bilinçli bir disclosure deseni; mesajın 'Diğer' menüsü de bu bileşen ve 03-silme:52 'Silme talebi aç' öğesini button rolüyle arıyor. Menü deseni ayrıca ok tuşu yönetimi ister. Yerine: native.ts seçicisi '.menu-list' olur.
- T1: Reddedilmiş üyeye 'Kimlik bilgilerimi düzelt' bağlantısı. Reddedilen hesap kapalı (identity/index.ts:99); düzeltme talebi sunucuda reddediliyor (corrections.ts:214). Çıkmaz yol olurdu. Mevcut yanlış metin de düzeltilir.
- T1: Kalıcı kaybeden göstergesinin açıklamasını ve çubuklarını Graf'a 'taşımak'. Graf'taki kart yalnız bir tablo; eşik, sınıf ve açıklama orada yok (GraphPage.tsx:266-286). Gösterge Ana sayfada katlanır ve uyarıda açık gelir; Graf'a ayrıca 'Durum' sütunu eklenir.
- T1 ve T2: Akıllı varsayılan sekmeyi useQueryState('sekme','acik') ile kurmak. Varsayılana eşit değer URL'den silindiği için (hooks.ts:51) 'Açık' sekmesi hiç seçilemez ve 01-tarama:52-53 kırılır. Yerine varsayılan '' kullanılır (T3'ün doğru çözümü).
- T1: Ana sayfada tek bir büyük 'hero' görev kartı. Ölçülen demo durumunda görev 0 olduğu için kart çoğu zaman boş kalır. Sıralı bir liste (ilk 3) ve role göre boş durum ipucu daha bilgilendirici.
- T1: Aynı türden 3 veya daha fazla görevi tek satıra toplamak. Ek karmaşıklık getirir; 'ilk 3 ve Tümünü göster' yeterli.
- T1: QuickCreate alt sayfası ('+ Yeni' ile tür seçimi). Kompakt KindPicker ile yol zaten 2 dokunuş ve yaklaşık 0 kaydırma oluyor. İkinci bir oluşturma yolu ve bileşeni gereksiz.
- T1: Katlanabilir kartlarda genel 'Ayrıntıları göster/gizle' düğme adı. Sayfada onlarca aynı adlı düğme oluşur (WCAG 2.4.6). Yerine <h2><button>Başlık</button></h2> akordeonu ve başlık dışında hüküm satırı.
- T1: 'Ekranda tek dolu renkli düğme' ilkesinin mutlak hâli. Oylama panelindeki 'Oyumu ver' ve 'Oyum kayıtlı mı?' ile 'Destekle' zaten birincil düğmeler. İlke 'ilk ekranda tek birincil' olarak gevşetildi.
- T1: Görev rozeti için taskStore'u yalnız Ana sayfa verisiyle beslemek. Diğer sayfalarda rozet boş ya da bayat kalır. Gerekirse hazır uç nokta getMyTasks() mevcut 60 sn okunmamış yoklamasına eklenir (Faz 3, isteğe bağlı).
- T1: Gösterim rehberinde 'YZ özeti olan son öneri' ve 'bilirkişili öneri' gibi adımlar. ProposalSummary'de bu alanlar yok (types.ts:223-240). Rehber adımları yalnız mevcut veriden türetilir: recentEnacted, inadmissible durumu, sabit rotalar.
- T2: Ana sayfadan askı ve ret uyarısını kaldırıp yalnız kabuk şeridine bırakmak. Şerit neyin yapılamadığını söylemiyor; bilgi kaybı olur. Yerine '/' rotasında şerit gizlenir, Ana sayfa kartı kalır.
- T2: Ana sayfadan 'Oyum kayıtlı mı?' hızlı eylemini kaldırmak. Makbuz doğrulama ödevin vitrini; makbuz sayısıyla birlikte hızlı eylem olarak kalır.
- T3: Geniş çaplı yeniden adlandırma: 'Simüle saat' → 'Demo saati', 'Ontoloji denetimi' → 'Yönetmelik denetimi', 'Karar parametreleri' → 'Karar kuralları', 'Destekçi (eş imzacı)'. 02:42'deki toast testi ('Simüle saat … ileri alındı') kırılır ve yönetmeliğin kendi terminolojisiyle bağ kopar. Yerine terim korunur, günlük karşılık yanına eklenir.
- T3 (ve T1, T2): Parametrelerden 'yeter sayı 12 kişi', 'her grupta %40 destek' gibi sade cümle üretmek. quorum bir oran; mutlak sayı yalnız oylama açıldıktan ya da sayımdan sonra biliniyor. Grup tabanı yumuşatılmış P_g ve soğuk başlangıç kurallarına bağlı, bu yüzden anlam kayardı. Sade cümle yalnız gerçekten bilinen değerlerle kurulur.
- T3: Sade kipte hash'leri ve kopyala düğmelerini gizlemek. Görünüm tercihini bir içerik ayarına çevirir ve test edilecek durumu ikiye katlar. Tercih yalnız varsayılan açıklığı değiştirir.
- T3: Dört ayrı yerde tek seferlik ipuçları (Hint). Her temiz e2e bağlamında görünür, QA yükü getirir ve 'boğulma'yı artırır. Yerine ziyaretçi başlığı, 'Neden kayıt gerekir?' ve isteğe bağlı gösterim rehberi.
- T3: Mobilde evre süzgecini bir Details içindeki Select'e almak. Evre seçimi 3 dokunuşa çıkar ve keşfedilmez. Yerine sayılı evre çipleri (aria-pressed).
- T3: Öneriler listesini ilk 20 kartla sınırlamak. Kartlar sadeleştiği için liste uzunluğu asıl sorun olmaktan çıkıyor; ek bir dokunuş ve sayfa içi aramada eksik sonuç getirir.
- T3: Üst gezinmeden simgeleri kaldırmak. Tanınırlığı azaltır, kazancı düşük.
- T3: /defter?sekme=dogrula bağlantısı. Gerçek sekme kimliği 'dogrulama' (LedgerPage.tsx:24); bağlantı sessizce 'Durum' sekmesine düşerdi. Bütün derin bağlantılar gerçek kimliklerle yazılır.
- Üç tasarımın ortak varsayımı: 'Bir öneri nasıl karara dönüşür?' kartını tür seçildikten sonra katlamak. Kart bugün de yalnız tür seçilmeden görünüyor (NewProposalPage.tsx:574-608); hiçbir kazanç yok, değişiklik yapılmaz.
