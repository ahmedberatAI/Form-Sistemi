# Simülasyon Raporu — Köprülü Çoğunluk (KÇ-1.0) ve Basit Çoğunluk

> Bu dosya `npm run sim -w server` (`server/scripts/simulate.ts`) tarafından **üretilir**; elle düzenlemeyin.
> Ana tohum: `KC-1.0/simulasyon/2026-10`. Tüm rastgelelik tohumludur; aynı kod ve tohumla aynı rapor üretilir.

## Özet

- **Çoğunluk tiranlığı:** C'ye (%10) zarar veren önerilerde basit çoğunlukta kabul oranı %100,0. KÇ'de ilk tur kabul oranı yalnızca %9,6, nihai kabul %56,5 (çoğu yeniden oylamada ω = 2/3 ile). B'ye zararlı önerilerde basit çoğunluk %100,0, KÇ nihai %3,4; yalnız A'nın istediği önerilerde %99,7 → %2,3.
- **İyi önerileri engellemiyor:** Geniş destekli önerilerde kabul oranı basit çoğunlukta %100,0, KÇ'de %100,0; zayıf ama ortak destekte %99,2 ve %97,8. Bedeli itiraz penceresi kadar gecikmedir (ortalama 5,3 gün).
- **Liberum veto yok:** %10'luk blok her öneriye aktif "hayır" deyip itiraz etse de çok popüler öneriler KÇ'de %100,0 oranında yürürlüğe giriyor (ortalama 9,1 gün; saf küme vetosunda %2,8). Aktif muhalefet yalnızca onayı 2/3'ün altında kalan önerileri durdurabiliyor (az farkla popüler: %5,8).
- **Boykot işe yaramıyor:** C boykot ettiğinde nihai kabul %100,0 (bir kez uzatma oranı %12,2); aynı öneriye aktif "hayır" dendiğinde ilk tur contested oranı %91,0.
- **Vekâlet sınırı:** Sınır (15) ile en yüklü delegenin taşıdığı oy ortalama 14,9 (|E| içindeki payı %5,0); sınırsız durumda 24,6 (%8,2). Sınır nedeniyle ortalama 10,0 kişinin oyu yönlendirilemiyor.
- **Kalıcı kaybeden:** Ayrışmış bloklarda C'nin istemediği halde kabul edilen karar oranı basit çoğunlukta %36,2, KÇ'de %26,4. C, B'ye yakın oy verdiğinde ayrı küme olarak bulunamıyor ve koruma zayıflıyor (%41,1 → %34,8). Bedel statüko yönünde: toplam kabul %83,3 → %65,7. Basit çoğunlukta geçip KÇ'de reddedilen kararların %54,3 kadarı itiraz (alarm zili) yolundan geliyor.
- **Kümeleme uyarısı:** §9.4'teki "siluet < 0,25 → K = 1" kuralı 2 boyutlu PCA uzayında homojen nüfusta tetiklenmiyor (bulunan K: 3, 4, 5, 4, 3). Zayıf ayrışmış geçmişte %10'luk blok ayrı küme olarak bulunamayabiliyor. Bkz. (h).

## Yöntem

- **Gerçek kod:** Her karar `@forum/shared` içindeki `decide()` ve `evaluateObjection()` ile verilir. Kümeler simüle oy geçmişinden `computeClusters()` ile, vekâlet `resolveEffectiveVotes()` ile hesaplanır. Basitleştirilmiş bir yeniden uygulama kullanılmaz.
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
| C neredeyse boykot — T1 (φ = 0,40) | %100,0 | %7,4 | %88,8 | %11,2 | %100,0 |
| B aktif hayır | %99,8 | %0,0 | %0,0 | %99,8 | %3,6 |
| B boykot | %100,0 | %100,0 | %99,8 | %0,2 | %100,0 |

