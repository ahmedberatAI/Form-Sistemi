// Tartışma mesajı yazma / yanıtlama / düzenleme formu.
// İsteğe bağlı ön denetim (kişisel veri + YZ moderasyonu, danışma); sunucu 422 pii_detected dönerse
// maskeli bulgular gösterilir ve kullanıcı "Yine de gönder" (acknowledgePii) seçebilir.
// Yeni mesaj (mode="new") doğrulanmış üyede KAPALI başlar: tek satır görünümlü 'Görüşünüzü yazın…' düğmesi (aria-expanded=false).
// Düğmeye dokununca düğme formla yer değiştirir ve odak metin alanına geçer ('Yeni mesaj' formu); metin yazılmışsa açık kalır;
// 'Tam' görünümde baştan açıktır (odak çalmaz). 'Vazgeç' taslağı atar, formu kapatır ve odağı düğmeye geri verir. Kapalıyken form
// DOM'da olmadığından düğme aria-controls taşımaz (var olmayan kimliğe işaret etmesin). Yanıtla ve Düzenle doğrudan açılır.
// Anonim, doğrulanmamış, taslak ve arşiv durumları tek cümlelik nottur (metinler discussionLogic.ts).
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { STANCE_LABELS, type MessagePrecheckResponse, type MessageView, type Stance, type ThreadType } from "@forum/shared";
import { editMessage, postMessage, precheckMessage } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { useOntology } from "../../lib/categories";
import { resolveDefaultOpen, useDetailLevel } from "../../lib/detailLevel";
import { truncate } from "../../lib/format";
import { AiLabel, Alert, Badge, Button, Icon, RadioGroup, Textarea, useToast } from "../../ui";
import { piiFromError, PiiNotice, piiKindLabel, type PiiFinding } from "./common";
import { composerGate, composerIsOpen } from "./discussionLogic";
import "./discussion.css";

const MAX_LEN = 10000;

const STANCE_HINTS: Record<Stance, string> = {
  pro: "Öneriyi / görüşü destekliyorum",
  con: "Karşı görüşteyim",
  neutral: "Bilgi, gözlem",
  question: "Bir şey soruyorum",
};

const RISK_TEXT = ["Sorun görülmedi", "Düşük risk", "Orta risk", "Yüksek risk"];

export interface ComposerProps {
  threadType: ThreadType;
  threadId: string;
  mode?: "new" | "reply" | "edit";
  /** Yanıtlanan mesaj (mode="reply") */
  parent?: MessageView | null;
  /** Düzenlenen mesaj (mode="edit") */
  message?: MessageView | null;
  onDone: (m: MessageView) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  /** Yazma kapalıysa gerekçe (ör. taslak öneri) */
  closedReason?: string | null;
}

