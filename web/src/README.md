# Web istemcisi — altyapı kılavuzu

Aynı React kodu web sitesi ve Capacitor ile Android uygulaması olarak çalışır. Bu belge, sayfa yazan herkesin
dayanacağı altyapıyı (API istemcisi, oturum, kancalar, arayüz bileşenleri, CSS sınıfları) özetler.

Kontrol: `cd web && npx tsc -p tsconfig.json && npx vite build` (hatasız olmalı).

## Dizin yapısı

```
src/
  main.tsx                 applySavedTheme() → <ToastProvider><AuthProvider><App/></AuthProvider></ToastProvider>
  App.tsx                  HashRouter + rotalar (sayfalar React.lazy ile yüklenir)
  styles.css               tüm stiller (CSS değişkenleri, açık/koyu tema, sınıf kılavuzu dosya başında)
  api/client.ts            fetch sarmalayıcı, ApiError, sunucu adresi, belirteç, qs()
  api/endpoints.ts         docs/API.md'deki HER uç nokta için tipli fonksiyon
  auth/AuthContext.tsx     AuthProvider, useAuth(), useServerNow(), Permission
  auth/guards.tsx          RequireAuth, RequireRole
  ui/                      yeniden kullanılabilir bileşenler (hepsi `../ui`'dan içe aktarılır)
  lib/                     format, prefs, receipts, validators, diff, useAsync, categories, hooks, routes, download
  components/              RegistrationForm, CategoryPicker, UserLink, KvkkNotice, PlaceholderPage, layout/, system/theme.ts
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
- **prefs.ts:** `getPref/setPref/removePref(key)`, `getJsonPref/setJsonPref`, `isNativePlatform()`, `platformName()`, `PREF_KEYS`.
- **native.ts:** `setupNativeBackButton()` (main.tsx çağırır). Android geri tuşu sırasıyla açık pencereyi/alt sayfayı kapatır, açık menüyü kapatır, uygulama içinde geri gider; geçmiş yoksa uygulamadan çıkar (`@capacitor/app`).
- **receipts.ts:** `saveReceipt(receipt, {proposalTitle?, proposalSeq?})` — `vote()` yanıtını **her zaman** kaydedin;
  `listReceipts(proposalId?)` (en yeni önce, oturumdaki kullanıcının), `latestReceipt(proposalId, round?)`, `isLatest(r, list)`,
  `exportReceipts()`, `importReceipts(json)`, `clearReceipts()`. Oy değiştirilince yeni makbuz eklenir; geçerli olan en sonuncusudur.
- **validators.ts (TOFU):** `ensurePinnedValidators()` → `{ status: "pinned_now"|"match"|"changed", pinned, fresh, diff }` —
  doğrulamada **her zaman** `pinned.validators` kullanın: `verifyInclusionProof(proof, pinned.validators)`. `status === "changed"` ise
  `describeValidatorDiff(diff)` metniyle uyarı gösterin. Ayrıca `getPinnedValidators()`, `pinValidators(keys)`, `resetPinnedValidators(all?)`, `listPinnedValidators()`, `compareValidators()`.
- **diff.ts:** `diffLines(a,b)`, `diffWords(a,b)` → `{type: "same"|"add"|"del", text}[]`; `diffText(a,b)` → satır + satır içi kelime farkı (`DiffLine.words`); `diffStats()`. Görsel: `<DiffView>`.
- **routes.ts:** `routes.proposal(id)`, `routes.topic(id)`, `routes.user(id)`, `routes.block(h)`, `routes.tx(hash)`, `routes.newProposal({kind, parentTopicId, messageId})` (sorgu: `tur`, `konu`, `mesaj`), `routes.verifyVote({proposalId})` (`?oneri=`)…;
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
| `Card` | `title?`, `subtitle?`, `actions?`, `footer?`, `tone?: "default"\|"muted"\|"warning"\|"danger"\|"success"\|"accent"`, `headingLevel?: 2\|3\|4`, `id?` |
| `Badge` | `tone?: "neutral"\|"info"\|"success"\|"warning"\|"danger"\|"accent"`, `icon?`, `title?` |
| `StatusBadge` `{status}` · `TierBadge` `{tier, short?}` · `KindBadge` `{kind}` · `VoteBadge` `{choice}` · `StanceBadge` `{stance}` · `OutcomeBadge` `{outcome}` · `RoleBadge` `{role}` · `UserStatusBadge` `{status}` · `ExpertStatusBadge` `{status}` | Etiketler `@forum/shared/labels`'tan. Ayrıca `statusTone(status)`, `OPEN_STATUSES`, `CLOSED_STATUSES`. |
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
| `HashText` | `hash`, `chars?` (10), `copy?` (true), `to?` (bağlantı), `full?`, `label?` |
| `CopyButton` | `text`, `label?`, `iconOnly?`, `size?` · ayrıca `copyToClipboard(text)` |
| `ProgressBar` | `value`, `max?` (1), `label` (zorunlu), `valueText?`, `tone?`, `marker?` + `markerLabel?` (eşik çizgisi: taban, yeter sayı) |
| `KeyValue` | `items: ({label, value, hint?} \| null \| false)[]`, `compact?` |
| `Table<T>` | `columns: {key, header, render?(row,i), align?, hideOnMobile?}[]`, `rows`, `rowKey`, `caption` (zorunlu), `showCaption?`, `empty?`, `rowClassName?` |
| `Stat`, `StatGrid` | `label`, `value`, `hint?`, `tone?`, `to?` |
| `PageHeader` | `title`, `subtitle?`, `actions?`, `meta?` (rozet satırı), `back?: {to?, label?}`, `docTitle?` |
| `Section` | `title`, `description?`, `actions?`, `headingLevel?` |
| `Details` | `summary`, `children`, `open?` (yerel `<details>`) |
| `DiffView` | `before`, `after`, `mode?: "lines"\|"inline"`, `context?` (değişmeyen satırları daralt), `label?` |
| `DropdownMenu` | `label`, `ariaLabel?`, `items: ({label, to?, onClick?, icon?, danger?, badge?} \| "divider" \| null)[]`, `align?` |
| `Icon` | `name: IconName` (home, topics, proposals, verify, experts, graph, ledger, book, bell, user, users, registrar, admin, settings, more, menu, logout, login, plus, close, chevronDown, chevronRight, back, copy, check, search, info, warning, success, error, clock, ai, external, vote, refresh), `size?` |
| `cx(...)` | Sınıf adı birleştirici |

**Ortak bileşenler (`components/`):**
- `RegistrationForm` — `onSubmit(input): Promise<void>` (fırlatırsa hata alanlara eşlenir), `mode?: "self"\|"registrar"`, `submitLabel?`, `resetOnSuccess?`, `initial?`. Kayıt memuru sayfası: `<RegistrationForm mode="registrar" resetOnSuccess onSubmit={async (i) => { await registrarCreateUser(i); toast.success(…); }} />`.
- `CategoryPicker` — `value: string[]`, `onChange`, `label?`, `hint?`, `error?`, `max?`, `disabled?`, `required?`, `suggestions?: {iri, label?, confidence?}[]` (precheck sınıflandırmasından).
- `UserLink` — `id` + `nickname` (+ `status?`, `isExpert?`) ya da `user`; silinmiş üye düz metin.
- `KvkkNotice` — aydınlatma metni (Profil sayfasında da gösterin).
- `PlaceholderPage` — `title`, `description?`.

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

## Yerleşim ve rotalar

`components/layout/AppLayout.tsx`: üst çubuk (logo, bildirim zili + sayı, kullanıcı menüsü), ≥ 900 px'de üst gezinme, mobilde alt gezinme
(Ana sayfa, Konular, Öneriler, Oy doğrula, Daha fazla) ve "Daha fazla" alt sayfası. Gezinme öğeleri: `components/layout/nav.ts`.
Bekleyen hesap, oturum süresi dolması ve bağlantı hatası şeritleri otomatik gösterilir.

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

Sunucu bildirim bağlantıları Türkçe web yollarıdır (`/oneriler/<id>`, `/konular/<id>`); `toAppPath()` İngilizce olanları da çevirir.
