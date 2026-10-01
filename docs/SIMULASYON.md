# Simülasyon Raporu — Köprülü Çoğunluk (KÇ-1.0) ve Basit Çoğunluk

> Bu dosya `npm run sim -w server` (`server/scripts/simulate.ts`) tarafından **üretilir**; elle düzenlemeyin.
> Ana tohum: `KC-1.0/simulasyon/2026-10`. Tüm rastgelelik tohumludur; aynı kod ve tohumla aynı rapor üretilir.

## Özet

- **Çoğunluk tiranlığı:** C'ye (%10) zarar veren önerilerde basit çoğunlukta kabul oranı %100,0. KÇ'de ilk tur kabul oranı yalnızca %9,6, nihai kabul %56,5 (çoğu yeniden oylamada ω = 2/3 ile). B'ye zararlı önerilerde basit çoğunluk %100,0, KÇ nihai %3,4; yalnız A'nın istediği önerilerde %99,7 → %2,3.
- **İyi önerileri engellemiyor:** Geniş destekli önerilerde kabul oranı basit çoğunlukta %100,0, KÇ'de %100,0; zayıf ama ortak destekte %99,2 ve %97,8. Ek bedel, kabul edilen önerilerde itiraz penceresi kadar (T0: 48 saat) gecikmedir; oylamanın başından yürürlüğe kadar toplam süre ortalama 5,3 gündür.
- **Liberum veto yok:** %10'luk blok her öneriye aktif "hayır" deyip itiraz etse de çok popüler öneriler KÇ'de %100,0 oranında yürürlüğe giriyor (ortalama 9,1 gün; saf küme vetosunda %2,8). Aktif muhalefet yalnızca onayı 2/3'ün altında kalan önerileri durdurabiliyor (az farkla popüler: %5,8).
- **Boykot işe yaramıyor:** C boykot ettiğinde nihai kabul %100,0 (bir kez uzatma oranı %12,2); aynı öneriye aktif "hayır" dendiğinde ilk tur contested oranı %91,0.
- **Vekâlet sınırı:** Sınır (15) ile en yüklü delegenin taşıdığı oy ortalama 14,9 (|E| içindeki payı %5,0); sınırsız durumda 24,6 (%8,2). Sınır nedeniyle ortalama 10,0 kişinin oyu yönlendirilemiyor.
- **Kalıcı kaybeden:** Ayrışmış bloklarda C'nin istemediği halde kabul edilen karar oranı basit çoğunlukta %38,1, KÇ'de %27,7. C, B'ye yakın oy verdiğinde ayrı küme olarak bulunamıyor ve koruma zayıflıyor (%38,8 → %32,6). Bedel statüko yönünde: toplam kabul %85,4 → %68,4. Basit çoğunlukta geçip KÇ'de reddedilen kararların %41,7 kadarı itiraz (alarm zili) yolundan geliyor.
- **Kümeleme (r2):** r1'deki "siluet < 0,25 → K = 1" kuralı 2 boyutlu PCA uzayında homojen nüfusta tetiklenmiyordu (r1 ile bulunan K: 3, 4, 5, 4, 3). r2'nin permütasyon sıfır modeliyle homojen nüfusta K: 1, 1, 1, 1, 1; bloklu nüfusta K: 3, 3, 3, 3, 3. Bkz. (h).

## Yöntem