**Yorum.** Hiç oy vermeyen bir küme için P_g = (1+0)/(2+0) = 1/2 ≥ φ olur. Bu yüzden boykot **bir engel aracı değildir**: nihai kabul oranı C boykot ettiğinde %100,0, B boykot ettiğinde %100,0 olur. Boykot yalnızca anlamlı kümede μ_votes = 2 kabul/red oyu toplanamadığında tek seferlik uzatmayı tetikler (B boykotunda %100,0). C boykotunda bu oran yalnızca %12,2 olur, çünkü C kümesindeki birkaç C dışı üye oy verir ve eşik çoğu zaman yine sağlanır. Azınlık bir kararı ancak *aktif olarak hayır diyerek* durdurabilir (C aktif hayır: contested %91,0). **Dikkat (T1/T2):** Bir kümede yalnızca tek bir "hayır" oyu varsa P_g = 1/3 olur. Bu değer T0 tabanını (0,30) geçer ama T1/T2 tabanının (0,40) altında kalır. Bu nedenle neredeyse tamamen sessiz kalan bir kümede tek bir kişi contested sonucunu tetikleyebilir (T1 satırında ilk tur contested %11,2). Etki erteleyicidir: bir uzlaşma turu açılır, sonra ω uygulanır (nihai kabul %100,0).

## (e) Küçük topluluklar ve soğuk başlangıç

Tohum: `KC-1.0/simulasyon/2026-10|e|<|E|>|<tekrar>`. Her |E| için 30 farklı geçmiş (60 öneri) ve küme anlık görüntüsü üretilir; her görüntüde öneri tipi başına 40 öneri oylanır. Katılım %65, katman T0. "C'ye zararlı" önerilerde C'nin "hayır" diyenleri itirazı %80 olasılıkla imzalar.

| |E| | Bloklar A/B/C | Gerekli katılım (T0) | floor_abs | Ort. K | Köprü uygulanabilir | C anlamlı kümeyle temsil |
|---|---|---|---|---|---|---|
| 8 | 5/2/1 | 5 | 5 | 1,9 | %0 | %0 |
| 15 | 9/4/2 | 6 | 6 | 2,8 | %100 | %17 |
| 30 | 18/9/3 | 9 | 9 | 3,0 | %100 | %47 |

| |E| | Öneri tipi | Basit çoğunluk: kabul | 1. turda uzatma | KÇ 1. tur kabul | KÇ 1. tur contested | KÇ nihai kabul |
|---|---|---|---|---|---|---|
| 8 | Geniş destek | %69,8 | %29,9 | %66,8 | %0,0 | %66,8 |
| 8 | Dar çoğunluk | %42,5 | %32,9 | %39,3 | %0,0 | %39,3 |
| 8 | C'ye zararlı | %63,5 | %28,3 | %59,3 | %0,0 | %59,3 |
| 15 | Geniş destek | %90,7 | %22,5 | %86,6 | %4,3 | %90,5 |
| 15 | Dar çoğunluk | %55,4 | %23,3 | %49,9 | %5,8 | %52,6 |
| 15 | C'ye zararlı | %80,0 | %23,0 | %73,2 | %7,5 | %76,6 |
| 30 | Geniş destek | %98,1 | %14,5 | %94,2 | %4,1 | %98,0 |
| 30 | Dar çoğunluk | %66,9 | %15,2 | %55,3 | %12,0 | %61,3 |
| 30 | C'ye zararlı | %94,3 | %14,8 | %64,0 | %29,9 | %83,2 |

**Yorum.** Küçük gruplarda mutlak taban `floor_abs = ⌈1,5·√|E|⌉` q·|E|'den büyüktür (|E| = 8 için 5 kişi, yani %62,5 katılım). Bu yüzden |E| = 8'de belirleyici kısıt yeter sayıdır: geniş destekli öneriler bile iki yöntemde de yalnızca %69,8 / %66,8 oranında geçer. Gerekli katılımın |E|'yi aşmaması kuralı sayesinde kabul her zaman mümkündür. |E| = 8'de n_C < 12 olduğundan köprü testi hiç uygulanmaz (soğuk başlangıç). T0 eşiği %60'a yükselir ve `≥` ile karşılaştırılır; dar çoğunluklu önerilerde kabul %42,5 → %39,3 olur. |E| = 15'te C bloğu 2 kişidir ve σ_min = 3 nedeniyle tek başına anlamlı küme olamaz. Yalnızca başka bir üyeyle aynı kümeye düştüğünde temsil edilir (%16,7). |E| = 30'da C (3 kişi, %10) sınırda anlamlıdır ve ayrı bir kümeyle temsil edildiği tekrarların oranı %46,7 olur. Bu tekrarlarda KÇ, C'ye zararlı önerileri contested yapar (genel oran %29,9; nihai kabul %94,3 → %83,2). Küçük gruplarda azınlığın korunması büyük ölçüde soğuk başlangıçtaki nitelikli çoğunluğa ve itiraz kuralına kalır.

