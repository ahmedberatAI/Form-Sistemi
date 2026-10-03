// Ayarlar: Görünüm (tema ve görünüm yoğunluğu) → Sunucu bağlantısı → Bu cihazdaki oy makbuzları; seyrek gereken tanılama 'Gelişmiş' başlığı
// altında katlı kartlardır (Doğrulayıcı anahtarları, Uygulama hakkında; 'Tam' görünümde açık). Derin bağlantı: ?bolum=anahtarlar
// (components/system/accountLogic.ts › SETTINGS_ANCHORS); PinNotice 'Ayarlar › Gelişmiş' bağlantısı oraya gider.
import { useEffect, useState, type FormEvent } from "react";
import { SURUM } from "@forum/shared";
import { defaultServerUrl, getSavedServerUrl, getServerUrl, NATIVE_DEFAULT_SERVER, normalizeServerUrl, pingServer, setServerUrl } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { aboutSummary, pinsSummary, platformLabel, SETTINGS_ANCHORS } from "../components/system/accountLogic";
import "../components/system/account.css";
import { setTheme, getTheme, THEME_LABELS, type ThemeMode } from "../components/system/theme";
import { DETAIL_LEVEL_LABELS, useDetailLevel, type DetailLevel } from "../lib/detailLevel";
import { formatDateTime, shortHash } from "../lib/format";
import { isNativePlatform, platformName } from "../lib/prefs";
import { exportReceipts, listReceipts } from "../lib/receipts";
import { useSectionParam } from "../lib/sectionParam";
import { listPinnedValidators, resetPinnedValidators, type PinnedValidators } from "../lib/validators";
import { Alert, Button, Card, CopyButton, Input, KeyValue, PageHeader, RadioGroup, Section, Table, Term, useConfirm, useToast } from "../ui";

function ServerCard() {
  const auth = useAuth();
  const toast = useToast();
  const [value, setValue] = useState("");
  const [active, setActive] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const native = isNativePlatform();
  const def = defaultServerUrl();

  useEffect(() => {
    void (async () => {
      setValue((await getSavedServerUrl()) ?? "");
      setActive(await getServerUrl());
      setLoaded(true);
    })();
  }, []);

  const validate = (v: string): string | undefined => {
    const t = v.trim();
    if (!t) return undefined;
    if (!/^https?:\/\/[^\s/]+(:\d+)?(\/.*)?$/i.test(t)) return "Adres http:// ya da https:// ile başlamalı (ör. http://10.0.2.2:4000).";
    return undefined;
  };

  const runTest = async () => {
    const err = validate(value);
    setError(err);
    if (err) return;
    setTesting(true);
    setTest(null);
    const res = await pingServer(value.trim() ? value : def);
    setTest(res);
    setTesting(false);
  };

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    const err = validate(value);
    setError(err);
    if (err) return;
    setSaving(true);
    try {
      await setServerUrl(value.trim() || null);
      const now = await getServerUrl();
      setActive(now);
      setValue(value.trim() ? normalizeServerUrl(value) : "");
      toast.success("Sunucu adresi kaydedildi.");
      await auth.refreshSystem();
      if (auth.token) await auth.refresh().catch(() => undefined);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setValue("");
    setError(undefined);
    setTest(null);
    await setServerUrl(null);
    setActive(await getServerUrl());
    toast.info("Varsayılan sunucu adresine dönüldü.");
    await auth.refreshSystem();
  };

  return (
    <Card title="Sunucu bağlantısı" anchor={SETTINGS_ANCHORS.sunucu} subtitle={native ? "Android uygulaması bilgisayardaki sunucuya bu adresle bağlanır." : "Boş bırakılırsa web sitesinin sunulduğu adres kullanılır."}>
      <form className="stack" onSubmit={save} noValidate>
        <Input
          label="Sunucu adresi"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={def || "(aynı köken)"}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setTest(null);
          }}
          error={error}
          hint={
            native
              ? `Emülatörde varsayılan ${NATIVE_DEFAULT_SERVER} (bilgisayarın localhost'u). Gerçek cihazda bilgisayarın yerel ağ adresini girin (ör. http://192.168.1.20:4000).`
              : "Örnek: http://localhost:4000. Geliştirme sunucusunda (Vite) boş bırakın; /api istekleri otomatik yönlendirilir."
          }
          disabled={!loaded}
        />
        <p className="small muted">
          Etkin adres: <code>{active || "(aynı köken)"}</code>
        </p>
        <div className="row">
          <Button type="submit" variant="primary" loading={saving} disabled={!loaded}>
            Kaydet
          </Button>
          <Button onClick={runTest} loading={testing} icon="refresh" disabled={!loaded}>
            Bağlantıyı sına
          </Button>
          <Button variant="ghost" onClick={reset} disabled={!loaded}>
            Varsayılana dön
          </Button>
        </div>
        {test ? (
          <Alert tone={test.ok ? "success" : "error"} title={test.ok ? "Sunucuya ulaşıldı" : "Bağlantı başarısız"}>
            {test.message}
          </Alert>
        ) : null}
      </form>
    </Card>
  );
}

