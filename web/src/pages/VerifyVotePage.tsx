// "Oyum kayıtlı mı?" — cihazdaki oy makbuzuyla, sunucuya güvenmeden adım adım doğrulama:
// doğrulayıcı anahtarları (TOFU) → dahil olma kanıtı → taahhüt → son taahhüt → açıklama → sayım.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  OUTCOME_LABELS,
  VOTE_LABELS,
  verifyInclusionProof,
  verifyTally,
  voteCommitment,
  type BallotReceipt,
  type VoteChoice,
} from "@forum/shared";
import { errorMessage, isApiError } from "../api/client";
import { getBulletin, getProof, getTx, listTxs } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { Tick } from "../components/participation/common";
import { downloadText } from "../lib/download";
import { formatDateTime, proposalRef, shortHash } from "../lib/format";
import { useQueryState } from "../lib/hooks";
import { isLatest, listReceipts, saveReceipt, type StoredReceipt } from "../lib/receipts";
import { routes } from "../lib/routes";
import { useAsync } from "../lib/useAsync";
import { describeValidatorDiff, ensurePinnedValidators, type PinnedValidators } from "../lib/validators";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  CopyButton,
  cx,
  Details,
  EmptyState,
  ErrorView,
  HashText,
  KeyValue,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  Time,
  useToast,
  VoteBadge,
} from "../ui";

type StepStatus = "idle" | "running" | "ok" | "fail" | "warn" | "pending";
type StepKey = "pin" | "proof" | "commit" | "latest" | "reveal" | "tally";

interface Step {
  key: StepKey;
  title: string;
  status: StepStatus;
  detail?: ReactNode;
}

const STEP_TITLES: Record<StepKey, string> = {
  pin: "Doğrulayıcı anahtarları sabitlendi ve karşılaştırıldı",
  proof: "Oy taahhüdü bir bloğa dahil (Merkle yolu, blok özeti, ≥ 3 doğrulayıcı imzası)",
  commit: "Defterdeki taahhüt, makbuzdaki seçim ve tuzdan yeniden hesaplananla aynı",
  latest: "Bu oy pusulası için defterdeki SON taahhüt bu makbuz",
  reveal: "Oylama sonunda açıklanan oy makbuzla aynı (seçim ve tuz)",
  tally: "Sayım, açıklanan oylardan tarayıcıda yeniden yapıldı",
};

const ORDER: StepKey[] = ["pin", "proof", "commit", "latest", "reveal", "tally"];

const freshSteps = (): Step[] => ORDER.map((key) => ({ key, title: STEP_TITLES[key], status: "idle" }));

const receiptKey = (r: BallotReceipt) => `${r.proposalId}|${r.round}|${r.commitment}|${r.castAt}`;

function parseReceipt(text: string): BallotReceipt {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error("Metin geçerli bir JSON değil.");
  }
  const obj = (Array.isArray(v) ? v[0] : v) as Partial<BallotReceipt> | undefined;
  if (!obj || typeof obj !== "object") throw new Error("Makbuz nesnesi bulunamadı.");
  const missing = (["proposalId", "ballotId", "salt", "commitment"] as const).filter((k) => typeof obj[k] !== "string" || !obj[k]);
  if (missing.length) throw new Error(`Eksik alanlar: ${missing.join(", ")}`);
  if (obj.choice !== "yes" && obj.choice !== "no" && obj.choice !== "abstain") throw new Error("Seçim (choice) yes / no / abstain olmalı.");
  const round = Number(obj.round ?? 1);
  if (round !== 1 && round !== 2) throw new Error("Tur (round) 1 ya da 2 olmalı.");
  return {
    proposalId: obj.proposalId!,
    round: round as 1 | 2,
    ballotId: obj.ballotId!,
    choice: obj.choice,
    salt: obj.salt!,
    commitment: obj.commitment!,
    txHash: typeof obj.txHash === "string" ? obj.txHash : null,
    castAt: typeof obj.castAt === "number" ? obj.castAt : 0,
  };
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "running") return <span className="spinner spinner-sm" aria-label="çalışıyor" />;
  if (status === "ok") return <Tick ok label="doğrulandı" />;
  if (status === "fail") return <Tick ok={false} label="başarısız" />;
  if (status === "warn")
    return (
      <span className="tick tick-warn" title="uyarı">
        <span aria-hidden="true">⚠</span>
        <span className="sr-only">uyarı</span>
      </span>
    );
  if (status === "pending")
    return (
      <span className="tick tick-pending" title="henüz yapılamaz">
        <span aria-hidden="true">…</span>
        <span className="sr-only">henüz yapılamaz</span>
      </span>
    );
  return <Tick ok={null} label="sırada" />;
}

