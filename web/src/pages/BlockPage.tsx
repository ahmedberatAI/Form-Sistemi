// Blok ayrıntısı: başlık alanları, tarayıcıda yeniden hesaplanan blok özeti ve Merkle kökü,
// her commit imzasının Ed25519 doğrulaması (cihazda sabitlenmiş anahtarlarla), işlem listesi. ?node= ile belirli düğümün kopyası.
import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { blockHash, ed25519Verify, hashCanonical, merkleRoot, precommitSignBytes, type BlockView } from "@forum/shared";
import { getBlock, getLedgerStatus } from "../api/endpoints";
import { TxTypeBadge, VerifyMark } from "../components/system/marks";
import { PinNotice, usePinnedValidators } from "../components/system/pinned";
import "../components/system/system.css";
import { formatDateTime } from "../lib/format";
import { routes } from "../lib/routes";
import { useAsync } from "../lib/useAsync";
import { Alert, Badge, Card, EmptyState, ErrorView, HashText, KeyValue, LinkButton, PageHeader, Select, Spinner, Table } from "../ui";

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export default function BlockPage() {
  const { height: hs = "" } = useParams();
  const height = Number(hs);
  const [params, setParams] = useSearchParams();
  const node = params.get("node") ?? "";
  const valid = Number.isInteger(height) && height >= 1;
  const block = useAsync(() => getBlock(height, node || undefined), [height, node], { enabled: valid });
  const prev = useAsync(() => getBlock(height - 1, node || undefined), [height, node], { enabled: valid && height > 1 });
  const status = useAsync(() => getLedgerStatus(), []);
  const pin = usePinnedValidators();

  const b = block.data;
  const validators = pin.data?.pinned.validators ?? status.data?.validators.map((v) => ({ id: v.id, publicKey: v.publicKey })) ?? null;

  const check = useMemo(() => (b ? verifyBlock(b, validators) : null), [b, validators]);
  const nodeQs = node ? `?node=${encodeURIComponent(node)}` : "";
  const top = status.data?.height ?? null;

  if (!valid) return <div className="page"><EmptyState title="Geçersiz blok yüksekliği" icon="warning" action={<LinkButton to={routes.ledger()}>Deftere dön</LinkButton>} /></div>;

  return (
    <div className="page">
      <PageHeader
        title={`Blok #${height}`}
        meta={node ? <Badge tone="info">Düğüm kopyası: {node}</Badge> : <Badge tone="neutral">Kanonik zincir</Badge>}
        back={{ to: `${routes.ledger()}?sekme=bloklar`, label: "Bloklar" }}
        actions={
          <div className="row">
            {height > 1 ? (
              <LinkButton size="sm" to={routes.block(height - 1) + nodeQs}>
                ‹ Önceki
              </LinkButton>
            ) : null}
            {top === null || height < top ? (
              <LinkButton size="sm" to={routes.block(height + 1) + nodeQs}>
                Sonraki ›
              </LinkButton>
            ) : null}
          </div>
        }
      />
      {status.data ? (
        <div style={{ maxWidth: 320 }}>
          <Select
            label="Hangi kopya?"
            value={node}
            onChange={(e) => {
              const v = e.target.value;
              setParams((p) => {
                const n = new URLSearchParams(p);
                if (v) n.set("node", v);
                else n.delete("node");
                return n;
              }, { replace: true });
            }}
            options={[{ value: "", label: "Kanonik (sağlıklı çoğunluk)" }, ...status.data.validators.map((v) => ({ value: v.id, label: `${v.id} düğümünün kopyası` }))]}
          />
        </div>
      ) : null}
      <PinNotice pin={pin.data} />

      {block.loading && !b ? (
        <Spinner block label="Blok yükleniyor…" />
      ) : block.error ? (
        <ErrorView error={block.error} onRetry={block.reload} />
      ) : b && check ? (
        <>
          <Card title="Tarayıcıda doğrulama" tone={check.allOk ? "success" : "danger"}>
            <ul className="list">
              <li className="list-item row-between">
                <span>Blok özeti yeniden hesaplandı (SHA-256, kanonik JSON)</span>
                <VerifyMark ok={check.hashOk} okText="Tutuyor" failText="Tutmuyor" />
              </li>
              <li className="list-item row-between">
                <span>İşlemlerin Merkle kökü (txRoot)</span>
                <VerifyMark ok={check.rootOk} okText="Tutuyor" failText="Tutmuyor" />
              </li>
              <li className="list-item row-between">
                <span>İşlem özetleri ({b.txs.length})</span>
                <VerifyMark ok={check.txOk} okText="Hepsi tutuyor" failText={`${check.txBad} işlem tutmuyor`} />
              </li>
              <li className="list-item row-between">
                <span>
                  Geçerli doğrulayıcı imzası ({check.validSigs}/{check.need} gerekli)
                </span>
                <VerifyMark ok={validators ? check.sigsOk : null} okText="Yeterli" failText="Yetersiz" naText="Anahtarlar yüklenmedi" />
              </li>
              {height > 1 ? (
                <li className="list-item row-between">
                  <span>Önceki blokla bağlantı (prevHash)</span>
                  <VerifyMark ok={prev.data ? prev.data.hash === b.prevHash : null} okText="Tutuyor" failText="Kopuk" naText="Önceki blok yüklenmedi" />
                </li>
              ) : null}
            </ul>
            {!check.hashOk ? (
              <Alert tone="error" className="mt">
                Başlıktaki özet ile alanlardan hesaplanan özet farklı: bu kopya değiştirilmiş (kurcalanmış) olabilir. Hesaplanan: <HashText hash={check.computed} />
              </Alert>
            ) : null}
          </Card>

          <Card title="Blok başlığı">
            <KeyValue
              items={[
                { label: "Yükseklik", value: `#${b.height}` },
                { label: "Tur", value: b.round },
                { label: "Blok özeti", value: <HashText hash={b.hash} full label="Blok özeti" /> },
                {
                  label: "Önceki blok özeti",
                  value: b.height > 1 ? <HashText hash={b.prevHash} full to={routes.block(b.height - 1) + nodeQs} label="Önceki blok özeti" /> : <HashText hash={b.prevHash} full />,
                },
                { label: "Zaman", value: formatDateTime(b.time) },
                { label: "Öneren doğrulayıcı", value: <code>{b.proposer}</code> },
                { label: "İşlem Merkle kökü", value: <HashText hash={b.txRoot} full label="Merkle kökü" /> },
                { label: "İşlem sayısı", value: b.txCount },
              ]}
            />
          </Card>

          <Card title="Commit imzaları" subtitle="Her doğrulayıcı (precommit) imzası tarayıcıda Ed25519 ile, cihazınızda sabitlenmiş açık anahtarlara karşı doğrulanır.">
            <Table
              caption="Doğrulayıcı imzaları"
              rows={check.sigs}
              rowKey={(s, i) => `${s.validator}-${i}`}
              empty={<EmptyState title="İmza yok" />}
              columns={[
                { key: "v", header: "Doğrulayıcı", render: (s) => <code>{s.validator}</code> },
                { key: "s", header: "İmza", render: (s) => <HashText hash={s.sig} chars={16} label="İmza" /> },
                { key: "ok", header: "Doğrulama", render: (s) => <VerifyMark ok={s.ok} failText={s.known ? "Geçersiz" : "Bilinmeyen anahtar"} /> },
              ]}
            />
          </Card>

          <Card title={`İşlemler (${b.txs.length})`}>
            <Table
              caption="Bloktaki işlemler"
              rows={check.txs}
              rowKey={(t) => t.hash}
              empty={<EmptyState title="Bu blokta işlem yok" />}
              columns={[
                { key: "i", header: "#", align: "center", render: (t) => t.index },
                { key: "type", header: "Tür", render: (t) => <TxTypeBadge type={t.type} /> },
                { key: "hash", header: "Özet", render: (t) => <HashText hash={t.hash} to={routes.tx(t.hash)} /> },
                { key: "ok", header: "Özet denetimi", render: (t) => <VerifyMark ok={t.ok} okText="Tutuyor" failText="Tutmuyor" /> },
              ]}
            />
          </Card>
        </>
      ) : null}
      <p className="small muted">
        <Link to={`${routes.ledger()}?sekme=dogrulama`}>Tüm zinciri doğrula</Link>
      </p>
    </div>
  );
}

