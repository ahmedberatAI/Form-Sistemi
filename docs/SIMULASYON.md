# Simülasyon Raporu — Köprülü Çoğunluk (KÇ-1.0) ve Basit Çoğunluk

> Bu dosya `npm run sim -w server` (`server/scripts/simulate.ts`) tarafından **üretilir**; elle düzenlemeyin.
> Ana tohum: `KC-1.0/simulasyon/2026-10`. Tüm rastgelelik tohumludur; aynı kod ve tohumla aynı rapor üretilir.

## Özet

- **Çoğunluk tiranlığı:** C'ye (%10) zarar veren önerilerin basit çoğunlukta %100,0'i geçiyor; KÇ'de ilk tur kabul %100,0, nihai kabul %100,0 (geçenler yalnızca yeniden oylamada ω = 2/3 ile). B'ye zararlı önerilerde: basit çoğunluk %100,0, KÇ nihai %31,2. Yalnız A'nın istediği önerilerde: %99,8 → %41,2.
- **İyi önerileri engellemiyor:** Geniş destekli önerilerin kabul oranı basit çoğunlukta %100,0, KÇ'de %100,0; ortalama süre 5,0 gün.
- **Liberum veto yok:** %10'luk blok her öneriye aktif "hayır" deyip itiraz etse de çok popüler öneriler KÇ'de %100,0 oranında yürürlüğe giriyor (gecikme: ortalama 5,4 gün). Azınlık yalnızca 2/3'ün altında kalan önerileri durdurabiliyor (az farkla popüler: %99,4).
- **Boykot işe yaramıyor:** C boykot ettiğinde önerilerin %0,0'i bir kez uzatılıyor ve nihai kabul %100,0; aynı öneriye aktif "hayır" dendiğinde ilk tur contested oranı %0,0.
- **Vekâlet sınırı:** sınır (15) ile tek bir delegenin taşıdığı en fazla oy 14,9 (|E|'nin %5,0'i); sınırsız durumda 24,6 (%8,2).
- **Kalıcı kaybeden:** C bloğunun istemediği halde kabul edilen karar oranı basit çoğunlukta %41,6, KÇ'de %35,1; C'nin toplam kaybetme oranı %50,3 → %49,2.
- **Kümeleme uyarısı:** §9.4'teki "siluet < 0,25 → K = 1" kuralı 2 boyutlu PCA uzayında homojen nüfusta tetiklenmiyor (bulunan K: 3, 2, 3, 3, 3); bkz. (h).

## Yöntem

- **Gerçek kod:** Her karar `@forum/shared` içindeki `decide()` ve `evaluateObjection()` ile; kümeler `computeClusters()` ile simüle oy geçmişinden; vekâlet `resolveEffectiveVotes()` ile hesaplanır. Basitleştirilmiş bir yeniden uygulama kullanılmaz.
- **Nüfus:** Bloklar A/B/C (%60/%30/%10). Standart nüfus |E| = 300; üyelerin %5'i yeni üyedir (oy geçmişi yok → kümelenmemiş; genel onaya sayılır, köprüye katılmaz). Her kişinin kalıcı bir eğilimi vardır (logit, N(0; 0,5²)).
- **Oy modeli:** Öneri, blok başına bir logit destek ile tanımlanır. Kişi `katılım` olasılığıyla (varsayılan %55) oy verir; %4 çekimser; aksi halde P(evet) = σ(logit_blok + eğilim + N(0; 0,6²)). Uzatmada oy vermemişler katılım × 0,35 olasılıkla geç katılır.
- **Küme anlık görüntüsü:** 40 kapanmış önerilik geçmişten (ortak değer + bloğa özgü sapma, sapma ölçeği 1,6) hesaplanır. Standart nüfus için: K=2, siluet 0,39, saflık %81,1, kümelenmiş 286, dışlanan 0 — g0=190 (blok A), g1=96 (blok B).
- **Süreç (ALGORITMA §3):** ilk tur → (gerekirse bir kez uzatma) → kabulse itiraz penceresi (`evaluateObjection`) → geçerli itiraz ya da contested ise uzlaşma + yeniden oylama (uzatma hakkı yeniden). Yeniden oylamada tercihler aynı dağılımdan yeniden örneklenir (ikna/değişiklik etkisi yok, aksi belirtilmedikçe) — bu, KÇ için **kötümser** bir varsayımdır.
- **Basit çoğunluk (karşılaştırma):** aynı ilk tur oyları; aynı yeter sayı kuralı (`min(|E|, max(⌈q·|E|⌉, ⌈1,5·√|E|⌉))`), yeter sayı yoksa bir kez uzatma; kabul ⇔ evet > hayır. Köprü, itiraz ve yeniden oylama yok.
- **≈ onay** sütunu yalnız yönlendirme amaçlı yaklaşık beklenen onaydır; asıl oranlar simülasyondan gelir.

