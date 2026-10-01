# Kişisel Verilerin Korunması (KVKK) — Forum Sistemi

> Bu belge, 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) açısından Forum Sistemi'nin hangi kişisel veriyi,
> hangi amaçla, hangi hukuki sebeple ve hangi teknik tedbirlerle işlediğini anlatır. Uygulama: `server/src/identity/`
> (testler: `server/test/identity/`). Araştırma dayanakları: [ARASTIRMA.md](ARASTIRMA.md) §5.4, §9.4, §9.5.
>
> **Uyarı:** Bu belge hukuki görüş değildir. Sistem gerçek kullanıma alınmadan önce veri sorumlusunun hukuk birimi ya da
> bir KVKK uzmanı tarafından gözden geçirilmelidir (VERBİS kaydı, veri sorumlusunun unvanı, başvuru kanalları vb.).

## 1. Temel ilkeler

1. **Kimlik ile katılım ayrıdır.** Forumdaki her iş (öneri, mesaj, oy, vekâlet, graf) yalnızca rastgele üye kimliği
   (`users.id`, UUID) ve takma ad ile yürür. Gerçek kimlik ayrı ve şifreli bir **kimlik kasasında** (`identity_vault`) durur.
2. **Veri minimizasyonu (md. 4/2-ç).** Şifresiz tutulan tek konum bilgisi kaba bölgedir (il/ilçe). Mahalle ve açık adres
   yalnızca kasada şifreli durur.
3. **Aydınlatma ≠ rıza.** Aydınlatma metninin okunduğu (`kvkkNoticeAccepted`) ile açık rızalar (`politicalConsent`,
   `aiConsent`) ayrı alanlardır. Aydınlatma, hizmetin önkoşuludur; açık rızalar değildir.
4. **Defterde kişisel veri yoktur.** Dağıtık deftere ad, TCKN, adres, doğum tarihi, e-posta, telefon, takma ad, üye
   kimliği ve kullanıcı↔oy bağı yazılmaz; yalnızca anahtarlı özetler (HMAC), taahhütler ve sayılar yazılır.
5. **Kendi verisini silmek oylanmaz.** Silme talebi bir KVKK hakkıdır; çoğunluk oyuna bağlanamaz. **Kripto-imha** ile
   anında yerine getirilir.

## 2. Veri envanteri

| # | Veri kategorisi | Alanlar | Amaç | Hukuki sebep | Saklama süresi | Nerede / nasıl |
|---|---|---|---|---|---|---|
| 1 | Kimlik | Ad, soyad, T.C. kimlik no, doğum tarihi | Kimlik doğrulama; "bir kişi – bir hesap – bir oy"; reşitlik denetimi | md. 5/2-c (üyelik sözleşmesinin kurulması ve ifası); veri sorumlusu dernekse üye kayıt yükümlülüğü için md. 5/2-ç | Üyelik süresince; silme talebinde, başvuru reddinde ya da 180 gün doğrulanmayan başvuruda derhâl kripto-imha | `identity_vault.enc_*` — alan bazında AES-256-GCM. TCKN ayrıca `tckn_bidx` kör indeksi (HMAC) olarak |
| 2 | İletişim | E-posta, telefon | Giriş (e-posta ile), hesap güvenliği bildirimleri | md. 5/2-c | Kimlik verisiyle aynı | Kasa (şifreli). E-posta ayrıca `email_bidx` kör indeksi. Telefon `+90…` biçimine normalleştirilir |
| 3 | Adres | İl, ilçe, mahalle, açık adres, posta kodu | Kimlik doğrulama; bilirkişi kurasında hane/çıkar çatışması tespiti | md. 5/2-c, md. 5/2-f (karar sürecinin tarafsızlığında meşru menfaat) | Kimlik verisiyle aynı | Kasa (şifreli). `household_bidx` = normalize adresin HMAC'i (adresin kendisi değil) |
| 4 | Kaba bölge | İl, ilçe | Bölgesel katılım istatistikleri | md. 5/2-f | Üyelik süresince; silmede NULL | `users.region_il`, `users.region_ilce` (şifresiz — minimizasyon gereği yalnız il/ilçe) |
| 5 | Hesap | Takma ad, roller, durum, kayıt/doğrulama zamanı, itibar | Forumun işletilmesi | md. 5/2-c | Kalıcı (takma adlı); silmede takma ad "Silinmiş üye #…" olur | `users` |
| 6 | Kimlik doğrulama sırrı | Şifre özeti | Giriş | md. 5/2-c | Hesap süresince; silmede geçersiz kılınır | `users.password_hash` — scrypt (N=16384, r=8, p=1, 16 bayt tuz) |
| 7 | Oturum | Oturum kimliği, açılış/bitiş/iptal zamanı | Hesap güvenliği | md. 5/2-c, md. 5/2-f | 180 gün (simüle saat) | `sessions`; belirtecin imzası veritabanında yoktur |
| 8 | Rıza kayıtları | Aydınlatma okuma zamanı, siyasi görüş rızası, YZ rızası, değişiklik geçmişi | Rızanın ispatı | md. 5/2-ç (ispat yükü) | Hesap süresince; geçmiş denetim günlüğünde | `users.kvkk_notice_at`, `users.political_consent`, `users.ai_consent`, `audit_log` (`identity.consents`) |
| 9 | **Siyasi görüş (özel nitelikli, md. 6)** | Oylar, öneriler, mesajlar, itirazlar, vekâletler, görüş kümesi | Katılımcı karar alma | **Oy için açık rıza (md. 6/3-a).** Herkese açık mesajlar için ayrıca md. 6/3-ç (alenileştirme iradesine uygunluk) ve veri sorumlusu siyasi amaçlı bir dernekse md. 6/3-g tartışılabilir | Tartışma kaydı ilkesi gereği kalıcı (takma adlı); bkz. §6 | `ballots`, `messages`, `proposals`… — yalnızca üye kimliğiyle. Defterde yalnızca `ballotId = HMAC(voteKey, …)` ve taahhüt |
| 10 | YZ analizine giden içerik | Mesaj/öneri metni (maskelenmiş) | Danışma niteliğinde özet, sınıflandırma | **Ayrı açık rıza**, varsayılan kapalı; yurt dışına aktarım md. 9 | Sağlayıcının saklama koşulları; yerelde yalnız girdi/çıktı özeti | `ai_analyses` (özetler); sağlayıcıya giden metinde takma ad yerine K1, K2… |
| 11 | Erişim günlükleri | Kişisel veriye kim, ne zaman, hangi amaçla eriştiği; giriş denemeleri | Hesap verebilirlik, ihlal tespiti (md. 12) | md. 5/2-ç, md. 5/2-f | En az 3 yıl (silme kayıtları dahil) | `pii_access_log`, `audit_log` (meta alanında kişisel veri yok) |
| 12 | Bildirimler | Uygulama içi bildirim metinleri | Üyeyi bilgilendirme | md. 5/2-c | Hesap süresince | `notifications` |
| 13 | Defter kayıtları | `memberRef` (HMAC), zaman, özetler | Değiştirilemez denetim izi | Kişisel veri içermez; `memberRef` anahtar olmadan kimliğe bağlanamaz | Kalıcı | Dağıtık defter (`MEMBER_REGISTERED {memberRef, at}`, `MEMBER_VERIFIED {memberRef}`, `MEMBER_ERASED {memberRef}`) |
| 14 | Düzeltme talepleri | Düzeltilecek alan adları, önerilen değerler, gerekçe, durum, karar notu | KVKK md. 11/1-d düzeltme hakkının yerine getirilmesi | md. 5/2-ç (hukuki yükümlülük) | Öneri karar/geri çekme anında imha; gerekçe ve kayıt hesap süresince, silmede NULL | `identity_corrections` — öneri ve gerekçe kişinin DEK'iyle şifreli; alan adları ve durum şifresiz (değer yok) |

