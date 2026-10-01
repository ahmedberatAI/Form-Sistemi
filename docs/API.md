# REST API Sözleşmesi

> Tüm yollar `/api` önekiyle başlar. İstek ve yanıt gövdeleri JSON'dur (Turtle dışa aktarımı hariç).
> Tipler: alan tipleri için `shared/src/types.ts`, istek/yanıt sarmalayıcıları için `shared/src/api.ts`.
> Sunucu uygulaması: `server/src/http/`, istemci: `web/src/api/endpoints.ts`.

## Genel kurallar

- **Kimlik doğrulama:** `Authorization: Bearer <token>`. Belirteç `POST /api/auth/login` ile alınır.
- **Hata biçimi:** `{"error": {"code": "...", "message": "Türkçe açıklama", "details": ...}}`.
  - `400 validation` (zod doğrulaması), `401 unauthorized`, `403 forbidden`, `404 not_found`,
  - `409` (durum çakışması: `invalid_state`, `already_voted`, `version_conflict`, …),
  - `422` (iş kuralı: `pii_detected`, `inadmissible`, `objection_budget`, `not_eligible`, …),
  - `429 rate_limited`, `500 internal`.
- **Zaman:** Tüm zaman damgaları milisaniyedir ve **sunucunun simüle saatine** göredir (`GET /api/system` → `now`).
  İstemci geri sayımları `now` farkıyla düzeltir.
- **CORS kökenleri:** `http://localhost` (Capacitor Android), `capacitor://localhost`, `https://localhost`, `http://localhost:5173`.
- **Hız sınırı:** genel 300 istek/dk/IP; `auth/*` 20 istek/dk (ortam değişkenleri `RATE_LIMIT_GLOBAL`, `RATE_LIMIT_AUTH`;
  `0` → o sınırlayıcı kapalı, yalnız test/uçtan uca ortam için).
- **Kişisel veri:** Hiçbir herkese açık yanıtta ad, soyad, TCKN, adres, doğum tarihi, e-posta, telefon yoktur.
  Yalnızca `R`/`D` rolleri, amaç belirterek ve erişim kaydıyla `PiiRecord` görebilir.

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

Yönetici her rolün yetkisine sahiptir; denetçi `R`'nin okuma uç noktalarını kullanabilir.

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
| POST | `/api/auth/login` | — | `LoginRequest` | `AuthResponse` |
| POST | `/api/auth/logout` | U | | `OkResponse` |
| GET | `/api/me` | U | | `Me` |
| PATCH | `/api/me/consents` | U | `ConsentsRequest` | `Me` |
| POST | `/api/me/password` | U | `ChangePasswordRequest` | `OkResponse` |
| PATCH | `/api/me/nickname` | U | `ChangeNicknameRequest` (yeni takma ad + mevcut şifre) | `Me` (yanlış şifre 400 `wrong_password`; 409 `duplicate_nickname` / `similar_nickname`; 30 günde bir → 422 `nickname_change_limit`, `details.nextAllowedAt`) |
| GET | `/api/me/export` | U | | KVKK döküm JSON (kendi verisi, şifresi çözülmüş) |
| POST | `/api/me/erase` | U | `EraseRequest` (`confirm` = `"SİL"`) | `OkResponse` (kripto-imha; oylamaya konmaz) |
| POST | `/api/me/corrections` | U | `CorrectionRequestInput` | `CorrectionRequestView` (KVKK md. 11/1-d düzeltme talebi; aynı anda tek bekleyen, 409 `correction_pending`) |
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
gerekçesini gönderir; değerler kayıt formuyla aynı kurallarla doğrulanır, yinelenen TCKN/e-posta 409 ile reddedilir. Öneri ve
gerekçe kişinin DEK'iyle şifreli saklanır. Kayıt memuru talebi amaç belirterek inceler, sonra onaylar ya da reddeder. Onayda
yalnız değişen kasa alanları yeni IV ile yeniden şifrelenir, kör indeksler ve (adres/doğum tarihi değiştiyse) il/ilçe ve
reşitlik güncellenir; öneri her kararda imha edilir. Denetim günlüğüne (`identity.correction_*`) yalnız alan adları yazılır.

**Takma ad kuralları:** Tekillik anahtarı NFKC + tr-TR küçük harf + I/ı/İ/i katlamasıdır (`nicknameKey`): `YONETICI`,
`Yonetici` ve `yonetici` aynı hesaptır (409 `duplicate_nickname`); giriş de bu anahtarla yapılır. Ayrıca benzerlik iskeleti
(`nicknameSkeleton`: ş→s, ç→c, ğ→g, ö→o, ü→u, şapkalı harfler, 0→o, 1 ve l→i, `.`/`_`/`-` atılır) kayıtlı bir takma adınkiyle
aynıysa (ör. `Yönetici`, `y0netici`, `yonetici_`) kayıt ve değişiklik 409 `similar_nickname` ile reddedilir. Takma ad
değişikliği (`PATCH /api/me/nickname`) mevcut şifreyle teyit edilir, 30 günde en çok bir kez yapılabilir ve
`identity.nickname_change` olarak günlüğe yazılır (eski/yeni takma ad günlüğe yazılmaz). Takma ad deftere hiç yazılmaz.
`PublicUser.joinedAt` herkese açık yanıtlarda güne (Türkiye saati) yuvarlanır; tam kayıt anı yalnız `Me`'de (sahibine) döner.