## (f) Vekâlet yoğunlaşması ve sınır (cap)

Tohum: `KC-1.0/simulasyon/2026-10|f`; standart nüfus; 300 karışık öneri; doğrudan katılım %30 (ünlü delegeler %95). Üyelerin ~%60'ı vekâlet verir: bunların %70'i Zipf ağırlıklı 15 "ünlü" delegeden birini seçer (12'si A, 2'si B, 1'i C), %15'i kendi bloğundaki bir ünlüyü, %15'i rastgele bir üyeyi (zincirler oluşur). Kapsam "*", H = 3. Sınır: cap = max(2, ⌈0,05·300⌉) = 15.

| Durum | En yüklü delege (ort.) | En yüklü / |E| | Delege yükü Gini | Yönlendirilemeyen (ort.) | Etkin katılım | KÇ 1. tur kabul | KÇ 1. tur contested |
|---|---|---|---|---|---|---|---|
| Sınır = 15 | 14,9 | %5,0 | 0,45 | 10,0 | %65,0 | %47,0 | %1,0 |
| Sınırsız | 24,6 | %8,2 | 0,49 | 0,0 | %68,3 | %47,0 | %0,7 |

**Yorum.** Sınır olmadan en yüklü delegenin |E| içindeki payı %8,2 olur; sınırla bu pay %5,0 ile sınırlı kalır. Sınırı aşan ortalama 10,0 kişinin oyu kullanılmaz ve bu kişilere bildirim gider; ya doğrudan oy vermeleri ya da başka bir delege seçmeleri gerekir. Sınır yüzünden sonucu değişen önerilerin oranı: %4,0. Vekâletle gelen oy **delegatörün kendi kümesine** sayılır. Ancak bu senaryoda (kurgu gereği) C üyelerinin verdiği vekâletlerde C dışındaki delegelere gidenlerin oranı %77,8. Bu durumda C kümesine sayılan "oy", aslında başka bir bloğun delegesinin tercihidir. Köprü testi kümeyi korur, ancak C'nin kendi tercihini değil, C üyelerinin seçtiği delegelerin tercihini ölçer. Bu ödünleşim kullanıcıya vekâlet verirken açıkça gösterilmelidir.

## (g) Kalıcı kaybeden

Tohum: `KC-1.0/simulasyon/2026-10|g|<değişke>|<tekrar>`. Her değişke için 8 bağımsız tekrar × 200 karar = 1600 karar; standart nüfus yapısı; T0. Öneri akışının %25'i ortak yarar önerisidir (bütün bloklar benzer ve olumlu). %75'ini bir blok yazar (yazar blok büyüklüğüyle orantılı seçilir, yazarın bloğu güçlü evet der). Diğer blokların tutumu bir yakınlık matrisiyle (A–B +0,2, A–C −0,6, B–C +0,4) ve bloğa özgü gürültüyle belirlenir. "Hayır" diyenler itirazı %50 olasılıkla imzalar. Kümeler başlangıçta 60 önerilik geçmişten, sonra her 50 kararda bir birikmiş doğrudan oylardan yeniden hesaplanır. Bir blok, ilk turdaki üyelerinin çoğunluğu nihai sonucun tersini istediğinde o kararı **kaybetmiş** sayılır.

### Ayrışmış bloklar (bloğa özgü gürültü 1,5)

| Blok | Basit çoğunluk: kaybetme | KÇ: kaybetme | Basit çoğunluk: istemediği kabul | KÇ: istemediği kabul | Basit çoğunluk: istediği red | KÇ: istediği red |
|---|---|---|---|---|---|---|
| A (%60) | %9,0 | %18,1 | %6,4 | %2,3 | %2,6 | %15,8 |
| B (%30) | %28,3 | %26,5 | %17,1 | %7,5 | %11,0 | %18,8 |
| C (%10) | %48,7 | %45,9 | %36,2 | %26,4 | %10,7 | %17,8 |

Küme anlık görüntüleri (32 adet): ortalama K 2,69, saflık %93,3, C'nin anlamlı bir kümeyle temsil edildiği görüntü oranı %59,4. Toplam kabul: basit çoğunluk %83,3, KÇ %65,7. KÇ'de ilk tur contested %14,6, geçerli itiraz %22,9, aşma (ω) ile kabul %2,6; ortalama karar süresi 6,6 gün. Basit çoğunlukta geçip KÇ'de reddedilen karar sayısı: 282 (itiraz sonrası yeniden oylamada ρ = %60 ile: 153; contested sonrası yeniden oylamada: 129; ilk turda: 0).

### C, B'ye yakın (bloğa özgü gürültü 1,0)

| Blok | Basit çoğunluk: kaybetme | KÇ: kaybetme | Basit çoğunluk: istemediği kabul | KÇ: istemediği kabul | Basit çoğunluk: istediği red | KÇ: istediği red |
|---|---|---|---|---|---|---|
| A (%60) | %8,5 | %12,3 | %7,8 | %2,6 | %0,8 | %9,7 |
| B (%30) | %25,2 | %27,8 | %18,6 | %12,9 | %6,3 | %14,4 |
| C (%10) | %49,7 | %50,8 | %41,1 | %34,8 | %6,9 | %14,3 |

Küme anlık görüntüleri (32 adet): ortalama K 2,13, saflık %88,1, C'nin anlamlı bir kümeyle temsil edildiği görüntü oranı %12,5. Toplam kabul: basit çoğunluk %90,4, KÇ %76,3. KÇ'de ilk tur contested %5,3, geçerli itiraz %26,4, aşma (ω) ile kabul %0,3; ortalama karar süresi 6,6 gün. Basit çoğunlukta geçip KÇ'de reddedilen karar sayısı: 227 (itiraz sonrası yeniden oylamada ρ = %60 ile: 173; contested sonrası yeniden oylamada: 54; ilk turda: 0).

**Yorum.** Basit çoğunlukta küçük blok C, istemediği kararların kabul edilmesine en çok maruz kalan bloktur (%36,2). C ayrı bir görüş kümesi olarak bulunduğunda KÇ'de bu oran %26,4 olur. C'nin oyları B'ye yakın olduğunda C ayrı küme olarak çoğu zaman bulunamaz; bu durumda koruma büyük ölçüde itiraz kuralına kalır ve daha zayıftır (%41,1 → %34,8). Bunun karşılığında çoğunluğun istediği bazı kararlar reddedilir (A'nın "istediği red" oranı %2,6 → %15,8). KÇ kaybetme yükünü bloklar arasında daha dengeli dağıtır ama statüko lehine bir eğilim de getirir (toplam kabul %83,3 → %65,7). Kırılıma göre basit çoğunlukta geçip KÇ'de reddedilen kararların %54,3 (ayrışmış) ve %76,2 (yakın) kadarı itiraz yolundan gelir. |E| = 300'de kural (b) için ⌈0,10·|E|⌉ = 30 imza ve iki küme yeterlidir. "Hayır" oyu %40 civarında olan ve kaybedenlerin motive olduğu bir öneri bu eşiğe kolayca ulaşır ve yeniden oylamada ρ = %60 aranır. Fiilen, tartışmalı T0 kararları için eşik %50'den %60'a çıkar.