**Veri aktarımı (md. 8–9):** Kimlik verileri hiçbir üçüncü kişiye aktarılmaz. Yalnızca YZ rızası veren üyelerin içerik
metni, kişisel verisi maskelenmiş ve takma adları K1, K2… ile değiştirilmiş olarak YZ sağlayıcısına (Anthropic, Claude API —
yurt dışı) gönderilir. Yeterlilik kararı ya da Kurum'a bildirilmiş standart sözleşme yoksa YZ çevrimdışı (yerel sezgisel)
kipte çalışır.

## 3. Aydınlatma metni ile açık rıza metinlerinin ayrılığı

Kayıt formunda üç ayrı onay kutusu vardır ve her biri ayrı bir alana yazılır:

| Alan | Niteliği | Zorunlu mu? | Verilmezse |
|---|---|---|---|
| `kvkkNoticeAccepted` | **Aydınlatma** (md. 10): yalnızca okunduğunun teyidi; rıza DEĞİLDİR | Evet (`false` → 400 `validation`) | Kayıt yapılamaz |
| `politicalConsent` | **Açık rıza** (md. 6/3-a): siyasi görüş niteliğindeki oy verisinin işlenmesi | Hayır | Üye olunur, okunur, tartışılır; **oy kullanılamaz** (`isVoter` = doğrulanmış ∧ reşit ∧ siyasi rıza) |
| `aiConsent` | **Açık rıza** (md. 6/3-a + md. 9): içeriğin YZ analizine ve yurt dışına aktarılması | Hayır, **varsayılan kapalı** | İçerik YZ'ye gönderilmez; tüm işlevler çevrimdışı çalışır |

Hizmet açık rızaya bağlanmaz (Kurul kararı 2021/389): rıza vermeyen üye forumu kullanmaya devam eder. Rızalar
`PATCH /api/me/consents` ile her an geri alınabilir; geri alma ileriye etkilidir (önceki işlemenin hukuka uygunluğunu
etkilemez). Siyasi rıza geri alındığında üye o andan itibaren oy kullanamaz; daha önce verilmiş oylar ve kapanmış sayımlar
değişmez. Her rıza değişikliği `audit_log`'a (`identity.consents`, eski/yeni değer, zaman) yazılır.

### 3.1 Aydınlatma metni (taslak — md. 10)

