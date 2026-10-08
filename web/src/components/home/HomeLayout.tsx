// Ana sayfanın düzeni (veri almaz; pages/HomePage oturumu, panoyu ve makbuz sayısını verir). Role göre "senden beklenenler":
// - Üye: selam ve tek satır canlı özet → hesap durumu (doğrulanmamışsa) → 'Sizi bekleyenler' (yoksa role göre ipucu) → oy hakkı
//   notu → hızlı eylemler → şu an açık (ilgi profili varsa kişisel sırada, gerekçe çipleriyle; 'Sizi bekleyenler' bundan etkilenmez)
//   → son kararlar; yan sütunda topluluk durumu ve vitrin; en altta tam genişlikte 8 ilke.
// - Ziyaretçi: başlık, slogan, giriş/kayıt → vitrin → şu an açık → son kararlar → topluluk durumu → ilkeler.
// Masaüstünde (≥ 900 px, `wide`) .split: solda işler ve listeler, sağda önce vitrin sonra topluluk durumu (vitrinin tamamı ilk
// ekrana sığar); hızlı eylemler selamın sağına geçer. Öğeler DOM'da da oraya taşınır (iki kopya yok, CSS order yok), böylece odak
// sırası her genişlikte görsel sırayla aynı kalır. Telefonda üyenin sırası: topluluk durumu → vitrin.
// Yükleme: oturum gelene kadar başlık yeri tutulur; Spinner yalnız liste alanındadır.
import type { Dashboard, Me, SystemInfo } from "@forum/shared";
import { ErrorView, Section, Spinner } from "../../ui";
import { AccountStatus } from "./AccountStatus";
import { CountPills } from "./CountPills";
import { Greeting, greetingSummary } from "./Greeting";
import { MinorityProtection } from "./MinorityProtection";
import { OpenNow, openCount } from "./OpenNow";
import { PrinciplesAccordion } from "./PrinciplesAccordion";
import { QuickActions } from "./QuickActions";
import { RecentDecisions } from "./RecentDecisions";
import { SetupNotes } from "./SetupNotes";
import { ShowcaseTiles } from "./ShowcaseTiles";
import { RoleHint, roleHint, TaskList } from "./TaskList";
import "./home.css";

export type HomePermission = "V" | "R" | "D" | "A";

export interface HomeLayoutProps {
  /** Oturum henüz yükleniyor (auth.loading) */
  authLoading: boolean;
  user: Me | null;
  can: (perm: HomePermission) => boolean;
  /** Sunucu sistem bilgisi (vitrin) */
  system: SystemInfo | null;
  /** Pano; gelmeden undefined */
  data: Dashboard | undefined;
  /** Pano ilk kez yükleniyor */
  dataLoading: boolean;
  dataError: unknown;
  onReload: () => void;
  onRetrySystem: () => void;
  /** Bu cihazdaki makbuz sayısı (üye); okunmadan null */
  receipts: number | null;
  /** Masaüstü düzeni (≥ 900 px) */
  wide: boolean;
}

export function HomeLayout({ authLoading, user, can, system, data, dataLoading, dataError, onReload, onRetrySystem, receipts, wide }: HomeLayoutProps) {
  const member = !authLoading && !!user;
  const visitor = !authLoading && !user;
  const myId = user?.id ?? null;
  const voting = data ? (data.counts.voting ?? 0) + (data.counts.revote ?? 0) : null;
  const open = data ? openCount(data.counts) : null;
  const tasks = data?.tasks ?? [];

  const quickActions = member ? (
    <QuickActions
      placement={wide ? "head" : "flow"}
      canPropose={can("V")}
      voting={voting}
      receipts={receipts}
      registrar={can("R")}
      auditor={can("D")}
      pendingMembers={data?.members.pending ?? system?.members.pending ?? null}
    />
  ) : null;

  // Vitrin yalnız sistem bilgisine dayanır: panodan bağımsız çizilir (pano yüklenemese de görünür).
  const showcase = <ShowcaseTiles system={system} dashboard={data} onRetry={onRetrySystem} />;
  const community = data ? (
    <Section title="Topluluk durumu" id="topluluk">
      <CountPills dashboard={data} />
      <MinorityProtection items={data.permanentLoser} />
    </Section>
  ) : null;

  return (
    <div className="page home">
      <Greeting
        user={member ? user : null}
        loading={authLoading}
        summary={data && voting !== null && open !== null ? greetingSummary({ tasks: tasks.length, voting, open }) : null}
        actions={wide ? quickActions : undefined}
      />

      <div className="split home-split">
        <div className="home-main">
          {member ? <AccountStatus user={user} /> : null}
          {member && data ? (
            tasks.length ? (
              <TaskList tasks={tasks} />
            ) : (
              <RoleHint hint={roleHint({ admin: can("A"), member: can("V"), open, deliberation: data.counts.deliberation ?? 0 })} />
            )
          ) : null}
          {member ? <SetupNotes user={user} /> : null}
          {!wide ? quickActions : null}

          {visitor ? showcase : null}

          {authLoading || (dataLoading && !data) ? <Spinner block label="Pano yükleniyor…" /> : null}
          {dataError && !data ? <ErrorView error={dataError} onRetry={onReload} /> : null}
          {data ? (
            <>
              <OpenNow open={data.open} total={open ?? 0} myId={myId} personalized={member && !!data.openPersonalized} />
              <RecentDecisions items={data.recentEnacted} myId={myId} />
            </>
          ) : null}
        </div>

        <div className="home-side">
          {member && wide ? showcase : null}
          {community}
          {member && !wide ? showcase : null}
        </div>
      </div>

      <PrinciplesAccordion />
    </div>
  );
}
