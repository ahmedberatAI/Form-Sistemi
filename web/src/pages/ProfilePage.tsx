// Profilim: hesap özeti, rızalar, vekâletler, KVKK (döküm / kripto-imha), şifre değiştirme, bilirkişi durumu.
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { clusterLabel, type Me } from "@forum/shared";
import { ApiError, errorMessage } from "../api/client";
import { changePassword, eraseMe, exportMyData, getMyDelegations, listExperts, updateConsents } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { KvkkNotice } from "../components/KvkkNotice";
import { UserLink } from "../components/UserLink";
import { DomainChips } from "../components/community/DomainChips";
import { DelegationForm, OutgoingDelegations, useScopeLabel } from "../components/community/delegation";
import { ReputationBar } from "../components/community/ReputationBar";
import "../components/community/community.css";
import { downloadJson } from "../lib/download";
import { formatDate } from "../lib/format";
import { routes } from "../lib/routes";
import { useAsync } from "../lib/useAsync";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  CopyButton,
  Details,
  ErrorView,
  ExpertStatusBadge,
  Input,
  KeyValue,
  LinkButton,
  PageHeader,
  RoleBadge,
  Spinner,
  Table,
  Time,
  useConfirm,
  useToast,
  UserStatusBadge,
} from "../ui";

export default function ProfilePage() {
  const auth = useAuth();
  const me = auth.user;
  if (!me) return <Spinner block />;
  return (
    <div className="page page-narrow">
      <PageHeader title="Profilim" subtitle="Hesabınız, rızalarınız, vekâletleriniz ve kişisel verileriniz üzerindeki haklarınız." />
      {me.status === "pending" ? (
        <Alert tone="warning" title="Hesabınız doğrulama bekliyor">
          Kayıt memuru kimliğinizi doğruladığında öneri açabilir, oy verebilir ve vekâlet verebilirsiniz.
        </Alert>
      ) : null}
      <AccountCard me={me} />
      <ConsentsCard me={me} />
      <DelegationsCard />
      <ExpertStatusCard me={me} />
      <PasswordCard />
      <KvkkCard me={me} />
    </div>
  );
}

function AccountCard({ me }: { me: Me }) {
  const roles = me.roles.filter((r) => r !== "member");
  return (
    <Card title="Hesap özeti" actions={<LinkButton size="sm" variant="ghost" to={routes.user(me.id)}>Herkese açık profilim</LinkButton>}>
      <KeyValue
        items={[
          { label: "Takma ad", value: <strong>@{me.nickname}</strong> },
          { label: "Durum", value: <UserStatusBadge status={me.status} /> },
          {
            label: "Roller",
            value: roles.length ? (
              <span className="row">
                {roles.map((r) => (
                  <RoleBadge key={r} role={r} />
                ))}
              </span>
            ) : (
              "Üye"
            ),
          },
          { label: "Katılım", value: formatDate(me.joinedAt) },
          {
            label: "Görüş kümem",
            value: (
              <span className="row">
                <strong>{clusterLabel(me.clusterId ?? null)}</strong>
                <Badge tone="neutral" icon="info">
                  yalnız size gösterilir
                </Badge>
              </span>
            ),
            hint: "Kapanmış oylamalardaki oylarınıza göre (Polis benzeri kümeleme) hesaplanır. Kümeler adsızdır; köprü testinde her anlamlı kümeden asgari destek aranır.",
          },
          { label: "Oy kullanabilir mi?", value: canVote(me) ? <Badge tone="success" icon="check">Evet</Badge> : <Badge tone="warning">Hayır</Badge>, hint: voteHint(me) },
        ]}
      />
    </Card>
  );
}

const canVote = (me: Me) => me.status === "verified" && me.isAdult && me.politicalConsent;

function voteHint(me: Me): string | undefined {
  if (me.status !== "verified") return "Kimliğiniz doğrulanmadan oy kullanamazsınız.";
  if (!me.isAdult) return "Oy kullanmak için 18 yaşından büyük olmak gerekir.";
  if (!me.politicalConsent) return "Oy kullanmak için siyasi görüş verisine açık rıza vermeniz gerekir (aşağıda).";
  return undefined;
}