Kullanılan parametreler (ALGORITMA §2 varsayılanları):

| Katman | q | τ | φ | ω | ρ | Süreler (oylama/uzatma/itiraz/uzlaşma, saat) |
|---|---|---|---|---|---|---|
| T0 | %20 | > %50 | %30 | %66,7 | %60 | 72/24/48/72 |
| T1 | %30 | ≥ %60 | %40 | %66,7 | %60 | 96/24/72/120 |

Ortak: σ_share = %10, σ_min = 3, μ_votes = 2, n_C,min = 12, δ_cold = +0,10 (en çok 2/3), cap = max(2, ⌈0,05·|E|⌉), H = 3.

## (a) Azınlığa zarar veren öneriler

Tohum: `KC-1.0/simulasyon/2026-10|a|*`; her satır 1000 öneri; T0; standart nüfus (|E| = 300). Zarar gören bloğun "hayır" diyen üyeleri itirazı %80 olasılıkla imzalar.

| Öneri tipi | Logit A / B / C | ≈ onay | Basit çoğunluk: kabul | KÇ 1. tur kabul | KÇ 1. tur contested | KÇ 1. tur red | KÇ nihai kabul | Aşma (ω) ile kabul |
|---|---|---|---|---|---|---|---|---|
| C'ye zararlı (A+B evet, C güçlü hayır) | 1,5 / 0,5 / -3,0 | %67 | %100,0 | %100,0 | %0,0 | %0,0 | %100,0 | %0,0 |
| B'ye zararlı (A evet, B güçlü hayır) | 2,0 / -2,5 / 0,5 | %60 | %100,0 | %22,0 | %78,0 | %0,0 | %31,2 | %0,6 |
| B ve C'ye zararlı (yalnız A evet) | 2,5 / -2,0 / -2,5 | %59 | %99,8 | %39,7 | %60,1 | %0,2 | %41,2 | %0,0 |
| C'ye zararlı; uzlaşmada metin yumuşatılır (yeniden oylama: 1,3 / 0,6 / −0,5) | 1,5 / 0,5 / -3,0 | %67 | %100,0 | %100,0 | %0,0 | %0,0 | %100,0 | %0,0 |

**Yorum.** Basit çoğunlukta azınlığa zarar veren önerilerin çoğu doğrudan geçer. KÇ'de azınlık kümesinin Laplace desteği tabanın (φ = 0,30) altında kaldığı için bu öneriler ilk turda **contested** olur ve uzlaşmaya gider. Yeniden oylamada öneri yalnızca a ≥ 2/3 ile (ω) geçebilir; bu nedenle C'ye zararlı önerilerin nihai kabul oranı %100,0'e iner. Bu öneriler ancak geniş bir nitelikli çoğunlukla geçebilir. Uzlaşmada metin azınlığın itirazına göre yumuşatıldığında (son satır) kabul oranı %100,0 olur: mekanizmanın amacı önerileri öldürmek değil, **azınlığı da kazanan** bir metne zorlamaktır.

## (b) Köprü kuran (geniş destekli) öneriler

Tohum: `KC-1.0/simulasyon/2026-10|b|*`; her satır 1000 öneri; "hayır" diyenler %30 olasılıkla itiraz imzalar.