- **Gerçek kod:** Her karar `@forum/shared` içindeki `decide()` ve `evaluateObjection()` ile verilir (KC-1.0, ALGORITMA r2). Kümeler simüle oy geçmişinden `computeClusters()` ile (`pca2-kmeans-silhouette-null/2`), vekâlet `resolveEffectiveVotes()` ile hesaplanır. Basitleştirilmiş bir yeniden uygulama kullanılmaz.
- **Nüfus:** Bloklar A/B/C (%60/%30/%10). Standart nüfus |E| = 300'dür ve üyelerin %5'i yeni üyedir (oy geçmişi yok → kümelenmemiş; genel onaya sayılır, köprüye katılmaz). Her kişinin kalıcı bir eğilimi vardır (logit, N(0; 0,5²)).
- **Oy modeli:** Öneri, blok başına bir logit destek ile tanımlanır. Kişi `katılım` olasılığıyla (varsayılan %55) oy verir; oy verenler arasında çekimser oranı %4. Diğerleri için P(evet) = σ(logit_blok + eğilim + N(0; 0,6²)). Uzatmada, oy vermemiş olanlar katılım × 0,35 olasılıkla geç katılır.
- **Küme anlık görüntüsü:** 60 kapanmış önerilik geçmişten hesaplanır (ortak değer N(0; 0,8²) + bloğa özgü sapma N(0; 2,0²)). Standart nüfus için: K=3, siluet 0,58, saflık %97,9, kümelenmiş 286, dışlanan 0 — g0=168 (blok A), g1=84 (blok B), g2=34 (blok C). Daha zayıf ayrışmış geçmişlerin etkisi (h)'de.
- **Süreç (ALGORITMA §3):** ilk tur → (gerekirse bir kez uzatma) → kabul ise itiraz penceresi (`evaluateObjection`) → geçerli itiraz ya da contested ise uzlaşma + yeniden oylama (uzatma hakkı yenilenir). Yeniden oylamada tercihler, aksi belirtilmedikçe aynı dağılımdan yeniden örneklenir (ikna ya da metin değişikliği etkisi yok). Bu, KÇ için **kötümser** bir varsayımdır.
- **Basit çoğunluk (karşılaştırma):** Aynı ilk tur oyları ve aynı yeter sayı kuralı (`min(|E|, max(⌈q·|E|⌉, ⌈1,5·√|E|⌉))`) kullanılır. Yeter sayı yoksa bir kez uzatılır. Kabul ⇔ evet > hayır. Köprü, itiraz ve yeniden oylama yoktur.
- **≈ onay** sütunu yalnızca yönlendirme amaçlı, yaklaşık beklenen onaydır; asıl oranlar simülasyondan gelir.

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
| C'ye zararlı (A+B evet, C güçlü hayır) | 1,5 / 0,5 / −3,0 | %67 | %100,0 | %9,6 | %90,4 | %0,0 | %56,5 | %37,4 |
| B'ye zararlı (A evet, B güçlü hayır) | 2,0 / −2,5 / 0,5 | %60 | %100,0 | %0,0 | %100,0 | %0,0 | %3,4 | %3,4 |
| B ve C'ye zararlı (yalnız A evet) | 2,5 / −2,0 / −2,5 | %59 | %99,7 | %0,1 | %99,6 | %0,3 | %2,3 | %2,0 |
| C'ye zararlı; uzlaşmada metin yumuşatılır (yeniden oylama: 1,3 / 0,6 / −0,5) | 1,5 / 0,5 / −3,0 | %67 | %100,0 | %10,2 | %89,8 | %0,0 | %96,9 | %2,0 |

**Yorum.** Basit çoğunlukta azınlığa zarar veren önerilerin neredeyse tamamı ilk turda geçer. KÇ'de azınlık kümesinin Laplace desteği tabanın (φ = 0,30) altında kalır; bu yüzden bu öneriler ilk turda **contested** olur ve uzlaşmaya gider. Yeniden oylamada köprü yine sağlanamazsa öneri ancak a ≥ 2/3 (ω) ile geçer. C'ye zararlı önerilerin nihai kabul oranı bu yüzden %56,5 düzeyine iner; aşma eşiğiyle kabul oranı %37,4. B'ye zararlı ve yalnız A'nın istediği önerilerin onayı 2/3'ün altında kaldığı için bu öneriler neredeyse hiç geçmez (%3,4, %2,3). Son satırda uzlaşmada metin azınlığın itirazına göre yumuşatılır ve kabul oranı %96,9 olur. Mekanizmanın amacı önerileri öldürmek değildir; amaç, **azınlığı da kazanan** bir metne zorlamaktır. (İlk turdaki küçük kabul oranı, C kümesinde birkaç C dışı üyenin bulunmasından kaynaklanır; bkz. Yöntem'deki saflık.)

## (b) Köprü kuran (geniş destekli) öneriler

Tohum: `KC-1.0/simulasyon/2026-10|b|*`; her satır 1000 öneri; "hayır" diyenler itirazı %30 olasılıkla imzalar.

