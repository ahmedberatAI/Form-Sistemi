# Sunum kopya kâğıdı

## Başlatma

1. Masaüstündeki **Forum Sistemi - Sunum** kısayoluna çift tıkla (ya da proje klasöründe `sunum.cmd`).
2. "Taze sunum verisi yüklensin mi?" sorusuna **E** de. Mevcut veri `server\data-yedek\<tarih>` klasörüne yedeklenir, demo verisi
   yeniden üretilir (~30 sn) ve uygulama tarayıcıda açılır. **H** dersen veri olduğu gibi kalır, yalnız sunum modunda açılır.
3. Sunum modunda saat **gerçek zamanlı** işler (`TIME_SCALE=1`): öneriler sunum sırasında kendiliğinden evre değiştirmez.
   Bir geçişi göstermek istersen `admin` ile **Yönetim › Saat ileri** (+24 sa / +72 sa).

Kapatmak için sunucu penceresini kapat. Normal kullanım için **Forum Sistemi** kısayolu (saat 60× hızlı işler).

## Hesaplar — hepsinin şifresi `deneme123`

| Takma ad | Rol | Not |
|---|---|---|
| `admin` | Yönetici | Saat ileri alma, roller, kurcalama demosu, denetim günlüğü |
| `yonetici` | Yönetici | |
| `kayitmemuru` | Kayıt memuru | 4 bekleyen üyelik başvurusu, 1 kimlik düzeltme talebi; "Üyeyi sisteme gir" |
| `denetci` | Denetçi | Gizlenmiş mesajları kayıtlı okuma, bütünlük uyarıları |
| `bk_enerji1` … `bk_enerji6` | Bilirkişi (Enerji, Çevre) | |
| `bk_saglik1` … `bk_saglik6` | Bilirkişi (Sağlık, Halk sağlığı) | |
| `bk_imar1`, `bk_imar2` | Bilirkişi (İmar, Deprem, Bütçe) | |
| `ayse` | Üye | YZ rızası var; **#K-30'da henüz oy vermedi** (oy verme gösterimi için). Çevre ve ulaşım alanlarında etkinliği var: **'Size göre' gösterimi** için en uygun hesap |
| `zeynep` | Üye | YZ rızası var; #K-30'da da oy bekliyor (`ayse` oyunu verdiyse oy gizliliği gösterimini bununla yap) |
| `mehmet` | Üye | |
| + 43 üye daha | Üye | Üç görüş grubuna dağılmış |

Dikkat: aynı ada 15 dakikada 5 kez yanlış şifre girilirse giriş 15 dakika kilitlenir; dakikada 20'den fazla giriş/çıkış da
geçici olarak engellenir.

## Önerilen gösterim akışı (hocanın 7 bileşeni; sonra arama ve kişisel sıra, Android)

1. **Ana sayfa (ziyaretçi):** "Neyi doğrulayabilirsiniz?" vitrini → **Keşfet ve doğrula** sayfası: yedi bileşen canlı durumuyla ve
   adım adım gösterim rehberi.
2. **Konu açma ve oylama (`ayse`):** "Sizi bekleyenler" → **#K-30**'a oy ver → makbuz → **Oyum kayıtlı mı?** ile makbuzu deftere
   karşı doğrula. Yeni bir konu önerisi açarken ön denetimde yönetmelik ve **yapay zekâ** (Claude Haiku 5.5) sınıflandırması görünür.
3. **Çoğunluk azınlığı tüketmesin (köprülü çoğunluk):** **#K-24** (tartışmalı → uzlaşma → kabul; sonuç kartında "Nasıl karar
   verildi?" ve köprü testi), **#K-28** (uzlaşma: azınlık raporu, YZ köprü taslakları), **#K-29** (azınlık itirazı), **#K-27**
   (yeniden oylama). Ana sayfada "Azınlık koruması" göstergesi.
4. **Bilirkişi:** **#K-32** (tartışmadaki öneride panel, rapor ve sorular), **#K-7** (kura kanıtı, çıkar çatışmasıyla dışlanan aday).
5. **Tartışmalar silinmez, kısmi silme oylanır:** **#K-21** (oylamayla gizlenen mesajın mezar taşı ve yazarın cevabı), **#K-31**
   (oylamadaki acil silme talebi).
6. **Yönetmelik ontolojisi:** **#K-22**, **#K-23** (yönetmeliğe aykırı öneriler), **#K-5** (yürürlükteki yönetmelik yaması), **Yönetmelik**
   sayfası.
