# Karar Algoritması Spesifikasyonu — "Köprülü Çoğunluk" (KÇ-1.0, revizyon r2)

> Bu belge sistemin **bağlayıcı** algoritma tanımıdır. Kod (`server/src/governance/*`) bu belgeye uymak zorundadır.
> Araştırma gerekçeleri için bkz. [ARASTIRMA.md](ARASTIRMA.md) (özellikle Bölüm 11–13).
> Algoritma sürümü: `KC-1.0`. Sürüm değişirse defterdeki `TALLY` kayıtlarında `algoVersion` alanı değişir.
> **Revizyon r2 (2026-10):** §4.1 nötr küme kuralı, §4.4 soğuk başlangıç formülü, §4.2 gösterim tutarlılığı, §5 vekâlet çözüm ayrıntıları, §9 permütasyon sıfır modeli ve yeniden üretim ayrıntıları; değişiklik listesi §12'de (madde 13–19). Bu değişiklikler yalnızca sınır durumlarında sonucu etkiler; `algoVersion` bilinçli olarak `KC-1.0` bırakılmıştır (geliştirme aşaması). Kümeleme algoritmasının kimliği `pca2-kmeans-silhouette-null/2` olur. Simülasyon kanıtları: [SIMULASYON.md](SIMULASYON.md).

## 0. Tasarım ilkeleri

1. **Çoğunluk gerekir ama yetmez.** Bir öneri, genel çoğunluğun yanında, anlamlı büyüklükteki **her görüş kümesinden** de asgari bir destek almalıdır ("köprü testi"). Bu, Calhoun'un *eşzamanlı çoğunluk* fikrinin, Polis'in *grup bilgili uzlaşı* ölçüsünün ve X Community Notes'un *köprü kuran* sıralamasının sadeleştirilmiş birleşimidir.
2. **Azınlığın gücü erteleyicidir, mutlak değildir.** Azınlık bir kararı *durdurup yeniden düşünmeye zorlayabilir*. Ancak süresiz *engelleyemez*: tek seferlik, süreli ve en fazla 2/3 (bazı katmanlarda 3/4) ile aşılabilir. Böylece çoğunluk tiranlığı da azınlık tiranlığı (liberum veto) da önlenir.
3. **Bazı haklar oylanamaz.** Yönetmelik ontolojisindeki `Degistirilemez` (değiştirilemez) maddeleri hedefleyen her öneri, oylamaya hiç girmeden **kural gereği geçersiz** sayılır. Bu, Anayasa md. 4 modelidir.
4. **Belirlenimci ve denetlenebilir.** Bütün hesaplar tohumlu sözde rastgele sayı üreteci, tamsayı veya rasyonel karşılaştırma ve sabit sıralama ile yapılır. Aynı girdi her zaman aynı sonucu verir. Girdilerin özeti (hash), parametreler ve sonuç dağıtık deftere yazılır. Herkes sonucu bülten verisinden yeniden hesaplayabilir.
5. **Kaynak olarak yalnızca insanlar oy verir.** Yapay zekâ ve bilirkişi **danışma** niteliğindedir; oy ağırlığı yoktur. Bilirkişinin de oyu 1'dir.

## 1. Tanımlar

| Sembol | Anlamı |
|---|---|
| `E` | Oylama açıldığı anda alınan **uygun seçmen anlık görüntüsü**. Koşullar: doğrulanmış (`verified`), 18 yaşından büyük, açık rıza vermiş, askıda değil, öneri oluşturulmadan önce doğrulanmış. Silme oylamalarında hedef mesajın yazarı hariçtir. |
| `|E|` | Uygun seçmen sayısı |
| `v(u)` | `u` kişisinin **etkin oyu** ∈ {`yes`, `no`, `abstain`, `none`}. Doğrudan oy verdiyse onun oyudur, yoksa vekâlet zincirinden gelir (§5). |
| `Y, N, A` | Etkin `yes`, `no`, `abstain` sayıları. Her kişi **tam olarak 1** sayılır. |
| `P = Y+N+A` | Katılım |
| `a = Y/(Y+N)` | Onay oranı (Y+N=0 ise a=0) |
| `C` | Oylama açılışında dondurulmuş **küme anlık görüntüsü**: `u ↦ g` (küme no) ya da `null` (kümelenmemiş) |
| `n_g` | Anlık görüntüde `g` kümesindeki üye sayısı (oy verip vermediklerine bakılmaz) |
| `n_C` | Kümelenmiş toplam üye sayısı |
| `Y_g, N_g` | `g` kümesindeki üyelerin etkin `yes`/`no` sayıları |
| `P_g` | Laplace yumuşatmalı küme desteği: `P_g = (1+Y_g)/(2+Y_g+N_g)` |

**Anlamlı küme:** `n_g / n_C ≥ σ_share` (varsayılan 0,10) **ve** `n_g ≥ σ_min` (varsayılan 3).

**Grup bilgili uzlaşı (GAC, yalnızca gösterge):** `GAC = (∏_{g ∈ S} P_g)^(1/|S|)`. Burada `S` anlamlı kümeler kümesi, `|S|` **anlamlı küme sayısıdır** (anlık görüntünün `K` değeri değil). Bu, anlamlı kümelerin `P_g` değerlerinin geometrik ortalamasıdır.

## 2. Katmanlar (Tier) ve parametreler

Katmanı ve parametreleri **ontoloji denetimi** (`OntologyService.audit`) belirler. Parametreler oylama açıldığı anda öneriye **sabitlenir**: oylama sırasında yönetmelik değişse bile geriye etkili olmaz.