| Öneri tipi | Logit A / B / C | ≈ onay | Basit çoğunluk: kabul | KÇ 1. tur kabul | KÇ 1. tur contested | KÇ 1. tur red | KÇ nihai kabul | 1. turda uzatma | Ort. süre (gün) |
|---|---|---|---|---|---|---|---|---|---|
| Geniş destek (herkes ılımlı evet) | 1,2 / 1,0 / 0,8 | %73 | %100,0 | %100,0 | %0,0 | %0,0 | %100,0 | %0,0 | 5,3 |
| Zayıf ama ortak destek | 0,5 / 0,4 / 0,3 | %60 | %99,2 | %98,9 | %0,3 | %0,8 | %97,8 | %0,0 | 5,1 |
| A+B evet, C kararsız | 1,5 / 1,0 / 0,0 | %74 | %100,0 | %99,1 | %0,9 | %0,0 | %100,0 | %0,0 | 5,1 |
| Ortak ret (herkes hayır) | −1,0 / −0,8 / −0,6 | %31 | %0,0 | %0,0 | %0,0 | %100,0 | %0,0 | %0,0 | 3,0 |
| Geniş destek — T1 (nitelikli) | 1,2 / 1,0 / 0,8 | %73 | %100,0 | %99,8 | %0,2 | %0,0 | %100,0 | %0,0 | 7,2 |

**Yorum.** Bütün kümelerin desteklediği önerilerde iki yöntem hemen hemen aynı oranda kabul eder (geniş destek: %100,0 ve %100,0; zayıf ama ortak destek: %99,2 ve %97,8). KÇ iyi önerileri engellemez. Maliyeti, kabul edilen önerilerde itiraz penceresi kadar (T0: 48 saat) gecikmedir. C'nin kararsız kaldığı durumda Laplace yumuşatması C'yi yaklaşık nötr sayar (P ≈ 0,5) ve öneri geçer. Ortak ret durumunda iki yöntem de reddeder. T1'de (eşik %60, taban 0,40) geniş destekli öneriler yine geçer (%100,0); yalnızca süre uzar (7,2 gün).

## (c) Azınlık tiranlığı / liberum veto

Tohum: `KC-1.0/simulasyon/2026-10|c|*`; her satır 500 öneri. C bloğu (%10) **her** öneriye güçlü "hayır" der (logit −4) ve "hayır" diyen her C üyesi itirazı imzalar. "Küme vetosu" sütunu, aşma eşiği ve yeniden oylaması olmayan saf bir eşzamanlı çoğunluk kuralının sonucudur: öneri yalnızca ilk turda her anlamlı kümede P_g ≥ φ ise kabul edilir.

| Öneri tipi | Logit A / B / C | ≈ onay | KÇ 1. tur kabul | KÇ 1. tur contested | Geçerli itiraz | Aşma (ω) ile kabul | KÇ nihai kabul | Küme vetosu: kabul | Ort. süre (gün) |
|---|---|---|---|---|---|---|---|---|---|
| Çok popüler (A, B güçlü evet) | 2,5 / 2,0 / −4,0 | %80 | %2,8 | %97,2 | %2,8 | %90,8 | %100,0 | %2,8 | 9,1 |
| Popüler | 1,5 / 1,0 / −4,0 | %69 | %1,6 | %98,4 | %1,6 | %71,4 | %75,4 | %1,6 | 9,0 |
| Az farkla popüler | 1,0 / 0,3 / −4,0 | %60 | %1,4 | %98,0 | %1,4 | %3,2 | %5,8 | %1,4 | 9,0 |
| Popüler; C bölünmüş (yarısı evet) | 1,5 / 1,0 / 0,0 | %74 | %99,4 | %0,6 | %94,6 | %0,0 | %100,0 | %99,4 | 10,7 |

**Yorum.** %10'luk blok popüler bir öneriyi **süresiz engelleyemez**. Güçlü "hayır" öneriyi bir kez uzlaşmaya gönderir (erteleme). Yeniden oylamada 2/3 eşiği aşılırsa öneri yürürlüğe girer. Çok popüler önerilerde nihai kabul %100,0, popüler önerilerde %75,4 olur; bedeli ortalama 9,1 günlük bir gecikmedir. Uzlaşma turu en fazla bir kez yaşanır ve yeniden oylamadan sonra itiraz yoktur; bu yüzden azınlık aynı öneriyi ikinci kez durduramaz. Saf küme vetosu ise bu önerilerin neredeyse hepsini kalıcı olarak durdururdu (bu üç satırda kabul oranları %2,8, %1,6 ve %1,4). Azınlığın aktif muhalefeti yalnızca onayı 2/3'ün altında kalan önerilerde sonucu değiştirir (az farkla popüler: %5,8). Bu, tasarımın bilinçli bir sonucudur: bir azınlığın güçlü biçimde karşı çıktığı bir karar için nitelikli çoğunluk gerekir. C bölündüğünde öneri ilk turda kabul edilir ve C'nin "hayır" diyenleri itiraz eder (geçerli itiraz %94,6). Yeniden oylamada ρ (%60) ya da güçlü itirazda 2/3 aranır; nihai kabul %100,0.

