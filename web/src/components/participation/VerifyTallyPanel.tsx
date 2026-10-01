// "Sayımı kendim doğrulayayım": bülten + defter kayıtlarından KC-1.0 sayımı TARAYICIDA yeniden yapılır.
// TALLY / BALLOT_REVEAL işlemleri defterden alınır, dahil olma kanıtları cihazda sabitlenen doğrulayıcı anahtarlarıyla denetlenir,
// her açıklanan doğrudan oy defterdeki son taahhüdüyle karşılaştırılır (shared verifyTally).
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  hashCanonical,
  OUTCOME_LABELS,
  revealHash,
  verifyInclusionProof,
  verifyTally,
  type BulletinRound,
  type DecisionResult,
  type RevealEntry,
  type TallyPayload,
} from "@forum/shared";
import { errorMessage, isApiError } from "../../api/client";
import { getBulletin, getProof, getTx } from "../../api/endpoints";
import { formatNumber } from "../../lib/format";
import { routes } from "../../lib/routes";
import { describeValidatorDiff, ensurePinnedValidators, type PinnedValidators } from "../../lib/validators";
import { Alert, Button, Card, Details, HashText, Spinner } from "../../ui";
import { Tick } from "./common";

interface Step {
  label: string;
  ok: boolean | null;
  detail?: ReactNode;
}

interface RoundCheck {
  round: 1 | 2;
  ok: boolean;
  steps: Step[];
  mismatches: string[];
  recomputed: DecisionResult | null;
  bulletin: BulletinRound;
}

async function proofStep(label: string, txHash: string | null, pinned: PinnedValidators): Promise<Step> {
  if (!txHash) return { label, ok: false, detail: "Defter işlem özeti yok." };
  try {
    const proof = await getProof(txHash);
    const v = verifyInclusionProof(proof, pinned.validators);
    return {
      label,
      ok: v.ok,
      detail: v.ok ? (
        <>
          Blok <Link to={routes.block(proof.height)}>#{proof.height}</Link>, sıra {proof.index}; Merkle yolu ve {proof.header.commitSigs.length} doğrulayıcı imzası denetlendi.
        </>
      ) : (
        v.reasons.join("; ")
      ),
    };
  } catch (e) {
    return { label, ok: false, detail: isApiError(e) && e.status === 404 ? "Kanıt bulunamadı (işlem henüz bloğa girmemiş olabilir)." : errorMessage(e) };
  }
}