| Öneri tipi | Logit A / B / C | ≈ onay | Basit çoğunluk: kabul | KÇ 1. tur kabul | KÇ 1. tur contested | KÇ 1. tur red | KÇ nihai kabul | 1. turda uzatma | Ort. süre (gün) |
|---|---|---|---|---|---|---|---|---|---|
| Geniş destek (herkes ılımlı evet) | 1,2 / 1,0 / 0,8 | %73 | %100,0 | %100,0 | %0,0 | %0,0 | %100,0 | %0,0 | 5,0 |
| Zayıf ama ortak destek | 0,5 / 0,4 / 0,3 | %60 | %99,4 | %99,4 | %0,0 | %0,6 | %98,8 | %0,0 | 5,1 |
| A+B evet, C kararsız | 1,5 / 1,0 / 0,0 | %74 | %100,0 | %100,0 | %0,0 | %0,0 | %100,0 | %0,0 | 5,0 |
| Ortak ret (herkes hayır) | -1,0 / -0,8 / -0,6 | %31 | %0,0 | %0,0 | %0,0 | %100,0 | %0,0 | %0,0 | 3,0 |
| Geniş destek — T1 (nitelikli) | 1,2 / 1,0 / 0,8 | %73 | %100,0 | %100,0 | %0,0 | %0,0 | %100,0 | %0,0 | 7,0 |

**Yorum.** Bütün kümelerin desteklediği önerilerde iki yöntem neredeyse aynı oranda kabul eder (geniş destek: %100,0 ve %100,0). KÇ iyi önerileri engellemez; maliyeti, kabul edilen önerilerde itiraz penceresi kadar (T0: 48 saat) gecikmedir. C'nin kararsız kaldığı durumda Laplace yumuşatması C'yi nötr (P ≈ 0,5) sayar ve öneri geçer. Ortak ret durumunda iki yöntem de reddeder. T1'de eşik %60 olduğu için kabul oranı daha düşüktür; bu katmanın tasarımıdır.

## (c) Azınlık tiranlığı / liberum veto

Tohum: `KC-1.0/simulasyon/2026-10|c|*`; her satır 500 öneri. C bloğu (%10) **her** öneriye güçlü "hayır" der (logit −4) ve "hayır" diyen her C üyesi itirazı imzalar. "Küme vetosu" sütunu, aşma eşiği olmayan saf bir eşzamanlı çoğunluk kuralının (her anlamlı küme P_g ≥ φ olmadan asla kabul yok) sonucudur.

| Öneri tipi | Logit A / B / C | ≈ onay | KÇ 1. tur kabul | KÇ 1. tur contested | Geçerli itiraz | Aşma (ω) ile kabul | KÇ nihai kabul | Küme vetosu: kabul | Ort. süre (gün) |
|---|---|---|---|---|---|---|---|---|---|
| Çok popüler (A, B güçlü evet) | 2,5 / 2,0 / -4,0 | %80 | %100,0 | %0,0 | %6,6 | %0,0 | %100,0 | %0,0 | 5,4 |
| Popüler | 1,5 / 1,0 / -4,0 | %69 | %100,0 | %0,0 | %0,0 | %0,0 | %100,0 | %0,0 | 5,0 |
| Az farkla popüler | 1,0 / 0,3 / -4,0 | %60 | %99,4 | %0,0 | %0,0 | %0,0 | %99,4 | %0,0 | 5,0 |
| Popüler; C bölünmüş (yarısı evet) | 1,5 / 1,0 / 0,0 | %74 | %100,0 | %0,0 | %0,0 | %0,0 | %100,0 | %0,0 | 5,0 |