| Katman | Ne zaman | Yeter sayı `q` | Eşik `τ` | Küme tabanı `φ` | Aşma eşiği `ω` | Yeniden oy eşiği `ρ` |
|---|---|---|---|---|---|---|
| **T0** Olağan | Yeni konu, alt konu (hak kısıtlamıyorsa) | 0,20 | `a > 1/2` (kesin) | 0,30 | 2/3 | 0,60 |
| **T1** Nitelikli | Kabul edilmiş konunun düzenlenmesi; bir `TemelHak`'ı **kısıtlayan** öneri | 0,30 | `a ≥ 0,60` | 0,40 | 2/3 | 0,60 |
| **T2** Yönetmelik | Yönetmelik değişikliği (değiştirilemez olmayan madde/parametre) | 0,40 | `a ≥ 2/3` | 0,40 | 3/4 | 2/3 |
| **T3** Değiştirilemez | `Degistirilemez` maddeyi hedefleyen öneri | — | — | — | — | — **(oylanamaz, geçersiz)** |
| **DEL** Silme | Tartışma parçasının gizlenmesi (karartma) | 0,30 | `a ≥ 2/3` | 0,30 + **yazarın kümesi `P_g ≥ 0,50`** | 3/4 | 3/4 |

Ek parametreler (ontolojide `fy:GenelParametreler`):

| Parametre | Varsayılan | Açıklama |
|---|---|---|
| `σ_share` | 0,10 | Anlamlı küme için asgari pay |
| `σ_min` | 3 | Anlamlı küme için asgari üye sayısı |
| `μ_votes` | 2 | Anlamlı kümede beklenen asgari oy sayısı (altındaysa bir kez uzatma yapılır) |
| `n_C,min` | 12 | Köprü testinin uygulanması için asgari kümelenmiş üye sayısı (soğuk başlangıç) |
| `δ_cold` | +0,10 | Soğuk başlangıçta eşiğe eklenen artış: `τ' = max(τ, min(τ+δ_cold, 2/3))` (§4.4) |
| `floor_abs` | `⌈1,5·√|E|⌉` | Mutlak asgari katılım (Debian benzeri). `q·|E|` ile birlikte büyük olanı geçerlidir. |
| `K_max` | `min(5, 2+⌊n/12⌋)` | Küme sayısı üst sınırı |
| Vekâlet sınırı `cap` | `max(2, ⌈0,05·|E|⌉)` | Bir delegenin taşıyabileceği en fazla **başkasına ait** oy |
| Vekâlet zinciri `H` | 3 | En fazla zincir uzunluğu |

Süreler (saat cinsinden; demo modunda `TIME_SCALE` ile ölçeklenir):

| | T0 | T1 | T2 | DEL |
|---|---|---|---|---|
| Destekçi toplama (azami) | 168 | 168 | 168 | 72 |
| Tartışma | 72 | 96 | 168 | 24 (yazara bildirim) |
| Oylama | 72 | 96 | 120 | 48 |
| Uzatma (bir kez) | 24 | 24 | 48 | 24 |
| İtiraz penceresi | 48 | 72 | 72 | 0 |
| Uzlaşma (soğuma) | 72 | 120 | 168 | — |

Gerekli destekçi (eş imzacı) sayısı: `K_s = max(2, min(5, ⌈√|M|/2⌉))`. Burada `|M|` doğrulanmış üye sayısıdır. DEL için `K_s = 1` (talep edene ek olarak bir destekçi).

## 3. Yaşam döngüsü (durum makinesi)

```
draft ──gönder──▶ sponsoring ──K_s destek──▶ [ontoloji denetimi]
                     │                         ├─ ihlal (Violation) ─▶ inadmissible
                     └─süre doldu─▶ expired     └─ uygun ─▶ deliberation
deliberation ──süre bitti (+bilirkişi askı kuralı)──▶ voting
voting ──kapanış──▶ HESAPLA (§4)
   ├─ needs_more_votes (ilk kez) ─▶ voting (uzatma)
   ├─ accept ─▶ objection_window ──itiraz yok──▶ enacted
   │                               └─geçerli itiraz (§6)─▶ reconciliation(origin=objection)
   ├─ contested ─▶ reconciliation(origin=contested)
   └─ reject ─▶ rejected
reconciliation ──süre bitti──▶ revote ──kapanış──▶ HESAPLA_REVOTE (§4.3) ─▶ enacted | rejected
```

Kurallar:

- Her öneri **en fazla bir** uzlaşma turu yaşar (`reconciliation_used`). Yeniden oylamadan sonra itiraz penceresi açılmaz.
- Metin, `voting` başlarken kilitlenir. Değişiklik yalnızca `deliberation` ve `reconciliation` evrelerinde yapılabilir. Her değişiklik yeni bir sürüm üretir; eski sürümler silinmez.
- **Alt konu:** Üst konu yürürlükte (`enacted` ile oluşmuş, `active`) olmalıdır. Kategorileri üst konudan miras alır (ekleme yapılabilir).
- **Düzenleme teklifi:** Hedef, yürürlükteki bir konudur. Öneri `baseVersion` taşır. Kabul anında konunun güncel sürümü `baseVersion` değilse sonuç `rejected` olur ve gerekçesi "sürüm çakışması" yazılır.
- **Tartışma içi öneriler (suggestion):** `deliberation` sırasında herkes metne değişiklik önerebilir. Yazar kabul ederse yeni sürüm oluşur ve öneren kişi anılır. Reddedilen öneriler herkese açık kalır ve öneren kişi bunu **ayrı bir öneri** olarak açabilir. Böylece yazarın tek başına veto hakkı yoktur.
- Her durum geçişi deftere `PHASE_CHANGED {proposalId, from, to, textHash, at}` olarak yazılır.
- Faz geçişlerinin tek otoritesi sunucudaki zamanlayıcıdır. Bu sayede web ve Android istemcileri hiçbir zaman farklı durum görmez.

