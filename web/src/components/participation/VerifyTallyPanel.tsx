// "Sayımı kendim doğrulayayım": KC-1.0 sayımı TARAYICIDA, sunucuya güvenmeden yeniden yapılır.
// TALLY, BALLOT_REVEAL ve her VOTE_COMMIT işlemi defterden alınır; içeriğin istenen işlem özetine ait olduğu
// (ledgerTxHash) ve dahil olma kanıtı cihazda sabitlenen doğrulayıcı anahtarlarıyla denetlenir. Sunucunun bültende
// verdiği hazır veriler yalnızca karşılaştırma için kullanılır; sayım defterden kurulan verilerle yapılır.
// Düzen: önce tek cümle, sonra düğme, sonra 'Neyi denetler?' açılırı (5 satırlık teknik giriş); çalıştırma sonrası adımlar aynen.
// Görsel dil: eylem kartı ince mavi kenarlıdır (tone="action"); hüküm rengi yalnız çalıştırma sonrası Alert'te (yeşil/kırmızı) gelir.
// Sade dil: 'Neyi denetler?' girişindeki, adım ayrıntılarındaki ve sonuç notundaki teknik terimler sözlük terimidir (Term); düğmeden
// ÖNCEKİ tek cümle (VERIFY_LEAD) ve kapalı başlıklar düz metin kalır.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { hashCanonical, OUTCOME_LABELS, revealHash, verifyTally, type BulletinRound, type DecisionResult } from "@forum/shared";
import { errorMessage } from "../../api/client";
import { getBulletin } from "../../api/endpoints";
import { formatNumber } from "../../lib/format";
import { loadRoundFromLedger, type BoundResult } from "../../lib/ledgerVerify";
import { routes } from "../../lib/routes";
import { describeValidatorDiff, ensurePinnedValidators, type PinnedValidators } from "../../lib/validators";
import { Alert, Button, Card, Details, HashText, Spinner, Term } from "../../ui";
import { Tick } from "./common";
import "./results.css";

/** Düğmenin üstündeki tek cümle (5 satırlık teknik giriş 'Neyi denetler?' açılırındadır). */
export const VERIFY_LEAD = "Bülteni defterden alıp sayımı bu cihazda yeniden yapın; sunucuya güvenmeniz gerekmez.";

interface Step {
  label: string;
  ok: boolean | null;
  detail?: ReactNode;
}

interface RoundCheck {
  round: 1 | 2;
  ok: boolean;
  /** Sayım/açıklama işlemi henüz bir bloğa girmedi (kapanıştan sonraki ~1 blok aralığı). Hata değildir. */
  pending: boolean;
  steps: Step[];
  mismatches: string[];
  recomputed: DecisionResult | null;
  bulletin: BulletinRound;
}

const PENDING_TEXT = "Henüz bloğa girmedi; defter işlemleri genellikle bir saniye içinde işler.";

function boundStep(label: string, r: BoundResult<unknown> | { state: "missing" }): Step {
  if (r.state === "missing") return { label, ok: false, detail: "Defter işlem özeti yok." };
  if (r.state === "pending") return { label, ok: null, detail: PENDING_TEXT };
  if (r.state === "fail") return { label, ok: false, detail: r.reason };
  return {
    label,
    ok: true,
    detail: (
      <>
        İçerik işlem <Term id="ozet">özetiyle</Term> eşleşti; blok <Link to={routes.block(r.height)}>#{r.height}</Link>, sıra {r.index + 1};{" "}
        <Term id="merkle-yolu">Merkle yolu</Term> ve {r.proof.header.commitSigs.length} <Term id="dogrulayici">doğrulayıcı</Term> imzası sabitlenmiş anahtarlarla denetlendi.
      </>
    ),
  };
}