## (d) Boykot

Tohum: `KC-1.0/simulasyon/2026-10|d|*`; her satır 500 öneri; itiraz yok.

| Senaryo | Basit çoğunluk: kabul | 1. turda uzatma | KÇ 1. tur kabul (uzatma sonrası) | KÇ 1. tur contested | KÇ nihai kabul |
|---|---|---|---|---|---|
| C aktif hayır (katılım %55) | %100,0 | %0,0 | %9,0 | %91,0 | %79,8 |
| C boykot (katılım %0) | %100,0 | %12,2 | %97,4 | %2,6 | %100,0 |
| C neredeyse boykot (katılım %3) | %100,0 | %9,4 | %93,2 | %6,8 | %100,0 |
| C neredeyse boykot — T1 (φ = 0,40) | %100,0 | %6,4 | %87,2 | %12,8 | %100,0 |
| B aktif hayır | %99,8 | %0,0 | %0,0 | %99,8 | %3,6 |
| B boykot | %100,0 | %100,0 | %99,8 | %0,2 | %100,0 |

**Yorum.** Hiç oy vermeyen bir küme için P_g = (1+0)/(2+0) = 1/2 ≥ φ olur. Bu yüzden boykot **bir engel aracı değildir**: nihai kabul oranı C boykot ettiğinde %100,0, B boykot ettiğinde %100,0 olur. Boykot yalnızca anlamlı kümede μ_votes = 2 kabul/red oyu toplanamadığında tek seferlik uzatmayı tetikler (B boykotunda %100,0). C boykotunda bu oran yalnızca %12,2 olur, çünkü C kümesindeki birkaç C dışı üye oy verir ve eşik çoğu zaman yine sağlanır. Azınlık bir kararı ancak *aktif olarak hayır diyerek* durdurabilir (C aktif hayır: contested %91,0). **Nötr küme kuralı (r2):** Uzatmadan sonra bir anlamlı kümede hâlâ μ_votes = 2'den az kabul/red oyu varsa küme nötr sayılır ve köprü tabanından muaf tutulur. r1'de tek bir "hayır" oyu P_g = 1/3 verirdi; bu değer T0 tabanını (0,30) geçer ama T1/T2 tabanının (0,40) altında kalır. Yani neredeyse sessiz bir kümede tek bir kişi kararı ertelemeye zorlayabiliyordu. r2'de bu mümkün değildir. T1 satırında kalan ilk tur contested oranı (%12,8) yalnızca kümede en az iki kabul/red oyu toplanıp P_g'nin tabanın altında kaldığı durumlardan gelir (C kümesindeki birkaç C dışı üye ve az sayıdaki C oyu). Nihai kabul %100,0.

## (e) Küçük topluluklar ve soğuk başlangıç

Tohum: `KC-1.0/simulasyon/2026-10|e|<|E|>|<tekrar>`. Her |E| için 30 farklı geçmiş (60 öneri) ve küme anlık görüntüsü üretilir; her görüntüde öneri tipi başına 40 öneri oylanır. Katılım %65, katman T0. "C'ye zararlı" önerilerde C'nin "hayır" diyenleri itirazı %80 olasılıkla imzalar.

| |E| | Bloklar A/B/C | Gerekli katılım (T0) | floor_abs | Ort. K | Köprü uygulanabilir | C anlamlı kümeyle temsil |
|---|---|---|---|---|---|---|
| 8 | 5/2/1 | 5 | 5 | 1,2 | %0 | %0 |
| 15 | 9/4/2 | 6 | 6 | 1,5 | %27 | %0 |
| 30 | 18/9/3 | 9 | 9 | 2,1 | %53 | %33 |

