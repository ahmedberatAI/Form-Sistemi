// KVKK aydınlatma metni (bilgilendirme — rıza DEĞİLDİR). Kayıt formunda ve Profil'de gösterilir.
export function KvkkNotice() {
  return (
    <div className="prose kvkk-notice">
      <p>
        <strong>Veri sorumlusu:</strong> Forum Sistemi (katılımcı yönetişim platformu). Bu metin 6698 sayılı Kişisel Verilerin Korunması Kanunu'nun
        (KVKK) 10. maddesi uyarınca sizi bilgilendirmek içindir.
      </p>
      <p>
        <strong>İşlenen veriler:</strong> ad, soyad, T.C. kimlik numarası, doğum tarihi, e-posta, telefon, adres (kimlik verileri); takma ad, öneri,
        mesaj ve oy taahhütleri (platform verileri). Açık rıza verirseniz siyasi görüşünüzü ortaya koyabilecek oy ve görüş verileriniz (özel nitelikli
        veri) de işlenir.
      </p>
      <p>
        <strong>Amaç ve hukuki sebep:</strong> kimliğinizin kayıt memurunca doğrulanması, her kişinin tek hesapla katılması ve oy hakkının belirlenmesi
        (KVKK m. 5/2-c, sözleşmenin ifası; m. 5/2-f, meşru menfaat). Oy ve görüş verileri yalnızca açık rızanızla (m. 6) işlenir.
      </p>
      <p>
        <strong>Saklama ve güvenlik:</strong> kimlik verileri alan bazında, size özel anahtarla şifrelenir (AES-256-GCM). Herkese açık hiçbir sayfada ve
        dağıtık defterde kişisel veriniz bulunmaz; defterde yalnızca özetler ve kimliksiz taahhütler yer alır. Kişisel verilerinizi yalnızca kayıt
        memuru ve denetçi, amaç belirterek ve erişim kaydı bırakarak görebilir.
      </p>
      <p>
        <strong>Aktarım:</strong> verileriniz üçüncü kişilere aktarılmaz. Yapay zekâ analizine içerik gönderilmesi ayrı açık rızanıza bağlıdır ve
        gönderimden önce kişisel veriler maskelenir.
      </p>
      <p>
        <strong>Haklarınız (KVKK m. 11):</strong> verilerinizin işlenip işlenmediğini öğrenme, döküm alma, düzeltme ve silme isteme. Profil sayfasından
        verinizin dökümünü alabilir ve hesabınızı silebilirsiniz; silme, anahtarın imha edilmesiyle (kripto-imha) yapılır ve oylamaya konmaz.
        Rızalarınızı istediğiniz zaman geri alabilirsiniz.
      </p>
    </div>
  );
}

export default KvkkNotice;