## 4. Sayım (Tally)

### 4.1 İlk oylama — `decide(input)`

```
girdi: params, E, etkin oylar v(u), küme anlık görüntüsü C, round=1, authorCluster (yalnızca DEL)

1. Katılım:
   P = Y+N+A
   quorumMet = P ≥ max(⌈q·|E|⌉, floor_abs)
2. Onay:
   a = Y/(Y+N)
   τ' = τ  (soğuk başlangıçta τ' = max(τ, min(τ+δ_cold, 2/3)); §4.4)
   thresholdMet = (strict ? Y·den > N·num... : ...)  // tamsayı karşılaştırması, §4.5
3. Köprü (bridgeApplicable ise):
   anlamlı kümeler S = {g : n_g/n_C ≥ σ_share ∧ n_g ≥ σ_min}
   her g ∈ S için P_g = (1+Y_g)/(2+Y_g+N_g)
   eksik(g) = (Y_g+N_g) < μ_votes
   muaf(g)  = eksik(g) ∧ uzatma kullanıldı             // nötr küme (r2)
   bridgeMet = ∀ g ∈ S, ¬muaf(g) : P_g ≥ φ
   DEL ise ek olarak: authorCluster ≠ null ⇒ P_{authorCluster} ≥ 0,50
     (yazarın kümesi küçük olsa bile; yazar kümelenmemişse bu koşul uygulanmaz;
      köprü uygulanamasa da aranır (§12.3); nötr küme muafiyeti bu koşula UYGULANMAZ)
4. Eksik oy: ∃ g ∈ S : eksik(g)  ⇒  clusterShortfall = true
5. Karar:
   if (!quorumMet ∨ clusterShortfall) ∧ uzatma kullanılmadıysa → NEEDS_MORE_VOTES
   if !quorumMet                         → REJECT (gerekçe: yeter sayı yok)
   if !thresholdMet                      → REJECT
   if !bridgeMet (köprü ya da DEL yazar koşulu değerlendirildiyse) → CONTESTED
   else                                  → ACCEPT
```

Notlar:

- Hiç oy kullanmayan bir küme için `P_g = 1/2` olur ve bu değer taban `φ`'yi geçer. **Boykot bir engel aracı değildir.** Bir azınlık bir kararı ancak *aktif olarak hayır diyerek* durdurabilir.
- **Nötr küme kuralı (r2):** Uzatma kullanıldıktan sonra hâlâ `Y_g+N_g < μ_votes` olan anlamlı küme **nötr** sayılır ve köprü tabanından muaf tutulur (`ClusterResult.passed = null`). Böylece neredeyse sessiz bir kümede tek bir oy kararı ertelemeye zorlayamaz (ör. tek "hayır": `P_g = 1/3 < 0,40`). Sonuç açıklamasında "küme yeterince katılmadı; nötr sayıldı" diye raporlanır. Uzatma hakkı varken eksiklik muafiyet değil, uzatma gerekçesidir. Kural, köprünün karar kuralında kullanıldığı turlarda (ilk tur ve `origin = contested` yeniden oylaması) uygulanır.
- Kümelenmemiş seçmenler (yeni üyeler) genel onaya ve katılıma sayılır, köprü testine katılmaz.

### 4.2 Sonuç açıklama listesi

Her sonuç bir `checks[]` listesi üretir ve arayüz bunu "Neden kabul/red edildi?" kartında gösterir. Örnek:
`quorum` (katılım 18/40 ≥ 10 ✔), `threshold` (onay %61,5 > %50 ✔), `bridge:g0` (A kümesi P=0,71 ≥ 0,30 ✔), `bridge:g2` (C kümesi P=0,22 < 0,30 ✘) …

Gösterim kuralları (r2):

- Gösterilen değer, karşılaştırma sonucuyla tutarlı olmalıdır. Yuvarlanmış değer sınırla aynı görünüyor ama değerler eşit değilse hassasiyet artırılır (ör. `P=29/97` → `0,299 < 0,30`; onay `1499/2500` → `%59,96 < %60,0`). Yine ayırt edilemezse kesir yazılır.
- `origin = objection` turunda küme satırları "(bilgi — bu turda uygulanmaz)" etiketiyle ✔ olarak gösterilir; gerçek karşılaştırma açıklamada yazılır. Küme tablosu (`clusters[]`) hesaplanan değerleri gösterir.
- `participation_shortfall` satırı yalnızca uzatma gerektirdiğinde ✘'tir. Uzatmadan sonra "nötr sayıldı" bilgisi ✔ olarak gösterilir.
- `quorum` açıklaması, gerekli katılım `|E|` ile sınırlandığında bunu belirtir (§12.1).

### 4.3 Yeniden oylama — `decideRevote(input)`