function verifyBlock(b: BlockView, validators: { id: string; publicKey: string }[] | null) {
  const computed = safe(() => blockHash(b), "");
  const hashOk = computed === b.hash;
  const rootOk = safe(() => merkleRoot(b.txs.map((t) => t.hash)) === b.txRoot, false);
  const txs = b.txs.map((t, i) => ({
    index: t.index ?? i,
    type: t.type,
    hash: t.hash,
    ok: safe(() => hashCanonical({ type: t.type, payload: t.payload, nonce: t.nonce }) === t.hash, false),
  }));
  const txBad = txs.filter((t) => !t.ok).length;
  const msg = safe(() => precommitSignBytes(b.height, b.round, computed), new Uint8Array());
  const seen = new Set<string>();
  const sigs = b.commitSigs.map((s) => {
    const v = validators?.find((x) => x.id === s.validator);
    const ok = v ? ed25519Verify(s.sig, msg, v.publicKey) : false;
    if (ok && v) seen.add(v.id);
    return { ...s, ok: validators ? ok : null, known: !!v };
  });
  const n = validators?.length ?? 4;
  const need = 2 * Math.floor((n - 1) / 3) + 1;
  const sigsOk = seen.size >= need;
  return { computed, hashOk, rootOk, txs, txBad, txOk: txBad === 0, sigs, validSigs: seen.size, need, sigsOk, allOk: hashOk && rootOk && txBad === 0 && sigsOk };
}
