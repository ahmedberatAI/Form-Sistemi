# REST API Sözleşmesi

> Tüm yollar `/api` önekiyle başlar. İstek ve yanıt gövdeleri JSON'dur (Turtle dışa aktarımı hariç).
> Tipler: alan tipleri için `shared/src/types.ts`, istek/yanıt sarmalayıcıları için `shared/src/api.ts`.
> Sunucu uygulaması: `server/src/http/`, istemci: `web/src/api/endpoints.ts`.

## Genel kurallar

- **Kimlik doğrulama:** `Authorization: Bearer <token>`. Belirteç `POST /api/auth/login` ile alınır.
- **Hata biçimi:** `{"error": {"code": "...", "message": "Türkçe açıklama", "details": ...}}`. Durum sınıfına göre sık görülen
  `code` değerleri (tam liste: [Hata kodları](#hata-kodları)):
  - `400` `validation` (zod doğrulaması; `details` = alan → ileti), `wrong_password`, `idempotency_key_invalid`,
  - `401` `unauthorized` (oturum yok ya da geçersiz), `invalid_credentials` (giriş başarısız),
  - `403` `forbidden` (`details.reason` ile: `role_required`, `not_verified`, `suspended`, `inactive`, `not_adult`, …),
  - `404` `not_found` (kaynak ya da uç nokta yok; kayıtlı bir yola desteklenmeyen yöntemle gelen istek de, ör. `PUT /api/health`,
    404 alır: sunucu `405` üretmez),
  - `413` `payload_too_large` (gövde en çok 1 MB), `415` `unsupported_media_type` (yalnız `application/json`),
  - `409` (durum çakışması: `invalid_state`, `version_conflict`, `duplicate_nickname`, `last_admin`, `delegation_cycle`,
    `not_verified`, `idempotency_in_progress`, …),
  - `422` (iş kuralı: `pii_detected`, `inadmissible_revision`, `objection_budget`, `not_eligible`, `consent_required`,
    `deletion_limit`, `suggestion_limit`, `idempotency_key_reused`, …),
  - `429` `rate_limited` (IP hız sınırı, saatlik YZ analiz kotası) ve `login_locked` (hesap başına giriş kilidi ya da üye başına
    şifre teyidi kilidi); ikisinde de `Retry-After` başlığı ve `details.retryAfterSeconds` vardır,
  - `500` `internal`, `503`/`504` `ledger_*` (defter durmuş ya da zaman aşımı).
- **Zaman:** Tüm zaman damgaları milisaniyedir ve **sunucunun simüle saatine** göredir (`GET /api/system` → `now`).
  İstemci geri sayımları `now` farkıyla düzeltir. IP hız sınırının `Retry-After`'ı, giriş kilidi (`login_locked`) ve
  `Idempotency-Key` saklama süresi **gerçek saatledir**; saatlik YZ analiz kotası (429 `rate_limited`) simüle saatle sayılır, bu yüzden
  onun `Retry-After`'ı simüle saniyedir (`TIME_SCALE=60`'ta gerçek bekleme 60 kat kısadır).
- **CORS kökenleri:** `http://localhost` (Capacitor Android), `capacitor://localhost`, `https://localhost`, `http://localhost:5173`.
  İzin verilen istek başlıkları: `Authorization`, `Content-Type`, `Accept`, `Idempotency-Key`; istemciye açılan yanıt başlıkları:
  `Retry-After`, `X-RateLimit-*`, `Idempotent-Replayed`.
- **Hız sınırı:** genel 300 istek/dk/IP; `auth/*` 20 istek/dk (ortam değişkenleri `RATE_LIMIT_GLOBAL`, `RATE_LIMIT_AUTH`;
  `0` → o sınırlayıcı kapalı, yalnız test/uçtan uca ortam için). Şifre teyidi isteyen ya da kimlik verisi soran hesap uçları
  (`POST /api/me/password`, `PATCH /api/me/nickname`, `POST /api/me/erase`, `POST /api/me/corrections`) genel sınıra ek olarak aynı
  20 istek/dk sayacına da tabidir. Ters vekil arkasında IP, `TRUST_PROXY` ile `X-Forwarded-For`'dan
  okunur (varsayılan kapalı; [README](../README.md) "Ters vekil arkasında"). Hesap başına giriş kilidi ayrıdır
  ([aşağıda](#giriş-kilidi-429-login_locked)).
- **Güvenlik başlıkları:** her yanıtta (API, `index.html` ve statik dosyalar, hata gövdeleri dahil) `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY` ve `Content-Security-Policy: frame-ancestors 'none'` vardır: uygulama hiçbir kökende `iframe` içinde
  açılamaz (görünmez çerçeveyle oy/destek/vekâlet tıklatma yok). Capacitor paketi yerelden yüklendiği için etkilenmez. `/api/*`
  yanıtları ayrıca `Cache-Control: no-store` taşır.
- **Kişisel veri:** Hiçbir herkese açık yanıtta ad, soyad, TCKN, adres, doğum tarihi, e-posta, telefon yoktur.
  Yalnızca `R`/`D` rolleri, amaç belirterek ve erişim kaydıyla `PiiRecord` görebilir. Roller (`PublicUser.roles`: yönetici, kayıt memuru,
  denetçi) ve hesap durumu bilinçli olarak herkese açıktır (yönetişim şeffaflığı; [KVKK §4.2](KVKK.md)). Görüş kümesi bilgisi kişinin
  kendisine özeldir; iki dar istisnası (silme oylamasında yazar kümesi, azınlık raporu) [KVKK §4.3](KVKK.md)'te anlatılır.

### Yetki kısaltmaları

| Kısaltma | Anlamı |
|---|---|
| — | Herkese açık (oturum gerekmez; varsa görüntüleyene göre zenginleşir) |
| U | Oturum açmış herhangi bir kullanıcı (doğrulama bekleyen dahil) |
| V | Doğrulanmış üye (`status = verified`) |
| VV | Oy verebilir üye: doğrulanmış + 18 yaşından büyük + siyasi görüş açık rızası |
| R | Kayıt memuru (`registrar`) |
| D | Denetçi (`auditor`) |
| A | Yönetici (`admin`) |
| E | Etkin bilirkişi (`experts.status = active`) |

Yönetici her rolün yetkisine sahiptir; denetçi `R`'nin okuma uç noktalarını kullanabilir. **R, D, A ve E yalnız doğrulanmış
(`status = verified`) hesapta geçerlidir:** bekleyen ya da askıdaki bir hesaba rol verilmiş olsa bile personel uçları 403 `forbidden`
(`details.reason`: `inactive`) döner; bu yüzden personel rolü yalnız doğrulanmış üyeye verilebilir ([rol atama](#yönetim)). Web
istemcisi menüyü ve sayfa korumalarını aynı kurala göre kurar. `403` yanıtlarında `details.reason`: `role_required` (rol yok),
`not_verified` (başvuru onay bekliyor), `suspended`, `inactive`, `not_adult`, `political_consent_required`, `expert_required`.

### Hata kodları

Başarısız yanıtların `error.code` alanı. Servis katmanının alana özgü 400 kodları tek tek sayılmamıştır; örnekler: `self_follow`,
`self_vouch`, `self_relation` (kendi hesabına takip, kefalet, yakınlık), `self_delegation` (kendine vekâlet), `invalid_scope`
(tanımsız vekâlet kapsamı), `credentials_length` (aşağıda), `body_too_short` (bilirkişi rapor metni kırpıldıktan sonra 50 karakterden
kısa), `foreign_question` / `duplicate_answer` (raporda bu öneriye ait olmayan ya da yinelenen soru yanıtı).

- **`details` her kodda yoktur.** Açıklama her zaman üst düzey `message`'dadır. Alan adı → ileti eşlemesi `validation` kodunda
  her zaman, diğer kodlarda yalnız bu belgede `details` yazılan yerlerde gelir (ör. `credentials_length` → `details.credentials`,
  `POST /api/me/delegations`'ta `invalid_scope` → `details.scope`). `self_*`, `body_too_short`, `foreign_question` ve
  `duplicate_answer` yalnız `message` taşır. İstemci `message`'ı göstermeli, `details`'i yalnız varsa ilgili alanın yanında
  kullanmalıdır.
- **Sınırlar önce şemada denetlenir.** Zorunlu alanın boşluğu, üst uzunluk sınırı, tür ve izinli değer listesi servisten önce
  zod şemasında denetlenir. Bunlar 400 `validation` ile (`details` = alan → ileti) döner. Bu yüzden servis içindeki eşdeğer kodlar
  (`body_too_long`, `invalid_rank`, `invalid_decision` …) HTTP üzerinden görülmez: 20 000 karakteri aşan rapor metni
  `details.body`, 1–3 dışındaki vekâlet sırası `details.rank` ile `validation` döner.
- **Bozuk adresler de aynı gövdeyi alır.** Bozuk yüzde kodlaması (ör. `/api/users/%E0%A4%A`) ve 256 karakteri aşan yol parametresi
  400 `validation` döner (`details` yok); 256 karaktere kadar olan kimlikler şemaya ulaşır (şemadaki kimlik sınırı 200: 201–256
  karakter `validation` + alan adı, daha kısası olağan 404/400).
- **Tür ve "zorunlu" iletileri ayrıdır.** Kayıt ve düzeltme formunda alan hiç verilmemişse ileti "… zorunludur.", verilmiş ama metin
  değilse (ör. `nickname: 12345`) "… metin olmalıdır." olur.

`inadmissible`, `already_voted` gibi adlar **hata kodu değildir**: `inadmissible` bir evre adıdır ve aynı turda ikinci oy 409
üretmez, öncekini günceller (yeni makbuz).

| Durum | Kod | Ne zaman |
|---|---|---|
| 400 | `validation` | Gövde, sorgu ya da yol doğrulaması başarısız; `details` = `{ "alan.yolu": "ileti" }` |
| 400 | `bad_request` | Genel geçersiz istek |
| 400 | `wrong_password` | Şifre teyidi yanlış (`/api/me/erase`, `/api/me/nickname`, `/api/me/password`) |
| 400 | `minority_question_unanswered` | Azınlık güvenceli soru yanıtsız (`details.questionIds`) |
| 400 | `idempotency_key_invalid` | `Idempotency-Key` biçimi geçersiz |
| 400 | `unknown_domain` | Bilirkişi başvurusunda (ve yöneticinin onayında) uzmanlık alanı yönetmelikte tanımlı bir kategori değil: bilinmeyen IRI, serbest URL ya da kök kategori (`details.domains`) |
| 400 | `credentials_length` | Bilirkişi başvurusunda yeterlilik metni baştaki ve sondaki boşluklar kırpıldıktan sonra 3 karakterden kısa (ör. `"ab"`, `"   "`; `details.credentials`). Boş metin ve 5000 karakteri aşan metin şemada takılır: 400 `validation`, `details.credentials`. Girişteki 401 `invalid_credentials` ile karıştırılmasın diye ayrı koddur |
| 401 | `unauthorized` | Oturum yok ya da belirteç geçersiz/süresi dolmuş/iptal |
| 401 | `invalid_credentials` | Takma ad/e-posta ya da şifre hatalı (hesabın var olup olmadığı belli edilmez) |
| 403 | `forbidden` | Yetki yok; `details.reason` yukarıda |
| 404 | `not_found` | Kaynak ya da uç nokta yok. Kayıtlı bir yola desteklenmeyen yöntemle gelen istek de (ör. `PUT /api/health`, `DELETE /api/proposals`) 404 alır; ileti yöntemi ve yolu söyler. Sunucu `405 method_not_allowed` üretmez: Fastify yönlendiricisi bu isteği eşleşmeyen yol sayar (`OPTIONS` istekleri CORS ön uçuşu olarak işlenir) |
| 413 / 415 | `payload_too_large` / `unsupported_media_type` | Gövde 1 MB'tan büyük / içerik türü JSON değil |
| 409 | `invalid_state` | İşlem öneri/hesabın şu anki evresinde ya da durumunda yapılamaz (en yaygın çakışma). Ör. kapanmış (silinmiş ya da reddedilmiş) bir hesaba takip, kefalet ya da yakınlık beyanı; hesabı kapanmış üyenin bilirkişi kaydına karar ya da yaptırım |
| 409 | `version_conflict`, `bylaw_version_conflict` | Metin, konu ya da yönetmelik sürümü bu arada değişti |
| 409 | `duplicate_nickname`, `similar_nickname`, `duplicate_tckn`, `duplicate_email` | Kayıt/takma ad değişikliğinde tekillik ya da taklit denetimi. Düzeltme talebinde TCKN/e-posta çakışması talep anında değil, kayıt memurunun onayında 409 olur (bkz. [düzeltme akışı](#kayıt-memuru)) |
| 409 | `last_admin` | Son yönetici rolünü düşüremez ya da hesabını silemez |
| 409 | `not_verified` | Personel rolü doğrulanmamış (bekleyen/askıdaki) hesaba verilemez (`PUT /api/admin/users/:id/roles`) |
| 409 | `delegation_cycle` | Vekâlet bir döngü oluşturur |
| 409 | `already_sponsored`, `already_objected`, `already_reported`, `already_requested`, `already_decided`, `already_rebutted`, `already_applied`, `already_expert`, `already_erased` | Aynı işlem bu hesapça ya da bu kayıt için zaten yapılmış |
| 409 | `correction_pending`, `review_required`, `not_pending`, `suggestion_lapsed`, `expert_suspended`, `admin_exists`, `pii_erased` | Düzeltme talebi, metin önerisi, bilirkişi ve yönetici akışlarının durum çakışmaları |
| 409 | `idempotency_in_progress`, `idempotency_replay_unavailable` | Bkz. [Idempotency-Key](#yeniden-gönderim-idempotency-key) |
| 422 | `pii_detected` | Metinde kişisel veri olabilecek ifade var (`details.pii`); onaylanıp `acknowledgePii: true` ile yeniden gönderilebilir |
| 422 | `inadmissible_revision` | Revizyon yönetmeliğe aykırı; önceki metin geçerli kalır |
| 422 | `not_eligible`, `consent_required` | Seçmen listesinde değil ya da siyasi görüş rızası yok (oy, itiraz, azınlık raporu) |
| 422 | `objection_budget` | 30 günde 2 itiraz bütçesi doldu (`details.nextAvailableAt`) |
| 422 | `deletion_limit`, `suggestion_limit` | Açık silme talebi (3) / günlük talep (5) / açık metin önerisi sınırı |
| 422 | `nickname_change_limit` | Takma ad 30 günde bir değişir (`details.nextAllowedAt`) |
| 422 | `own_proposal`, `own_message`, `invalid_kind`, `invalid_target`, `delegate_not_verified`, `bylaw_patch_invalid` | Kendi önerisini/mesajını desteklemek vb., geçersiz tür ya da hedef, doğrulanmamış delege, geçersiz yönetmelik yaması |
| 422 | `ledger_pii`, `ledger_bad_*`, `ledger_rejected`, `ledger_too_large` | Defter işlemi reddedildi (kişisel veri anahtarı, geçersiz yük) |
| 422 | `idempotency_key_reused` | Aynı anahtar aynı uçta farklı istekle kullanıldı |
| 429 | `rate_limited` | IP hız sınırı ya da saatlik YZ analiz kotası; `Retry-After`, `details.retryAfterSeconds` |
| 429 | `login_locked` | Hesap başına giriş kilidi ya da üye başına şifre teyidi kilidi (`/api/me/password`, `/api/me/nickname`, `/api/me/erase`); `Retry-After`, `details.retryAfterSeconds` |
| 500 | `internal`, `vault_integrity` | Beklenmeyen hata (ayrıntı yalnız sunucu günlüğünde); kimlik kasası bütünlük hatası |
| 503 / 504 | `ledger_stopped`, `ledger_not_running` / `ledger_timeout` | Defter durdu ya da zamanında onaylamadı |

### Yeniden gönderim: Idempotency-Key

Zayıf bağlantıda ya da yavaş yanıtta (ör. YZ moderasyonu istemci zaman aşımını aşarsa) istemci vazgeçip "tekrar deneyin" der; oysa
sunucu işlemi bitirmiş olabilir. `Idempotency-Key` bu yeniden denemede çift kaydı önler.

- **Başlık:** `Idempotency-Key: <anahtar>`; 8–128 karakter, harf, rakam ve `- _ . :` (bir UUID uyar). Oturum açmış kullanıcının
  `POST`/`PUT`/`PATCH`/`DELETE` isteklerinde işlenir; kapsam **kullanıcı + yöntem + yol + anahtar**dır.
- **Davranış:** ilk istek çalışır. Başarılı (2xx) yanıt, ilk isteğin gelişinden itibaren **10 dakika** (gerçek saat) bellekte
  saklanır; aynı anahtarla gelen sonraki istek işlemi **tekrarlamadan** aynı durum kodunu ve gövdeyi döndürür ve
  `Idempotent-Replayed: true` başlığını ekler. İstemci bağlantıyı koparmış olsa da yanıt işlem bitince saklanır.
- **Hatalar:** aynı anahtar aynı uçta farklı gövde ya da sorguyla gelirse 422 `idempotency_key_reused`; biçim bozuksa 400
  `idempotency_key_invalid`; ilk istek hâlâ sürüyorsa kopya onun sonucunu en çok 25 sn bekler, süre dolarsa 409
  `idempotency_in_progress` (aynı anahtarla yeniden göndermek güvenlidir); işlem yapıldı ama yanıt saklanamayacak kadar büyükse (1 MB)
  409 `idempotency_replay_unavailable` (işlem tekrarlanmaz, sonucu görmek için sayfa yenilenir). 2xx olmayan yanıt saklanmaz: anahtar
  serbest kalır ve yeniden gönderim baştan işlenir.
- **Sınırlar:** 5000 kayıt, toplam 32 MB, kullanıcı başına 4 MB, yanıt başına 1 MB. Bayt sınırı aşılınca kayıt **silinmez**: en
  eski tamamlanmış kayıtların yalnız saklanan gövdesi bırakılır, "işlendi" bilgisi ve parmak izi 10 dakika boyunca kalır; aynı
  anahtarla yeniden gönderim işlemi tekrarlamaz, 409 `idempotency_replay_unavailable` alır. Kullanıcı başına kota aşılınca önce o
  kullanıcının kendi en eski gövdeleri bırakılır (bir kullanıcının büyük yanıtları başkalarının çift kayıt korumasını düşüremez).
  Yalnız kayıt sayısı sınırı (5000) en eski tamamlanmış kaydı tümüyle atar. Depo süreç belleğindedir; yeniden başlatmada silinir ve
  bu yüzden o andan sonraki bir yeniden gönderim baştan işlenir.
- **Kapsam dışı (başlık yok sayılır):** anonim istekler, `/api/auth/*`, `/api/me/password`, `/api/registrar/users/:id/pii`,
  `/api/registrar/corrections/:id/review`, `/api/proposals/precheck`, `/api/messages/precheck`, `/api/experts/lint`,
  `/api/ontology/validate-patch`. Şifre içeren ve çözülmüş kişisel veri döndüren uçlar bellekte tutulmaz (her kişisel veri okuması
  erişim kaydına yeniden yazılır); yalnız okuma yapan uçlarda tekrar zaten zararsızdır.
- **Gizlilik:** istek gövdeleri saklanmaz, yalnız süreç başına rastgele anahtarlı bir HMAC özeti tutulur. Saklanan yanıtlar içerik
  üreten uçların başarılı yanıtlarıdır (ör. `MessageView`'daki mesaj metni) ve en çok 10 dakika sunucu belleğinde kalır
  ([KVKK §4.5](KVKK.md)).
- **Web istemcisi:** oturumlu her değiştiren isteğe (`/api/auth/*` hariç) otomatik bir UUID anahtarı koyar. Sonuç belirsizse (ağ
  hatası, zaman aşımı, 502/503/504, `idempotency_in_progress`) aynı yöntem, adres ve gövdeyle yeniden gönderim AYNI anahtarı kullanır;
  kesin bir yanıt (başarı ya da sunucunun verdiği hata) anahtarı unutturur; hesap değişince bekleyen anahtarlar silinir. Anahtar
  yalnız o kaynağa yapılan **en son** istek bu belirsiz denemeyse yeniden kullanılır: aynı kaynağa (sorgusuz yol) ya da doğrudan
  üst/alt kaynağına (ör. `POST /api/me/delegations` ↔ `DELETE /api/me/delegations/:id`) başka bir değiştiren istek gidince eski
  belirsiz deneme unutulur. Böylece "Evet (belirsiz) → Hayır → Evet" dizisi eski "Evet" yanıtını yeniden almaz, oy gerçekten değişir.
  `request()` seçeneği `idempotencyKey`: metin → bu anahtar, `false` → başlık yok.

### Giriş kilidi (429 login_locked)

`POST /api/auth/login`: aynı **normalleştirilmiş tanımlayıcıya** (takma ad ya da e-posta) karşı 15 dakika içinde 5 başarısız denemeden
sonra tanımlayıcı 15 dakika kilitlenir; yanıt `429 login_locked`, `Retry-After` başlığı (saniye) ve `details.retryAfterSeconds`
taşır. İleti: "Bu takma ad ya da e-posta ile çok fazla başarısız giriş denemesi yapıldı. Güvenliğiniz için giriş geçici olarak
durduruldu; lütfen N dakika sonra tekrar deneyin."

- Kilitliyken doğru şifre bile reddedilir ve şifre denetlenmez. Başarılı giriş sayacı sıfırlar; kayıt olmak ya da takma ad
  değiştirmek, yeni takma adın sayacını sıfırlar (kayıt sonrası otomatik giriş 429 almaz).
- **Sızıntı yok:** anahtar hesap değil tanımlayıcıdır; var olmayan bir ad için de aynı davranış ve aynı ileti vardır. Takma ad ve
  e-posta ayrı sayılır (tek sayaç, hangi e-postanın hangi takma ada ait olduğunu sızdırırdı); bu yüzden bir hesaba karşı 15 dakikada
  en çok 5 + 5 deneme yapılabilir.
- Deneme, şifre denetiminden önce sayılır (eşzamanlı istekler sınırı aşamaz). Süreler gerçek saatledir; sayaçlar bellektedir
  (en çok 10 000 tanımlayıcı, yeniden başlatmada sıfırlanır; tanımlayıcı özet olarak tutulur). Bellek dolunca önce süresi
  dolmuşlar, sonra kilitsiz kayıtlardan en az denemesi olan atılır; kilitli kayıt ancak hepsi kilitliyse atılır (rastgele adlarla
  bellek doldurularak kilit silinemez). Sınırlar kod sabitidir, ortam değişkeni yoktur. IP başına `rate_limited` sınırından ayrıdır.
- Denetim günlüğü: `identity.login_failed` var olan bir hesaba yönelik her başarısız denemede (hedef: hesap kimliği); `identity.login_locked`
  kilit başına bir kez (hedef: hesap varsa kimliği, yoksa boş; `meta.via` = `nickname` ya da `email`). Tanımlayıcı hiçbirine yazılmaz.
- **Eşzamanlı şifre değişikliği:** oturum yalnız şifre özeti doğrulama süresince değişmemişse açılır. Eski şifreyle başlamış bir giriş,
  arada şifre değiştirildiyse (ya da hesap silindiyse) 401 `invalid_credentials` alır; böylece değişikliğin yaptığı oturum iptalinden
  kaçan oturum olmaz.

**Şifre teyidi kilidi.** Mevcut şifreyi soran işlemler (`POST /api/me/password`, `PATCH /api/me/nickname`, `POST /api/me/erase`)
oturumdaki **üyenin kimliğine** bağlı ayrı bir sayaç kullanır (eşikler girişle aynı: 15 dakikada 5 yanlış şifre → 15 dakika kilit).
Kilitliyken üç işlem de 429 `login_locked`, `Retry-After` ve `details.retryAfterSeconds` döner ve şifre denetlenmez; ileti: "Şifre
teyidinde çok fazla başarısız deneme yapıldı. Güvenliğiniz için şifre gerektiren işlemler geçici olarak durduruldu; lütfen N dakika
sonra tekrar deneyin." Doğru şifre sayacı sıfırlar; kilit başına bir kez `identity.reauth_locked` yazılır. Amaç: ele geçirilmiş bir
oturum belirteciyle şifrenin kaba kuvvetle bulunup değiştirilmesini (değişiklik diğer oturumları kapatıp hesabı kalıcı olarak ele
geçirirdi) engellemek. Giriş kilidinden bağımsızdır: biri diğerini kilitlemez.

## Sistem

| Yöntem | Yol | Yetki | Gövde | Yanıt |
|---|---|---|---|---|
| GET | `/api/health` | — | | `{ok:true}` |
| GET | `/api/system` | — | | `SystemInfo` |
| GET | `/api/dashboard` | — | | `Dashboard` |

## Kimlik ve hesap

| Yöntem | Yol | Yetki | Gövde | Yanıt |
|---|---|---|---|---|
| POST | `/api/auth/register` | — | `RegistrationInput` | `AuthResponse` (durum `pending`) |
| POST | `/api/auth/login` | — | `LoginRequest` | `AuthResponse` (hatalı: 401 `invalid_credentials`; hesap başına kilit: 429 `login_locked` + `Retry-After`) |
| POST | `/api/auth/logout` | U | | `OkResponse` |
| GET | `/api/me` | U | | `Me` |
| PATCH | `/api/me/consents` | U | `ConsentsRequest` | `Me` |
| POST | `/api/me/password` | U | `ChangePasswordRequest` | `OkResponse` (yanlış eski şifre 400 `wrong_password`; şifre teyidi kilidi 429 `login_locked`) |
| PATCH | `/api/me/nickname` | U | `ChangeNicknameRequest` (yeni takma ad + mevcut şifre) | `Me` (yanlış şifre 400 `wrong_password`; şifre teyidi kilidi 429 `login_locked`; 409 `duplicate_nickname` / `similar_nickname`; 30 günde bir → 422 `nickname_change_limit`, `details.nextAllowedAt`) |
| GET | `/api/me/export` | U | | KVKK döküm JSON (kendi verisi, şifresi çözülmüş) |
| POST | `/api/me/erase` | U | `EraseRequest` (`confirm` = `"SİL"` **ve** `password` = mevcut şifre) | `OkResponse` (kripto-imha; oylamaya konmaz). Yanlış şifre 400 `wrong_password` (şifre teyidi kilidi 429 `login_locked`), onay metni eksik/yanlış 400 `validation`, son yönetici 409 `last_admin`, zaten silinmiş 409 `already_erased`. Bu ön koşullar her yan etkiden önce denetlenir; imha, bilirkişi kaydının kapatılması (bekleyen görevler yedeğe devredilir) ve vekâletlerin geri alınması tek veritabanı işlemindedir |
| POST | `/api/me/corrections` | U | `CorrectionRequestInput` | `CorrectionRequestView` (KVKK md. 11/1-d düzeltme talebi; aynı anda tek bekleyen, 409 `correction_pending`; başka üyede kayıtlı TCKN/e-posta talep anında reddedilmez) |
| GET | `/api/me/corrections` | U | | `CorrectionRequestView[]` (kendi talepleri, kendi gerekçesiyle) |
| POST | `/api/me/corrections/:id/withdraw` | U | | `CorrectionRequestView` (bekleyen talebi geri çeker; öneri imha edilir) |
| GET | `/api/me/delegations` | U | | `MyDelegations` |
| POST | `/api/me/delegations` | V | `DelegateRequest` | `DelegationView` |
| DELETE | `/api/me/delegations/:id` | U | | `OkResponse` (kenar silinmez, geri alınır) |
| GET | `/api/me/following` | U | | `PublicUser[]` |
| GET | `/api/me/notifications` | U | `?unread=1` | `NotificationList` |
| POST | `/api/me/notifications/read` | U | `MarkReadRequest` | `OkResponse` |
| GET | `/api/me/tasks` | U | | `DashboardTask[]` |
| GET | `/api/me/assignments` | E | | `MyAssignment[]` |

## Kayıt memuru

| Yöntem | Yol | Yetki | Gövde | Yanıt |
|---|---|---|---|---|
| GET | `/api/registrar/pending` | R, D | | `PendingUser[]` |
| POST | `/api/registrar/users/:id/pii` | R, D | `PiiRequest` | `PiiRecord` (erişim `pii_access_log`'a yazılır) |
| POST | `/api/registrar/users/:id/verify` | R | `VerifyUserRequest` | `Me` |
| POST | `/api/registrar/users` | R | `RegistrationInput` | `{user: Me}` ("Üyeyi sisteme gir": doğrudan doğrulanmış) |
| GET | `/api/registrar/corrections` | R, D | `?status=pending\|approved\|rejected\|withdrawn\|all` | `CorrectionRequestView[]` (değer içermez; varsayılan bekleyenler) |
| POST | `/api/registrar/corrections/:id/review` | R, D | `PiiRequest` | `CorrectionReview` (mevcut/önerilen değerler, TCKN maskeli; erişim `pii_access_log`'a yazılır) |
| POST | `/api/registrar/corrections/:id/decide` | R | `CorrectionDecisionRequest` | `CorrectionRequestView` (önce aynı personel incelemiş olmalı → yoksa 409 `review_required`; kendi talebine karar veremez) |

**Düzeltme akışı:** Üye düzeltilecek alanları (`firstName`, `lastName`, `tckn`, `birthDate`, `email`, `phone`, `address`) ve
gerekçesini gönderir; değerler kayıt formuyla aynı kurallarla doğrulanır. Başka bir üyede kayıtlı TCKN/e-posta talep anında
**reddedilmez** (aksi halde talep ucu, herhangi bir hesapla bir e-postanın ya da TCKN'nin üye olup olmadığını sorgulatırdı); çakışma
yalnız denetim günlüğüne `identity.duplicate_attempt` olarak yazılır ve kayıt memuru onaylarken 409 `duplicate_tckn` /
`duplicate_email` alır (kasa değişmez; talep reddedilebilir). Öneri ve gerekçe kişinin DEK'iyle şifreli saklanır. Kayıt memuru talebi amaç belirterek inceler, sonra onaylar ya da reddeder. Onayda
yalnız değişen kasa alanları yeni IV ile yeniden şifrelenir, kör indeksler ve (adres/doğum tarihi değiştiyse) il/ilçe ve
reşitlik güncellenir; öneri her kararda imha edilir. Denetim günlüğüne (`identity.correction_*`) yalnız alan adları yazılır.

**Takma ad kuralları:** Tekillik anahtarı NFKC + tr-TR küçük harf + I/ı/İ/i katlamasıdır (`nicknameKey`): `YONETICI`,
`Yonetici` ve `yonetici` aynı hesaptır (409 `duplicate_nickname`); giriş de bu anahtarla yapılır. Ayrıca benzerlik iskeleti
(`nicknameSkeleton`: ş→s, ç→c, ğ→g, ö→o, ü→u, şapkalı harfler, 0→o, 1 ve l→i, `.`/`_`/`-` atılır) kayıtlı bir takma adınkiyle
aynıysa (ör. `Yönetici`, `y0netici`, `yonetici_`) kayıt ve değişiklik 409 `similar_nickname` ile reddedilir. Takma ad en az bir
harf ya da rakam içerir (yalnız ayraçtan oluşan `...`, `-_-` gibi adların iskeleti boşa inerdi); ad ve soyad en az bir harf, il,
ilçe, mahalle ve açık adres en az bir harf ya da rakam içerir (400 `validation`). Takma ad
değişikliği (`PATCH /api/me/nickname`) mevcut şifreyle teyit edilir, 30 günde en çok bir kez yapılabilir ve
`identity.nickname_change` olarak günlüğe yazılır (eski/yeni takma ad günlüğe yazılmaz). Takma ad deftere hiç yazılmaz.
`PublicUser.joinedAt` herkese açık yanıtlarda güne (Türkiye saati) yuvarlanır; tam kayıt anı yalnız `Me`'de (sahibine) döner.

## Yönetim

| Yöntem | Yol | Yetki | Gövde | Yanıt |
|---|---|---|---|---|
| POST | `/api/admin/clock/advance` | A | `ClockAdvanceRequest` | `TickResponse` (saat ileri + `lifecycle.tick()`) |
| POST | `/api/admin/tick` | A | | `TickResponse` |

İki uç da geçişlere en çok yaklaşık 20 sn ayırır (web istemcisinin 30 sn zaman aşımından kısa). Yüzlerce önerinin vadesi aynı anda
gelirse kalanlar zamanlayıcıya bırakılır ve yanıt `pending: true` taşır; geçişler arasında olay döngüsüne yol verildiği için diğer
istekler bu sırada bekletilmez.
| GET | `/api/admin/users` | A | `?q=` | `AdminUserRow[]` |
| PUT | `/api/admin/users/:id/roles` | A | `SetRolesRequest` | `Me` (personel rolü yalnız doğrulanmış üyeye verilir: 409 `not_verified`, `details.roles`; rol geri almak her durumda serbesttir; son yönetici düşürülemez: 409 `last_admin`) |
| GET | `/api/admin/audit-log` | A, D | `?action=&actorId=&limit=` | `AuditLogEntry[]` |
| POST | `/api/admin/clusters/recompute` | A | | `ClusterSnapshotView` (**anonim**: üye kimliği ve takma ad yoktur; yönetici de siyasi görüş kümesini kişiyle eşleştiremez) |

## Kullanıcılar ve graf ilişkileri

| Yöntem | Yol | Yetki | Gövde | Yanıt |
|---|---|---|---|---|
| GET | `/api/users` | — | `?q=&limit=` | `PublicUser[]` |
| GET | `/api/users/:id` | — | | `PublicProfile` |
| POST | `/api/users/:id/follow` | V | | `PublicProfile` (kapanmış hesaba 409 `invalid_state`) |
| DELETE | `/api/users/:id/follow` | V | | `PublicProfile` |
| POST | `/api/users/:id/vouch` | V | `VouchRequest` | `PublicProfile` (kapanmış hesaba 409 `invalid_state`) |
| DELETE | `/api/users/:id/vouch` | U | | `PublicProfile` (kendi kefaletini geri alır; kenar silinmez, `revoked_at`; kefalet yoksa işlem yok) |
| POST | `/api/users/:id/relate` | V | `RelateRequest` | `PublicProfile` (çıkar çatışması beyanı; kapanmış hesaba 409 `invalid_state`) |
| DELETE | `/api/users/:id/relate` | U | `?kind=family\|business\|household` (yoksa tümü) | `PublicProfile` (yalnız beyan eden geri alır; karşı tarafın beyanı → 403; kenar silinmez) |

Kapanmış hesap (durumu `erased` ya da `rejected`) takip, kefalet ve yakınlık beyanının hedefi olamaz; doğrulama bekleyen hesap
olabilir. Geri alma uçları (DELETE) kapanmış hesaba kalmış kenarlar için de çalışır.

`PublicProfile.viewer.relatedByMe`: `related` içinden görüntüleyenin kendi beyanları (yalnız bunlar geri alınabilir).
Yakınlık beyanları herkese açık değildir (`RELATED_TO` yalnız denetçi/yönetici grafında); geri alma da yalnız denetim
günlüğünde (`graph.relation_revoked`) görünür. Kefaletin geri alınması `graph.vouch_revoked` olarak kaydedilir.

## Ontoloji (yönetmelik)

| Yöntem | Yol | Yetki | Gövde | Yanıt |
|---|---|---|---|---|
| GET | `/api/ontology` | — | | `OntologyOverview` |
| GET | `/api/ontology/versions` | — | | `BylawVersionInfo[]` |
| GET | `/api/ontology/turtle` | — | `?version=` | `text/turtle` |
| POST | `/api/ontology/validate-patch` | V | `ValidatePatchRequest` | `AuditReport` |

## Öneriler

| Yöntem | Yol | Yetki | Gövde | Yanıt |
|---|---|---|---|---|
| GET | `/api/proposals` | — | `ProposalListQuery` (sorgu dizesi) | `ProposalSummary[]` |
| POST | `/api/proposals/precheck` | V | `CreateProposalRequest` | `PrecheckResponse` (yan etkisiz) |
| POST | `/api/proposals` | V | `CreateProposalRequest` | `ProposalDetail` (alt konu ve düzenleme teklifinde `parentTopicId` eksikse 400 `validation`, `details.parentTopicId`; verilmiş ama konu yoksa 404 `not_found`) |
| GET | `/api/proposals/:id` | — | | `ProposalDetail` (oylama sürerken sonuç yok, yalnız katılım) |
| PATCH | `/api/proposals/:id` | V (yazar) | `UpdateProposalRequest` | `ProposalDetail` (yeni sürüm) |
| POST | `/api/proposals/:id/submit` | V (yazar) | | `ProposalDetail` |
| POST | `/api/proposals/:id/sponsor` | V | | `ProposalDetail` |
| POST | `/api/proposals/:id/withdraw` | V (yazar) | | `ProposalDetail` |
| POST | `/api/proposals/:id/suggestions` | V | `SuggestionRequest` | `Suggestion` |
| POST | `/api/proposals/:id/suggestions/:sid/decide` | V (yazar) | `SuggestionDecisionRequest` | `ProposalDetail` (kabul ve ret yalnız tartışma/uzlaşma evresinde; oylama başlarken karar verilmemiş öneri `lapsed` olur → 409 `suggestion_lapsed`) |
| POST | `/api/proposals/:id/rights-flags` | V | `RightsFlagRequest` | `ProposalDetail` (yalnızca yükseltme; kaldırma E/A) |
| POST | `/api/proposals/:id/vote` | VV (uygun seçmen) | `VoteRequest` | `BallotReceipt` (aynı turda ikinci oy öncekini günceller ve yeni makbuz verir; 409 yoktur) |
| GET | `/api/proposals/:id/receipts` | U | | `BallotReceipt[]` |
| POST | `/api/proposals/:id/objections` | VV | `ObjectionRequest` | `ProposalDetail` |
| POST | `/api/proposals/:id/minority-reports` | VV | `MinorityReportRequest` | `MinorityReport` |
| POST | `/api/proposals/:id/expert-request` | V | `ExpertRequestRequest` | `ProposalDetail` |
| POST | `/api/proposals/:id/expert-questions` | V | `ExpertQuestionRequest` | `ExpertQuestion` |
| GET | `/api/proposals/:id/bulletin` | — | | `BulletinResponse` |
| GET | `/api/proposals/:id/voters` | — | | `VoterListResponse` |
| POST | `/api/proposals/:id/ai/summary` | V | | `AiAnalysisInfo` |
| POST | `/api/proposals/:id/ai/bridging` | V | | `AiAnalysisInfo` |
| POST | `/api/ai/analyses/:id/approve` | V (yazar) | `AiApproveRequest` | `AiAnalysisInfo` |

## Konular ve tartışma

| Yöntem | Yol | Yetki | Gövde | Yanıt |
|---|---|---|---|---|
| GET | `/api/topics` | — | | `TopicSummary[]` (düz liste, `parentId` ile ağaç) |
| GET | `/api/topics/:id` | — | | `TopicDetail` |
| GET | `/api/threads/:type/:id` | — | `type` = `topic` \| `proposal` | `ThreadResponse` |
| POST | `/api/threads/:type/:id` | V | `PostMessageRequest` | `MessageView` (kişisel veri → 422 `pii_detected`, `details.pii`) |
| POST | `/api/messages/precheck` | V | `MessagePrecheckRequest` | `MessagePrecheckResponse` |
| GET | `/api/messages/:id` | — | | `MessageView` |
| PATCH | `/api/messages/:id` | V (yazar) | `EditMessageRequest` | `MessageView` (yeni sürüm) |
| GET | `/api/messages/:id/versions` | — / D | | `MessageVersionView[]` (gizliyse yalnız doğrulanmış D; rolü olan ama etkin olmayan hesap 403 `inactive`) |
| POST | `/api/messages/:id/endorse` | V | `EndorseRequest` | `MessageView` |
| POST | `/api/messages/:id/rebuttal` | V (yazar) | `RebuttalRequest` | `MessageView` |
| GET | `/api/messages/:id/hidden` | D | | `HiddenMessageResponse` (erişim kaydı) |

## Bilirkişi

| Yöntem | Yol | Yetki | Gövde | Yanıt |
|---|---|---|---|---|
| GET | `/api/experts` | — | `?status=&domain=` | `ExpertInfo[]` (`credentials` yalnızca R/D/A ve bilirkişinin kendisine; diğerlerine `null` + `qualificationSummary`; hesabı kapanmış üyelerin kayıtları listelenmez) |
| POST | `/api/experts/apply` | V | `ExpertApplyRequest` | `ExpertInfo` (alanlar yönetmelikteki kategorilerden: değilse 400 `unknown_domain`, `details.domains`) |
| POST | `/api/experts/:userId/decide` | A | `ExpertDecisionRequest` | `ExpertInfo` (onayda alanlar yeniden denetlenir: 400 `unknown_domain`; hesabı kapanmış üye 409 `invalid_state`) |
| POST | `/api/experts/:userId/sanction` | A | `ExpertSanctionRequest` | `ExpertInfo` (hesabı kapanmış üye 409 `invalid_state`) |
| POST | `/api/experts/assignments/:id/respond` | E | `AssignmentRespondRequest` | `ExpertPanelInfo` |
| POST | `/api/experts/assignments/:id/report` | E | `ExpertReportRequest` | `ExpertReportView` (azınlık güvenceli soru yanıtsızsa 400 `minority_question_unanswered`, `details.questionIds`; kırpılmış metin 50 karakterden kısaysa 400 `body_too_short`, bu öneriye ait olmayan ya da yinelenen soru yanıtı 400 `foreign_question` / `duplicate_answer` (üçü de `details`'siz); 20 000 karakteri aşan metin 400 `validation`, `details.body`) |
| POST | `/api/experts/lint` | U | `LintRequest` | `LintResponse` (hukuki nitelendirme denetimi) |

## Graf ve görüş kümeleri

| Yöntem | Yol | Yetki | Gövde | Yanıt |
|---|---|---|---|---|
| GET | `/api/graph` | — | `?types=FOLLOWS,DELEGATES_TO&limit=` | `{nodes: GraphVisNode[], edges: GraphVisEdge[]}` (`types` verilmezse FOLLOWS, VOUCHES, DELEGATES_TO; boş `types=` hiç kenar vermez; yetkisiz görüntüleyenin istediği `RELATED_TO` süzülür, kalan liste boşsa kenar dönmez) |
| GET | `/api/graph/stats` | — | | `GraphStats` |
| GET | `/api/clusters/latest` | — | | `ClusterSnapshotView \| null` |
| GET | `/api/clusters/:id` | — | | `ClusterSnapshotView` |

## Dağıtık defter

| Yöntem | Yol | Yetki | Gövde | Yanıt |
|---|---|---|---|---|
| GET | `/api/ledger/status` | — | | `LedgerStatus` |
| GET | `/api/ledger/validators` | — | | `ValidatorKeys` (istemci ilk kullanımda sabitler) |
| GET | `/api/ledger/blocks` | — | `?from=&limit=` | `BlockListResponse` (yeniden eskiye) |
| GET | `/api/ledger/blocks/:height` | — | `?node=` | `BlockView` |
| GET | `/api/ledger/txs` | — | `LedgerTxListQuery` (`?type=&proposalId=&ballotId=&round=&limit=`, limit en çok 500) | `CommittedTxView[]` (en yeniden eskiye; `ballotId`/`round` yük alanına göre süzer ve yalnız `proposalId` ile birlikte kabul edilir, aksi halde 400 `validation`: "Oyum kayıtlı mı?" son taahhüt denetimi listeyi tek pusulaya daraltır, liste kesilmez) |
| GET | `/api/ledger/txs/:hash` | — | | `CommittedTxView` |
| GET | `/api/ledger/proofs/:hash` | — | | `InclusionProof` |
| GET | `/api/ledger/verify` | — | `?node=` | `ChainVerification[]` |
| POST | `/api/ledger/tamper` | A | `TamperRequest` | `ChainVerification[]` (demo) |
| POST | `/api/ledger/repair` | A | `RepairRequest` | `ChainVerification` |
| POST | `/api/ledger/fault` | A | `FaultRequest` | `LedgerStatus` (demo) |

## Yapay zekâ

| Yöntem | Yol | Yetki | Gövde | Yanıt |
|---|---|---|---|---|
| GET | `/api/ai/status` | — | | `{mode: "claude" \| "offline", model: string}` |

Tüm YZ çıktıları `AiAnalysisInfo.label` ("Yapay zekâ ile üretildi · model · tarih") taşır. YZ hiçbir durumu değiştirmez;
yalnızca danışmandır. Ontoloji denetiminde YZ kaynaklı içerik etiketi (yüksek güvenli olsa bile) ihlal değil uyarıdır
(`content_label_ai_high`) ve bilirkişi incelemesi gerektirir; öneriyi "yönetmeliğe aykırı" yalnızca kural tabanlı tespit ya da
bilirkişi teyidi yapabilir (Madde 12 (2), 14 (1)). `ANTHROPIC_API_KEY` tanımlı değilse çevrimdışı sezgisel mod kullanılır.