## Yönetim

| Yöntem | Yol | Yetki | Gövde | Yanıt |
|---|---|---|---|---|
| POST | `/api/admin/clock/advance` | A | `ClockAdvanceRequest` | `TickResponse` (saat ileri + `lifecycle.tick()`) |
| POST | `/api/admin/tick` | A | | `TickResponse` |
| GET | `/api/admin/users` | A | `?q=` | `AdminUserRow[]` |
| PUT | `/api/admin/users/:id/roles` | A | `SetRolesRequest` | `Me` |
| GET | `/api/admin/audit-log` | A, D | `?action=&actorId=&limit=` | `AuditLogEntry[]` |
| POST | `/api/admin/clusters/recompute` | A | | `ClusterSnapshotView` |

## Kullanıcılar ve graf ilişkileri

| Yöntem | Yol | Yetki | Gövde | Yanıt |
|---|---|---|---|---|
| GET | `/api/users` | — | `?q=&limit=` | `PublicUser[]` |
| GET | `/api/users/:id` | — | | `PublicProfile` |
| POST | `/api/users/:id/follow` | V | | `PublicProfile` |
| DELETE | `/api/users/:id/follow` | V | | `PublicProfile` |
| POST | `/api/users/:id/vouch` | V | `VouchRequest` | `PublicProfile` |
| DELETE | `/api/users/:id/vouch` | U | | `PublicProfile` (kendi kefaletini geri alır; kenar silinmez, `revoked_at`; kefalet yoksa işlem yok) |
| POST | `/api/users/:id/relate` | V | `RelateRequest` | `PublicProfile` (çıkar çatışması beyanı) |
| DELETE | `/api/users/:id/relate` | U | `?kind=family\|business\|household` (yoksa tümü) | `PublicProfile` (yalnız beyan eden geri alır; karşı tarafın beyanı → 403; kenar silinmez) |

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
| POST | `/api/proposals` | V | `CreateProposalRequest` | `ProposalDetail` |
| GET | `/api/proposals/:id` | — | | `ProposalDetail` (oylama sürerken sonuç yok, yalnız katılım) |
| PATCH | `/api/proposals/:id` | V (yazar) | `UpdateProposalRequest` | `ProposalDetail` (yeni sürüm) |
| POST | `/api/proposals/:id/submit` | V (yazar) | | `ProposalDetail` |
| POST | `/api/proposals/:id/sponsor` | V | | `ProposalDetail` |
| POST | `/api/proposals/:id/withdraw` | V (yazar) | | `ProposalDetail` |
| POST | `/api/proposals/:id/suggestions` | V | `SuggestionRequest` | `Suggestion` |
| POST | `/api/proposals/:id/suggestions/:sid/decide` | V (yazar) | `SuggestionDecisionRequest` | `ProposalDetail` (kabul ve ret yalnız tartışma/uzlaşma evresinde; oylama başlarken karar verilmemiş öneri `lapsed` olur → 409 `suggestion_lapsed`) |
| POST | `/api/proposals/:id/rights-flags` | V | `RightsFlagRequest` | `ProposalDetail` (yalnızca yükseltme; kaldırma E/A) |
| POST | `/api/proposals/:id/vote` | VV (uygun seçmen) | `VoteRequest` | `BallotReceipt` |
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
| GET | `/api/messages/:id/versions` | — / D | | `MessageVersionView[]` (gizliyse yalnız D) |
| POST | `/api/messages/:id/endorse` | V | `EndorseRequest` | `MessageView` |
| POST | `/api/messages/:id/rebuttal` | V (yazar) | `RebuttalRequest` | `MessageView` |
| GET | `/api/messages/:id/hidden` | D | | `HiddenMessageResponse` (erişim kaydı) |

## Bilirkişi

| Yöntem | Yol | Yetki | Gövde | Yanıt |
|---|---|---|---|---|
| GET | `/api/experts` | — | `?status=&domain=` | `ExpertInfo[]` (`credentials` yalnızca R/D/A ve bilirkişinin kendisine; diğerlerine `null` + `qualificationSummary`) |
| POST | `/api/experts/apply` | V | `ExpertApplyRequest` | `ExpertInfo` |
| POST | `/api/experts/:userId/decide` | A | `ExpertDecisionRequest` | `ExpertInfo` |
| POST | `/api/experts/:userId/sanction` | A | `ExpertSanctionRequest` | `ExpertInfo` |
| POST | `/api/experts/assignments/:id/respond` | E | `AssignmentRespondRequest` | `ExpertPanelInfo` |
| POST | `/api/experts/assignments/:id/report` | E | `ExpertReportRequest` | `ExpertReportView` (azınlık güvenceli soru yanıtsızsa 400 `minority_question_unanswered`, `details.questionIds`) |
| POST | `/api/experts/lint` | U | `LintRequest` | `LintResponse` (hukuki nitelendirme denetimi) |

## Graf ve görüş kümeleri

| Yöntem | Yol | Yetki | Gövde | Yanıt |
|---|---|---|---|---|
| GET | `/api/graph` | — | `?types=FOLLOWS,DELEGATES_TO&limit=` | `{nodes: GraphVisNode[], edges: GraphVisEdge[]}` |
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
| GET | `/api/ledger/txs` | — | `LedgerTxListQuery` | `CommittedTxView[]` |
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