> **Kişisel Verilerin İşlenmesine İlişkin Aydınlatma Metni**
>
> **Veri sorumlusu:** [Forumu işleten kuruluşun unvanı, adresi, iletişim bilgileri].
>
> **İşlenen veriler ve amaçlar:** Üyeliğinizin kurulması, kimliğinizin doğrulanması, her kişinin tek hesabı ve tek oyu
> olmasının sağlanması ve reşitlik denetimi için ad, soyad, T.C. kimlik numarası, doğum tarihi; giriş ve hesap güvenliği
> için e-posta ve telefon; kimlik doğrulama ve bilirkişi seçiminde çıkar çatışmasının önlenmesi için adres bilgileriniz
> işlenir. Forumda yalnızca takma adınız görünür.
>
> **Hukuki sebepler:** Üyelik sözleşmesinin kurulması ve ifası (md. 5/2-c), hukuki yükümlülük (md. 5/2-ç), meşru menfaat
> (md. 5/2-f). Siyasi görüşünüzü açığa çıkarabilecek oy verileriniz yalnızca ayrıca vereceğiniz açık rızaya dayanılarak
> işlenir (md. 6/3-a).
>
> **Saklama ve güvenlik:** Kimlik verileriniz alan bazında şifrelenmiş ayrı bir kasada tutulur; yalnızca yetkili kayıt
> memuru, denetçi ve yönetici, amaç belirterek ve her erişim kayda geçirilerek görebilir. Üyeliğiniz sona erdiğinde ya da
> talep ettiğinizde şifreleme anahtarınız imha edilerek veriler geri döndürülemez biçimde silinir.
>
> **Aktarım:** Kimlik verileriniz kimseye aktarılmaz. Yalnızca ayrıca rıza verirseniz, gönderilerinizin kişisel verisi
> maskelenmiş ve takma adı kaldırılmış metni yapay zekâ analizi için yurt dışındaki hizmet sağlayıcıya aktarılır.
>
> **Toplama yöntemi:** Kayıt formu (elektronik) ya da kayıt memurunun yüz yüze girişi.
>
> **Haklarınız (md. 11):** Verilerinizin işlenip işlenmediğini öğrenme, bilgi talep etme, amacını öğrenme, aktarıldığı
> kişileri bilme, düzeltme, silme, otomatik analiz sonucuna itiraz ve zararın giderilmesini isteme haklarına sahipsiniz.
> Profil sayfanızdan verilerinizin tam dökümünü alabilir ve hesabınızı silebilirsiniz. Diğer başvurular için:
> [başvuru adresi]. Başvurular en geç 30 gün içinde yanıtlanır (md. 13).

### 3.2 Açık rıza metni — siyasi görüş (oy kullanma)

> Forumdaki oylamalarda kullanacağım oyların ve vekâlet tercihlerimin siyasi düşüncemi açığa çıkarabilecek özel nitelikli
> kişisel veri olduğunu; bu verilerin yalnızca üye kimliğimle (gerçek kimliğimden ayrı olarak) saklanacağını, dağıtık
> deftere yalnızca anahtarlı özetlerinin yazılacağını ve kararların sayımı ile görüş kümelerinin hesaplanması amacıyla
> işleneceğini anladım. Bu rızayı vermesem de forumu kullanabileceğimi, ancak oy kullanamayacağımı; rızamı istediğim zaman
> profil sayfamdan geri alabileceğimi biliyorum. **[ ] Açık rıza veriyorum.**

### 3.3 Açık rıza metni — yapay zekâ analizi ve yurt dışına aktarım

> Gönderilerimin, kişisel verileri maskelenmiş ve takma adım K1, K2… gibi geçici etiketlerle değiştirilmiş olarak, özet
> çıkarma, sınıflandırma ve uzlaşma taslağı hazırlama amacıyla yurt dışındaki yapay zekâ hizmet sağlayıcısına
> (Anthropic, Claude API) aktarılmasına rıza veriyorum. Yapay zekânın yalnızca danışman olduğunu; içerik gizleyemeyeceğini,
> oy veremeyeceğini, bir kararı tek başına belirleyemeyeceğini ve tüm çıktılarının "Yapay zekâ ile üretildi" etiketi
> taşıyacağını biliyorum. Bu rıza varsayılan olarak kapalıdır ve istediğim zaman geri alınabilir.
> **[ ] Açık rıza veriyorum.**

## 4. Teknik tedbirler

### 4.1 Anahtar hiyerarşisi

```
MASTER_KEY (32 bayt, ortam değişkeni / demo: data/keys/master.key)
 ├─ KEK_v = HKDF-SHA256(MASTER, tuz="forum-sistemi/kimlik-kasasi/v1", bilgi="kek:v<sürüm>")
 │    └─ wrapped_dek = AES-256-GCM(KEK_v, DEK, AAD="<userId>|dek|v<sürüm>")       ← kullanıcıya özel, rastgele 32 bayt DEK
 │         └─ alan anahtarı = HKDF(DEK, bilgi="alan:<ad>")
 │              └─ enc_<ad> = AES-256-GCM(alan anahtarı, değer, AAD="<userId>|<ad>|v<sürüm>")
 ├─ HKDF(MASTER, "bidx:tckn")      → tckn_bidx      = HMAC-SHA256(·, yalnız rakamlar)
 ├─ HKDF(MASTER, "bidx:email")     → email_bidx     = HMAC-SHA256(·, NFKC + küçük harf + kırpma)
 ├─ HKDF(MASTER, "bidx:household") → household_bidx = HMAC-SHA256(·, normalize(il|ilçe|mahalle|açık adres))
 └─ HKDF(MASTER, "member-ref")     → memberRef      = HMAC-SHA256(·, userId)   (deftere yazılan tek üye referansı)
TOKEN_KEY → oturum belirteci = <sessionId>.<HMAC-SHA256(TOKEN_KEY, sessionId) base64url>
VOTE_KEY  → ballotId = HMAC(VOTE_KEY, userId‖proposalId‖round)   (oylama modülü)
```

