// Ana sayfa: sıra "önce senden beklenenler" — oturuma göre çağrı, bekleyen işler, hızlı eylemler, açık öneriler, topluluk durumu
// (sayaç hapları + azınlık koruması), vitrin (neyi doğrulayabilirsiniz), son yürürlüğe girenler ve sistemin temel ilkeleri.
// Ziyaretçide vitrin giriş düğmelerinin hemen altındadır. Hesap durumu (bekleyen, askıda, reddedilmiş) yalnız burada kartla
// söylenir; kabuktaki şeritler bu rotada gizlenir (layout/AppLayout).
import { Link } from "react-router-dom";
import type { DashboardTask } from "@forum/shared";
import { getDashboard } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { CountPills } from "../components/home/CountPills";
import { MinorityProtection } from "../components/home/MinorityProtection";
import { PrinciplesAccordion } from "../components/home/PrinciplesAccordion";
import { ShowcaseTiles } from "../components/home/ShowcaseTiles";
import { ProposalList } from "../components/proposals/ProposalCard";
import { routes, toAppPath } from "../lib/routes";
import { useAsync } from "../lib/useAsync";
import { Alert, Badge, Card, Countdown, EmptyState, ErrorView, LinkButton, PageHeader, Section, Spinner, type IconName, type Tone } from "../ui";

// ───────────── Oturuma göre çağrı ─────────────

function AccountCallout() {
  const auth = useAuth();
  const u = auth.user;
  if (auth.loading) return null;
  if (!u) {
    return (
      <Card tone="accent" title="Katılmak için giriş yapın ya da kayıt olun">
        <div className="stack-sm">
          <p className="mt-0">
            Tartışmaları, kararları ve defteri okumak için hesap gerekmez. Öneri açmak, desteklemek ve oy vermek için kayıt olup kimliğinizi kayıt
            memuruna doğrulatmanız gerekir. Herkese yalnızca takma adınız görünür; kimlik bilgileriniz şifreli kasada tutulur.
          </p>
          <div className="row">
            <LinkButton to={routes.login()} variant="primary" icon="login">
              Giriş yap
            </LinkButton>
            <LinkButton to={routes.register()} icon="user">
              Kayıt ol
            </LinkButton>
          </div>
        </div>
      </Card>
    );
  }
  if (u.status === "pending") {
    return (
      <Card tone="warning" title="Hesabınız doğrulama bekliyor">
        <ol className="steps mt-0">
          <li>
            <strong>Kayıt alındı.</strong> Takma adınız: @{u.nickname}
          </li>
          <li>
            <strong>Kimlik doğrulama:</strong> kayıt memuru bilgilerinizi amaç belirterek (erişim kaydıyla) inceler ve onaylar.
          </li>
          <li>
            <strong>Doğrulandıktan sonra</strong> öneri açabilir, destekleyebilir ve tartışmaya yazabilirsiniz. Oy vermek için ayrıca 18 yaşını
            doldurmuş olmanız ve siyasi görüş açık rızası vermeniz gerekir.
          </li>
        </ol>
        <p className="small muted">Bu sırada tartışmaları okuyabilir, defteri ve sayımları doğrulayabilirsiniz.</p>
        <LinkButton to={routes.profile()} size="sm" icon="user">
          Profil ve rızalar
        </LinkButton>
      </Card>
    );
  }
  if (u.status === "suspended") {
    return (
      <Alert tone="error" title="Hesabınız askıya alınmış">
        Askıdaki hesaplar öneri açamaz, destekleyemez ve oy veremez. Ayrıntılar için bildirimlerinizi kontrol edin.
      </Alert>
    );
  }
  if (u.status === "rejected") {
    // Reddedilen hesap kapalıdır: düzeltme talebi sunucuda reddedilir ve Profil'de form yoktur; çıkmaz bir yol vaat edilmez.
    return (
      <Alert tone="error" title="Kimlik doğrulamanız reddedildi">
        Bu hesapla öneri açılamaz, destek ve oy verilemez, düzeltme talebi yapılamaz. Ayrıntı için kayıt memuruyla iletişime geçin.
      </Alert>
    );
  }
  return null;
}

// ───────────── Hızlı eylemler ve rıza notları (doğrulanmış üye) ─────────────

function QuickActions() {
  const auth = useAuth();
  if (auth.loading || auth.user?.status !== "verified") return null;
  return (
    <div className="row">
      <LinkButton to={routes.newProposal()} variant="primary" icon="plus">
        Yeni öneri
      </LinkButton>
      <LinkButton to={`${routes.proposals()}?sekme=oylama`} icon="vote">
        Oylamadaki öneriler
      </LinkButton>
      <LinkButton to={routes.verifyVote()} variant="ghost" icon="verify">
        Oyum kayıtlı mı?
      </LinkButton>
    </div>
  );
}