## (h) Kümeleme sağlığı (§9.4 siluet kuralı)

Tohum: `KC-1.0/simulasyon/2026-10|h|*`; her satır 5 tohum, |E| = 300. "Sıfır modeli"nde her önerinin oyları kullanıcılar arasında rastgele karıştırılır (permütasyon). Bu işlem marjinalleri korur ama kişiler arası bağıntıyı yok eder. Tabloda aynı boru hattının bu veride verdiği siluet ortalaması (3 permütasyon) gösterilir.

| Nüfus | Bulunan K (tohum başına) | Siluet (ort.) | Sıfır modeli siluet | Fark | Saflık | C anlamlı kümeyle temsil |
|---|---|---|---|---|---|---|
| 60/30/10, belirgin ayrışma (sapma 2,0; 60 öneri) | 3, 3, 3, 3, 3 | 0,616 | 0,349 | 0,267 | %98,6 | 5/5 |
| 60/30/10, zayıf ayrışma (sapma 1,6; 40 öneri) | 2, 3, 2, 2, 3 | 0,494 | 0,352 | 0,142 | %89,4 | 2/5 |
| Homojen (tek blok) | 3, 4, 5, 4, 3 | 0,347 | 0,349 | −0,002 | — | — |
| Homojen + güçlü bireysel eğilim (σ = 1,5) | 2, 2, 2, 2, 2 | 0,484 | 0,350 | 0,135 | — | — |

