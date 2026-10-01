# Forum Yönetmeliği ve Yönetmelik Ontolojisi

> Bu belge, Forum Sistemi'nin yönetmeliğini ve onu makinece denetlenebilir kılan ontoloji modelini anlatır.
> Yönetmeliğin **tek doğruluk kaynağı** `server/ontology/` altındaki dosyalardır; aşağıdaki madde metinleri,
> kategori ağacı, gerekçeler ve parametre tabloları `yonetmelik.ttl` (sürüm 1) ile birebir aynıdır
> (`server/test/ontology/docs.test.ts` bunu denetler). Karar algoritması için bkz. [ALGORITMA.md](ALGORITMA.md).

## İçindekiler

1. [Modelin özeti](#1-modelin-özeti)
2. [T-kutusu: şema](#2-t-kutusu-şema)
3. [A-kutusu: yönetmelik bilgisi](#3-a-kutusu-yönetmelik-bilgisi)
4. [N3 çıkarım kuralları](#4-n3-çıkarım-kuralları)
5. [SHACL şekilleri](#5-shacl-şekilleri)
6. [Denetim akışı ve katman belirleme](#6-denetim-akışı-ve-katman-belirleme)
7. ["En koruyucu kazanır" parametre birleştirme](#7-en-koruyucu-kazanır-parametre-birleştirme)
8. [Sürümleme ve meta-kurallar](#8-sürümleme-ve-meta-kurallar)
9. [Forum Yönetmeliği — tam metin](#9-forum-yönetmeliği--tam-metin)
10. [Kategori ağacı](#10-kategori-ağacı)
11. [Temel haklar, gerekçeler ve içerik etiketleri](#11-temel-haklar-gerekçeler-ve-içerik-etiketleri)
12. [Ayarlanabilir parametreler](#12-ayarlanabilir-parametreler)
13. [Programlama arayüzü (OntologyService)](#13-programlama-arayüzü-ontologyservice)

---

## 1. Modelin özeti

Hocanın 6. isteği "yönetmelik, konuları denetleyecek şekilde ontoloji olarak modellenir" idi. Bunu dört katmanlı bir
anlamsal ağ modeliyle karşıladık:

| Dosya | Rol | Değişir mi? |
|---|---|---|
| `fy-schema.ttl` | **T-kutusu** (terminoloji): sınıflar ve özellikler — madde, kategori, temel hak, gerekçe, katman, kural, öneri alt grafı | Hayır (kodla birlikte) |
| `yonetmelik.ttl` | **A-kutusu** (bilgi): 24 madde (58 fıkra), kategori sınıf ağacı, haklar, gerekçeler, içerik etiketleri, katman ve genel parametreler, koruma sınırları, kurallar | **Evet** — yalnızca kabul edilmiş yönetmelik yamasıyla, yeni sürüm olarak |
| `yonetmelik-kurallar.n3` | **N3 kuralları** (Horn, ileri zincirleme): sınıf kalıtımı, bilirkişi gereksinimi, hak kısıtlaması, değiştirilemez hedef, içerik etiketi… | Hayır |
| `yonetmelik-sekiller.ttl` | **SHACL şekilleri**: ihlal/uyarı üreten kısıtlar (maddeye atıflı Türkçe mesajlar) + yönetmeliğin kendisini denetleyen meta-şekiller | Hayır |

Ad alanı `https://forumsistemi.org/ont#` (önek `fy:`). Kodda kullanılan IRI'ler `shared/src/vocab.ts`'tedir; bir test,
oradaki her IRI'nin TTL'de tanımlı olduğunu ve etiket, üst sınıf, bilirkişi bayrağı, `coreImmutable`, `urgent/sealed/invalid`
değerlerinin aynı olduğunu doğrular.

Bir öneri denetlenirken öneri bir **RDF alt grafına** çevrilir, yürürlükteki yönetmelikle birleştirilir, N3 kurallarıyla
sabit noktaya kadar çıkarım yapılır ve sonuç SHACL ile doğrulanır. Çıktı bir `AuditReport`'tur: katman, kabul edilebilirlik,
oylama parametreleri (`DecisionParams`), uygulanan kurallar ve her biri bir maddeye atıf yapan bulgular
("Madde 20 (2): “Görüş ayrılığı” bir silme gerekçesi olamaz…").

## 2. T-kutusu: şema

Başlıca sınıflar:

- `fy:Madde` — bir maddenin bir **fıkrası** (`fy:maddeNo "Madde 9 (2)"`, `fy:baslik`, `fy:metin`, `fy:bolum`, `fy:sira`) ve
  `fy:korumaDuzeyi` ∈ {`fy:Degistirilemez`, `fy:Nitelikli`, `fy:Olagan`}.
- `fy:Kategori` — konu kategorileri bunun **alt sınıflarıdır** (`rdfs:subClassOf` ağacı). Kategoriler sınıf olduğu için bir öneri,
  bağlandığı kategorinin ve tüm üst kategorilerinin *örneği* (`rdf:type`) olur. Kategori sınıfları `fy:anahtarKelime` ve
  `fy:bilirkisiGerekli` açıklamalarını taşır.
- `fy:TemelHak` (`fy:cekirdekDegistirilemez` — özü oylanamaz), `fy:SilmeGerekcesi`, `fy:ItirazGerekcesi`, `fy:GecersizGerekce`,
  `fy:IcerikEtiketi` (`fy:acil`, `fy:muhurlu`).
- `fy:ParametreTasiyici` ve alt sınıfları `fy:Katman` (T0, T1, T2, T3, DEL), `fy:ParametreKumesi` (genel parametreler, koruma
  sınırları) ve `fy:Kural`. Her taşıyıcı bir maddeye dayanır (`fy:dayanak`).
- `fy:Parametre` — ayarlanabilir parametre özellikleri (`fy:yeterSayi` q, `fy:esik` τ, `fy:esikKesin`, `fy:kumeTabani` φ,
  `fy:yazarKumesiTabani`, `fy:asmaEsigi` ω, `fy:yenidenOyEsigi` ρ, `fy:sure*` saatleri, genel parametreler, koruma sınırları);
  `fy:parametreTuru` oran / saat / sayı / mantıksal.
- `fy:Kural` — `fy:uygulanirSinif` (kuralın uygulandığı sınıf: öneri türü, kategori ya da çıkarılmış sınıf), `fy:asgariKatman`
  (katman tabanı), parametre geçersiz kılmaları ve `fy:overrides` (özel hüküm genel hükmün önüne geçer).
- Öneri alt grafı: `fy:Oneri` → `fy:KararOnerisi` (konu, alt konu, düzenleme, yönetmelik) ve `fy:SilmeOnerisi`; hak etkileri
  (`fy:HakEtkisi`: hak, yön, kaynak), içerik etiketi atamaları (güven düzeyiyle), üst/hedef konu (`fy:KonuKaydi`, durum),
  sürümler, silme gerekçesi, yama işlemleri (`fy:YamaIslemi`).
- Etiket kaynakları: `fy:BaglayiciKaynak` (yazar beyanı, bilirkişi tespiti) ve `fy:DanismaKaynagi` (yapay zekâ, üye bayrağı,
  kural tabanlı tespit). Bu ayrım "yalnızca yükseltme" ilkesinin temelidir (§6).

## 3. A-kutusu: yönetmelik bilgisi

`yonetmelik.ttl` şunları içerir:

- **Maddeler:** 6 bölümde 24 madde, 58 fıkra (tam metin §9). 20 fıkra *Değiştirilemez*, 18 fıkra *Nitelikli*, 20 fıkra *Olağan*.
- **Kategori ağacı:** 10 kök, 24 alt kategori (§10). `fy:bilirkisiGerekli` alt kategorilere **miras kalır** (ör. *Konut*,
  *İmar ve kentsel dönüşüm*'den).
- **Katmanlar** (`fy:KatmanT0` … `fy:KatmanDEL`) — değerler [ALGORITMA.md §2](ALGORITMA.md) tablolarıyla birebir:

| Katman | q | τ | φ | ω | ρ | Destek / Tartışma / Oylama / Uzatma / İtiraz / Uzlaşma (saat) |
|---|---|---|---|---|---|---|
| T0 Olağan karar (`fy:KatmanT0`) | 0,20 | a > 1/2 (kesin) | 0,30 | 2/3 | 0,60 | 168 / 72 / 72 / 24 / 48 / 72 |
| T1 Nitelikli karar (`fy:KatmanT1`) | 0,30 | a ≥ 0,60 | 0,40 | 2/3 | 0,60 | 168 / 96 / 96 / 24 / 72 / 120 |
| T2 Yönetmelik değişikliği (`fy:KatmanT2`) | 0,40 | a ≥ 2/3 | 0,40 | 3/4 | 2/3 | 168 / 168 / 120 / 48 / 72 / 168 |
| T3 Değiştirilemez hüküm (`fy:KatmanT3`) | — | — | — | — | — | oylanamaz, geçersiz |
| DEL Silme (karartma) (`fy:KatmanDEL`) | 0,30 | a ≥ 2/3 | 0,30 + yazarın kümesi ≥ 1/2 | 3/4 | 3/4 | 72 / 24 / 48 / 24 / 0 / 0 |

  DEL'de uzlaşma süresi 0'dır (tartışmalı sonuçta doğrudan yeniden oylama) ve itiraz penceresi yoktur.
- **Genel parametreler** (`fy:GenelParametreler`): σ_share 0,10 · σ_min 3 · μ_votes 2 · n_C,min 12 · δ_cold 0,10 ·
  vekâlet sınırı oranı 0,05 · H = 3 · panel bilirkişi sayısı 3.
- **Koruma sınırları** — değiştirilemez maddelere dayanan, dolayısıyla hiçbir yamayla değiştirilemeyen üç parametre kümesi:
  - `fy:EsitOySinirlari` (Madde 3 (2)): oy ağırlığı 1; vekâlet sınırı oranı ≤ 0,10; vekâlet zinciri ≤ 5.
  - `fy:AzinlikKorumaSinirlari` (Madde 5): küme tabanı φ ≥ 0,20; yazar kümesi tabanı ≥ 0,50; aşma eşiği ω ≥ 2/3;
    T0–T2 itiraz penceresi ≥ 24 saat; σ_share ≤ 0,20; σ_min ≤ 5; n_C,min ≤ 30.
  - `fy:KalicilastirmaSinirlari` (Madde 6 (2)): τ, ω, ρ ≤ 3/4; q ≤ 0,60; her süre ≤ 720 saat.
- **Kurallar** (`fy:Kural`) — her biri bir maddeye dayanır:

| Kural | Dayanak | Uygulandığı sınıf / tetikleyici | Etki |
|---|---|---|---|
| `fy:KuralKonuOnerisi` | Madde 9 (1) | `fy:KonuOnerisi` | asgari T0 |
| `fy:KuralAltKonuOnerisi` | Madde 9 (1) | `fy:AltKonuOnerisi` | asgari T0 |
| `fy:KuralDuzenlemeOnerisi` | Madde 9 (1) | `fy:DuzenlemeOnerisi` | asgari T1 |
| `fy:KuralYonetmelikOnerisi` | Madde 9 (1) | `fy:YonetmelikOnerisi` | asgari T2 |
| `fy:KuralSilmeOnerisi` | Madde 9 (1) | `fy:SilmeOnerisi` | DEL |
| `fy:KuralHakKisitlamasi` | Madde 4 (2) ⛔ | `fy:HakKisitlayanOneri` | asgari T1 |
| `fy:KuralCekirdekHak` | Madde 4 (1) ⛔ | N3: özü oylanamaz hakkın bağlayıcı kaynaklı kısıtlaması | T3 (ihlal) |
| `fy:KuralDanismaYukseltmesi` | Madde 14 (2) ⛔ | N3: aynı kısıtlama danışma kaynağından | T1 + bilirkişi (uyarı) |
| `fy:KuralBilirkisiKategorisi` | Madde 13 (1) | N3: bilirkişi gerektiren kategori (miras) | bilirkişi |
| `fy:KuralIcerikEtiketi` | Madde 12 (2) | N3: içerik etiketi (yüksek güven 0,70 / orta güven 0,40) | ihlal / uyarı + bilirkişi |
| `fy:KuralGorusAyriligi` | Madde 20 (2) ⛔ | N3: geçersiz silme gerekçesi | ihlal |
| `fy:KuralAcilSilme` | Madde 20 (3) | `fy:AcilSilmeTalebi` | bilgi (daraltma) |
| `fy:KuralDegistirilemezHedef` | Madde 6 (1) ⛔ | N3: yama değiştirilemez hükmü hedefliyor | T3 (ihlal) |
| `fy:KuralYeniDegistirilemez` | Madde 6 (2) ⛔ | N3: yama yeni değiştirilemez hüküm üretiyor | T3 (ihlal) |
| `fy:KuralDegistirilemezAtlatma` | Madde 6 (2) ⛔ | N3: değiştirilemez hükmü `overrides` eden bağlantı | T3 (ihlal) |
| `fy:KuralNitelikliDegisiklik` | Madde 23 (1) | `fy:NitelikliHukumDegisikligi` | τ 3/4, q 0,50 |
| `fy:KuralButce` | Madde 24 (1) | `fy:Butce` | q 0,30, tartışma 96 s |
| `fy:KuralImar` | Madde 24 (2) | `fy:Imar` | tartışma 120 s |
| `fy:KuralVeriKoruma` | Madde 24 (3) | `fy:VeriKoruma` | φ 0,40, τ 0,60 |
| `fy:KuralSaglik` | Madde 24 (4) | `fy:Saglik` | oylama 96 s |

  ⛔ = değiştirilemez maddeye dayanır; kural ve parametreleri değiştirilemez, `overrides` ile devre dışı bırakılamaz.

## 4. N3 çıkarım kuralları

`yonetmelik-kurallar.n3` 34 Horn kuralı içerir ve n3 paketinin `Reasoner`'ı ile (yerleşik, ileri zincirleme, sabit nokta)
T-kutusu + A-kutusu + öneri alt grafı üzerinde çalışır. Sayısal karşılaştırma yapılmaz: içerik etiketlerinin güven düzeyi
(yüksek/orta/düşük) denetimden önce rasyonel karşılaştırmayla atanır, sürüm eşitliği SHACL `sh:equals` ile denetlenir.

| Grup | Kural (özet) |
|---|---|
| K1 sınıf ağacı | `rdfs:subClassOf` geçişli kapanışı; `?x a ?c . ?c ⊑ ?d ⇒ ?x a ?d` |
| K2 kategoriler | karar önerisi kategorisinin ve tüm üst kategorilerinin örneğidir; yönetmelik önerisi *Forum yönetmeliği* kategorisindedir. Silme talepleri kategori sınıflarına girmez. |
| K3 alt konu / düzenleme | `durum "active"` ⇒ `fy:EtkinKonu`; üst/hedef konunun kategorileri miras kalır (`fy:mirasKategori`) |
| K4 bilirkişi | öneri (üst sınıftan miras dahil) `fy:bilirkisiGerekli true` bir kategorinin örneğiyse ⇒ `fy:bilirkisiAlani` + `fy:KuralBilirkisiKategorisi`; yazar talebi ⇒ bilirkişi |
| K5 temel haklar | kısıtlanan hak ⇒ `fy:HakKisitlayanOneri` (T1); özü oylanamaz hakkın **bağlayıcı** kaynaklı kısıtlaması ⇒ `fy:kisitlananCekirdekHak` (ihlal, T3); **danışma** kaynaklı ⇒ `fy:danismaCekirdekHakUyarisi` (uyarı, T1 + bilirkişi) |
| K6 içerik etiketleri | yüksek güven ⇒ `fy:yuksekGuvenliEtiket` (ihlal); orta güven ⇒ `fy:ortaGuvenliEtiket` (uyarı) + bilirkişi |
| K7 silme | `fy:GecersizGerekce` ⇒ `fy:gecersizSilmeGerekcesi` (ihlal); acil / mühürlü gerekçe ⇒ `fy:AcilSilmeTalebi` / `fy:MuhurluSilmeTalebi` |
| K8 değiştirilemez hedef | yama işleminin hedefi değiştirilemez madde **ya da** değiştirilemez maddeye dayanan kural/taşıyıcı ⇒ `fy:degistirilemezHedef` (T3) |
| K9 yeni değiştirilemez | `yeniKoruma Degistirilemez`, değiştirilemez maddeye `dayanak` bağlama, `asgariKatman T3` ⇒ `fy:yeniDegistirilemez` (T3) |
| K10 iki adımlı atlatma | `overrides` değeri değiştirilemez madde ya da ona dayanan kural ⇒ `fy:degistirilemezAtlatma` (T3) |
| K11 nitelikli değişiklik | hedef ya da hedefin dayanağı *Nitelikli*; `overrides` ile nitelikli bir hükmü/kuralı devre dışı bırakma; bir kuralı nitelikli maddeye dayandırma; nitelikli koruma verme ⇒ `fy:NitelikliHukumDegisikligi` |
| K12 genel | `fy:uygulanirSinif` sınıfının örneği olan öneriye kural uygulanır (`fy:uygulananKural`); kuralın `fy:asgariKatman`'ı ve `fy:bilirkisiGerekli`'si öneriye geçer |

## 5. SHACL şekilleri

`yonetmelik-sekiller.ttl` iki grup şekil içerir (`fy:sekilGrubu`):

- **"oneri"** şekilleri her denetimde **birleştirilmiş veri kümesi** (T-kutusu + yönetmelik + öneri + çıkarımlar) üzerinde çalışır:
  başlık uzunluğu, gerekçe kısalığı (uyarı), N3 ihlal/uyarı bayrakları (`sh:maxCount 0`), kategori yokluğu (uyarı), alt konunun
  etkin üst konusu (`sh:class fy:EtkinKonu`), düzenlemenin taban sürümü (`sh:equals fy:guncelSurum` → sürüm çakışması uyarısı),
  silme talebinde tam olarak bir tanımlı gerekçe ve en az bir mesaj, yönetmelik yamasında en az bir işlem.
- **"yonetmelik"** (meta) şekilleri yönetmeliğin kendisini denetler: her maddenin numarası, metni ve tek koruma düzeyi; her kuralın
  tek bir maddeye dayanması (`sh:class fy:Madde`); `overrides` hedefinin kural ya da madde olması; parametre aralıkları
  (0 < q ≤ 1; 0,5 ≤ τ ≤ 1; 0,5 ≤ ω, ρ ≤ 1; diğer oranlar [0, 1]; süreler 0–8760 tamsayı; orta güven eşiği < yüksek güven eşiği).
  Başlangıçta (`init`) yürürlükteki yönetmelik bu şekillere uymazsa servis açılmaz; her yama uygulandıktan sonraki yönetmelik de
  bu şekillere uymak zorundadır.

Her şekil `fy:bulguKodu` (makine kodu) ve `fy:dayanak` (madde) taşır. SHACL sonucu `Finding`'e çevrilir: önem derecesi
(`sh:Violation` → `violation`, `sh:Warning` → `warning`, `sh:Info` → `info`), Türkçe mesaj ("Madde 10 (2): …"),
`article` (madde IRI'si) ve `articleLabel` ("Madde 10 (2)"). İlgili değerler (ör. kısıtlanan hakkın ya da etiketin adı) mesajın
sonuna eklenir.

Başlıca bulgu kodları: `title_length`, `body_short`, `no_category`, `unknown_category`, `core_right_restricted`,
`advisory_core_right_flag`, `content_label_high`, `content_label_medium`, `parent_missing`, `parent_inactive`,
`amendment_base_missing`, `version_conflict`, `amendment_target_inactive`, `deletion_ground_count`, `deletion_ground_unknown`,
`deletion_ground_invalid`, `deletion_no_messages`, `patch_empty`, `immutable_target`, `new_immutable`, `immutable_bypass`,
`protection_floor`, `entrenchment_cap`, `equal_vote_limit`, `param_range`, `overrides_cycle`, `overrides_target`,
`rule_without_article`, `patch_*` (yapısal yama hataları). Bilgi kodları: `tier`, `expert_required`, `inherited_categories`,
`deletion_urgent`, `deletion_sealed`, `qualified_change`, `sponsors`, `rule_overridden`, `advisory_right_flag`.

## 6. Denetim akışı ve katman belirleme

`OntologyService.audit(input)` saf bir okumadır (yan etkisiz):

1. Öneri bir alt grafa çevrilir: tür sınıfı, başlık/metin, açık kategoriler (bilinmeyenler uyarıyla atılır), hak etkileri
   (hak, yön, kaynak), içerik etiketleri (güven düzeyiyle), üst/hedef konu (durum, kategoriler), sürümler, silme gerekçesi
   ve mesaj sayısı, yama işlemleri.
2. Önbellekteki (önceden çıkarımı yapılmış) T-kutusu + A-kutusu ile birleştirilir ve N3 kuralları uygulanır.
3. "oneri" SHACL şekilleri birleştirilmiş veri kümesi üzerinde çalışır.
4. Yönetmelik önerisinde yama ayrıca yürürlükteki A-kutusunun kopyasına uygulanır ve meta-kurallar denetlenir (§8).
5. Katman, kurallar ve parametreler hesaplanır.

**Katman:**

| Öneri türü | Katman |
|---|---|
| konu / alt konu | T0; bir temel hak **kısıtlanıyorsa** T1 |
| düzenleme | T1 |
| yönetmelik | T2; değiştirilemez bir hükmü hedefliyor ya da korumayı zayıflatıyorsa **T3** (geçersiz, `admissible = false`, `params = null`) |
| silme | DEL |

Katman, uygulanan (ve `overrides` ile devre dışı kalmamış) kuralların `fy:asgariKatman` değerlerinin en yükseğidir; tür
tabanının altına inemez. T3 kodlu bir ihlal (özü oylanamaz hak, değiştirilemez hedef, yeni değiştirilemez hüküm, atlatma,
koruma tabanı, kalıcılaştırma sınırı) katmanı T3 yapar.

**Hak etkisi kaynakları ("yalnızca yükseltme"):** Kaynağı `author` (yazar beyanı) ya da `expert` (bilirkişi tespiti) olan bir
özü oylanamaz hak kısıtlaması (*Eşitlik ve ayrımcılık yasağı*, *Katılım ve oy hakkı*) T3 ihlalidir. Kaynağı `ai` (yapay zekâ)
ya da `member` (yazar dışındaki üyenin eklediği bayrak) olan aynı kısıtlama öneriyi **yalnızca** T1'e yükseltir, uyarı üretir ve
bilirkişi incelemesi gerektirir; öneriyi asla geçersiz kılmaz (Madde 14 (2)). Böylece ne bir yapay zekâ yanlış pozitifi ne de
herhangi bir üye bir bayrakla öneriyi düşüremez; ama hiçbir bayrak sessizce yok sayılmaz.

**İçerik etiketleri:** güven ≥ 0,70 → ihlal (Madde 12 (2)); 0,40 ≤ güven < 0,70 → uyarı + bilirkişi; daha düşük → etkisiz.
Eşikler `fy:KuralIcerikEtiketi` parametreleridir ve rasyonel olarak karşılaştırılır.

**Alt konu:** üst konu yoksa ya da etkin değilse ihlal; üst konunun kategorileri mirasa eklenir (ve onların kuralları uygulanır).
**Düzenleme:** `baseVersion ≠ currentVersion` → uyarı (yürürlüğe girişte "sürüm çakışması" ile reddedilecek).
**Silme:** tam olarak bir geçerli `fy:SilmeGerekcesi`; `fy:GorusAyriligi` → değiştirilemez Madde 20 (2)'ye atıflı ihlal;
en az bir mesaj. Kategori kuralları ve kategori bilirkişi gereksinimi silme taleplerine uygulanmaz.

## 7. "En koruyucu kazanır" parametre birleştirme

Bir öneriye katmanın parametreleri ve uygulanan her kuralın geçersiz kılmaları birlikte uygulanır. Her parametre için en koruyucu
değer seçilir:

- q, τ, φ, ω, ρ (ve DEL'de yazar kümesi tabanı) → **en büyüğü** (rasyonel karşılaştırma, `toRational`);
- `thresholdStrict` → **VEYA** (biri kesinse kesin);
- `requiresExpert` → **VEYA** (kategori, danışma bayrağı, orta güvenli etiket, yazar talebi);
- süreler → **en uzunu**.

Örnek: *Kişisel verilerin korunması* kategorisindeki bir T0 konu önerisi için τ = max(1/2, 3/5) = 3/5 ve T0'ın kesinliği
korunur (a > 3/5); φ = max(3/10, 2/5) = 2/5. *Katılımcı bütçe* + *Deprem güvenliği* + *Halk sağlığı* kategorilerindeki bir
öneride q = 3/10 (bütçe), tartışma 120 saat (imar), oylama 96 saat (sağlık).

Kurallar parametreyi yalnızca yükseltebilir; bir kuralın `overrides` ile başka bir (olağan) kuralı devre dışı bırakması en çok katman
tabanına dönmeyi sağlar. Değiştirilemez maddeye dayanan kurallar hiçbir zaman devre dışı kalmaz.

`DecisionParams` alanları: `tier`, `quorum`, `threshold`, `thresholdStrict`, `clusterFloor`, `authorClusterFloor` (yalnız DEL'de 1/2),
`overrideThreshold`, `revoteThreshold`, `significantShare`, `significantMinMembers`, `minVotesPerCluster`, `minClusteredForBridge`,
`coldStartBump`, `delegationCapFraction`, `delegationMaxHops`, `sponsorsRequired` (K_s = max(2, min(5, ⌈√|M|/2⌉)); DEL için 1),
`requiresExpert`, `expertCount` (3), `expertDomains` (bilirkişi gerektiren açık/miras kategoriler, en özelden genele; yoksa önerinin
kategorileri), `durationsHours`.

## 8. Sürümleme ve meta-kurallar

A-kutusu `bylaw_versions` tablosunda sürümlenir (`version`, `ttl`, `hash`, `via_proposal_id`, `ledger_tx`, `created_at`).
`init()` tablo boşsa sürüm 1'i `yonetmelik.ttl`'den ekler, değilse son sürümün Turtle metnini yükler. Sürüm özeti, A-kutusunun
**sıralı ve tekilleştirilmiş N-Triples satırlarının SHA-256'sıdır** (A-kutusunda boş düğüm yoktur, bu nedenle kanoniktir). Yeni sürümün
Turtle çıktısı belirlenimcidir (öznelere göre sıralı); yeniden ayrıştırıldığında aynı özeti verir.

Yama işlemleri (`RegulationPatchOp`):

| İşlem | Anlamı |
|---|---|
| `setParam {rule, param, value}` | Bir katmanın, parametre kümesinin ya da kuralın parametresini değiştirir. `rule` tam ya da `fy:` önekli IRI; `param` yerel ad (`yeterSayi`, `sureTartisma` …). Kurallarda bağlantı "parametreleri" de vardır: `dayanak`, `uygulanirSinif`, `asgariKatman`, `overrides` (değer IRI; `overrides` için `""` kaldırır). Var olmayan bir IRI'ye `setParam` yeni bir kural oluşturur (dayanak zorunlu). Bir maddeye yalnızca `overrides` verilebilir. |
| `addCategory {iri, label, parent, keywords, requiresExpert?}` | Yeni kategori (üst: var olan kategori ya da `fy:Kategori`) |
| `amendArticleText {article, text}` | Madde metnini değiştirir |
| `addArticle {iri, number, title, text, protection}` | Yeni madde (Olağan ya da Nitelikli) |
| `setProtection {article, protection}` | Koruma düzeyini değiştirir |

`validatePatch(patch)` bir yönetmelik önerisi denetimidir (katman T2 ya da T3) ve şu **meta-kuralları** uygular:

1. **Aralıklar** (Madde 23 (2), meta-şekiller): 0 < q ≤ 1; 0,5 ≤ τ ≤ 1; oranlar [0, 1]; süreler tamsayı ve 0–8760.
2. **Değiştirilemez çekirdek** (Madde 6 (1), T3): değiştirilemez bir maddeyi ya da ona dayanan bir kuralı/taşıyıcıyı değiştiren,
   koruma düzeyini düşüren her işlem yasaktır. N3 kuralı (K8) bayrağı üretir; ayrıca yamalı yönetmelik ile yürürlüktekinin
   değiştirilemez öznelerinin üçlüleri karşılaştırılır (hiçbir dolaylı değişiklik kaçmaz).
3. **Yeni değiştirilemez hüküm üretilemez** (Madde 6 (2), T3): `setProtection → Degistirilemez`, değiştirilemez korumalı
   `addArticle`, bir kuralı değiştirilemez maddeye `dayanak` olarak bağlama, bir kuralı T3 katmanına bağlama. Gerekçe: aksi halde
   bugünkü çoğunluk kendi politikasını kalıcılaştırabilirdi.
4. **İki adımlı atlatma yasağı** (Madde 6 (2), T3): değiştirilemez bir hükmü `overrides` eden yeni madde/kural (aynı yamada ya da
   önce madde ekleyip sonraki yamada bağlama — her yama yürürlükteki duruma göre denetlendiği için ikisi de yakalanır).
5. **Koruma tabanları** (Madde 5, T3): φ ≥ 0,20; yazar kümesi tabanı ≥ 0,50; ω ≥ 2/3; T0–T2 itiraz penceresi ≥ 24 saat;
   σ_share ≤ 0,20; σ_min ≤ 5; n_C,min ≤ 30 (köprü testini "teknik olarak" kapatmayı önler).
6. **Kalıcılaştırma sınırları** (Madde 6 (2), T3): τ, ω, ρ ≤ 3/4; q ≤ 0,60; süreler ≤ 720 saat — çoğunluğun değişikliği
   imkânsızlaştırarak kendini kilitlemesini ve azınlığın mutlak veto kazanmasını önler.
7. **Eşit oy sınırları** (Madde 3 (2), T3): vekâlet sınırı oranı ≤ 0,10, vekâlet zinciri ≤ 5.
8. **`overrides` döngüsüz** (Madde 6 (3)): döngü ya da tanımsız hedef ihlaldir (T2, kabul edilemez).
9. **Her kural bir maddeye dayanır** (Madde 11 (2)).
10. **Nitelikli hüküm** (Madde 23 (1)): hedef ya da hedefin dayanağı *Nitelikli* ise — ya da yama nitelikli bir hükmü `overrides` ile devre dışı bırakıyor, bir kuralı nitelikli maddeye dayandırıyor veya nitelikli koruma veriyorsa — τ 3/4, q 0,50 uygulanır (dolaylı yoldan nitelikli korumayı aşmak da nitelikli çoğunluk ister).

`applyPatch(patch, proposalId)` yamayı yeniden denetler, geçersizse 422 `bylaw_patch_invalid` fırlatır; geçerliyse yeni sürümü
(`version + 1`, yeni Turtle, yeni özet, `via_proposal_id`) yazar ve `BylawVersionInfo` döndürür (`ledgerTx: null` — `BYLAW_VERSION`
defter kaydını çağıran yapar ve `bylaw_versions.ledger_tx`'i günceller). Sonraki `audit` çağrıları yeni sürümü kullanır. Oylamaya açılmış
önerilerin parametreleri sabitlendiği için değişiklik geriye etkili değildir (Madde 9 (4)).

## 9. Forum Yönetmeliği — tam metin

Koruma düzeyleri: **Değiştirilemez** (oylanamaz; T3), Nitelikli (değişikliği 3/4 eşik ve 0,50 yeter sayıyla), Olağan.

### Birinci Bölüm — Genel Hükümler ve Temel İlkeler

#### Madde 1 — Amaç ve kapsam

- **Madde 1 (1)** · Olağan · `fy:Madde_1_1`  
  Bu Yönetmelik; Forum Sistemi'nde konu açma, alt konu önerme, düzenleme teklif etme, tartışma, oylama, tartışma içeriğinin karartılması ve Yönetmeliğin değiştirilmesi usul ve esaslarını düzenler.
- **Madde 1 (2)** · Olağan · `fy:Madde_1_2`  
  Yönetmelik makinece okunabilir bir ontoloji olarak tutulur. Her öneri, oylamaya sunulmadan önce bu ontolojiye göre otomatik olarak denetlenir; denetim, uygulanan kuralları ve dayandıkları maddeleri gösterir.

#### Madde 2 — Tanımlar

- **Madde 2** · Olağan · `fy:Madde_2`  
  Bu Yönetmelikte geçen; a) Üye: kimliği kayıt memurunca doğrulanmış gerçek kişiyi, b) Öneri: konu, alt konu, düzenleme, silme (karartma) veya Yönetmelik değişikliği teklifini, c) Katman: önerinin yeter sayı, eşik ve sürelerini belirleyen karar sınıfını (T0, T1, T2, T3, DEL), ç) Görüş kümesi: oylama açılışında dondurulan, geçmiş oylardan hesaplanmış görüş gruplarını, d) Köprü testi: anlamlı her görüş kümesinde asgari destek aranmasını, e) Karartma: bir mesajın silinmeden görünürlüğünün kaldırılmasını ifade eder.

#### Madde 3 — Eşit oy

- **Madde 3 (1)** · **Değiştirilemez** · `fy:Madde_3_1`  
  Her üyenin bir ve yalnızca bir oyu vardır; bütün oylar eşit ağırlıktadır. Hiçbir kural, rol, itibar puanı veya vekâlet bir üyeye birden fazla oy kazandıramaz.
- **Madde 3 (2)** · **Değiştirilemez** · `fy:Madde_3_2`  
  Vekâletle kullanılan oy vekâlet verenin kendi oyudur ve onun görüş kümesine sayılır. Bir delegenin taşıyabileceği başkasına ait oy sayısı ve vekâlet zincirinin uzunluğu sınırlıdır; bu sınırlar uygun seçmenlerin %10'unu ve beş adımı aşacak biçimde genişletilemez.

#### Madde 4 — Temel haklar

- **Madde 4 (1)** · **Değiştirilemez** · `fy:Madde_4_1`  
  Eşitlik ve ayrımcılık yasağı ile katılım ve oy hakkının özü oylamaya konulamaz. Yazarın beyanına veya bilirkişi tespitine göre bu hakların özünü kısıtlayan öneri, oylamaya sunulmadan kural gereği geçersiz sayılır (T3).
- **Madde 4 (2)** · **Değiştirilemez** · `fy:Madde_4_2`  
  İfade özgürlüğü, özel hayatın gizliliği ve kişisel verilerin korunması, mülkiyet, toplanma ve örgütlenme, hizmetlere erişim ve sağlık hakları ancak ölçülü olarak ve en az nitelikli katmanda (T1) karara bağlanan önerilerle sınırlanabilir.

#### Madde 5 — Azınlığın korunması

- **Madde 5 (1)** · **Değiştirilemez** · `fy:Madde_5_1`  
  Bir öneri, genel çoğunluğun yanında anlamlı her görüş kümesinden asgari destek almadıkça ilk oylamada kabul edilemez (köprü testi). Küme tabanı hiçbir katmanda 0,20'nin, silme kararlarında mesaj yazarının kendi kümesi için aranan taban 0,50'nin altına indirilemez; anlamlı küme payı 0,20'nin, anlamlı küme asgari üye sayısı 5'in, köprü testi için gereken asgari kümelenmiş üye sayısı 30'un üzerine çıkarılamaz.
- **Madde 5 (2)** · **Değiştirilemez** · `fy:Madde_5_2`  
  Köprü testini geçemeyen öneri için uzlaşma turu açılır. Yeniden oylamada aşma eşiği hiçbir katmanda 2/3'ün altına indirilemez; böylece azınlığın gücü erteleyicidir ve kararın yeniden düşünülmesini sağlar.
- **Madde 5 (3)** · **Değiştirilemez** · `fy:Madde_5_3`  
  İlk oylamada kabul edilen karara karşı red oyu veren üyelerin itiraz hakkı kaldırılamaz; T0, T1 ve T2 katmanlarında itiraz penceresi 24 saatten kısa olamaz.

#### Madde 6 — Değiştirilemez hükümlerin korunması

- **Madde 6 (1)** · **Değiştirilemez** · `fy:Madde_6_1`  
  “Değiştirilemez” koruma düzeyindeki hükümler ile bunlara dayanan kural ve parametreler değiştirilemez, kaldırılamaz, koruma düzeyleri düşürülemez ve oylamaya sunulamaz. Bunları hedefleyen öneriler değiştirilemez katmandadır (T3) ve kural gereği geçersizdir.
- **Madde 6 (2)** · **Değiştirilemez** · `fy:Madde_6_2`  
  Hiçbir değişiklikle yeni bir “Değiştirilemez” hüküm üretilemez; bir kural değiştirilemez bir hükme dayandırılamaz ve bir hüküm, değiştirilemez bir hükmü önceliklendirme (overrides) yoluyla etkisizleştiremez. Çoğunluğun kendi politikasını kalıcılaştırmasını önlemek için hiçbir kural onay eşiğini, aşma eşiğini veya yeniden oylama eşiğini 3/4'ün, yeter sayıyı 0,60'ın, herhangi bir süreyi 720 saatin üzerine çıkaramaz ve bir öneri türünü değiştirilemez katmana bağlayamaz.
- **Madde 6 (3)** · **Değiştirilemez** · `fy:Madde_6_3`  
  Hükümler arasındaki önceliklendirme (overrides) ilişkileri döngü içeremez; önceliklendirilen hüküm Yönetmelikte bulunmalıdır.

### İkinci Bölüm — Öneriler ve Denetim

#### Madde 7 — Öneri hakkı

- **Madde 7 (1)** · Olağan · `fy:Madde_7_1`  
  Her üye konu açabilir, kabul edilmiş bir konuya alt konu önerebilir ve yürürlükteki bir konu için düzenleme teklif edebilir. Önerinin 3 ile 200 karakter arasında anlaşılır bir başlığı ve gerekçesi bulunur.
- **Madde 7 (2)** · Olağan · `fy:Madde_7_2`  
  Öneri, Madde 9 (3)'te belirtilen sayıda üyenin desteğini (eş imza) toplayınca denetime girer; destek toplama süresi dolan öneri düşer.

#### Madde 8 — Kategoriler

- **Madde 8 (1)** · Olağan · `fy:Madde_8_1`  
  Konu, alt konu, düzenleme ve Yönetmelik önerileri en az bir kategoriye bağlanır. Kategoriler bir sınıf ağacı oluşturur; bir alt kategoriye bağlanan öneri, üst kategorilerine de bağlı sayılır ve onların kurallarına tabidir. Silme (karartma) talepleri kategori kurallarına tabi değildir.
- **Madde 8 (2)** · Nitelikli · `fy:Madde_8_2`  
  Kategori ve hak etkisi etiketleri yalnızca yükseltilebilir: her üye ve yapay zekâ etiket ekleyebilir; eklenen bir etiketi yalnızca bilirkişi kaldırabilir. Danışma niteliğindeki bu etiketler öneriyi en çok nitelikli katmana yükseltir, tek başına geçersiz kılmaz.

#### Madde 9 — Katmanlar

- **Madde 9 (1)** · Nitelikli · `fy:Madde_9_1`  
  Yeni konu ve alt konu önerileri olağan katmanda (T0); kabul edilmiş bir konunun düzenlenmesi nitelikli katmanda (T1); Yönetmelik değişiklikleri T2 katmanında; tartışma içeriğinin karartılması DEL katmanında karara bağlanır. Değiştirilemez hükümleri hedefleyen öneriler T3 katmanındadır ve oylanamaz.
- **Madde 9 (2)** · Nitelikli · `fy:Madde_9_2`  
  Her katmanın yeter sayısı, onay eşiği, küme tabanı, aşma ve yeniden oylama eşikleri ile süreleri, katman parametreleri ve genel parametrelerle belirlenir. Bir öneriye birden çok kural uygulanıyorsa her parametre için en koruyucu değer geçerlidir: eşiklerde ve tabanlarda en yükseği, sürelerde en uzunu.
- **Madde 9 (3)** · Nitelikli · `fy:Madde_9_3`  
  Gerekli destekçi sayısı, doğrulanmış üye sayısı |M| olmak üzere max(2, min(5, ⌈√|M|/2⌉)) olup silme taleplerinde talep edene ek olarak bir destekçidir.
- **Madde 9 (4)** · Nitelikli · `fy:Madde_9_4`  
  Oylama parametreleri oylama açıldığı anda öneriye sabitlenir; sonradan yapılan Yönetmelik değişiklikleri geriye etkili olmaz.

#### Madde 10 — Alt konu ve düzenleme

- **Madde 10 (1)** · Olağan · `fy:Madde_10_1`  
  Alt konu yalnızca yürürlükte ve etkin olan bir konunun altında önerilebilir. Alt konu, üst konunun kategorilerini miras alır; yeni kategori eklenebilir.
- **Madde 10 (2)** · Olağan · `fy:Madde_10_2`  
  Düzenleme teklifi, yürürlükteki bir konunun belirli bir sürümüne (taban sürüm) dayanır. Kabul anında konunun güncel sürümü taban sürümden farklıysa teklif sürüm çakışması gerekçesiyle reddedilir.

#### Madde 11 — Ontoloji denetimi

- **Madde 11 (1)** · Nitelikli · `fy:Madde_11_1`  
  Yeterli desteği toplayan her öneri; kategori, hak etkisi, içerik etiketi ve usul bakımından otomatik denetimden geçer. İhlal içeren öneri oylamaya sunulmaz ve gerekçesiyle “kabul edilemez” olarak kaydedilir; uyarılar öneriyle birlikte gösterilir.
- **Madde 11 (2)** · Nitelikli · `fy:Madde_11_2`  
  Her kural Yönetmelikteki bir maddeye dayanır. Denetim sonucu, uygulanan kurallar ve dayandıkları maddeler öneriye eklenir ve herkese açıktır.

#### Madde 12 — İçerik ilkeleri

- **Madde 12 (1)** · Olağan · `fy:Madde_12_1`  
  Öneriler ve tartışma mesajları kişisel veri ifşası, tehdit, hakaret veya iftira, korunan gruplara yönelik nefret söylemi, spam veya reklam ve telif ihlali içeremez.
- **Madde 12 (2)** · Nitelikli · `fy:Madde_12_2`  
  Otomatik içerik etiketlemesinde güveni yüksek güven eşiğine (0,70) ulaşan yasak içerik etiketi öneriyi kabul edilemez kılar; yazar metni düzelterek yeniden sunabilir. Güveni orta güven eşiği (0,40) ile yüksek güven eşiği arasında kalan etiketler uyarı olarak gösterilir ve bilirkişi incelemesi gerektirir.

#### Madde 13 — Bilirkişi

- **Madde 13 (1)** · Nitelikli · `fy:Madde_13_1`  
  Bilirkişi gerektiren bir kategoriye ya da böyle bir kategorinin alt kategorisine bağlanan öneriler, yazarın veya uygun seçmenlerin en az %10'unun talep ettiği öneriler ve danışma kaynaklı temel hak bayrağı taşıyan öneriler için tohumlu ağırlıklı kura ile en az üç bilirkişiden oluşan panel çekilir.
- **Madde 13 (2)** · **Değiştirilemez** · `fy:Madde_13_2`  
  Bilirkişi danışmandır: raporu oylamayı bağlamaz, hukuki nitelendirme yapamaz ve bilirkişinin oyu her üyeninki gibi birdir.
- **Madde 13 (3)** · Olağan · `fy:Madde_13_3`  
  Öneri yazarıyla aile, iş veya hane bağı bulunan ya da çıkar çatışması beyan eden bilirkişi panele alınmaz.

#### Madde 14 — Yapay zekâ

- **Madde 14 (1)** · **Değiştirilemez** · `fy:Madde_14_1`  
  Yapay zekâ yalnızca danışmandır: oy veremez, bir önerinin veya mesajın durumunu değiştiremez ve içerik gizleyemez. Ürettiği her çıktı “Yapay zekâ ile üretildi” etiketi, model adı ve tarihle gösterilir.
- **Madde 14 (2)** · **Değiştirilemez** · `fy:Madde_14_2`  
  Yapay zekânın veya bir üyenin eklediği temel hak bayrağı öneriyi yalnızca nitelikli katmana (T1) yükseltir ve özü oylanamaz bir hakla ilgiliyse bilirkişi incelemesi gerektirir; bu bayrak tek başına öneriyi değiştirilemez hükme aykırı sayıp geçersiz kılamaz.

### Üçüncü Bölüm — Oylama ve Karar

#### Madde 15 — Gizli oy

- **Madde 15 (1)** · **Değiştirilemez** · `fy:Madde_15_1`  
  Oylar gizlidir. Oylama sürerken ara sonuçlar açıklanmaz; yalnızca katılım gösterilir.
- **Madde 15 (2)** · **Değiştirilemez** · `fy:Madde_15_2`  
  Oy ile oy verenin kimliği arasındaki bağ hiçbir kamuya açık kayıtta tutulmaz; dağıtık defterde yalnızca oylamaya özgü oy pusulası kimlikleri, taahhütler ve oylama sonunda açıklanan pusulalar yer alır.

#### Madde 16 — Karar kuralı

- **Madde 16 (1)** · Nitelikli · `fy:Madde_16_1`  
  Bir öneri; katılım yeter sayısına ulaşılması, onay oranının katman eşiğini sağlaması ve köprü testinin geçilmesiyle kabul edilir. Çekimser oylar katılıma sayılır, onay oranına sayılmaz.
- **Madde 16 (2)** · Nitelikli · `fy:Madde_16_2`  
  Yeterli görüş verisi yoksa köprü testi uygulanmaz; bu durumda onay eşiği soğuk başlangıç artışı kadar (en fazla 2/3'e) yükseltilir.
- **Madde 16 (3)** · Olağan · `fy:Madde_16_3`  
  Katılım ya da anlamlı bir kümedeki oy sayısı yetersizse oylama bir kez uzatılır.

#### Madde 17 — Uzlaşma ve itiraz

- **Madde 17 (1)** · Nitelikli · `fy:Madde_17_1`  
  Köprü testini geçemeyen ya da geçerli bir itiraza uğrayan öneri için uzlaşma turu açılır; bu turda azınlık raporu yazılabilir ve metin revize edilebilir. Uzlaşmadan sonraki yeniden oylamanın sonucu kesindir.
- **Madde 17 (2)** · Olağan · `fy:Madde_17_2`  
  Bir öneri en fazla bir uzlaşma turu yaşar. Her üye 30 günde en fazla iki itiraz imzalayabilir.

#### Madde 18 — Vekâlet

- **Madde 18 (1)** · Olağan · `fy:Madde_18_1`  
  Üye oyunu kategori kapsamlı ya da genel olarak başka bir üyeye devredebilir; doğrudan oy her zaman vekâletten önce gelir. Kapsamlar en özel kategoriden genele doğru aranır.
- **Madde 18 (2)** · Nitelikli · `fy:Madde_18_2`  
  Vekâlet zinciri en fazla vekâlet azami adım sayısı kadar izlenir; bir delegenin taşıyabileceği başkasına ait oy sayısı, uygun seçmenlerin vekâlet sınırı oranı kadarını (en az 2) aşamaz.

### Dördüncü Bölüm — Tartışma ve Karartma

#### Madde 19 — Tartışma kayıtlarının korunması

- **Madde 19 (1)** · **Değiştirilemez** · `fy:Madde_19_1`  
  Tartışma kayıtları silinmez. Bir mesaj ancak silme (karartma) kararıyla görünmez kılınabilir; yerinde karar numarasını ve gerekçeyi gösteren bir iz kalır, mesajın eski sürümleri ve içerik özeti saklanır.
- **Madde 19 (2)** · **Değiştirilemez** · `fy:Madde_19_2`  
  Karartılan mesajın yazarı, karartılamayan bir cevap ekleme hakkına sahiptir.

#### Madde 20 — Silme (karartma)

- **Madde 20 (1)** · Nitelikli · `fy:Madde_20_1`  
  Silme talebi en az bir hedef mesajı ve şu gerekçelerden tam olarak birini içerir: kişisel veri ifşası, tehdit, hakaret veya iftira, korunan gruba nefret söylemi, spam veya reklam, telif ihlali.
- **Madde 20 (2)** · **Değiştirilemez** · `fy:Madde_20_2`  
  Görüş ayrılığı, bir görüşe katılmamak veya bir görüşü yanlış bulmak silme gerekçesi olamaz.
- **Madde 20 (3)** · Olağan · `fy:Madde_20_3`  
  Kişisel veri ifşası ve tehdit gerekçeli taleplerde ilgili mesaj karar beklenirken daraltılır; kişisel veri ifşası gerekçesiyle karartılan mesaj mühürlenir.
- **Madde 20 (4)** · Nitelikli · `fy:Madde_20_4`  
  Silme kararı DEL katmanında; 2/3 onay, köprü testi ve mesaj yazarının kendi görüş kümesinde en az yazar kümesi tabanı kadar destekle alınır. Mesajın yazarı bu oylamada seçmen değildir.

### Beşinci Bölüm — Kişisel Veriler ve Kayıtlar

#### Madde 21 — Kişisel veriler

- **Madde 21 (1)** · **Değiştirilemez** · `fy:Madde_21_1`  
  Ad, soyad, T.C. kimlik numarası, adres, doğum tarihi, e-posta ve telefon gibi kişisel veriler, şifreli halleri dahil, dağıtık defterde tutulmaz; defterde yalnızca özetler, taahhütler ve kimlik içermeyen sayılar bulunur.
- **Madde 21 (2)** · Nitelikli · `fy:Madde_21_2`  
  Kimlik verileri alan bazında şifreli kasada saklanır; bunlara yalnızca yetkili kayıt memuru veya denetçi, amacını belirterek ve erişim kaydı bırakarak ulaşabilir.
- **Madde 21 (3)** · **Değiştirilemez** · `fy:Madde_21_3`  
  Üyenin kendi kişisel verilerinin silinmesi talebi oylamaya konulmaz; kripto-imha yoluyla yerine getirilir.

#### Madde 22 — Şeffaflık ve dağıtık defter

- **Madde 22** · Olağan · `fy:Madde_22`  
  Faz geçişleri, sayım sonuçları ve girdileri, bilirkişi kuraları, yapay zekâ çıktı özetleri ve Yönetmelik sürümleri dağıtık deftere yazılır. Her üye sayımı defterdeki bültenden bağımsız olarak yeniden hesaplayabilir.

### Altıncı Bölüm — Yönetmelik Değişikliği ve Kategoriye Özgü Kurallar

#### Madde 23 — Değişiklik usulü

- **Madde 23 (1)** · Nitelikli · `fy:Madde_23_1`  
  Yönetmelik değişikliği yapılandırılmış bir yama olarak önerilir ve T2 katmanında karara bağlanır. “Nitelikli” koruma düzeyindeki bir hükmü ya da ona dayanan bir kural veya parametreyi değiştiren önerilerde onay eşiği en az 3/4, yeter sayı en az 0,50'dir.
- **Madde 23 (2)** · Nitelikli · `fy:Madde_23_2`  
  Hiçbir değişiklik yeter sayıyı 0 veya altına ya da 1'in üzerine, onay eşiğini 0,50'nin altına ya da 1'in üzerine çekemez; diğer oranlar 0 ile 1, süreler 0 ile 8760 saat arasında olur.
- **Madde 23 (3)** · Olağan · `fy:Madde_23_3`  
  Kabul edilen her değişiklik yeni bir Yönetmelik sürümü üretir. Sürümün özeti dağıtık deftere yazılır; eski sürümler saklanır ve görüntülenebilir.

#### Madde 24 — Kategoriye özgü kurallar

- **Madde 24 (1)** · Olağan · `fy:Madde_24_1`  
  Bütçe ve mali işler kategorisindeki önerilerde yeter sayı en az 0,30, tartışma süresi en az 96 saattir.
- **Madde 24 (2)** · Olağan · `fy:Madde_24_2`  
  İmar ve kentsel dönüşüm kategorisindeki (deprem güvenliği dahil) önerilerde tartışma süresi en az 120 saattir.
- **Madde 24 (3)** · Olağan · `fy:Madde_24_3`  
  Kişisel verilerin korunması kategorisindeki önerilerde küme tabanı en az 0,40, onay eşiği en az 0,60'tır.
- **Madde 24 (4)** · Olağan · `fy:Madde_24_4`  
  Sağlık kategorisindeki önerilerde oylama süresi en az 96 saattir.

## 10. Kategori ağacı

Kökler `fy:Kategori`'nin alt sınıfıdır; çocuklar etikete göre sıralıdır. "Bilirkişi gerekli" işareti mirası da gösterir.
Anahtar kelimeler çevrimdışı sınıflandırmada kullanılır.

- **Bütçe ve mali işler** (`fy:Butce`) — *bilirkişi gerekli*: bütçe, gelir, harcama, kaynak, maliyet, ödenek
  - **Katılımcı bütçe** (`fy:KatilimciButce`) — *bilirkişi gerekli*: katılımcı bütçe, mahalle bütçesi, öncelik, proje bütçesi
  - **Vergi, harç ve ücretler** (`fy:VergiHarc`) — *bilirkişi gerekli*: abonelik, harç, tarife, ücret, vergi, zam
- **Çevre** (`fy:Cevre`): çevre, doğa, iklim, kirlilik
  - **Atık ve geri dönüşüm** (`fy:AtikGeriDonusum`): atık, çöp, geri dönüşüm, kompost, konteyner, plastik
  - **Enerji** (`fy:Enerji`) — *bilirkişi gerekli*: aydınlatma, elektrik, enerji, güneş paneli, verimlilik, yenilenebilir
  - **Hava kalitesi** (`fy:HavaKalitesi`): duman, egzoz, emisyon, hava kalitesi, toz
  - **Parklar ve yeşil alanlar** (`fy:YesilAlan`): ağaç, bahçe, fidan, oyun alanı, park, yeşil alan
- **Eğitim** (`fy:Egitim`): ders, eğitim, öğrenci, öğretmen
  - **Kütüphane ve yaşam boyu öğrenme** (`fy:Kutuphane`): atölye, kitap, kurs, kütüphane, yetişkin eğitimi
  - **Okullar** (`fy:Okullar`): okul, servis, sınıf, teneffüs, veli
- **İmar ve kentsel dönüşüm** (`fy:Imar`) — *bilirkişi gerekli*: bina, imar, kentsel dönüşüm, ruhsat, yapı
  - **Deprem güvenliği** (`fy:DepremGuvenligi`) — *bilirkişi gerekli*: afet, deprem, güçlendirme, toplanma alanı, zemin
  - **Konut** (`fy:Konut`) — *bilirkişi gerekli*: barınma, ev, kira, konut, sosyal konut
- **Kamu güvenliği** (`fy:KamuGuvenligi`): devriye, güvenlik, kamera, zabıta
  - **Acil durum ve afet hazırlığı** (`fy:AcilDurum`) — *bilirkişi gerekli*: acil, afet planı, sel, tahliye, yangın
- **Kültür, sanat ve spor** (`fy:KulturSpor`): festival, konser, kültür, sanat
  - **Etkinlikler** (`fy:Etkinlik`): etkinlik, sergi, sinema, şenlik, tiyatro
  - **Spor** (`fy:Spor`): saha, spor, spor salonu, turnuva, yüzme
- **Sağlık** (`fy:Saglik`) — *bilirkişi gerekli*: aşı, doktor, hasta, hastane, sağlık
  - **Halk sağlığı** (`fy:HalkSagligi`) — *bilirkişi gerekli*: halk sağlığı, hijyen, ilaçlama, salgın, su kalitesi
  - **Psikolojik destek** (`fy:PsikolojikDestek`) — *bilirkişi gerekli*: danışmanlık, psikolojik, ruh sağlığı, stres, terapi
- **Sosyal hizmetler** (`fy:SosyalHizmet`): aşevi, dayanışma, gönüllü, sosyal yardım
  - **Çocuk ve gençlik** (`fy:CocukGenclik`): çocuk, genç, gençlik merkezi, kreş
  - **Engelli erişimi** (`fy:EngelliErisimi`): asansör, engelli, erişilebilirlik, işaret dili, rampa, tekerlekli sandalye
  - **Yaşlı bakımı** (`fy:YasliBakim`): emekli, evde bakım, huzurevi, yaşlı
- **Ulaşım** (`fy:Ulasim`): araç, durak, trafik, ulaşım, yol
  - **Bisiklet ve yaya** (`fy:BisikletYaya`): bisiklet, kaldırım, scooter, yaya, yürüyüş
  - **Otopark ve trafik düzeni** (`fy:OtoparkTrafik`): hız, kavşak, otopark, park yeri, sinyalizasyon
  - **Toplu taşıma** (`fy:TopluTasima`): dolmuş, hat, metro, minibüs, otobüs, sefer, toplu taşıma, tramvay
- **Yönetişim ve şeffaflık** (`fy:Yonetisim`): forum, karar, katılım, yönetişim
  - **Forum yönetmeliği** (`fy:ForumYonetmeligi`): eşik, madde, oylama kuralı, usul, yeter sayı, yönetmelik
  - **Kişisel verilerin korunması** (`fy:VeriKoruma`) — *bilirkişi gerekli*: fişleme, gizlilik, kamera kaydı, kişisel veri, kvkk, veri paylaşımı
  - **Şeffaflık ve hesap verebilirlik** (`fy:Seffaflik`): açık veri, denetim, hesap verebilirlik, rapor, şeffaflık

## 11. Temel haklar, gerekçeler ve içerik etiketleri

### Temel haklar

| Hak | IRI | Dayanak | Kısıtlanması |
|---|---|---|---|
| Eşitlik ve ayrımcılık yasağı | `fy:EsitlikAyrimcilikYasagi` | Madde 4 (1) | özü oylanamaz: yazar/bilirkişi beyanıyla T3 (geçersiz); YZ/üye bayrağıyla T1 + bilirkişi |
| Hizmetlere erişim hakkı | `fy:ErisimHakki` | Madde 4 (2) | en az T1 |
| İfade özgürlüğü | `fy:IfadeOzgurlugu` | Madde 4 (2) | en az T1 |
| Katılım ve oy hakkı | `fy:KatilimHakki` | Madde 4 (1) | özü oylanamaz: yazar/bilirkişi beyanıyla T3 (geçersiz); YZ/üye bayrağıyla T1 + bilirkişi |
| Mülkiyet hakkı | `fy:MulkiyetHakki` | Madde 4 (2) | en az T1 |
| Özel hayatın gizliliği ve kişisel verilerin korunması | `fy:OzelHayatinGizliligi` | Madde 4 (2) | en az T1 |
| Sağlık hakkı | `fy:SaglikHakki` | Madde 4 (2) | en az T1 |
| Toplanma ve örgütlenme hakkı | `fy:ToplanmaHakki` | Madde 4 (2) | en az T1 |

### Silme (karartma) gerekçeleri

Acil gerekçelerde mesaj karar beklenirken **daraltılır** (gizlenmez); kişisel veri gerekçesiyle kabul edilen silmede mesaj
**mühürlenir** (`sealed`). "Görüş ayrılığı" listede görünür ama seçilirse ihlal üretir.

| Gerekçe | IRI | Açıklama | Acil (daraltma) | Mühür |
|---|---|---|---|---|
| Kişisel veri ifşası | `fy:KisiselVeriIfsasi` | Bir kişinin kimlik, adres, telefon, sağlık vb. verilerinin rızası dışında paylaşılması. | evet | evet |
| Tehdit | `fy:Tehdit` | Bir kişiye ya da gruba yönelik şiddet veya zarar tehdidi. | evet |  |
| Hakaret / iftira | `fy:HakaretIftira` | Kişilik haklarına saldırı, asılsız suçlama. |  |  |
| Korunan gruba nefret söylemi | `fy:NefretSoylemi` | Etnik köken, din, cinsiyet, engellilik vb. nedeniyle aşağılama veya düşmanlık. |  |  |
| Spam / reklam | `fy:Spam` | Konu dışı tekrarlayan içerik veya ticari reklam. |  |  |
| Telif ihlali | `fy:TelifIhlali` | Hak sahibinin izni olmadan eser paylaşımı. |  |  |
| Görüş ayrılığı | `fy:GorusAyriligi` | GEÇERSİZ GEREKÇE (Madde 20 (2), değiştirilemez hüküm): Bir görüşe katılmamak ya da bir görüşü yanlış bulmak silme gerekçesi olamaz; görüşe tartışmada yanıt verilir. |  |  |

### İtiraz gerekçeleri

| Gerekçe | IRI | Açıklama |
|---|---|---|
| Azınlığa orantısız etki | `fy:OrantisizAzinlikEtkisi` | Kararın yükü ağırlıklı olarak belirli bir gruba düşüyor. |
| Bilgi / bilirkişi eksikliği | `fy:BilgiEksikligi` | Karar için gerekli uzman görüşü veya veri eksik. |
| Temel hak ihlali | `fy:TemelHakIhlali` | Karar bir temel hakkı ölçüsüzce kısıtlıyor. |
| Usul hatası | `fy:UsulHatasi` | Tartışma, bilgilendirme veya oylama usulüne uyulmadı. |
| Yeni bilgi ortaya çıktı | `fy:YeniBilgi` | Oylamadan sonra kararı etkileyebilecek yeni bilgi ortaya çıktı. |

### İçerik etiketleri

İçerik etiketleri silme gerekçeleriyle aynı IRI'leri paylaşır (`fy:IcerikEtiketi` ve `fy:SilmeGerekcesi`).

| Etiket | IRI |
|---|---|
| Hakaret / iftira | `fy:HakaretIftira` |
| Kişisel veri ifşası | `fy:KisiselVeriIfsasi` |
| Nefret söylemi | `fy:NefretSoylemi` |
| Spam / reklam | `fy:Spam` |
| Tehdit | `fy:Tehdit` |
| Telif ihlali | `fy:TelifIhlali` |

## 12. Ayarlanabilir parametreler

`adjustableParams()` yönetmelik yaması oluşturucusunun kullandığı listeyi döndürür; `setParam` işleminde `rule` ve `param`
sütunlarındaki değerler kullanılır. "Değiştirilemez" işaretli parametreler değiştirilemez maddelere dayanır; onları değiştiren
yama T3'tür.

| `rule` | `param` | Etiket | Değer | Değiştirilemez |
|---|---|---|---|---|
| `fy:KatmanT0` | `yeterSayi` | Olağan karar · Yeter sayı (q) | 0,2 |  |
| `fy:KatmanT0` | `esik` | Olağan karar · Onay eşiği (τ) | 0,5 |  |
| `fy:KatmanT0` | `esikKesin` | Olağan karar · Eşik kesin mi (a > τ) | evet |  |
| `fy:KatmanT0` | `kumeTabani` | Olağan karar · Küme tabanı (φ) | 0,3 |  |
| `fy:KatmanT0` | `asmaEsigi` | Olağan karar · Aşma eşiği (ω) | 2/3 |  |
| `fy:KatmanT0` | `yenidenOyEsigi` | Olağan karar · Yeniden oylama eşiği (ρ) | 0,6 |  |
| `fy:KatmanT0` | `sureDestek` | Olağan karar · Destekçi toplama süresi (saat) | 168 |  |
| `fy:KatmanT0` | `sureTartisma` | Olağan karar · Tartışma süresi (saat) | 72 |  |
| `fy:KatmanT0` | `sureOylama` | Olağan karar · Oylama süresi (saat) | 72 |  |
| `fy:KatmanT0` | `sureUzatma` | Olağan karar · Uzatma süresi (saat) | 24 |  |
| `fy:KatmanT0` | `sureItiraz` | Olağan karar · İtiraz penceresi (saat) | 48 |  |
| `fy:KatmanT0` | `sureUzlasma` | Olağan karar · Uzlaşma süresi (saat) | 72 |  |
| `fy:KatmanT1` | `yeterSayi` | Nitelikli karar · Yeter sayı (q) | 0,3 |  |
| `fy:KatmanT1` | `esik` | Nitelikli karar · Onay eşiği (τ) | 0,6 |  |
| `fy:KatmanT1` | `esikKesin` | Nitelikli karar · Eşik kesin mi (a > τ) | hayır |  |
| `fy:KatmanT1` | `kumeTabani` | Nitelikli karar · Küme tabanı (φ) | 0,4 |  |
| `fy:KatmanT1` | `asmaEsigi` | Nitelikli karar · Aşma eşiği (ω) | 2/3 |  |
| `fy:KatmanT1` | `yenidenOyEsigi` | Nitelikli karar · Yeniden oylama eşiği (ρ) | 0,6 |  |
| `fy:KatmanT1` | `sureDestek` | Nitelikli karar · Destekçi toplama süresi (saat) | 168 |  |
| `fy:KatmanT1` | `sureTartisma` | Nitelikli karar · Tartışma süresi (saat) | 96 |  |
| `fy:KatmanT1` | `sureOylama` | Nitelikli karar · Oylama süresi (saat) | 96 |  |
| `fy:KatmanT1` | `sureUzatma` | Nitelikli karar · Uzatma süresi (saat) | 24 |  |
| `fy:KatmanT1` | `sureItiraz` | Nitelikli karar · İtiraz penceresi (saat) | 72 |  |
| `fy:KatmanT1` | `sureUzlasma` | Nitelikli karar · Uzlaşma süresi (saat) | 120 |  |
| `fy:KatmanT2` | `yeterSayi` | Yönetmelik değişikliği · Yeter sayı (q) | 0,4 |  |
| `fy:KatmanT2` | `esik` | Yönetmelik değişikliği · Onay eşiği (τ) | 2/3 |  |
| `fy:KatmanT2` | `esikKesin` | Yönetmelik değişikliği · Eşik kesin mi (a > τ) | hayır |  |
| `fy:KatmanT2` | `kumeTabani` | Yönetmelik değişikliği · Küme tabanı (φ) | 0,4 |  |
| `fy:KatmanT2` | `asmaEsigi` | Yönetmelik değişikliği · Aşma eşiği (ω) | 0,75 |  |
| `fy:KatmanT2` | `yenidenOyEsigi` | Yönetmelik değişikliği · Yeniden oylama eşiği (ρ) | 2/3 |  |
| `fy:KatmanT2` | `sureDestek` | Yönetmelik değişikliği · Destekçi toplama süresi (saat) | 168 |  |
| `fy:KatmanT2` | `sureTartisma` | Yönetmelik değişikliği · Tartışma süresi (saat) | 168 |  |
| `fy:KatmanT2` | `sureOylama` | Yönetmelik değişikliği · Oylama süresi (saat) | 120 |  |
| `fy:KatmanT2` | `sureUzatma` | Yönetmelik değişikliği · Uzatma süresi (saat) | 48 |  |
| `fy:KatmanT2` | `sureItiraz` | Yönetmelik değişikliği · İtiraz penceresi (saat) | 72 |  |
| `fy:KatmanT2` | `sureUzlasma` | Yönetmelik değişikliği · Uzlaşma süresi (saat) | 168 |  |
| `fy:KatmanDEL` | `yeterSayi` | Silme (karartma) kararı · Yeter sayı (q) | 0,3 |  |
| `fy:KatmanDEL` | `esik` | Silme (karartma) kararı · Onay eşiği (τ) | 2/3 |  |
| `fy:KatmanDEL` | `esikKesin` | Silme (karartma) kararı · Eşik kesin mi (a > τ) | hayır |  |
| `fy:KatmanDEL` | `kumeTabani` | Silme (karartma) kararı · Küme tabanı (φ) | 0,3 |  |
| `fy:KatmanDEL` | `yazarKumesiTabani` | Silme (karartma) kararı · Yazar kümesi tabanı | 0,5 |  |
| `fy:KatmanDEL` | `asmaEsigi` | Silme (karartma) kararı · Aşma eşiği (ω) | 0,75 |  |
| `fy:KatmanDEL` | `yenidenOyEsigi` | Silme (karartma) kararı · Yeniden oylama eşiği (ρ) | 0,75 |  |
| `fy:KatmanDEL` | `sureDestek` | Silme (karartma) kararı · Destekçi toplama süresi (saat) | 72 |  |
| `fy:KatmanDEL` | `sureTartisma` | Silme (karartma) kararı · Tartışma süresi (saat) | 24 |  |
| `fy:KatmanDEL` | `sureOylama` | Silme (karartma) kararı · Oylama süresi (saat) | 48 |  |
| `fy:KatmanDEL` | `sureUzatma` | Silme (karartma) kararı · Uzatma süresi (saat) | 24 |  |
| `fy:KatmanDEL` | `sureItiraz` | Silme (karartma) kararı · İtiraz penceresi (saat) | 0 |  |
| `fy:KatmanDEL` | `sureUzlasma` | Silme (karartma) kararı · Uzlaşma süresi (saat) | 0 |  |
| `fy:GenelParametreler` | `anlamliKumePayi` | Genel parametreler · Anlamlı küme payı (σ_share) | 0,1 |  |
| `fy:GenelParametreler` | `anlamliKumeAsgariUye` | Genel parametreler · Anlamlı küme asgari üye (σ_min) | 3 |  |
| `fy:GenelParametreler` | `kumeBasinaAsgariOy` | Genel parametreler · Küme başına asgari oy (μ_votes) | 2 |  |
| `fy:GenelParametreler` | `kopruIcinAsgariKumelenmis` | Genel parametreler · Köprü testi için asgari kümelenmiş üye (n_C,min) | 12 |  |
| `fy:GenelParametreler` | `sogukBaslangicArtisi` | Genel parametreler · Soğuk başlangıç eşik artışı (δ_cold) | 0,1 |  |
| `fy:GenelParametreler` | `vekaletSiniriOrani` | Genel parametreler · Vekâlet sınırı oranı | 0,05 |  |
| `fy:GenelParametreler` | `vekaletAzamiAdim` | Genel parametreler · Vekâlet zinciri azami adım (H) | 3 |  |
| `fy:GenelParametreler` | `bilirkisiSayisi` | Genel parametreler · Panel bilirkişi sayısı | 3 |  |
| `fy:EsitOySinirlari` | `oyAgirligi` | Eşit oy sınırları · Üye başına oy ağırlığı | 1 | evet |
| `fy:EsitOySinirlari` | `vekaletSiniriOraniAzami` | Eşit oy sınırları · Vekâlet sınırı oranı üst sınırı | 0,1 | evet |
| `fy:EsitOySinirlari` | `vekaletAzamiAdimAzami` | Eşit oy sınırları · Vekâlet zinciri üst sınırı | 5 | evet |
| `fy:AzinlikKorumaSinirlari` | `kumeTabaniAsgari` | Azınlık koruması sınırları · Küme tabanı alt sınırı | 0,2 | evet |
| `fy:AzinlikKorumaSinirlari` | `yazarKumesiTabaniAsgari` | Azınlık koruması sınırları · Yazar kümesi tabanı alt sınırı | 0,5 | evet |
| `fy:AzinlikKorumaSinirlari` | `asmaEsigiAsgari` | Azınlık koruması sınırları · Aşma eşiği alt sınırı | 2/3 | evet |
| `fy:AzinlikKorumaSinirlari` | `sureItirazAsgari` | Azınlık koruması sınırları · İtiraz penceresi alt sınırı (saat, T0–T2) | 24 | evet |
| `fy:AzinlikKorumaSinirlari` | `anlamliKumePayiAzami` | Azınlık koruması sınırları · Anlamlı küme payı üst sınırı | 0,2 | evet |
| `fy:AzinlikKorumaSinirlari` | `anlamliKumeAsgariUyeAzami` | Azınlık koruması sınırları · Anlamlı küme asgari üye üst sınırı | 5 | evet |
| `fy:AzinlikKorumaSinirlari` | `kopruIcinAsgariKumelenmisAzami` | Azınlık koruması sınırları · Köprü için asgari kümelenmiş üye üst sınırı | 30 | evet |
| `fy:KalicilastirmaSinirlari` | `yeterSayiAzami` | Kalıcılaştırma yasağı sınırları · Yeter sayı üst sınırı | 0,6 | evet |
| `fy:KalicilastirmaSinirlari` | `esikAzami` | Kalıcılaştırma yasağı sınırları · Onay eşiği üst sınırı | 0,75 | evet |
| `fy:KalicilastirmaSinirlari` | `asmaEsigiAzami` | Kalıcılaştırma yasağı sınırları · Aşma eşiği üst sınırı | 0,75 | evet |
| `fy:KalicilastirmaSinirlari` | `yenidenOyEsigiAzami` | Kalıcılaştırma yasağı sınırları · Yeniden oylama eşiği üst sınırı | 0,75 | evet |
| `fy:KalicilastirmaSinirlari` | `sureAzami` | Kalıcılaştırma yasağı sınırları · Süre üst sınırı (saat) | 720 | evet |
| `fy:KuralIcerikEtiketi` | `yuksekGuvenEsigi` | Yasak içerik etiketi güven eşikleri · Yüksek güven eşiği (ihlal) | 0,7 |  |
| `fy:KuralIcerikEtiketi` | `ortaGuvenEsigi` | Yasak içerik etiketi güven eşikleri · Orta güven eşiği (uyarı) | 0,4 |  |
| `fy:KuralBilirkisiKategorisi` | `bilirkisiGerekli` | Bilirkişi gerektiren kategori (üst kategoriden miras) · Bilirkişi gerekli | evet |  |
| `fy:KuralDanismaYukseltmesi` | `bilirkisiGerekli` | Danışma kaynaklı hak bayrağı yalnızca yükseltir (T1 + bilirkişi) · Bilirkişi gerekli | evet | evet |
| `fy:KuralNitelikliDegisiklik` | `yeterSayi` | Nitelikli hüküm değişikliğinde 3/4 eşik ve 0,50 yeter sayı · Yeter sayı (q) | 0,5 |  |
| `fy:KuralNitelikliDegisiklik` | `esik` | Nitelikli hüküm değişikliğinde 3/4 eşik ve 0,50 yeter sayı · Onay eşiği (τ) | 0,75 |  |
| `fy:KuralButce` | `yeterSayi` | Bütçe önerilerinde yükseltilmiş yeter sayı ve uzun tartışma · Yeter sayı (q) | 0,3 |  |
| `fy:KuralButce` | `sureTartisma` | Bütçe önerilerinde yükseltilmiş yeter sayı ve uzun tartışma · Tartışma süresi (saat) | 96 |  |
| `fy:KuralImar` | `sureTartisma` | İmar önerilerinde uzun tartışma · Tartışma süresi (saat) | 120 |  |
| `fy:KuralVeriKoruma` | `esik` | Kişisel veri önerilerinde yükseltilmiş taban ve eşik · Onay eşiği (τ) | 0,6 |  |
| `fy:KuralVeriKoruma` | `kumeTabani` | Kişisel veri önerilerinde yükseltilmiş taban ve eşik · Küme tabanı (φ) | 0,4 |  |
| `fy:KuralSaglik` | `sureOylama` | Sağlık önerilerinde uzun oylama · Oylama süresi (saat) | 96 |  |

## 13. Programlama arayüzü (OntologyService)

```ts
import { createOntologyService } from "./ontology";
const ontology = createOntologyService(ctx); // ctx: CoreContext (config.ontologyDir, db, clock)
await ontology.init();                      // dosyaları ayrıştırır, sürüm 1'i ekler ya da son sürümü yükler
```

| Yöntem | Açıklama |
|---|---|
| `current()`, `versions()` | Yürürlükteki sürüm; tüm sürümler (artan sırada) |
| `categories()` | Kategori ağacı (kökler; `iri` tam IRI, `requiresExpert` mirası içerir) |
| `categoryLabel(iri)`, `ancestors(iri)`, `isSubCategoryOf(a, b)`, `depth(iri)` | Kısa (`fy:`) ya da tam IRI kabul eder; `ancestors` kendisi + üstler (en özelden genele); `"*"` genel kapsamdır (`isSubCategoryOf(x, "*") = true`) |
| `rights()`, `articles()`, `deletionGrounds()`, `objectionGrounds()`, `contentLabels()` | Liste uçları. Gerekçelerde ek alanlar: `sealed`, `invalid`, `article` |
| `adjustableParams()`, `tiers()` | Yama oluşturucu parametreleri; katman tablosu (T3 satırında sayılar 0'dır: oylanamaz) |
| `keywordIndex()` | Kategori anahtar kelimeleri (ağaç sırasıyla) |
| `audit(input)` | Tam denetim → `AuditReport` (< 300 ms) |
| `validatePatch(patch)` | Yama denetimi → `AuditReport` (T2 ya da T3) |
| `applyPatch(patch, proposalId)` | Yeni sürüm → `BylawVersionInfo` |
| `exportTurtle(version?)` | Sürümün A-kutusu Turtle metni |