function ConsentsCard({ me }: { me: Me }) {
  const auth = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<"political" | "ai" | null>(null);

  const set = async (key: "political" | "ai", value: boolean) => {
    if (key === "political" && !value) {
      const ok = await confirm({
        title: "Siyasi görüş rızasını geri al",
        message: "Rızanızı geri alırsanız oy kullanamaz, itiraz imzalayamaz ve azınlık raporu yazamazsınız (bu işlemler yalnızca oy kullanabilen üyelere açıktır). Rızanızı istediğiniz zaman yeniden verebilirsiniz.",
        confirmLabel: "Rızamı geri al",
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusy(key);
    try {
      const next = await updateConsents(key === "political" ? { politicalConsent: value } : { aiConsent: value });
      auth.setUser(next);
      toast.success(value ? "Açık rızanız kaydedildi." : "Rızanız geri alındı.");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="Açık rızalar" subtitle="Rızalarınızı istediğiniz zaman verebilir ya da geri alabilirsiniz (KVKK m. 5–6).">
      <div className="stack">
        <div className="consent-box">
          <Checkbox
            label={<strong>Siyasi görüş verisi (oy ve görüş) — oy kullanmak için gerekli</strong>}
            checked={me.politicalConsent}
            disabled={busy !== null}
            onChange={(e) => void set("political", e.target.checked)}
            hint="Oy ve görüş verileriniz siyasi düşüncenizi ortaya koyabileceği için özel nitelikli kişisel veridir (KVKK m. 6) ve yalnızca açık rızanızla işlenir. Oylarınız gizli kalır: defterde yalnızca kimliksiz taahhütler bulunur."
          />
        </div>
        <div className="consent-box">
          <Checkbox
            label={<strong>Yapay zekâ analizi — varsayılan kapalı</strong>}
            checked={me.aiConsent}
            disabled={busy !== null}
            onChange={(e) => void set("ai", e.target.checked)}
            hint="Açarsanız yazdığınız öneri, mesaj ve raporlar sınıflandırma, özet ve denetim için Anthropic'in Claude modeline (ABD'deki sunucular) gönderilir; bu bir yurt dışına aktarımdır (KVKK m. 9). Gönderimden önce kişisel veriler maskelenir, takma adlar K1, K2… biçiminde değiştirilir. Kapalıyken içerikleriniz için yalnızca sunucuda çalışan kural tabanlı (çevrimdışı) analiz kullanılır. YZ yalnızca danışmandır; hiçbir kararı değiştirmez."
          />
        </div>
        {busy ? <Spinner label="Kaydediliyor…" showLabel size="sm" /> : null}
      </div>
    </Card>
  );
}

function DelegationsCard() {
  const auth = useAuth();
  const scopeLabel = useScopeLabel();
  const { data, error, loading, reload, setData } = useAsync(() => getMyDelegations(), []);
  const [formOpen, setFormOpen] = useState(false);

  return (
    <Card
      title="Vekâletler"
      subtitle="Oy vermediğiniz oylamalarda tercihinizin kime uygulanacağını belirlersiniz (likit demokrasi). Her kişi her zaman tam 1 oy sayılır."
    >
      {loading && !data ? (
        <Spinner block />
      ) : error ? (
        <ErrorView error={error} onRetry={reload} compact />
      ) : data ? (
        <div className="stack">
          <Alert tone="info">
            <strong>Doğrudan oy verirseniz vekâletiniz o oylamada askıya alınır.</strong> Kapsam sırası: önerinin kategorileri (en özelden genele), sonra genel
            (*) vekâlet; her kapsamda önce 1. sıradaki delegeye bakılır. Vekâlet sınırı: bir delege başkalarına ait en fazla <strong>{data.cap}</strong> oy
            taşıyabilir; sınırı aşan vekâletler o oylamada kullanılmaz ve size bildirim gider.
          </Alert>

          <section className="stack-sm" aria-label="Verdiğim vekâletler">
            <h3 className="h3 mt-0">Verdiğim vekâletler</h3>
            {data.outgoing.length ? (
              <OutgoingDelegations items={data.outgoing} onRevoked={(id) => setData((d) => d && { ...d, outgoing: d.outgoing.filter((x) => x.id !== id) })} />
            ) : (
              <p className="muted mt-0">Henüz vekâlet vermediniz; oy vermediğiniz oylamalarda oyunuz kullanılmamış sayılır.</p>
            )}
          </section>

          <section className="stack-sm" aria-label="Aldığım vekâletler">
            <h3 className="h3 mt-0">Aldığım vekâletler</h3>
            {data.incoming.length ? (
              <Table
                caption="Bana verilen vekâletler"
                rows={data.incoming}
                rowKey={(d) => d.id}
                columns={[
                  { key: "from", header: "Veren", render: (d) => <span className="nowrap"><UserLink id={d.from} nickname={d.fromNickname} /></span> },
                  { key: "scope", header: "Kapsam", render: (d) => scopeLabel(d.scope) },
                  { key: "rank", header: "Sıra", align: "center", render: (d) => `${d.rank}.` },
                  { key: "at", header: "Tarih", hideOnMobile: true, render: (d) => <Time at={d.createdAt} /> },
                ]}
              />
            ) : (
              <p className="muted mt-0">Size verilmiş vekâlet yok.</p>
            )}
            {data.incoming.length > data.cap ? (
              <Alert tone="warning">Size verilen vekâlet sayısı sınırı ({data.cap}) aşıyor; bir oylamada en fazla {data.cap} kişinin tercihini taşıyabilirsiniz.</Alert>
            ) : null}
          </section>

          {auth.can("V") ? (
            formOpen ? (
              <section className="stack-sm" aria-label="Yeni vekâlet">
                <h3 className="h3 mt-0">Yeni vekâlet</h3>
                <DelegationForm
                  onCreated={(d) => {
                    setFormOpen(false);
                    setData((prev) => prev && { ...prev, outgoing: [...prev.outgoing.filter((x) => !(x.scope === d.scope && x.rank === d.rank)), d] });
                  }}
                />
                <div>
                  <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>
                    Vazgeç
                  </Button>
                </div>
              </section>
            ) : (
              <div>
                <Button icon="plus" onClick={() => setFormOpen(true)}>
                  Yeni vekâlet ver
                </Button>
              </div>
            )
          ) : (
            <p className="small muted">Vekâlet vermek için kimliğinizin doğrulanmış olması gerekir.</p>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function ExpertStatusCard({ me }: { me: Me }) {
  const { data, loading } = useAsync(() => listExperts(), [me.id]);
  const own = data?.find((e) => e.userId === me.id);
  return (
    <Card title="Bilirkişilik">
      {loading && !data ? (
        <Spinner />
      ) : own ? (
        <div className="stack-sm">
          <div className="row">
            <ExpertStatusBadge status={own.status} />
            <span className="muted small">
              Aktif görev: {own.activeAssignments} · Tamamlanan rapor: {own.completedReports}
            </span>
          </div>
          <DomainChips domains={own.domains} />
          {own.status === "active" || own.status === "suspended" ? <ReputationBar value={own.reputation} /> : null}
          <div className="row">
            {own.status === "active" ? (
              <LinkButton size="sm" to="/bilirkisiler?sekme=gorevlerim">
                Görevlerim
              </LinkButton>
            ) : null}
            {own.status === "rejected" || own.status === "removed" ? (
              <LinkButton size="sm" to="/bilirkisiler?sekme=basvur">
                Yeniden başvur
              </LinkButton>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="row-between">
          <span className="muted">Bilirkişi değilsiniz.</span>
          {me.status === "verified" ? (
            <LinkButton size="sm" to="/bilirkisiler?sekme=basvur">
              Bilirkişi olarak başvur
            </LinkButton>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function PasswordCard() {
  const toast = useToast();
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [again, setAgain] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!oldPassword) errs.oldPassword = "Mevcut şifrenizi yazın.";
    if (newPassword.length < 8) errs.newPassword = "Şifre en az 8 karakter olmalıdır.";
    else if (!/\p{L}/u.test(newPassword) || !/\p{N}/u.test(newPassword)) errs.newPassword = "Şifre en az bir harf ve bir rakam içermelidir.";
    if (again !== newPassword) errs.again = "Yeni şifreler aynı değil.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await changePassword({ oldPassword, newPassword });
      toast.success("Şifreniz değiştirildi. Diğer cihazlardaki oturumlarınız kapatıldı.");
      setOld("");
      setNew("");
      setAgain("");
    } catch (err) {
      if (err instanceof ApiError && err.details && typeof err.details === "object") {
        const d = err.details as Record<string, unknown>;
        const mapped: Record<string, string> = {};
        if (typeof d.oldPassword === "string") mapped.oldPassword = d.oldPassword;
        if (typeof d.newPassword === "string") mapped.newPassword = d.newPassword;
        if (typeof d.password === "string") mapped.oldPassword = d.password;
        setErrors(mapped);
      }
      toast.error(err, "Şifre değiştirilemedi");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Şifre değiştir">
      <form className="stack" onSubmit={submit} noValidate>
        <Input label="Mevcut şifre" type="password" autoComplete="current-password" value={oldPassword} error={errors.oldPassword} onChange={(e) => setOld(e.target.value)} />
        <div className="form-grid">
          <Input
            label="Yeni şifre"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            hint="En az 8 karakter; en az bir harf ve bir rakam."
            error={errors.newPassword}
            onChange={(e) => setNew(e.target.value)}
          />
          <Input label="Yeni şifre (tekrar)" type="password" autoComplete="new-password" value={again} error={errors.again} onChange={(e) => setAgain(e.target.value)} />
        </div>
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={busy}>
            Şifreyi değiştir
          </Button>
        </div>
      </form>
    </Card>
  );
}

function KvkkCard({ me }: { me: Me }) {
  const auth = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [password, setPassword] = useState("");

  const doExport = async () => {
    setExporting(true);
    try {
      const data = await exportMyData();
      const text = JSON.stringify(data, null, 2);
      setExported(text);
      const ok = downloadJson(`kvkk-verilerim-${me.nickname}.json`, data);
      toast.success(ok ? "Veri dökümünüz indirildi." : "Döküm hazır; indirme desteklenmiyorsa aşağıdan kopyalayın.");
    } catch (e) {
      toast.error(e, "Döküm alınamadı");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card title="Kişisel verilerim (KVKK)" subtitle="6698 sayılı Kanun m. 11 kapsamındaki haklarınız.">
      <div className="stack">
        <Details summary="Aydınlatma metni">
          <KvkkNotice />
        </Details>

        <section className="stack-sm" aria-label="Veri dökümü">
          <h3 className="h3 mt-0">Verimi indir</h3>
          <p className="mt-0 small muted">Hesabınız, kimlik verileriniz (şifresi çözülmüş), rızalarınız ve platform kayıtlarınız JSON olarak indirilir. Döküm yalnızca size verilir.</p>
          <div className="row">
            <Button loading={exporting} onClick={() => void doExport()}>
              Verimi indir (JSON)
            </Button>
            {exported ? <CopyButton text={exported} label="Dökümü kopyala" /> : null}
          </div>
          {exported ? (
            <Details summary="Döküm içeriğini göster">
              <pre>{exported}</pre>
            </Details>
          ) : null}
        </section>

        <section className="stack-sm" aria-label="Hesabı sil">
          <h3 className="h3 mt-0">Hesabımı sil</h3>
          <Alert tone="warning">
            Kimlik verileriniz geri döndürülemez biçimde imha edilir (kripto-imha: size özel şifreleme anahtarı silinir). Mesajlarınız silinmez,
            “Silinmiş üye” olarak görünür; defterdeki özetler zinciri bozmadan kalır. Verdiğiniz ve size verilen vekâletler geri alınır. Bu işlem
            oylamaya konmaz.
          </Alert>
          <div>
            <Button variant="danger" onClick={() => setEraseOpen(true)}>
              Hesabımı sil…
            </Button>
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={eraseOpen}
        title="Hesabınız kalıcı olarak silinecek"
        tone="danger"
        confirmLabel="Hesabımı sil"
        requireText="SİL"
        confirmDisabled={!password}
        message={
          <p className="mt-0">
            Bu işlem geri alınamaz. Kimlik verileriniz imha edilir; mesajlarınız “Silinmiş üye” adıyla kalır. Bu işlem oylamaya konmaz.
          </p>
        }
        onClose={() => {
          setEraseOpen(false);
          setPassword("");
        }}
        onConfirm={async () => {
          try {
            await eraseMe({ confirm: "SİL", password });
          } catch (e) {
            throw new Error(e instanceof ApiError && e.code === "wrong_password" ? "Şifre hatalı." : errorMessage(e));
          }
          toast.success("Hesabınız silindi ve kimlik verileriniz imha edildi.");
          await auth.logout();
          navigate("/", { replace: true });
        }}
      >
        <Input label="Şifreniz" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </ConfirmDialog>
    </Card>
  );
}
