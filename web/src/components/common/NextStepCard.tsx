// "Sıradaki adım" kartı: öneri sayfasının ilk ekranında 'Ne oldu? / Benden ne bekleniyor? / Ne kadar sürem var?' sorularını tek
// kartta yanıtlar. İçeriği saf motor üretir (lib/nextStep.ts → NextStep); kart yalnız çizer: tek cümle, isteğe bağlı ikinci
// cümle, kalan süre (motor süre üretmez; çağıran Countdown verir), birincil eylem BAĞLANTISI (düğme değil) ve en çok 2 soru
// bağlantısı. Sayfa içi hedefler `?bolum=<çapa>` ile gider (lib/sectionParam.ts) ve `replace` kullanır: geçmiş kirlenmez.
// Test sözleşmeleri: bölge adı 'Sıradaki adım' ('Oylama', 'Uzlaşma turu', 'Destekçiler' içermez); kartta <button> yoktur
// ('Destekle' düğmesiyle çakışmaz); metinler düz metin olarak çizilir.
import { useId, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { nextStepHref, type NextStep, type NextStepLink, type NextStepTone } from "../../lib/nextStep";
import { routes } from "../../lib/routes";
import { cx, Icon, type IconName } from "../../ui";
import "../participation/proposal-page.css";

/** Tonun simgesi (renk her zaman simge ve metinle birlikte). */
export const NEXT_STEP_TONE_ICON: Record<NextStepTone, IconName> = {
  action: "chevronRight",
  info: "info",
  warning: "warning",
  success: "success",
  danger: "error",
  neutral: "info",
};

/** Birincil eylemin görünümü: benden bir iş bekleniyorsa ya da karar bir yere götürüyorsa dolu (birincil), değilse ikincil. */
export function nextStepCtaVariant(tone: NextStepTone): "primary" | "secondary" {
  return tone === "action" || tone === "success" ? "primary" : "secondary";
}

/** Bağlantının simgesi: sayfa içi çapa ↓; giriş, profil, konu, yönetmelik ve bilirkişi sayfaları kendi simgesiyle; diğerleri ›. */
export function nextStepLinkIcon(link: NextStepLink): IconName {
  if (link.bolum !== undefined) return "chevronDown";
  const to = link.to;
  if (to === routes.login()) return "login";
  if (to.startsWith(routes.profile())) return "user";
  if (to.startsWith(`${routes.topics()}/`)) return "topics";
  if (to.startsWith(routes.ontology())) return "book";
  if (to.startsWith(routes.experts())) return "experts";
  return "chevronRight";
}

export interface NextStepCardProps {
  proposalId: string;
  /** Motorun sonucu. null → oturum henüz yükleniyor: kart yer tutar, cümle çizilmez (yoksa anonim görünürdü). */
  step: NextStep | null;
  /** Kalan süre satırı (ör. <Countdown onDone={yenile} />); başlığın yanında durur. */
  deadline?: ReactNode;
  /** Ayrıntının altındaki zaman satırı (ör. son evre geçişinin zamanı). */
  when?: ReactNode;
  /** Ayrıntı ile bağlantılar arasındaki ek içerik (ör. aykırılık bulguları ve 'Bu ne demek?' açılırı). */
  children?: ReactNode;
  id?: string;
}

export function NextStepCard({ proposalId, step, deadline, when, children, id }: NextStepCardProps) {
  const hid = useId();
  const location = useLocation();
  const tone: NextStepTone = step?.tone ?? "neutral";
  const cta = step?.cta;
  const links = step?.links ?? [];
  return (
    <section className={cx("next-step", `next-step-${tone}`)} id={id} aria-labelledby={hid} aria-busy={step ? undefined : true}>
      <div className="next-step-head">
        <h2 className="next-step-label" id={hid}>
          Sıradaki adım
        </h2>
        {deadline ? <div className="next-step-deadline">{deadline}</div> : null}
      </div>
      {step ? (
        <>
          <p className="next-step-headline">
            <Icon name={NEXT_STEP_TONE_ICON[tone]} size={18} className="next-step-icon" />
            <span>{step.headline}</span>
          </p>
          {step.detail ? <p className="next-step-detail">{step.detail}</p> : null}
          {when}
          {children}
          {cta || links.length ? (
            <div className="next-step-actions">
              {cta ? (
                <Link
                  className={cx("btn", `btn-${nextStepCtaVariant(tone)}`, "btn-sm", "next-step-cta")}
                  to={nextStepHref(proposalId, cta)}
                  replace={cta.bolum !== undefined}
                  state={cta.to === routes.login() ? { from: location.pathname } : undefined}
                >
                  {cta.label}
                  <Icon name={nextStepLinkIcon(cta)} size={16} />
                </Link>
              ) : null}
              {links.length ? (
                <ul className="next-step-links">
                  {links.map((l) => (
                    <li key={`${l.bolum ?? l.to}`}>
                      <Link to={nextStepHref(proposalId, l)} replace={l.bolum !== undefined}>
                        {l.label}
                        <Icon name={l.bolum !== undefined ? "chevronDown" : "chevronRight"} size={14} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="next-step-detail next-step-pending">Durumunuz yükleniyor…</p>
      )}
    </section>
  );
}
