// Üye profili (herkese açık): yalnızca takma ad ve kamusal bilgiler. Kişisel veri ASLA gösterilmez.
// Doğrulanmış üyeler takip edebilir, kefil olabilir, vekâlet verebilir ve (gizli) yakınlık beyan edebilir.
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { PublicProfile, RelateRequest, VouchRequest } from "@forum/shared";
import { followUser, getUser, relateUser, unfollowUser, unrelateUser, unvouchUser, vouchUser } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { DomainChips } from "../components/community/DomainChips";
import { DelegationForm, OutgoingDelegations } from "../components/community/delegation";
import { ReputationBar } from "../components/community/ReputationBar";
import "../components/community/community.css";
import { formatDate, proposalRef } from "../lib/format";
import { routes } from "../lib/routes";
import { useAction, useAsync } from "../lib/useAsync";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorView,
  KeyValue,
  LinkButton,
  PageHeader,
  RadioGroup,
  RoleBadge,
  Spinner,
  Stat,
  StatusBadge,
  useConfirm,
  UserStatusBadge,
} from "../ui";

type VouchLevel = VouchRequest["level"];
type RelationKind = RelateRequest["kind"];

const VOUCH_OPTIONS: { value: VouchLevel; label: string; hint: string }[] = [
  { value: "close", label: "Yakından tanıyorum", hint: "Uzun süredir, yüz yüze tanıdığım biri; gerçek ve tek bir kişi olduğundan eminim (güçlü kefalet)." },
  { value: "known", label: "Tanıyorum", hint: "Tanıdığım biri; gerçek bir kişi olduğunu düşünüyorum." },
  { value: "just_met", label: "Yeni tanıştım", hint: "Kısa süre önce tanıştım; zayıf kefalet." },
  { value: "suspicious", label: "Şüpheli", hint: "Bu hesabın sahte ya da aynı kişinin ikinci hesabı olabileceğinden şüpheleniyorum (sahte hesap tespitine sinyal verir)." },
];

const RELATION_LABELS: Record<RelationKind, string> = { family: "Aile", business: "İş", household: "Aynı hane" };

