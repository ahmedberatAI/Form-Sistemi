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
│ Sunucu (Node 22.16+ ya da 24+, Fastify 5)                                                          │
│                                                                                                    │
│  http/ ── kimlik doğrulama, rol (U/V/VV/R/D/A/E), zod, hata biçimi, CORS, hız sınırı, Idempotency-Key   │
│    │                                                                                               │
│  forum/ (forum çekirdeği)                                                                          │
│    ├─ ProposalService  ── öneri, destek, sürüm, öneri-içi öneri, oy, itiraz, azınlık raporu, bülten   │
│    ├─ LifecycleEngine  ── faz geçişleri (zamanlayıcı; tek yazım yeri applyTransition)               │
│    ├─ TopicService     ── konu ağacı, revizyonlar                                                   │
│    ├─ MessageService   ── tartışma (silinmez), karartma, mezar taşı, onay/ret, köprü skoru           │
│    ├─ ClusterService   ── görüş kümeleri anlık görüntüsü                                            │
│    └─ CommunityService ── profil, vekâlet görünümü, bildirim, pano, sistem bilgisi                  │
│    │                                                                                               │
│  Çekirdek dışı modüller (arayüzleri contracts.ts; ortak SQLite şeması, bkz. §2)                     │
│    ├─ ledger/     4 doğrulayıcılı BFT defter (Tendermint tarzı), Merkle kanıtları, kurcalama/onarım │
│    ├─ ontology/   RDF/Turtle yönetmelik, N3 çıkarım, SHACL denetimi, katman+parametre, sürümleme    │
│    ├─ governance/ PCA+k-means kümeleme, vekâlet çözümü, ağırlıklı kura (saf, belirlenimci)         │
│    ├─ graph/      insanlar grafı (graphology): takip, kefalet, vekâlet, yakınlık, Louvain, SybilRank │
│    ├─ identity/   kayıt, kimlik kasası (AES-256-GCM), oturum, KVKK hakları, kripto-imha            │
│    ├─ ai/         Claude API (danışman) + çevrimdışı sezgisel mod                                  │
│    └─ experts/    bilirkişi listesi, tohumlu kura, çıkar çatışması, rapor, itibar                  │
│    │                                                                                               │
│  core/  Clock (ScaledClock: TIME_SCALE), Config, AppError, Notifier, AuditLogger                    │
│  db/    SQLite (node:sqlite, WAL) — schema.sql, migrations.ts (şema sürümü 2: + ledger_outbox)     │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
          │ yalnızca özetler / taahhütler / ballotId              │ maskelenmiş metin (rızayla)
          ▼                                                       ▼
   Defter düğümleri v0…v3 (ayrı SQLite dosyaları)           Claude API (claude-haiku-5-5)