- **origin = contested:** `PASS ⇔ quorumMet ∧ ((thresholdMet ∧ bridgeMet) ∨ a ≥ ω)`
- **origin = objection:** `PASS ⇔ quorumMet ∧ a ≥ ρ'`. Burada `ρ' = ρ`'dur. İtirazı imzalayanlar herhangi bir **anlamlı** kümenin (§1) **tüm üyelerinin** (`n_g`) en az 2/3'ü ise ("güçlü itiraz") `ρ' = max(ρ, 2/3)` olur. Küme tabanları bu turda **uygulanmaz** ama hesaplanıp gösterilir.
- Yeniden oylamada uzatma (needs_more_votes) **bir kez daha** kullanılabilir.
- Sonuç her durumda kesindir (`enacted` / `rejected`). Varsa azınlık raporları karar kaydına eklenir.

### 4.4 Soğuk başlangıç

`n_C < n_C,min` ya da `K < 2` ise köprü testi **uygulanamaz** (`bridgeApplicable = false`). Bu durumda:
`τ' = max(τ, min(τ + δ_cold, 2/3))`. T0 için eşik `a ≥ 0,60` olur ve kesin değil, `≥` karşılaştırması kullanılır. Eşik zaten 2/3'ün üzerindeyse (ör. nitelikli hüküm değişikliğinde 3/4) soğuk başlangıç onu **düşürmez** (r2; r1'deki `min(τ+δ_cold, 2/3)` formülü 3/4'ü 2/3'e indiriyordu).
Sonuç kartında "Yeterli görüş verisi yok; nitelikli çoğunluk arandı" notu gösterilir.

### 4.5 Sayısal kesinlik

Oranlar kayan noktayla karşılaştırılmaz. Her eşik bir rasyonel sayıdır (`num/den`):

- `a > num/den ⇔ Y·den > num·(Y+N)`
- `a ≥ num/den ⇔ Y·den ≥ num·(Y+N)`
- `P_g ≥ φ ⇔ (1+Y_g)·den ≥ num·(2+Y_g+N_g)`

Eşikler ontolojide ondalık olarak tutulur ve `toRational` ile 1/10000 hassasiyetle rasyonele çevrilir. 2/3 ve 3/4 gibi değerler `num/den` olarak özel saklanır.

## 5. Vekâlet (likit demokrasi) — `resolveEffectiveVotes`

Vekâlet isteğe bağlıdır. Grafta `DELEGATES_TO {scope, rank}` kenarı olarak tutulur. `scope`, bir kategori IRI'si ya da `*` (genel) olur.

1. Doğrudan oy veren kişinin vekâleti o oylamada **askıya alınır** (doğrudan oy her zaman önceliklidir).
2. Oy vermemiş `u` için kapsam sırası şöyledir: önerinin kategorileri (en özelden genele, ontoloji alt sınıf derinliğine göre), sonra `*`. Her kapsamda en düşük `rank`'tan başlayarak bir delege aranır.
3. Delege zinciri en fazla `H=3` adım izlenir. İlk **doğrudan oy veren** delegenin oyu `u`'ya etkin oy olarak atanır. Döngüler ziyaret kümesiyle kesilir (ekleme anında da döngü reddedilir).
4. **Sınır:** Bir delegenin taşıdığı başkasına ait oy sayısı `cap`'i aşamaz. Taşma olursa delegatorlar belirlenimci sırayla (vekâlet oluşturma zamanı, sonra kullanıcı kimliği) dağıtılır. Sınırı aşan kişiler `unrouted` sayılır ve oyları kullanılmamış olur. Bu kişilere bildirim gider.
5. Etkin oy, kişinin **kendi kümesine** sayılır. Ağırlık her zaman 1'dir. Vekâlet yalnızca "kimin tercihinin uygulanacağını" belirler; kimse 1'den fazla sayılmaz.

**Çözüm ayrıntıları (r2, bağlayıcı):**