export default function VerifyVotePage() {
  const auth = useAuth();
  const toast = useToast();
  const [filter, setFilter] = useQueryState("oneri", "");
  const receipts = useAsync(() => listReceipts(filter || undefined), [filter, auth.user?.id]);
  const [selected, setSelected] = useState<BallotReceipt | null>(null);
  const [selectedSource, setSelectedSource] = useState<"device" | "pasted">("device");
  const [pasted, setPasted] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [tamper, setTamper] = useState(false);
  const [tamperChoice, setTamperChoice] = useState<VoteChoice>("no");
  const [steps, setSteps] = useState<Step[]>(freshSteps);
  const [running, setRunning] = useState(false);
  const [pinNote, setPinNote] = useState<string | null>(null);
  const autoRan = useRef(false);
  const runId = useRef(0);

  const list = useMemo(() => receipts.data ?? [], [receipts.data]);

  const setStep = (key: StepKey, status: StepStatus, detail?: ReactNode) =>
    setSteps((xs) => xs.map((s) => (s.key === key ? { ...s, status, detail } : s)));

  const run = async (base: BallotReceipt, tampered: boolean, fakeChoice: VoteChoice) => {
    const id = ++runId.current;
    const r: BallotReceipt = tampered ? { ...base, choice: fakeChoice } : base;
    const alive = () => id === runId.current;
    setRunning(true);
    setSteps(freshSteps());
    setPinNote(null);
    const step = (key: StepKey, status: StepStatus, detail?: ReactNode) => {
      if (alive()) setStep(key, status, detail);
    };

    // 1) Doğrulayıcı anahtarları (TOFU)
    let pinned: PinnedValidators | null = null;
    step("pin", "running");
    try {
      const pin = await ensurePinnedValidators();
      pinned = pin.pinned;
      if (pin.status === "changed") {
        step("pin", "warn", describeValidatorDiff(pin.diff));
        if (alive()) setPinNote(describeValidatorDiff(pin.diff));
      } else
        step(
          "pin",
          "ok",
          pin.status === "pinned_now"
            ? `İlk kullanım: ${pin.pinned.validators.length} doğrulayıcının açık anahtarı bu cihazda sabitlendi. Sonraki doğrulamalar bu anahtarlarla yapılır.`
            : `Sunucunun bildirdiği ${pin.fresh.validators.length} anahtar, cihazınızda sabitlenenlerle aynı (${formatDateTime(pin.pinned.pinnedAt, true)} tarihinden beri).`,
        );
    } catch (e) {
      step("pin", "fail", errorMessage(e));
    }

    // 2) Dahil olma kanıtı
    step("proof", "running");
    if (!r.txHash) step("proof", "fail", "Makbuzda defter işlem özeti (txHash) yok.");
    else if (!pinned) step("proof", "fail", "Sabitlenmiş doğrulayıcı anahtarı olmadan kanıt denetlenemez.");
    else {
      try {
        const proof = await getProof(r.txHash);
        const v = verifyInclusionProof(proof, pinned.validators);
        step(
          "proof",
          v.ok ? "ok" : "fail",
          v.ok ? (
            <>
              İşlem <Link to={routes.block(proof.height)}>blok #{proof.height}</Link> içinde {proof.index + 1}. sırada; Merkle yolu ({proof.path.length} adım) kök{" "}
              <code className="hash">{shortHash(proof.txRoot, 10)}</code> ile eşleşti, blok özeti yeniden hesaplandı, {proof.header.commitSigs.length} imza sabitlenmiş
              anahtarlarla denetlendi.
            </>
          ) : (
            v.reasons.join("; ")
          ),
        );
      } catch (e) {
        if (isApiError(e) && e.status === 404) step("proof", "pending", "İşlem henüz bir bloğa girmemiş olabilir; birkaç saniye sonra yeniden deneyin.");
        else step("proof", "fail", errorMessage(e));
      }
    }

    // 3) Taahhüt yeniden hesaplanır
    step("commit", "running");
    const computed = voteCommitment(r.proposalId, r.round, r.ballotId, r.choice, r.salt);
    if (!r.txHash) step("commit", "fail", "İşlem özeti olmadan defterdeki taahhüt okunamaz.");
    else {
      try {
        const tx = await getTx(r.txHash);
        const pl = tx.payload as { proposalId?: string; round?: number; ballotId?: string; commitment?: string };
        const problems: string[] = [];
        if (tx.type !== "VOTE_COMMIT") problems.push(`işlem türü ${tx.type}`);
        if (pl.proposalId !== r.proposalId) problems.push("öneri kimliği farklı");
        if (Number(pl.round) !== r.round) problems.push("tur farklı");
        if (pl.ballotId !== r.ballotId) problems.push("oy pusulası kimliği farklı");
        const match = pl.commitment === computed;
        if (!match) problems.push("taahhüt tutmuyor");
        step(
          "commit",
          problems.length ? "fail" : "ok",
          <>
            SHA-256(öneri ‖ tur ‖ pusula ‖ <strong>{VOTE_LABELS[r.choice]}</strong> ‖ tuz) = <code className="hash">{shortHash(computed, 12)}</code>; defterde{" "}
            <code className="hash">{shortHash(pl.commitment ?? "", 12)}</code>.
            {problems.length ? ` Sorun: ${problems.join(", ")}.` : " Eşleşiyor."}
            {tampered && !match ? " Makbuzdaki seçim değiştirildiği için taahhüt tutmadı — kurcalama yakalandı." : ""}
          </>,
        );
      } catch (e) {
        step("commit", "fail", errorMessage(e));
      }
    }

    // 4) Son taahhüt mü?
    step("latest", "running");
    try {
      const txs = await listTxs({ type: "VOTE_COMMIT", proposalId: r.proposalId, limit: 500 });
      const mine = txs
        .filter((t) => t.payload.ballotId === r.ballotId && Number(t.payload.round) === r.round)
        .sort((a, b) => a.height - b.height || a.index - b.index);
      const last = mine[mine.length - 1];
      if (!last) step("latest", r.txHash ? "pending" : "fail", "Bu oy pusulası için defterde henüz bloğa girmiş taahhüt yok.");
      else if (last.hash === r.txHash) step("latest", "ok", mine.length > 1 ? `Bu pusula için ${mine.length} taahhüt var (oy değiştirilmiş); geçerli olan en son taahhüt bu makbuzunki.` : "Bu pusula için tek taahhüt var.");
      else
        step(
          "latest",
          "fail",
          <>
            Bu makbuz geçersiz — <strong>daha yeni oyunuz var</strong>. Aynı pusula için daha sonra yazılmış bir taahhüt mevcut (
            <HashText hash={last.hash} chars={10} to={routes.tx(last.hash)} copy={false} />
            ); sayımda yalnızca en son oy geçerlidir.
          </>,
        );
    } catch (e) {
      step("latest", "fail", errorMessage(e));
    }

    // 5) Açıklama ve 6) sayım
    step("reveal", "running");
    step("tally", "running");
    try {
      const bulletin = await getBulletin(r.proposalId);
      const round = bulletin.rounds.find((x) => x.round === r.round);
      if (!round) {
        step("reveal", "pending", "Oylama henüz kapanmadı: oylar oylama bitince toplu olarak açıklanır (BALLOT_REVEAL). Sonra yeniden doğrulayın.");
        step("tally", "pending", "Sayım oylama kapanınca yapılır.");
      } else {
        const rev = round.reveals.find((x) => x.ballotId === r.ballotId);
        if (!rev) step("reveal", "fail", "Bu oy pusulası açıklanan oylar arasında yok.");
        else {
          const ok = rev.choice === r.choice && rev.salt === r.salt && round.commitments[r.ballotId] === computed;
          step(
            "reveal",
            ok ? "ok" : "fail",
            <>
              Açıklanan: <VoteBadge choice={rev.choice} /> {rev.via === "delegated" ? "(vekâletle)" : ""}; makbuz: <VoteBadge choice={r.choice} />.{" "}
              {ok ? "Seçim, tuz ve son taahhüt eşleşiyor." : "Eşleşmiyor."}
              {round.revealTx ? (
                <>
                  {" "}
                  Açıklama işlemi <HashText hash={round.revealTx} chars={8} to={routes.tx(round.revealTx)} copy={false} />
                </>
              ) : null}
            </>,
          );
        }
        try {
          const v = verifyTally(round.tally, round.reveals, round.commitments);
          step(
            "tally",
            v.ok ? "ok" : "fail",
            v.ok ? (
              <>
                Sonuç: <strong>{OUTCOME_LABELS[v.recomputed.outcome]}</strong> (kabul {v.recomputed.totals.yes}, red {v.recomputed.totals.no}, çekimser{" "}
                {v.recomputed.totals.abstain}). Ayrıntılı doğrulama için <Link to={routes.proposal(r.proposalId)}>öneri sayfasındaki</Link> “Sayımı kendim doğrulayayım”.
              </>
            ) : (
              v.mismatches.join("; ")
            ),
          );
        } catch (e) {
          step("tally", "fail", errorMessage(e));
        }
      }
    } catch (e) {
      step("reveal", "fail", errorMessage(e));
      step("tally", "fail", errorMessage(e));
    }
    if (alive()) setRunning(false);
  };

  const start = (r: BallotReceipt, source: "device" | "pasted") => {
    setSelected(r);
    setSelectedSource(source);
    if (tamper && tamperChoice === r.choice) setTamperChoice(r.choice === "no" ? "yes" : "no");
    void run(r, tamper, tamper && tamperChoice === r.choice ? (r.choice === "no" ? "yes" : "no") : tamperChoice);
  };

  // ?oneri= ile gelindiyse en son makbuzu kendiliğinden doğrula
  useEffect(() => {
    if (autoRan.current || !filter || !receipts.data || !receipts.data.length) return;
    autoRan.current = true;
    start(receipts.data[0], "device");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, receipts.data]);

  const onTamperToggle = (on: boolean) => {
    setTamper(on);
    let fake = tamperChoice;
    if (selected && fake === selected.choice) {
      fake = selected.choice === "no" ? "yes" : "no";
      setTamperChoice(fake);
    }
    if (selected) void run(selected, on, fake);
  };

  const usePasted = () => {
    setPasteError(null);
    try {
      const r = parseReceipt(pasted);
      start(r, "pasted");
    } catch (e) {
      setPasteError(errorMessage(e));
    }
  };

  const savePasted = async () => {
    if (!selected) return;
    await saveReceipt(selected);
    toast.success("Makbuz bu cihaza kaydedildi.");
    void receipts.reload();
  };

  const done = !running && steps.some((s) => s.status !== "idle");
  const failed = steps.some((s) => s.status === "fail");
  const pending = steps.some((s) => s.status === "pending");
  const listJson = JSON.stringify(list, null, 2);

  return (
    <div className="page page-narrow">
      <PageHeader
        title="Oyum kayıtlı mı?"
        subtitle="Cihazınızdaki oy makbuzuyla, oyunuzun dağıtık deftere doğru yazıldığını ve sayıma girdiğini kendiniz doğrulayın."
      />
      <Alert tone="info" title="Bu doğrulama tamamen cihazınızda yapılır">
        Sunucu sizin hangi oyu verdiğinizi bu sayfadan öğrenmez: makbuzdaki seçim ve tuz hiçbir isteğe eklenmez. Sunucudan yalnızca herkese açık defter kayıtları
        (işlem, Merkle kanıtı, bülten) indirilir; hesaplar tarayıcınızda, cihazınızda sabitlenen doğrulayıcı anahtarlarıyla yapılır.
      </Alert>

      <Card
        title="Cihazdaki makbuzlar"
        subtitle={filter ? "Bu öneriye ait makbuzlar gösteriliyor." : "Oy verdiğinizde makbuz bu cihaza kaydedilir; oy değiştirince yeni makbuz eklenir."}
        actions={
          filter ? (
            <Button size="sm" variant="ghost" onClick={() => setFilter("")}>
              Tümünü göster
            </Button>
          ) : null
        }
      >
        {receipts.loading && !receipts.data ? <Spinner /> : null}
        {receipts.error ? <ErrorView error={receipts.error} onRetry={receipts.reload} compact /> : null}
        {receipts.data && !list.length ? (
          <EmptyState title="Bu cihazda makbuz yok" icon="verify">
            <p>Oy verdiğiniz cihazda makbuzunuz saklanır. Başka bir cihazda oy verdiyseniz makbuzu aşağıya yapıştırabilirsiniz.</p>
          </EmptyState>
        ) : null}
        {list.length ? (
          <div className="stack-sm">
            <ul className="list">
              {list.map((r: StoredReceipt) => {
                const latest = isLatest(r, list);
                const active = selected && receiptKey(selected) === receiptKey(r);
                return (
                  <li key={receiptKey(r)} className={cx("list-item receipt-row", active && "receipt-active")}>
                    <div className="row-between">
                      <div className="stack-sm">
                        <Link to={routes.proposal(r.proposalId)}>
                          {r.proposalSeq ? `${proposalRef(r.proposalSeq)} ` : ""}
                          {r.proposalTitle ?? "Öneri"}
                        </Link>
                        <div className="row small">
                          <VoteBadge choice={r.choice} />
                          <span>{r.round === 2 ? "yeniden oylama" : "1. tur"}</span>
                          <Time at={r.castAt} mode="both" className="muted" />
                          {latest ? <Badge tone="success">geçerli (en son)</Badge> : <Badge tone="neutral">eski — oy değiştirildi</Badge>}
                        </div>
                      </div>
                      <Button size="sm" variant={active ? "primary" : "secondary"} icon="verify" onClick={() => start(r, "device")} loading={running && !!active}>
                        Doğrula
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="row">
              <Button size="sm" variant="ghost" icon="copy" onClick={() => downloadText("oy-makbuzlari.json", listJson, "application/json;charset=utf-8")}>
                Makbuzları dışa aktar (JSON)
              </Button>
              <CopyButton text={listJson} label="JSON'u kopyala" />
            </div>
          </div>
        ) : null}
      </Card>

      <Details summary="Makbuzu elle yapıştır (JSON)">
        <div className="stack-sm">
          <Textarea
            label="Makbuz JSON'u"
            hint='Örn. {"proposalId": "...", "round": 1, "ballotId": "...", "choice": "yes", "salt": "...", "commitment": "...", "txHash": "..."}'
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={5}
            className="mono"
            error={pasteError ?? undefined}
          />
          <div className="form-actions">
            <Button variant="primary" onClick={usePasted} disabled={!pasted.trim()}>
              Bu makbuzu doğrula
            </Button>
          </div>
        </div>
      </Details>

      {selected ? (
        <Card
          title="Doğrulama adımları"
          subtitle={
            <>
              {selectedSource === "pasted" ? "Yapıştırılan makbuz" : "Cihazdaki makbuz"} · pusula <code className="hash">{shortHash(selected.ballotId, 10)}</code> ·{" "}
              {selected.round === 2 ? "yeniden oylama" : "1. tur"}
            </>
          }
          actions={
            <Button size="sm" icon="refresh" onClick={() => void run(selected, tamper, tamperChoice)} loading={running}>
              Yeniden doğrula
            </Button>
          }
        >
          <div className="stack">
            <KeyValue
              compact
              items={[
                { label: "Makbuzdaki seçim", value: tamper ? <><VoteBadge choice={tamperChoice} /> <Badge tone="danger">kurcalandı (demo)</Badge></> : <VoteBadge choice={selected.choice} /> },
                { label: "Taahhüt", value: <HashText hash={selected.commitment} chars={12} /> },
                { label: "Defter işlemi", value: selected.txHash ? <HashText hash={selected.txHash} chars={12} to={routes.tx(selected.txHash)} /> : "—" },
              ]}
            />
            <div className="tamper-box">
              <Checkbox
                label="Bir makbuzu kurcala (demo)"
                hint="Makbuzdaki seçimi yalnızca bu doğrulama için değiştirir (cihazdaki makbuz değişmez). Taahhüt tutmayacağı için doğrulamanın ✘ vermesi beklenir."
                checked={tamper}
                onChange={(e) => onTamperToggle(e.target.checked)}
              />
              {tamper ? (
                <Select
                  label="Sahte seçim"
                  value={tamperChoice}
                  onChange={(e) => {
                    const c = e.target.value as VoteChoice;
                    setTamperChoice(c);
                    void run(selected, true, c);
                  }}
                  options={(["yes", "no", "abstain"] as VoteChoice[]).map((c) => ({ value: c, label: VOTE_LABELS[c], disabled: c === selected.choice }))}
                />
              ) : null}
            </div>
            {pinNote ? <Alert tone="warning">{pinNote}</Alert> : null}
            <ol className="vsteps vsteps-numbered">
              {steps.map((s) => (
                <li key={s.key} className={cx("vstep", `vstep-${s.status}`)}>
                  <StepIcon status={s.status} />
                  <div>
                    <div className="vstep-title">{s.title}</div>
                    {s.detail ? <div className="small muted vstep-detail">{s.detail}</div> : null}
                  </div>
                </li>
              ))}
            </ol>
            {done ? (
              failed ? (
                <Alert tone="error" title={tamper ? "Kurcalama yakalandı" : "Doğrulama başarısız"}>
                  {tamper
                    ? "Makbuzdaki seçim değiştirildiğinde taahhüt artık defterdekiyle eşleşmez: kimse makbuzunuzu ya da defterdeki oyunuzu fark edilmeden değiştiremez."
                    : "En az bir adım başarısız oldu. Ayrıntıları yukarıda görebilirsiniz; eski bir makbuzsa geçerli olan en son makbuzunuzu doğrulayın."}
                </Alert>
              ) : pending ? (
                <Alert tone="info" title="Şimdilik doğrulandı">
                  Oyunuz deftere doğru yazıldı. Açıklama ve sayım adımları oylama kapanınca yapılabilir; o zaman yeniden doğrulayın.
                </Alert>
              ) : (
                <Alert tone="success" title="Oyunuz kayıtlı ve sayıma girdi">
                  Taahhüdünüz bloğa dahil, makbuzla birebir eşleşiyor, açıklanan oyunuz aynı ve sayım yeniden hesaplanınca tutuyor.
                </Alert>
              )
            ) : null}
            {selectedSource === "pasted" ? (
              <div>
                <Button size="sm" onClick={() => void savePasted()}>
                  Bu makbuzu cihaza kaydet
                </Button>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Details summary="Nasıl çalışır?">
        <ol className="steps small">
          <li>Oy verdiğinizde sunucu rastgele bir tuz üretir ve deftere yalnızca taahhüt = SHA-256(öneri ‖ tur ‖ pusula ‖ seçim ‖ tuz) yazılır.</li>
          <li>Makbuz (seçim + tuz) cihazınızda kalır; defterde kimin ne oy verdiği görünmez. Oy pusulası kimliği öneriye özeldir.</li>
          <li>Doğrulayıcı anahtarları ilk kullanımda cihazınızda sabitlenir; sunucu sonradan farklı anahtar bildirirse uyarılırsınız.</li>
          <li>Dahil olma kanıtı: işlemin Merkle yolu blok başlığındaki köke götürmeli ve blok, 4 doğrulayıcıdan en az 3'ünün imzasını taşımalıdır.</li>
          <li>Oylama kapanınca tüm oylar toplu açıklanır (BALLOT_REVEAL); açıklanan oyunuzun makbuzla aynı olduğu ve sayımın tuttuğu tarayıcıda denetlenir.</li>
        </ol>
        <p className="small muted">
          Tehdit modeli: sistem düşük riskli topluluk yönetişimi içindir; seçmen uygunluğu ve oy gizliliği konusunda sunucuya güvenilir. Doğrulayıcılar aynı makinede
          çalışıyorsa bu durum defter sayfasında belirtilir.
        </p>
      </Details>
    </div>
  );
}
