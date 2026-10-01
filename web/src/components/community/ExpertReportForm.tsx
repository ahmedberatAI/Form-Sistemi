// Bilirkişi rapor formu: değerlendirme, güven, riskler, sorulara yanıtlar, gövde, karşı görüş.
// Yazarken hukuki nitelendirme denetimi (YZ ya da çevrimdışı sezgisel) canlı çalışır — yalnızca danışmadır.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ASSESSMENT_LABELS, type ExpertAssessment, type ExpertReportView, type LintResponse, type MyAssignment } from "@forum/shared";
import { ApiError, errorMessage } from "../../api/client";
import { lintExpertText, submitExpertReport } from "../../api/endpoints";
import { useDebounced } from "../../lib/hooks";
import { getPrefSync, removePref, setPrefSync } from "../../lib/prefs";
import { formatPercent } from "../../lib/format";
import { AiLabel, Alert, Badge, Button, Field, Input, RadioGroup, Spinner, Textarea, useConfirm, useToast } from "../../ui";
import "./community.css";

const LINT_MIN = 20;
const LINT_MAX = 50_000;
const BODY_MIN = 50;
/** Azınlık güvenceli soruya asgari yanıt uzunluğu (sunucu da aynı kuralı uygular: 400 minority_question_unanswered). */
const GUARANTEED_MIN = 10;
const answerKey = (questionId: string) => `answer:${questionId}`;

interface Draft {
  assessment: ExpertAssessment | null;
  confidence: number;
  risks: string[];
  answers: Record<string, string>;
  body: string;
  dissent: string;
}

const LINT_KIND_LABELS: Record<string, string> = {
  legal_qualification: "Hukuki nitelendirme",
  overclaim: "Aşırı kesin ifade",
  out_of_domain: "Uzmanlık alanı dışı",
  unsupported_claim: "Dayanaksız iddia",
  other: "Diğer",
};

const draftKey = (assignmentId: string) => `forum.expertDraft.${assignmentId}`;