7. **Dağıtık defter:** **Defter** sayfası → zincir doğrulama; `admin` ile **Kurcalama demosu** (bozulan düğüm, onarım, düğüm çökmesi).
8. **Kimlik ve takma ad (`kayitmemuru`):** bekleyen başvuruları onayla; kimlik bilgileri şifreli kasada, herkese yalnız takma ad görünür.
9. **İnsan grafı:** **Graf** sayfası (takip, kefalet, vekâlet, görüş kümeleri).
10. **Formları bulma ve kişiye göre sıralama (`ayse`, ~3 dk):**
    1. **Arama.** Üst çubuktaki **Hızlı bul** kutusuna büyük harfle ve Türkçe harfsiz `ULASIM` yaz: "Kent İçi Ulaşım…" konu ve öneri başlıkları
       Konular / Öneriler gruplarında çıkar, eşleşen kelime kalın. ↓ + Enter ile aç. `#K12` yazınca doğrudan #K-12'ye gider. Son seçenek
       **Tüm önerilerde ara**. Telefon genişliğinde (375 px) kutu yerine büyüteç düğmesi ve tam ekran panel çıkar. Oturum açmadan da çalışır.
    2. **Listeme ekle.** Bir öneri sayfasında **Listeme ekle** (☆ → ★) → **Profil › Listem** ve **Öneriler › Listem**. Liste yalnız sahibine görünür,
       KVKK dökümüne girer, hesap silinince silinir.
    3. **Size göre.** **Öneriler › Sırala › Size göre**: her kartta gerekçe çipi (ör. "Parklar ve yeşil alanlar (Çevre) ile ilgilendiğiniz için",
       "Listenizde", "Farklı bir alandan"). 34 önerinin **hiçbiri gizlenmez**; yalnız sıra değişir, varsayılan sıra "En yeni" aynen durur.
       "Size göre nasıl sıralar?" açılırında hangi verinin kullanıldığı yazar.
    4. **Oy gizliliği kanıtı.** "Size göre" listesinin ilk beş satırını not et, **#K-30**'a oy ver (oy hâlâ verilmediyse `ayse`, verildiyse `zeynep` ile),
       listeye dön: sıra ve gerekçeler **değişmez**. Oy, oy verip vermediğiniz, itiraz imzası ve azınlık raporu sıralamada hiç kullanılmaz; yalnız yazdığınız,
       desteklediğiniz, mesaj yazdığınız ve Listem'e eklediğiniz öneriler ile bu cihazda tutulan "son açılanlar" kullanılır.
    5. **Ana sayfa.** "Şu an açık" aynı kişisel sırada ve gerekçe çipli; **"Sizi bekleyenler" her zaman ayrı ve en üstte** kalır (kişiselleştirmeden etkilenmez).
    6. **Kapatma.** **Profil › Listem › Kişisel sıralama** anahtarını kapat: liste varsayılan sıraya döner ve not nedenini söyler (rıza: siyasi görüş
       açık rızası, KVKK md. 6/3-a). Açınca hemen geri gelir. Ziyaretçide "Size göre" ve "Listeme ekle" hiç yoktur.

    Gerekçe metinleri ve sıra, demo verisinin tohumlandığı güne göre değişebilir; yukarıdakiler örnektir. **Hocaya tek cümle (ölçülen isabet):**

    > Kişisel sıralamayı, üyenin sonradan gerçekten etkileştiği öneriyi bulma başarısıyla ölçtük: demo verisinde ana sayfadaki "Şu an açık" listesinde
    > bu öneri ilk 3'te %69 oranında çıkıyor (ilk tasarımda %33, rastgele sıralamada %40, eski süre sırasında %66); yalnız demo verisi yeniliği
    > ödüllendirdiği için "en yeni önce" bu veride daha yüksek çıkıyor, ilgi örüntüsü olan yapay toplulukta ise kişisel sıra onun yaklaşık 6 katı başarı
    > veriyor, hem de oy verisi kullanmadan ve kullanıcı başına yaklaşık 0,1 milisaniyede.

    Sorulursa: tüm öneriler arasında (zamansal protokol) ilk 5'te %84 (ilk tasarımda %70). Ağırlıklar tahminle değil ölçümle seçildi (dört protokol,
    kullanıcı kümelemeli önyükleme, %95 güven aralığı); gerçek kullanıcı verisiyle ölçülmedi, bu yüzden "kanıt" değil "demo verisinde ölçüm" denir.
    Tablolar: [ALGORITMA §13.3](ALGORITMA.md), [TEST_RAPORU §2](TEST_RAPORU.md). Gizlilik gerekçesi: [KVKK §3.4](KVKK.md).
11. **Android:** aynı arayüz; APK `web/android/app/build/outputs/apk/debug/app-debug.apk`.

İpucu: **Ayarlar › Görünüm › Tam** bütün ayrıntıları (defter kayıtları, parametreler, kura kanıtı) açık gösterir; sade görünüme
dönmek için yine Ayarlar.
