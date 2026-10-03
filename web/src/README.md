# Web istemcisi — altyapı kılavuzu

Aynı React kodu web sitesi ve Capacitor ile Android uygulaması olarak çalışır. Bu belge, sayfa yazan herkesin
dayanacağı altyapıyı (API istemcisi, oturum, kancalar, arayüz bileşenleri, CSS sınıfları) özetler.

Kontrol: `cd web && npx tsc -p tsconfig.json && npx vite build` (hatasız olmalı).

## Dizin yapısı

```
src/
  main.tsx                 applySavedTheme() → <DetailLevelProvider><ErrorBoundary><ToastProvider><AuthProvider><App/>…
  App.tsx                  HashRouter + rotalar (sayfalar React.lazy ile yüklenir)
  styles.css               tüm stiller (CSS değişkenleri, açık/koyu tema, sınıf kılavuzu dosya başında)
  api/client.ts            fetch sarmalayıcı, ApiError, sunucu adresi, belirteç, qs()
  api/endpoints.ts         docs/API.md'deki HER uç nokta için tipli fonksiyon
  auth/AuthContext.tsx     AuthProvider, useAuth(), useServerNow(), Permission
  auth/guards.tsx          RequireAuth, RequireRole
  ui/                      yeniden kullanılabilir bileşenler (hepsi `../ui`'dan içe aktarılır)
  lib/                     format, prefs, receipts, validators, diff, useAsync, categories, hooks, routes, download, detailLevel, sectionParam,
                           nextStep, glossary (sözlük), taskStore (görev sayısı), notificationKinds (bildirim sınıfları)
  components/              RegistrationForm, CategoryPicker, UserLink, KvkkNotice, PlaceholderPage, layout/, system/theme.ts,
                           common/ (NextStepCard), home/ (Ana sayfa parçaları), participation/ (öneri sayfası kartları ve panelleri), proposals/
  pages/                   rota başına bir sayfa (varsayılan dışa aktarım)
```

## Değişmez kurallar

- Tüm metinler **Türkçe**. Kod tanımlayıcıları İngilizce.
- Herkese açık görünümlerde **kişisel veri yok** (ad, TCKN, adres, e-posta, telefon…). Kullanıcıyı her zaman `<UserLink>` ile (takma ad) gösterin.
- `dangerouslySetInnerHTML` **YASAK**. Kullanıcı metni düz metin olarak çizilir (`white-space: pre-wrap` için `.prose` ya da kendi sınıfınız).
- Geri sayım / göreli zaman için **sunucu saati**: `useAuth().now()` (ya da `<Countdown>`, `<Time>`, `useNow()`); `Date.now()` ile süre hesaplamayın.
- Her YZ çıktısı `<AiLabel>` içinde gösterilir (`data-ai-generated="true"`, "Yapay zekâ ile üretildi · model · tarih").
- 360 px genişlikte yatay kaydırma olmamalı: tablolar `<Table>` (kaydırılabilir kapsayıcı), uzun hash'ler `<HashText>`.
- Erişilebilirlik: her form alanı etiketli (`Input`/`Select`/… bunu otomatik yapar), düğmelerde metin, durumlar renk + metinle.

## Sayfa şablonu

```tsx
import { useParams } from "react-router-dom";
import { getProposal, sponsorProposal } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { useAction, useAsync } from "../lib/useAsync";
import { Button, Card, Countdown, ErrorView, PageHeader, Spinner, StatusBadge } from "../ui";

export default function ProposalDetailPage() {
  const { id = "" } = useParams();
  const auth = useAuth();
  const { data: p, error, loading, reload, setData } = useAsync(() => getProposal(id), [id]);
  const sponsor = useAction(() => sponsorProposal(id), { success: "Desteğiniz kaydedildi.", onSuccess: setData });

  if (loading && !p) return <Spinner block />;
  if (error) return <ErrorView error={error} onRetry={reload} />;
  if (!p) return null;
  return (
    <div className="page">
      <PageHeader title={p.title} meta={<StatusBadge status={p.status} />} back={{ to: "/oneriler", label: "Öneriler" }} />
      <Card title="Destek" actions={<Countdown to={p.phaseEndsAt} prefix="Kalan süre" />}>
        <Button variant="primary" loading={sponsor.loading} disabled={!auth.can("V")} onClick={() => sponsor.run()}>
          Destekle
        </Button>
      </Card>
    </div>
  );
}
```

## API istemcisi (`api/client.ts`)

| Dışa aktarım | Açıklama |
|---|---|
| `class ApiError { status, code, message, details, isNetwork }` | Tüm hatalar bu sınıftır. `status === 0` → ağ hatası (`code: "network" \| "timeout"`). Sunucu 400 `validation` hatasında `details` = `{ "alan.yolu": "Türkçe ileti" }`. |
| `isApiError(e)`, `errorMessage(e)` | Herhangi bir hatadan Türkçe metin. |
| `request<T>(path, opts)`, `http.get/post/put/patch/del/text` | Düşük düzey; sayfalar **endpoints** kullanmalı. |
| `qs(obj)` | Sorgu dizesi: `undefined/null/""/false` atlanır, `true → "1"`, diziler virgülle. |
| `getServerUrl()`, `setServerUrl(url \| null)`, `getSavedServerUrl()`, `defaultServerUrl()`, `NATIVE_DEFAULT_SERVER` | Sunucu adresi (web: `""` aynı köken; Android: `http://10.0.2.2:4000`). |
| `pingServer(url?)` | `/api/health` sınaması → `{ ok, ms, message }` (fırlatmaz). |
| `setAuthToken`, `getAuthToken`, `onUnauthorized(fn)` | AuthContext kullanır; belirteçli istek 401 alınca oturum temizlenir. |

## Uç noktalar (`api/endpoints.ts`)

Hepsi `Promise` döner, tipler `@forum/shared`'dan. (docs/API.md ile birebir; 104 uç nokta.)

- **Sistem:** `getHealth()`, `getSystem()`, `getDashboard()`
- **Kimlik/hesap:** `register(input)`, `login({login, password})`, `logout()`, `getMe()`, `updateConsents({aiConsent?, politicalConsent?})`,
  `changePassword({oldPassword, newPassword})`, `changeNickname({nickname, password})`, `exportMyData()`, `eraseMe({confirm: "SİL", password})`,
  `getMyDelegations()`, `delegate({to, scope, rank})`, `revokeDelegation(id)`, `getFollowing()`,
  `getNotifications({unread?})`, `markNotificationsRead(ids?)` (boş → tümü), `getMyTasks()`, `getMyAssignments()`
- **Kayıt memuru:** `getPendingUsers()`, `getUserPii(userId, purpose)`, `verifyUser(userId, {decision, note?})`, `registrarCreateUser(input)`
- **Yönetim:** `advanceClock(hours)`, `runTick()`, `adminListUsers(q?)`, `setUserRoles(userId, roles)`, `getAuditLog({action?, actorId?, limit?})`, `recomputeClusters()`
  — saat ileri alındıktan sonra `useAuth().refreshSystem()` çağırın.
