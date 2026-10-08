// Profil ve Ayarlar (Faz 3 / madde 5): oy hakkı kartı ve tek eylemi, seyrek kartların katlanması ('Tam' görünümde açık), kapalı başlık
// hükümleri, derin bağlantı çapaları (?bolum=kvkk | duzeltme | anahtarlar), Gelişmiş altına taşınan TOFU/Ed25519 ve PinNotice bağlantısı.
// Sunucu tarafı çizimle denetlenir (DOM gerekmez). Yeni düğme/bağlantı/bölge adları e2e'nin aradığı adlarla çakışmamalıdır
// (alt dize, büyük/küçük harf duyarsız); belgeleme aracının açtığı Profil başlıkları ve Ayarlar'daki radyo adları aynen kalır.
import type { Me, SystemInfo } from "@forum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DetailLevelProvider } from "../../lib/detailLevel";
import { PREF_KEYS, removePref, setPrefSync } from "../../lib/prefs";
import { parseSectionParam } from "../../lib/sectionParam";
import { ToastProvider } from "../../ui/Toast";
import type { ensurePinnedValidators } from "../../lib/validators";

const auth = vi.hoisted(() => ({ user: null as unknown, system: null as unknown }));

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    user: auth.user,
    system: auth.system,
    token: null,
    can: () => true,
    setUser: () => undefined,
    logout: async () => undefined,
    refresh: async () => null,
    refreshSystem: async () => null,
    now: () => Date.UTC(2026, 9, 3),
  }),
  useServerNow: () => () => Date.UTC(2026, 9, 3),
}));

import ProfilePage, { VoteRightCard } from "../../pages/ProfilePage";
import SettingsPage from "../../pages/SettingsPage";
import {
  aboutSummary,
  correctionSummary,
  emptyDelegationLine,
  expertSummary,
  nicknameSummary,
  PROFILE_ANCHORS,
  pinsSummary,
  platformLabel,
  profileHref,
  SETTINGS_ANCHORS,
  settingsHref,
  voteRightOf,
  CONSENT_TEXT,
  ERASED_TEXT,
  MINOR_TEXT,
  PENDING_TEXT,
  REJECTED_TEXT,
  SUSPENDED_TEXT,
} from "./accountLogic";
import { PinNotice } from "./pinned";

const render = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <DetailLevelProvider>
      <ToastProvider>
        <MemoryRouter>{el}</MemoryRouter>
      </ToastProvider>
    </DetailLevelProvider>,
  );

const strip = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** Bir HTML parçasındaki bağlantı/düğme/özet/başlık görünür adları (etiketler atılmış). */
function namesOf(html: string, tag: "a" | "button" | "summary" | "h2" | "h3"): string[] {
  return [...html.matchAll(new RegExp(`<${tag}[ >][\\s\\S]*?</${tag}>`, "g"))].map((m) => strip(m[0]));
}

// e2e/tests/*.spec.ts'in düğme/bağlantı/bölge adı olarak aradığı dizeler: yeni adlar bunları içermemeli.
const RESERVED = ["destekle", "oyumu ver", "daha fazla", "sayımı kendim doğrulayayım", "kapat"];
const reserved = (names: string[]) => names.filter((n) => RESERVED.some((r) => n.toLowerCase().includes(r)));

const me = (over: Partial<Me> = {}): Me => ({
  id: "u-ayse",
  nickname: "ayse",
  status: "verified",
  roles: ["member"],
  isExpert: false,
  expertDomains: [],
  reputation: 0,
  joinedAt: Date.UTC(2026, 8, 1),
  clusterId: null,
  isAdult: true,
  aiConsent: false,
  politicalConsent: true,
  ...over,
});

const system = (over: Partial<SystemInfo> = {}): SystemInfo => ({
  version: "1.4.0",
  now: Date.UTC(2026, 9, 2, 12, 0),
  clockOffsetMs: 0,
  timeScale: 10,
  aiMode: "offline",
  aiModel: "claude-x",
  ledger: { height: 345, validators: 4, healthy: 4 },
  bylawVersion: 2,
  members: { verified: 57, pending: 3 },
  ...over,
});

beforeEach(async () => {
  await removePref(PREF_KEYS.detail);
  auth.user = me();
  auth.system = system();
});

