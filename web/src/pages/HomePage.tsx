// Ana sayfa: oturum durumuna göre çağrı, sistem şeridi (simüle saat, YZ kipi, defter, yönetmelik),
// bekleyen işler, pano (evrelere göre öneriler, konu/üye sayıları, kalıcı kaybeden küme göstergesi),
// açık ve son yürürlüğe giren öneriler, sistemin temel ilkeleri.
import { Link } from "react-router-dom";
import type { Dashboard, DashboardTask, ProposalStatus } from "@forum/shared";
import { getDashboard } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { ProposalList } from "../components/proposals/ProposalCard";
import { formatDateTime, formatDuration, formatNumber, formatPercent } from "../lib/format";
import { useNow } from "../lib/hooks";
import { routes, toAppPath } from "../lib/routes";
import { useAsync } from "../lib/useAsync";
import {
  Alert,
  Badge,
  Button,
  Card,
  Countdown,
  EmptyState,
  ErrorView,
  Icon,
  LinkButton,
  PageHeader,
  ProgressBar,
  Section,
  Spinner,
  Stat,
  StatGrid,
  type IconName,
  type Tone,
} from "../ui";

// ───────────── İlkeler ─────────────

const PRINCIPLES: { title: string; text: string; to: string; link: string; icon: IconName }[] = [
  {
    title: "Çoğunluk gerekir ama yetmez — köprü testi",
    text: "Bir öneri genel onayın yanında, anlamlı büyüklükteki her görüş kümesinden de asgari destek almalıdır. Taban aşılamazsa sonuç “tartışmalı” olur ve uzlaşma turu açılır.",
    to: routes.graph(),
    link: "Görüş kümelerini gör",
    icon: "graph",
  },
  {
    title: "Azınlığın gücü erteleyicidir, tek seferliktir",
    text: "Kabul edilen bir karara karşı oy veren azınlık, kararı bir kez durdurup uzlaşma turu başlatabilir. Yeniden oylamada nitelikli çoğunluk (2/3, bazı kararlarda 3/4) kesin sonucu verir.",
    to: `${routes.proposals()}?sekme=itiraz`,
    link: "İtiraz ve uzlaşmadaki öneriler",
    icon: "users",
  },
  {
    title: "Bazı haklar oylanamaz",
    text: "Değiştirilemez maddelere dokunan öneriler oylamaya hiç girmeden geçersiz sayılır. Temel bir hakkı kısıtlayan öneriler daha yüksek eşik ve bilirkişi görüşü ister.",
    to: routes.ontology(),
    link: "Yönetmeliği oku",
    icon: "book",
  },
  {
    title: "Tartışma silinmez, yalnızca karartılır",
    text: "Silme talebi de oylanır; kabul edilirse mesaj gizlenir ve yerinde mezar taşı kalır. Görüş ayrılığı hiçbir zaman silme gerekçesi olamaz.",
    to: `${routes.proposals()}?sekme=tumu&tur=deletion`,
    link: "Silme taleplerini gör",
    icon: "topics",
  },
  {
    title: "Oy gizli, sayım herkese açık — kendiniz doğrulayın",
    text: "Oyunuz deftere yalnızca bir taahhüt (özet) olarak yazılır. Makbuzunuzla oyunuzun sayıldığını doğrulayabilir, bültenden sayımı kendiniz yeniden hesaplayabilirsiniz.",
    to: routes.verifyVote(),
    link: "Oyum kayıtlı mı?",
    icon: "verify",
  },
  {
    title: "YZ ve bilirkişi danışmandır",
    text: "Yapay zekâ özet, sınıflandırma ve köprü taslakları önerir; bilirkişiler kurayla seçilip rapor yazar. Hiçbiri durum değiştirmez; YZ çıktıları her zaman etiketlenir, bilirkişinin oyu 1'dir.",
    to: routes.experts(),
    link: "Bilirkişiler",
    icon: "ai",
  },
  {
    title: "Kişisel veri defterde yok",
    text: "Dağıtık defterde ad, T.C. kimlik no, adres ya da ham mesaj metni bulunmaz; yalnızca özetler ve taahhütler vardır. Kimlik bilgileri şifreli kasadadır ve yalnızca kayıt memuru amaç belirterek görebilir.",
    to: routes.ledger(),
    link: "Defteri incele",
    icon: "ledger",
  },
  {
    title: "Vekâlet sınırlıdır, herkes bir kez sayılır",
    text: "Oyunuzu güvendiğiniz bir üyeye devredebilirsiniz; doğrudan oyunuz her zaman önceliklidir. Bir delege yalnızca sınırlı sayıda başkasının tercihini taşıyabilir.",
    to: routes.profile(),
    link: "Vekâletlerim",
    icon: "vote",
  },
];