export default function UserPage() {
  const { id = "" } = useParams();
  const auth = useAuth();
  const { data: p, error, loading, reload, setData } = useAsync(() => getUser(id), [id, auth.user?.id]);

  if (loading && !p) return <Spinner block label="Profil yükleniyor…" />;
  if (error) return <ErrorView error={error} onRetry={reload} />;
  if (!p) return null;

  const isSelf = p.viewer?.isSelf ?? auth.user?.id === p.id;
  const erased = p.status === "erased";
  const canAct = auth.can("V") && !isSelf && !erased;
  const roles = p.roles.filter((r) => r !== "member");

  return (
    <div className="page">
      <PageHeader
        title={erased ? "Silinmiş üye" : `@${p.nickname}`}
        docTitle={erased ? "Silinmiş üye" : `@${p.nickname}`}
        meta={
          <>
            <UserStatusBadge status={p.status} />
            {roles.map((r) => (
              <RoleBadge key={r} role={r} />
            ))}
            {p.isExpert ? (
              <Badge tone="neutral" icon="experts">
                Bilirkişi
              </Badge>
            ) : null}
          </>
        }
        back={{ label: "Geri" }}
      />
      {isSelf ? (
        <Alert tone="info" title="Bu sizin herkese açık profiliniz" actions={<LinkButton size="sm" to={routes.profile()}>Profilime git</LinkButton>}>
          Diğer üyeler yalnızca bu sayfadaki bilgileri görür. Rızalarınızı, vekâletlerinizi ve kişisel verilerinizi Profil sayfasından yönetin.
        </Alert>
      ) : null}
      {erased ? (
        <Alert tone="info">Bu üyenin kişisel verileri kendi talebiyle imha edildi (kripto-imha). Mesajları “Silinmiş üye” adıyla görünür.</Alert>
      ) : null}

      <div className="split">
        <div className="stack">
          <Card title="Profil">
            <div className="stack">
              <KeyValue
                items={[
                  { label: "Katılım tarihi", value: formatDate(p.joinedAt) },
                  p.isExpert ? { label: "Bilirkişi alanları", value: <DomainChips domains={p.expertDomains} /> } : null,
                  p.isExpert ? { label: "Bilirkişi itibarı", value: <ReputationBar value={p.reputation} /> } : null,
                ]}
              />
              <div className="cm-stat-grid">
                <Stat label="Öneri" value={p.stats.proposals} />
                <Stat label="Kabul edilen" value={p.stats.enacted} tone="success" />
                <Stat label="Mesaj" value={p.stats.messages} />
                <Stat label="Takipçi" value={p.stats.followers} />
                <Stat label="Takip ettiği" value={p.stats.following} />
                <Stat label="Kefil olan" value={p.stats.vouchedBy} />
                <Stat label="Vekâlet veren" value={p.stats.delegatorsCount} hint="aktif" />
              </div>
            </div>
          </Card>

          <Card title="Son öneriler">
            {p.recentProposals.length ? (
              <ul className="list">
                {p.recentProposals.map((s) => (
                  <li className="list-item" key={s.id}>
                    <div className="row-between">
                      <Link to={routes.proposal(s.id)}>
                        <span className="muted">{proposalRef(s.seq)}</span> {s.title}
                      </Link>
                      <StatusBadge status={s.status} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Henüz öneri yok" icon="proposals" />
            )}
          </Card>
        </div>

        <div className="stack">
          {canAct && p.viewer ? (
            <RelationsPanel p={p} onUpdate={setData} />
          ) : !auth.user ? (
            <Card title="Etkileşim" tone="muted">
              <p className="mt-0">Takip etmek, kefil olmak ya da vekâlet vermek için giriş yapın.</p>
              <LinkButton to={routes.login()} state={{ from: routes.user(p.id) }} variant="primary" size="sm">
                Giriş yap
              </LinkButton>
            </Card>
          ) : !isSelf && !erased ? (
            <Card title="Etkileşim" tone="muted">
              <p className="mt-0">Takip, kefalet ve vekâlet yalnızca kimliği doğrulanmış üyelere açıktır.</p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RelationsPanel({ p, onUpdate }: { p: PublicProfile; onUpdate: (x: PublicProfile) => void }) {
  const viewer = p.viewer!;
  const follow = useAction(() => (viewer.following ? unfollowUser(p.id) : followUser(p.id)), {
    success: () => (viewer.following ? "Takipten çıkıldı." : `@${p.nickname} takip ediliyor.`),
    onSuccess: onUpdate,
  });
  const confirm = useConfirm();
  const [level, setLevel] = useState<VouchLevel | null>(viewer.vouched);
  const vouch = useAction((l: VouchLevel) => vouchUser(p.id, l), { success: "Kefaletiniz kaydedildi.", onSuccess: onUpdate });
  const unvouch = useAction(() => unvouchUser(p.id), {
    success: "Kefaletiniz geri alındı.",
    onSuccess: (x) => {
      onUpdate(x);
      setLevel(null);
    },
  });
  const [kind, setKind] = useState<RelationKind | null>(null);
  const relate = useAction((k: RelationKind) => relateUser(p.id, k), {
    success: "Yakınlık beyanınız kaydedildi.",
    onSuccess: (x) => {
      onUpdate(x);
      setKind(null);
    },
  });
  const unrelate = useAction((k: RelationKind) => unrelateUser(p.id, k), { success: "Yakınlık beyanınız geri alındı.", onSuccess: onUpdate });
  // Sunucu eskiyse relatedByMe gelmeyebilir: o durumda tüm beyanlar kendi beyanı sayılır (sunucu yine yalnız kendininkini geri alır).
  const mine = viewer.relatedByMe ?? viewer.related;
  const theirs = viewer.related.filter((r) => !mine.includes(r));
  const [delegating, setDelegating] = useState(false);
  const targetVerified = p.status === "verified";

  const confirmUnvouch = async () => {
    const ok = await confirm({
      title: "Kefaletiniz geri alınsın mı?",
      message: `@${p.nickname} için verdiğiniz kefalet geri alınır. Kayıt silinmez, "geri alındı" olarak işaretlenir; sahte hesap (sybil) taramasında artık sayılmaz.`,
      confirmLabel: "Kefaleti geri al",
    });
    if (ok) await unvouch.run();
  };

  const confirmUnrelate = async (k: RelationKind) => {
    const ok = await confirm({
      title: `"${RELATION_LABELS[k]}" yakınlık beyanı geri alınsın mı?`,
      message:
        "Beyan, bilirkişi çıkar çatışması denetiminde artık kullanılmaz. Kayıt silinmez; geri alma denetim günlüğüne yazılır ve yalnız denetçi/yönetici görebilir.",
      confirmLabel: "Beyanı geri al",
      tone: "danger",
    });
    if (ok) await unrelate.run(k);
  };

  return (
    <>
      <Card title="Takip">
        <div className="stack-sm">
          <p className="mt-0 small muted">Takip ilişkisi herkese açık grafta görünür; bilirkişi kurasında yumuşak çıkar çatışması olarak değerlendirilir.</p>
          <div>
            <Button variant={viewer.following ? "secondary" : "primary"} loading={follow.loading} onClick={() => void follow.run()} aria-pressed={viewer.following}>
              {viewer.following ? "Takibi bırak" : "Takip et"}
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Kefil ol" subtitle="Kefalet, her kişinin tek hesapla katıldığına dair topluluk güvenidir; sahte hesap (sybil) tespitinde kullanılır.">
        <div className="stack-sm">
          <RadioGroup<VouchLevel> label="Bu kişiyi ne kadar tanıyorsunuz?" value={level} onChange={setLevel} options={VOUCH_OPTIONS} />
          {viewer.vouched ? (
            <p className="small muted mt-0">Mevcut kefaletiniz: {VOUCH_OPTIONS.find((o) => o.value === viewer.vouched)?.label}</p>
          ) : null}
          <div className="row">
            <Button
              variant="primary"
              loading={vouch.loading}
              disabled={!level || level === viewer.vouched || unvouch.loading}
              onClick={() => level && void vouch.run(level)}
            >
              {viewer.vouched ? "Kefaleti güncelle" : "Kefil ol"}
            </Button>
            {viewer.vouched ? (
              <Button variant="ghost" icon="close" loading={unvouch.loading} disabled={vouch.loading} onClick={() => void confirmUnvouch()}>
                Kefaletimi geri al
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <Card title="Vekâlet ver" subtitle="Oy vermediğiniz oylamalarda bu üyenin tercihi sizin için uygulanır; doğrudan oy verirseniz vekâlet askıya alınır.">
        <div className="stack">
          {viewer.delegations.length ? (
            <OutgoingDelegations
              caption={`@${p.nickname} için verdiğim vekâletler`}
              items={viewer.delegations}
              showDelegate={false}
              onRevoked={(id) => onUpdate({ ...p, viewer: { ...viewer, delegations: viewer.delegations.filter((d) => d.id !== id) } })}
            />
          ) : null}
          {!targetVerified ? (
            <p className="small muted mt-0">Vekâlet yalnızca kimliği doğrulanmış üyelere verilebilir.</p>
          ) : delegating ? (
            <>
              <DelegationForm
                target={{ id: p.id, nickname: p.nickname }}
                onCreated={(d) => {
                  setDelegating(false);
                  onUpdate({ ...p, viewer: { ...viewer, delegations: [...viewer.delegations.filter((x) => !(x.scope === d.scope && x.rank === d.rank)), d] } });
                }}
              />
              <div>
                <Button size="sm" variant="ghost" onClick={() => setDelegating(false)}>
                  Vazgeç
                </Button>
              </div>
            </>
          ) : (
            <div>
              <Button icon="plus" onClick={() => setDelegating(true)}>
                Vekâlet ver
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card title="Yakınlık beyanı" tone="muted">
        <div className="stack-sm">
          <p className="mt-0 small">
            <strong>Bilirkişi çıkar çatışması için; herkese açık değildir.</strong> Beyanınız yalnızca bilirkişi kurasında kullanılır: öneri yazarıyla aile, iş ya
            da hane yakınlığı (3 adıma kadar) olan bilirkişi o öneriye seçilmez. Profilde ve grafta diğer üyelere gösterilmez.
          </p>
          {mine.length ? (
            <ul className="list" aria-label="Beyan ettiğiniz yakınlıklar">
              {mine.map((r) => (
                <li key={r} className="list-item row-between">
                  <span className="small">
                    Beyanınız: <Badge tone="neutral">{RELATION_LABELS[r]}</Badge>
                  </span>
                  <Button size="sm" variant="ghost" icon="close" loading={unrelate.loading} onClick={() => void confirmUnrelate(r)}>
                    Geri al
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {theirs.length ? (
            <p className="mt-0 small muted">
              @{p.nickname} de sizinle yakınlık beyan etmiş ({theirs.map((r) => RELATION_LABELS[r]).join(", ")}); bu beyanı yalnızca beyan eden geri alabilir.
            </p>
          ) : null}
          <RadioGroup<RelationKind>
            label="Yakınlık türü"
            value={kind}
            onChange={setKind}
            layout="inline"
            options={(Object.keys(RELATION_LABELS) as RelationKind[]).map((k) => ({ value: k, label: RELATION_LABELS[k], disabled: viewer.related.includes(k) }))}
          />
          <div>
            <Button loading={relate.loading} disabled={!kind} onClick={() => kind && void relate.run(kind)}>
              Beyan et
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}