| |E| | Öneri tipi | Basit çoğunluk: kabul | 1. turda uzatma | KÇ 1. tur kabul | KÇ 1. tur contested | KÇ nihai kabul |
|---|---|---|---|---|---|---|
| 8 | Geniş destek | %69,8 | %29,9 | %66,8 | %0,0 | %66,8 |
| 8 | Dar çoğunluk | %42,5 | %32,9 | %39,3 | %0,0 | %39,3 |
| 8 | C'ye zararlı | %63,5 | %28,3 | %59,3 | %0,0 | %59,3 |
| 15 | Geniş destek | %89,5 | %5,5 | %82,9 | %0,5 | %83,3 |
| 15 | Dar çoğunluk | %55,2 | %5,8 | %42,0 | %1,5 | %42,5 |
| 15 | C'ye zararlı | %77,9 | %4,7 | %67,9 | %0,9 | %68,2 |
| 30 | Geniş destek | %97,8 | %9,8 | %91,8 | %2,8 | %94,4 |
| 30 | Dar çoğunluk | %67,2 | %10,7 | %47,0 | %7,8 | %51,2 |
| 30 | C'ye zararlı | %93,8 | %10,4 | %65,1 | %21,9 | %78,8 |

**Yorum.** Küçük gruplarda mutlak taban `floor_abs = ⌈1,5·√|E|⌉` q·|E|'den büyüktür (|E| = 8 için 5 kişi, yani %62,5 katılım). Bu yüzden |E| = 8'de belirleyici kısıt yeter sayıdır: geniş destekli öneriler bile iki yöntemde de yalnızca %69,8 / %66,8 oranında geçer. Gerekli katılımın |E|'yi aşmaması kuralı sayesinde kabul her zaman mümkündür. |E| = 8'de n_C < 12 olduğundan köprü testi hiç uygulanmaz (soğuk başlangıç). T0 eşiği %60'a yükselir ve `≥` ile karşılaştırılır; dar çoğunluklu önerilerde kabul %42,5 → %39,3 olur. |E| = 15'te C bloğu 2 kişidir ve σ_min = 3 nedeniyle tek başına anlamlı küme olamaz (anlamlı bir kümeyle temsil oranı %0,0). Küçük gruplarda r2'nin sıfır modeli de temkinlidir: az kişiyle siluet rastgele veride de yüksek çıkabildiği için küme yapısı ancak belirginse kabul edilir. Köprü testinin uygulanabildiği tekrarların oranı |E| = 15'te %26,7, |E| = 30'da %53,3 olur; diğer tekrarlarda soğuk başlangıç kuralı (%60, `≥`) geçerlidir. |E| = 30'da C (3 kişi, %10) sınırda anlamlıdır ve ayrı bir anlamlı kümeyle temsil edildiği tekrarların oranı %33,3 olur. Bu tekrarlarda KÇ, C'ye zararlı önerileri contested yapar (genel oran %21,9; nihai kabul %93,8 → %78,8). Küçük gruplarda azınlığın korunması büyük ölçüde soğuk başlangıçtaki nitelikli çoğunluğa ve itiraz kuralına kalır.

## (f) Vekâlet yoğunlaşması ve sınır (cap)