function Principles() {
  return (
    <Section title="Temel ilkeler" description="Çoğunluğun azınlığı tüketmemesi, azınlığın da kararı süresiz engelleyememesi için tasarlanan kurallar.">
      <ul className="principles">
        {PRINCIPLES.map((p) => (
          <li key={p.title} className="principle">
            <div className="principle-head">
              <span className="principle-icon" aria-hidden="true">
                <Icon name={p.icon} size={20} />
              </span>
              <h3 className="principle-title">{p.title}</h3>
            </div>
            <p className="principle-text">{p.text}</p>
            <Link to={p.to} className="principle-link">
              {p.link} <Icon name="chevronRight" size={14} />
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ───────────── Sistem şeridi ─────────────

function scaleText(scale: number): string {
  if (!scale || scale === 1) return "gerçek zamanlı";
  const sec = 3600 / scale;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : formatNumber(n, 1));
  return sec >= 60 ? `demo: 1 saat = ${fmt(sec / 60)} dakika` : `demo: 1 saat = ${fmt(sec)} saniye`;
}

function SystemStrip({ dashboard }: { dashboard: Dashboard | undefined }) {
  const auth = useAuth();
  const now = useNow(1000);
  const s = auth.system;
  if (!s) {
    return (
      <div className="sys-strip sys-strip-empty" role="status">
        <span className="small muted">Sistem bilgisi alınamadı.</span>
        <Button size="sm" variant="ghost" icon="refresh" onClick={() => void auth.refreshSystem()}>
          Yenile
        </Button>
      </div>
    );
  }
  const ledger = s.ledger ?? dashboard?.ledger;
  const ledgerOk = ledger ? ledger.healthy >= ledger.validators : true;
  return (
    <section className="sys-strip" aria-label="Sistem durumu">
      <div className="sys-item">
        <span className="sys-label">
          <Icon name="clock" size={14} /> Simüle saat
        </span>
        <span className="sys-value">
          <time dateTime={new Date(now).toISOString()}>{formatDateTime(now, true)}</time>
        </span>
        <span className="sys-hint">
          {scaleText(s.timeScale)}
          {s.clockOffsetMs > 0 ? ` · yönetici ${formatDuration(s.clockOffsetMs, false)} ileri aldı` : ""}
        </span>
      </div>
      <div className="sys-item">
        <span className="sys-label">
          <Icon name="ai" size={14} /> Yapay zekâ
        </span>
        <span className="sys-value">
          {s.aiMode === "claude" ? <Badge tone="accent">Claude</Badge> : <Badge tone="neutral">Çevrimdışı</Badge>}
        </span>
        <span className="sys-hint">{s.aiMode === "claude" ? s.aiModel : "kural tabanlı sezgisel mod"} · danışma niteliğinde</span>
      </div>
      {ledger ? (
        <Link className="sys-item sys-link" to={routes.ledger()}>
          <span className="sys-label">
            <Icon name="ledger" size={14} /> Defter
          </span>
          <span className="sys-value">{formatNumber(ledger.height)}. blok</span>
          <span className={ledgerOk ? "sys-hint" : "sys-hint sys-warn"}>
            {ledger.healthy}/{ledger.validators} doğrulayıcı sağlıklı
          </span>
        </Link>
      ) : null}
      <Link className="sys-item sys-link" to={routes.ontology()}>
        <span className="sys-label">
          <Icon name="book" size={14} /> Yönetmelik
        </span>
        <span className="sys-value">sürüm {s.bylawVersion}</span>
        <span className="sys-hint">ontoloji ile denetlenir</span>
      </Link>
      <div className="sys-item">
        <span className="sys-label">
          <Icon name="users" size={14} /> Üyeler
        </span>
        <span className="sys-value">{formatNumber(s.members.verified)} doğrulanmış</span>
        <span className="sys-hint">{formatNumber(s.members.pending)} doğrulama bekliyor · v{s.version}</span>
      </div>
    </section>
  );
}

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
    return (
      <Alert tone="error" title="Kimlik doğrulamanız reddedildi">
        Bilgilerinizi düzelterek kayıt memuruna yeniden başvurabilirsiniz.
      </Alert>
    );
  }
  if (u.status !== "verified") return null;
  return (
    <div className="stack-sm">
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
    </div>
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

// ───────────── Pano ─────────────

const PHASES: { label: string; statuses: ProposalStatus[]; tab: string; tone: Tone }[] = [
  { label: "Destek bekleyen", statuses: ["sponsoring"], tab: "destek", tone: "info" },
  { label: "Tartışmada", statuses: ["deliberation"], tab: "tartisma", tone: "info" },
  { label: "Oylamada", statuses: ["voting", "revote"], tab: "oylama", tone: "accent" },
  { label: "İtiraz ve uzlaşma", statuses: ["objection_window", "reconciliation"], tab: "itiraz", tone: "warning" },
  { label: "Kabul edilen", statuses: ["enacted"], tab: "kabul", tone: "success" },
  { label: "Reddedilen / aykırı", statuses: ["rejected", "inadmissible"], tab: "red", tone: "danger" },
];

const LOSER_WARN_SHARE = 0.75;
const LOSER_MIN_DECISIONS = 3;

function LoserIndicator({ items }: { items: Dashboard["permanentLoser"] }) {
  const warn = items.filter((x) => x.decisions >= LOSER_MIN_DECISIONS && x.lostShare >= LOSER_WARN_SHARE);
  return (
    <Card title="Çoğunluk tiranlığı erken uyarısı" subtitle="Kalıcı kaybeden küme göstergesi" tone={warn.length ? "warning" : "default"}>
      <div className="stack-sm">
        <p className="small mt-0">
          Her görüş kümesi için, sonuçlanan kararların yüzde kaçında kümenin kendi çoğunluğunun aksi yönünde karar çıktığını gösterir. Bir küme
          sürekli kaybediyorsa çoğunluk azınlığı tüketiyor olabilir. Gösterge yalnızca bilgi içindir; hiçbir kararı değiştirmez.
        </p>
        {!items.length ? (
          <p className="muted small mt-0">Henüz görüş kümesi oluşmadı ya da sonuçlanan karar yok.</p>
        ) : (
          <ul className="loser-list">
            {items.map((x) => {
              const isWarn = warn.includes(x);
              return (
                <li key={x.clusterId}>
                  <div className="row-between">
                    <strong>{x.label}</strong>
                    {isWarn ? (
                      <Badge tone="danger" icon="warning">
                        Uyarı
                      </Badge>
                    ) : x.decisions < LOSER_MIN_DECISIONS ? (
                      <Badge tone="neutral">Yetersiz veri</Badge>
                    ) : (
                      <Badge tone="success">Olağan</Badge>
                    )}
                  </div>
                  <ProgressBar
                    label="Kaybedilen karar payı"
                    value={x.lostShare}
                    valueText={`${formatPercent(x.lostShare)} · ${x.decisions} karar`}
                    tone={isWarn ? "danger" : x.lostShare >= 0.5 ? "warning" : "success"}
                    marker={LOSER_WARN_SHARE}
                    markerLabel={`Uyarı eşiği ${formatPercent(LOSER_WARN_SHARE)}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {warn.length ? (
          <Alert tone="warning" title="Bir görüş kümesi kararların çoğunda kaybediyor">
            Köprü testi, azınlık itirazı ve uzlaşma turları bu kümenin sesini korumak içindir. Tartışmalarda bu kümenin görüşlerini aramak ve köprü kuran
            metinler önermek dengeyi güçlendirir.
          </Alert>
        ) : null}
        <Link to={routes.graph()} className="small">
          Görüş kümelerini ve grafı incele
        </Link>
      </div>
    </Card>
  );
}

function Board({ d }: { d: Dashboard }) {
  const sum = (ss: ProposalStatus[]) => ss.reduce((n, s) => n + (d.counts[s] ?? 0), 0);
  const open = sum(["sponsoring", "deliberation", "voting", "objection_window", "reconciliation", "revote"]);
  return (
    <Section title="Pano" description="Evrelere göre öneriler ve topluluğun genel durumu.">
      <StatGrid>
        <Stat label="Açık öneri" value={formatNumber(open)} tone="info" to={routes.proposals()} />
        {PHASES.map((p) => (
          <Stat key={p.tab} label={p.label} value={formatNumber(sum(p.statuses))} tone={p.tone} to={`${routes.proposals()}?sekme=${p.tab}`} />
        ))}
        <Stat label="Yürürlükteki konu" value={formatNumber(d.topics)} to={routes.topics()} />
        <Stat label="Doğrulanmış üye" value={formatNumber(d.members.verified)} hint={`${formatNumber(d.members.pending)} doğrulama bekliyor`} />
      </StatGrid>
    </Section>
  );
}

// ───────────── Sayfa ─────────────

export default function HomePage() {
  const auth = useAuth();
  const { data, error, loading, reload } = useAsync(() => getDashboard(), [auth.user?.id], { pollMs: 30_000 });
  const member = !!auth.user;
  const myId = auth.user?.id ?? null;

  return (
    <div className="page home">
      <PageHeader
        title="Forum Sistemi"
        docTitle="Ana sayfa"
        subtitle="Köprülü çoğunlukla karar veren, azınlığı tüketmeyen ve her adımı dağıtık defterden doğrulanabilen topluluk forumu."
      />

      <SystemStrip dashboard={data} />
      <AccountCallout />

      {!member ? <Principles /> : null}

      {loading && !data ? <Spinner block label="Pano yükleniyor…" /> : null}
      {error && !data ? <ErrorView error={error} onRetry={reload} /> : null}

      {data ? (
        <>
          {member ? <Tasks tasks={data.tasks} /> : null}
          <Board d={data} />
          <div className="grid-2">
            <LoserIndicator items={data.permanentLoser} />
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
          </div>
          <Section
            title="Son yürürlüğe girenler"
            actions={
              <Link to={`${routes.proposals()}?sekme=kabul`} className="small">
                Tüm kabul edilenler
              </Link>
            }
          >
            {data.recentEnacted.length ? (
              <ProposalList proposals={data.recentEnacted} compact myId={myId} headingLevel={3} label="Son yürürlüğe giren öneriler" />
            ) : (
              <p className="muted">Henüz yürürlüğe giren karar yok.</p>
            )}
          </Section>
        </>
      ) : null}

      {member ? <Principles /> : null}
    </div>
  );
}