- **Kapsam sırası:** önerinin kategorileri ve üst sınıfları, ontoloji derinliğine göre azalan (en özel önce), eşitlikte IRI sırası; en sonda `*`. Kapsam listesinde `*` yoksa sona eklenir.
- **Arama sırası:** Her düğümde (u ve zincirdeki her delege için) önce kapsam sırası, kapsam içinde `rank` ↑, eşitlikte vekâletin oluşturma zamanı ↑, sonra kenar kimliği ↑ uygulanır. Zincir **derinlik öncelikli** izlenir. Bir tercihin zinciri `H` adım içinde doğrudan oy veren bir delegeye ulaşmazsa sıradaki tercihe geçilir. Bu yüzden üst tercihin zinciri, alt tercihin doğrudan oyundan önce gelir. `u → d₁` bir adımdır; `u → d₁ → d₂ → d₃` üç adımdır.
- **Uygun seçmen olmayan delege** (`E` dışında: DEL'de hariç tutulan yazar, askıdaki üye vb.) kenarı yokmuş gibi atlanır. Böyle bir delege ne oy kaynağıdır ne de zincirin ara halkası; kişi sıradaki tercihine düşer. Gerekçe: oylamaya yalnızca `E` katılır, `E` dışındaki biri başkalarının oyunu da yönlendiremez. `E` dışındakilerin doğrudan oyları sayılmaz.
- **Yük ve sınır:** Yük, oyu uygulanan (zincirin sonundaki) delegeye yazılır. Zincirdeki oy vermemiş ara delegeler de bu yüke dahildir. Sınır aşılırsa sıralama delegatörün **kendi ilk adım** vekâletinin oluşturma zamanına, sonra kullanıcı kimliğine göre yapılır. Sınırı aşan kişi başka bir delegeye kaydırılmaz; `unrouted` olur.
- **Kümeler arası vekâlet:** Vekâletle gelen oy delegatörün kümesine sayılır. Bu yüzden azınlık kümesinin desteği, üyelerinin seçtiği başka bir bloktaki delegenin tercihini yansıtabilir. Arayüz bunu vekâlet verilirken açıkça göstermelidir (bkz. SIMULASYON.md (f)).

## 6. Azınlık itirazı ("alarm zili") — `evaluateObjection`

İlk turda ACCEPT çıkan bir öneri `objection_window` evresine girer. İtiraz imzaları:

- İmzacı, `E` içinde olmalı ve ilk turda etkin oyu `no` olmalıdır.
- Gerekçe olarak ontolojideki bir `fy:ItirazGerekcesi` IRI'si ve serbest metin verilmelidir.
- Her üye 30 günde en fazla **2** itiraz imzalayabilir (bütçe).

**Geçerlilik** (herhangi biri yeterlidir):

- (a) Tek bir anlamlı küme `g`'de imzacı sayısı ≥ `max(3, ⌈0,75 · N_g⌉)`. Burada `N_g`, o kümenin `no` sayısıdır.
- (b) Toplam imzacı ≥ `⌈0,10·|E|⌉` ve imzacılar en az **2 farklı** kümeden (kümelenmemiş sayılmaz).

İmzacının kümesi ilk tur bülteninden (oy kaydından) alınır. "Güçlü itiraz" (§4.3), imzacıların bir anlamlı kümenin tüm üyelerinin en az 2/3'ü olmasıdır.

Geçerli itiraz `reconciliation(origin=objection)` başlatır. Bir öneri yalnızca bir kez itiraza uğrayabilir.

> **Not (simülasyon, SIMULASYON.md (g)):** Büyük topluluklarda kural (b) kolay sağlanır. Örneğin |E| = 300'de 30 imza ve iki küme yeterlidir. "Hayır" oyu %40 civarında olan ve kaybedenlerin motive olduğu bir öneri bu eşiğe ulaşır; yeniden oylamada ρ = %60 aranır. Böylece tartışmalı T0 kararlarında eşik fiilen %50'den %60'a çıkar ve toplam kabul oranı düşer. Bu **bilinçli bir tercihtir**: itiraz yalnızca **erteleyici** bir güçtür (tek seferlik uzlaşma turu, ardından ρ ile kesin sonuç). Kalıcı veto değildir ve aynı öneriye ikinci kez uygulanamaz.

## 7. Uzlaşma turu

Süre: §2'deki tabloya göre. Bu sürede şunlar yapılır:

1. Yapay zekâ **iki çıktı** üretir: azınlık görüşleri özeti ve 4–8 arası "köprü taslağı" (Habermas Machine benzeri). İnsan onayı olmadan hiçbir şey değişmez.
2. Karşı kümelerin üyeleri **azınlık raporu** yazabilir. Bu rapor karar kaydına kalıcı olarak eklenir.
3. Yazar metni revize edebilir. Revizyon yeni bir sürüm üretir ve yeniden ontoloji denetiminden geçer. Denetimde ihlal çıkarsa revizyon reddedilir ve eski metin oylanır.
4. Kategori bilirkişi gerektiriyorsa ve rapor yoksa ya da bir **karşı bilirkişi talebi** varsa yeni panel çekilir (§8).
5. Süre dolunca `revote` başlar. Uygun seçmen anlık görüntüsü ilk turdakiyle **aynıdır**. Küme anlık görüntüsü de aynıdır.

## 8. Bilirkişi seçimi — `drawExpertPanel`

1. **Tetikleyiciler:** Ontolojide `requiresExpert` kuralı varsa, uygun seçmenlerin ≥%10'u talep ederse ya da yazar talep ederse panel çekilir.
2. **Aday havuzu:** `active` bilirkişilerden, alanlarından en az biri önerinin kategorilerinden birinin kendisi, üst sınıfı ya da alt sınıfı olanlar alınır.
3. **Kesin çıkar çatışması (dışlanır):** öneri yazarının kendisi; grafta `RELATED_TO` (aile, iş, hane) kenarı ile yazara 3 adım içinde bağlı olanlar; aynı önerinin önceki paneline girmiş olanlar; kendisi beyan edenler.
4. **Yumuşak çatışma:** `soft = 1,0` (grafta mesafe 1: takip veya vekâlet) ya da `0,5` (mesafe 2). Ağırlık: `w = clamp(R, 0,5, 1,5) / (1 + aktifGörev) · (1 − soft)`.
5. **Tohum:** `seed = SHA256(sonİşlenmişBlokHash ‖ proposalId ‖ round)`. Bu tohum deftere `EXPERT_DRAW` ile, aday listesi ve ağırlıklarla birlikte yazılır. Herkes çekilişi yeniden üretebilir.
6. **Çekiliş:** Tohumlu sözde rastgele sayı üreteciyle, ağırlıklı ve yerine koymadan `k=3` kişi seçilir (aday azsa hepsi alınır). Adaylar kimliğe göre sıralanır; bu sıralama belirlenimciliği sağlar.
7. Aday bulunamazsa üst kategoriye genişletilir. Yine yoksa "bilirkişi bulunamadı" bayrağı konur ve süreç durmaz.
8. **Rapor şeması:** `assessment ∈ {feasible, infeasible, uncertain}`, `confidence ∈ [0,1]`, riskler, sorulara yanıtlar, karşı görüş. Hukuki nitelendirme yasaktır (6754 s. Kanun md. 3/2). Yapay zekâ denetleyicisi bu tür ifadeleri işaretler.
9. **Askı kuralı:** Rapor verenlerin ≥2/3'ü `infeasible` derse ve güven medyanı ≥0,8 ise tartışma bir kez, uzatma süresi kadar uzatılır. Oylama ekranında uyarı gösterilir. Eşik değişmez.
10. Süre içinde rapor gelmezse oylama raporsuz başlar ve bu durum işaretlenir. Gecikme bilirkişinin itibarını düşürür.
11. **İtibar:** `R' = 0,8R + 0,2·S`. `S ∈ [0,1]` şu kontrol listesiyle hesaplanır: zamanında teslim, tüm soruların yanıtlanması, alan içinde kalma, hukuki nitelendirme yapmama. Başlangıç değeri `R₀ = 0,75`'tir. **Çoğunlukla aynı fikirde olmak asla ödüllendirilmez.**

## 9. Kümeleme — `computeClusters` (Polis benzeri; `pca2-kmeans-silhouette-null/2`)

Aşağıdaki ayrıntılar, kümelemenin bağımsız olarak birebir yeniden üretilebilmesi için bağlayıcıdır (r2).

1. Girdi, **kapanmış** önerilerdeki doğrudan oylardır: `+1` (yes), `−1` (no), `0` (abstain). Matris satırları kullanıcılara, sütunlar önerilere karşılık gelir. Satır ve sütunlar kimliğe göre (UTF-16 kod birimi sırası) sıralanır. Aynı (kullanıcı, öneri) için birden çok kayıt varsa hücre değeri bunların ortalamasıdır.
2. Kümelemeye katılım: en az `min(7, sütunSayısı)` oy vermiş kullanıcılar. **Çekimser oylar bu sayıya dahildir.** Diğerleri `excluded` listesine yazılır ve kümelenmemiş sayılır. Sütun ortalaması yalnızca katılımcıların gözlenen hücrelerinden hesaplanır. Eksik hücreler sütun ortalamasıyla doldurulur ve matris merkezlenir; merkezlenmiş matriste eksik hücre 0 olur.
3. **Temel bileşen analizi (PCA):** 2 bileşen, `XᵀX` üzerinde kuvvet yinelemesi (tam 100 yineleme, erken durma yok). Başlangıç vektörü `createRng(seed‖"|pca")` üretecinden her bileşen için `U(−0,5; 0,5)` değerleriyle alınır ve normalleştirilir. İkinci bileşen deflasyonla (`X ← X − (X v₁) v₁ᵀ`) ve aynı üretecin devamıyla bulunur. İşaret kanonikleştirilir: mutlak değeri en büyük bileşen (eşitlikte ilk) pozitif yapılır. Koordinatlar `x = X v₁`, `y = X v₂`'dir.
4. **k-means (2 boyutlu PCA koordinatlarında):** `K ∈ 2..min(K_max, n−1)` için çalıştırılır. Her `K` için `createRng(seed‖"|kmeans|"‖K‖"|"‖r)` (`r = 0..9`) tohumlarıyla **10 k-means++ başlangıcı** ve en çok 100 yinelemelik Lloyd algoritması uygulanır; en düşük atalet (eşitlikte ilk) seçilir. Ortalama siluet aynı 2 boyutlu Öklid uzayında hesaplanır (tek elemanlı kümedeki nokta için `s = 0`). En yüksek ortalama siluet değerini veren `K` aday olur (eşitlikte küçük `K`). `n < 4` ise `K = 1`.
5. **Yapı testi (r2):** Aday `K ≥ 2` yalnızca iki koşul birlikte sağlanırsa kabul edilir: (i) siluet ≥ 0,25 ve (ii) `siluet − siluet_sıfır ≥ 0,10`. Aksi halde `K = 1` olur (tek küme `g0`, köprü testi uygulanamaz). `siluet_sıfır`, sıfır modelinin ortalamasıdır. `i = 0..4` için merkezlenmiş matrisin her sütunundaki gözlenen değerler, o sütunda oy vermiş satırlar arasında `createRng(seed‖"|null|"‖i)` ile karıştırılır. Bu karıştırma marjinalleri ve eksiklik desenini korur, kişiler arası bağıntıyı yok eder. Ardından 3. ve 4. adımlar `seed‖"|null|"‖i` tohumuyla aynen uygulanır ve bulunan en iyi siluet alınır. Sıfır modeli yalnızca (i) sağlandığında hesaplanır. **Gerekçe:** 2 boyutlu PCA uzayında k-means, yapısız (tek tepeli) veride de tipik olarak 0,34–0,6 siluet bulur. Bu yüzden mutlak 0,25 eşiği sahte kümeleri tek başına ayıklayamaz (bkz. SIMULASYON.md (h)).
6. Kümeler büyüklüğe göre yeniden numaralandırılır: `g0, g1, …`. Sıralama azalan büyüklüktür; eşitlikte merkezin x koordinatı, sonra y koordinatı (artan), sonra ilk üyenin sırası kullanılır.
7. Anlık görüntü `{k, assignments, coords, silhouette, inputHash, seed}` olarak saklanır. `inputHash = SHA-256(kanonik JSON{algo, minVotes, kMax, sıralı girdiler})` tohumu içermez; aynı oy geçmişi aynı özeti verir. `outputHash`, sıfır siluetini de kapsar. `silhouette`, seçilen bölümlemenin değeridir; `K = 1` sonucunda eşik öncesi en iyi adayın değeridir (aday yoksa 0). Koordinatlar ve siluet 10⁻⁶'ya yuvarlanır. Özeti deftere `CLUSTER_SNAPSHOT` ile yazılır.
8. Çapraz kontrol olarak graf modülü, uzlaşı grafında Louvain topluluk tespiti yapar. Bu yalnızca gösterge amaçlıdır.

Tohum, `SHA256(sonBlokHash ‖ "cluster" ‖ zaman damgası)` olarak alınır.

## 10. Silme (karartma) prosedürü

1. Talep, hedef mesaj kimliklerini ve **bir** `fy:SilmeGerekcesi` gerekçesini içerir. Gerekçe şunlardan biri olmalıdır: kişisel veri ifşası, tehdit, hakaret/iftira, korunan gruba nefret söylemi, spam, telif.
   **"Görüş ayrılığı" geçersiz bir gerekçedir.** Bu kural değiştirilemez bir maddedir ve SHACL ile denetlenir.
2. Yazara bildirim gider (DEL tartışma süresi). Yazar bu sürede mesajını kendisi düzenleyebilir; düzenleme yeni bir sürüm üretir.
3. Kişisel veri ifşası ve tehdit gerekçelerinde ilgili mesaj **talep anında daraltılır** (gizlenmez; "Gözden geçiriliyor" etiketiyle katlanır).
4. Oylama DEL katmanı kurallarıyla yapılır: 2/3 onay, köprü testi ve yazarın kümesinde `P ≥ 0,50`.
5. **Kabul** edilirse mesaj silinmez, `hidden` olur. Herkes "[#K-12 kararıyla gizlendi — gerekçe: X]" mezar taşını görür. Asıl metin denetçi rolüne (erişim kaydıyla) açık kalır. Defterdeki içerik özeti zinciri bozmaz. Yazar, karartılamayacak **bir** cevap metni ekleyebilir.
6. **Red** edilirse talep herkese açık arşivlenir.
7. KVKK kapsamında kişinin kendi verisini silme talebi **oylamaya konmaz**. Bu ayrı bir hukuki yoldur ve kripto-imha ile yürür (bkz. KVKK.md).

## 11. Defterde ne var, ne yok

**Var:**

- içerik özetleri (`SHA256(tuz ‖ metin)`)
- faz geçişleri
- oy taahhütleri `commit = SHA256(proposalId ‖ round ‖ ballotId ‖ choice ‖ salt)`
- oylama sonunda tek bir `BALLOT_REVEAL` kaydı `[{ballotId, choice, salt, cluster, via}]`
- sayım sonucu ve girdi özetleri
- küme ve graf çalışma özetleri
- bilirkişi çekilişleri
- yapay zekâ çıktı özetleri
- yönetmelik sürüm özetleri

**Yok:** ad, soyad, TCKN, adres, doğum tarihi (şifreli halleri de yok), ham mesaj metni, kullanıcı ile oy arasındaki bağ.

`ballotId = HMAC(sunucuOyAnahtarı, userId ‖ proposalId ‖ round)`. Bu değer öneriye özeldir. Aynı kişinin farklı önerilerdeki oyları defterden birbirine bağlanamaz.

**Doğrulama:** Kullanıcı, cihazında sakladığı makbuzla (`ballotId, choice, salt`) oyunun deftere doğru yazıldığını doğrular. Kontrol edilenler: Merkle kanıtı, blok başlığı ve ≥3 doğrulayıcı imzası. Herkes `BALLOT_REVEAL` verisinden sayımı yeniden hesaplayabilir (`verifyTally`).

**Tehdit modeli (dürüstçe):** Bu sistem düşük riskli topluluk yönetişimi içindir; siyasi seçim için değildir. Sunucu, seçmen uygunluğu ve oy gizliliği konusunda güvenilir kabul edilir. Cihazda imzalı oy ve MACI benzeri zorlama direnci gelecek çalışmadır. Dört doğrulayıcı aynı makinede çalışıyorsa bu durum arayüzde açıkça belirtilir.

## 12. Uygulama netleştirmeleri (KC-1.0, r1 ve r2)

Aşağıdaki maddeler spesifikasyonun belirsiz bıraktığı noktaları **en koruyucu** yorumla netleştirir. Kod (`shared/src/decision.ts`, `server/src/forum/*`) bunlara uyar.

1. **Gerekli katılım üst sınırı.** `quorumRequired = min(|E|, max(⌈q·|E|⌉, floor_abs))`. Çok küçük topluluklarda (`|E| ≤ 2`) `floor_abs` seçmen sayısını aşabildiğinden, herkes oy verdiğinde kabul imkânsız olmasın diye yeter sayı `|E|` ile sınırlanır. `P = 0` hiçbir zaman yeter sayıyı karşılamaz.
2. **Köprü uygulanabilirliği.** Köprü testi için `n_C ≥ n_C,min`, `K ≥ 2` ve **en az bir anlamlı küme** gerekir; aksi halde soğuk başlangıç kuralı (§4.4) uygulanır.
3. **Silmede yazar kümesi koruması her zaman.** DEL katmanında hedef mesajın yazarı kümelenmişse `P_{yazar} ≥ 1/2` koşulu, köprü testi soğuk başlangıç nedeniyle uygulanamasa bile aranır. Bu koşul sağlanmazsa sonuç `contested` olur.
4. **Yeniden oylamada uzatma koşulu.** Küme oy eksiği (`μ_votes`) yalnızca köprü testinin karar kuralında kullanıldığı turlarda (ilk tur ve `origin = contested` yeniden oylaması) uzatma gerekçesidir. `origin = objection` turunda yalnızca katılım eksiği uzatma gerekçesidir.
5. **DEL süreleri.** İtiraz penceresi 0 olduğundan kabul edilen silme talebi doğrudan yürürlüğe girer. Uzlaşma süresi 0 olduğundan tartışmalı silme talebi bir sonraki zamanlayıcı adımında doğrudan yeniden oylamaya geçer (ω = ρ = 3/4).
6. **Ara sayımın gizliliği.** `needs_more_votes` ara sayımı deftere açıklanmaz ve oylama sürerken hiçbir istemciye gösterilmez. Uzatmadan sonra yapılan kesin sayım hem `BALLOT_REVEAL` hem `TALLY` olarak yazılır.
7. **Sayım anahtarı.** Sunucu `decide()` fonksiyonunu `voterKey = ballotId` ile çağırır. Böylece defterdeki bültenden yapılan bağımsız yeniden sayım (`verifyTally`) aynı `inputsHash` değerini üretir. Vekâletle gelen etkin oyların `ballotId`'si de aynı HMAC ile hesaplanır, `salt` boş bırakılır ve kayıtta `via = "delegated"` yazar.
8. **İtiraz imzacısının oyu.** "İlk turda etkin oyu `no`" koşulu bülten (`BALLOT_REVEAL`) üzerinden denetlenir; vekâletle `no` sayılan kişi de itiraz edebilir.
9. **Bilirkişi tohumunun öğütülmesine karşı.** Panel çekilişini yazar değil zamanlayıcı başlatır. Tohumdaki blok, tartışma evresi açılırken **önceden taahhüt edilen** yüksekliktir (`o anki yükseklik + 2`), yani çekiliş anı seçilerek uygun bir blok hash'i yakalanamaz.
10. **Küme manipülasyonuna karşı.** Kümeleme girdisine yalnızca en az 3 gündür doğrulanmış hesapların oyları alınır. Anlık görüntü oylama açılışında dondurulur ve yeniden oylamada aynı görüntü kullanılır. Kilit adım (lockstep) oy grupları graf modülünde işaretlenir: tarama her **kesin** sayımda (ara sayımda değil) yapılır, sonucu **kararı değiştirmez**; yalnızca bütünlük uyarısı olarak denetim günlüğüne yazılır ve gösterilir (herkese grup sayısı ve büyüklüğü, üyeler yalnız denetçi/yöneticiye; deftere yazılmaz).
11. **Hak etkisi bayrakları: yalnızca yükseltme.** Yazar dışındaki üyelerin ve yapay zekânın eklediği "temel hak kısıtlaması" bayrakları katmanı en fazla T1'e yükseltir, uyarı üretir ve bilirkişiyi zorunlu kılar. Öneriyi T3 (geçersiz) yapamazlar. Bayrağı yalnızca ilgili alandaki bilirkişi ya da yönetici kaldırabilir.
12. **Silme talebi kötüye kullanımına karşı.** Bir kullanıcının aynı anda en fazla 3 açık silme talebi olabilir ve 24 saatte en fazla 5 talep açabilir. Acil gerekçeli daraltma, karar çıkana kadar sürer; talep reddedilir, düşer ya da geri çekilirse kaldırılır.

### r2 eklemeleri

13. **Nötr küme kuralı (§4.1).** Köprünün karar kuralında kullanıldığı turlarda, uzatma kullanıldıktan sonra `Y_g+N_g < μ_votes` olan anlamlı küme köprü tabanından muaftır (`passed = null`). DEL'deki yazar kümesi koşulu bu muafiyetten yararlanmaz: yazarın kümesinden tek bir "hayır" bile silmeyi ertelemeye yeter (en koruyucu yorum).
14. **Soğuk başlangıç eşiği (§4.4).** `τ' = max(τ, min(τ+δ_cold, 2/3))`, karşılaştırma `≥`. Soğuk başlangıç bir eşiği hiçbir zaman düşürmez.
15. **Gösterim tutarlılığı (§4.2).** Değer ve sınır gösterimi karşılaştırma sonucuyla çelişmez. İtiraz kökenli turda küme satırları bilgi amaçlıdır. Uzatma sonrası eksiklik satırı ✔ "nötr sayıldı" olarak gösterilir.
16. **Vekâlet çözüm ayrıntıları (§5).** Derinlik öncelikli arama, uygun olmayan delegenin tümüyle atlanması, yükün son delegeye yazılması ve sınırda kaydırma yapılmaması bağlayıcıdır. Sunucunun "oyumu kim kullandı" izi (`myEffectiveVia`) aynı arama sırasını kullanır; iz, sayımı yapan aramanın kendi çıktısıdır (`resolveEffectiveVotes().delegateOf`), ayrı bir kopya değildir.
17. **Kümeleme yapı testi (§9).** Permütasyon sıfır modeli: `siluet ≥ 0,25` ve `siluet − siluet_sıfır ≥ 0,10`. Algoritma kimliği `pca2-kmeans-silhouette-null/2` olur. Kümeleme girdisinin süzülmesi (madde 10) çağıranın sorumluluğundadır.
18. **İtiraz kümesi (§4.3, §6).** İmzacının kümesi ilk tur bülteninden alınır. Güçlü itiraz yalnızca anlamlı kümeler için değerlendirilir.
19. **Bağımsız yeniden sayımda hata.** `verifyTally`, bozuk ya da uyumsuz bir `TALLY` kaydında (ör. T3 katmanı, `round = 2` ama `revote` yok) istisna fırlatmaz. Bunun yerine "Yeniden sayım yapılamadı: …" uyuşmazlığı raporlar ve `ok = false` döner.
