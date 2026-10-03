// İşlem ayrıntısı: alanlar, yük (JSON), dahil olma kanıtının tarayıcıda doğrulanması (Merkle yolu + blok özeti + ≥ 2f+1 imza,
// cihazda sabitlenmiş doğrulayıcı anahtarlarıyla) ve işlem özetinin yeniden hesaplanması.
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ed25519Verify, hashCanonical, hexToBytes, merkleLeaf, verifyInclusionProof } from "@forum/shared";
import { getProof, getTx } from "../api/endpoints";
import { txTypeLabel, TxTypeBadge, VerifyMark } from "../components/system/marks";
import { PinNotice, usePinnedValidators } from "../components/system/pinned";
import "../components/system/system.css";
import { formatDateTime } from "../lib/format";
import { routes } from "../lib/routes";
import { useAsync } from "../lib/useAsync";
import { Alert, Card, CopyButton, ErrorView, HashText, KeyValue, PageHeader, Spinner } from "../ui";

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export default function TxPage() {
  const { hash = "" } = useParams();
  const tx = useAsync(() => getTx(hash), [hash]);
  const proof = useAsync(() => getProof(hash), [hash]);
  const pin = usePinnedValidators();
  const t = tx.data;

  const recomputed = useMemo(() => (t ? safe(() => hashCanonical({ type: t.type, payload: t.payload, nonce: t.nonce }), "") : null), [t]);
  const proofCheck = useMemo(() => {
    if (!proof.data || !pin.data) return null;
    return safe(() => verifyInclusionProof(proof.data!, pin.data!.pinned.validators), { ok: false, reasons: ["Kanıt doğrulanırken hata oluştu"] });
  }, [proof.data, pin.data]);

  // Uygulama imzası: tx.sig = Ed25519(hexToBytes(tx.hash)), cihazda sabitlenmiş uygulama anahtarıyla
  const appKey = pin.data?.pinned.appPublicKey ?? null;
  const sigOk = useMemo(() => (t && appKey ? safe(() => ed25519Verify(t.sig, hexToBytes(t.hash), appKey), false) : false), [t, appKey]);

  const payloadJson = t ? JSON.stringify(t.payload, null, 2) : "";
  const proposalId = t && typeof t.payload.proposalId === "string" ? t.payload.proposalId : null;
  const p = proof.data;

  return (
    <div className="page">
      <PageHeader
        title={t ? txTypeLabel(t.type) : "İşlem"}
        docTitle="Defter işlemi"
        meta={t ? <TxTypeBadge type={t.type} /> : null}
        subtitle={<HashText hash={hash} full label="İşlem özeti" />}
        back={{ to: `${routes.ledger()}?sekme=islemler`, label: "İşlem arama" }}
      />
      <PinNotice pin={pin.data} />
      {tx.loading && !t ? (
        <Spinner block label="İşlem yükleniyor…" />
      ) : tx.error ? (
        <ErrorView error={tx.error} onRetry={tx.reload} />
      ) : t ? (
        <>
          <Card title="Tarayıcıda doğrulama" tone={recomputed === t.hash && proofCheck?.ok ? "success" : proofCheck && !proofCheck.ok ? "danger" : "default"}>
            <ul className="list">
              <li className="list-item row-between">
                <span>İşlem özeti yeniden hesaplandı: SHA-256(kanonik {"{type, payload, nonce}"})</span>
                <VerifyMark ok={recomputed === t.hash} okText="Tutuyor" failText="Tutmuyor" />
              </li>
              <li className="list-item row-between">
                <span>Dahil olma kanıtı (Merkle yolu, blok özeti, ≥ 2f+1 doğrulayıcı imzası)</span>
                {proof.loading || pin.loading ? (
                  <Spinner label="Doğrulanıyor…" showLabel size="sm" />
                ) : proof.error ? (
                  <VerifyMark ok={null} naText="Kanıt alınamadı" />
                ) : pin.error ? (
                  <VerifyMark ok={null} naText="Anahtarlar alınamadı" />
                ) : (
                  <VerifyMark ok={proofCheck?.ok ?? null} okText="Geçerli" failText="Geçersiz" />
                )}
              </li>
            </ul>
            {proofCheck && !proofCheck.ok ? (
              <Alert tone="error" title="Kanıt doğrulanamadı" className="mt">
                <ul className="mt-0">
                  {proofCheck.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
            {proof.error ? <ErrorView error={proof.error} compact onRetry={proof.reload} /> : null}
            {recomputed && recomputed !== t.hash ? (
              <p className="small">
                Hesaplanan özet: <HashText hash={recomputed} />
              </p>
            ) : null}
          </Card>

          <Card title="İşlem alanları">
            <KeyValue
              items={[
                { label: "Tür", value: `${txTypeLabel(t.type)} (${t.type})` },
                { label: "Blok", value: <Link to={routes.block(t.height)}>#{t.height}</Link> },
                { label: "Bloktaki sıra", value: t.index },
                { label: "Blok özeti", value: <HashText hash={t.blockHash} to={routes.block(t.height)} label="Blok özeti" /> },
                { label: "Blok zamanı", value: formatDateTime(t.blockTime) },
                { label: "Gönderim zamanı", value: formatDateTime(t.submittedAt) },
                { label: "Tekilleştirme (nonce)", value: <code>{t.nonce}</code> },
                {
                  label: "Uygulama imzası",
                  value: (
                    <span className="row">
                      <HashText hash={t.sig} chars={16} label="İmza" digest={false} />
                      {appKey ? <span className="small">{sigOk ? "✔ sabitlenmiş uygulama anahtarıyla doğrulandı" : "✘ imza doğrulanamadı"}</span> : null}
                    </span>
                  ),
                  hint: "Uygulama sunucusunun işlem özeti üzerindeki Ed25519 imzası; cihazda sabitlenmiş uygulama anahtarıyla tarayıcıda doğrulanır.",
                },
                proposalId ? { label: "İlgili öneri", value: <Link to={routes.proposal(proposalId)}>Öneriyi aç</Link> } : null,
              ]}
            />
          </Card>

          <Card title="Yük (payload)" actions={<CopyButton text={payloadJson} label="JSON kopyala" />}>
            <pre className="sy-pre">{payloadJson}</pre>
            <p className="small muted mt-0">Defter yüklerinde kişisel veri ve ham metin bulunmaz; yalnızca özetler, taahhütler ve kimliksiz sayılar yer alır.</p>
          </Card>

          {p ? (
            <Card title="Dahil olma kanıtı" subtitle="Yapraktan köke Merkle yolu (RFC 6962: yaprak 0x00, iç düğüm 0x01 ön ekli SHA-256).">
              <div className="stack">
                <KeyValue
                  compact
                  items={[
                    { label: "Yaprak özeti", value: <HashText hash={p.leafHash} label="Yaprak özeti" />, hint: safe(() => merkleLeaf(p.txHash) === p.leafHash, false) ? "SHA-256(0x00 ‖ işlem özeti) ile tutuyor" : "Yaprak özeti tutmuyor" },
                    { label: "Blok / sıra", value: `#${p.height} / ${p.index}` },
                    { label: "Merkle kökü", value: <HashText hash={p.txRoot} label="Merkle kökü" /> },
                    { label: "İmza sayısı", value: `${p.header.commitSigs.length} doğrulayıcı imzası` },
                  ]}
                />
                {p.path.length ? (
                  <ol className="sy-path" aria-label="Merkle yolu">
                    {p.path.map((s, i) => (
                      <li key={i}>
                        <span className="small muted">Adım {i + 1}:</span>
                        <span className="badge badge-neutral">{s.side === "L" ? "sol kardeş" : "sağ kardeş"}</span>
                        <HashText hash={s.hash} label={`Adım ${i + 1} özeti`} />
                      </li>
                    ))}
                    <li>
                      <span className="small muted">Kök:</span>
                      <HashText hash={p.txRoot} label="Kök" />
                    </li>
                  </ol>
                ) : (
                  <p className="muted mt-0">Bu blokta tek işlem var; yaprak doğrudan köktür.</p>
                )}
              </div>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