- **Şifreli metin biçimi:** `v1:<iv b64>:<ct b64>:<tag b64>`; IV 96 bit rastgele, etiket 128 bit (NIST SP 800-38D).
  Her alan ayrı anahtar ve ayrı IV ile şifrelenir.
- **AAD (ek doğrulanmış veri):** Şifreli bir alan başka kullanıcının satırına ya da aynı satırın başka bir sütununa
  kopyalanırsa çözme başarısız olur (testte: ad ↔ soyad yer değiştirme, kasa satırının başka kullanıcıya kopyalanması →
  500 `vault_integrity` + `identity.vault_integrity_failure` denetim kaydı).
- **Kör indeksler (CipherSweet yaklaşımı):** Tekillik (UNIQUE) ve e-postayla giriş, düz metne dokunmadan yapılır. Anahtarsız
  özet kullanılmaz: TCKN uzayı ~2³⁰ olduğundan düz SHA-256 dakikalar içinde tersine çevrilebilirdi.
- **Hane indeksi:** Adres; NFKC, tr-TR küçük harf, noktalama temizliği ve kısaltma eşlemesiyle (Mah./Mh. → mahalle,
  Cad./Cd. → cadde, Sok./Sk. → sokak, Blv. → bulvar, D: → daire, No: → no …) normalleştirilir. Aynı hanede oturan iki
  üye, adreslerini farklı yazsalar da aynı `household_bidx`'i alır; adresin kendisi açığa çıkmaz.
- **Anahtar sürümü:** `identity_vault.key_version` hem KEK türetimine hem AAD'ye girer. Ana anahtar dönüşümünde sürüm
  değişmez; yalnız `wrapped_dek` yeni ana anahtarın KEK'iyle yeniden sarılır (§8.1).
- **Kasa dışı şifreli kayıtlar:** Düzeltme talebinin önerisi ve gerekçesi (`identity_corrections.enc_payload`,
  `enc_reason`) kişinin DEK'inden türetilen ayrı anahtarla (`HKDF(DEK, "kayit:duzeltme")`) ve talep kimliğine bağlı AAD
  (`<userId>|duzeltme:<talepId>|v<sürüm>`) ile şifrelenir; başka bir talebe taşınırsa çözülmez, kripto-imhada kendiliğinden
  okunamaz hâle gelir.

### 4.2 Erişim denetimi ve rol ayrılığı

| İşlem | Kim | Kayıt |
|---|---|---|
| Kişisel veriyi görüntüleme (`getPii`) | Doğrulanmış kayıt memuru, denetçi, yönetici; **amaç zorunlu (≥ 5 karakter)** | Her erişim `pii_access_log` (aktör, üye, amaç, zaman) + `audit_log` (`identity.pii_access`). TCKN yalnızca maskeli (`123******90`) döner |
| Üye doğrulama / reddetme, üyeyi sisteme girme | Kayıt memuru, yönetici (kendi hesabını doğrulayamaz) | `audit_log` (`identity.verify`, `identity.create_by_registrar`); serbest metin notu günlüğe yazılmaz, yalnızca `hasNote` |
| Rol atama | Yalnızca yönetici; son yönetici kendini düşüremez | `audit_log` (`identity.roles`, eski/yeni roller) |
| Düzeltme talebini inceleme (`reviewCorrection`) | Kayıt memuru, denetçi, yönetici; **amaç zorunlu** | `pii_access_log` + `audit_log` (`identity.pii_access`, `correctionId`, alan adları) — değerler çözülmeden önce |
| Düzeltme talebine karar (`decideCorrection`) | Kayıt memuru, yönetici; **önce kendisi amaçla incelemiş olmalı**; kendi talebine karar veremez | `audit_log` (`identity.correction_approved` / `_rejected`: yalnız alan adları, not var/yok) |
| Ana anahtar dönüşümü | Sunucu yöneticisi (betik, sunucu kapalıyken) | `audit_log` (`identity.master_key_rotated`: yeniden sarılan/atlanan satır sayısı) |
| Denetim günlüğünü okuma | Yönetici, denetçi | — |

Denetim günlüğünün `meta` alanına kişisel veri yazılmaz (yalnızca karar, rol listesi, erişim amacı gibi bilgiler).
Herkese açık hiçbir API yanıtında ad, soyad, TCKN, adres, doğum tarihi, e-posta ya da telefon yoktur; `Me` ve
`PublicUser` yalnızca takma ad ve kaba bölge (yalnız sahibine) içerir.

### 4.3 Defter ve oy gizliliği

- Kimlik modülü deftere yalnızca `MEMBER_REGISTERED {memberRef, at}`, `MEMBER_VERIFIED {memberRef}` ve
  `MEMBER_ERASED {memberRef}` yazar. `memberRef` üye kimliği değildir; ana anahtar olmadan hiçbir hesaba bağlanamaz
  (testte tüm defter yükleri TCKN, ad, e-posta, telefon, adres, doğum tarihi, takma ad ve üye kimliği için taranır).
- Oylar deftere `ballotId = HMAC(voteKey, userId‖proposalId‖round)` ve tuzlu taahhüt (`commit–reveal`) olarak gider;
  defterde kullanıcı↔oy bağı yoktur.
- Mesaj özetleri tuzludur (`contentHash = SHA256(tuz ‖ metin)`); tuz defter dışındadır, bu yüzden özet metne geri
  götürülemez (EDPB 02/2025 para. 52–53).