async function checkRound(b: BulletinRound, shown: DecisionResult | undefined, pinned: PinnedValidators): Promise<RoundCheck> {
  const steps: Step[] = [];
  let tally: TallyPayload = b.tally;
  let reveals: RevealEntry[] = b.reveals;

  // 1) Bülten ile defterdeki işlem yükleri aynı mı?
  if (b.tallyTx) {
    try {
      const tx = await getTx(b.tallyTx);
      const same = hashCanonical(tx.payload) === hashCanonical(b.tally);
      steps.push({ label: "Sayım kaydı (TALLY) defterdeki işlemle aynı", ok: same, detail: same ? undefined : "Bültendeki sayım verisi defterdekinden farklı; defterdeki kullanıldı." });
      tally = tx.payload as unknown as TallyPayload;
    } catch (e) {
      steps.push({ label: "Sayım kaydı (TALLY) defterden alındı", ok: false, detail: errorMessage(e) });
    }
  } else steps.push({ label: "Sayım kaydı (TALLY) defterde", ok: false, detail: "İşlem özeti yok." });

  if (b.revealTx) {
    try {
      const tx = await getTx(b.revealTx);
      const ledgerReveals = (tx.payload as { reveals?: RevealEntry[] }).reveals ?? [];
      const same = revealHash(ledgerReveals) === revealHash(b.reveals);
      steps.push({ label: "Açıklanan oylar (BALLOT_REVEAL) defterdeki işlemle aynı", ok: same, detail: same ? undefined : "Bültendeki açıklama listesi defterdekinden farklı; defterdeki kullanıldı." });
      reveals = ledgerReveals;
    } catch (e) {
      steps.push({ label: "Açıklanan oylar (BALLOT_REVEAL) defterden alındı", ok: false, detail: errorMessage(e) });
    }
  } else steps.push({ label: "Açıklanan oylar (BALLOT_REVEAL) defterde", ok: false, detail: "İşlem özeti yok." });

  // 2) Dahil olma kanıtları
  steps.push(await proofStep("Sayım işlemi bloğa dahil (Merkle + ≥ 2f+1 imza)", b.tallyTx, pinned));
  steps.push(await proofStep("Açıklama işlemi bloğa dahil (Merkle + ≥ 2f+1 imza)", b.revealTx, pinned));

  // 3) Yeniden sayım
  let mismatches: string[] = [];
  let recomputed: DecisionResult | null = null;
  try {
    const v = verifyTally(tally, reveals, b.commitments);
    mismatches = v.mismatches;
    recomputed = v.recomputed;
    steps.push({
      label: "KC-1.0 sayımı yeniden yapıldı; taahhütler ve özetler eşleşiyor",
      ok: v.ok,
      detail: v.ok ? `Sonuç: ${OUTCOME_LABELS[v.recomputed.outcome]} — kabul ${v.recomputed.totals.yes}, red ${v.recomputed.totals.no}, çekimser ${v.recomputed.totals.abstain}.` : `${v.mismatches.length} uyuşmazlık bulundu.`,
    });
  } catch (e) {
    mismatches = [`Yeniden sayım yapılamadı: ${errorMessage(e)}`];
    steps.push({ label: "KC-1.0 sayımı yeniden yapıldı", ok: false, detail: errorMessage(e) });
  }

  // 4) Sayfada gösterilen sonuçla karşılaştırma
  if (shown && recomputed) {
    const same = shown.outcome === recomputed.outcome && shown.inputsHash === recomputed.inputsHash;
    steps.push({
      label: "Sayfada gösterilen sonuçla aynı",
      ok: same,
      detail: same ? undefined : `Sayfa: ${OUTCOME_LABELS[shown.outcome]}, yeniden sayım: ${OUTCOME_LABELS[recomputed.outcome]}.`,
    });
  }

  return { round: b.round, ok: steps.every((s) => s.ok !== false) && mismatches.length === 0, steps, mismatches, recomputed, bulletin: b };
}