function ConsentNotes() {
  const auth = useAuth();
  const u = auth.user;
  if (auth.loading || u?.status !== "verified") return null;
  return (
    <>
      {!u.politicalConsent ? (
        <Alert tone="info" title="Oy verebilmek için siyasi görüş açık rızası gerekir">
          Oy ve görüş bildirimi özel nitelikli kişisel veridir; rızanızı <Link to={routes.profile()}>Profil</Link> sayfasından verebilir ya da geri
          alabilirsiniz. Rıza olmadan da öneri açabilir ve tartışabilirsiniz.
        </Alert>
      ) : null}
      {!u.isAdult ? (
        <Alert tone="info" title="18 yaşından küçük üyeler oy veremez">
          Öneri açabilir, destekleyebilir ve tartışmalara katılabilirsiniz.
        </Alert>
      ) : null}
    </>
  );
}

// ───────────── Bekleyen işler ─────────────

const TASK_META: Record<DashboardTask["kind"], { icon: IconName; label: string; tone: Tone }> = {
  vote: { icon: "vote", label: "Oy ver", tone: "accent" },
  sponsor: { icon: "users", label: "Destek ol", tone: "info" },
  object: { icon: "warning", label: "İtiraz hakkı", tone: "warning" },
  expert: { icon: "experts", label: "Bilirkişi görevi", tone: "accent" },
  registrar: { icon: "registrar", label: "Kayıt memuru onayı", tone: "info" },
  author: { icon: "proposals", label: "Yazar", tone: "neutral" },
  reconciliation: { icon: "users", label: "Uzlaşma", tone: "warning" },
};

function Tasks({ tasks }: { tasks: DashboardTask[] }) {
  return (
    <Card title="Bekleyen işleriniz" subtitle="Süresi en yakın olan önce." actions={tasks.length ? <Badge tone="info">{tasks.length}</Badge> : undefined}>
      {!tasks.length ? (
        <p className="muted mt-0">Şu an sizi bekleyen bir iş yok.</p>
      ) : (
        <ul className="task-list">
          {tasks.map((t, i) => {
            const m = TASK_META[t.kind] ?? TASK_META.author;
            const target = toAppPath(t.link);
            const path = target && "path" in target ? target.path : null;
            return (
              <li key={`${t.kind}-${t.link}-${i}`} className="task-item">
                <Badge tone={m.tone} icon={m.icon}>
                  {m.label}
                </Badge>
                <span className="task-title">{path ? <Link to={path}>{t.title}</Link> : t.title}</span>
                {t.dueAt ? <Countdown to={t.dueAt} prefix="Kalan" className="task-due" /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ───────────── Sayfa ─────────────

export default function HomePage() {
  const auth = useAuth();
  const { data, error, loading, reload } = useAsync(() => getDashboard(), [auth.user?.id], { pollMs: 30_000 });
  const member = !!auth.user;
  const myId = auth.user?.id ?? null;

  // Vitrin yalnız sistem bilgisine dayanır: panodan bağımsız çizilir (pano yüklenemese de görünür).
  const showcase = <ShowcaseTiles system={auth.system} dashboard={data} onRetry={() => void auth.refreshSystem()} />;

  return (
    <div className="page home">
      <PageHeader
        title="Forum Sistemi"
        docTitle="Ana sayfa"
        subtitle="Köprülü çoğunlukla karar veren, azınlığı tüketmeyen ve her adımı dağıtık defterden doğrulanabilen topluluk forumu."
      />

      <AccountCallout />
      {!member ? showcase : null}

      {loading && !data ? <Spinner block label="Pano yükleniyor…" /> : null}
      {error && !data ? <ErrorView error={error} onRetry={reload} /> : null}

      {member && data ? <Tasks tasks={data.tasks} /> : null}
      <QuickActions />
      <ConsentNotes />

      {data ? (
        <>
          <Section
            title="Açık öneriler"
            headingLevel={2}
            actions={
              <Link to={routes.proposals()} className="small">
                Tümü
              </Link>
            }
          >
            {data.open.length ? (
              <ProposalList proposals={data.open} compact myId={myId} headingLevel={3} label="Açık öneriler" />
            ) : (
              <EmptyState title="Şu an açık öneri yok" icon="proposals">
                {auth.can("V") ? <p>İlk öneriyi siz açın.</p> : <p>Yeni öneriler destekçi toplamaya başladığında burada görünür.</p>}
              </EmptyState>
            )}
          </Section>

          <Section title="Topluluk durumu" id="topluluk">
            <CountPills dashboard={data} />
            <MinorityProtection items={data.permanentLoser} />
          </Section>
        </>
      ) : null}

      {member ? showcase : null}

      {data ? (
        <Section
          title="Son yürürlüğe girenler"
          actions={
            <Link to={`${routes.proposals()}?sekme=kabul`} className="small">
              Tüm kabul edilenler
            </Link>
          }
        >
          {data.recentEnacted.length ? (
            <ProposalList proposals={data.recentEnacted} myId={myId} headingLevel={3} label="Son yürürlüğe giren öneriler" />
          ) : (
            <p className="muted">Henüz yürürlüğe giren karar yok.</p>
          )}
        </Section>
      ) : null}

      <PrinciplesAccordion />
    </div>
  );
}
