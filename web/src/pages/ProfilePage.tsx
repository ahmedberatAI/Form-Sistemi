// Profilim: oy hakkı durumu en üstte; hesap özeti, açık rızalar ve vekâletler açık; seyrek işler (bilirkişilik, takma ad, şifre, KVKK, kimlik
// düzeltme) başlığı görünür, gövdesi katlı kartlardır ('Tam' görünümde açık). Derin bağlantılar: ?bolum=kvkk, ?bolum=duzeltme, ?bolum=rizalar …
// (components/system/accountLogic.ts › PROFILE_ANCHORS). Karar mantığı sunucuda kalır; oy hakkı koşulları yalnız söylenir.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { clusterLabel, type AddressInput, type CorrectableField, type CorrectionStatus, type IdentityCorrectionValues, type Me } from "@forum/shared";
import { ApiError, errorMessage } from "../api/client";
import {
  changeNickname,
  changePassword,
  eraseMe,
  exportMyData,
  getMyCorrections,
  getMyDelegations,
  listExperts,
  requestCorrection,
  updateConsents,
  withdrawCorrection,
} from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { KvkkNotice } from "../components/KvkkNotice";
import { nicknameError } from "../components/RegistrationForm";
import { UserLink } from "../components/UserLink";
import { DomainChips } from "../components/community/DomainChips";
import { DelegationForm, OutgoingDelegations, useScopeLabel } from "../components/community/delegation";
import { ReputationBar } from "../components/community/ReputationBar";
import "../components/community/community.css";
import {
  correctionSummary,
  emptyDelegationLine,
  expertSummary,
  KVKK_SUMMARY,
  nicknameSummary,
  PASSWORD_SUMMARY,
  PROFILE_ANCHORS,
  voteRightOf,
} from "../components/system/accountLogic";
import "../components/system/account.css";
import { canDownloadFiles, downloadJson } from "../lib/download";
import { formatDate } from "../lib/format";
import { isNativePlatform } from "../lib/prefs";
import { routes } from "../lib/routes";
import { useSectionParam } from "../lib/sectionParam";
import { useAsync } from "../lib/useAsync";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  CopyButton,
  Details,
  ErrorView,
  ExpertStatusBadge,
  formTermLinkMode,
  Input,
  KeyValue,
  LinkButton,
  PageHeader,
  RoleBadge,
  Spinner,
  Table,
  Term,
  TermLinksProvider,
  Textarea,
  Time,
  useConfirm,
  useToast,
  UserStatusBadge,
  type TermLinkMode,
} from "../ui";

type ConsentKey = "political" | "ai";