Tohum: `KC-1.0/simulasyon/2026-10|f`; standart nüfus; 300 karışık öneri; doğrudan katılım %30 (ünlü delegeler %95). Üyelerin ~%60'ı vekâlet verir: bunların %70'i Zipf ağırlıklı 15 "ünlü" delegeden birini seçer (12'si A, 2'si B, 1'i C), %15'i kendi bloğundaki bir ünlüyü, %15'i rastgele bir üyeyi (zincirler oluşur). Kapsam "*", H = 3. Sınır: cap = max(2, ⌈0,05·300⌉) = 15.

| Durum | En yüklü delege (ort.) | En yüklü / |E| | Delege yükü Gini | Yönlendirilemeyen (ort.) | Etkin katılım | KÇ 1. tur kabul | KÇ 1. tur contested |
|---|---|---|---|---|---|---|---|
| Sınır = 15 | 14,9 | %5,0 | 0,45 | 10,0 | %65,0 | %47,0 | %1,0 |
| Sınırsız | 24,6 | %8,2 | 0,49 | 0,0 | %68,3 | %47,0 | %0,7 |

**Yorum.** Sınır olmadan en yüklü delegenin |E| içindeki payı %8,2 olur; sınırla bu pay %5,0 ile sınırlı kalır. Sınırı aşan ortalama 10,0 kişinin oyu kullanılmaz ve bu kişilere bildirim gider; ya doğrudan oy vermeleri ya da başka bir delege seçmeleri gerekir. Sınır yüzünden sonucu değişen önerilerin oranı: %4,0. Vekâletle gelen oy **delegatörün kendi kümesine** sayılır. Ancak bu senaryoda (kurgu gereği) C üyelerinin verdiği vekâletlerde C dışındaki delegelere gidenlerin oranı %77,8. Bu durumda C kümesine sayılan "oy", aslında başka bir bloğun delegesinin tercihidir. Köprü testi kümeyi korur, ancak C'nin kendi tercihini değil, C üyelerinin seçtiği delegelerin tercihini ölçer. Bu ödünleşim kullanıcıya vekâlet verirken açıkça gösterilmelidir.

## (g) Kalıcı kaybeden

Tohum: `KC-1.0/simulasyon/2026-10|g|<değişke>|<tekrar>`. Her değişke için 8 bağımsız tekrar × 200 karar = 1600 karar; standart nüfus yapısı; T0. Öneri akışının %25'i ortak yarar önerisidir (bütün bloklar benzer ve olumlu). %75'ini bir blok yazar (yazar blok büyüklüğüyle orantılı seçilir, yazarın bloğu güçlü evet der). Diğer blokların tutumu bir yakınlık matrisiyle (A–B +0,2, A–C −0,6, B–C +0,4) ve bloğa özgü gürültüyle belirlenir. "Hayır" diyenler itirazı %50 olasılıkla imzalar. Kümeler başlangıçta 60 önerilik geçmişten, sonra her 100 kararda bir birikmiş doğrudan oylardan yeniden hesaplanır. Bir blok, ilk turdaki üyelerinin çoğunluğu nihai sonucun tersini istediğinde o kararı **kaybetmiş** sayılır.

### Ayrışmış bloklar (bloğa özgü gürültü 1,5)

| Blok | Basit çoğunluk: kaybetme | KÇ: kaybetme | Basit çoğunluk: istemediği kabul | KÇ: istemediği kabul | Basit çoğunluk: istediği red | KÇ: istediği red |
|---|---|---|---|---|---|---|
| A (%60) | %7,7 | %16,5 | %5,6 | %1,7 | %2,1 | %14,8 |
| B (%30) | %27,4 | %24,7 | %18,1 | %8,4 | %9,1 | %16,1 |
| C (%10) | %48,7 | %44,0 | %38,1 | %27,7 | %9,1 | %14,9 |

Küme anlık görüntüleri (16 adet): ortalama K 2,69, saflık %91,3, C'nin anlamlı bir kümeyle temsil edildiği görüntü oranı %68,8. Toplam kabul: basit çoğunluk %85,4, KÇ %68,4. KÇ'de ilk tur contested %17,2, geçerli itiraz %19,9, aşma (ω) ile kabul %3,8; ortalama karar süresi 6,6 gün. Basit çoğunlukta geçip KÇ'de reddedilen karar sayısı: 271 (itiraz sonrası yeniden oylamada ρ = %60 ile: 113; contested sonrası yeniden oylamada: 137; ilk turda: 21).

### C, B'ye yakın (bloğa özgü gürültü 1,0)

| Blok | Basit çoğunluk: kaybetme | KÇ: kaybetme | Basit çoğunluk: istemediği kabul | KÇ: istemediği kabul | Basit çoğunluk: istediği red | KÇ: istediği red |
|---|---|---|---|---|---|---|
| A (%60) | %8,0 | %11,8 | %7,2 | %2,4 | %0,8 | %9,4 |
| B (%30) | %22,6 | %26,1 | %15,1 | %10,1 | %7,4 | %15,9 |
| C (%10) | %47,8 | %48,6 | %38,8 | %32,6 | %7,7 | %14,7 |

Küme anlık görüntüleri (16 adet): ortalama K 1,88, saflık %81,2, C'nin anlamlı bir kümeyle temsil edildiği görüntü oranı %12,5. Toplam kabul: basit çoğunluk %89,0, KÇ %75,4. KÇ'de ilk tur contested %4,0, geçerli itiraz %18,6, aşma (ω) ile kabul %0,0; ortalama karar süresi 6,0 gün. Basit çoğunlukta geçip KÇ'de reddedilen karar sayısı: 218 (itiraz sonrası yeniden oylamada ρ = %60 ile: 126; contested sonrası yeniden oylamada: 38; ilk turda: 54).

**Yorum.** Basit çoğunlukta küçük blok C, istemediği kararların kabul edilmesine en çok maruz kalan bloktur (%38,1). C ayrı bir görüş kümesi olarak bulunduğunda KÇ'de bu oran %27,7 olur. C'nin oyları B'ye yakın olduğunda C ayrı küme olarak çoğu zaman bulunamaz; bu durumda koruma büyük ölçüde itiraz kuralına kalır ve daha zayıftır (%38,8 → %32,6). Bunun karşılığında çoğunluğun istediği bazı kararlar reddedilir (A'nın "istediği red" oranı %2,1 → %14,8). KÇ kaybetme yükünü bloklar arasında daha dengeli dağıtır ama statüko lehine bir eğilim de getirir (toplam kabul %85,4 → %68,4). Kırılıma göre basit çoğunlukta geçip KÇ'de reddedilen kararların %41,7 (ayrışmış) ve %57,8 (yakın) kadarı itiraz yolundan gelir. "İlk turda" düşenler, anlık görüntünün K = 1 bulduğu (soğuk başlangıç, eşik %60) dönemlerdeki %50–60 onaylı önerilerdir. |E| = 300'de kural (b) için ⌈0,10·|E|⌉ = 30 imza ve iki küme yeterlidir. "Hayır" oyu %40 civarında olan ve kaybedenlerin motive olduğu bir öneri bu eşiğe kolayca ulaşır ve yeniden oylamada ρ = %60 aranır. Fiilen, tartışmalı T0 kararları için eşik %50'den %60'a çıkar.