**Yorum.** %10'luk blok popüler bir öneriyi **süresiz engelleyemez**: güçlü "hayır" öneriyi bir kez uzlaşmaya gönderir (erteleme), ardından yeniden oylamada 2/3 eşiği aşılırsa öneri yürürlüğe girer. Çok popüler önerilerde nihai kabul %100,0'dir. Bedeli ortalama 5,4 günlük bir gecikmedir. Uzlaşma turu en fazla bir kez yaşanır ve yeniden oylamadan sonra itiraz yoktur; bu nedenle azınlık aynı öneriyi ikinci kez durduramaz. Saf küme vetosu bu önerilerin hepsini kalıcı olarak durdururdu. Yalnızca az farkla popüler önerilerde (onay 2/3'ün altında) azınlığın aktif muhalefeti sonucu değiştirir (%99,4). Bu, tasarımın bilinçli bir sonucudur: bir azınlığın güçlü itiraz ettiği bir kararı almak için nitelikli çoğunluk gerekir. C bölündüğünde öneri ilk turda kabul edilir ve C'nin "hayır" diyenleri itiraz eder. İtiraz geçerliyse yeniden oylamada ρ (%60) ya da güçlü itirazda 2/3 aranır.

## (d) Boykot

Tohum: `KC-1.0/simulasyon/2026-10|d|*`; her satır 500 öneri; itiraz yok.

| Senaryo | Basit çoğunluk: kabul | 1. turda uzatma | KÇ 1. tur kabul (uzatma sonrası) | KÇ 1. tur contested | KÇ nihai kabul |
|---|---|---|---|---|---|
| C aktif hayır (katılım %55) | %100,0 | %0,0 | %100,0 | %0,0 | %100,0 |
| C boykot (katılım %0) | %100,0 | %0,0 | %100,0 | %0,0 | %100,0 |
| C neredeyse boykot (katılım %3) | %100,0 | %0,0 | %100,0 | %0,0 | %100,0 |
| C neredeyse boykot — T1 (φ = 0,40) | %100,0 | %0,0 | %100,0 | %0,0 | %100,0 |
| B aktif hayır | %100,0 | %0,0 | %23,8 | %76,2 | %42,0 |
| B boykot | %100,0 | %0,0 | %100,0 | %0,0 | %100,0 |

**Yorum.** Hiç oy vermeyen bir küme için P_g = (1+0)/(2+0) = 1/2 ≥ φ olur. Bu yüzden boykot **bir engel aracı değildir**. Boykot yalnızca μ_votes eksikliği nedeniyle tek seferlik uzatmayı tetikler (%0,0); uzatmadan sonra küme nötr sayılır ve öneri geçer (%100,0). Azınlık bir kararı ancak *aktif olarak hayır diyerek* durdurabilir. **Dikkat (T1/T2):** Uzatmadan sonra bir kümede yalnızca tek bir "hayır" oyu varsa P_g = 1/3 olur. Bu değer T0 tabanını (0,30) geçer ama T1/T2 tabanının (0,40) altında kalır. Bu durumda büyük bir kümenin neredeyse tamamen sessiz kaldığı bir oylamada tek bir kişi contested sonucunu tetikleyebilir (T1 satırı). Etki erteleyicidir (bir uzlaşma turu, sonra ω).

## (e) Küçük topluluklar ve soğuk başlangıç

Tohum: `KC-1.0/simulasyon/2026-10|e|<|E|>|<tekrar>`; her |E| için 30 farklı geçmiş (30 öneri) ve küme anlık görüntüsü; her görüntüde öneri tipi başına 40 öneri; katılım %65; T0.

| |E| | Bloklar A/B/C | Gerekli katılım (T0) | floor_abs | Ort. K | Köprü uygulanabilir | C anlamlı kümeyle temsil |
|---|---|---|---|---|---|---|
| 8 | 5/2/1 | 5 | 5 | 2,0 | %0 | %0 |
| 15 | 9/4/2 | 6 | 6 | 2,9 | %100 | %7 |
| 30 | 18/9/3 | 9 | 9 | 3,3 | %100 | %23 |

| |E| | Öneri tipi | Basit çoğunluk: kabul | 1. turda uzatma | KÇ 1. tur kabul | KÇ 1. tur contested | KÇ nihai kabul |
|---|---|---|---|---|---|---|
| 8 | Geniş destek | %71,7 | %30,5 | %69,3 | %0,0 | %69,3 |
| 8 | Dar çoğunluk | %46,0 | %29,8 | %42,2 | %0,0 | %42,2 |
| 8 | C'ye zararlı | %62,5 | %28,7 | %58,8 | %0,0 | %58,8 |
| 15 | Geniş destek | %89,1 | %26,4 | %85,3 | %4,5 | %88,9 |
| 15 | Dar çoğunluk | %55,1 | %28,2 | %48,5 | %6,5 | %51,1 |
| 15 | C'ye zararlı | %77,8 | %27,9 | %71,8 | %6,8 | %74,0 |
| 30 | Geniş destek | %96,8 | %11,2 | %93,6 | %3,3 | %96,6 |
| 30 | Dar çoğunluk | %68,6 | %11,3 | %58,4 | %10,2 | %63,8 |
| 30 | C'ye zararlı | %94,5 | %10,7 | %79,4 | %15,3 | %89,8 |

**Yorum.** |E| = 8 iken n_C < 12 olduğundan köprü testi hiç uygulanmaz (soğuk başlangıç). Bu durumda T0 eşiği %60'a yükselir ve `≥` ile karşılaştırılır. Dar çoğunluklu önerilerin kabul oranı bu nedenle basit çoğunluğa göre düşer. Mutlak taban `floor_abs = ⌈1,5·√|E|⌉` küçük gruplarda q·|E|'den büyüktür (|E| = 8 için 5 kişi). Gerekli katılımın |E|'yi aşmaması kuralı sayesinde kabul her zaman mümkündür. |E| = 15'te C bloğu 2 kişidir ve σ_min = 3 nedeniyle anlamlı küme oluşturamaz. Küçük gruplarda azınlığın korunması bu yüzden soğuk başlangıçtaki nitelikli çoğunluğa ve itiraz kuralına kalır. |E| = 30'da C (3 kişi, %10) sınırda anlamlıdır. C'nin ayrı ve anlamlı bir kümeyle temsil edildiği tekrarlarda KÇ, C'ye zararlı önerileri contested yapar.

## (f) Vekâlet yoğunlaşması ve sınır (cap)

Tohum: `KC-1.0/simulasyon/2026-10|f`; standart nüfus; 300 karışık öneri; doğrudan katılım %30 (ünlü delegeler %95). Üyelerin ~%60'ı vekâlet verir: %70'i Zipf ağırlıklı 15 "ünlü" delegeden birine (12'si A, 2'si B, 1'i C), %15'i kendi bloğundaki bir ünlüye, %15'i rastgele bir üyeye (zincirler). Kapsam "*", H = 3. Sınır: cap = max(2, ⌈0,05·300⌉) = 15.

| Durum | En yüklü delege (ort.) | En yüklü / |E| | Delege yükü Gini | Yönlendirilemeyen (ort.) | Etkin katılım | KÇ 1. tur kabul | KÇ 1. tur contested |
|---|---|---|---|---|---|---|---|
| Sınır = 15 | 14,9 | %5,0 | 0,45 | 10,0 | %65,0 | %47,7 | %0,3 |
| Sınırsız | 24,6 | %8,2 | 0,49 | 0,0 | %68,3 | %47,7 | %0,0 |

**Yorum.** Sınır olmadan tek bir delege |E|'nin %8,2'ini taşıyabilir. Sınırla bu oran %5,0 ile kalır. Sınırı aşan ortalama 10,0 kişinin oyu kullanılmaz ve bu kişilere bildirim gider. Bu kişiler ya doğrudan oy vermeli ya da başka bir delege seçmelidir. Sonucun sınır yüzünden değiştiği öneri oranı %4,0'dir. Vekâlet edilen oy, **delegatörün kendi kümesine** sayılır. Ancak C üyelerinin vekâletlerinin %77,8'i C dışındaki delegelere gidiyor. Bu durumda C'nin kümesindeki "oy", başka bir bloğun delegesinin tercihidir. Köprü testi kümeyi korur ama C'nin kendi tercihini değil, C üyelerinin seçtiği delegelerin tercihini ölçer. Bu ödünleşim kullanıcıya açıkça gösterilmelidir.

## (g) Kalıcı kaybeden

Tohum: `KC-1.0/simulasyon/2026-10|g|<tekrar>`; 8 bağımsız tekrar × 200 karar = 1600 karar; standart nüfus yapısı; T0. Öneri akışı: %25 ortak yarar (bütün bloklar benzer, olumlu), %75 bir blok tarafından yazılmış (yazar ∝ blok büyüklüğü; yazarın bloğu güçlü evet). Diğer blokların tutumu bir yakınlık matrisiyle belirlenir (A–B +0,2, A–C −0,6, B–C +0,4) ve gürültü eklenir. "Hayır" diyenler %50 olasılıkla itiraz imzalar. Kümeler her 50 kararda bir, birikmiş doğrudan oylardan yeniden hesaplanır. Bir blok, ilk turdaki üyelerinin çoğunluğu nihai sonucun tersini istediğinde o kararı **kaybetmiş** sayılır.

| Blok | Basit çoğunluk: kaybetme | KÇ: kaybetme | Basit çoğunluk: istemediği kabul | KÇ: istemediği kabul | Basit çoğunluk: istediği red | KÇ: istediği red |
|---|---|---|---|---|---|---|
| A (%60) | %7,4 | %11,3 | %6,1 | %1,8 | %1,3 | %9,5 |
| B (%30) | %24,6 | %25,7 | %17,8 | %12,0 | %6,6 | %13,4 |
| C (%10) | %50,3 | %49,2 | %41,6 | %35,1 | %6,7 | %12,2 |

Toplam kabul: basit çoğunluk %90,0, KÇ %77,3. KÇ'de ilk tur contested %6,3, geçerli itiraz %25,3, aşma (ω) ile kabul %0,8; ortalama karar süresi 6,6 gün.

**Yorum.** Basit çoğunlukta küçük blok C, istemediği kararların kabul edilmesine en çok maruz kalan bloktur (%41,6). KÇ bu oranı %35,1'e indirir. Bunun karşılığında çoğunluğun istediği bazı kararlar reddedilir (A'nın "istediği red" oranı %1,3 → %9,5). KÇ, kaybetme yükünü bloklar arasında daha dengeli dağıtır. Statüko lehine bir eğilim de getirir: kabul oranı %90,0 → %77,3.

## (h) Kümeleme sağlığı (§9.4 siluet kuralı)

Tohum: `KC-1.0/simulasyon/2026-10|h|*`; her satır 5 tohum, |E| = 300, 40 öneri geçmişi. "Sıfır modeli": her önerinin oyları kullanıcılar arasında rastgele karıştırılır (permütasyon). Bu işlem marjinalleri korur, kişiler arası bağıntıyı yok eder. Aynı boru hattının bu veride verdiği siluet ortalaması (3 permütasyon) raporlanır.

| Nüfus | Bulunan K (tohum başına) | Siluet (ort.) | Sıfır modeli siluet | Fark | Saflık |
|---|---|---|---|---|---|
| 60/30/10 bloklu | 2, 2, 2, 2, 2 | 0,471 | 0,351 | 0,121 | %87,3 |
| Homojen (tek blok) | 3, 2, 3, 3, 3 | 0,357 | 0,352 | 0,006 | — |
| Homojen + güçlü bireysel gürültü | 2, 2, 2, 2, 2 | 0,467 | 0,351 | 0,116 | — |

Homojen nüfuslarda bulunan (sahte) kümelerle alınan 1000 kararda contested oranı %2,4. Sonucun soğuk başlangıç kuralından (K = 1) farklı olduğu kararların oranı %21,3.

**Yorum (önemli bulgu).** k-means'in 2 boyutlu PCA koordinatlarında bulduğu en iyi ortalama siluet, yapısız (tek tepeli) veride de tipik olarak 0,34–0,6 arasındadır. Bu nedenle §9.4'teki "siluet < 0,25 ise K = 1" kuralı neredeyse hiç tetiklenmez. Homojen bir toplulukta gürültüden sahte kümeler oluşur. Bu durumda köprü testi rastgele bölünmüş gruplar arasında uygulanır ve soğuk başlangıçtaki nitelikli çoğunluk (%60) devre dışı kalır. Sahte kümeler benzer tercihlere sahip olduğundan contested oranı düşüktür; asıl etki eşik farkıdır. Gerçek blok yapısı ise sıfır modeline göre belirgin bir siluet farkı üretir. **Öneri (KC-1.1):** K ≥ 2 ancak `siluet − siluet_sıfır ≥ 0,10` ise kabul edilsin. Burada `siluet_sıfır`, aynı tohumdan türetilen birkaç permütasyonun ortalamasıdır. Alternatif olarak mutlak eşik 2 boyut için yeniden ayarlanabilir; ancak tek bir mutlak eşik, gürültü düzeyine göre ya yapıyı kaçırır ya da sahte küme üretir.

## Sınırlılıklar

- Oy modeli bloklar içinde bağımsızdır; stratejik oy, koordineli kampanya ve zaman içinde tercih değişimi modellenmemiştir.
- Uzlaşma turunun ikna etkisi yalnızca (a)'daki bir satırda, varsayılan bir değişiklikle gösterilmiştir. Diğer yeniden oylamalarda tercihler aynıdır (kötümser varsayım).
- Yeter sayı, eşik ve tabanlar ALGORITMA §2 varsayılanlarıdır. Ontoloji denetiminin ürettiği parametreler farklıysa sonuçlar değişir.
- Süre hesapları yalnız oylama, uzatma, itiraz ve uzlaşma evrelerini içerir (destekçi toplama ve tartışma hariç).