describe("voteRightOf: oy hakkı ve üyenin elindeki tek eylem", () => {
  it("doğrulanmış, 18 yaşından büyük ve rızası var → oy hakkı var, eksik ve eylem yok", () => {
    expect(voteRightOf(me())).toEqual({ can: true, missing: [], action: null });
  });

  it("rıza yok → tek eksik, tek eylem: siyasi görüş rızası", () => {
    expect(voteRightOf(me({ politicalConsent: false }))).toEqual({ can: false, missing: [CONSENT_TEXT], action: "consent" });
  });

  it("bekleyen hesap: kayıt memuru onayı beklenir (eylem yok); rıza da yoksa yalnız rıza eylemi çıkar", () => {
    expect(voteRightOf(me({ status: "pending" }))).toEqual({ can: false, missing: [PENDING_TEXT], action: null });
    const both = voteRightOf(me({ status: "pending", politicalConsent: false }));
    expect(both.missing).toEqual([PENDING_TEXT, CONSENT_TEXT]);
    expect(both.action).toBe("consent");
  });

  it("18 yaşından küçük üyeden rıza istenmez (bir şeyi değiştirmez); eylem yok", () => {
    expect(voteRightOf(me({ isAdult: false, politicalConsent: false }))).toEqual({ can: false, missing: [MINOR_TEXT], action: null });
    expect(voteRightOf(me({ isAdult: false }))).toEqual({ can: false, missing: [MINOR_TEXT], action: null });
  });

  it("askıdaki, reddedilmiş ve silinmiş hesapta yalnız hesap durumu söylenir; rıza eylemi yok", () => {
    const text = { suspended: SUSPENDED_TEXT, rejected: REJECTED_TEXT, erased: ERASED_TEXT } as const;
    for (const status of ["suspended", "rejected", "erased"] as const) {
      expect(voteRightOf(me({ status, politicalConsent: false, isAdult: false })), status).toEqual({ can: false, missing: [text[status]], action: null });
    }
  });

  it("koşullar sunucudaki kuralla aynı: doğrulanmış + yetişkin + rıza (AuthContext.isVoter ile aynı)", () => {
    for (const status of ["pending", "verified", "suspended", "rejected", "erased"] as const) {
      for (const isAdult of [true, false]) {
        for (const politicalConsent of [true, false]) {
          const m = me({ status, isAdult, politicalConsent });
          expect(voteRightOf(m).can, `${status} ${isAdult} ${politicalConsent}`).toBe(status === "verified" && isAdult && politicalConsent);
        }
      }
    }
  });
});

describe("kapalı kart hükümleri ('Kapalı başlık cevap verir')", () => {
  it("bilirkişilik: yüklenmeden hüküm yok; kayıt yoksa 'değilsiniz'; kayıt varsa durum ve sayılar", () => {
    expect(expertSummary(undefined, false)).toBeUndefined();
    expect(expertSummary(undefined, true)).toBe("Bilirkişi değilsiniz.");
    expect(expertSummary({ status: "active", activeAssignments: 2, completedReports: 5 }, true)).toBe("Listede (aktif) · aktif görev 2 · tamamlanan rapor 5");
  });

  it("kimlik düzeltme: bekleyen talep sayısı; hiç yoksa 'Açık talep yok'; kapalı hesapta açılamaz", () => {
    expect(correctionSummary(undefined, false)).toBeUndefined();
    expect(correctionSummary([], false)).toBe("Açık talep yok.");
    expect(correctionSummary([{ status: "approved" }, { status: "withdrawn" }], false)).toBe("Açık talep yok · geçmiş talep: 2");
    expect(correctionSummary([{ status: "pending" }, { status: "rejected" }], false)).toBe("Kayıt memurunda bekleyen 1 talebiniz var.");
    expect(correctionSummary(undefined, true)).toBe("Bu hesap için düzeltme talebi açılamaz.");
  });

  it("boş vekâlet listeleri tek satıra iner; dolu yönün notu çıkmaz", () => {
    expect(emptyDelegationLine(0, 0)).toBe("Henüz vekâlet vermediniz ve size verilmiş vekâlet yok.");
    expect(emptyDelegationLine(0, 2)).toMatch(/^Henüz vekâlet vermediniz/);
    expect(emptyDelegationLine(1, 0)).toBe("Size verilmiş vekâlet yok.");
    expect(emptyDelegationLine(1, 3)).toBeNull();
  });

  it("doğrulayıcı anahtarları: yüklenirken hüküm yok; boşken ilk doğrulamada sabitlenir; doluyken sunucu ve anahtar sayısı", () => {
    expect(pinsSummary(null)).toBeUndefined();
    expect(pinsSummary([])).toMatch(/Henüz sabitlenmiş anahtar yok/);
    expect(pinsSummary([{ validators: [1, 2, 3, 4] }, { validators: [1] }])).toBe("2 sunucu için 5 doğrulayıcı anahtarı bu cihaza sabitlenmiş.");
  });

  it("uygulama hakkında ve takma ad hükümleri", () => {
    expect(platformLabel("web")).toBe("Web tarayıcısı");
    expect(platformLabel("android")).toBe("Yerel uygulama (android)");
    expect(aboutSummary("1.0.0", "web")).toBe("İstemci sürümü 1.0.0 · Web tarayıcısı");
    expect(nicknameSummary("ayse", false)).toBe("Şu an @ayse · 30 günde en çok bir kez değiştirilebilir.");
    expect(nicknameSummary("ayse", true)).toMatch(/askıdayken/);
  });

  it("jargon yok: başlıklarda ve ilk ekran hükümlerinde TOFU / Ed25519 geçmez", () => {
    for (const t of [pinsSummary([]), pinsSummary([{ validators: [1] }]), aboutSummary("1.0.0", "web")]) expect(t).not.toMatch(/TOFU|Ed25519/);
  });
});