- **Görüş kümesi bilgisi kişinin kendisine özeldir.** Kişinin görüş kümesi, oy uzlaşısı topluluğu ve görüş haritasındaki
  koordinatları (özel nitelikli veri — siyasi görüş eğilimi) yalnızca kendisine gösterilir. Herkese açık görüş haritası anonim
  noktalardan oluşur, kimlik içermez ve noktalar kimliğe göre değil koordinata göre sıralanır. Herkese açık graf düğümleri
  yalnızca sosyal ilişkileri (takip, kefalet, vekâlet) taşır.
- **İtiraz imzaları anonimdir.** İtiraz imzacısı ilk turda zorunlu olarak "red" oyu vermiş olduğundan, imzacının takma adını
  göstermek gizli oyu açığa çıkarırdı. Bu yüzden itiraz listesi başkalarına "Anonim imzacı" olarak görünür, kişi yalnızca kendi
  imzasını tanır; yalnızca sayı, küme ve gerekçe herkese açıktır. Azınlık raporu ise bilinçli bir kamusal beyandır ve yazarın
  takma adıyla yayımlanır; arayüz yazmadan önce bunun ilk tur oyunu belli edeceğini açıkça söyler.
- **Defterde vekâlet ilişkisi yoktur.** Vekâlet kayıtları defterde sunucu sırrıyla anahtarlanmış bir taahhüttür
  (`HMAC(voteKey, from|to|kapsam|sıra|kenarId)`); az sayıda üyede kaba kuvvetle çözülemez.

### 4.4 Kimlik doğrulama güvenliği

- Şifre: en az 8 karakter, harf + rakam; scrypt (`scrypt$N$r$p$tuz$özet`), `timingSafeEqual` ile karşılaştırma.
- Hatalı girişte hesabın var olup olmadığı açığa çıkmaz: tek mesaj ("Takma ad/e-posta veya şifre hatalı.") ve hesap
  bulunmasa da sahte scrypt hesabı (zamanlama eşitleme). Başarısız denemeler `identity.login_failed` olarak günlüğe yazılır.
- Oturum belirteci HMAC imzalıdır; veritabanında yalnızca oturum kimliği durur. `authenticate` imza, süre (180 gün,
  simüle saat), iptal ve hesap durumunu (silinmiş/reddedilmiş → geçersiz) denetler. Şifre değişince diğer tüm oturumlar
  iptal edilir.
- SQLite `PRAGMA secure_delete = ON`: üzerine yazılan/silinen satır baytları sayfalarda sıfırlanır; imhadan sonra WAL
  dosyası denetim noktasıyla (checkpoint) kesilir.

## 5. İlgili kişinin hakları (md. 11) ve uygulamadaki karşılıkları

| md. 11 | Hak | Uygulamadaki karşılığı |
|---|---|---|
| a | İşlenip işlenmediğini öğrenme | `GET /api/me` ve `GET /api/me/export` |
| b | İşlenmişse bilgi talep etme | `GET /api/me/export` → `exportOwnData`: hesap, **çözülmüş kimlik verisi (tam TCKN dahil)**, rızalar, oturumlar, kişisel verisine kimin hangi amaçla eriştiği (`piiAccessLog`), hesabıyla ilgili denetim olayları, kendi öneri/mesaj/sürüm/oy/itiraz/azınlık raporu/vekâlet/ilişki/bilirkişi kayıtları ve bildirimleri. Döküm de denetim günlüğüne yazılır (`identity.export`) |
| c | Amacını ve amaca uygun kullanılıp kullanılmadığını öğrenme | Aydınlatma metni; dökümdeki `processing` bölümü; `piiAccessLog`'daki erişim amaçları |
| ç | Aktarıldığı üçüncü kişileri bilme | Aydınlatma metni (yalnız YZ sağlayıcısı, yalnız rızayla); `aiConsent` durumu dökümde |
| d | Eksik/yanlış verinin düzeltilmesi | **Düzeltme talebi akışı** (§5.1): `POST /api/me/corrections` (Profil → "Kimlik bilgilerimi düzelt") → kayıt memuru amaç belirterek inceler (`POST /api/registrar/corrections/:id/review`) ve belgeyle doğruladıktan sonra karar verir (`…/decide`). Takma ad ve şifre bu akışın konusu değildir (kişi kendisi değiştirir). |
| e | Silinmesi / yok edilmesi | `POST /api/me/erase` (`"SİL"` onayı + şifre) → `eraseSelf`: **kripto-imha**, oylamaya konmaz, anında |
| f | (d) ve (e)'nin aktarılan üçüncü kişilere bildirilmesi | Kimlik verisi aktarılmadığından gerekmez; YZ sağlayıcısına giden metin takma adsız ve maskelidir |
| g | Yalnızca otomatik sistemlerle analiz sonucu aleyhine bir sonuca itiraz | YZ yalnızca danışmandır: durum değiştirmez, içerik gizlemez, oy vermez; her YZ çıktısı etiketlidir; moderasyon önerileri insana gider |
| ğ | Zararın giderilmesini talep | Veri sorumlusunun başvuru kanalı (aydınlatma metninde) |

Başvuru süresi: en geç 30 gün (md. 13). Döküm ve silme anında yerine getirildiği için bu süre fiilen sıfırdır.

### 5.1 Kimlik verisi düzeltme talebi (md. 11/1-d)