Homojen nüfuslarda bulunan (sahte) kümelerle 1000 karar alındı. Contested oranı %1,5; sonucun soğuk başlangıç kuralının (K = 1) vereceği sonuçtan farklı olduğu kararların oranı %23,0.

**Yorum (önemli bulgu).** k-means'in 2 boyutlu PCA koordinatlarında bulduğu en iyi ortalama siluet, yapısız (tek tepeli) veride de tipik olarak 0,34–0,6 arasındadır. Bu yüzden §9.4'teki "siluet < 0,25 ise K = 1" kuralı neredeyse hiç tetiklenmez. Homojen bir toplulukta gürültüden sahte kümeler oluşur. Köprü testi rastgele bölünmüş gruplar arasında uygulanır ve soğuk başlangıçtaki nitelikli çoğunluk (%60) devre dışı kalır. Sahte kümelerin tercihleri birbirine benzediği için contested oranı düşüktür; asıl etki eşik farkıdır. Gerçek blok yapısı ise sıfır modeline göre belirgin bir siluet farkı üretir. Güçlü bireysel eğilimler de (tek blok içinde) bir fark üretir; bu, gerçek ama ideolojik olmayan bir yapıdır ("hep evet" / "hep hayır" diyenler). Zayıf ayrışmış geçmişte %10'luk blok çoğu zaman ayrı bir küme olarak bulunamaz ve köprü korumasından yararlanamaz. **Öneri (KC-1.1):** K ≥ 2 yalnızca `siluet − siluet_sıfır ≥ 0,10` ise kabul edilsin; `siluet_sıfır`, aynı tohumdan türetilen birkaç permütasyonun ortalaması olsun. Mutlak eşik 2 boyut için yeniden ayarlanabilir, ancak tek bir mutlak eşik gürültü düzeyine göre ya gerçek yapıyı kaçırır ya da sahte küme üretir.

## Tasarım için çıkarımlar

1. **Siluet kuralı (§9.4)** amaçladığı "yapı yoksa K = 1" davranışını 2 boyutta sağlamıyor (bkz. h). Permütasyon sıfır modeli ya da benzeri bir yapı testi önerilir.
2. **İtiraz kuralı (b)** büyük topluluklarda kolay sağlanıyor ve tartışmalı T0 kararlarında fiilen %60 eşiği getiriyor (bkz. g). Bu bilinçli bir tercih değilse imza eşiği (ör. kaybeden tarafın belli bir oranı) yeniden değerlendirilmeli.
3. **T1/T2'de tek "hayır"** neredeyse sessiz bir kümede contested sonucunu tetikleyebiliyor (P_g = 1/3 < 0,40; bkz. d). Uzatma sonrası eksik kalan kümenin köprüden muaf tutulması ya da μ_votes'un yalnız tetikleyici değil taban koşulu olarak da kullanılması değerlendirilebilir.
4. **Vekâlet ve küme:** Vekâletle gelen oy delegatörün kümesine sayılır. Kümeler arası vekâlet, azınlık kümesinin desteğini başka bir bloğun delegesine bağlayabilir (bkz. f).
5. **Küçük topluluklar:** |E| < ~30'da yeter sayı ve soğuk başlangıç belirleyicidir; köprü koruması ancak azınlık en az σ_min = 3 kişilik ayrı bir küme oluşturduğunda devreye girer (bkz. e).

## Sınırlılıklar

- Oy modeli bloklar içinde bağımsızdır. Stratejik oy, koordineli kampanya ve zaman içinde tercih değişimi modellenmemiştir.
- Uzlaşma turunun ikna etkisi yalnızca (a)'daki bir satırda, varsayılan bir değişiklikle gösterilmiştir. Diğer yeniden oylamalarda tercihler aynıdır (kötümser varsayım).
- Yeter sayı, eşik ve tabanlar ALGORITMA §2 varsayılanlarıdır. Ontoloji denetiminin ürettiği parametreler farklıysa sonuçlar değişir.
- Süre hesapları yalnızca oylama, uzatma, itiraz ve uzlaşma evrelerini içerir (destekçi toplama ve tartışma hariç).