export function Composer({ threadType, threadId, mode = "new", parent, message, onDone, onCancel, autoFocus, closedReason }: ComposerProps) {
  const auth = useAuth();
  const toast = useToast();
  const location = useLocation();
  const { contentLabel } = useOntology();
  const [body, setBody] = useState(mode === "edit" ? (message?.body ?? "") : "");
  const [stance, setStance] = useState<Stance>("neutral");
  const [sending, setSending] = useState(false);
  const [pii, setPii] = useState<PiiFinding[] | null>(null);
  const [check, setCheck] = useState<MessagePrecheckResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Yeni mesaj kutusunun açıklığı: null = kullanıcı dokunmadı (görünüm yoğunluğu belirler), true/false = kendi seçimi.
  const [choice, setChoice] = useState<boolean | null>(null);
  const { level } = useDetailLevel();
  const defaultOpen = resolveDefaultOpen(undefined, level);
  const open = composerIsOpen({ mode, hasText: body.length > 0, choice, defaultOpen });
  const toggleRef = useRef<HTMLButtonElement>(null);
  const refocusToggle = useRef(false);

  // Vazgeç ya da gönderim sonrası kutu kapanınca odak yazma düğmesine döner (klavye ve ekran okuyucu yolunu kaybetmesin).
  useEffect(() => {
    if (open || !refocusToggle.current) return;
    refocusToggle.current = false;
    toggleRef.current?.focus();
  }, [open]);

  const gate = composerGate({ user: auth.user, canVerify: auth.can("V"), closedReason, mode });
  if (gate.kind === "anonymous") {
    return (
      <p className="composer-note">
        <Icon name="info" size={16} />
        <span>
          Mesaj yazmak için doğrulanmış üye olmak gerekir:{" "}
          <Link className="nowrap" to="/giris" state={{ from: location.pathname + location.search }}>
            Giriş yap
          </Link>{" "}
          ·{" "}
          <Link className="nowrap" to="/kayit">
            Kayıt ol
          </Link>
        </span>
      </p>
    );
  }
  if (gate.kind === "blocked" || gate.kind === "closed") {
    return (
      <p className="composer-note">
        <Icon name="info" size={16} />
        <span>{gate.text}</span>
      </p>
    );
  }

  /** Taslağı atar ve (yalnız yeni mesajda) kutuyu kapatır. */
  const collapse = () => {
    setBody("");
    setPii(null);
    setCheck(null);
    setError(null);
    refocusToggle.current = true;
    setChoice(false);
  };

  if (mode === "new" && !open) {
    return (
      <button ref={toggleRef} type="button" className="composer-collapsed" aria-expanded={false} onClick={() => setChoice(true)}>
        <span>Görüşünüzü yazın…</span>
        <Icon name="chevronDown" size={16} />
      </button>
    );
  }

  const trimmed = body.trim();
  const tooShort = trimmed.length < 1;
  const unchanged = mode === "edit" && trimmed === (message?.body ?? "").trim();

  const submit = async (acknowledgePii = false) => {
    if (tooShort || unchanged) return;
    setSending(true);
    setError(null);
    try {
      const m =
        mode === "edit" && message
          ? await editMessage(message.id, { body: trimmed, acknowledgePii: acknowledgePii || undefined })
          : await postMessage(threadType, threadId, {
              body: trimmed,
              stance,
              parentId: mode === "reply" ? (parent?.id ?? null) : null,
              acknowledgePii: acknowledgePii || undefined,
            });
      setPii(null);
      setCheck(null);
      if (mode !== "edit") setBody("");
      if (mode === "new") {
        // Gönderilince kutu varsayılanına döner (sade → kapanır, odak düğmeye gider; tam → açık kalır).
        setChoice(null);
        if (!defaultOpen) refocusToggle.current = true;
      }
      toast.success(mode === "edit" ? "Mesaj düzenlendi; yeni sürüm deftere kaydedildi." : "Mesajınız yayımlandı ve özeti deftere kaydedildi.");
      onDone(m);
    } catch (e) {
      const found = piiFromError(e);
      if (found) setPii(found);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const runCheck = async () => {
    if (tooShort) return;
    setChecking(true);
    try {
      setCheck(await precheckMessage(trimmed));
    } catch (e) {
      toast.error(e, "Ön denetim yapılamadı");
    } finally {
      setChecking(false);
    }
  };

  const title = mode === "edit" ? "Mesajı düzenle" : mode === "reply" ? `@${parent?.authorNickname ?? ""} kişisine yanıt` : "Yeni mesaj";

  return (
    <form
      className="composer stack-sm"
      aria-label={title}
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      {mode === "reply" && parent ? (
        <p className="small muted composer-replying">
          Yanıtlanan: <strong>@{parent.authorNickname}</strong> — “{truncate(parent.body ?? parent.tombstone ?? "", 90)}”
        </p>
      ) : null}
      {mode !== "edit" ? (
        <RadioGroup<Stance>
          label="Tutumunuz"
          layout="inline"
          value={stance}
          onChange={setStance}
          options={(Object.keys(STANCE_LABELS) as Stance[]).map((s) => ({ value: s, label: <span title={STANCE_HINTS[s]}>{STANCE_LABELS[s]}</span> }))}
        />
      ) : null}
      <Textarea
        label={mode === "edit" ? "Yeni metin" : "Mesajınız"}
        hint={
          mode === "edit"
            ? "Düzenleme yeni bir sürüm oluşturur; eski sürümler silinmez ve herkese açık kalır."
            : "Saygılı ve konuya odaklı yazın. Kişisel veri (kimlik, telefon, adres…) paylaşmayın."
        }
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          if (pii) setPii(null);
          if (check) setCheck(null);
        }}
        maxLength={MAX_LEN}
        showCount
        rows={mode === "new" ? 4 : 3}
        autoFocus={autoFocus || (mode === "new" && choice === true)}
        required
      />
      {pii ? <PiiNotice findings={pii} loading={sending} onAcknowledge={() => void submit(true)} onCancel={() => setPii(null)} /> : null}
      {error ? (
        <Alert tone="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {check ? (
        <AiLabel label={check.aiLabel} offline={check.offline} className="composer-check">
          <div className="stack-sm">
            <div className="row">
              <Badge tone={check.risk >= 2 ? "danger" : check.risk === 1 ? "warning" : "success"}>{RISK_TEXT[check.risk] ?? `Risk ${check.risk}`}</Badge>
              {check.labels.map((l) => (
                <Badge key={l} tone="warning">
                  {contentLabel(l)}
                </Badge>
              ))}
            </div>
            {check.rationale ? <p className="small">{check.rationale}</p> : null}
            {check.pii.length ? (
              <p className="small">
                Kişisel veri olabilecek ifadeler: {check.pii.map((f) => `${piiKindLabel(f.kind)} (${f.masked})`).join(", ")}
              </p>
            ) : (
              <p className="small">Kişisel veri bulunmadı.</p>
            )}
            <p className="small muted">Bu denetim yalnızca uyarıdır; mesajınızı gizlemez ya da engellemez.</p>
          </div>
        </AiLabel>
      ) : null}
      <div className="form-actions">
        {onCancel || mode === "new" ? (
          <Button variant="ghost" onClick={onCancel ?? collapse} disabled={sending}>
            Vazgeç
          </Button>
        ) : null}
        <Button variant="secondary" icon="ai" onClick={() => void runCheck()} loading={checking} disabled={tooShort || sending} title="İsteğe bağlı: kişisel veri ve üslup ön denetimi (danışma niteliğinde)">
          Ön denetim
        </Button>
        <Button type="submit" variant="primary" loading={sending} disabled={tooShort || unchanged || !!pii}>
          {mode === "edit" ? "Yeni sürümü kaydet" : mode === "reply" ? "Yanıtla" : "Gönder"}
        </Button>
      </div>
    </form>
  );
}
