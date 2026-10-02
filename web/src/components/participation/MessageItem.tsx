// Tek bir tartışma mesajı: yazar, tutum, zaman, sürüm geçmişi, katılıyorum/katılmıyorum, köprü skoru,
// YZ moderasyon uyarısı (danışma), defter kaydı, gizlenmiş (mezar taşı + tek cevap) ve daraltılmış durumlar.
import { useEffect, useId, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { HiddenMessageResponse, MessageVersionView, MessageView } from "@forum/shared";
import { endorseMessage, getHiddenMessage, getMessageVersions, postRebuttal } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { useOntology } from "../../lib/categories";
import { proposalRef } from "../../lib/format";
import { routes } from "../../lib/routes";
import { useAction } from "../../lib/useAsync";
import { AiLabel, Alert, Badge, Button, cx, Details, DiffView, DropdownMenu, ErrorView, HashText, Spinner, StanceBadge, Textarea, Time, useConfirm, useToast } from "../../ui";
import { UserLink } from "../UserLink";
import { Composer } from "./Composer";
import { fmtDecimal, messageAnchorId, PlainText } from "./common";
import { shouldLoadVersions } from "./messageVersions";

export const BRIDGE_EXPLANATION =
  "Köprü skoru: farklı görüş gruplarından destek. Her anlamlı görüş grubunda (1 + katılan) / (2 + katılan + katılmayan) hesaplanır; en düşük grup değeri gösterilir. Yüksek skor, mesajın yalnızca bir kesimce değil farklı görüştekilerce de benimsendiğini gösterir.";

export const DELETION_RULES =
  "Tartışmalar silinmez: kabul edilirse mesaj karartılır, yerinde mezar taşı kalır ve asıl metin yalnızca denetçiye (erişim kaydıyla) açık olur. Talep destekçi toplar ve oylamaya gider. Görüş ayrılığı silme gerekçesi olamaz; yalnızca kişisel veri ifşası, tehdit, hakaret/iftira, nefret söylemi, spam ya da telif ihlali gerekçe olabilir.";

/**
 * Denetçi görünümü: gizlenen mesajın TÜM sürümleri, özgün (ilk) metin önce. Yazar silme talebi sürerken mesajını
 * yumuşatmış olabilir; asıl metin denetçiye açık kalır (ALGORITMA.md §10.5). Son sürüm gizlendiği andaki metindir.
 */
function HiddenVersions({ hidden }: { hidden: HiddenMessageResponse }) {
  const versions = hidden.versions.slice().sort((a, b) => a.version - b.version);
  if (versions.length <= 1) return <PlainText text={versions[0]?.body ?? hidden.body} />;
  const last = versions[versions.length - 1].version;
  return (
    <div className="stack-sm">
      <p className="small mt-0">
        Bu mesajın {versions.length} sürümü var; özgün metin önce gösterilir. Son sürüm, mesajın gizlendiği andaki metnidir.
      </p>
      <ol className="msg-version-list">
        {versions.map((v, i) => {
          const prev = i > 0 ? versions[i - 1] : null;
          return (
            <li key={v.version} className="stack-sm">
              <p className="small">
                <strong>Sürüm {v.version}</strong>
                {i === 0 ? " · özgün metin" : ""}
                {v.version === last ? " · gizlendiği andaki metin" : ""} · <Time at={v.createdAt} mode="both" /> · özet{" "}
                <HashText hash={v.contentHash} chars={8} copy={false} />
              </p>
              <PlainText text={v.body} className="msg-version-body" />
              {prev ? (
                <Details summary={`Sürüm ${prev.version} → ${v.version} farkı`}>
                  <DiffView before={prev.body} after={v.body} mode="inline" label={`Sürüm ${prev.version} → ${v.version} farkı`} />
                </Details>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export interface MessageItemProps {
  message: MessageView;
  /** Derin yanıtlarda "↳ @takma-ad" göstermek için */
  parentNickname?: string | null;
  focused?: boolean;
  /** Bekleyen silme talebinin numarası (#K-n), biliniyorsa */
  deletionSeq?: number | null;
  onUpdate: (m: MessageView) => void;
  onReply?: (m: MessageView) => void;
  /** Yanıt kapalıysa (ör. arşiv) false */
  canReply?: boolean;
}

export function MessageItem({ message: m, parentNickname, focused, deletionSeq, onUpdate, onReply, canReply = true }: MessageItemProps) {
  const auth = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { contentLabel } = useOntology();
  const headId = useId();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<MessageVersionView[] | null>(null);
  const [versionsError, setVersionsError] = useState<unknown>(null);
  const [rebuttalOpen, setRebuttalOpen] = useState(false);
  const [rebuttal, setRebuttal] = useState("");
  const [hidden, setHidden] = useState<HiddenMessageResponse | null>(null);

  const mine = !!auth.user && auth.user.id === m.authorId;
  const isHidden = m.visibility === "hidden" || m.visibility === "sealed";
  const isCollapsed = m.visibility === "collapsed";
  const showBody = !isHidden && (!isCollapsed || expanded);

  const endorse = useAction((value: -1 | 0 | 1) => endorseMessage(m.id, value), { onSuccess: onUpdate });
  const addRebuttal = useAction(() => postRebuttal(m.id, rebuttal.trim()), {
    success: "Cevabınız eklendi. Bu cevap karartılamaz.",
    onSuccess: (r) => {
      setRebuttalOpen(false);
      setRebuttal("");
      onUpdate(r);
    },
  });
  const readHidden = useAction(() => getHiddenMessage(m.id), { onSuccess: setHidden });

  const toggleVersions = () => {
    if (versionsOpen) setVersionsError(null); // kapatıp açınca hata sonrası yeniden denenir
    setVersionsOpen(!versionsOpen);
  };

  // Panel açıkken sürümler sıfırlanırsa (düzenleme sonrası) yeniden iste; yoksa gösterge sonsuza dek döner (bulgu #127).
  useEffect(() => {
    if (!shouldLoadVersions(versionsOpen, versions, versionsError)) return;
    let cancelled = false;
    getMessageVersions(m.id).then(
      (v) => {
        if (!cancelled) setVersions(v);
      },
      (e: unknown) => {
        if (!cancelled) setVersionsError(e);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [versionsOpen, versions, versionsError, m.id, m.version]);

  const openDeletion = async () => {
    const ok = await confirm({ title: "Silme (karartma) talebi aç", message: DELETION_RULES, confirmLabel: "Talep formuna git" });
    if (ok) navigate(routes.newProposal({ kind: "deletion", messageId: m.id }));
  };

  const askReadHidden = async () => {
    const ok = await confirm({
      title: "Gizlenmiş metni oku",
      message: "Bu erişim denetim günlüğüne kaydedilir (kim, ne zaman, hangi mesaj). Yalnızca denetim amacıyla okuyun; metni başka yerde paylaşmayın.",
      confirmLabel: "Oku (erişim kaydedilsin)",
    });
    if (ok) void readHidden.run();
  };

  const toggleEndorse = (v: 1 | -1) => {
    if (!auth.user) {
      toast.info("Katılım bildirmek için giriş yapın.");
      return;
    }
    void endorse.run(m.endorsements.mine === v ? 0 : v);
  };

  const canEndorse = auth.can("V") && !mine && !isHidden;
  const endorseTitle = !auth.user
    ? "Giriş yapın"
    : !auth.can("V")
      ? "Yalnızca doğrulanmış üyeler katılım bildirebilir"
      : mine
        ? "Kendi mesajınıza katılım bildiremezsiniz"
        : undefined;

  const deletionLabel = m.pendingDeletionProposalId ? (deletionSeq ? `silme talebi ${proposalRef(deletionSeq)}` : "silme talebi") : null;

  return (
    <article id={messageAnchorId(m.id)} className={cx("msg", `msg-${m.visibility}`, focused && "msg-focus", mine && "msg-mine")} aria-labelledby={headId}>
      <header className="msg-head" id={headId}>
        <UserLink id={m.authorId} nickname={m.authorNickname} />
        <StanceBadge stance={m.stance} />
        {parentNickname ? <span className="small muted msg-reply-to">↳ @{parentNickname} yanıtı</span> : null}
        <Time at={m.createdAt} className="small muted" />
        {m.version > 1 ? (
          <Badge tone="neutral" title={`Son düzenleme: ${new Date(m.updatedAt).toLocaleString("tr-TR")}`}>
            düzenlendi · sürüm {m.version}
          </Badge>
        ) : null}
        <span className="msg-seq small muted">#{m.seq}</span>
      </header>

      {isHidden ? (
        <div className="msg-tombstone" tabIndex={-1}>
          <p className="msg-tombstone-text">{m.tombstone ?? "[Bu mesaj karar ile gizlendi]"}</p>
          <p className="small muted">
            Mesaj silinmedi: asıl metin yalnızca denetçiye açıktır ve her erişim kayıt altına alınır.
            {m.visibility === "sealed" ? " Kişisel veri içerdiği için mühürlendi." : ""}
            {m.hiddenByProposalId ? (
              <>
                {" "}
                <Link to={routes.proposal(m.hiddenByProposalId)}>Kararı görüntüle</Link>
              </>
            ) : null}
          </p>
          {m.rebuttal ? (
            <div className="msg-rebuttal">
              <p className="small">
                <strong>Yazarın cevabı</strong> · <Time at={m.rebuttal.at} /> · <span className="muted">karartılamaz</span>
              </p>
              <PlainText text={m.rebuttal.body} />
            </div>
          ) : mine ? (
            rebuttalOpen ? (
              <form
                className="stack-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addRebuttal.run();
                }}
              >
                <Textarea
                  label="Cevabınız (yalnızca bir kez eklenebilir)"
                  hint="10–2000 karakter. Bu metin karartılamaz; kişisel veri içeremez."
                  value={rebuttal}
                  onChange={(e) => setRebuttal(e.target.value)}
                  maxLength={2000}
                  showCount
                  rows={3}
                />
                <div className="form-actions">
                  <Button variant="ghost" onClick={() => setRebuttalOpen(false)}>
                    Vazgeç
                  </Button>
                  <Button type="submit" variant="primary" loading={addRebuttal.loading} disabled={rebuttal.trim().length < 10}>
                    Cevabı ekle
                  </Button>
                </div>
              </form>
            ) : (
              <Button size="sm" onClick={() => setRebuttalOpen(true)}>
                Cevap ekle (bir kez)
              </Button>
            )
          ) : null}
          {auth.can("D") ? (
            hidden ? (
              <Alert tone="warning" title="Gizli metin (erişiminiz kaydedildi)" onClose={() => setHidden(null)}>
                <HiddenVersions hidden={hidden} />
              </Alert>
            ) : (
              <Button size="sm" variant="ghost" icon="warning" onClick={() => void askReadHidden()} loading={readHidden.loading}>
                Gizli metni oku (erişim kaydedilir)
              </Button>
            )
          ) : null}
        </div>
      ) : null}

      {isCollapsed ? (
        <div className="msg-collapsed-bar">
          <p className="small">
            <strong>Gözden geçiriliyor</strong> —{" "}
            {m.pendingDeletionProposalId ? <Link className="nowrap" to={routes.proposal(m.pendingDeletionProposalId)}>{deletionLabel}</Link> : "silme talebi"}. Acil gerekçeli talep nedeniyle karar çıkana kadar
            katlandı (gizlenmedi).
          </p>
          <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setExpanded((x) => !x)} icon={expanded ? "chevronDown" : "chevronRight"}>
            {expanded ? "Katla" : "Mesajı göster"}
          </Button>
        </div>
      ) : null}

      {showBody ? (
        editing ? (
          <Composer
            threadType={m.threadType}
            threadId={m.threadId}
            mode="edit"
            message={m}
            autoFocus
            onCancel={() => setEditing(false)}
            onDone={(nm) => {
              setEditing(false);
              setVersions(null);
              onUpdate(nm);
            }}
          />
        ) : (
          <>
            <PlainText text={m.body} className="msg-body" />
            {m.pendingDeletionProposalId && !isCollapsed ? (
              <p className="small">
                <Badge tone="warning" icon="warning">
                  Hakkında açık silme talebi var
                </Badge>{" "}
                <Link className="nowrap" to={routes.proposal(m.pendingDeletionProposalId)}>{deletionLabel}</Link> — karar oylamayla verilir; mesaj o zamana kadar görünür kalır.
              </p>
            ) : null}
            {m.aiFlag ? (
              <AiLabel className="msg-aiflag" hideNote>
                <p className="small">
                  <strong>YZ uyarısı · içerik gizlenmedi.</strong>{" "}
                  {m.aiFlag.labels.length ? `Olası sorun: ${m.aiFlag.labels.map(contentLabel).join(", ")}.` : "Olası üslup sorunu."} (risk {m.aiFlag.risk}/3) Yalnızca
                  danışma niteliğindedir; mesajı yalnızca üyelerin oyladığı bir silme kararı gizleyebilir.
                </p>
              </AiLabel>
            ) : null}
          </>
        )
      ) : null}

      {!isHidden && (!isCollapsed || expanded) && !editing ? (
        <div className="msg-actions">
          <div className="msg-endorse" role="group" aria-label="Katılım bildirimi">
            <Button
              size="sm"
              variant={m.endorsements.mine === 1 ? "primary" : "secondary"}
              aria-pressed={m.endorsements.mine === 1}
              disabled={!canEndorse || endorse.loading}
              title={endorseTitle}
              onClick={() => toggleEndorse(1)}
            >
              Katılıyorum <span className="msg-count">{m.endorsements.agree}</span>
            </Button>
            <Button
              size="sm"
              variant={m.endorsements.mine === -1 ? "primary" : "secondary"}
              aria-pressed={m.endorsements.mine === -1}
              disabled={!canEndorse || endorse.loading}
              title={endorseTitle}
              onClick={() => toggleEndorse(-1)}
            >
              Katılmıyorum <span className="msg-count">{m.endorsements.disagree}</span>
            </Button>
          </div>
          {m.bridgingScore !== null ? (
            <span className="msg-bridge" title={BRIDGE_EXPLANATION}>
              <span className="msg-bridge-meter" aria-hidden="true">
                <span style={{ width: `${Math.round(Math.max(0, Math.min(1, m.bridgingScore)) * 100)}%` }} />
              </span>
              Köprü skoru {fmtDecimal(m.bridgingScore)}
              <span className="sr-only"> — farklı görüş gruplarından destek</span>
            </span>
          ) : null}
          <div className="msg-buttons">
            {onReply && canReply && auth.can("V") ? (
              <Button size="sm" variant="ghost" onClick={() => onReply(m)}>
                Yanıtla
              </Button>
            ) : null}
            {mine ? (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Düzenle
              </Button>
            ) : null}
            <DropdownMenu
              label="Diğer"
              ariaLabel={`Mesaj #${m.seq} için diğer işlemler`}
              buttonClassName="btn btn-ghost btn-sm"
              items={[
                m.version > 1 ? { label: versionsOpen ? "Sürüm geçmişini kapat" : `Sürüm geçmişi (${m.version})`, icon: "clock", onClick: toggleVersions } : null,
                { label: "Silme talebi aç", icon: "warning", onClick: () => void openDeletion() },
                m.ledgerTx ? { label: "Defter kaydını aç", icon: "ledger", to: routes.tx(m.ledgerTx) } : null,
              ]}
            />
          </div>
        </div>
      ) : null}

      {versionsOpen ? (
        <div className="msg-versions">
          {versionsError ? <ErrorView error={versionsError} compact /> : null}
          {!versions && !versionsError ? <Spinner label="Sürümler yükleniyor…" /> : null}
          {versions ? (
            <ol className="msg-version-list">
              {versions
                .slice()
                .reverse()
                .map((v) => {
                  const prev = versions.find((x) => x.version === v.version - 1);
                  return (
                    <li key={v.version} className="stack-sm">
                      <p className="small">
                        <strong>Sürüm {v.version}</strong> · <Time at={v.createdAt} mode="both" /> · özet <HashText hash={v.contentHash} chars={8} copy={false} />
                      </p>
                      {prev ? (
                        <DiffView before={prev.body} after={v.body} mode="inline" label={`Sürüm ${prev.version} → ${v.version} farkı`} />
                      ) : (
                        <PlainText text={v.body} className="msg-version-body" />
                      )}
                    </li>
                  );
                })}
            </ol>
          ) : null}
        </div>
      ) : null}

      <footer className="msg-meta small muted">
        <span>
          İçerik özeti <HashText hash={m.contentHash} chars={8} copy={false} label="İçerik özeti" />
        </span>
        {m.ledgerTx ? (
          <span>
            Defter <HashText hash={m.ledgerTx} chars={8} copy={false} to={routes.tx(m.ledgerTx)} label="Defter işlemi" />
          </span>
        ) : (
          <span>Defter kaydı bekleniyor</span>
        )}
      </footer>
    </article>
  );
}
