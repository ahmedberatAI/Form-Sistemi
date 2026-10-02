// Ana sayfa › Sistem nasıl çalışır?: sistemin 8 temel ilkesi. Başlıklar her zaman görünür; metin ve bağlantı bir dokunuşla
// açılır ('Tam' görünümde hepsi açık gelir). Her ilke yerel <details> olduğundan klavye ve ekran okuyucu desteği hazırdır.
import { Link } from "react-router-dom";
import { routes } from "../../lib/routes";
import { Details, Icon, Section } from "../../ui";
import "./home.css";

export interface Principle {
  title: string;
  text: string;
  to: string;
  link: string;
}

export const PRINCIPLES: Principle[] = [
  {
    title: "Çoğunluk gerekir ama yetmez — köprü testi",
    text: "Bir öneri genel onayın yanında, anlamlı büyüklükteki her görüş kümesinden de asgari destek almalıdır. Taban aşılamazsa sonuç “tartışmalı” olur ve uzlaşma turu açılır.",
    to: routes.graph(),
    link: "Görüş kümelerini gör",
  },
  {
    title: "Azınlığın gücü erteleyicidir, tek seferliktir",
    text: "Kabul edilen bir karara karşı oy veren azınlık, kararı bir kez durdurup uzlaşma turu başlatabilir. Yeniden oylamada nitelikli çoğunluk (2/3, bazı kararlarda 3/4) kesin sonucu verir.",
    to: `${routes.proposals()}?sekme=itiraz`,
    link: "İtiraz ve uzlaşmadaki öneriler",
  },
  {
    title: "Bazı haklar oylanamaz",
    text: "Değiştirilemez maddelere dokunan öneriler oylamaya hiç girmeden geçersiz sayılır. Temel bir hakkı kısıtlayan öneriler daha yüksek eşik ve bilirkişi görüşü ister.",
    to: routes.ontology(),
    link: "Yönetmeliği oku",
  },
  {
    title: "Tartışma silinmez, yalnızca karartılır",
    text: "Silme talebi de oylanır; kabul edilirse mesaj gizlenir ve yerinde mezar taşı kalır. Görüş ayrılığı hiçbir zaman silme gerekçesi olamaz.",
    to: `${routes.proposals()}?sekme=tumu&tur=deletion`,
    link: "Silme taleplerini gör",
  },
  {
    title: "Oy gizli, sayım herkese açık — kendiniz doğrulayın",
    text: "Oyunuz deftere yalnızca bir taahhüt (özet) olarak yazılır. Makbuzunuzla oyunuzun sayıldığını doğrulayabilir, bültenden sayımı kendiniz yeniden hesaplayabilirsiniz.",
    to: routes.verifyVote(),
    link: "Oyum kayıtlı mı?",
  },
  {
    title: "YZ ve bilirkişi danışmandır",
    text: "Yapay zekâ özet, sınıflandırma ve köprü taslakları önerir; bilirkişiler kurayla seçilip rapor yazar. Hiçbiri durum değiştirmez; YZ çıktıları her zaman etiketlenir, bilirkişinin oyu 1'dir.",
    to: routes.experts(),
    link: "Bilirkişiler",
  },
  {
    title: "Kişisel veri defterde yok",
    text: "Dağıtık defterde ad, T.C. kimlik no, adres ya da ham mesaj metni bulunmaz; yalnızca özetler ve taahhütler vardır. Kimlik bilgileri şifreli kasadadır ve yalnızca kayıt memuru amaç belirterek görebilir.",
    to: routes.ledger(),
    link: "Defteri incele",
  },
  {
    title: "Vekâlet sınırlıdır, herkes bir kez sayılır",
    text: "Oyunuzu güvendiğiniz bir üyeye devredebilirsiniz; doğrudan oyunuz her zaman önceliklidir. Bir delege yalnızca sınırlı sayıda başkasının tercihini taşıyabilir.",
    to: routes.profile(),
    link: "Vekâletlerim",
  },
];

export function PrinciplesAccordion() {
  return (
    <Section
      id="ilkeler"
      title={`Sistem nasıl çalışır? (${PRINCIPLES.length} temel ilke)`}
      description="Çoğunluğun azınlığı tüketmemesi, azınlığın da kararı süresiz engelleyememesi için tasarlanan kurallar."
    >
      <ul className="tenets">
        {PRINCIPLES.map((p) => (
          <li key={p.title}>
            <Details summary={p.title}>
              <p className="tenet-text">{p.text}</p>
              <Link to={p.to} className="tenet-link">
                {p.link} <Icon name="chevronRight" size={14} />
              </Link>
            </Details>
          </li>
        ))}
      </ul>
    </Section>
  );
}