## (h) Kümeleme sağlığı (§9.4 siluet kuralı)

Tohum: `KC-1.0/simulasyon/2026-10|h|*`; her satır 5 tohum, |E| = 300. Aynı oy geçmişi iki kuralla kümelenir. r1, ALGORITMA §9'un ilk sürümüdür: en iyi siluet ≥ 0,25 ise K ≥ 2. r2 (`pca2-kmeans-silhouette-null/2`) buna ek olarak `siluet − siluet_sıfır ≥ 0,10` koşulunu arar. "Sıfır modeli"nde her önerinin oyları, o öneriye oy vermiş kullanıcılar arasında tohumlu olarak karıştırılır (5 permütasyon). Bu işlem marjinalleri korur ama kişiler arası bağıntıyı yok eder. "Aday siluet", eşiklerden önceki en iyi K'nın siluetidir.

| Nüfus | K — r1 (yalnız siluet ≥ 0,25) | K — r2 (+ sıfır modeli) | Aday siluet (ort.) | Sıfır modeli siluet | Fark | Saflık (r2) | C anlamlı kümeyle temsil (r2) |
|---|---|---|---|---|---|---|---|
| 60/30/10, belirgin ayrışma (sapma 2,0; 60 öneri) | 3, 3, 3, 3, 3 | 3, 3, 3, 3, 3 | 0,616 | 0,352 | 0,264 | %98,6 | 5/5 |
| 60/30/10, zayıf ayrışma (sapma 1,6; 40 öneri) | 2, 3, 2, 2, 3 | 1, 3, 2, 2, 3 | 0,494 | 0,352 | 0,142 | %84,3 | 2/5 |
| Homojen (tek blok) | 3, 4, 5, 4, 3 | 1, 1, 1, 1, 1 | 0,347 | 0,349 | −0,002 | — | — |
| Homojen + güçlü bireysel eğilim (σ = 1,5) | 2, 2, 2, 2, 2 | 2, 2, 2, 2, 2 | 0,484 | 0,350 | 0,135 | — | — |

Tek bloklu nüfuslarda her iki anlık görüntüyle aynı oylarla kararlar alındı (rastgele öneriler, T0). "Soğuk başlangıçtan farklı": sonucun, K = 1 olsaydı (eşik %60, `≥`) çıkacak sonuçtan farklı olduğu kararların oranı.