/** Rıza verme/geri alma: Oy hakkı kartı ile Açık rızalar kartı aynı isteği paylaşır (biri sürerken öteki de kilitlenir). */
function useConsentUpdate() {
  const auth = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<ConsentKey | null>(null);

  const set = async (key: ConsentKey, value: boolean) => {
    if (key === "political" && !value) {
      const ok = await confirm({
        title: "Siyasi görüş rızasını geri al",
        message: "Rızanızı geri alırsanız oy kullanamaz, itiraz imzalayamaz ve azınlık raporu yazamazsınız (bu işlemler yalnızca oy kullanabilen üyelere açıktır). Rızanızı istediğiniz zaman yeniden verebilirsiniz.",
        confirmLabel: "Rızamı geri al",
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusy(key);
    try {
      const next = await updateConsents(key === "political" ? { politicalConsent: value } : { aiConsent: value });
      auth.setUser(next);
      // Siyasi görüş rızası oy, itiraz ve azınlık raporu işlerini açar ya da kapatır: 'Ana sayfa' rozeti hemen güncellenir.
      void auth.refreshTasks();
      toast.success(value ? "Açık rızanız kaydedildi." : "Rızanız geri alındı.");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  return { busy, set };
}

export default function ProfilePage() {
  const auth = useAuth();
  const me = auth.user;
  const consents = useConsentUpdate();
  // ?bolum=kvkk | duzeltme | rizalar … : kartı açar, kaydırır, odağı taşır ve parametreyi siler.
  useSectionParam(!!me);
  if (!me) return <Spinner block />;
  return (
    <div className="page page-narrow">
      <PageHeader title="Profilim" subtitle="Hesabınız, rızalarınız, vekâletleriniz ve kişisel verileriniz üzerindeki haklarınız." />
      <VoteRightCard me={me} busy={consents.busy === "political"} onGrant={() => void consents.set("political", true)} />
      <AccountCard me={me} />
      <ConsentsCard me={me} busy={consents.busy} onChange={(key, value) => void consents.set(key, value)} />
      <DelegationsCard />
      <ExpertStatusCard me={me} />
      <NicknameCard me={me} />
      <PasswordCard />
      <KvkkCard me={me} />
      <CorrectionCard me={me} />
    </div>
  );
}

// ───────────── Oy hakkı (sayfanın en üstü) ─────────────

/**
 * 'Oy hakkınız: Var/Yok'. Yoksa eksik koşullar sayılır ve üyenin elindeki TEK eylem gösterilir (siyasi görüş rızası); kayıt memuru
 * onayı, askı ve 18 yaş üyenin elinde olmadığı için düğme çıkmaz. Düğmeden rıza verilince odak (düğme kaybolduğu için) karta taşınır
 * (oy hakkı açılmasa da: bekleyen hesapta rıza verilince düğme kalkar); istek başarısız olursa düğmeye geri verilir. Rıza başka
 * yerden (Açık rızalar kutusu) verilirse odağa dokunulmaz.
 */
export function VoteRightCard({ me, busy, onGrant }: { me: Pick<Me, "status" | "isAdult" | "politicalConsent">; busy?: boolean; onGrant?: () => void }) {
  const right = voteRightOf(me);
  const button = useRef<HTMLButtonElement>(null);
  const fromButton = useRef(false);
  const wasAble = useRef(right.can);
  useEffect(() => {
    if (busy) return;
    const changed = right.can !== wasAble.current;
    wasAble.current = right.can;
    if (!fromButton.current) return;
    fromButton.current = false;
    const focusCard = () => {
      const card = document.getElementById(PROFILE_ANCHORS.oyHakki);
      card?.setAttribute("tabindex", "-1");
      card?.focus({ preventScroll: true });
    };
    if (changed && right.can) focusCard();
    // Başarısız istek: düğme yerinde, odak ona döner. Rıza verildi ama başka koşul eksik (ör. kayıt memuru onayı bekleniyor):
    // düğme kalktı, odak body'ye düşmesin, karta gider.
    else if (!right.can) {
      if (button.current) button.current.focus({ preventScroll: true });
      else focusCard();
    }
  }, [right.can, busy]);

  if (right.can) {
    return (
      <Card title="Oy hakkınız: Var" anchor={PROFILE_ANCHORS.oyHakki} summary="✔ Oy kullanma koşullarının üçü de tamam" summaryTone="success">
        <p className="mt-0 small">
          Kimliğiniz doğrulandı, 18 yaşından büyüksünüz ve siyasi görüş rızanız var. Oylamaya açılan önerilerde oy kullanabilirsiniz; uygun seçmen listesi
          oylama açıldığında belirlenir.
        </p>
      </Card>
    );
  }
  return (
    <Card title="Oy hakkınız: Yok" anchor={PROFILE_ANCHORS.oyHakki} summary="⚠ Şu an oy kullanamazsınız" summaryTone="warning">
      <div className="stack-sm">
        <ul className="acct-missing" aria-label="Eksik koşullar">
          {right.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        {right.action === "consent" ? (
          <div className="acct-action">
            <Button
              ref={button}
              variant="primary"
              loading={busy}
              onClick={() => {
                fromButton.current = true;
                onGrant?.();
              }}
            >
              Siyasi görüş rızası ver
            </Button>
            <p className="acct-note">
              Oy ve görüş verileriniz özel nitelikli kişisel veridir (KVKK m. 6); rızayı istediğiniz zaman aşağıdaki “Açık rızalar” bölümünden geri alabilirsiniz.
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

// ───────────── Kimlik verisi düzeltme talebi (KVKK m. 11/1-d) ─────────────

const CORRECTION_FIELDS: { field: CorrectableField; label: string }[] = [
  { field: "firstName", label: "Ad" },
  { field: "lastName", label: "Soyad" },
  { field: "tckn", label: "T.C. kimlik no" },
  { field: "birthDate", label: "Doğum tarihi" },
  { field: "email", label: "E-posta" },
  { field: "phone", label: "Telefon" },
  { field: "address", label: "Adres" },
];
const fieldLabel = (f: CorrectableField) => CORRECTION_FIELDS.find((x) => x.field === f)?.label ?? f;

const CORRECTION_STATUS: Record<CorrectionStatus, { label: string; tone: "warning" | "success" | "danger" | "neutral" }> = {
  pending: { label: "Kayıt memurunda bekliyor", tone: "warning" },
  approved: { label: "Onaylandı", tone: "success" },
  rejected: { label: "Reddedildi", tone: "danger" },
  withdrawn: { label: "Geri çekildi", tone: "neutral" },
};

const EMPTY_ADDRESS: AddressInput = { il: "", ilce: "", mahalle: "", acikAdres: "", postaKodu: "" };

function CorrectionCard({ me }: { me: Me }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload, setData } = useAsync(() => getMyCorrections(), [me.id]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<CorrectableField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [address, setAddress] = useState<AddressInput>(EMPTY_ADDRESS);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const pending = data?.find((c) => c.status === "pending") ?? null;

  const toggle = (f: CorrectableField, on: boolean) => setSelected((xs) => (on ? [...xs.filter((x) => x !== f), f] : xs.filter((x) => x !== f)));

  const reset = () => {
    setOpen(false);
    setSelected([]);
    setValues({});
    setAddress(EMPTY_ADDRESS);
    setReason("");
    setErrors({});
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (selected.length === 0) errs.changes = "Düzeltilecek en az bir alan seçin.";
    if (reason.trim().length < 10) errs.reason = "Gerekçe en az 10 karakter olmalıdır.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const changes: IdentityCorrectionValues = {};
    for (const f of selected) {
      if (f === "address") changes.address = { ...address, postaKodu: address.postaKodu?.trim() || undefined };
      else changes[f] = values[f] ?? "";
    }
    setBusy(true);
    try {
      const created = await requestCorrection({ changes, reason: reason.trim() });
      setData((xs) => [created, ...(xs ?? [])]);
      toast.success("Düzeltme talebiniz kayıt memuruna iletildi.");
      reset();
    } catch (err) {
      if (err instanceof ApiError && err.details && typeof err.details === "object") {
        const d = err.details as Record<string, unknown>;
        setErrors(Object.fromEntries(Object.entries(d).filter(([, v]) => typeof v === "string")) as Record<string, string>);
      }
      toast.error(err, "Talep gönderilemedi");
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (id: string) => {
    const ok = await confirm({ title: "Düzeltme talebi geri çekilsin mi?", message: "Önerdiğiniz değerler imha edilir; dilerseniz sonra yeni bir talep açabilirsiniz.", confirmLabel: "Geri çek" });
    if (!ok) return;
    try {
      const updated = await withdrawCorrection(id);
      setData((xs) => xs?.map((x) => (x.id === id ? updated : x)));
      toast.success("Talebiniz geri çekildi.");
    } catch (err) {
      toast.error(err);
    }
  };

  const textInput = (f: Exclude<CorrectableField, "address">) => {
    const props =
      f === "birthDate"
        ? { type: "date" as const }
        : f === "email"
          ? { type: "email" as const, autoComplete: "email" }
          : f === "phone"
            ? { type: "tel" as const, autoComplete: "tel", hint: "05XX XXX XX XX ya da +90…" }
            : f === "tckn"
              ? { inputMode: "numeric" as const, maxLength: 11, hint: "11 haneli; kayıt memuru belgeden doğrular." }
              : {};
    return (
      <Input
        key={f}
        label={`Yeni ${fieldLabel(f).toLocaleLowerCase("tr-TR")}`}
        value={values[f] ?? ""}
        error={errors[f]}
        onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
        {...props}
      />
    );
  };

  const closed = me.status === "erased" || me.status === "rejected";
  return (
    <Card
      title="Kimlik bilgilerimi düzelt"
      collapsible
      anchor={PROFILE_ANCHORS.duzeltme}
      summary={correctionSummary(data, closed)}
      subtitle="Kayıtlı ad, soyad, T.C. kimlik no, doğum tarihi, e-posta, telefon ya da adresiniz yanlışsa gerekçesiyle düzeltilmesini isteyin (KVKK m. 11/1-d)."
    >
      <div className="stack">
        <p className="mt-0 small muted">Talebiniz kayıt memuruna gider; memur kimliğinizi belgeyle doğruladıktan sonra onaylar.</p>
        <Details summary="Düzeltme talebi nasıl işler?">
          <p className="mt-0 small">
            Memur önerdiğiniz değerleri yalnızca erişim amacını kaydederek görebilir. Önerdiğiniz değerler şifreli saklanır ve karar verildiğinde imha
            edilir; günlüklere yalnızca hangi alanların düzeltildiği yazılır.
          </p>
        </Details>
        {loading && !data ? (
          <Spinner />
        ) : error ? (
          <ErrorView error={error} onRetry={reload} compact />
        ) : data?.length ? (
          <ul className="list" aria-label="Düzeltme taleplerim">
            {data.map((c) => (
              <li key={c.id} className="list-item stack-sm">
                <div className="row-between">
                  <span className="small">
                    <strong>{c.fields.map(fieldLabel).join(", ")}</strong> · <Time at={c.createdAt} />
                  </span>
                  <Badge tone={CORRECTION_STATUS[c.status].tone}>{CORRECTION_STATUS[c.status].label}</Badge>
                </div>
                {c.reason ? <div className="small muted">Gerekçeniz: {c.reason}</div> : null}
                {c.decisionNote ? <div className="small">Kayıt memurunun notu: {c.decisionNote}</div> : null}
                {c.status === "pending" ? (
                  <div>
                    <Button size="sm" variant="ghost" icon="close" onClick={() => void withdraw(c.id)}>
                      Talebi geri çek
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {closed ? null : pending ? (
          <p className="small muted mt-0">Bekleyen bir talebiniz var; sonuçlanınca ya da geri çekince yeni talep açabilirsiniz.</p>
        ) : open ? (
          <form className="stack" onSubmit={submit} noValidate aria-label="Düzeltme talebi">
            <fieldset className={errors.changes ? "radio-group field-invalid" : "radio-group"}>
              <legend className="field-label">Düzeltilecek alanlar</legend>
              <div className="row">
                {CORRECTION_FIELDS.map(({ field, label }) => (
                  <Checkbox key={field} label={label} checked={selected.includes(field)} onChange={(e) => toggle(field, e.target.checked)} />
                ))}
              </div>
              {errors.changes ? (
                <div className="field-error" role="alert">
                  {errors.changes}
                </div>
              ) : null}
            </fieldset>
            {CORRECTION_FIELDS.filter(({ field }) => field !== "address" && selected.includes(field)).map(({ field }) =>
              textInput(field as Exclude<CorrectableField, "address">),
            )}
            {selected.includes("address") ? (
              <div className="form-grid">
                <Input label="İl" value={address.il} error={errors["address.il"]} onChange={(e) => setAddress((a) => ({ ...a, il: e.target.value }))} />
                <Input label="İlçe" value={address.ilce} error={errors["address.ilce"]} onChange={(e) => setAddress((a) => ({ ...a, ilce: e.target.value }))} />
                <Input label="Mahalle" value={address.mahalle} error={errors["address.mahalle"]} onChange={(e) => setAddress((a) => ({ ...a, mahalle: e.target.value }))} />
                <Input
                  label="Posta kodu (isteğe bağlı)"
                  inputMode="numeric"
                  maxLength={5}
                  value={address.postaKodu ?? ""}
                  error={errors["address.postaKodu"]}
                  onChange={(e) => setAddress((a) => ({ ...a, postaKodu: e.target.value }))}
                />
                <Textarea
                  label="Açık adres"
                  value={address.acikAdres}
                  maxLength={500}
                  error={errors["address.acikAdres"]}
                  onChange={(e) => setAddress((a) => ({ ...a, acikAdres: e.target.value }))}
                />
              </div>
            ) : null}
            <Textarea
              label="Gerekçe"
              required
              value={reason}
              maxLength={2000}
              showCount
              error={errors.reason}
              hint='ör. "Evlilik nedeniyle soyadım değişti". Gerekçe şifreli saklanır; yalnız siz ve talebi inceleyen kayıt memuru görür.'
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="form-actions">
              <Button variant="ghost" onClick={reset} disabled={busy}>
                Vazgeç
              </Button>
              <Button type="submit" variant="primary" loading={busy}>
                Talebi gönder
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button icon="plus" onClick={() => setOpen(true)}>
              Düzeltme talebi aç
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function AccountCard({ me }: { me: Me }) {
  const roles = me.roles.filter((r) => r !== "member");
  return (
    <Card title="Hesap özeti" className="acct-account" anchor={PROFILE_ANCHORS.hesap} actions={<LinkButton size="sm" variant="ghost" to={routes.user(me.id)}>Herkese açık profilim</LinkButton>}>
      <KeyValue
        items={[
          { label: "Takma ad", value: <strong>@{me.nickname}</strong> },
          { label: "Durum", value: <UserStatusBadge status={me.status} /> },
          {
            label: "Roller",
            value: roles.length ? (
              <span className="row">
                {roles.map((r) => (
                  <RoleBadge key={r} role={r} />
                ))}
              </span>
            ) : (
              "Üye"
            ),
          },
          { label: "Katılım", value: formatDate(me.joinedAt) },
          {
            label: <Term id="gorus-kumesi">Görüş kümem</Term>,
            value: (
              <span className="row">
                <strong>{clusterLabel(me.clusterId ?? null)}</strong>
                <Badge tone="neutral" icon="info">
                  yalnız size gösterilir
                </Badge>
              </span>
            ),
            // İlk cümle görünür; eğitici ayrıntı (yöntem ve köprü testindeki rolü) adlandırılmış açılırda korunur.
            hint: (
              <>
                Kapanmış oylamalardaki oylarınıza göre hesaplanır; kümeler adsızdır.
                <Details summary="Görüş kümesi nasıl hesaplanır?" className="acct-hint-more">
                  <p className="mt-0">
                    Kapanmış oylamalardaki oylarınıza göre (Polis benzeri kümeleme) hesaplanır. Kümeler adsızdır; köprü testinde her anlamlı kümeden asgari
                    destek aranır.
                  </p>
                </Details>
              </>
            ),
          },
        ]}
      />
    </Card>
  );
}

/**
 * Rıza satırları: onay kutusu kendi ipucuyla; uzun açıklama bir açılırda (hukuki bildirimin ilk cümlesi kutunun yanında kalır).
 * İstek sürerken kutular `disabled` yapılmaz (odak kaybolurdu); aria-disabled + işlemsiz değişiklik ile kilitlenir.
 */
function ConsentsCard({ me, busy, onChange }: { me: Me; busy: ConsentKey | null; onChange: (key: ConsentKey, value: boolean) => void }) {
  return (
    <Card title="Açık rızalar" anchor={PROFILE_ANCHORS.rizalar} subtitle="Rızalarınızı istediğiniz zaman verebilir ya da geri alabilirsiniz (KVKK m. 5–6).">
      <div className="stack">
        <div className="consent-box">
          <Checkbox
            label={<strong>Siyasi görüş verisi (oy ve görüş) — oy kullanmak için gerekli</strong>}
            checked={me.politicalConsent}
            aria-disabled={busy !== null || undefined}
            onChange={(e) => busy === null && onChange("political", e.target.checked)}
            hint="Oy ve görüş verileriniz siyasi düşüncenizi ortaya koyabileceği için özel nitelikli kişisel veridir (KVKK m. 6) ve yalnızca açık rızanızla işlenir. Oylarınız gizli kalır: defterde yalnızca kimliksiz taahhütler bulunur."
          />
        </div>
        <div className="consent-box">
          <Checkbox
            label={<strong>Yapay zekâ analizi — varsayılan kapalı</strong>}
            checked={me.aiConsent}
            aria-disabled={busy !== null || undefined}
            onChange={(e) => busy === null && onChange("ai", e.target.checked)}
            hint="Açarsanız yazdığınız öneri, mesaj ve raporlar sınıflandırma, özet ve denetim için Anthropic'in Claude modeline (ABD'deki sunucular) gönderilir; bu bir yurt dışına aktarımdır (KVKK m. 9)."
          />
          <Details summary="Yapay zekâ analizi nasıl işler?" className="acct-consent-more">
            <p className="mt-0 small">
              Gönderimden önce kişisel veriler maskelenir, takma adlar K1, K2… biçiminde değiştirilir. Kapalıyken içerikleriniz için yalnızca sunucuda
              çalışan kural tabanlı (çevrimdışı) analiz kullanılır. YZ yalnızca danışmandır; hiçbir kararı değiştirmez.
            </p>
          </Details>
        </div>
        {busy ? <Spinner label="Kaydediliyor…" showLabel size="sm" /> : null}
      </div>
    </Card>
  );
}

function DelegationsCard() {
  const auth = useAuth();
  const scopeLabel = useScopeLabel();
  const { data, error, loading, reload, setData } = useAsync(() => getMyDelegations(), []);
  const [formOpen, setFormOpen] = useState(false);
  // Vekâlet formu açıkken (yalnız bellekte) sözlük penceresinin bağlantıları sayfadan çıkarmaz: web'de yeni sekme, yerelde bağlantısız.
  const termLinks: TermLinkMode = formOpen ? formTermLinkMode(isNativePlatform()) : "page";
  // Boş listeler tek satıra iner: ikisi de boşsa tek cümle; yalnız biri boşsa o yönün kısa notu.
  const emptyLine = data ? emptyDelegationLine(data.outgoing.length, data.incoming.length) : null;

  return (
    <Card
      title="Vekâletler"
      anchor={PROFILE_ANCHORS.vekaletler}
      subtitle="Oy vermediğiniz oylamalarda tercihinizin kime uygulanacağını belirlersiniz (likit demokrasi)."
    >
      {loading && !data ? (
        <Spinner block />
      ) : error ? (
        <ErrorView error={error} onRetry={reload} compact />
      ) : data ? (
        <div className="stack">
          <p className="mt-0">
            <strong>
              Doğrudan oy verirseniz{" "}
              <TermLinksProvider mode={termLinks}>
                <Term id="vekalet">vekâletiniz</Term>
              </TermLinksProvider>{" "}
              o oylamada askıya alınır.
            </strong>
          </p>
          <Details summary="Vekâlet nasıl uygulanır?">
            <p className="mt-0 small">
              Her kişi her zaman tam 1 oy sayılır. Kapsam sırası: önerinin kategorileri (en özelden genele), sonra genel (*) vekâlet; her kapsamda önce
              1. sıradaki delegeye bakılır. Vekâlet sınırı: bir delege başkalarına ait en fazla <strong>{data.cap}</strong> oy taşıyabilir; sınırı aşan
              vekâletler o oylamada kullanılmaz ve size bildirim gider.
            </p>
          </Details>

          {data.outgoing.length ? (
            <section className="stack-sm" aria-label="Verdiğim vekâletler">
              <h3 className="h3 mt-0">Verdiğim vekâletler</h3>
              <OutgoingDelegations items={data.outgoing} onRevoked={(id) => setData((d) => d && { ...d, outgoing: d.outgoing.filter((x) => x.id !== id) })} />
            </section>
          ) : emptyLine ? (
            <p className="acct-empty">{emptyLine}</p>
          ) : null}

          {data.incoming.length ? (
            <section className="stack-sm" aria-label="Aldığım vekâletler">
              <h3 className="h3 mt-0">Aldığım vekâletler</h3>
              <Table
                caption="Bana verilen vekâletler"
                rows={data.incoming}
                rowKey={(d) => d.id}
                columns={[
                  { key: "from", header: "Veren", render: (d) => <span className="nowrap"><UserLink id={d.from} nickname={d.fromNickname} /></span> },
                  { key: "scope", header: "Kapsam", render: (d) => scopeLabel(d.scope) },
                  { key: "rank", header: "Sıra", align: "center", render: (d) => `${d.rank}.` },
                  { key: "at", header: "Tarih", hideOnMobile: true, render: (d) => <Time at={d.createdAt} /> },
                ]}
              />
              {data.incoming.length > data.cap ? (
                <Alert tone="warning">Size verilen vekâlet sayısı sınırı ({data.cap}) aşıyor; bir oylamada en fazla {data.cap} kişinin tercihini taşıyabilirsiniz.</Alert>
              ) : null}
            </section>
          ) : data.outgoing.length && emptyLine ? (
            <p className="acct-empty">{emptyLine}</p>
          ) : null}

          {auth.can("V") ? (
            formOpen ? (
              <section className="stack-sm" aria-label="Yeni vekâlet">
                <h3 className="h3 mt-0">Yeni vekâlet</h3>
                <DelegationForm
                  onCreated={(d) => {
                    setFormOpen(false);
                    setData((prev) => prev && { ...prev, outgoing: [...prev.outgoing.filter((x) => !(x.scope === d.scope && x.rank === d.rank)), d] });
                  }}
                />
                <div>
                  <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>
                    Vazgeç
                  </Button>
                </div>
              </section>
            ) : (
              <div>
                <Button icon="plus" onClick={() => setFormOpen(true)}>
                  Yeni vekâlet ver
                </Button>
              </div>
            )
          ) : (
            <p className="small muted">Vekâlet vermek için kimliğinizin doğrulanmış olması gerekir.</p>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function ExpertStatusCard({ me }: { me: Me }) {
  const { data, loading } = useAsync(() => listExperts(), [me.id]);
  const own = data?.find((e) => e.userId === me.id);
  return (
    <Card title="Bilirkişilik" collapsible anchor={PROFILE_ANCHORS.bilirkisilik} summary={expertSummary(own, !!data)}>
      {loading && !data ? (
        <Spinner />
      ) : own ? (
        <div className="stack-sm">
          <div className="row">
            <ExpertStatusBadge status={own.status} />
            <span className="muted small">
              Aktif görev: {own.activeAssignments} · Tamamlanan rapor: {own.completedReports}
            </span>
          </div>
          <DomainChips domains={own.domains} />
          {own.status === "active" || own.status === "suspended" ? <ReputationBar value={own.reputation} /> : null}
          <div className="row">
            {own.status === "active" ? (
              <LinkButton size="sm" to="/bilirkisiler?sekme=gorevlerim">
                Görevlerim
              </LinkButton>
            ) : null}
            {own.status === "rejected" || own.status === "removed" ? (
              <LinkButton size="sm" to="/bilirkisiler?sekme=basvur">
                Yeniden başvur
              </LinkButton>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="row-between">
          <span className="muted">
            <Term id="bilirkisi">Bilirkişi</Term> değilsiniz.
          </span>
          {me.status === "verified" ? (
            <LinkButton size="sm" to="/bilirkisiler?sekme=basvur">
              Bilirkişi olarak başvur
            </LinkButton>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function NicknameCard({ me }: { me: Me }) {
  const auth = useAuth();
  const toast = useToast();
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = nickname.normalize("NFKC").trim();
    const errs: Record<string, string> = {};
    // Kayıt formuyla aynı kural (sunucudaki nicknameSchema): uzunluk, izinli karakterler, en az bir harf ya da rakam.
    const ruleError = nicknameError(next);
    if (ruleError) errs.nickname = ruleError;
    else if (next === me.nickname) errs.nickname = "Yeni takma ad mevcut takma adınızla aynı.";
    if (!password) errs.password = "Şifrenizi yazın.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const updated = await changeNickname({ nickname: next, password });
      auth.setUser(updated);
      toast.success(`Takma adınız @${updated.nickname} olarak değiştirildi.`);
      setNickname("");
      setPassword("");
    } catch (err) {
      if (err instanceof ApiError && err.details && typeof err.details === "object") {
        const d = err.details as Record<string, unknown>;
        const mapped: Record<string, string> = {};
        if (typeof d.nickname === "string") mapped.nickname = d.nickname;
        if (typeof d.password === "string") mapped.password = d.password;
        setErrors(mapped);
      }
      toast.error(err, "Takma ad değiştirilemedi");
    } finally {
      setBusy(false);
    }
  };

  if (me.status === "suspended") {
    return (
      <Card title="Takma ad değiştir" collapsible anchor={PROFILE_ANCHORS.takmaAd} summary={nicknameSummary(me.nickname, true)}>
        <p className="muted small mt-0">Hesabınız askıdayken takma adınız değiştirilemez.</p>
      </Card>
    );
  }
  return (
    <Card
      title="Takma ad değiştir"
      collapsible
      anchor={PROFILE_ANCHORS.takmaAd}
      summary={nicknameSummary(me.nickname, false)}
      subtitle="Forumda yalnızca takma adınız görünür. Mesajlarınız, önerileriniz ve size ait kayıtlar yeni takma adınızla görünür; takma ad deftere yazılmaz."
    >
      <form className="stack" onSubmit={submit} noValidate>
        <div className="form-grid">
          <Input
            label="Yeni takma ad"
            autoComplete="username"
            value={nickname}
            maxLength={32}
            hint="3–32 karakter: harf (Türkçe harfler dahil), rakam, nokta, alt çizgi, tire. 30 günde en çok bir kez değiştirilebilir. Kayıtlı bir takma ada çok benzeyenler (büyük/küçük harf, ş/s, 0/o, ayraç farkı) kabul edilmez."
            error={errors.nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
          <Input
            label="Şifreniz (teyit için)"
            type="password"
            autoComplete="current-password"
            value={password}
            error={errors.password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={busy}>
            Takma adı değiştir
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const toast = useToast();
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [again, setAgain] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!oldPassword) errs.oldPassword = "Mevcut şifrenizi yazın.";
    if (newPassword.length < 8) errs.newPassword = "Şifre en az 8 karakter olmalıdır.";
    else if (!/\p{L}/u.test(newPassword) || !/\p{N}/u.test(newPassword)) errs.newPassword = "Şifre en az bir harf ve bir rakam içermelidir.";
    if (again !== newPassword) errs.again = "Yeni şifreler aynı değil.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await changePassword({ oldPassword, newPassword });
      toast.success("Şifreniz değiştirildi. Diğer cihazlardaki oturumlarınız kapatıldı.");
      setOld("");
      setNew("");
      setAgain("");
    } catch (err) {
      if (err instanceof ApiError && err.details && typeof err.details === "object") {
        const d = err.details as Record<string, unknown>;
        const mapped: Record<string, string> = {};
        if (typeof d.oldPassword === "string") mapped.oldPassword = d.oldPassword;
        if (typeof d.newPassword === "string") mapped.newPassword = d.newPassword;
        if (typeof d.password === "string") mapped.oldPassword = d.password;
        setErrors(mapped);
      }
      toast.error(err, "Şifre değiştirilemedi");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Şifre değiştir" collapsible anchor={PROFILE_ANCHORS.sifre} summary={PASSWORD_SUMMARY}>
      <form className="stack" onSubmit={submit} noValidate>
        <Input label="Mevcut şifre" type="password" autoComplete="current-password" value={oldPassword} error={errors.oldPassword} onChange={(e) => setOld(e.target.value)} />
        <div className="form-grid">
          <Input
            label="Yeni şifre"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            hint="En az 8 karakter; en az bir harf ve bir rakam."
            error={errors.newPassword}
            onChange={(e) => setNew(e.target.value)}
          />
          <Input label="Yeni şifre (tekrar)" type="password" autoComplete="new-password" value={again} error={errors.again} onChange={(e) => setAgain(e.target.value)} />
        </div>
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={busy}>
            Şifreyi değiştir
          </Button>
        </div>
      </form>
    </Card>
  );
}

function KvkkCard({ me }: { me: Me }) {
  const auth = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [password, setPassword] = useState("");
  const canDownload = canDownloadFiles();

  const doExport = async () => {
    setExporting(true);
    try {
      const data = await exportMyData();
      const text = JSON.stringify(data, null, 2);
      setExported(text);
      if (!canDownload) {
        // Android uygulaması: dosya indirilemez; "indirildi" denmez, kopyalama seçeneği gösterilir.
        toast.info("Döküm hazır. Bu cihazda dosya indirilemiyor; “Dökümü kopyala” düğmesiyle alabilirsiniz.");
        return;
      }
      const ok = downloadJson(`kvkk-verilerim-${me.nickname}.json`, data);
      if (ok) toast.success("Veri dökümünüz indirildi.");
      else toast.warning("Döküm hazır ama dosya indirilemedi; aşağıdaki “Dökümü kopyala” düğmesini kullanın.");
    } catch (e) {
      toast.error(e, "Döküm alınamadı");
    } finally {
      setExporting(false);
    }
  };

  // Onay penceresi kartın gövdesinin dışında durur: gövde katlıyken (hidden) üst katmanda açılacak pencere kaybolmasın.
  return (
    <>
      <Card title="Kişisel verilerim (KVKK)" collapsible anchor={PROFILE_ANCHORS.kvkk} summary={KVKK_SUMMARY} subtitle="6698 sayılı Kanun m. 11 kapsamındaki haklarınız.">
        <div className="stack">
          <Details summary="Aydınlatma metni">
            <KvkkNotice />
          </Details>

          <section className="stack-sm" aria-label="Veri dökümü">
            <h3 className="h3 mt-0">{canDownload ? "Verimi indir" : "Veri dökümüm"}</h3>
            <p className="mt-0 small muted">
              Hesabınız, kimlik verileriniz (şifresi çözülmüş), rızalarınız ve platform kayıtlarınız JSON olarak{" "}
              {canDownload ? "indirilir" : "hazırlanır; bu cihazda dosya indirilemediği için dökümü kopyalayıp güvendiğiniz bir yere yapıştırabilirsiniz"}.
              Döküm yalnızca size verilir.
            </p>
            <div className="row">
              <Button loading={exporting} onClick={() => void doExport()}>
                {canDownload ? "Verimi indir (JSON)" : "Dökümü hazırla (JSON)"}
              </Button>
              {exported ? <CopyButton text={exported} label="Dökümü kopyala" /> : null}
            </div>
            {exported ? (
              <Details summary="Döküm içeriğini göster">
                <pre>{exported}</pre>
              </Details>
            ) : null}
          </section>

          <section className="stack-sm" aria-label="Hesabı sil">
            <h3 className="h3 mt-0">Hesabımı sil</h3>
            <Alert tone="warning">Kimlik verileriniz geri döndürülemez biçimde imha edilir (kripto-imha: size özel şifreleme anahtarı silinir).</Alert>
            <Details summary="Hesap silinince ne olur?">
              <p className="mt-0 small">
                Mesajlarınız silinmez, “Silinmiş üye” olarak görünür; defterdeki özetler zinciri bozmadan kalır. Verdiğiniz ve size verilen vekâletler geri
                alınır. Bu işlem oylamaya konmaz.
              </p>
            </Details>
            <div>
              <Button variant="danger" onClick={() => setEraseOpen(true)}>
                Hesabımı sil…
              </Button>
            </div>
          </section>
        </div>
      </Card>
      <ConfirmDialog
        open={eraseOpen}
        title="Hesabınız kalıcı olarak silinecek"
        tone="danger"
        confirmLabel="Hesabımı sil"
        requireText="SİL"
        confirmDisabled={!password}
        message={
          <p className="mt-0">
            Bu işlem geri alınamaz. Kimlik verileriniz imha edilir; mesajlarınız “Silinmiş üye” adıyla kalır. Bu işlem oylamaya konmaz.
          </p>
        }
        onClose={() => {
          setEraseOpen(false);
          setPassword("");
        }}
        onConfirm={async () => {
          try {
            await eraseMe({ confirm: "SİL", password });
          } catch (e) {
            throw new Error(e instanceof ApiError && e.code === "wrong_password" ? "Şifre hatalı." : errorMessage(e));
          }
          toast.success("Hesabınız silindi ve kimlik verileriniz imha edildi.");
          await auth.logout();
          navigate("/", { replace: true });
        }}
      >
        <Input label="Şifreniz" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </ConfirmDialog>
    </>
  );
}
