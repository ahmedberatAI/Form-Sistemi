# Mimari

> Bu belge sistemin bileşenlerini, veri akışını ve güven sınırlarını açıklar.
> Karar algoritması için [ALGORITMA.md](ALGORITMA.md), REST sözleşmesi için [API.md](API.md), kişisel veriler için [KVKK.md](KVKK.md),
> yönetmelik ontolojisi için [YONETMELIK.md](YONETMELIK.md) belgelerine bakınız.

## 1. Genel görünüm

```
                ┌──────────────────────────── İstemciler ─────────────────────────────┐
                │  Web (React 19 + Vite)              Android (aynı kod, Capacitor 8)  │
                │  · verifyTally / verifyInclusionProof tarayıcıda çalışır              │
                │  · oy makbuzları cihazda saklanır, doğrulayıcı anahtarları sabitlenir │
                └───────────────────────────────┬──────────────────────────────────────┘
                                                │ HTTPS/HTTP  JSON  (Bearer belirteç)
┌───────────────────────────────────────────────▼──────────────────────────────────────────────────┐
│ Sunucu (Node 22+, Fastify 5)                                                                       │
│                                                                                                    │
│  http/ ── kimlik doğrulama, rol denetimi (U/V/VV/R/D/A/E), zod doğrulama, hata biçimi, CORS, hız sınırı │
│    │                                                                                               │
│  forum/ (wave-2 çekirdek)                                                                          │
│    ├─ ProposalService  ── öneri, destek, sürüm, öneri-içi öneri, oy, itiraz, azınlık raporu, bülten   │
│    ├─ LifecycleEngine  ── TEK OTORİTE: faz geçişleri (zamanlayıcı)                                  │
│    ├─ TopicService     ── konu ağacı, revizyonlar                                                   │
│    ├─ MessageService   ── tartışma (silinmez), karartma, mezar taşı, onay/ret, köprü skoru           │
│    ├─ ClusterService   ── görüş kümeleri anlık görüntüsü                                            │
│    └─ CommunityService ── profil, vekâlet görünümü, bildirim, pano, sistem bilgisi                  │
│    │                                                                                               │
│  wave-1 modülleri (yalnızca contracts.ts arayüzleriyle erişilir)                                    │
│    ├─ ledger/     4 doğrulayıcılı BFT defter (Tendermint tarzı), Merkle kanıtları, kurcalama/onarım │
│    ├─ ontology/   RDF/Turtle yönetmelik, N3 çıkarım, SHACL denetimi, katman+parametre, sürümleme    │
│    ├─ governance/ PCA+k-means kümeleme, vekâlet çözümü, ağırlıklı kura (saf, belirlenimci)         │
│    ├─ graph/      insanlar grafı (graphology): takip, kefalet, vekâlet, yakınlık, Louvain, SybilRank │
│    ├─ identity/   kayıt, kimlik kasası (AES-256-GCM), oturum, KVKK hakları, kripto-imha            │
│    ├─ ai/         Claude API (danışman) + çevrimdışı sezgisel mod                                  │
│    └─ experts/    bilirkişi listesi, tohumlu kura, çıkar çatışması, rapor, itibar                  │
│    │                                                                                               │
│  core/  Clock (ScaledClock: TIME_SCALE), Config, AppError, Notifier, AuditLogger                    │
│  db/    SQLite (node:sqlite, WAL) — schema.sql                                                     │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
          │ yalnızca özetler / taahhütler / ballotId              │ maskelenmiş metin (rızayla)
          ▼                                                       ▼
   Defter düğümleri v0…v3 (ayrı SQLite dosyaları)           Claude API (claude-opus-5-5)
```

`shared/` paketi sunucu ve istemcide **aynı** kodu çalıştırır: karar fonksiyonu (`decide`, `evaluateObjection`, `verifyTally`),
kriptografi (kanonik JSON, SHA-256, RFC 6962 Merkle, Ed25519, `voteCommitment`), rasyonel aritmetik, tohumlu RNG, Türkçe etiketler,
ontoloji IRI sabitleri ve API tipleri. Böylece bir oylama sonucunu tarayıcı ya da Android uygulaması sunucuya güvenmeden yeniden hesaplar.

## 2. Modül sözleşmeleri ve bağımlılık enjeksiyonu

- `server/src/core/contracts.ts`: wave-1 arayüzleri (LedgerService, OntologyService, GraphService, GovernanceMath, IdentityService,
  AiService, AiRecordSink, ExpertService, Notifier). Forum, YZ analiz kayıtlarına (kaydet, getir, listele, insan onayı) yalnızca
  `AiRecordSink` üzerinden erişir; `../ai` iç yardımcılarını içe aktarmaz (bir test bu sınırı denetler).
- `server/src/core/forum-contracts.ts`: wave-2 arayüzleri (ProposalService, LifecycleEngine, TopicService, MessageService,
  ClusterService, CommunityService).
- Bileşim kökü `server/src/app.ts` (`createApp`) tüm servisleri kurar; modüller birbirini yalnızca arayüz üzerinden görür ve testlerde
  sahte uygulamalarla (`server/test/helpers/fakes.ts`) değiştirilebilir.

