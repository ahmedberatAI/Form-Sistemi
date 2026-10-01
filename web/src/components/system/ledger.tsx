// Dağıtık defter bileşenleri: açıklama, doğrulayıcı kartları, blok listesi, zincir doğrulama, kurcalama/hata demosu, işlem arama.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LEDGER_TX_LABELS, type ChainVerification, type CommittedTxView, type LedgerStatus, type LedgerTxType, type ValidatorStatus } from "@forum/shared";
import { listBlocks, listTxs, repairNode, setNodeFault, tamperBlock, verifyChain } from "../../api/endpoints";
import { formatNumber } from "../../lib/format";
import { routes } from "../../lib/routes";
import { useAsync } from "../../lib/useAsync";
import { Alert, Badge, Button, Card, EmptyState, ErrorView, HashText, Input, LinkButton, Select, Spinner, Table, Time, useToast, type Tone } from "../../ui";
import { TxTypeBadge, TxTypeBadges, VerifyMark } from "./marks";
import "./system.css";

const FAULT_LABELS: Record<ValidatorStatus["fault"], { label: string; tone: Tone }> = {
  none: { label: "Normal", tone: "success" },
  crash: { label: "Çökmüş", tone: "danger" },
  byzantine: { label: "Bizans (kötü niyetli)", tone: "warning" },
};

export function LedgerExplainer() {
  return (
    <Card title="Defterde ne var, ne yok?" tone="muted">
      <div className="sy-has-list">
        <div>
          <strong>Var</strong>
          <ul>
            <li>içerik özetleri: SHA-256(tuz ‖ metin)</li>
            <li>faz geçişleri (öneri evreleri)</li>
            <li>oy taahhütleri: SHA-256(öneri ‖ tur ‖ pusula ‖ seçim ‖ tuz)</li>
            <li>oylama sonunda tek bir pusula açıklaması (pusula kimliği, seçim, tuz, küme)</li>
            <li>sayım sonucu ve girdi özetleri</li>
            <li>küme ve graf çalışma özetleri, bilirkişi kuraları</li>
            <li>yapay zekâ çıktı özetleri, yönetmelik sürüm özetleri</li>
          </ul>
        </div>
        <div>
          <strong>Yok</strong>
          <ul>
            <li>ad, soyad, T.C. kimlik no, adres, doğum tarihi, e-posta, telefon (şifreli halleri de yok)</li>
            <li>ham mesaj metni</li>
            <li>kullanıcı ile oy arasındaki bağ — pusula kimliği öneriye özel bir HMAC'tir; aynı kişinin farklı önerilerdeki oyları birbirine bağlanamaz</li>
          </ul>
        </div>
      </div>
      <p className="small muted">
        Her blok dört doğrulayıcıdan en az üçünün (2f + 1) Ed25519 imzasını taşır. Makbuzunuzla oyunuzun deftere doğru yazıldığını “Oyum kayıtlı mı?”
        sayfasından doğrulayabilirsiniz. Bu sistem düşük riskli topluluk yönetişimi içindir; siyasi seçim için değildir.
      </p>
    </Card>
  );
}

export function LedgerStatusView({ status }: { status: LedgerStatus }) {
  const n = status.validators.length;
  return (
    <div className="stack">
      {status.sameMachineNotice ? (
        <Alert tone="warning" title="Dört doğrulayıcı aynı makinede çalışıyor (demo)">
          Bu kurulumda doğrulayıcılar aynı sunucuda çalışır; bu yüzden gerçek bir dağıtık güven sağlamaz, mekanizmayı gösterir. Gerçek kullanımda her
          doğrulayıcı farklı bir kurum tarafından ayrı makinede işletilmelidir.
        </Alert>
      ) : null}
      <div className="stat-grid">
        <div className="stat">
          <span className="stat-value">{formatNumber(status.height)}</span>
          <span className="stat-label">Zincir yüksekliği</span>
        </div>
        <div className="stat">
          <span className="stat-value">{status.mempool}</span>
          <span className="stat-label">Bekleyen işlem (mempool)</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {status.quorum}/{n}
          </span>
          <span className="stat-label">İmza nisabı</span>
          <span className="stat-hint">bir blok için gereken doğrulayıcı imzası</span>
        </div>
        <div className="stat">
          <span className="stat-value">f = {status.faultTolerance}</span>
          <span className="stat-label">Hata toleransı</span>
          <span className="stat-hint">{status.faultTolerance} düğüm çökse ya da yalan söylese de zincir ilerler</span>
        </div>
        <div className="stat">
          <span className="stat-value">{status.mode === "in-process" ? "Tek süreç" : "Çok süreç"}</span>
          <span className="stat-label">Çalışma modu</span>
        </div>
      </div>
      <ValidatorCards validators={status.validators} />
    </div>
  );
}