- **Kullanıcılar:** `listUsers({q?, limit?})`, `getUser(id)`, `followUser(id)`, `unfollowUser(id)`, `vouchUser(id, level)`, `relateUser(id, kind)`
- **Ontoloji:** `getOntology()`, `getOntologyVersions()`, `getTurtle(version?)` (metin), `validatePatch(patch)`
- **Öneriler:** `listProposals(query?)`, `precheckProposal(req)`, `createProposal(req)`, `getProposal(id)`, `updateProposal(id, {title, body, acknowledgePii?})`,
  `submitProposal(id)`, `sponsorProposal(id)`, `withdrawProposal(id)`, `addSuggestion(id, body)`, `decideSuggestion(id, sid, "accept"|"reject")`,
  `flagRight(id, {right, direction, remove?})`, `vote(id, choice)`, `getReceipts(id)`, `submitObjection(id, {ground, statement})`,
  `addMinorityReport(id, body)`, `requestExperts(id, "panel"|"counter")`, `askExpertQuestion(id, body)`, `getBulletin(id)`, `getVoters(id)`,
  `requestAiSummary(id)`, `requestAiBridging(id)`, `approveAiAnalysis(analysisId, {draftIndex?})`
- **Konular/tartışma:** `listTopics()`, `getTopic(id)`, `getThread(type, id)`, `postMessage(type, id, {body, stance, parentId?, acknowledgePii?})`,
  `precheckMessage(body)`, `getMessage(id)`, `editMessage(id, {body, acknowledgePii?})`, `getMessageVersions(id)`, `endorseMessage(id, -1|0|1)`,
  `postRebuttal(id, body)`, `getHiddenMessage(id)`
  — kişisel veri tespitinde 422 `pii_detected` (`details.pii`); kullanıcı onaylarsa `acknowledgePii: true` ile yeniden gönderin.
- **Bilirkişi:** `listExperts({status?, domain?})`, `applyExpert({domains, credentials})`, `decideExpert(userId, req)`, `sanctionExpert(userId, req)`,
  `respondAssignment(assignmentId, {decision, reason?})`, `submitExpertReport(assignmentId, req)`, `lintExpertText(text)`
- **Graf:** `getGraph({types?: EdgeType[], limit?})` → `GraphResponse {nodes, edges}`, `getGraphStats()`, `getLatestClusters()`, `getClusterSnapshot(id)`
- **Defter:** `getLedgerStatus()`, `getValidators()`, `listBlocks({from?, limit?})`, `getBlock(height, node?)`, `listTxs({type?, proposalId?, limit?})`,
  `getTx(hash)`, `getProof(hash)`, `verifyChain(node?)`, `tamperBlock({nodeId, height})`, `repairNode({nodeId})`, `setNodeFault({nodeId, fault})`
- **YZ:** `getAiStatus()`

## Oturum (`auth/AuthContext.tsx`)

```ts
const auth = useAuth();
auth.user            // Me | null
auth.token           // string | null
auth.loading         // ilk yükleme
auth.system          // SystemInfo | null (30 sn'de bir yenilenir)
auth.unread          // okunmamış bildirim sayısı (60 sn'de bir)
auth.connectionError // açılışta sunucuya ulaşılamadıysa ApiError
auth.sessionExpired  // 401 ile oturum düştüyse true
await auth.login({ login, password });  await auth.register(input);  await auth.logout();
await auth.refresh();         // /api/me yeniden (Me | null)
await auth.refreshSystem();   // saat ileri alındıktan sonra
await auth.refreshUnread();   // bildirim okununca
await auth.refreshTasks({ maxAgeMs? }); // bekleyen işler (GET /api/me/tasks → lib/taskStore); veri maxAgeMs'den tazeyse istek atmaz
auth.setUser(me);             // PATCH /api/me/consents yanıtıyla güncelle
auth.now()                    // sunucu (simüle) saatine göre "şimdi" (ms)
auth.can("U"|"V"|"VV"|"R"|"D"|"A"|"E")  // docs/API.md yetki kısaltmaları; A, R ve D'yi kapsar
auth.hasRole("registrar"); auth.isVerified; auth.isVoter; auth.isExpert; auth.isAdmin
```

`useServerNow()` → sağlayıcı dışında da çalışan `now` fonksiyonu.