| Adım | Ne olur? | İz |
|---|---|---|
| 1. Talep | Üye düzeltilecek alanları (ad, soyad, TCKN, doğum tarihi, e-posta, telefon, adres) ve **gerekçesini** (10–2000 karakter) gönderir. Değerler kayıt formuyla aynı kurallarla doğrulanır; mevcut kayıtla aynı alanlar ayıklanır; yinelenen TCKN/e-posta 409 ile reddedilir (kör indeksle, düz metne dokunmadan). Aynı anda tek bekleyen talep olabilir. | Öneri ve gerekçe kişinin DEK'iyle şifreli (`identity_corrections`); `audit_log` `identity.correction_requested` (yalnız alan adları); kayıt memurlarına bildirim |
| 2. İnceleme | Talep listesi değer içermez. Kayıt memuru (ya da denetçi/yönetici) **amaç yazarak** inceler: düzeltilen alanların mevcut ve önerilen değerleri (TCKN maskeli) ve gerekçe gösterilir. | `pii_access_log` (aktör, üye, amaç) + `audit_log` `identity.pii_access` (`correctionId`) |
| 3. Karar | Yalnız talebi **kendisi inceleyen** kayıt memuru/yönetici karar verir; kendi talebine karar veremez; denetçi yalnız okur. **Onay:** yalnız değişen kasa alanları aynı DEK ile **yeni rastgele IV'lerle yeniden şifrelenir**, işlem içinde yeniden çözülerek doğrulanır; TCKN/e-posta/hane kör indeksleri, il/ilçe ve (doğum tarihi değiştiyse) reşitlik güncellenir. **Ret:** kasa değişmez. Her iki durumda öneri **imha edilir** (`enc_payload` NULL); gerekçe hesap verebilirlik için şifreli kalır. | `audit_log` `identity.correction_approved` / `identity.correction_rejected` (alan adları, not var/yok); üyeye bildirim |
| — | Üye bekleyen talebini geri çekebilir (öneri imha). Hesap silinirse (kripto-imha) öneri ve gerekçe NULL yapılır, bekleyen talep "geri çekildi" sayılır. KVKK dökümünde talep geçmişi (alanlar, durum, tarihler, not) yer alır. | `identity.correction_withdrawn` |

Deftere düzeltmeyle ilgili hiçbir kayıt yazılmaz (kişisel veri yok, `memberRef` de değişmez).

## 6. Kripto-imha ile "tartışma silinmez" ilkesinin bağdaştırılması

Sistemin iki ilkesi ilk bakışta çatışır: (1) tartışmalar ve kayıtlar fiziksel olarak silinmez; (2) kişi kendi kişisel
verisinin silinmesini isteyebilir ve bu oylamaya konamaz. Çözüm, **kimlik** ile **katılım kaydını** ayırmaktır:

| Katman | Silme talebinde ne olur? |
|---|---|
| Kimlik kasası | `wrapped_dek` ve tüm `enc_*` alanları NULL; kör indeksler (TCKN, e-posta, hane) NULL. DEK artık hiçbir yerde olmadığından, eski bir kopyada şifreli metin kalsa bile çözülemez. Aynı TCKN/e-postayla yeniden kayıt mümkündür |
| Hesap | Durum `erased`; takma ad `Silinmiş üye #<kısa>`; şifre özeti geçersiz; tüm oturumlar iptal; rızalar kapalı; kaba bölge NULL; roller yalnız `member` |
| Defter | `MEMBER_ERASED {memberRef}` eklenir; eski kayıtlar değişmez ama zaten kişisel veri içermez |
| Mesajlar, öneriler, sürümler | **Silinmez.** Yazar artık "Silinmiş üye #…" olarak görünür; içerik, kimseye bağlanamayan takma adlı bir kayıt olarak kalır |
| Oylar ve sayımlar | Kapanmış sayımlar değişmez (silme geriye etkili değildir); `ballots` satırları yalnızca artık kimliğe bağlanamayan üye kimliğini taşır |
| Denetim ve erişim günlükleri | Saklanır (silme kayıtlarının en az 3 yıl saklanması yükümlülüğü); kişisel veri içermez |

Mesaj **metninin kendisi** kişisel veri içeriyorsa (ör. üye kendi adresini yazmışsa), bu kimlik silmesiyle değil, içerik
karartma yoluyla ele alınır: yazının gizlenmesi (`hidden`) silme oylamasına gider; mahkeme ya da Kurul kararı ve kişisel
veri ihlali gibi hukuki durumlarda oylama yapılmadan "hukuki hızlı yol" ile karartılır ve işlem kayda geçer. Gönderim
öncesi kişisel veri taraması (`pii_detected`) bu riski baştan azaltır.

Başvurusu **reddedilen** üyenin kasası da aynı yöntemle imha edilir (işleme amacı ortadan kalkmıştır; hesap
`Reddedilen başvuru #…` olur). **180 gün** içinde doğrulanmayan başvurular `purgeStalePending()` ile periyodik olarak imha
edilir (KVKK silme yönetmeliği: periyodik imha en fazla 6 ayda bir).

## 7. Uygulama haritası