export function ValidatorCards({ validators }: { validators: ValidatorStatus[] }) {
  return (
    <div className="sy-validators">
      {validators.map((v) => (
        <article key={v.id} className={v.healthy ? "sy-validator" : "sy-validator is-unhealthy"} aria-label={`Doğrulayıcı ${v.id}`}>
          <div className="sy-validator-head">
            <span className="sy-validator-id">{v.id}</span>
            <VerifyMark ok={v.healthy} okText="Sağlıklı" failText="Sağlıksız" />
          </div>
          <div className="row">
            <Badge tone={FAULT_LABELS[v.fault].tone}>{FAULT_LABELS[v.fault].label}</Badge>
            {v.operator ? <span className="small muted">İşleten: {v.operator}</span> : null}
          </div>
          <div className="small">
            Açık anahtar: <HashText hash={v.publicKey} chars={12} label="Açık anahtar" />
          </div>
          <div className="small">
            Yükseklik: <strong>{formatNumber(v.height)}</strong>
          </div>
          <div className="small">
            Son blok: <HashText hash={v.lastHash} chars={12} label="Son blok özeti" to={v.height > 0 ? `${routes.block(v.height)}?node=${encodeURIComponent(v.id)}` : undefined} />
          </div>
        </article>
      ))}
    </div>
  );
}

const PAGE = 15;