**Rota korumaları** (`auth/guards.tsx`): `<RequireAuth perm?="V">…</RequireAuth>` (oturum yoksa `/giris`'e yönlendirir, dönüş adresi
`location.state.from`), `<RequireRole roles={["registrar","auditor"]}>` (yönetici her zaman geçer).
`/kayit-memuru` → registrar/auditor/admin; `/yonetim` → admin/auditor (denetçi yalnızca denetim günlüğünü görmeli: sayfada `can("A")` ile ayırın);
`/profil`, `/bildirimler`, `/oneriler/yeni` → oturum gerekir (yeni öneri sayfası `can("V")`'yi kendisi denetlemeli).

## Kancalar

| Kanca | Kullanım |
|---|---|
| `useAsync(fn, deps, {enabled?, pollMs?})` (`lib/useAsync`) | `{ data, error, loading, reload, setData }`. Eski isteklerin geç yanıtları yok sayılır. `setData(yeni)` ya da `setData(prev => …)`. |
| `useAction(fn, {success?, onSuccess?, toastError?})` (`lib/useAsync`) | Düğme eylemleri: `{ run(...args), loading, error, reset }`. `run` fırlatmaz; hata toast olarak gösterilir, `undefined` döner. |
| `useToast()` (`ui`) | `toast.success(m)`, `toast.info(m)`, `toast.warning(m)`, `toast.error(errOrMsg, title?)`, `toast.show(m, {tone, title, durationMs})` |
| `useConfirm()` (`ui`) | `if (await confirm({ title, message?, confirmLabel?, cancelLabel?, tone?: "danger", requireText?: "SİL" })) …` |
| `useOntology()` (`lib/categories`) | `{ ontology, loading, error, reload, categories (ağaç kökleri), flat: FlatCategory[], categoryLabel(iri), categoryPath(iri), rightLabel(iri), groundLabel(iri), articleLabel(iri), contentLabel(iri) }` — uygulama boyunca önbellekli; yönetmelik değişince `invalidateOntology()`. Sunucu yoksa etiketler `shared/vocab.ts`'ten. |
| `useNow(ms=1000)` (`lib/hooks`) | Sunucu saatine göre "şimdi"; her `ms`'de yeniden çizdirir. |
| `useDebounced(value, ms)` | Canlı ön denetim / arama için. |
| `useQueryState(key, default)` | URL sorgu parametresine bağlı durum (ör. sekme): `const [tab, setTab] = useQueryState("sekme", "acik")`. Aynı olayda birden çok anahtar güncellenebilir; güncellemeler birbirini ezmez. |
| `useInterval(fn, delay \| null)` | |
| `useDocumentTitle(title)` (`ui`) | `PageHeader` zaten ayarlar. |

## lib yardımcıları

- **format.ts:** `formatDateTime(ms, short?)` "1 Ekim 2026 14:05", `formatDate`, `formatTime`, `formatIsoDate("2000-05-01")`,
  `formatRelative(ms, now)` "3 dakika önce", `formatDuration(ms)` "2 sa 13 dk", `formatHours(h)`, `formatPercent(0.615)` "%61,5",
  `formatNumber(n, digits?)`, `formatRational({num,den})` "2/3 (%66,7)", `shortHash(h, n)`, `proposalRef(seq)` "#K-12", `topicRef(seq)` "#T-7",
  `truncate(s, max)`, `normalizeSearch(s)` (Türkçe duyarsız arama).
- **prefs.ts:** `getPref/setPref/removePref(key)`, `getJsonPref/setJsonPref`, `isNativePlatform()`, `platformName()`, `PREF_KEYS`. Gizlenen notlar (`PREF_KEYS.dismissed` = `forum.dismissed`, Ana sayfa 'Notu gizle'): `getDismissedSync()` (ilk çizim), `getDismissed()` (kalıcı depo + ayna), `addDismissed(keys)` (tekrarsız, en çok 50); hiçbiri fırlatmaz.
- **detailLevel.tsx:** Görünüm yoğunluğu `"sade"` (varsayılan) | `"tam"` (`PREF_KEYS.detail` = `forum.detail`; Ayarlar › Görünüm). `useDetailLevel()` → `{ level, full, setLevel }`.
  Yalnız açılır bölümlerin VARSAYILAN açıklığını değiştirir, içerik gizlemez: `resolveDefaultOpen(explicit, level, openInFull?)`. theme.ts gibi ilk çizimde eşzamanlı, sonra Android Preferences'tan okur.
- **sectionParam.ts:** `useSectionParam(ready)` — `?bolum=<çapa>` varsa veri yüklendikten sonra o kartı/açılırı açar, kaydırır, odağı taşır ve parametreyi `replace` ile siler (`?mesaj=` gibi diğer parametreler kalır). Bağlantı: `routes.proposal(id, { bolum })`.
- **nextStep.ts:** `proposalNextStep(p, viewerOf(auth))` → `{ tone, headline, detail?, cta?, links (≤ 2) }`: öneri sayfasının 'Sıradaki adım' kartının içeriği (SAF, birim testli). Karar mantığı sunucuda kalır: yalnız sunucu bayraklarını (`canVote`, `canObject`, `canWriteMinorityReport`, `myBallot`) ve `ProposalDetail` alanlarını okur, uygunluk tahmin etmez. Bağlantılar `?bolum=` çapasıdır (`nextStepHref`); etiketlerde 'Destekle', 'Oyumu ver', 'Daha fazla', 'Sayımı kendim doğrulayayım', 'Kapat' geçmez (e2e sözleşmesi).
- **native.ts:** `setupNativeBackButton()` (main.tsx çağırır). Android geri tuşu sırasıyla açık pencereyi/alt sayfayı kapatır, açık menüyü kapatır, uygulama içinde geri gider; geçmiş yoksa uygulamadan çıkar (`@capacitor/app`).
- **receipts.ts:** `saveReceipt(receipt, {proposalTitle?, proposalSeq?})` — `vote()` yanıtını **her zaman** kaydedin;
  `listReceipts(proposalId?)` (en yeni önce, oturumdaki kullanıcının), `latestReceipt(proposalId, round?)`, `isLatest(r, list)`,
  `exportReceipts()`, `importReceipts(json)`, `clearReceipts()`. Oy değiştirilince yeni makbuz eklenir; geçerli olan en sonuncusudur.
- **validators.ts (TOFU):** `ensurePinnedValidators()` → `{ status: "pinned_now"|"match"|"changed", pinned, fresh, diff }` —
  doğrulamada **her zaman** `pinned.validators` kullanın: `verifyInclusionProof(proof, pinned.validators)`. `status === "changed"` ise
  `describeValidatorDiff(diff)` metniyle uyarı gösterin. Ayrıca `getPinnedValidators()`, `pinValidators(keys)`, `resetPinnedValidators(all?)`, `listPinnedValidators()`, `compareValidators()`.
- **diff.ts:** `diffLines(a,b)`, `diffWords(a,b)` → `{type: "same"|"add"|"del", text}[]`; `diffText(a,b)` → satır + satır içi kelime farkı (`DiffLine.words`); `diffStats()`. Görsel: `<DiffView>`.
- **glossary.ts:** sözlük (yaklaşık 34 terim, 6 konu): `GLOSSARY`, `GLOSSARY_GROUPS`, `findTerm(id)`, `getTerm(id)`, `glossaryByGroup()`, `searchGlossary(q)` (Türkçe duyarsız; terim, sembol, günlük karşılık ve tanımda arar),
  `termAnchor(id)` (`terim-<kimlik>`), `termForTier(tier)`, `termForDecisionCheck(key)`. Her girdi: terim (ekranda AYNEN yazıldığı gibi), `plain` (günlük karşılık), `definition`, varsa `symbol` ve `bylawLink` (yönetmelikte yeri).
  Tanımlar parametre DEĞERİ içermez (yönetmelik değişince bayatlamasın). 'özet' sözcüğü hash anlamında yeniden adlandırılmaz: günlük karşılığı 'parmak izi' yalnız sözlükte ve ipucunda geçer.
- **taskStore.ts:** oturumdaki üyenin bekleyen işleri (`useSyncExternalStore` deposu). `AuthProvider` açılışta, girişte, 60 sn'de bir ve sekmeye dönünce doldurur (`auth.refreshTasks`); `AppLayout` sayfa değişince 10 sn'den bayatsa yeniler;
  Ana sayfa her pano yüklemesinde depoyu panonun `tasks` listesiyle eşitler (ikisi aynı sunucu kuralı: liste ile rozet çelişmez); öneri sayfası görüntüleyenin kendi eyleminden (oy, destek, itiraz, rapor …) sonra, Profil rıza değişince yeniler
  (süren bir isteğe denk gelen zorunlu yenileme o istek bitince bir kez daha sorar); oturum değişince/kapanınca boşalır. Okuyucular: `useTaskCount()` ('Ana sayfa' rozeti), `useProposalExpectations(id)` (öneri kartında 'Sizden bekleniyor'). Saf: `countBadgeText(n)` (0 → rozet yok, 99+), `taskCountText(n)` ('n iş sizi bekliyor'),
  `taskProposalId(task)` (bağlantıdan öneri kimliği; sunucu değişmedi), `proposalExpectations(tasks, id)`.
- **notificationKinds.ts:** sunucudaki tüm bildirim türlerinin açık eşlemesi → 8 sınıf (oylama, öneri, tartışma, bilirkişi, vekâlet, hesap, yönetim görevi, varsayılan); her sınıf bir simge, ekran okuyucu etiketi ve ton alır
  (`classifyKind` tanınmayan türü varsayılana düşürür). Ayrıca `groupByAge` (Bugün / Bu hafta / Daha eski), `defaultFilter`, `filterNotifications`, `markReadLocally`, `readButtonLabel` ('Okundu işaretle: <başlık>'), `focusCandidates`.
- **routes.ts:** `routes.kesfet({bolum?})` (`/kesfet?bolum=rehber|bilesenler|ilkeler|sozluk|terim-<kimlik>`), `routes.proposal(id, {bolum?})`, `routes.topic(id)`, `routes.user(id)`, `routes.block(h)`, `routes.tx(hash)`, `routes.newProposal({kind, parentTopicId, messageId})` (sorgu: `tur`, `konu`, `mesaj`), `routes.verifyVote({proposalId})` (`?oneri=`)…;
  `toAppPath(link)` sunucu bağlantısını (`/oneriler/x`, `/profile`, `/ledger/txs/h`, `#/…`) uygulama yoluna çevirir.
- **download.ts:** `downloadText(name, text, mime?)`, `downloadJson(name, data)`, `canDownloadFiles()`. Android uygulamasında
  (Capacitor WebView) dosya indirilemez: indirme denenmez ve `false` döner. "İndir" düğmesini `canDownloadFiles()` ile gizleyin,
  her zaman `CopyButton` sunun ve `false` dönünce "indirildi" demeyin.
- **components/system/theme.ts:** `applySavedTheme()`, `setTheme("light"|"dark"|"system")`, `getTheme()`, `THEME_LABELS`.

## Arayüz bileşenleri (`import { … } from "../ui"`)

| Bileşen | Prop'lar |
|---|---|
| `Button` | `variant?: "primary"\|"secondary"\|"danger"\|"ghost"` (vars. secondary), `size?: "sm"\|"md"`, `loading?`, `block?`, `icon?: IconName` + tüm `<button>` prop'ları (`type` vars. "button") |
| `LinkButton` | `to` + `variant`, `size`, `block`, `icon` (react-router `Link`) |
| `Card` | `title?`, `subtitle?`, `actions?`, `footer?`, `tone?: "default"\|"muted"\|"action"\|"warning"\|"danger"\|"success"\|"accent"` (`action` = ince mavi kenar, kullanıcıdan eylem bekleyen panel; `accent` YALNIZ YZ), `headingLevel?: 2\|3\|4`, `id?`. Katlanabilir: `collapsible?` (başlık `aria-expanded` düğmesi olur; `title` düz metin), `defaultOpen?` (verilmezse sade kipte kapalı, tam kipte açık), `openInFull?`, `summary?` (başlığın dışında tek satır hüküm, kapalıyken görünür), `summaryTone?`, `anchor?` (`?bolum=` çapası). Gövde DOM'da kalır (`hidden`). e2e'nin içine baktığı kartlar katlanmaz. |
| `Badge` | `tone?: "neutral"\|"info"\|"success"\|"warning"\|"danger"\|"accent"`, `icon?`, `title?` |
| `StatusBadge` `{status}` · `TierBadge` `{tier, short?, neutral?, explain?}` (`neutral`: T3'ü de griye çevirir; `explain`: rozet katmanın sözlük penceresini açan düğme olur) · `KindBadge` `{kind}` · `VoteBadge` `{choice}` · `StanceBadge` `{stance}` · `OutcomeBadge` `{outcome}` · `RoleBadge` `{role}` · `UserStatusBadge` `{status}` · `ExpertStatusBadge` `{status}` | Etiketler `@forum/shared/labels`'tan. Ayrıca `statusTone(status)`, `OPEN_STATUSES`, `CLOSED_STATUSES`. |
| `Tabs` | `tabs: {id, label, count?, disabled?}[]`, `value`, `onChange`, `label` (erişilebilir ad), `children` = etkin sekmenin içeriği (ok tuşlarıyla gezinme) |
| `Input` / `Textarea` / `Select` | `label` (zorunlu), `hint?`, `error?`, `hideLabel?` + yerel prop'lar. `Textarea`: `showCount?` (+`maxLength`). `Select`: `options: {value,label,disabled?}[]`, `placeholder?` |
| `Checkbox` | `label`, `hint?`, `error?`, `checked`, `onChange` |
| `RadioGroup<V>` | `label`, `value`, `onChange(v)`, `options: {value, label, hint?, disabled?}[]`, `layout?: "stack"\|"inline"\|"cards"` (oy paneli için `cards`) |
| `Field` | Kendi kontrolünüz için etiket/ipucu/hata sarmalayıcısı: `label`, `htmlFor`, `hint?`, `error?`, `required?` |
| `Alert` | `tone?: "info"\|"success"\|"warning"\|"error"`, `title?`, `actions?`, `onClose?` |
| `Spinner` | `label?`, `block?` (ortalanmış), `showLabel?`, `size?` |
| `EmptyState` | `title`, `children?`, `action?`, `icon?` |
| `ErrorView` | `error` (ApiError dahil), `title?`, `onRetry?`, `compact?` — ağ hatasında "Sunucu ayarları", oturum gerekince "Giriş yap" bağlantısı |
| `Modal` | `open`, `onClose`, `title`, `footer?`, `size?: "sm"\|"md"\|"lg"`, `sheet?` (mobilde alttan), `dismissible?`, `closeOnBackdrop?` — yerel `<dialog>` (odak tuzağı, Esc) |
| `ConfirmDialog` | `open`, `title`, `message?`, `children?`, `confirmLabel?`, `tone?: "danger"`, `requireText?: "SİL"`, `confirmDisabled?`, `onConfirm` (Promise beklenir; hata pencerede gösterilir), `onClose` |
| `Countdown` | `to` (ms, sunucu saati), `prefix?`, `doneText?` ("süre doldu"), `onDone?`, `warnBelowMs?`, `plain?` → "2 sa 13 dk" |
| `Time` | `at`, `mode?: "relative"\|"absolute"\|"both"` |
| `AiLabel` | `info?: AiAnalysisInfo` ya da `label?`/`model?`/`at?`/`offline?`; `children` verilirse çerçeveli blok + "danışma niteliğindedir" notu (`hideNote?`) |
| `HashText` | `hash`, `chars?` (10), `copy?` (true), `to?` (bağlantı), `full?`, `label?`, `digest?` (true: ipucu 'Özet (parmak izi): …'; imza, açık anahtar ve rastgele kimlik gibi özet OLMAYAN değerde `false` → ipucu yalnız değer), `explain?` (yanına 'Özet nedir?' sözlük düğmesi; bağlantı/düğme/`<summary>` içinde kullanılmaz) |
| `Term` | `id: TermId` (derleme zamanında denetlenir), `children?` (yoksa sözlükteki terim), `className?` — satır içi `<button aria-haspopup="dialog">`; dokununca günlük karşılık, tanım, sembol, 'Yönetmelikte ›' ve 'Sözlükte ›' bir `Modal sheet` içinde açılır (Esc kapatır, odak terime döner). Masaüstünde `title` ipucu da vardır. YALNIZ düz metin akışına konur: başlık (h1–h4, Card başlığı), form etiketi, düğme, bağlantı, `<summary>` ve Uzlaşma/İtiraz panelleri içine KONMAZ. `TermBody` pencerenin içeriğidir (Keşfet sözlüğü de kullanır). Bağlantı kipi `TermLinksProvider mode="page"\|"newTab"\|"none"` (`ui/Term`): yalnız bellekte tutulan bir formun yanında (`NewProposalPage`, açık vekâlet formu) `formTermLinkMode(isNativePlatform())` verilir; pencere bağlantıları ve ön denetimin madde atfı (`TermLink`) web'de yeni sekmede açılır ('(yeni sekmede açılır)' notuyla), yerel uygulamada çizilmez (dayanak madde düz metin kalır) — form kaybolmaz. |
| `CopyButton` | `text`, `label?`, `iconOnly?`, `size?` · ayrıca `copyToClipboard(text)` |
| `ProgressBar` | `value`, `max?` (1), `label` (zorunlu), `valueText?`, `tone?`, `marker?` + `markerLabel?` (eşik çizgisi: taban, yeter sayı) |
| `KeyValue` | `items: ({label, value, hint?} \| null \| false)[]`, `compact?` |
| `Table<T>` | `columns: {key, header, render?(row,i), align?, hideOnMobile?}[]`, `rows`, `rowKey`, `caption` (zorunlu), `showCaption?`, `empty?`, `rowClassName?` |
| `Stat`, `StatGrid` | `label`, `value`, `hint?`, `tone?`, `to?` |
| `PageHeader` | `title`, `subtitle?`, `actions?`, `meta?` (rozet satırı), `back?: {to?, label?}`, `docTitle?` |
| `Section` | `title`, `description?`, `actions?`, `headingLevel?` |
| `Details` | `summary`, `children`, `open?` (yerel `<details>`; verilmezse sade kipte kapalı, tam kipte açık), `meta?` (özetin sağında gri sayı/hüküm), `id?` (`?bolum=` çapası), `openInFull?` |
| `ClampText` | `text`, `lines?` (10), `wideLines?` (16, ≥900 px), `openInFull?` — uzun düz metni kırpar; düğme yalnız taşmada çıkar ("Tamamını göster (N kelime)" / "Kısalt"), metin DOM'da tam kalır |
| `DiffView` | `before`, `after`, `mode?: "lines"\|"inline"`, `context?` (değişmeyen satırları daralt), `label?` |
| `DropdownMenu` | `label`, `ariaLabel?`, `items: ({label, to?, onClick?, icon?, danger?, badge?} \| "divider" \| null)[]`, `align?` |
| `Icon` | `name: IconName` (home, topics, proposals, verify, experts, graph, ledger, book, bell, user, users, registrar, admin, settings, more, menu, logout, login, plus, close, chevronDown, chevronRight, back, copy, check, search, info, warning, success, error, clock, ai, external, vote, refresh), `size?` |
| `cx(...)` | Sınıf adı birleştirici |

**Ortak bileşenler (`components/`):**
- `RegistrationForm` — `onSubmit(input): Promise<void>` (fırlatırsa hata alanlara eşlenir), `mode?: "self"\|"registrar"`, `submitLabel?`, `resetOnSuccess?`, `initial?`. Kayıt memuru sayfası: `<RegistrationForm mode="registrar" resetOnSuccess onSubmit={async (i) => { await registrarCreateUser(i); toast.success(…); }} />`.
- `CategoryPicker` — `value: string[]`, `onChange`, `label?`, `hint?`, `error?`, `max?`, `disabled?`, `required?`, `suggestions?: {iri, label?, confidence?}[]` (precheck sınıflandırmasından), `collapsible?` (isteğe bağlı seçimde kapalı açılır; özet satırında seçili sayısı).
- `UserLink` — `id` + `nickname` (+ `status?`, `isExpert?`) ya da `user`; silinmiş üye düz metin.
- `KvkkNotice` — aydınlatma metni (Profil sayfasında da gösterin).
- `PlaceholderPage` — `title`, `description?`.

## Öneri sayfası ve Ana sayfa (Faz 2)

**Öneri sayfası** (`pages/ProposalDetailPage.tsx`) sekmesiz tek akıştır; DOM sırası okuma sırasıdır: başlık (`.proposal-head`: `#K-n`, durum, tür; T0 dışı katman, uzatma ve bütünlük uyarısı koşullu; kategorilerin ilk 3'ü ve '+n') → evre şeridi
(`PhaseStrip`; 600 px altında kompakt) → **Sıradaki adım** (`components/common/NextStepCard`: tek cümle, kalan süre, birincil eylem BAĞLANTISI, ≤ 2 soru bağlantısı; kartta `<button>` yoktur) → **Bu sayfada**
(`participation/OnThisPage`: yalnız var olan bölümler, `?bolum=` + `replace`) → ana akış → **Kanıtlar ve denetim** (`participation/EvidenceColumn`: `aside#kanitlar`, 'Tümünü aç/katla').
Ana akış: Öneri metni (`#metin`, `ClampText`) → eylem alanı (`#eylem`: evrenin paneli, 'eylem önce') → Sonuçlar (`#sonuclar`, içinde `#dogrula`) → pasif itiraz/uzlaşma → Bilirkişi (`#bilirkisi`) →
(terminalde) Metin önerileri → YZ özeti (`#yz`) → Tartışma (`#tartisma`, hep bağlı, Details içine alınmaz). Kanıt kartları: `#butunluk` (varsa en üstte, açık), `#destekciler` (hep açık), `#evreler`, `#ontoloji`
(aykırılık/ihlalde Destekçiler'in önüne çıkar, açık), `#parametreler`, `#surumler`, `#defter`. `?bolum=<çapa>` kartı açar, kaydırır, odağı taşır (`?bolum=eylem`: oylamada ilk radyo, itirazda 'Gerekçe', tartışma evresinde
yazarın bekleyen önerisinin 'Kabul et' düğmesi) ve parametreyi siler; `?mesaj=` ayrıdır ve korunur. Saf mantık (`proposalPageSections`, `hasActionArea`, `showsExpertCard`, `actionFocusSelector`, `evidenceOrder`,
`allSectionsOpen`) bileşen dosyalarında dışa aktarılır ve `participation/proposalPage.test.tsx` ile sınanır. Stiller: `proposal-page.css` (iskelet), `panels.css` (eylem panelleri), `results.css` (sonuç kartı),
`expert-ai.css` (bilirkişi ve YZ özeti), `discussion.css` (tartışma). Kapalı kart başlığının yanındaki tek satır hüküm başlığın DIŞINDADIR (`Card summary`), bölge adı değişmez.

**Eylem panelleri 'eylem önce'dir:** oy formu bilgi kutularının, 'Destekle' formülün, itiraz formu değerlendirme tablosunun üstündedir; açıklayıcı paragraflar adlandırılmış `Details` içindedir
('Kaç destekçi gerekir?', 'Geçerlilik nasıl hesaplanır?', 'Makbuz ayrıntıları (pusula, taahhüt, defter işlemi)', 'Gizli oy ve vekâlet nasıl işler?', 'Neyi denetler?', 'Köprü taslak setleri (n)' …).
e2e'nin içine baktığı bölümler (Oylama, Yeniden oylama, 1. tur sonucu, Sayımı kendim doğrulayayım, Azınlık itirazı, Uzlaşma turu, Azınlık raporları, Köprü taslakları, Destekçiler (n/m)) asla kapalı başlamaz.
Tartışmada yazma kutusu doğrulanmış üyede KAPALI başlar ('Görüşünüzü yazın…', `aria-expanded=false`; dokununca formla yer değiştirir ve odak metin alanına geçer, bu yüzden `aria-controls` yoktur); 'Tam' görünümde açıktır. Mesaj alt satırı tek sessiz satırdır ('özet … · defter … ›').

**Ana sayfa** (`pages/HomePage.tsx` yalnız veriyi bağlar; düzen `components/home/HomeLayout.tsx`, birim testli): üyede 'Merhaba, @ad' + canlı özet, 'Sizi bekleyenler (n)' (`TaskList`, ilk 3, 'Tümünü göster (n)'; bağlantılar `?bolum=eylem`,
bilirkişi görevi `?bolum=bilirkisi`), görev yoksa role göre ipucu (`RoleHint`), oy hakkı notu (`SetupNotes`, 'Notu gizle' → `forum.dismissed`), hızlı eylemler (`QuickActions`), 'Şu an açık (n)' ve 'Son kararlar'
(`ProposalRow` / `ProposalRowList`, `proposals/ProposalCard.tsx`); yan sütunda Topluluk durumu ve vitrin (≥ 900 px'de `.split`: yan sütunda önce vitrin, sonra Topluluk durumu; hızlı eylemler selamın sağına DOM'da taşınır). Ziyaretçide başlık + slogan + Giriş/Kayıt,
'Neden kayıt gerekir?' açılırı, ardından vitrin → açık → son kararlar → topluluk durumu → ilkeler. Yeni 'Ana sayfa' düğme/bağlantı adlarında 'Daha fazla' ve 'Kapat' geçmez.

**Testler:** `e2e/tests/06-sadelik.spec.ts` bu sözleşmeleri kilitler (ilk ekranda sıradaki adım, 'Bu sayfada' kısa yolları, `?bolum=`, kapalı kartların hükümleri, 'Tam' görünüm, kapalı yazma kutusu, uyarının kendiliğinden açılması)
ve ekran boyu/kelime/tıklanabilir öğe sayılarını annotation olarak kaydeder; `e2e/support/sade.ts` ortak yardımcılardır. `01-tarama` 'Bu sayfada' bağlantılarına tıklar (sade ve 'Tam' görünümde).

## Sade dil, ikincil sayfalar ve Keşfet (Faz 3)

**Terim korunur, günlük karşılık yanına eklenir.** Yönetmelik terimleri (köprü testi, ontoloji denetimi, dağıtık defter, 'özet') başlıklarda ve etiketlerde aynen kalır; günlük karşılık `<Term>` penceresinde ve ParamsCard'ın sade satırlarında verilir.
Karar parametreleri (`participation/ParamsCard`, ön denetimde `DecisionParamsView`) sade adla başlar ('Onay eşiği: %60'); Yunan sembolleri ve formüller 'Sembolleri ve formülleri göster' anahtarının (`role="switch"`) arkasındadır, 'Tam' görünümde açık gelir.

**Keşfet ve doğrula (`/kesfet`, `pages/KesfetPage.tsx`, saf model `pages/kesfet.ts`).** React.lazy ile yüklenir; gezinme öğesi DEĞİLDİR (`NavItem.topNav: false`; üst gezinme 8 öğe kalır). Üç yerden gidilir: Ana sayfa vitrini ('Gösterim rehberi ›', `?bolum=rehber`),
masaüstü alt bilgisi ('Gösterim rehberi ve sözlük ›') ve mobil 'Daha fazla' sayfasında 'Keşfet ve doğrula' grubunun sonu. Bölümler (hepsi `?bolum=` çapalı, odak bölüm başlığındadır): **bilesenler** (yedi bileşen, canlı durumuyla; veri `auth.system` + `getDashboard` + bu cihazdaki makbuz sayısı;
uyarı yalnız gerekince, mor yalnız YZ satırında) · **rehber** (7 adımlı gösterim rehberi; adımlar son karar `Dashboard.recentEnacted[0]`, listedeki ilk aykırı öneri ve sabit rotalardan kurulur, sabit öneri numarası yoktur; veri yoksa adım genel sayfaya düşer ve bunu bir notla söyler;
yöneticide defter adımına ek 'Kurcalama demosu' bağlantısı) · **ilkeler** (8 temel ilkenin tam metni) · **sozluk** (arama + konu bölümleri; 'Sade'de kapalı, 'Tam'da açık, aramada eşleşenler açık; `?bolum=terim-<kimlik>` terimi açar ve adına odaklanır).

**Görev sayısı.** 'Ana sayfa' bağlantısında (üst ve alt gezinme) mavi `.count-badge` bekleyen iş sayısını yazar; rozet `aria-hidden`, bağlantı adı 'Ana sayfa' kalır, sayı `aria-describedby` ile ('n iş sizi bekliyor') okunur. Öneri kartında 'Sizden bekleniyor: Oy · Bilirkişi görevi' düz metin satırıdır (rozet değil).

**Bildirimler (`pages/NotificationsPage.tsx`).** Okunmamış varsa 'Okunmamış' açılır; liste Bugün / Bu hafta / Daha eski `h2` başlıklarıyla bölünür (başlıklar sekme DEĞİLDİR: ilk `main` tablist 'Bildirim filtresi' kalır); satırın tamamı tek bağlantıdır ('Git: …', tıklayınca okundu işaretler);
satır başına tek düğme 'Okundu işaretle: <başlık>' (okundu işaretlenince odak sıradaki satırın düğmesine geçer). Her satırda tür simgesi + ekran okuyucu metni vardır.

**Yeni öneri (`pages/NewProposalPage.tsx`).** Tür seçilince `KindPicker` 5 kartı tek satırlık radyo hapına daraltır (radyolar DOM'da ve işaretli kalır, açıklamalar 'Türler ne demek?' açılırında). `PrecheckPanel` 'önce hüküm': uygunluk hükmü → Katman ve 'Gerekli destekçi' satırları → açılırlar
('Bulgular (n)': ihlal/uyarı varsa açık; 'Karar parametreleri'; 'YZ önerileri': yalnız hiç kategori seçilmemişken ve öneri varken açık; 'Benzer öneriler (n)': benzerlik ≥ %50 ise açık); 'Tam' görünümde hepsi açık. Alt konu ve düzenlemede 'Ek kategoriler (isteğe bağlı)' kapalı başlar.
Silme talebinde kurallar canlı sayaçlı tek satırdır (`role="status"`; `role="alert"` yalnız acil gerekçe uyarısında), dört kural 'Silme kuralları (4)' açılırında (sınıra 1 kala ya da sınırda kendiliğinden açık).

**Konular.** Sayaçlar tek satır hap (`TopicCounters`); telefonda Kategori ve Arşiv 'Süz' açılırında (`topicsLogic.ts`). Konu ayrıntısında telefon sırası: metin → Açık öneriler → Tartışma → Alt konular → 'Sürüm geçmişi (n)' (katlı);
masaüstünde yan sütun korunur. Açık öneri satırları (`ProposalRowList showKind showAuthor`) türü ve '@yazar'ı düz metinle yazar (rozet değil; `proposalRowDetails`); açık öneri yokken alt başlık yeni öneri düğmelerine yönlendirir.
Çapalar: `?bolum=konu-metni|acik-oneriler|tartisma|alt-konular|surumler`.

**Profil ve Ayarlar (`system/accountLogic.ts`).** Profil en üstte 'Oy hakkınız: Var/Yok' kartıyla açılır (eksik koşullar yazılır, üyenin elindeki TEK eylem 'Siyasi görüş rızası ver'); Hesap özeti, Açık rızalar ve Vekâletler açık; Bilirkişilik, Takma ad, Şifre, KVKK ve Kimlik düzeltme katlı kartlardır
(başlık görünür, yanında tek satır hüküm). Ayarlar sırası: Görünüm → Sunucu bağlantısı → Bu cihazdaki oy makbuzları → Gelişmiş (Doğrulayıcı anahtarları, Uygulama hakkında; katlı). Çapalar: `?bolum=kvkk|duzeltme|rizalar|…` ve `?bolum=anahtarlar|hakkinda`.

**Test-güvenli adlandırma (Faz 3 eklemeleri).** Yeni düğme, bağlantı, bölge ve etiket adları 'Destekle', 'Oyumu ver', 'Daha fazla', 'Sayımı kendim doğrulayayım', 'Kapat', 'Gerekçe', 'Açıklama', 'Azınlık raporu', 'Düğüm' parçalarını İÇERMEZ
(`e2e/support/sade.ts › reservedParts`; Term düğmeleri 06-sadelik'te taranır). Silme kurallarının canlı satırı `role="status"`'tur. Yeni bölge adları 'Oylama', 'Uzlaşma turu', 'Azınlık raporları', 'Destekçiler (', '1. tur sonucu', 'Azınlık itirazı' içermez.

**Testler.** Saf mantık birim testlidir (`glossary`, `taskStore`, `notificationKinds`, `kesfet`, `topicsLogic`, `accountLogic`, `newProposal`, `visualLanguage`, `Term`; bileşen düzeyinde rozet bütçesi `components/badgeBudget.test.tsx` — `ui` katmanı bileşen içe aktaramaz). e2e: `06-sadelik.spec.ts` Faz 3 bölümü — Term penceresi (Esc, odak dönüşü, 'Yönetmelikte ›' / 'Sözlükte ›'), sembol anahtarı,
Keşfet'in yedi bileşeni ve yedi adımının her bağlantısı, erişim yolları, sözlük, görev rozeti ile Ana sayfa görev sayısının tutarlılığı (Ana sayfaya dönünce eşitlenmesi dahil), bildirim grupları ve satır bağlantısı, yeni öneri ön denetimi (hüküm önce; sözlük penceresinin formu terk ettirmemesi, 'YZ önerileri'nin ilk 'Ekle'de kapanmaması), Profil/Ayarlar/Konular düzeni ve yeni sayfaların kontrastı; `01-tarama.spec.ts` yeni sayfaları ve durumları (Term penceresi açık, 'Süz' açık, çapalar) 360 px'de tarar.

## CSS sınıfları (`styles.css`)

- **Sayfa:** her sayfanın kökü `<div className="page">` (dikey boşluklu). Dar içerik: `page page-narrow` (≤ 720 px).
- **Düzen:** `.stack` / `.stack-sm` / `.stack-lg` (dikey), `.row` / `.row-between` / `.row-end` (yatay, sarmalı), `.grid-2`, `.grid-3`, `.grid-auto` (duyarlı ızgara),
  `.split` (masaüstünde 2/3 + 1/3; mobilde tek sütun), `.mt`, `.mb`.
- **Metin:** `.muted`, `.small`, `.mono`, `.nowrap`, `.truncate`, `.prose` (okunaklı uzun metin), `.h3`, `.lead`, `.ta-right` …
- **Erişim:** `.sr-only`, `.hide-mobile` (< 600 px gizli), `.show-mobile`.
- **Listeler:** `ul.list > li.list-item` (kenarlıklı satırlar; bağlantı satırı için `a.list-item` ya da `.list-item-link`),
  `ol.timeline > li.timeline-item` (+ `.is-current`, `.is-done`) zaman çizelgesi, `ul.tree` (iç içe `ul`) konu ağacı, `ol.steps`.
- **Bileşen sınıfları** (bileşenler kendi sınıflarını verir; elle de kullanılabilir): `.card`, `.btn .btn-primary …`, `.badge .badge-success …`,
  `.chip`, `.alert .alert-warning …`, `.empty`, `.table-wrap .table`, `.kv`, `.stat`, `.tabs`, `.input`, `.form-section` (`<fieldset>` + `<legend>`),
  `.form-grid` (mobilde 1, ≥ 640 px'de 2 sütun), `.form-actions`, `.consent-box`, `.ai-block`, `.hash`, `.diff`, `.countdown`.
- **Renk değişkenleri** (özel bileşenler için): `--bg --surface --surface-2 --surface-3 --border --border-strong --text --text-muted --primary --primary-soft
  --success(-soft) --warning(-soft) --danger(-soft) --info(-soft) --accent(-soft) --radius --radius-sm --shadow`. Koyu tema bu değişkenleri değiştirir;
  sabit renk kullanmayın.

## Görsel dil (Faz 3)

**Renk rolleri.** Renk anlam taşır ve her zaman metinle (çoğu kez simgeyle de) gelir; renk tek başına bilgi değildir.

| Renk | Belirteç / ton | Ne için | Örnek |
|---|---|---|---|
| Mavi | `--primary` (= `--info`), `tone="info"`, Card `tone="action"`, ProgressBar `primary` | eylem ve 'şu an' | birincil düğme, bağlantı, etkin sekme, güncel evre, destek/tartışma/oylama durumu, 'Sıradaki adım', okunmamış ve görev sayısı (`.count-badge`) |
| Yeşil / kırmızı | `--success` / `--danger` | sonuç (kırmızı ayrıca hata ve geri alınamaz eylem) | Kabul edildi, Reddedildi, Yönetmeliğe aykırı, ✔/✘ hükümleri, oy seçimi, lehte/karşı |
| Turuncu | `--warning` | dikkat ve süre | itiraz ve uzlaşma evresi, azalan süre, askı uyarısı, sınıra yaklaşma |
| Mor | `--accent`, `tone="accent"` | **YALNIZ yapay zekâ** | `AiLabel`, `.ai-*`, YZ alıntı düğmeleri (`.cite-link`), vitrinin YZ karosu |
| Gri | `neutral`, `--text-muted`, `--border-strong` | geri kalan her şey | tür, katman (T3 dışı), rol, sürüm, panel türü, sayılar, köprü skoru, tamamlanan evreler |

- **Tek mavi:** `--info` ve `--info-soft` üç tema bloğunda da `var(--primary)` / `var(--primary-soft)`'tur; ayrı bir gök mavisi yoktur.
- **Rozet bütçesi:** nesne (kart, liste satırı, başlık) başına en çok **1 renkli durum rozeti**. `StatusBadge` eşlemesi: destek, tartışma,
  oylama, yeniden oylama → mavi · itiraz penceresi, uzlaşma → turuncu · kabul → yeşil · red, aykırı → kırmızı · taslak, geri çekilen, süresi
  dolan → gri. `KindBadge` ve `RoleBadge` her zaman gri; `TierBadge` yalnız T3'te kırmızı (`tierTone(tier)`, `ui/badges`). Aynı nesnede renkli
  bir durum rozeti zaten varsa `<TierBadge neutral />` (ör. Ontoloji denetiminde 'Yönetmeliğe uygun/aykırı' yanında). Yeni rozet eklerken
  önce `tone="neutral"` düşünün; renk yalnız o nesnenin tek durumunu söylüyorsa kullanılır. İtiraz hükmünde tek renkli rozet geçerlilik hükmüdür (kural ve
  'Güçlü itiraz' gri); defter işlem türü rozeti gridir (`system/marks › txTypeTone`; yalnız hatalı doğrulayıcı kanıtı `EVIDENCE` kırmızı); 'genişletir' hak
  etkisi ve 'Bilgi' bulgusu her ekranda gridir.
- **Kart tonları:** `action` ince mavi kenar (kullanıcıdan eylem bekleyen panel: Oylama, Sayımı kendim doğrulayayım) · `warning` / `danger` /
  `success` kalın sol kenar (uyarı ve sonuç) · `muted` gri zemin · `accent` yalnız YZ içeriği. Kart başına renkli öğe hedefi 1'dir: evre şeridi
  ve zaman çizelgesinde tamamlanan evreler gri ✔, renk yalnız güncel evrede (mavi) ve sonuçtadır (yeşil/kırmızı).
- **Uyarı yalnız gerektiğinde bağırır:** turuncu ve kırmızı, olağan durumda görünmez; büyük harf etiket kullanılmaz (vurgu kalınlıkla verilir).

**Boşluk ve yazı belirteçleri** (`:root`; renk olmadıkları için koyu tema bloklarında yoktur): `--sp-1` 0.25rem · `--sp-2` 0.5rem ·
`--sp-3` 0.75rem · `--sp-4` 1rem · `--sp-5` 1.5rem · `--sp-6` 2rem · `--fs-xs` 0.75rem (rozet) · `--fs-sm` 0.875rem (`.small`, meta ve hüküm
satırları) · `--fs-md` 1rem (gövde) · `--fs-lg` 1.15rem (bölüm başlığı) · `--fs-xl` 1.45rem (telefonda sayfa başlığı) · `--measure` 70ch
(`.prose`). Yeni kuralda sabit rem yerine bu belirteçleri kullanın.

**Yeni renk eklerken:** değeri üç blokta da tanımlayın (`:root`, `:root[data-theme="dark"]`, `@media (prefers-color-scheme: dark)` içindeki
blok) ve kullanıldığı her metin/zemin çiftinde WCAG AA'yı (normal metin 4,5:1, metin dışı öğe 3:1) sağlayın. `ui/visualLanguage.test.tsx`
belirteç çiftlerini üç blokta e2e taramasıyla (`e2e/support/sade.ts › scanContrast`) aynı formülle denetler; rozet tonlarını da kilitler.

## Yerleşim ve rotalar

`components/layout/AppLayout.tsx`: üst çubuk (logo, bildirim zili + sayı, kullanıcı menüsü), ≥ 900 px'de üst gezinme, mobilde alt gezinme
(Ana sayfa, Konular, Öneriler, Oy doğrula, Daha fazla) ve "Daha fazla" alt sayfası. Gezinme öğeleri: `components/layout/nav.ts`.
Bekleyen hesap, oturum süresi dolması ve bağlantı hatası şeritleri otomatik gösterilir (bekleyen/askıdaki/reddedilmiş hesap şeridi `/` rotasında gizlidir: Ana sayfa bunu kendi kartında söyler).
Gezinme öğesi `topNav: false` ise (Keşfet ve doğrula sayfası) masaüstü üst gezinmede yoktur; 'Daha fazla' sayfasında 'Keşfet ve doğrula' grubunun sonunda ve alt bilgide bağlantısı vardır. 'Ana sayfa' bağlantısında görev sayısı rozeti (`lib/taskStore`).
Masaüstü üst gezinmede 'Katılım' ile 'Keşfet ve doğrula' grupları arasında görsel ayraç (`span.nav-divider`, aria-hidden) vardır; öğe ve etiketler aynıdır. 'Daha fazla' sayfasının
en altındaki 'Sistem durumu' bloğu (`SystemStatus`, veri `auth.system`; satırların biçimi `nav.ts › systemRows`) masaüstü alt bilgisinin mobildeki karşılığıdır: her sayfadan 1 dokunuşla defter,
YZ kipi, simüle saat, yönetmelik ve istemci sürümü. Sabit başlık yüksekliği `--sticky-h` (= `--header-h` + masaüstünde gezinme satırı `--nav-h`); `?bolum=` hedefleri
`scroll-margin-top: calc(var(--sticky-h) + 12px)` ile bunun altında kalmaz (yeni kaydırma hedefi eklerken aynı kuralı kullanın).

| Yol | Sayfa | Koruma |
|---|---|---|
| `/` | HomePage | — |
| `/giris`, `/kayit` | LoginPage, RegisterPage | — |
| `/konular`, `/konular/:id` | TopicsPage, TopicDetailPage | — |
| `/oneriler`, `/oneriler/yeni`, `/oneriler/:id` | ProposalsPage, NewProposalPage, ProposalDetailPage | yeni: oturum |
| `/oy-dogrula` | VerifyVotePage | — |
| `/bilirkisiler` | ExpertsPage | — |
| `/profil` | ProfilePage | oturum |
| `/uyeler/:id` | UserPage | — |
| `/kayit-memuru` | RegistrarPage | registrar / auditor / admin |
| `/yonetim` | AdminPage | admin / auditor |
| `/bildirimler` | NotificationsPage | oturum |
| `/ayarlar` | SettingsPage | — |
| `/graf` | GraphPage | — |
| `/defter`, `/defter/blok/:height`, `/defter/islem/:hash` | LedgerPage, BlockPage, TxPage | — |
| `/yonetmelik` | OntologyPage | — |
| `/kesfet` | KesfetPage (Keşfet ve doğrula; gezinme öğesi değil) | — |

Sunucu bildirim bağlantıları Türkçe web yollarıdır (`/oneriler/<id>`, `/konular/<id>`); `toAppPath()` İngilizce olanları da çevirir.