```

`shared/` paketi sunucu ve istemcide **aynı** kodu çalıştırır: karar fonksiyonu (`decide`, `evaluateObjection`, `verifyTally`),
kriptografi (kanonik JSON, SHA-256, RFC 6962 Merkle, Ed25519, `voteCommitment`), rasyonel aritmetik, tohumlu RNG, Türkçe etiketler,
ontoloji IRI sabitleri ve API tipleri. Böylece bir oylama sonucunu tarayıcı ya da Android uygulaması sunucuya güvenmeden yeniden hesaplar.

## 2. Modül sözleşmeleri, bağımlılık enjeksiyonu ve tablo sahipliği

- `server/src/core/contracts.ts`: çekirdek dışı modüllerin arayüzleri (LedgerService, OntologyService, GraphService, GovernanceMath,
  IdentityService, AiService, AiRecordSink, ExpertService, Notifier). Forum, YZ analiz kayıtlarına (kaydet, getir, listele, insan
  onayı) yalnızca `AiRecordSink` üzerinden erişir; `../ai` iç yardımcılarını içe aktarmaz (bir test bu sınırı denetler).
- `server/src/core/forum-contracts.ts`: forum çekirdeğinin arayüzleri (ProposalService, LifecycleEngine, TopicService, MessageService,
  ClusterService, CommunityService).
- Bileşim kökü `server/src/app.ts` (`createApp`) tüm servisleri kurar ve birbirine arayüz tipleriyle enjekte eder; testlerde sahte
  uygulamalarla (`server/test/helpers/fakes.ts`) değiştirilebilir.

**Bu bir modüler monolittir; modüller birbirini yalnızca arayüz üzerinden görmez.** Tek süreç, tek ana SQLite veritabanı ve tek şema
vardır. Servis arayüzleri sözleşmeyi ve değiştirilebilirliği (test, ileride ayrı hizmet) sağlar; **veriye erişim ise ortak tablolar
üzerindendir**: bir modül başka modülün tablosunu doğrudan SQL ile, çoğunlukla salt okunur sorgulayabilir. Bu bilinçli bir tasarım
kararıdır ([MUHENDISLIK.md](MUHENDISLIK.md) bu gerekçeye dayanır):

- **Tutarlılık işlem sınırına bağlıdır.** Bir öneri satırı, defter giden kutusu satırı ve denetim kaydı tek `db.tx` içinde (iç içe
  savepoint'lerle) yazılır; modül başına ayrı depo bu atomikliği bozardı (bkz. §4 giden kutusu, §5.2).
- **Okuma modelleri çok tabloyu birleştirir** (öneri ayrıntısı, pano, KVKK dökümü, graf istatistikleri). Her biri için başka bir
  modülden satır satır servis çağrısı hem yavaş olur hem arayüzleri gereksiz şişirirdi.
- **Gerçek güven sınırları zaten ayrıdır ve arayüzle korunur:** kimlik kasası (anahtarlar), defter (ayrı depolar, imzalar), YZ (ağ,
  rıza).

Bedeli: tablo düzeyinde kapsülleme yoktur; bir şema değişikliği tüm modülleri etkileyebilir. Bunu sınırlamak için aşağıdaki sahiplik
tablosu, tek göç listesi (`db/migrations.ts`, §7) ve mimari bağımlılık testi vardır.

### 2.1 Tablo sahipliği

"Sahip", tabloyu yazan ve anlamını belirleyen modüldür; sağ sütun, başka modüllerin doğrudan sorguladığı tablolardır.

| Modül | Yazdığı tablolar (sahibi) | Başka modüllerden okuduğu tablolar |
|---|---|---|
| `identity/` | `users` (hesap alanları), `identity_vault`, `identity_corrections`, `pii_access_log`, `sessions`, `meta` (anahtar sürümü, `identity.pending_since:<üye>`) | KVKK dökümü ve hesap silme için üyenin kendi `proposals`, `messages*`, `ballots`, `objections`, `minority_reports`, `expert_*`, `graph_edges`, `cluster_snapshots`, `notifications` ve `audit_log` satırları |
| `forum/` | `proposals`, `proposal_versions`, `proposal_sponsors`, `proposal_suggestions`, `phase_events`, `eligible_voters`, `ballots`, `tallies`, `objections`, `minority_reports`, `expert_requests`, `messages`, `message_versions`, `message_rebuttals`, `message_endorsements`, `hidden_access_log`, `topics`, `topic_revisions`, `cluster_snapshots`; `users.objection_budget_used`; `notifications` (okundu işareti) | `users`, `experts`, `expert_*`, `notifications`, `audit_log` (görünümler) |
| `experts/` | `experts`, `expert_questions`, `expert_panels`, `expert_assignments`, `expert_reports`; `users.reputation` | `users`, `proposals` (yazar ve kategoriler) |
| `graph/` | `graph_edges`, `graph_runs` | `users`, `proposals`, `ballots`, `tallies`, `experts`, `cluster_snapshots` (kilit adım, kalıcı kaybeden, uzlaşı grafı, Louvain tohumu) |
| `ontology/` | `bylaw_versions` | `users` (doğrulanmış üye sayısı) |
| `ai/` | `ai_analyses` | — |
| `ledger/` | `ledger_outbox` (ana veritabanı); doğrulayıcı depoları `ledger/v0..v3.db` ayrı dosyalardır | — |
| `core/` | `meta` (`sim_clock`), `notifications` (Notifier), `audit_log` (AuditLogger) | — |
| `governance/`, `http/` | Hiçbiri (saf hesap; SQL yok) | — |

Tek sahip kuralının sütun düzeyinde istisnaları: `users.reputation` (bilirkişi itibarı, `experts/`), `users.objection_budget_used`
(itiraz bütçesi, `forum/`) ve `meta` (saat ve kimlik anahtarları).

### 2.2 Zorlanan sınırlar ve bilinen istisnalar

`server/test/architecture/imports.test.ts` kaynak dosyalardaki gerçek `import` ifadelerini tarar ve şunları zorlar:

1. `shared/` server ya da web'den hiçbir şey içe aktarmaz.
2. `server/src/forum`, `../ai` iç yapısını içe aktarmaz.
3. `server/src/http/routes`, SQL katmanını (`../../db`) ve `node:sqlite`'ı içe aktarmaz (yalnız `import type`); `core/` ve `http/`
   dışına yalnızca iki saf yardımcı için çıkar: `forum/lifecycle` (`failedProposalIds`) ve `forum/clusters` (`anonymizeClusterView`).
4. `web/src/ui` ve `web/src/lib`, `pages/` ya da `components/` içe aktarmaz.

Zorlanmayanlar (dürüstçe): döngüsel bağımlılık denetimi yoktur ve modüllerin birbirinin tablolarını okuması denetlenmez; yukarıdaki
tablo belgedir, test değildir.

**HTTP katmanı "yalnızca doğrulama" değildir.** Rotalar yetki, doğrulama ve hata biçimi işi yapar; iki yerde bilinçli olarak iş
kuralı da taşırlar:

- `routes/me.ts`, hesap silme (`POST /api/me/erase`): imha, vekâletlerin geri alınması ve bildirimler tek veritabanı işleminde
  yürür; işlem sınırı rotada açılır (`services.ctx.db.tx`; rotada SQL yazılmaz). Daha temiz tasarım, `contracts.ts`'te tanımlı ve
  `app.ts`'te bağlanan bir hesap-silme servisidir (yapılmadı).
- `routes/graph.ts`, graf görünürlüğü: özel kenarlar (yakınlık beyanı) yalnız doğrulanmış denetçi ve yöneticiye gider; siyasi görüş
  alanları yalnız görüntüleyenin kendi düğümünde kalır. Politika `GraphService.visualization` içinde de uygulanır (`includePrivate`,
  `viewerId`); rota yalnız savunma derinliği olarak yeniden süzer. Küme görünümleri `anonymizeClusterView` ile anonimleştirilir;
  yönetici küme yeniden hesabı (`POST /api/admin/clusters/recompute`) de kimliksiz anlık görüntü döndürür.

## 3. Bir önerinin yaşamı (veri akışı)

1. **Ön denetim** (`POST /api/proposals/precheck`): ontoloji denetimi (katman, parametreler, bulgular), YZ sınıflandırma önerileri,
   benzer öneriler (salam taktiği uyarısı), kişisel veri taraması. Yan etkisizdir.
2. **Oluşturma/gönderme:** `proposals` + `proposal_versions`; defter: `PROPOSAL_CREATED`. Destekçi toplama evresi. Yazarın
   "Destekçi toplamaya gönder" eylemi bu geçişi istek içinde, zamanlayıcıyı beklemeden yapar.
3. **Destek (K_s):** `SPONSORED`. Eşik aşılınca zamanlayıcı tam denetimi yapar → `deliberation` ya da `inadmissible`.
4. **Tartışma:** mesajlar (`MESSAGE_POSTED`), öneri-içi metin önerileri, sürümler (`PROPOSAL_VERSION`), gerekiyorsa bilirkişi kurası
   (`EXPERT_DRAW`, tohum önceden taahhüt edilmiş blok: taahhüt anındaki son blok + 1; taahhüdü aynı işlemde gönderilen `SEED_COMMIT`
   taşır ve o bloğu oluşturur, bkz. ALGORITMA.md §12 madde 9) ve raporlar (`EXPERT_REPORT`).
5. **Oylama açılışı:** parametreler sabitlenir, uygun seçmen anlık görüntüsü (`eligible_voters`), küme anlık görüntüsü
   (`CLUSTER_SNAPSHOT`).
6. **Oy:** `ballots` (sunucuda), defterde yalnızca `VOTE_COMMIT {ballotId, commitment}`; kullanıcı makbuzu cihazında saklar.
7. **Kapanış:** vekâlet çözümü → `decide()` → `BALLOT_REVEAL` + `TALLY`; sonuç: itiraz penceresi / uzlaşma / red / yürürlük.
   "Oyumu kim kullandı" izi (`myEffectiveVia`) sayımı yapan aramanın kendi çıktısıdır (`resolveEffectiveVotes().delegateOf`, yalnız
   sunucuda `tallies.delegation_trace`); ayrı bir arama kopyası yoktur. Aynı işlemde **kilit adım taraması** (`graph.lockstep`)
   çalışır: bulunan gruplar kararı DEĞİŞTİRMEDEN bütünlük uyarısı olarak denetim günlüğüne yazılır (§5.1).
8. **Yürürlük:** konu (`TOPIC_REVISION`), silme/karartma (`MESSAGE_HIDDEN`), yönetmelik sürümü (`BYLAW_VERSION`). Kurucu
   yönetmelik (sürüm 1) de ilk açılışta ya da tohumlamada `BYLAW_VERSION` ile deftere sabitlenir (`anchorFoundingBylaw`).
9. Her geçiş `applyTransition` ile yazılır (`phase_events` + `PHASE_CHANGED`): zamanlayıcının geçişleri ve yazarın gönder / geri
   çek eylemleri aynı yolu kullanır.

## 4. Dağıtık defter

- 4 doğrulayıcı (f = 1, nisap 3), Tendermint tarzı propose → prevote → precommit → commit; tur değişimi, kilitleme, bizans
  (çift imza) kanıtı (`EVIDENCE`), çöken düğümün senkronu, kurcalama tespiti (`verifyChain`) ve eşlerden onarım (`repair`).
- Blok başlığı: `{chainId, height, round, prevHash, time, proposer, txRoot, txCount}`; `txRoot` RFC 6962 Merkle kökü;
  `commitSigs` ≥ 2f+1 Ed25519 precommit imzası.
- **Dahil olma kanıtı:** `GET /api/ledger/proofs/:hash` → istemci `verifyInclusionProof` ile Merkle yolunu, blok özetini ve imzaları,
  ilk kullanımda sabitlediği doğrulayıcı açık anahtarlarıyla doğrular.
- Doğrulayıcılar, kişisel veri anahtarları (`tckn`, `email`, `body` …) içeren işlemleri reddeder (derinlemesine savunma).
- **Sert kapanışa dayanıklılık (giden kutusu).** Gönderilmiş ama henüz bir blokta onaylanmamış her işlem ana veritabanındaki
  `ledger_outbox` tablosunda da tutulur (şema sürümü 2). Doğrulayıcı havuzları yalnız düzgün kapanışta kalıcılaşır; çökme ya da
  `taskkill /F` ile bellekteki bekleyen işlemler kaybolurdu, oysa ilgili veritabanı satırı COMMIT olmuş olabilir. Bu yüzden:
  1. `ForumCore.submit` bir DB işleminin içindeyse satırı kaydın kendisiyle **aynı işlemde** yazar (işlemsel outbox: COMMIT ikisini
     birlikte kalıcılaştırır, geri alma ikisini birlikte siler; COMMIT ile ertelenmiş gönderim arasındaki pencere de kapanır).
  2. `InProcessLedger.submit` da bir `Db.tx` işleminin içinden çağrılırsa (graf vekâleti, bilirkişi kurası, hesap silme kaskadı)
     satırı o işlemde yazar; işlemi bekleyenlere eklemeyi ve doğrulayıcılara iletmeyi **en dıştaki COMMIT'e** erteler
     (`Db.afterCommit`). İşlem geri alınırsa satır da iletim de geri alınır: defterde veritabanında karşılığı olmayan kayıt kalmaz.
     İşlem dışındaki gönderimler (kimlik, YZ kaydı) satırı anında yazar.
  3. İşlem bir bloğa girince satır silinir; kalıcı kipte ancak **doğrulayıcı depoları diske indirildikten sonra** (`BlockStore.sync`:
     WAL denetim noktası = fsync; tick, `flush` ve kapanışta toplu, tek `DELETE`).
  4. Açılışta (`start`) kalan satırlar yeniden imzalanıp gönderilir (özgün `submittedAt` korunur). Zincirde zaten bulunanlar
     gönderilmeden silinir; bozuk satırlar (özet ya da nonce uyuşmazlığı, bilinmeyen tür, bozuk JSON, geçersiz `EVIDENCE`) atılır.
  5. Ertelenmiş bir forum gönderimi COMMIT'ten sonra başarısız olursa (ör. defter durmuşsa; denetim günlüğünde
     `system.ledger_submit_failed`) satır kalır ve sonraki açılışta yeniden denenir.

  Satır, deftere yazılacak yükün aynısıdır: kişisel veri ve üye kimliği içermez (`prepareTx` denetler; [KVKK §4.3](KVKK.md)). İşlem
  dışında satırın yazılması başarısız olursa gönderim yine yapılır ve `[defter] bekleyen işlem giden kutusuna yazılamadı` günlüğe düşer
  (yük ve hata iletisi yazılmaz; SQLite kodu `errcode`/`errstr` yazılır). Bir DB işleminin içindeyse hata **yutulmaz**: çağıranın
  işlemi asıl hatayla (ör. disk dolu) geri alınır. `Db`, SQLite'ın işlemi kendiliğinden geri aldığı durumda (disk dolu, G/Ç hatası)
  iç hatayı yakalayıp devam eden kodun sonraki deyimlerinde de asıl hatayı fırlatır; hiçbir yazım işlemin dışına (autocommit) taşmaz.
  Bu denetim `DatabaseSync.isTransaction`'ı okur. Özellik Node 22.16.0 ve 24.0.0'da geldi; asgari Node sürümü bu yüzden 22.16'dır
  (23.x desteklenmez). Daha eski sürümde değer tanımsız kalırdı ve şemayı işlem içinde kuran ilk göç düşerdi; bu yüzden `Db` açılışta
  özelliği denetler ve anlaşılır bir iletiyle durur (`assertSqliteSupport`; [README](../README.md) §1).
- **Elektrik kesintisi:** doğrulayıcı depoları her blokta fsync yapmaz (`synchronous=NORMAL`); işletim sistemi düzeyinde bir
  kesintide son blok(lar) depolardan kaybolabilir. Giden kutusu satırı depolar diske indirilmeden silinmediğinden işlem kaybolmaz:
  açılışta yeniden gönderilir ve yeni bir bloğa girer (işlem özeti aynıdır; kaybolan bloğun yüksekliği/kanıtı yeniden üretilen blokla
  değişebilir). Süreç ölümünde (çökme, `taskkill /F`, SIGKILL) blok kaybı da yoktur; bu, `server/test/ledger/crash-recovery.test.ts`
  ile gerçek bir süreç öldürülerek sınanır.
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
| Herkese açık API | — | Kişisel veri yok; görüş kümesi ve koordinat yalnız kişinin kendisine (**iki dar istisna**: silme oylamasında hedef mesaj yazarının küme kimliği bültende, azınlık raporunda yazarın takma adı ve görüş grubu; bkz. KVKK.md §4.3); itiraz imzacıları anonim; aile/hane yakınlık kenarları yalnız denetçiye; roller açık (§5.1) |

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
- **Görüş grubu gizliliğinin iki istisnası.** Görüş kümesi bilgisi kişinin kendisine özeldir; yalnız şunlar bilinçli olarak
  kamusaldır ([KVKK.md §4.3](KVKK.md)): (a) silme oylamasında **hedef mesaj yazarının küme kimliği** (`TALLY.authorClusterId`; herkesin
  sayımı bültenden yeniden yapabilmesi için zorunlu, arayüz grubu adıyla anmaz) ve (b) **azınlık raporu**, yazarın takma adı ve
  görüş grubuyla yayımlanır (yazara önceden söylenir). İtiraz imzacıları ise anonimdir.
- **Roller (yönetici, kayıt memuru, denetçi) herkese açıktır** (`PublicUser.roles`: üye listesi, profil). Bu bir yönetişim
  şeffaflığı kararıdır: yetkiyi kimin kullandığı bilinmeden denetlenemez. Roller takma adlı hesap verisidir (kayıt memuru kimliğe
  bağlayabildiği için kişisel veridir; [KVKK](KVKK.md) envanteri #5), özel nitelikli değildir; açıklanmaları yönetişim şeffaflığı ve
  erişim denetimi amacıyla meşru menfaate (KVKK md. 5/2-f) dayanır ve hesap listesi zaten herkese açıktır. Gizlenmeleri bir API sözleşmesi değişikliği olurdu (`PublicUser.roles`). Bir personel rolü yalnız
  **doğrulanmış (etkin) üyeye verilebilir** (`PUT /api/admin/users/:id/roles` → 409 `not_verified`); personel yetkisi (R/D/A/E)
  sunucuda ve arayüzde yalnız doğrulanmış hesapta geçerlidir.

### 5.2 Giriş ve istek güvenliği

- **Hız sınırı** IP başına dakikada sayılır (`RATE_LIMIT_GLOBAL` 300, `RATE_LIMIT_AUTH` 20). Sunucu ters vekil arkasındaysa IP,
  `TRUST_PROXY` ile `X-Forwarded-For`'dan okunur (varsayılan kapalı; README "Ters vekil arkasında"). Kapalıyken vekil arkasında herkes
  tek IP sayılır; sayı ya da `true` ile açıkken sunucuya vekili atlayarak ulaşılabiliyorsa istemci IP taklit edebilir (açılışta uyarı
  yazılır; vekil adresleri listesi önerilir).
- **Hesap başına giriş kilidi** (IP sınırından ayrı): aynı tanımlayıcıya (normalleştirilmiş takma ad ya da e-posta) karşı 15 dakikada
  5 başarısız denemeden sonra tanımlayıcı 15 dakika kilitlenir (`429 login_locked`, `Retry-After`). Anahtar hesap değil
  **tanımlayıcıdır** ve var olmayan bir ad için de aynı sayaç ve aynı ileti işler; yanıt hesabın var olup olmadığını ele vermez.
  Takma ad ve e-posta ayrı sayılır (tek sayaç, hangi e-postanın hangi takma ada ait olduğunu sızdırırdı); bu yüzden bir hesaba
  karşı 15 dakikada en çok 5 + 5 deneme yapılabilir. Deneme şifre denetiminden önce sayılır (eşzamanlı istekler sınırı aşamaz);
  kilitliyken şifre denetlenmez; başarılı giriş sayacı sıfırlar; denetim günlüğüne `identity.login_locked` (tanımlayıcı yazılmaz)
  kilit başına bir kez yazılır. Süreler gerçek saatledir; sayaçlar bellektedir (en çok 10 000 tanımlayıcı, yeniden başlatmada
  sıfırlanır; tanımlayıcı düz metin değil özet olarak tutulur). Bellek dolunca önce süresi dolmuş kayıtlar, sonra **kilitsiz**
  kayıtlardan en az denemesi olan atılır; kilitli kayıt ancak hepsi kilitliyse atılır. Böylece rastgele adlarla belleği dolduran
  (çok adresli) bir saldırgan hedef hesabın kilidini sildiremez; bunun için 10 000 ayrı tanımlayıcıyı kilitlemesi (50 000 başarısız
  deneme) gerekir.
- **Yeniden gönderimde çift kayıt (`Idempotency-Key`).** İstemci her gönderim denemesine bir anahtar (UUID) verir; yanıt belirsiz
  kalırsa (zaman aşımı, bağlantı kopması, 502/503/504) aynı istek AYNI anahtarla yeniden gönderilir. Sunucu, oturumlu kullanıcı +
  yöntem + yol + anahtar için ilk başarılı (2xx) yanıtı bellekte 10 dakika saklar ve işlemi tekrarlamadan aynı yanıtı döndürür
  (`Idempotent-Replayed: true`); aynı anahtar farklı gövdeyle gelirse 422. Yanıt, istemci vazgeçmiş olsa da işlem bitince saklanır.
  Sınırlar: 5000 kayıt, toplam 32 MB, yanıt başına 1 MB. İstek gövdeleri saklanmaz; yalnız süreç başına rastgele anahtarlı bir HMAC
  özeti tutulur. Anonim istekler, `/api/auth/*`, şifre değiştirme ve çözülmüş kişisel veri döndüren ya da yalnız okuma yapan uçlar
  kapsam dışıdır: kişisel veri bellekte tutulmaz ve her kişisel veri okuması erişim kaydına yeniden yazılır ([API.md](API.md)).
  Web istemcisi bir anahtarı yalnız o kaynağa yapılan **en son** istek bu belirsiz denemeyse yeniden kullanır: aynı kaynağa (ya da
  doğrudan üst/alt kaynağına) başka bir değiştiren istek gidince eski deneme unutulur. Yoksa "Evet (belirsiz) → Hayır → Evet"
  dizisinde sunucu eski "Evet" yanıtını yeniden döndürür ve oy sessizce "Hayır" kalırdı.
- **Değişiklik ve denetim kaydı birlikte.** Kimlik modülünde rol atama, rıza değişikliği, doğrulama/red, kişisel veri erişimi
  (erişim günlüğü + denetim), bekleyen başvuru imhası ve hesap silme, satır değişikliğini ve denetim kaydını **tek işlemde** yazar;
  denetim satırı yazılamazsa değişiklik de geri alınır. Bildirim ve defter kaydı işlemden sonra yapılır (geri alınan iş için hayalet
  kayıt oluşmaz). Hesap silmede ön koşullar (hesap açık, son yönetici değil, şifre, onay) her yan etkiden önce denetlenir; imha ve
  vekâletlerin geri alınması tek işlemdedir; geri alınan vekâletlerin `DELEGATION` kayıtları da işlem COMMIT olunca iletilir (işlem
  geri alınırsa hiç iletilmez; §4 madde 2); `MEMBER_ERASED` kaydı yalnız hesap gerçekten silindiyse ve işlem bittikten sonra yazılır.
  Kimlik modülünün gönderdiği bir defter kaydı reddedilirse bu artık yutulmaz: denetim günlüğüne `identity.ledger_error` (yalnız işlem
  türü ve hata kodu; üye bilgisi ve hata iletisi yok) ve sunucu günlüğüne düşer.

## 6. Zaman

- Alan mantığı `Date.now()` kullanmaz; tüm modüller enjekte edilen `Clock` arayüzünü kullanır. **İstisna — gerçek duvar saatiyle
  ölçülen dört süre:** IP hız sınırının penceresi ve `Retry-After`'ı, hesap başına giriş kilidi, `Idempotency-Key` saklama süresi
  ve bekleyen başvurunun 180 günlük imhası (başvurunun gerçek açılış anı `meta` tablosunda `identity.pending_since:<üye>`
  anahtarındadır). Gerekçe: demo hızlandırması (`TIME_SCALE`, "ileri al") gerçek kişilerin kimlik verisini erken imha etmemeli ve
  kilit süresini kısaltmamalıdır. Geri kalan her şey simüle saatledir; bunlar arasında oturum süresi (180 gün, [KVKK §4.4](KVKK.md)),
  reşitlik hesabı ve saatlik YZ analiz kotası da vardır (kotanın `Retry-After`'ı simüle saniyedir).
- Sunucu `ScaledClock` kullanır: simüle zaman gerçek zamandan `TIME_SCALE` kat hızlı akar (varsayılan 60: 1 saat = 1 dakika).
  Süreler ALGORITMA.md'deki gerçek değerlerdir; takvim tutarlıdır. Yönetici saati ileri alabilir (`POST /api/admin/clock/advance`).
  Saat durumu `meta.sim_clock` kaydında saklanır; sunucu kapalıyken simüle zaman ilerlemez (düzgün kapanış saati tam kaydeder).
  Çalışırken saat her 5 gerçek saniyede ve "ileri al"da, `leaseUntil = simNow + 2 × 5 sn × TIME_SCALE` kirasıyla (bir sonraki
  kayda dek verilebilecek en geç simüle zaman) kaydedilir. Açılışta saat `max(kayıtlı an, kira üst sınırı, veritabanındaki en son
  olay zamanı + 1 ms)` değerinden başlar: sert kapanış (çökme, `taskkill /F`) saati **geriye götürmez**, en çok bir kira kadar ileri
  atar (`TIME_SCALE=60`'ta 10 simüle dakika). En son olay zamanı `phase_events.at`; `proposals`, `messages`, `ballots`,
  `expert_assignments` için `updated_at`; `tallies`, `cluster_snapshots`, `graph_runs`, `ai_analyses`, `expert_reports`,
  `notifications` için `created_at` ve `ledger_outbox.submitted_at` kayıtlarından alınır (gelecekteki süre sonu sütunları ve
  kimlik, oturum, denetim tabloları bilerek dışarıdadır). Dışarıdan verilen `ScaledClock` (ör. tohum betiği) bu kurala bağlı değildir:
  yalnız kapanışta kaydedilir.
- Saat **çalışırken de geri gitmez**: `ScaledClock.now()` son verdiği andan küçük bir değer vermez. Duvar saati geri adım atarsa (ör.
  işletim sisteminin zaman eşitlemesi; `TIME_SCALE=60`'ta 2 sn'lik geri adım 120 simüle saniye ederdi) simüle saat, duvar saati
  yeniden yetişene dek o anda bekler; "ileri al" bu sırada da tam süre kadar etkilidir.
- Testler `ManualClock` kullanır; zamanlayıcı `lifecycle.tick()` ile elle sürülür.

## 7. Veri saklama

- `server/data/forum.db` (ana veritabanı), `server/data/ledger/v0..v3.db` (doğrulayıcı kopyaları), `server/data/keys/` (anahtarlar,
  0600 izinli; üretimde KMS/ortam değişkeni).
- Tartışma, öneri, konu ve graf kayıtları fiziksel olarak silinmez; yalnızca durum/görünürlük alanları değişir.
- Kişinin kendi verisini silmesi kimlik kasasında **kripto-imha** ile yapılır (KVKK.md).
- **Şema sürümü ve göçler:** `meta.schema_version` ve `db/migrations.ts` içindeki sıralı `MIGRATIONS` listesi. Sürüm 1 = taban
  (`schema.sql`); **sürüm 2** = `ledger_outbox` tablosu. Yeni bir şema değişikliği sürüm 3 ve sonrası olarak listeye eklenir ve
  `schema.sql` da güncellenir. Eksik göçler tek işlemde uygulanır; daha yeni sürümlü bir veritabanını eski yazılım açmaz
  (`SchemaVersionError`). Bu yüzden sürüm 2'ye geçilmiş bir veri klasörü eski yazılımla açılamaz.
- **Sürüm 2'den 1'e el ile geri dönüş** (yazılım şema sürümü 2'den önceki bir sürüme geri alınacaksa):
  1. Sunucuyu **düzgün** kapatın (Ctrl+C / SIGTERM; `taskkill /F` değil). Kapanış defter havuzunu boşaltır ve onaylanan işlemlerin
     giden kutusu satırlarını siler.
  2. Veri klasörünün yedeğini alın (`server/data`).
  3. Giden kutusunun boş olduğunu denetleyin: `SELECT COUNT(*) FROM ledger_outbox;` → `0`. Boş değilse sunucuyu yeni yazılımla bir
     kez daha açıp defterin bu satırları işlemesini bekleyin ve yeniden düzgün kapatın. Satırlar varken geri dönülürse o işlemler
     **deftere hiç yazılmaz** (veritabanı kaydı kalır, defter kaydı kaybolur).
  4. Aynı işlemde: `BEGIN; DROP TABLE ledger_outbox; UPDATE meta SET value = '1' WHERE key = 'schema_version'; COMMIT;`
     (ör. `sqlite3 server/data/forum.db`). Eski yazılım veritabanını artık açar; yeniden yükseltmede sürüm 2 göçü tabloyu yeniden kurar.
- **Süreç belleğinde tutulanlar** (kalıcı değildir, yeniden başlatmada sıfırlanır): hesap başına giriş sayaçları ve `Idempotency-Key`
  yanıt deposu (§5.2). Doğrulayıcı havuzlarının bellek kopyası giden kutusu sayesinde kayıpsızdır (§4).

## 8. İstemci

- `web/src/api/endpoints.ts`: API.md'deki her uç nokta için tipli fonksiyon.
- `web/src/auth/AuthContext.tsx`: oturum, rol yardımcıları, sunucu saatine göre düzeltilmiş `now()`. Yetkiler saf `derivePermissions`
  ile hesaplanır: görev rolleri (kayıt memuru, denetçi, yönetici) ve bilirkişilik yalnız **doğrulanmış** hesapta geçerlidir
  (sunucudaki `requireRole` / `requireExpert` ile aynı sonuç).
- `web/src/api/client.ts`: oturumlu her değiştiren isteğe otomatik `Idempotency-Key` ekler; yanıtı belirsiz kalan aynı istek yeniden
  gönderilince aynı anahtar kullanılır (§5.2).
- HashRouter: aynı paket hem web'de (sunucunun `web/dist`'i sunması ya da Vite geliştirme sunucusu) hem Android WebView'de çalışır.
- Android: Capacitor; uygulama içi sunucu adresi ayarlanabilir (emülatör varsayılanı `http://10.0.2.2:4000`); sunucu CORS ayarında
  `http://localhost` ve `capacitor://localhost` kökenlerine izin verir.