export function BlockList() {
  const [from, setFrom] = useState<number | undefined>(undefined);
  const { data, error, loading, reload } = useAsync(() => listBlocks({ from, limit: PAGE }), [from], { pollMs: from === undefined ? 10_000 : undefined });
  if (loading && !data) return <Spinner block label="Bloklar yükleniyor…" />;
  if (error) return <ErrorView error={error} onRetry={reload} />;
  if (!data) return null;
  const blocks = data.blocks;
  const top = data.height;
  const first = blocks[0]?.height ?? top;
  const last = blocks[blocks.length - 1]?.height ?? 1;
  return (
    <div className="stack">
      <Table
        caption="Bloklar (yeniden eskiye)"
        rows={blocks}
        rowKey={(b) => String(b.height)}
        empty={<EmptyState title="Henüz blok yok" icon="ledger" />}
        columns={[
          { key: "h", header: "Yükseklik", render: (b) => <Link to={routes.block(b.height)}>#{b.height}</Link> },
          { key: "t", header: "Zaman", render: (b) => <span className="nowrap"><Time at={b.time} /></span> },
          { key: "p", header: "Öneren", hideOnMobile: true, render: (b) => <code>{b.proposer}</code> },
          { key: "r", header: "Tur", align: "center", hideOnMobile: true, render: (b) => b.round },
          { key: "n", header: "İşlem", align: "center", render: (b) => b.txCount },
          { key: "ty", header: "İşlem türleri", render: (b) => <TxTypeBadges types={b.txTypes} /> },
        ]}
      />
      <div className="row-between">
        <span className="small muted">
          {blocks.length ? `#${first} – #${last}` : ""} · toplam yükseklik {formatNumber(top)}
        </span>
        <div className="row">
          <Button size="sm" disabled={from === undefined || first >= top} onClick={() => setFrom(Math.min(top, first + PAGE) >= top ? undefined : first + PAGE)}>
            Daha yeni
          </Button>
          <Button size="sm" disabled={last <= 1} onClick={() => setFrom(last - 1)}>
            Daha eski
          </Button>
          {from !== undefined ? (
            <Button size="sm" variant="ghost" onClick={() => setFrom(undefined)}>
              En yeni
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function VerificationResults({ results }: { results: ChainVerification[] }) {
  return (
    <ul className="list" aria-label="Düğüm doğrulama sonuçları">
      {results.map((r) => (
        <li className="list-item stack-sm" key={r.nodeId}>
          <div className="row-between">
            <span className="sy-validator-id">{r.nodeId}</span>
            <VerifyMark ok={r.ok} okText="Zincir geçerli" failText="Zincir bozuk" />
          </div>
          <span className="small muted">{formatNumber(r.checkedBlocks)} blok denetlendi</span>
          {r.errors.length ? (
            <ul className="small">
              {r.errors.slice(0, 10).map((e, i) => (
                <li key={i}>
                  <Link to={`${routes.block(e.height)}?node=${encodeURIComponent(r.nodeId)}`}>#{e.height}</Link>: {e.error}
                </li>
              ))}
              {r.errors.length > 10 ? <li>… ve {r.errors.length - 10} hata daha</li> : null}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function ChainVerifyPanel({ validators, results, onResults }: { validators: ValidatorStatus[]; results: ChainVerification[] | null; onResults: (r: ChainVerification[]) => void }) {
  const toast = useToast();
  const [node, setNode] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await verifyChain(node || undefined);
      onResults(r);
      const bad = r.filter((x) => !x.ok).length;
      if (bad) toast.warning(`${bad} düğümde zincir hatası bulundu.`);
      else toast.success("Tüm denetlenen düğümlerde zincir geçerli.");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Zincir doğrulama" subtitle="Her blok için: önceki blok özeti bağlantısı, Merkle kökü, blok özeti ve en az 2f + 1 geçerli doğrulayıcı imzası denetlenir.">
      <div className="stack">
        <div className="sy-inline-form">
          <Select label="Düğüm" value={node} onChange={(e) => setNode(e.target.value)} options={[{ value: "", label: "Tüm düğümler" }, ...validators.map((v) => ({ value: v.id, label: v.id }))]} />
          <Button variant="primary" icon="verify" loading={busy} onClick={() => void run()}>
            Zinciri doğrula
          </Button>
        </div>
        {results ? <VerificationResults results={results} /> : <p className="muted mt-0">Henüz doğrulama yapılmadı.</p>}
      </div>
    </Card>
  );
}

/** Kurcalama → ✘ → onarım → ✔ ve hata enjeksiyonu (yalnız yönetici). */
export function LedgerDemo({ status, onStatus, results, onResults }: { status: LedgerStatus; onStatus: (s: LedgerStatus) => void; results: ChainVerification[] | null; onResults: (r: ChainVerification[]) => void }) {
  const toast = useToast();
  const [node, setNode] = useState(status.validators[1]?.id ?? status.validators[0]?.id ?? "");
  const [height, setHeight] = useState(String(Math.max(1, status.height - 1)));
  const [busy, setBusy] = useState<string | null>(null);
  const [tampered, setTampered] = useState<{ node: string; height: number } | null>(null);
  const [repaired, setRepaired] = useState<ChainVerification | null>(null);
  const faultStart = useRef<{ height: number } | null>(null);
  const anyFault = status.validators.some((v) => v.fault !== "none");

  useEffect(() => {
    if (!anyFault) faultStart.current = null;
  }, [anyFault]);

  const tamper = async (e: FormEvent) => {
    e.preventDefault();
    const h = Number(height);
    if (!Number.isInteger(h) || h < 1 || h > status.height) {
      toast.warning(`1 ile ${status.height} arasında bir blok yüksekliği girin.`);
      return;
    }
    setBusy("tamper");
    setRepaired(null);
    try {
      const r = await tamperBlock({ nodeId: node, height: h });
      onResults(r);
      setTampered({ node, height: h });
      toast.warning(`${node} düğümünde #${h} bloğu kurcalandı; doğrulama sonucu aşağıda.`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const repair = async (nodeId: string) => {
    setBusy("repair");
    try {
      const r = await repairNode({ nodeId });
      setRepaired(r);
      onResults([...(results ?? []).filter((x) => x.nodeId !== r.nodeId), r].sort((a, b) => a.nodeId.localeCompare(b.nodeId)));
      if (r.ok) setTampered(null);
      toast[r.ok ? "success" : "warning"](r.ok ? `${nodeId} onarıldı; zincir yeniden geçerli.` : `${nodeId} onarılamadı.`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const fault = async (nodeId: string, f: ValidatorStatus["fault"]) => {
    setBusy(`fault-${nodeId}-${f}`);
    try {
      if (f !== "none" && !faultStart.current) faultStart.current = { height: status.height };
      const s = await setNodeFault({ nodeId, fault: f });
      onStatus(s);
      toast.info(`${nodeId}: ${FAULT_LABELS[f].label}.`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const tamperedResult = tampered ? results?.find((r) => r.nodeId === tampered.node) : null;

  return (
    <div className="stack-lg">
      <Card title="Kurcalama demosu" subtitle="Bir düğümün diskindeki bloğu değiştirmek zinciri o düğümde bozar; imzalar ve özetler bunu hemen ele verir.">
        <div className="stack">
          <ol className="sy-steps">
            <li>Düğüm ve blok yüksekliği seçip <strong>Bloğu kurcala</strong>'ya basın.</li>
            <li>Doğrulama o düğümde <span className="sy-mark sy-mark-fail">✘</span> verir.</li>
            <li>
              <strong>Düğümü onar</strong>: sağlıklı düğümlerden blokları kopyalar; doğrulama <span className="sy-mark sy-mark-ok">✔</span> olur.
            </li>
          </ol>
          <form className="sy-inline-form" onSubmit={tamper}>
            <Select label="Düğüm" value={node} onChange={(e) => setNode(e.target.value)} options={status.validators.map((v) => ({ value: v.id, label: v.id }))} />
            <Input label="Blok yüksekliği" type="number" min={1} max={status.height} value={height} onChange={(e) => setHeight(e.target.value)} />
            <Button type="submit" variant="danger" loading={busy === "tamper"} disabled={!!busy || status.height < 1}>
              Bloğu kurcala
            </Button>
          </form>
          {tampered ? (
            <Alert
              tone={tamperedResult && !tamperedResult.ok ? "error" : "info"}
              title={`${tampered.node} düğümünde #${tampered.height} kurcalandı`}
              actions={
                <Button variant="primary" size="sm" loading={busy === "repair"} disabled={!!busy} onClick={() => void repair(tampered.node)}>
                  Düğümü onar
                </Button>
              }
            >
              {tamperedResult ? (
                <>
                  Doğrulama: <VerifyMark ok={tamperedResult.ok} okText="geçerli" failText="bozuk" />
                  {tamperedResult.errors[0] ? ` — #${tamperedResult.errors[0].height}: ${tamperedResult.errors[0].error}` : null}
                </>
              ) : (
                "Doğrulama sonucunu görmek için zinciri doğrulayın."
              )}
              {" "}
              <Link to={`${routes.block(tampered.height)}?node=${encodeURIComponent(tampered.node)}`}>Kurcalanan kopyayı incele</Link>
            </Alert>
          ) : null}
          {repaired ? (
            <Alert tone={repaired.ok ? "success" : "error"} title={`${repaired.nodeId} onarımı`}>
              <VerifyMark ok={repaired.ok} okText="Zincir yeniden geçerli" failText="Zincir hâlâ bozuk" /> · {formatNumber(repaired.checkedBlocks)} blok denetlendi
            </Alert>
          ) : null}
          {results ? <VerificationResults results={results} /> : null}
        </div>
      </Card>

      <Card title="Hata enjeksiyonu" subtitle="4 doğrulayıcıyla f = 1: bir düğüm çökse ya da bizans (çelişkili imza) davransa da kalan 3 düğüm nisabı (3/4) sağlar ve bloklar üretilir.">
        <div className="stack">
          <Table
            caption="Doğrulayıcı hata durumları"
            rows={status.validators}
            rowKey={(v) => v.id}
            columns={[
              { key: "id", header: "Düğüm", render: (v) => <span className="sy-validator-id">{v.id}</span> },
              { key: "f", header: "Durum", render: (v) => <Badge tone={FAULT_LABELS[v.fault].tone}>{FAULT_LABELS[v.fault].label}</Badge> },
              { key: "h", header: "Yükseklik", align: "right", render: (v) => formatNumber(v.height) },
              {
                key: "a",
                header: "Eylem",
                render: (v) => (
                  <div className="row">
                    {(["crash", "byzantine", "none"] as const)
                      .filter((f) => f !== v.fault)
                      .map((f) => (
                        <Button key={f} size="sm" variant={f === "none" ? "primary" : "secondary"} loading={busy === `fault-${v.id}-${f}`} disabled={!!busy} onClick={() => void fault(v.id, f)}>
                          {f === "crash" ? "Çökert" : f === "byzantine" ? "Bizans yap" : "Normale döndür"}
                        </Button>
                      ))}
                  </div>
                ),
              },
            ]}
          />
          {anyFault ? (
            <Alert tone="warning" title="Hatalı düğüm var">
              <p className="mt-0">
                Zincir yüksekliği: <strong>{formatNumber(status.height)}</strong>
                {faultStart.current ? (
                  <>
                    {" "}
                    (hata enjeksiyonu anında {formatNumber(faultStart.current.height)};{" "}
                    {status.height > faultStart.current.height ? (
                      <VerifyMark ok okText={`hata sürerken ${status.height - faultStart.current.height} yeni blok üretildi`} />
                    ) : (
                      <strong>henüz yeni blok yok</strong>
                    )}
                    )
                  </>
                ) : null}
              </p>
              <p className="mt-0">
                Bloklar yalnızca yeni işlem geldiğinde üretilir. Hata sürerken bir işlem oluşturun — ör. başka bir sekmede bir öneri tartışmasına mesaj
                yazın ya da bir öneriye destek verin. Yükseklik artar; tablodaki sağlıklı düğümler ilerlerken hatalı düğüm geride kalır. Düğümü normale
                döndürünce eksik blokları diğerlerinden alarak yetişir.
              </p>
              <LinkButton size="sm" to={routes.proposals()} target="_blank" rel="noopener">
                Önerileri yeni sekmede aç
              </LinkButton>
            </Alert>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

const TX_TYPES = Object.keys(LEDGER_TX_LABELS) as LedgerTxType[];

export function TxSearch() {
  const navigate = useNavigate();
  const [hash, setHash] = useState("");
  const [type, setType] = useState<string>("");
  const [proposalId, setProposalId] = useState("");
  const [query, setQuery] = useState<{ type?: LedgerTxType; proposalId?: string }>({});
  const { data, error, loading, reload } = useAsync<CommittedTxView[]>(() => listTxs({ ...query, limit: 50 }), [query]);

  const goHash = (e: FormEvent) => {
    e.preventDefault();
    const h = hash.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(h)) return;
    navigate(routes.tx(h));
  };
  const search = (e: FormEvent) => {
    e.preventDefault();
    setQuery({ type: (type || undefined) as LedgerTxType | undefined, proposalId: proposalId.trim() || undefined });
  };
  const hashValid = /^[0-9a-f]{64}$/i.test(hash.trim());

  return (
    <div className="stack">
      <Card title="Özetle bul">
        <form className="sy-inline-form" onSubmit={goHash}>
          <Input
            label="İşlem özeti (64 onaltılık karakter)"
            value={hash}
            onChange={(e) => setHash(e.target.value)}
            className="mono"
            spellCheck={false}
            autoComplete="off"
            error={hash.trim() && !hashValid ? "Geçerli bir SHA-256 özeti değil." : undefined}
          />
          <Button type="submit" variant="primary" disabled={!hashValid}>
            Aç
          </Button>
        </form>
      </Card>
      <Card title="Türe ya da öneriye göre ara">
        <div className="stack">
          <form className="sy-inline-form" onSubmit={search}>
            <Select label="İşlem türü" value={type} onChange={(e) => setType(e.target.value)} options={[{ value: "", label: "Tüm türler" }, ...TX_TYPES.map((t) => ({ value: t, label: LEDGER_TX_LABELS[t] }))]} />
            <Input label="Öneri kimliği" value={proposalId} onChange={(e) => setProposalId(e.target.value)} spellCheck={false} autoComplete="off" />
            <Button type="submit" icon="search">
              Ara
            </Button>
          </form>
          {loading && !data ? (
            <Spinner block />
          ) : error ? (
            <ErrorView error={error} onRetry={reload} compact />
          ) : data ? (
            <Table
              caption="Bulunan işlemler (en fazla 50)"
              rows={data}
              rowKey={(t) => t.hash}
              empty={<EmptyState title="İşlem bulunamadı" />}
              columns={[
                { key: "hash", header: "Özet", render: (t) => <HashText hash={t.hash} to={routes.tx(t.hash)} /> },
                { key: "type", header: "Tür", render: (t) => <TxTypeBadge type={t.type} /> },
                { key: "h", header: "Blok", render: (t) => <Link to={routes.block(t.height)}>#{t.height}</Link> },
                { key: "i", header: "Sıra", align: "center", hideOnMobile: true, render: (t) => t.index },
                { key: "t", header: "Zaman", hideOnMobile: true, render: (t) => <Time at={t.blockTime} /> },
              ]}
            />
          ) : null}
        </div>
      </Card>
    </div>
  );
}