| Bileşen | Dosya |
|---|---|
| Kasa kriptografisi (HKDF, AES-256-GCM, kör indeks, memberRef, adres normalleştirme) | `server/src/identity/vault.ts` |
| Şifre özeti (scrypt) | `server/src/identity/password.ts` |
| Oturum belirteci (HMAC) | `server/src/identity/sessions.ts` |
| Kayıt doğrulaması (zod 4, Türkçe hata iletileri) | `server/src/identity/validation.ts` |
| `users` ↔ `PublicUser`/`Me`, `isVoter` | `server/src/identity/users.ts` |
| `IdentityService` uygulaması | `server/src/identity/index.ts` |
| Düzeltme talebi akışı (md. 11/1-d) | `server/src/identity/corrections.ts`; arayüz: Profil → "Kimlik bilgilerimi düzelt", Kayıt memuru → "Düzeltme talepleri" |
| Ana anahtar dönüşümü (çekirdek + betik) | `server/src/identity/rotate.ts`, `server/scripts/rotate-master-key.ts` |
| Testler (kasa, kör indeks, AAD, kripto-imha, döküm, defterde kişisel veri yokluğu…) | `server/test/identity/*.test.ts` |

## 8. Anahtar yönetimi ve bilinen sınırlamalar

1. **Demo ortamında anahtarlar dosyadadır.** `MASTER_KEY`, `TOKEN_KEY`, `VOTE_KEY` ortam değişkeninden okunur; yoksa
   `data/keys/*.key` dosyalarına (izin `0600`) rastgele üretilir. Bu, veritabanıyla aynı makinede durdukları anlamına
   gelir. Üretimde ana anahtar bir KMS/HSM'de ya da en azından veritabanından ayrı bir gizli depoda tutulmalı, yedeklere
   girmemelidir (Kurul kararı 2018/10: anahtarların ayrı tutulması).
2. **Ana anahtar sızarsa** tüm kasa çözülebilir ve TCKN kör indeksi ~2³⁰ denemeyle tersine çevrilebilir. Kör indeks yalnızca
   veritabanı tek başına sızdığında koruma sağlar.
3. **Yedekler.** İmhadan önce alınmış bir yedekte `wrapped_dek` hâlâ vardır; ana anahtarla birlikte ele geçirilirse silinmiş
   üyenin verisi geri getirilebilir. Önlem: yedek saklama süresini kısa tutmak (≤ 6 ay) ve **ana anahtar dönüşümü** (§8.1):
   canlı DEK'ler yeni KEK'le yeniden sarılır, eski ana anahtar imha edilir — böylece eski yedeklerdeki silinmiş üyelerin
   DEK'leri de kalıcı olarak çözülemez hâle gelir.
4. **Tek süreç.** Kasa, forum ve anahtarlar aynı Node.js sürecindedir; JavaScript dizelerindeki çözülmüş veriler bellekten
   güvenle silinemez (yalnızca `Buffer` anahtarlar sıfırlanır). Üretimde kasa ayrı bir hizmete taşınabilir.
5. **Üyelik sorgulanabilirliği.** Yinelenen TCKN/e-posta kaydı 409 ile reddedilir; bu, birinin TCKN'sini bilen birinin o
   kişinin üye olup olmadığını öğrenmesine yol açabilir (siyasi üyelik de hassastır). Önlemler: `auth/*` için hız sınırı
   (20 istek/dk), her yinelenen denemenin `identity.duplicate_attempt` olarak günlüğe yazılması. Daha güçlü alternatif:
   genel bir yanıt verip sonucu e-postayla bildirmek.
6. **Personel için iki faktörlü kimlik doğrulama (2FA) yoktur — bilinçli sınırlama.** Kurul 2018/10, özel nitelikli
   veriye uzaktan erişimde iki faktör önerir; kayıt memuru, denetçi ve yönetici hesapları kişisel veriye eriştiği için bu
   öneri onları doğrudan kapsar. Bu sürümde eklenmemesinin gerekçeleri:
   - **İkinci kanal yok:** Sistem e-posta/SMS göndermez (kimlik verileri kasada şifreli durur ve hiçbir üçüncü kişiye
     aktarılmaz); SMS/e-posta kodu, telefon ve e-postanın bir aktarım sağlayıcısına verilmesini gerektirirdi.
   - **TOTP (RFC 6238) güvenli kurulumu kapsam dışı:** TOTP sırrı, kayıt (QR) akışı, saat kayması toleransı, yedek kodlar
     ve kayıp cihaz kurtarma süreci (kim, hangi kimlik kanıtıyla sıfırlar?) ayrıca tasarlanıp test edilmelidir; yarım bir
     uygulama yanlış güvenlik hissi verir. Ayrıca alan mantığı simüle saatle (`TIME_SCALE`) çalışır; TOTP gerçek saate
     bağlanmalıdır.
   - **Telafi edici tedbirler (mevcut):** kişisel veriye her erişim amaç zorunlu ve kayıtlı (`pii_access_log`, denetçi
     incelemesi); düzeltme kararında "önce kendin incele" ve "kendi talebine karar verme" kuralları; rol ayrılığı (denetçi
     yalnız okur, rolleri yalnız yönetici verir, son yönetici düşürülemez); `auth/*` için hız sınırı (20/dk); şifre
     değişince diğer oturumların kapanması; başarısız girişlerin günlüğe yazılması; ana anahtar dönüşümü.
   - **Üretim için yapılacak:** personel rollerine (registrar/auditor/admin) TOTP zorunluluğu (`users.totp_secret`
     kasada şifreli), kişisel veri uçlarında oturumun 2FA ile yükseltilmiş olması (`step-up`) ve WebAuthn/FIDO2 desteği.