function ThemeCard() {
  const [mode, setMode] = useState<ThemeMode>(getTheme());
  const { level, setLevel } = useDetailLevel();
  return (
    <Card title="Görünüm" anchor={SETTINGS_ANCHORS.gorunum}>
      <div className="stack">
        <RadioGroup<ThemeMode>
          label="Tema"
          value={mode}
          layout="inline"
          onChange={(m) => {
            setMode(m);
            void setTheme(m);
          }}
          options={(["light", "dark", "system"] as ThemeMode[]).map((m) => ({ value: m, label: THEME_LABELS[m] }))}
        />
        <RadioGroup<DetailLevel>
          label="Görünüm yoğunluğu"
          value={level}
          onChange={setLevel}
          options={[
            { value: "sade", label: DETAIL_LEVEL_LABELS.sade, hint: "Ayrıntı kartları, açılırlar ve uzun metinler kapalı ya da kısa başlar; hepsi tek dokunuşla açılır." },
            { value: "tam", label: DETAIL_LEVEL_LABELS.tam, hint: "Bütün kartlar, açılırlar ve uzun metinler açık gelir (ayrıntıları baştan görmek isteyenler için)." },
          ]}
        />
      </div>
    </Card>
  );
}

function ValidatorsCard() {
  const toast = useToast();
  const confirm = useConfirm();
  const [pins, setPins] = useState<PinnedValidators[] | null>(null);
  const load = async () => setPins(await listPinnedValidators());
  useEffect(() => {
    void load();
  }, []);

  const reset = async () => {
    const ok = await confirm({
      title: "Sabitlenmiş anahtarlar sıfırlansın mı?",
      message:
        "Bir sonraki oy doğrulamasında sunucunun bildirdiği doğrulayıcı anahtarları yeniden sabitlenecek. Bunu yalnızca anahtarların meşru biçimde değiştiğinden eminseniz (ör. sunucu yeniden kuruldu) yapın.",
      confirmLabel: "Sıfırla",
      tone: "danger",
    });
    if (!ok) return;
    await resetPinnedValidators(true);
    await load();
    toast.success("Sabitlenmiş doğrulayıcı anahtarları silindi.");
  };

  // Başlıkta TOFU/Ed25519 geçmez (ilk ekranda jargon yok); terimler gövdede sözlük düğmesiyle açıklanır. Sıfırlama gövdenin altlığındadır:
  // kapalıyken görünmez (1 dokunuş), açıkken onay penceresi ister.
  return (
    <Card
      title="Doğrulayıcı anahtarları"
      headingLevel={3}
      collapsible
      anchor={SETTINGS_ANCHORS.anahtarlar}
      summary={pinsSummary(pins)}
      subtitle={
        <>
          Oy makbuzları, <Term id="dagitik-defter">dağıtık defterin</Term> <Term id="dogrulayici">doğrulayıcı</Term> imzalarıyla cihazınızda doğrulanır. Anahtarlar
          ilk kullanımda sabitlenir (<Term id="tofu">TOFU</Term>); sunucu sonradan farklı anahtar bildirirse uyarılırsınız.
        </>
      }
      footer={
        pins && pins.length ? (
          <Button variant="danger" size="sm" onClick={reset}>
            Sıfırla
          </Button>
        ) : null
      }
    >
      {pins === null ? null : pins.length === 0 ? (
        <p className="muted mt-0">Henüz sabitlenmiş anahtar yok. İlk oy doğrulamasında sabitlenecek.</p>
      ) : (
        <div className="stack">
          {pins.map((p) => (
            <div key={p.serverUrl || "same"} className="stack-sm">
              <KeyValue
                compact
                items={[
                  { label: "Sunucu", value: <code>{p.serverUrl || "(aynı köken)"}</code> },
                  { label: "Zincir", value: <code>{p.chainId}</code> },
                  { label: "Sabitlenme", value: formatDateTime(p.pinnedAt) },
                ]}
              />
              <Table
                caption={`${p.serverUrl || "aynı köken"} doğrulayıcıları`}
                rows={p.validators}
                rowKey={(v) => v.id}
                columns={[
                  { key: "id", header: "Doğrulayıcı" },
                  {
                    key: "publicKey",
                    header: (
                      <>
                        Açık anahtar (<Term id="ed25519">Ed25519</Term>)
                      </>
                    ),
                    render: (v) => <code className="hash" title={v.publicKey}>{shortHash(v.publicKey, 16)}</code>,
                  },
                ]}
              />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ReceiptsCard() {
  const [count, setCount] = useState<number | null>(null);
  const [json, setJson] = useState("");
  useEffect(() => {
    void (async () => {
      setCount((await listReceipts()).length);
      setJson(await exportReceipts());
    })();
  }, []);
  return (
    <Card title="Bu cihazdaki oy makbuzları" anchor={SETTINGS_ANCHORS.makbuzlar} subtitle="Makbuzlar yalnızca bu cihazda saklanır; “Oyum kayıtlı mı?” sayfasında oyunuzu bağımsız olarak doğrulamak için kullanılır.">
      <div className="row">
        <span>{count === null ? "…" : `${count} makbuz`}</span>
        {count ? <CopyButton text={json} label="Makbuzları kopyala (JSON yedek)" /> : null}
      </div>
    </Card>
  );
}

function AboutCard() {
  const auth = useAuth();
  const sys = auth.system;
  const platform = platformName();
  return (
    <Card title="Uygulama hakkında" headingLevel={3} collapsible anchor={SETTINGS_ANCHORS.hakkinda} summary={aboutSummary(SURUM, platform)}>
      <KeyValue
        items={[
          { label: "İstemci sürümü", value: SURUM },
          { label: "Platform", value: platformLabel(platform) },
          { label: "Sunucu sürümü", value: sys?.version ?? "—" },
          { label: "Sunucu (simüle) saati", value: sys ? formatDateTime(sys.now) : "—", hint: sys && sys.clockOffsetMs ? "Yönetici saati ileri aldı; tüm süreler bu saate göredir." : undefined },
          { label: "Zaman ölçeği", value: sys ? `×${sys.timeScale} (süreler bu katsayıya bölünür)` : "—" },
          { label: "Yapay zekâ", value: sys ? (sys.aiMode === "claude" ? `Claude (${sys.aiModel})` : "Çevrimdışı sezgisel mod") : "—" },
          { label: "Yönetmelik sürümü", value: sys ? `v${sys.bylawVersion}` : "—" },
        ]}
      />
    </Card>
  );
}

export default function SettingsPage() {
  // ?bolum=anahtarlar | hakkinda | gorunum … : kartı açar, kaydırır, odağı taşır ve parametreyi siler.
  useSectionParam(true);
  return (
    <div className="page">
      <PageHeader title="Ayarlar" subtitle="Bu ayarlar yalnızca bu cihazda saklanır." />
      <div className="grid-2">
        <ThemeCard />
        <ServerCard />
        <ReceiptsCard />
      </div>
      <Section id={SETTINGS_ANCHORS.gelismis} className="acct-advanced" title="Gelişmiş" description="Seyrek gereken tanılama ve cihaz bilgileri; başlıklara dokunarak açın.">
        <div className="grid-2">
          <ValidatorsCard />
          <AboutCard />
        </div>
      </Section>
    </div>
  );
}