function loadDraft(assignmentId: string): Draft | null {
  try {
    const raw = getPrefSync(draftKey(assignmentId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    return {
      assessment: d.assessment ?? null,
      confidence: typeof d.confidence === "number" ? d.confidence : 0.7,
      risks: Array.isArray(d.risks) && d.risks.length ? d.risks.map(String) : [""],
      answers: d.answers && typeof d.answers === "object" ? (d.answers as Record<string, string>) : {},
      body: typeof d.body === "string" ? d.body : "",
      dissent: typeof d.dissent === "string" ? d.dissent : "",
    };
  } catch {
    return null;
  }
}

/** Kalıcı uyarı: 6754 s. Bilirkişilik Kanunu md. 3/2. */
export function LegalQualificationNotice() {
  return (
    <Alert tone="warning" title="Hukuki nitelendirme yasağı">
      <strong>6754 s. Bilirkişilik Kanunu md. 3/2: bilirkişi hukuki nitelendirme yapamaz.</strong> Raporunuz yalnızca uzmanlık alanınızdaki teknik
      değerlendirmeyi içermeli. “Hukuka aykırıdır”, “suç teşkil eder”, “anayasaya aykırıdır”, “kusurludur” gibi hukuki yargılar yazmayın; hukuki
      değerlendirme üyelere ve yönetmeliğe aittir. Bu ölçüt itibar puanınızı da etkiler.
    </Alert>
  );
}

export function ExpertReportForm({ assignment, onSubmitted, onCancel }: { assignment: MyAssignment; onSubmitted: (r: ExpertReportView) => void; onCancel?: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const initial = useRef<Draft>(loadDraft(assignment.assignmentId) ?? { assessment: null, confidence: 0.7, risks: [""], answers: {}, body: "", dissent: "" });
  const [assessment, setAssessment] = useState<ExpertAssessment | null>(initial.current.assessment);
  const [confidence, setConfidence] = useState<number>(initial.current.confidence);
  const [risks, setRisks] = useState<string[]>(initial.current.risks);
  const [answers, setAnswers] = useState<Record<string, string>>(initial.current.answers);
  const [body, setBody] = useState(initial.current.body);
  const [dissent, setDissent] = useState(initial.current.dissent);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Taslak cihazda saklanır (yanlışlıkla sayfadan çıkılırsa kaybolmasın).
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        setPrefSync(draftKey(assignment.assignmentId), JSON.stringify({ assessment, confidence, risks, answers, body, dissent }));
      } catch {
        /* depolama yoksa yok say */
      }
    }, 500);
    return () => window.clearTimeout(t);
  }, [assignment.assignmentId, assessment, confidence, risks, answers, body, dissent]);

  // ── Canlı hukuki nitelendirme denetimi ──
  const lintText = [body, ...assignment.questions.map((q) => answers[q.id] ?? ""), dissent]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, LINT_MAX);
  const debounced = useDebounced(lintText, 1200);
  const [lint, setLint] = useState<LintResponse | null>(null);
  const [linting, setLinting] = useState(false);
  const [lintError, setLintError] = useState<string | null>(null);
  const lintSeq = useRef(0);

  useEffect(() => {
    if (debounced.length < LINT_MIN) {
      setLint(null);
      setLintError(null);
      return;
    }
    const seq = ++lintSeq.current;
    setLinting(true);
    lintExpertText(debounced)
      .then((r) => {
        if (seq !== lintSeq.current) return;
        setLint(r);
        setLintError(null);
      })
      .catch((e) => {
        if (seq !== lintSeq.current) return;
        setLintError(errorMessage(e));
      })
      .finally(() => {
        if (seq === lintSeq.current) setLinting(false);
      });
  }, [debounced]);

  const stale = lintText !== debounced;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!assessment) errs.assessment = "Bir değerlendirme seçin.";
    if (body.trim().length < BODY_MIN) errs.body = `Rapor metni en az ${BODY_MIN} karakter olmalıdır.`;
    for (const q of assignment.questions) {
      if (q.minorityGuaranteed && (answers[q.id] ?? "").trim().length < GUARANTEED_MIN) {
        errs[answerKey(q.id)] = `Azınlık güvenceli soru: yanıt zorunludur (en az ${GUARANTEED_MIN} karakter).`;
      }
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const unanswered = assignment.questions.filter((q) => !q.minorityGuaranteed && !(answers[q.id] ?? "").trim());
    const issues = lint?.issues.length ?? 0;
    if (issues > 0 || unanswered.length > 0) {
      const parts: string[] = [];
      if (issues) parts.push(`Denetim, düzeltilmesi önerilen ${issues} ifade işaretledi (hukuki nitelendirme, alan dışı ya da aşırı kesin ifade).`);
      if (unanswered.length) parts.push(`${unanswered.length} soru yanıtsız (tüm soruların yanıtlanması itibar ölçütlerindendir).`);
      const ok = await confirm({ title: "Rapor yine de gönderilsin mi?", message: parts.join(" "), confirmLabel: "Gönder" });
      if (!ok) return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      const report = await submitExpertReport(assignment.assignmentId, {
        assessment: assessment!,
        confidence,
        risks: risks.map((r) => r.trim()).filter(Boolean),
        answers: assignment.questions.map((q) => ({ questionId: q.id, answer: (answers[q.id] ?? "").trim() })),
        body: body.trim(),
        dissent: dissent.trim() ? dissent.trim() : null,
      });
      void removePref(draftKey(assignment.assignmentId)).catch(() => undefined);
      toast.success("Raporunuz kaydedildi ve özeti deftere yazıldı.");
      onSubmitted(report);
    } catch (err) {
      setSubmitError(errorMessage(err));
      if (err instanceof ApiError && err.details && typeof err.details === "object") {
        const d = err.details as Record<string, unknown>;
        if (typeof d.body === "string") setErrors((x) => ({ ...x, body: d.body as string }));
        // Bu arada yeni bir azınlık güvenceli soru sorulmuş olabilir: sunucu yanıtsız soruları bildirir.
        if (Array.isArray(d.questionIds)) {
          const ids = d.questionIds.filter((x): x is string => typeof x === "string");
          setErrors((x) => ({ ...x, ...Object.fromEntries(ids.map((id) => [answerKey(id), "Azınlık güvenceli soru: yanıt zorunludur."])) }));
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit} noValidate aria-label="Bilirkişi raporu">
      <LegalQualificationNotice />

      <RadioGroup<ExpertAssessment>
        label="Değerlendirme"
        value={assessment}
        onChange={setAssessment}
        layout="cards"
        required
        error={errors.assessment}
        options={[
          { value: "feasible", label: ASSESSMENT_LABELS.feasible, hint: "Öneri teknik olarak uygulanabilir." },
          { value: "infeasible", label: ASSESSMENT_LABELS.infeasible, hint: "Öneri teknik olarak uygulanamaz ya da ciddi engel var." },
          { value: "uncertain", label: ASSESSMENT_LABELS.uncertain, hint: "Mevcut bilgiyle karar verilemiyor." },
        ]}
      />

      <Field label="Güven düzeyi" htmlFor={`conf-${assignment.assignmentId}`} hint="Değerlendirmenizden ne kadar eminsiniz? (0 = hiç, 1 = tamamen)">
        <div className="cm-range-row">
          <input
            id={`conf-${assignment.assignmentId}`}
            className="cm-range"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={confidence}
            onChange={(e) => setConfidence(Number(e.target.value))}
            aria-valuetext={formatPercent(confidence, 0)}
          />
          <output htmlFor={`conf-${assignment.assignmentId}`}>{formatPercent(confidence, 0)}</output>
        </div>
      </Field>

      <fieldset className="form-section">
        <legend>Riskler</legend>
        <div className="stack-sm">
          {risks.map((r, i) => (
            <div className="cm-risk-row" key={i}>
              <Input
                label={`Risk ${i + 1}`}
                value={r}
                maxLength={2000}
                onChange={(e) => setRisks((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder="ör. Uygulama maliyeti öngörülenin üzerinde olabilir"
              />
              <Button
                variant="ghost"
                icon="close"
                aria-label={`Risk ${i + 1} sil`}
                onClick={() => setRisks((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : [""]))}
              />
            </div>
          ))}
          <div>
            <Button size="sm" icon="plus" onClick={() => setRisks((xs) => [...xs, ""])} disabled={risks.length >= 50}>
              Risk ekle
            </Button>
          </div>
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Üyelerin soruları ({assignment.questions.length})</legend>
        {assignment.questions.length === 0 ? <p className="muted">Bu öneri için sorulmuş soru yok.</p> : null}
        <div className="stack">
          {assignment.questions.map((q, i) => (
            <div className="cm-question stack-sm" key={q.id}>
              <div className="row">
                <strong>Soru {i + 1}</strong>
                {q.minorityGuaranteed ? (
                  <Badge tone="accent" title="Azınlık görüşündeki üyelerin sorusu: yanıtlanması zorunludur">
                    azınlık güvenceli
                  </Badge>
                ) : null}
              </div>
              <p className="cm-prewrap">{q.body}</p>
              <Textarea
                label={`Soru ${i + 1} yanıtınız${q.minorityGuaranteed ? " (zorunlu)" : ""}`}
                value={answers[q.id] ?? ""}
                maxLength={10_000}
                rows={3}
                required={q.minorityGuaranteed}
                hint={q.minorityGuaranteed ? `Azınlık güvenceli soru: yanıtlanmadan rapor gönderilemez (en az ${GUARANTEED_MIN} karakter).` : undefined}
                error={errors[answerKey(q.id)]}
                onChange={(e) => {
                  setAnswers((a) => ({ ...a, [q.id]: e.target.value }));
                  if (errors[answerKey(q.id)]) {
                    setErrors((x) => {
                      const next = { ...x };
                      delete next[answerKey(q.id)];
                      return next;
                    });
                  }
                }}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <Textarea
        label="Rapor metni"
        required
        rows={10}
        value={body}
        maxLength={50_000}
        showCount
        hint={`En az ${BODY_MIN} karakter. Gerekçeli teknik değerlendirmenizi yazın.`}
        error={errors.body}
        onChange={(e) => setBody(e.target.value)}
      />

      <Textarea
        label="Karşı görüş (isteğe bağlı)"
        rows={4}
        value={dissent}
        maxLength={20_000}
        hint="Paneldeki diğer bilirkişilerden ayrıştığınız noktalar ya da çekinceleriniz."
        onChange={(e) => setDissent(e.target.value)}
      />

      <section aria-live="polite" aria-label="Hukuki nitelendirme denetimi">
        {lintText.length < LINT_MIN ? (
          <p className="muted small">Yazmaya başladığınızda hukuki nitelendirme denetimi otomatik çalışır.</p>
        ) : lint ? (
          <AiLabel label={lint.aiLabel} model={lint.model} offline={lint.offline}>
            <div className="stack-sm">
              <div className="row-between">
                <strong>Rapor denetimi: hukuki nitelendirme, alan dışı ve aşırı kesin ifadeler</strong>
                {linting || stale ? <Spinner label="Denetleniyor…" showLabel size="sm" /> : null}
              </div>
              {lint.issues.length === 0 ? (
                <p className="mt-0">Hukuki nitelendirme ya da alan dışı değerlendirme olabilecek bir ifade bulunmadı.</p>
              ) : (
                <ul className="cm-lint-list">
                  {lint.issues.map((it, i) => (
                    <li key={i}>
                      <Badge tone={it.kind === "legal_qualification" ? "danger" : "warning"}>{LINT_KIND_LABELS[it.kind] ?? it.kind}</Badge>
                      <blockquote className="cm-lint-quote">“{it.quote}”</blockquote>
                      <span>{it.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </AiLabel>
        ) : linting ? (
          <Spinner label="Hukuki nitelendirme denetimi yapılıyor…" showLabel />
        ) : null}
        {lintError ? (
          <Alert tone="warning" title="Denetim yapılamadı">
            {lintError} Raporu yine de gönderebilirsiniz; denetim sunucuda yeniden yapılır.
          </Alert>
        ) : null}
      </section>

      {submitError ? (
        <Alert tone="error" title="Rapor gönderilemedi" onClose={() => setSubmitError(null)}>
          {submitError}
        </Alert>
      ) : null}
      <div className="form-actions">
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Kapat (taslak saklanır)
          </Button>
        ) : null}
        <Button type="submit" variant="primary" loading={busy}>
          Raporu gönder
        </Button>
      </div>
    </form>
  );
}

export default ExpertReportForm;