| Nüfus | Karar | r1: contested | r1: soğuk başlangıçtan farklı | r2: contested | r2: soğuk başlangıçtan farklı |
|---|---|---|---|---|---|
| Homojen (tek blok) | 500 | %0,0 | %20,2 | %0,0 | %0,0 |
| Homojen + güçlü bireysel eğilim (σ = 1,5) | 500 | %3,0 | %25,8 | %3,0 | %25,8 |

**Yorum.** k-means'in 2 boyutlu PCA koordinatlarında bulduğu en iyi ortalama siluet, yapısız (tek tepeli) veride de tipik olarak 0,34–0,6 arasındadır. Bu yüzden r1'deki "siluet < 0,25 ise K = 1" kuralı neredeyse hiç tetiklenmiyordu. Homojen bir toplulukta gürültüden sahte kümeler oluşuyor, köprü testi rastgele bölünmüş gruplar arasında uygulanıyor ve soğuk başlangıçtaki nitelikli çoğunluk (%60) devre dışı kalıyordu. Sahte kümelerin tercihleri birbirine benzediği için contested oranı düşüktü; asıl etki eşik farkıydı. Sıfır modeli bu durumu ayırt eder: homojen veride aday siluet sıfır modelininkine çok yakındır ve r2 K = 1 bulur. Gerçek blok yapısında fark belirgindir ve kümeler korunur. **Kalan sınırlılıklar:** (1) Güçlü bireysel eğilimler ("hep evet" / "hep hayır" diyenler) tek blok içinde de gerçek bir yapı üretir ve r2 bunu küme olarak kabul edebilir. Bu yapı gerçek ama ideolojik değildir. (2) Zayıf ayrışmış geçmişte %10'luk blok çoğu zaman ayrı bir küme olarak bulunamaz ve köprü korumasından yararlanamaz; azınlığın korunması bu durumda itiraz kuralına kalır.

## Tasarım için çıkarımlar

1. **Siluet kuralı (§9.4)** amaçladığı "yapı yoksa K = 1" davranışını 2 boyutta sağlamıyordu. **r2'de uygulandı:** permütasyon sıfır modeli (bkz. h).
2. **İtiraz kuralı (b)** büyük topluluklarda kolay sağlanıyor ve tartışmalı T0 kararlarında fiilen %60 eşiği getiriyor (bkz. g). ALGORITMA §6'da bunun **bilinçli bir tercih** olduğu not edildi: itiraz yalnızca erteleyici ve tek seferliktir. Statüko eğilimi azaltılmak istenirse imza eşiği (ör. kaybeden tarafın belli bir oranı) yeniden ayarlanabilir.
3. **T1/T2'de tek "hayır"** neredeyse sessiz bir kümede contested sonucunu tetikleyebiliyordu (P_g = 1/3 < 0,40). **r2'de uygulandı:** uzatma sonrası μ_votes altında kalan küme nötr sayılır ve köprüden muaftır (bkz. d). DEL'deki yazar kümesi koruması bu muafiyetin dışında tutuldu.
4. **Vekâlet ve küme:** Vekâletle gelen oy delegatörün kümesine sayılır. Kümeler arası vekâlet, azınlık kümesinin desteğini başka bir bloğun delegesine bağlayabilir (bkz. f).
5. **Küçük topluluklar:** |E| < ~30'da yeter sayı ve soğuk başlangıç belirleyicidir; köprü koruması ancak azınlık en az σ_min = 3 kişilik ayrı bir küme oluşturduğunda devreye girer (bkz. e).

## Sınırlılıklar

- Oy modeli bloklar içinde bağımsızdır. Stratejik oy, koordineli kampanya ve zaman içinde tercih değişimi modellenmemiştir.
- Uzlaşma turunun ikna etkisi yalnızca (a)'daki bir satırda, varsayılan bir değişiklikle gösterilmiştir. Diğer yeniden oylamalarda tercihler aynıdır (kötümser varsayım).
- Yeter sayı, eşik ve tabanlar ALGORITMA §2 varsayılanlarıdır. Ontoloji denetiminin ürettiği parametreler farklıysa sonuçlar değişir.
- Süre hesapları yalnızca oylama, uzatma, itiraz ve uzlaşma evrelerini içerir (destekçi toplama ve tartışma hariç).