## 3. Bir önerinin yaşamı (veri akışı)

1. **Ön denetim** (`POST /api/proposals/precheck`): ontoloji denetimi (katman, parametreler, bulgular), YZ sınıflandırma önerileri,
   benzer öneriler (salam taktiği uyarısı), kişisel veri taraması. Yan etkisizdir.
2. **Oluşturma/gönderme:** `proposals` + `proposal_versions`; defter: `PROPOSAL_CREATED`. Destekçi toplama evresi.
3. **Destek (K_s):** `SPONSORED`. Eşik aşılınca zamanlayıcı tam denetimi yapar → `deliberation` ya da `inadmissible`.
4. **Tartışma:** mesajlar (`MESSAGE_POSTED`), öneri-içi metin önerileri, sürümler (`PROPOSAL_VERSION`), gerekiyorsa bilirkişi kurası
   (`EXPERT_DRAW`, tohum önceden taahhüt edilmiş blok) ve raporlar (`EXPERT_REPORT`).
5. **Oylama açılışı:** parametreler sabitlenir, uygun seçmen anlık görüntüsü (`eligible_voters`), küme anlık görüntüsü
   (`CLUSTER_SNAPSHOT`).
6. **Oy:** `ballots` (sunucuda), defterde yalnızca `VOTE_COMMIT {ballotId, commitment}`; kullanıcı makbuzu cihazında saklar.
7. **Kapanış:** vekâlet çözümü → `decide()` → `BALLOT_REVEAL` + `TALLY`; sonuç: itiraz penceresi / uzlaşma / red / yürürlük.
   "Oyumu kim kullandı" izi (`myEffectiveVia`) sayımı yapan aramanın kendi çıktısıdır (`resolveEffectiveVotes().delegateOf`, yalnız
   sunucuda `tallies.delegation_trace`); ayrı bir arama kopyası yoktur. Aynı işlemde **kilit adım taraması** (`graph.lockstep`)
   çalışır: bulunan gruplar kararı DEĞİŞTİRMEDEN bütünlük uyarısı olarak denetim günlüğüne yazılır (§5.1).
8. **Yürürlük:** konu (`TOPIC_REVISION`), silme/karartma (`MESSAGE_HIDDEN`), yönetmelik sürümü (`BYLAW_VERSION`). Kurucu
   yönetmelik (sürüm 1) de ilk açılışta ya da tohumlamada `BYLAW_VERSION` ile deftere sabitlenir (`anchorFoundingBylaw`).
9. Her geçiş: `phase_events` + `PHASE_CHANGED`.

## 4. Dağıtık defter

- 4 doğrulayıcı (f = 1, nisap 3), Tendermint tarzı propose → prevote → precommit → commit; tur değişimi, kilitleme, bizans
  (çift imza) kanıtı (`EVIDENCE`), çöken düğümün senkronu, kurcalama tespiti (`verifyChain`) ve eşlerden onarım (`repair`).
- Blok başlığı: `{chainId, height, round, prevHash, time, proposer, txRoot, txCount}`; `txRoot` RFC 6962 Merkle kökü;
  `commitSigs` ≥ 2f+1 Ed25519 precommit imzası.
- **Dahil olma kanıtı:** `GET /api/ledger/proofs/:hash` → istemci `verifyInclusionProof` ile Merkle yolunu, blok özetini ve imzaları,
  ilk kullanımda sabitlediği doğrulayıcı açık anahtarlarıyla doğrular.
- Doğrulayıcılar, kişisel veri anahtarları (`tckn`, `email`, `body` …) içeren işlemleri reddeder (derinlemesine savunma).
- **Dürüst sınırlama:** Demo kurulumunda dört doğrulayıcı aynı süreçte/makinede çalışır; arayüz bunu açıkça belirtir. Gerçek
  dağıtımda düğümler farklı kurumlarca işletilmelidir.
- **Tek süreç kipi:** Bu bir *dağıtık ağ simülasyonudur*: her doğrulayıcının ayrı Ed25519 anahtarı ve ayrı SQLite deposu
  (`ledger/v0..v3.db`) vardır; iletiler bellek içi ağda (`MemoryTransport`) kopyalanarak, gecikme/kayıp enjeksiyonuyla taşınır.
  Doğrulayıcıyı ayrı süreçte başlatan bir komut yoktur; `LEDGER_MODE` yalnızca `in-process` değerini kabul eder (başka bir değer
  uyarıyla yok sayılır). Çok süreçli ya da çok makineli dağıtım için genişleme noktası `Transport` arayüzüdür
  (`server/src/ledger/transport.ts`): HTTP ya da TCP üzerinden uygulanıp `ValidatorNode` ayrı süreçte çalıştırılabilir.

## 5. Güven sınırları ve tehdit modeli (özet)