export function VerifyTallyPanel({ proposalId, results }: { proposalId: string; results: DecisionResult[] }) {
  const [running, setRunning] = useState(false);
  const [checks, setChecks] = useState<RoundCheck[] | null>(null);
  const [pinNote, setPinNote] = useState<{ tone: "info" | "warning"; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setChecks(null);
    try {
      const pin = await ensurePinnedValidators();
      setPinNote(
        pin.status === "changed"
          ? { tone: "warning", text: describeValidatorDiff(pin.diff) }
          : pin.status === "pinned_now"
            ? { tone: "info", text: `Doğrulayıcı anahtarları (${pin.pinned.validators.length}) bu cihazda ilk kez sabitlendi; sonraki doğrulamalar bu anahtarlarla yapılır.` }
            : null,
      );
      const bulletin = await getBulletin(proposalId);
      const out: RoundCheck[] = [];
      for (const b of bulletin.rounds) out.push(await checkRound(b, results.find((r) => r.round === b.round), pin.pinned));
      setChecks(out);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card title="Sayımı kendim doğrulayayım" tone="accent" headingLevel={3}>
      <div className="stack">
        <p className="small">
          Defterdeki oy açıklamaları (BALLOT_REVEAL) ve sayım kaydı (TALLY) indirilir; karar fonksiyonu tarayıcınızda aynı girdilerle yeniden çalıştırılır. Her
          açıklanan doğrudan oy, defterdeki son taahhüdüyle karşılaştırılır. Kimin hangi oyu verdiği açıklanmaz: oy pusulaları öneriye özel rastgele kimliklerle
          tutulur.
        </p>
        <div>
          <Button variant="primary" icon="verify" onClick={() => void run()} loading={running}>
            {checks ? "Yeniden doğrula" : "Sayımı kendim doğrulayayım"}
          </Button>
        </div>
        {running ? <Spinner showLabel label="Bülten indiriliyor ve sayım yeniden yapılıyor…" /> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        {pinNote ? <Alert tone={pinNote.tone}>{pinNote.text}</Alert> : null}
        {checks && checks.length === 0 ? <Alert tone="info">Henüz kesin sayım yok; bülten oylama kapanınca yayımlanır.</Alert> : null}
        {checks?.map((c) => (
          <section key={c.round} className="stack-sm verify-round" aria-label={`${c.round}. tur doğrulaması`}>
            <Alert tone={c.ok ? "success" : "error"} title={`${c.round === 1 ? "1. tur" : "Yeniden oylama"}: ${c.ok ? "sayım doğrulandı" : "doğrulama BAŞARISIZ"}`}>
              {c.recomputed ? (
                <p>
                  Yeniden hesaplanan sonuç: <strong>{OUTCOME_LABELS[c.recomputed.outcome]}</strong> · {formatNumber(c.bulletin.reveals.length)} açıklanan oy (
                  {formatNumber(c.bulletin.reveals.filter((r) => r.via === "delegated").length)} vekâletle) · {formatNumber(Object.keys(c.bulletin.commitments).length)}{" "}
                  taahhüt
                </p>
              ) : null}
            </Alert>
            <ul className="vsteps">
              {c.steps.map((s, i) => (
                <li key={i} className={s.ok === false ? "vstep vstep-fail" : s.ok ? "vstep vstep-ok" : "vstep"}>
                  <Tick ok={s.ok} />
                  <div>
                    <div>{s.label}</div>
                    {s.detail ? <div className="small muted">{s.detail}</div> : null}
                  </div>
                </li>
              ))}
            </ul>
            {c.mismatches.length ? (
              <Alert tone="error" title="Uyuşmazlıklar">
                <ul>
                  {c.mismatches.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
            <div className="small muted row">
              <span>
                Sayım işlemi <HashText hash={c.bulletin.tallyTx} chars={8} to={c.bulletin.tallyTx ? routes.tx(c.bulletin.tallyTx) : undefined} copy={false} />
              </span>
              <span>
                Açıklama işlemi <HashText hash={c.bulletin.revealTx} chars={8} to={c.bulletin.revealTx ? routes.tx(c.bulletin.revealTx) : undefined} copy={false} />
              </span>
            </div>
            {c.bulletin.commitTxs.length ? (
              <Details summary={`Oy taahhüdü işlemleri (${c.bulletin.commitTxs.length})`}>
                <ul className="commit-list small">
                  {c.bulletin.commitTxs.slice(0, 100).map((t) => (
                    <li key={t.txHash}>
                      pusula <code className="hash">{t.ballotId.slice(0, 10)}…</code> → <HashText hash={t.txHash} chars={10} to={routes.tx(t.txHash)} copy={false} />
                    </li>
                  ))}
                </ul>
                {c.bulletin.commitTxs.length > 100 ? <p className="small muted">… ve {c.bulletin.commitTxs.length - 100} işlem daha.</p> : null}
              </Details>
            ) : null}
          </section>
        ))}
        {checks && checks.length ? (
          <p className="small verify-note">
            <strong>Bu hesap sunucuya güvenmeden tarayıcınızda yapıldı.</strong> Veriler defterden alındı; işlemlerin bloklara dahil olduğu, cihazınızda sabitlenen
            doğrulayıcı anahtarlarıyla (en az 2f+1 imza) denetlendi. Kendi oyunuzun bu sayıma girdiğini “Oyum kayıtlı mı?” sayfasından doğrulayabilirsiniz.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
