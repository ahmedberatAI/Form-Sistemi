// Ana sayfa başlığı. Üyede: "Merhaba, @ad" ve altında tek satır canlı özet ("2 iş sizi bekliyor · 3 öneri oylamada");
// üyede slogan yoktur. Ziyaretçide: "Forum Sistemi", en çok 14 kelimelik slogan, [Giriş yap] [Kayıt ol], "Okumak için hesap
// gerekmez." ve bugünkü açıklama 'Neden kayıt gerekir?' açılırının içinde. Oturum yüklenirken blok aynı yeri tutar (düzen kaymaz).
// İlk ekranda tek birincil eylem: dolu 'Giriş yap' üst çubuktakidir; başlıktaki [Giriş yap] [Kayıt ol] ikincil düğmedir.
import type { ReactNode } from "react";
import type { Me } from "@forum/shared";
import { formatNumber } from "../../lib/format";
import { routes } from "../../lib/routes";
import { cx, Details, LinkButton, useDocumentTitle } from "../../ui";
import "./home.css";

/** Ziyaretçi başlığındaki slogan (en çok 14 kelime; birim testli). */
export const VISITOR_SLOGAN = "Köprülü çoğunlukla karar veren, azınlığı tüketmeyen, her adımı defterden doğrulanan topluluk forumu.";

/** 'Neden kayıt gerekir?' açılırının metni (Faz 1'deki çağrı kartının metni, aynen). */
export const WHY_REGISTER =
  "Tartışmaları, kararları ve defteri okumak için hesap gerekmez. Öneri açmak, desteklemek ve oy vermek için kayıt olup kimliğinizi kayıt " +
  "memuruna doğrulatmanız gerekir. Herkese yalnızca takma adınız görünür; kimlik bilgileriniz şifreli kasada tutulur.";

export interface GreetingSummaryInput {
  /** Bekleyen iş sayısı (pano görevleri) */
  tasks: number;
  /** Oylamadaki (ve yeniden oylamadaki) öneri sayısı */
  voting: number;
  /** Süren bütün evrelerdeki öneri sayısı */
  open: number;
}

/** Selamın altındaki tek satır: "2 iş sizi bekliyor · 3 öneri oylamada" ya da "Bekleyen işiniz yok · şu an açık öneri yok". */
export function greetingSummary({ tasks, voting, open }: GreetingSummaryInput): string {
  const first = tasks > 0 ? `${formatNumber(tasks)} iş sizi bekliyor` : "Bekleyen işiniz yok";
  const second = voting > 0 ? `${formatNumber(voting)} öneri oylamada` : open > 0 ? `${formatNumber(open)} açık öneri` : "şu an açık öneri yok";
  return `${first} · ${second}`;
}

export interface GreetingProps {
  /** Oturumdaki kullanıcı; null → ziyaretçi */
  user: Pick<Me, "nickname"> | null;
  /** Oturum henüz yükleniyor (auth.loading): yer tutucu çizilir */
  loading?: boolean;
  /** Canlı özet (pano gelmeden null: satır boş yer tutar) */
  summary?: string | null;
  /** Masaüstünde başlığın sağındaki hızlı eylemler (üye) */
  actions?: ReactNode;
}

export function Greeting({ user, loading, summary, actions }: GreetingProps) {
  useDocumentTitle("Ana sayfa");

  if (loading) {
    // Ziyaretçi mi üye mi henüz bilinmiyor: başlık ve özet satırının yeri tutulur, içerik sonra gelir.
    return (
      <header className="page-header home-head" aria-busy="true">
        <h1 className="page-title">Forum Sistemi</h1>
        <p className="home-summary" aria-hidden="true">
          {"\u00a0"}
        </p>
      </header>
    );
  }

  if (!user) {
    return (
      <header className="page-header home-head home-hero">
        <h1 className="page-title">Forum Sistemi</h1>
        <p className="page-subtitle home-slogan">{VISITOR_SLOGAN}</p>
        <div className="row">
          <LinkButton to={routes.login()} variant="secondary" icon="login">
            Giriş yap
          </LinkButton>
          <LinkButton to={routes.register()} icon="user">
            Kayıt ol
          </LinkButton>
        </div>
        <p className="small muted home-read-free">Okumak için hesap gerekmez.</p>
        <Details summary="Neden kayıt gerekir?" className="home-why">
          <p className="small">{WHY_REGISTER}</p>
        </Details>
      </header>
    );
  }

  return (
    <header className={cx("page-header", "home-head", actions ? "home-head-wide" : null)}>
      <div className="home-greet">
        <h1 className="page-title">Merhaba, @{user.nickname}</h1>
        <p className="home-summary">{summary || "\u00a0"}</p>
      </div>
      {actions}
    </header>
  );
}