| Varlık | Güvenilen | Güvenilmeyen / doğrulanabilir |
|---|---|---|
| Sunucu | Seçmen uygunluğu, oy gizliliği (ballot↔kullanıcı bağını yalnız sunucu bilir) | Sayım sonucu (herkes bültenden yeniden sayar), oyun deftere doğru yazılması (makbuz + kanıt) |
| Defter düğümleri | ≥ 3/4 dürüst | Tek bir düğümün kopyası (kurcalama tespit edilir) |
| Yapay zekâ | Hiçbir karar | Tüm çıktılar danışma niteliğinde, etiketli, insan onayı olmadan durum değiştirmez |
| Bilirkişi | Hiçbir karar (oyu 1) | Kura tohumu ve aday ağırlıkları defterde; herkes kurayı yeniden üretebilir |
| Herkese açık API | — | Kişisel veri yok; görüş kümesi ve koordinat yalnız kişinin kendisine; itiraz imzacıları anonim; aile/hane yakınlık kenarları yalnız denetçiye |

Siyasi seçim düzeyinde zorlamaya dayanıklılık (MACI benzeri) ve cihazda imzalı oy kapsam dışıdır (bkz. ALGORITMA.md §11).

### 5.1 Görünürlük kararları (öneri ve bilirkişi görünümleri)

- **Bilirkişi yeterlilik beyanı** (`ExpertInfo.credentials`): başvuruda yazılan serbest metindir ve kurum, unvan, sicil gibi kişiyi
  belirleyebilecek bilgiler içerebilir. Bu yüzden yalnızca **yönetici, kayıt memuru, denetçi ve bilirkişinin kendisi** görür
  (doğrulanmış oturum gerekir). Herkese açık listede (`GET /api/experts`) alan `null` olur; onun yerine durum ve uzmanlık alanı
  etiketlerinden üretilen, kimlik belirlemeyen kısa bir `qualificationSummary` verilir (ör. "Yönetici onaylı bilirkişi · uzmanlık:
  Toplu taşıma · 3 rapor"). Biçimleme servis katmanındadır (`ExpertService.list/get(…, viewer)`); görüntüleyen verilmezse herkese açık
  görünüm döner (güvenli varsayılan).
- **Bilirkişi paneli:** çekinme gerekçesi (bilirkişiye "kişisel veri yazmayın" uyarısıyla alınır) ve her kura ile yedek kuranın
  `EXPERT_DRAW` defter işlemi (`ExpertPanelInfo.draws`) herkese açıktır; defter kayıtları kişisel veri içermez.
- **Bütünlük uyarıları** (`ProposalDetail.integrityWarnings`, `ProposalSummary.integrityWarningCount`): kilit adım grupları denetim
  günlüğüne (`audit_log`, eylem `integrity.lockstep`) yazılır, deftere yazılmaz. Herkes tur, grup sayısı ve büyüklüğünü görür; grup
  üyelerinin takma adları yalnız denetçi ve yöneticiye gösterilir. Hiçbir görünüm grubun hangi seçeneği oyladığını içermez.
- **Hak etkisi bayrakları** (`ProposalDetail.rightsFlags`): hak, yön ve kaynak (yazar/üye/bilirkişi/YZ) herkese açıktır; bayrağı
  ekleyen kişinin kimliği gösterilmez (denetim günlüğünde kayıtlıdır).

## 6. Zaman

- Alan mantığı `Date.now()` kullanmaz; tüm modüller enjekte edilen `Clock` arayüzünü kullanır.
- Sunucu `ScaledClock` kullanır: simüle zaman gerçek zamandan `TIME_SCALE` kat hızlı akar (varsayılan 60: 1 saat = 1 dakika).
  Süreler ALGORITMA.md'deki gerçek değerlerdir; takvim tutarlıdır. Yönetici saati ileri alabilir (`POST /api/admin/clock/advance`).
  Saat durumu `meta` tablosunda saklanır; sunucu kapalıyken simüle zaman ilerlemez.
- Testler `ManualClock` kullanır; zamanlayıcı `lifecycle.tick()` ile elle sürülür.

## 7. Veri saklama

- `server/data/forum.db` (ana veritabanı), `server/data/ledger/v0..v3.db` (doğrulayıcı kopyaları), `server/data/keys/` (anahtarlar,
  0600 izinli; üretimde KMS/ortam değişkeni).
- Tartışma, öneri, konu ve graf kayıtları fiziksel olarak silinmez; yalnızca durum/görünürlük alanları değişir.
- Kişinin kendi verisini silmesi kimlik kasasında **kripto-imha** ile yapılır (KVKK.md).

## 8. İstemci

- `web/src/api/endpoints.ts`: API.md'deki her uç nokta için tipli fonksiyon.
- `web/src/auth/AuthContext.tsx`: oturum, rol yardımcıları, sunucu saatine göre düzeltilmiş `now()`.
- HashRouter: aynı paket hem web'de (sunucunun `web/dist`'i sunması ya da Vite geliştirme sunucusu) hem Android WebView'de çalışır.
- Android: Capacitor; uygulama içi sunucu adresi ayarlanabilir (emülatör varsayılanı `http://10.0.2.2:4000`); sunucu CORS ayarında
  `http://localhost` ve `capacitor://localhost` kökenlerine izin verir.