async function checkRound(proposalId: string, b: BulletinRound, shown: DecisionResult | undefined, pinned: PinnedValidators): Promise<RoundCheck> {
  const steps: Step[] = [];
  const L = await loadRoundFromLedger(proposalId, b, pinned);

  // 1–2) Sayım ve açıklama işlemleri defterden, içerik-özet bağı ve dahil olma kanıtıyla
  steps.push(boundStep("Sayım kaydı (TALLY) defterden doğrulandı", L.tallyCheck));
  steps.push(boundStep("Açıklanan oylar (BALLOT_REVEAL) defterden doğrulandı", L.revealCheck));

  // 3) Oy taahhütleri: her VOTE_COMMIT işlemi tek tek doğrulanır, "pusula → son taahhüt" haritası defterden kurulur
  steps.push(
    L.commitProblems.length
      ? { label: "Oy taahhütleri defterden doğrulandı", ok: false, detail: L.commitProblems.slice(0, 5).join(" ") }
      : L.commitsPending
        ? { label: "Oy taahhütleri defterden doğrulandı", ok: null, detail: `${L.commitsPending} taahhüt işlemi henüz bloğa girmedi.` }
        : {
            label: "Oy taahhütleri defterden doğrulandı",
            ok: true,
            detail: `${formatNumber(b.commitTxs.length)} taahhüt işlemi doğrulandı; ${formatNumber(L.commitsChecked)} pusulanın son taahhüdü defterden kuruldu.`,
          },
  );

  // 4) Sunucunun bülteni defterle aynı mı? (Farklıysa sunucu yanıltmaya çalışıyor demektir; sayım yine defterle yapılır.)
  const tallySame = L.tallyCheck.state !== "ok" || hashCanonical(L.tally) === hashCanonical(b.tally);
  const revealSame = L.revealCheck.state !== "ok" || revealHash(L.reveals) === revealHash(b.reveals);
  const bulletinPending = L.tallyCheck.state === "pending" || L.revealCheck.state === "pending" || L.commitsPending > 0;
  const diffs = [!tallySame && "sayım verisi", !revealSame && "açıklama listesi", !bulletinPending && !L.bulletinCommitmentsMatch && "taahhüt haritası"].filter(Boolean);
  steps.push({
    label: "Sunucunun bülteni defterle aynı",
    ok: diffs.length ? false : bulletinPending ? null : true,
    detail: diffs.length ? `Bültendeki ${diffs.join(", ")} defterdekinden farklı; sayım defterdeki verilerle yapıldı.` : bulletinPending ? PENDING_TEXT : undefined,
  });

  // 5) Yeniden sayım — yalnızca defterden doğrulanmış verilerle
  let mismatches: string[] = [];
  let recomputed: DecisionResult | null = null;
  try {
    const v = verifyTally(L.tally, L.reveals, L.commitments);
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

  // 6) Sayfada gösterilen sonuçla karşılaştırma
  if (shown && recomputed) {
    const same = shown.outcome === recomputed.outcome && shown.inputsHash === recomputed.inputsHash;
    steps.push({
      label: "Sayfada gösterilen sonuçla aynı",
      ok: same,
      detail: same ? undefined : `Sayfa: ${OUTCOME_LABELS[shown.outcome]}, yeniden sayım: ${OUTCOME_LABELS[recomputed.outcome]}.`,
    });
  }

  return {
    round: b.round,
    ok: steps.every((s) => s.ok !== false) && mismatches.length === 0,
    pending: steps.some((s) => s.ok === null),
    steps,
    mismatches,
    recomputed,
    bulletin: b,
  };
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
      // Kapanıştan hemen sonra sayım işlemi henüz bloğa girmemiş olabilir: kısa aralıklarla birkaç kez yeniden dene.
      let out: RoundCheck[] = [];
      for (let attempt = 0; attempt < 4; attempt++) {
        const bulletin = await getBulletin(proposalId);
        out = [];
        for (const b of bulletin.rounds) out.push(await checkRound(proposalId, b, results.find((r) => r.round === b.round), pin.pinned));
        if (!out.some((c) => c.pending)) break;
        await new Promise((r) => setTimeout(r, 1200));
      }
      setChecks(out);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    // id="dogrula": "Sayımı doğrula" bağlantısının (?bolum=dogrula) hedefi; odak, kartın ilk denetimine (aşağıdaki düğmeye) gider.
    <Card title="Sayımı kendim doğrulayayım" tone="action" headingLevel={3} id="dogrula">
      <div className="stack">
        <p className="verify-lead">{VERIFY_LEAD}</p>
        <div>
          <Button variant="primary" icon="verify" onClick={() => void run()} loading={running}>
            {checks ? "Yeniden doğrula" : "Sayımı kendim doğrulayayım"}
          </Button>
        </div>
        <Details className="verify-intro" summary="Neyi denetler?">
          <p className="small">
            <Term id="dagitik-defter">Defterdeki</Term> oy açıklamaları (BALLOT_REVEAL) ve sayım kaydı (TALLY) indirilir; karar fonksiyonu tarayıcınızda aynı
            girdilerle yeniden çalıştırılır. Her açıklanan doğrudan oy, defterdeki son <Term id="taahhut">taahhüdüyle</Term> karşılaştırılır. Vekâletle
            sayılan oylar (kendisi oy vermeyenin vekâlet zinciriyle sayılan oyu) taahhütle denetlenemez: bunlar için yalnızca açıklanan oyların özetinin sayım
            kaydıyla eşleştiği ve sonucun yeniden hesaplandığı doğrulanır; vekâletle sayılan oyun hangi seçime gittiğini tarayıcınız bağımsızca kanıtlayamaz. Kimin
            hangi oyu verdiği açıklanmaz: oy pusulaları öneriye özel rastgele kimliklerle tutulur.
          </p>
        </Details>
        {running ? <Spinner showLabel label="Bülten indiriliyor ve sayım yeniden yapılıyor…" /> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        {pinNote ? <Alert tone={pinNote.tone}>{pinNote.text}</Alert> : null}
        {checks && checks.length === 0 ? <Alert tone="info">Henüz kesin sayım yok; bülten oylama kapanınca yayımlanır.</Alert> : null}
        {checks?.map((c) => (
          <section key={c.round} className="stack-sm verify-round" aria-label={`${c.round}. tur doğrulaması`}>
            <Alert
              tone={!c.ok ? "error" : c.pending ? "info" : "success"}
              title={`${c.round === 1 ? "1. tur" : "Yeniden oylama"}: ${!c.ok ? "doğrulama BAŞARISIZ" : c.pending ? "sayım hesaplandı, defter kaydı bekleniyor" : "sayım doğrulandı"}`}
            >
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
            <strong>Bu hesap sunucuya güvenmeden tarayıcınızda yapıldı.</strong> Veriler defterden alındı; işlemlerin bloklara dahil olduğu, cihazınızda sabitlenen{" "}
            <Term id="dogrulayici">doğrulayıcı</Term> anahtarlarıyla (en az <Term id="2f1">2f+1 imza</Term>) denetlendi. Kendi oyunuzun bu sayıma girdiğini “Oyum kayıtlı
            mı?” sayfasından doğrulayabilirsiniz.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