7. **Reşitlik** kayıt ve doğrulama anında hesaplanır; sonradan 18 yaşını dolduranlar için `refreshAdulthood()`
   periyodik olarak (ör. günlük) çağrılmalıdır.
8. **Kimlik doğrulaması** TCKN'nin yalnızca algoritmik geçerliliğini denetler; kişiye ait olduğunu kayıt memuru yüz yüze
   doğrular (NVİ/e-Devlet entegrasyonu yok).
9. **Düzeltme hakkı** kayıt memuru onayına bağlıdır (§5.1): kimlik verisi tek kişi–tek oy güvencesinin temeli olduğundan
   üye kendi kaydını doğrudan değiştiremez; talep eder, memur belgeyle doğrulayıp onaylar. Memurun belgeyi gerçekten
   gördüğü yazılımca denetlenemez (yalnız amaçlı erişim ve karar kaydı tutulur).
10. **Örgütsel tedbirler** (VERBİS kaydı, kişisel veri işleme envanteri, saklama-imha politikası, personel gizlilik
    taahhütleri, 72 saatlik ihlal bildirim planı — Kurul 2019/10) yazılımın dışındadır ve veri sorumlusunca yerine
    getirilmelidir.

### 8.1 Ana anahtar dönüşümü (`server/scripts/rotate-master-key.ts`)

Ne zaman: ana anahtarın sızdığından şüphelenildiğinde, personel değişikliğinde, periyodik olarak (ör. yılda bir) ve eski
yedeklerdeki silinmiş üye verisini kalıcı olarak okunamaz kılmak için.

```bash
# Sunucuyu DURDURUN (bellekteki eski anahtarla yazmaya devam eder). server klasöründen:
npx tsx scripts/rotate-master-key.ts --dry-run     # deneme: her şey hesaplanır ve doğrulanır, veritabanı değişmez
npx tsx scripts/rotate-master-key.ts               # uygula (dosya kipi: yeni anahtar üretilir, data/keys/master.key değişir)
npx tsx scripts/rotate-master-key.ts --keep-old    # eski anahtar dosyası master.key.eski-<zaman> olarak saklanır
MASTER_KEY=<eski> NEW_MASTER_KEY=<yeni> npx tsx scripts/rotate-master-key.ts   # ortam değişkeni / KMS kipi
```

| Adım | Ayrıntı |
|---|---|
| Kapsam | Her canlı `identity_vault` satırı: DEK eski ana anahtarın `KEK_v`'siyle açılır, **yeni** ana anahtarın `KEK_v`'siyle yeniden sarılır. Alan şifreli metinleri ve DEK değişmez (zarf şifrelemenin amacı); `key_version` aynı kalır. Kripto-imha edilmiş satırlar (DEK yok) atlanır. |
| Kör indeksler | `tckn_bidx`, `email_bidx`, `household_bidx` ana anahtardan türetildiği için çözülen değerlerden yeni anahtarla yeniden hesaplanır (aksi hâlde e-postayla giriş ve TCKN tekilliği bozulurdu). |
| Atomiklik | Tek SQLite işlemi. Eski anahtar herhangi bir satırı açamazsa (yanlış anahtar, bozuk satır) hiçbir değişiklik yapılmaz. |
| Doğrulama | İşlem bitmeden her satır **yalnız yeni anahtarla** yeniden okunur: tüm alanlar eskisiyle aynı çözülmeli, kör indeksler tutmalı, eski anahtar artık açamamalı; aksi hâlde geri alınır. İşlemden sonra veritabanından bağımsız ikinci bir denetim yapılır. |
| Anahtar dosyası | Dosya kipinde yeni anahtar önce `keys/master.key.yeni`'ye yazılır, işlem başarılıysa `master.key` olur. Arada kesilirse betik bir sonraki çalıştırmada bunu algılar ve ne yapılacağını söyler. Anahtar ekrana yazılmaz. Ortam değişkeni kipinde yeni anahtar `NEW_MASTER_KEY` ile verilir (KMS'e operatör koyar). |
| Denetim | `audit_log` `identity.master_key_rotated` (yeniden sarılan / atlanan satır sayısı; anahtar ya da kişisel veri yok). |
| Etkilenmeyenler | Düzeltme talebi önerileri (kişinin DEK'iyle şifreli), oturum belirteçleri (`TOKEN_KEY`), oy kimlikleri (`VOTE_KEY`). |

**Bilinen sonuç — defter takma referansı:** `memberRef = HMAC(HKDF(MASTER, "member-ref"), userId)` da ana anahtardan türetilir.
Dönüşümden sonra yazılan `MEMBER_*` defter kayıtları yeni referansı taşır; dönüşümden önceki `MEMBER_REGISTERED` ile sonraki
`MEMBER_ERASED` aynı referansla eşleşmez. Defter yalnız sayım/denetim izi tuttuğundan (ve değiştirilemez olduğundan) bu kabul
edilmiştir; yan etkisi olumludur: eski referanslar artık hiçbir anahtarla hesaba bağlanamaz (ileriye dönük bağlantısızlık).

Dönüşümden sonra eski anahtarı imha edin (`--keep-old` kullandıysanız yedeği güvenli yere taşıyıp sonra silin). Eski anahtar
imha edildiğinde, dönüşümden önce alınmış yedekler (ve onlardaki silinmiş üyelerin verisi) kalıcı olarak çözülemez olur.