describe("derin bağlantılar", () => {
  it("her çapa ?bolum= kuralına uyar ve bağlantılar doğru yola gider", () => {
    for (const a of [...Object.values(PROFILE_ANCHORS), ...Object.values(SETTINGS_ANCHORS)]) expect(parseSectionParam(a), a).toBe(a);
    expect(profileHref()).toBe("/profil");
    expect(profileHref("kvkk")).toBe("/profil?bolum=kvkk");
    expect(profileHref("duzeltme")).toBe("/profil?bolum=duzeltme");
    expect(profileHref(PROFILE_ANCHORS.rizalar)).toBe("/profil?bolum=rizalar");
    expect(settingsHref()).toBe("/ayarlar");
    expect(settingsHref("anahtarlar")).toBe("/ayarlar?bolum=anahtarlar");
  });

  it("çapalar benzersiz", () => {
    const all = [...Object.values(PROFILE_ANCHORS), ...Object.values(SETTINGS_ANCHORS)];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("VoteRightCard", () => {
  it("oy hakkı varsa başlık 'Oy hakkınız: Var', yeşil hüküm, düğme yok", () => {
    const html = render(<VoteRightCard me={me()} />);
    expect(namesOf(html, "h2")).toEqual(["Oy hakkınız: Var"]);
    expect(html).toContain("card-summary-success");
    expect(html).toContain('id="oy-hakki"');
    expect(namesOf(html, "button")).toEqual([]);
  });

  it("rıza eksikse 'Oy hakkınız: Yok', eksik koşul listesi ve TEK birincil düğme: Siyasi görüş rızası ver", () => {
    const html = render(<VoteRightCard me={me({ politicalConsent: false })} />);
    expect(namesOf(html, "h2")).toEqual(["Oy hakkınız: Yok"]);
    expect(html).toContain("card-summary-warning");
    expect(namesOf(html, "button")).toEqual(["Siyasi görüş rızası ver"]);
    expect(html).toContain("btn-primary");
    expect(strip(html)).toContain(CONSENT_TEXT);
    expect(html).toContain('aria-label="Eksik koşullar"');
  });

  it("kayıt memuru onayı, askı ve 18 yaş engellerinde düğme çıkmaz; bekleyen hesapta onay beklenir ve rıza eylemi kalır", () => {
    for (const over of [{ status: "pending" }, { status: "suspended" }, { status: "rejected" }, { isAdult: false }] as Partial<Me>[]) {
      const html = render(<VoteRightCard me={me({ politicalConsent: true, ...over })} />);
      expect(namesOf(html, "button"), JSON.stringify(over)).toEqual([]);
      expect(namesOf(html, "h2")).toEqual(["Oy hakkınız: Yok"]);
    }
    const pending = render(<VoteRightCard me={me({ status: "pending", politicalConsent: false })} />);
    expect(strip(pending)).toContain("Kayıt memuru onayı bekleniyor.");
    expect(namesOf(pending, "button")).toEqual(["Siyasi görüş rızası ver"]);
  });

  it("rıza isteği sürerken düğme kilitli (aria-busy + aria-disabled); yerel disabled yok, odak düğmede kalır (WCAG 2.4.3)", () => {
    const html = render(<VoteRightCard me={me({ politicalConsent: false })} busy />);
    expect(html).toMatch(/<button[^>]*aria-busy="true"[^>]*aria-disabled="true"/);
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
  });

  it("düğme adı e2e'nin aradığı dizeleri içermez", () => {
    expect(reserved(["Siyasi görüş rızası ver"])).toEqual([]);
  });
});

describe("ProfilePage", () => {
  const profile = () => render(<ProfilePage />);

  it("oy hakkı kartı en üstte; ardından Hesap özeti, Açık rızalar, Vekâletler; seyrek işler sonda (belgeleme aracının aradığı başlıklar aynen)", () => {
    const h2 = namesOf(profile(), "h2").filter((t) => t !== "Profilim");
    expect(h2).toEqual([
      "Oy hakkınız: Var",
      "Hesap özeti",
      "Açık rızalar",
      "Vekâletler",
      "Listem",
      "Bilirkişilik",
      "Takma ad değiştir",
      "Şifre değiştir",
      "Kişisel verilerim (KVKK)",
      "Kimlik bilgilerimi düzelt",
    ]);
  });

  it("sade görünümde beş seyrek kart katlı: başlık h2 içinde düğme (aria-expanded=false); açık kalan kartlarda düğme yok", () => {
    const html = profile();
    const toggles = [...html.matchAll(/<h2[^>]*><button[^>]*class="card-toggle"[^>]*aria-expanded="(true|false)"[^>]*>([\s\S]*?)<\/button><\/h2>/g)].map((m) => [strip(m[2]), m[1]]);
    expect(toggles).toEqual([
      ["Bilirkişilik", "false"],
      ["Takma ad değiştir", "false"],
      ["Şifre değiştir", "false"],
      ["Kişisel verilerim (KVKK)", "false"],
      ["Kimlik bilgilerimi düzelt", "false"],
    ]);
    // Açık kalan kartlar katlanabilir değil
    for (const t of ["Oy hakkınız: Var", "Hesap özeti", "Açık rızalar", "Vekâletler"]) expect(html).toContain(`>${t}</h2>`);
  });

  it("'Tam' görünümde beş seyrek kartın hepsi açık gelir", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    const html = profile();
    expect(html.match(/class="card-toggle"[^>]*aria-expanded="true"/g)).toHaveLength(5);
    expect(html).not.toMatch(/class="card-toggle"[^>]*aria-expanded="false"/);
  });

  it("gövdeler DOM'da kalır (hidden): KVKK döküm düğmesi ve hesap silme kapalıyken de bulunur, odaklanamaz ama sayfa içi aramada bulunur", () => {
    const html = profile();
    expect(html).toContain("Hesabımı sil…");
    expect(html).toContain("Verimi indir (JSON)");
    expect(html).toContain("Düzeltme talebi aç");
    expect(html).toMatch(/id="kvkk"/);
    expect(html).toMatch(/id="duzeltme"/);
  });

  it("derin bağlantı çapaları kartlarda: kvkk, duzeltme, rizalar, vekaletler …", () => {
    const html = profile();
    for (const a of Object.values(PROFILE_ANCHORS)) expect(html, a).toContain(`id="${a}"`);
  });

  it("kapalı başlıkların yanında tek satır hüküm: takma ad, şifre, KVKK", () => {
    const text = strip(profile());
    expect(text).toContain("Şu an @ayse · 30 günde en çok bir kez değiştirilebilir.");
    expect(text).toContain("Değiştirince diğer cihazlardaki oturumlarınız kapanır.");
    expect(text).toContain("Verinizi indirebilir, aydınlatma metnini okuyabilir ya da hesabınızı silebilirsiniz.");
  });

  it("rıza kutuları ve etiketleri aynen; uzun YZ açıklaması 'nasıl işler?' açılırında, ilk cümle (yurt dışı aktarım) kutunun yanında", () => {
    const html = profile();
    const text = strip(html);
    expect(text).toContain("Siyasi görüş verisi (oy ve görüş) — oy kullanmak için gerekli");
    expect(text).toContain("Yapay zekâ analizi — varsayılan kapalı");
    expect(text).toContain("bu bir yurt dışına aktarımdır (KVKK m. 9)");
    expect(namesOf(html, "summary")).toContain("Yapay zekâ analizi nasıl işler?");
    // Açılırın içi ilk ekranda görünmez: sade kipte `open` yok
    expect(html).not.toMatch(/<details[^>]*open[^>]*>\s*<summary>Yapay zekâ analizi nasıl işler/);
  });

  it("Hesap özeti'nde 'Oy kullanabilir mi?' satırı yok (oy hakkı kartına taşındı); Görüş kümem sözlük terimi", () => {
    const text = strip(profile());
    expect(text).not.toContain("Oy kullanabilir mi?");
    expect(text).toContain("Görüş kümem");
    expect(profile()).toMatch(/<button[^>]*class="term"[^>]*>Görüş kümem<\/button>/);
  });

  it("Görüş kümem ipucu: ilk cümle görünür; yöntem ve köprü testindeki rolü silinmedi, adlandırılmış açılırda (sade kipte kapalı)", () => {
    const html = profile();
    expect(strip(html)).toContain("Kapanmış oylamalardaki oylarınıza göre hesaplanır; kümeler adsızdır.");
    expect(namesOf(html, "summary")).toContain("Görüş kümesi nasıl hesaplanır?");
    expect(html).not.toMatch(/<details[^>]*open[^>]*>\s*<summary>Görüş kümesi nasıl hesaplanır/);
    expect(strip(html)).toContain("(Polis benzeri kümeleme)");
    expect(strip(html)).toContain("köprü testinde her anlamlı kümeden asgari destek aranır");
  });

  it("rıza yokken oy hakkı kartında rıza düğmesi; rıza varken yok", () => {
    auth.user = me({ politicalConsent: false });
    expect(namesOf(profile(), "button")).toContain("Siyasi görüş rızası ver");
    auth.user = me();
    expect(namesOf(profile(), "button")).not.toContain("Siyasi görüş rızası ver");
  });

  it("bekleyen hesap: eski uyarı kutusu yok, durum oy hakkı kartında; erased/rejected hesapta düzeltme hükmü 'açılamaz'", () => {
    auth.user = me({ status: "pending", politicalConsent: false });
    const pending = profile();
    expect(pending).not.toContain("Hesabınız doğrulama bekliyor");
    expect(strip(pending)).toContain("Kayıt memuru onayı bekleniyor.");
    auth.user = me({ status: "rejected" });
    expect(strip(profile())).toContain("Bu hesap için düzeltme talebi açılamaz.");
  });

  it("askıdaki hesapta takma ad kartı katlı kalır ve değiştirilemeyeceğini söyler", () => {
    auth.user = me({ status: "suspended" });
    const text = strip(profile());
    expect(text).toContain("Hesabınız askıdayken takma adınız değiştirilemez.");
  });

  it("düğme ve bağlantı adları e2e'nin aradığı dizeleri içermez", () => {
    const html = profile();
    expect(reserved(namesOf(html, "button"))).toEqual([]);
    expect(reserved(namesOf(html, "a"))).toEqual([]);
    expect(reserved(namesOf(html, "summary"))).toEqual([]);
  });

  it("oturum yoksa yükleniyor göstergesi (kartlar çizilmez)", () => {
    auth.user = null;
    const html = profile();
    expect(html).not.toContain("card-toggle");
    expect(html).toContain("Yükleniyor");
  });
});

describe("SettingsPage", () => {
  const settings = () => render(<SettingsPage />);

  it("sıra: Görünüm → Sunucu bağlantısı → Bu cihazdaki oy makbuzları → Gelişmiş (içinde iki katlı kart)", () => {
    const html = settings();
    expect(namesOf(html, "h2").filter((t) => t !== "Ayarlar")).toEqual(["Görünüm", "Sunucu bağlantısı", "Bu cihazdaki oy makbuzları", "Gelişmiş"]);
    expect(namesOf(html, "h3")).toEqual(["Doğrulayıcı anahtarları", "Uygulama hakkında"]);
  });

  it("e2e'nin aradığı denetimler aynen: tema radyoları, 'Sade' ve 'Tam — tüm ayrıntılar açık' radyoları, 'Bağlantıyı sına'", () => {
    const html = settings();
    const labels = [...html.matchAll(/<label[^>]*class="check-label"[^>]*>([\s\S]*?)<\/label>/g)].map((m) => strip(m[1]));
    expect(labels).toEqual(["Açık", "Koyu", "Sistem ayarını izle", "Sade (önerilen)", "Tam — tüm ayrıntılar açık"]);
    expect(html).toMatch(/<legend[^>]*>Görünüm yoğunluğu<\/legend>/);
    expect(html).toMatch(/<legend[^>]*>Tema<\/legend>/);
    expect(namesOf(html, "button")).toContain("Bağlantıyı sına");
  });

  it("sade kipte Gelişmiş kartları katlı, 'Tam' kipte açık; başlıkları her zaman görünür", () => {
    const sade = settings();
    expect(sade.match(/class="card-toggle"[^>]*aria-expanded="false"/g)).toHaveLength(2);
    setPrefSync(PREF_KEYS.detail, "tam");
    const tam = settings();
    expect(tam.match(/class="card-toggle"[^>]*aria-expanded="true"/g)).toHaveLength(2);
    expect(namesOf(tam, "h3")).toEqual(["Doğrulayıcı anahtarları", "Uygulama hakkında"]);
  });

  it("ilk ekranda TOFU ve Ed25519 yok: Gelişmiş başlığına kadar hiçbiri geçmez, kapalı kartların başlık ve hükümlerinde de yok", () => {
    const html = settings();
    const before = html.slice(0, html.indexOf('id="gelismis"'));
    expect(strip(before)).not.toMatch(/TOFU|Ed25519/);
    const titles = [...html.matchAll(/<h3[\s\S]*?<\/h3>|<p class="card-summary"[\s\S]*?<\/p>/g)].map((m) => strip(m[0]));
    expect(titles.join(" ")).not.toMatch(/TOFU|Ed25519/);
  });

  it("TOFU ve Ed25519 gövdede sözlük terimi olarak durur (dokunulunca açıklanır)", () => {
    const html = settings();
    expect(html).toMatch(/<button[^>]*class="term"[^>]*>TOFU<\/button>/);
    expect(html).toMatch(/<button[^>]*class="term"[^>]*>doğrulayıcı<\/button>/);
  });

  it("Sıfırla düğmesi kartın altlığında (kapalıyken gizli); Uygulama hakkında hükmü sürüm ve platformu söyler", () => {
    const html = settings();
    expect(strip(html)).toContain("İstemci sürümü 1.0.0 · Web tarayıcısı");
    expect(html).toContain('id="anahtarlar"');
    expect(html).toContain('id="hakkinda"');
    expect(html).toContain('id="gelismis"');
  });

  it("düğme, bağlantı ve özet adları e2e'nin aradığı dizeleri içermez", () => {
    const html = settings();
    expect(reserved(namesOf(html, "button"))).toEqual([]);
    expect(reserved(namesOf(html, "a"))).toEqual([]);
    expect(reserved(namesOf(html, "summary"))).toEqual([]);
  });
});

describe("PinNotice", () => {
  type Pin = Awaited<ReturnType<typeof ensurePinnedValidators>>;
  const keys = { chainId: "c1", validators: [{ id: "v1", publicKey: "aa" }] };
  const base = { pinned: { ...keys, pinnedAt: 1, serverUrl: "" }, fresh: keys as unknown as Pin["fresh"] };

  it("anahtarlar değişmişse 'Ayarlar › Gelişmiş' bağlantısı Doğrulayıcı anahtarları kartını açan ?bolum=anahtarlar adresine gider", () => {
    const pin = { ...base, status: "changed", diff: { same: false, chainChanged: false, added: [], removed: [], changed: ["v1"] } } as Pin;
    const html = render(<PinNotice pin={pin} />);
    expect(html).toContain('href="/ayarlar?bolum=anahtarlar"');
    expect(namesOf(html, "a")).toEqual(["Ayarlar › Gelişmiş"]);
    expect(strip(html)).toContain("Sabitlemeyi Ayarlar › Gelişmiş bölümünden sıfırlayabilirsiniz.");
    expect(strip(html)).not.toContain("sayfasından sıfırlayabilirsiniz");
  });

  it("ilk sabitlemede 'ilk kullanımda güven' sözlük terimidir; eşleşmede bildirim yok", () => {
    const pinned = render(<PinNotice pin={{ ...base, status: "pinned_now", diff: { same: true, chainChanged: false, added: [], removed: [], changed: [] } } as Pin} />);
    expect(pinned).toMatch(/<button[^>]*class="term"[^>]*>ilk kullanımda güven<\/button>/);
    expect(strip(pinned)).toContain("ilk kez sabitlendi");
    expect(render(<PinNotice pin={{ ...base, status: "match", diff: { same: true, chainChanged: false, added: [], removed: [], changed: [] } } as Pin} />)).not.toContain("class=\"alert");
    expect(render(<PinNotice pin={undefined} />)).not.toContain("class=\"alert");
  });
});
