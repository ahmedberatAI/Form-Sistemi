// Görsel dil (src/README.md › Görsel dil): renk rolleri, rozet bütçesi ve tema belirteçlerinin WCAG AA kontrastı.
// Kontrast formülü e2e/support/sade.ts › scanContrast ile aynıdır (WCAG 2.x göreli parlaklık; normal metin 4,5:1, metin dışı 3:1).
// e2e taraması sayfadaki gerçek metni ölçer; bu dosya belirteç çiftlerini üç tema bloğunda (açık, [data-theme="dark"],
// prefers-color-scheme: dark) DOM'suz denetler, böylece yeni bir renk değeri e2e çalışmadan önce yakalanır.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  EXPERT_STATUS_LABELS,
  OUTCOME_LABELS,
  PROPOSAL_KIND_LABELS,
  PROPOSAL_STATUS_LABELS,
  ROLE_LABELS,
  STANCE_LABELS,
  TIER_LABELS,
  USER_STATUS_LABELS,
  VOTE_LABELS,
  type DecisionOutcome,
  type ExpertStatus,
  type ProposalKind,
  type ProposalStatus,
  type Role,
  type Stance,
  type Tier,
  type UserStatus,
  type VoteChoice,
} from "@forum/shared";
import {
  ExpertStatusBadge,
  KindBadge,
  OutcomeBadge,
  RoleBadge,
  StanceBadge,
  StatusBadge,
  statusTone,
  TierBadge,
  tierTone,
  UserStatusBadge,
  VoteBadge,
} from "./badges";

const keys = <K extends string>(o: Record<K, unknown>) => Object.keys(o) as K[];
const toneOf = (html: string): string[] => [...html.matchAll(/class="badge badge-([a-z]+)/g)].map((m) => m[1]);

// ───────────── Rozet tonları ─────────────

describe("renk rolleri: öneri durumu", () => {
  it("süren evre mavi, itiraz ve uzlaşma turuncu, kabul yeşil, red ve aykırı kırmızı, diğerleri gri", () => {
    const expected: Record<ProposalStatus, string> = {
      sponsoring: "info",
      deliberation: "info",
      voting: "info",
      revote: "info",
      objection_window: "warning",
      reconciliation: "warning",
      enacted: "success",
      rejected: "danger",
      inadmissible: "danger",
      draft: "neutral",
      withdrawn: "neutral",
      expired: "neutral",
    };
    for (const s of keys(PROPOSAL_STATUS_LABELS)) {
      expect(statusTone(s), s).toBe(expected[s]);
      expect(toneOf(renderToStaticMarkup(<StatusBadge status={s} />)), s).toEqual([expected[s]]);
    }
  });
});

describe("renk rolleri: tür, katman, rol ve görüş", () => {
  it("tür rozeti her zaman gri (silme ve yönetmelik değişikliği dahil)", () => {
    for (const k of keys(PROPOSAL_KIND_LABELS)) expect(toneOf(renderToStaticMarkup(<KindBadge kind={k as ProposalKind} />)), k).toEqual(["neutral"]);
  });

  it("katman rozeti yalnız T3'te kırmızı; neutral ile T3 de gri (aynı nesnede renkli durum rozeti varken)", () => {
    for (const t of keys(TIER_LABELS)) {
      const want = t === "T3" ? "danger" : "neutral";
      expect(tierTone(t as Tier), t).toBe(want);
      expect(toneOf(renderToStaticMarkup(<TierBadge tier={t as Tier} />)), t).toEqual([want]);
      expect(toneOf(renderToStaticMarkup(<TierBadge tier={t as Tier} short neutral />)), t).toEqual(["neutral"]);
    }
    expect(tierTone(null)).toBe("neutral");
    expect(toneOf(renderToStaticMarkup(<TierBadge tier={null} />))).toEqual(["neutral"]);
  });

  it("rol rozeti gri; üye rozetsiz", () => {
    for (const r of keys(ROLE_LABELS)) {
      const html = renderToStaticMarkup(<RoleBadge role={r as Role} />);
      expect(toneOf(html), r).toEqual(r === "member" ? [] : ["neutral"]);
    }
  });

  it("görüş: lehte yeşil, karşı kırmızı, soru ve diğerleri gri", () => {
    for (const s of keys(STANCE_LABELS)) {
      const want = s === "pro" ? "success" : s === "con" ? "danger" : "neutral";
      expect(toneOf(renderToStaticMarkup(<StanceBadge stance={s as Stance} />)), s).toEqual([want]);
    }
  });

  it("mor (accent) YALNIZ yapay zekâ içindir: hiçbir alan rozeti mor değildir", () => {
    const all = [
      ...keys(PROPOSAL_STATUS_LABELS).map((s) => <StatusBadge key={s} status={s as ProposalStatus} />),
      ...keys(TIER_LABELS).map((t) => <TierBadge key={t} tier={t as Tier} />),
      ...keys(PROPOSAL_KIND_LABELS).map((k) => <KindBadge key={k} kind={k as ProposalKind} />),
      ...keys(VOTE_LABELS).map((v) => <VoteBadge key={v} choice={v as VoteChoice} />),
      ...keys(STANCE_LABELS).map((s) => <StanceBadge key={s} stance={s as Stance} />),
      ...keys(OUTCOME_LABELS).map((o) => <OutcomeBadge key={o} outcome={o as DecisionOutcome} />),
      ...keys(ROLE_LABELS).map((r) => <RoleBadge key={r} role={r as Role} />),
      ...keys(USER_STATUS_LABELS).map((u) => <UserStatusBadge key={u} status={u as UserStatus} />),
      ...keys(EXPERT_STATUS_LABELS).map((e) => <ExpertStatusBadge key={e} status={e as ExpertStatus} />),
    ];
    const html = renderToStaticMarkup(<>{all}</>);
    expect(toneOf(html).length).toBeGreaterThan(30);
    expect(html).not.toContain("badge-accent");
  });
});

// ───────────── Tema belirteçleri ve kontrast ─────────────

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

/** `from` konumundan sonraki ilk `{ … }` bloğunun içi (iç içe ayraçlar sayılır). */
function blockAfter(from: number): string {
  expect(from, "blok bulunamadı").toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("eşleşmeyen süslü ayraç");
}

const declarations = (block: string): Record<string, string> =>
  Object.fromEntries([...block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const ROOT = declarations(blockAfter(css.search(/^:root \{/m)));
const DARK = declarations(blockAfter(css.search(/^:root\[data-theme="dark"\] \{/m)));
const SYSTEM_DARK = declarations(blockAfter(css.indexOf(":root:not(", css.indexOf("@media (prefers-color-scheme: dark)"))));
// Koyu bloklar :root'un üzerine yazar (aynı öğe, daha özgül seçici); tanımlamadıkları belirteç :root'tan gelir.
const THEMES: Record<string, Record<string, string>> = {
  açık: ROOT,
  "koyu (Ayarlar)": { ...ROOT, ...DARK },
  "koyu (sistem)": { ...ROOT, ...SYSTEM_DARK },
};

function resolve(vars: Record<string, string>, name: string): string {
  let v = vars[name];
  for (let i = 0; v !== undefined && i < 10; i++) {
    const ref = /^var\(--([\w-]+)\)$/.exec(v);
    if (!ref) return v;
    v = vars[ref[1]];
  }
  throw new Error(`--${name} çözülemedi`);
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  expect(full, hex).toMatch(/^[0-9a-f]{6}$/i);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2.x göreli parlaklık (e2e taramasıyla aynı eşik: 0,03928). */
function luminance(hex: string): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Metin rengi / zemin: arayüzde gerçekten birlikte kullanılan çiftler (sınıf adları yorumda). */
const TEXT_PAIRS: [string, string][] = [
  ["text", "bg"],
  ["text", "surface"],
  ["text", "surface-3"], // tamamlanan evre ✔ noktası
  ["text", "info-soft"], // .alert-info, .home-note, .via-note
  ["text-muted", "bg"],
  ["text-muted", "surface"],
  ["text-muted", "surface-2"], // .badge-neutral, .user-expert
  ["text-muted", "info-soft"], // .alert-info, .next-step-action içinde .muted
  ["primary", "bg"],
  ["primary", "surface"],
  ["primary", "surface-2"],
  ["primary", "primary-soft"], // .chip, .phase-current, .tab-count
  ["info", "info-soft"], // .badge-info
  ["primary-contrast", "primary"], // .btn-primary, .count-badge
  ["success", "success-soft"],
  ["success", "surface"],
  ["success", "surface-2"],
  ["warning", "warning-soft"],
  ["warning", "surface"],
  ["warning", "surface-2"],
  ["danger", "danger-soft"],
  ["danger", "surface"],
  ["danger", "surface-2"],
  ["danger-contrast", "danger"], // .btn-danger
  ["accent", "accent-soft"], // .ai-label (YZ)
  ["accent", "surface"], // .cite-link, YZ vitrin karosu
];

describe("tema belirteçleri", () => {
  it("tek mavi: --info ve --info-soft üç blokta da birincil mavinin takma adıdır", () => {
    for (const block of [ROOT, DARK, SYSTEM_DARK]) {
      expect(block.info).toBe("var(--primary)");
      expect(block["info-soft"]).toBe("var(--primary-soft)");
    }
    for (const [name, vars] of Object.entries(THEMES)) expect(resolve(vars, "info"), name).toBe(resolve(vars, "primary"));
  });

  it("açık temadaki her renk belirteci iki koyu blokta da tanımlıdır (yeni renk iki koyu bloğa da eklenir)", () => {
    const colors = Object.keys(ROOT).filter((k) => /^#|^var\(--/.test(ROOT[k]));
    expect(colors).toContain("accent");
    for (const k of colors) {
      expect(DARK, `[data-theme="dark"] --${k}`).toHaveProperty(k);
      expect(SYSTEM_DARK, `prefers-color-scheme: dark --${k}`).toHaveProperty(k);
    }
  });

  it("boşluk ve yazı belirteçleri :root'ta (renk değiller; koyu bloklarda yeniden tanımlanmaz)", () => {
    for (const k of ["sp-1", "sp-2", "sp-3", "sp-4", "sp-5", "sp-6", "fs-xs", "fs-sm", "fs-md", "fs-lg", "fs-xl", "measure"]) {
      expect(ROOT, k).toHaveProperty(k);
      expect(DARK, k).not.toHaveProperty(k);
      expect(SYSTEM_DARK, k).not.toHaveProperty(k);
    }
    expect(ROOT.measure).toBe("70ch");
  });

  it("formül e2e taramasıyla aynı: siyah/beyaz 21:1, aynı renk 1:1", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#1d4ed8", "#1d4ed8")).toBeCloseTo(1, 5);
  });

  for (const [name, vars] of Object.entries(THEMES)) {
    it(`WCAG AA (${name}): metin çiftleri en az 4,5:1, köprü göstergesi ve eylem kenarı en az 3:1`, () => {
      const low: string[] = [];
      for (const [fg, bg] of TEXT_PAIRS) {
        const r = contrast(resolve(vars, fg), resolve(vars, bg));
        if (r + 0.005 < 4.5) low.push(`--${fg} / --${bg}: ${r.toFixed(2)}`);
      }
      expect(low).toEqual([]);
      // Metin dışı öğeler (WCAG 1.4.11): .msg-bridge-meter dolgusu ve .card-action kenarı
      expect(contrast(resolve(vars, "text-muted"), resolve(vars, "surface-3"))).toBeGreaterThanOrEqual(3);
      expect(contrast(resolve(vars, "primary"), resolve(vars, "surface"))).toBeGreaterThanOrEqual(3);
    });
  }
});

// ───────────── Kaynakta mor ─────────────

describe("mor (accent) kaynakta yalnız yapay zekâ içindir", () => {
  /** web/src altındaki üretim kaynakları (test dosyaları hariç). */
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const path = join(dir, e.name);
      if (e.isDirectory()) return sources(path);
      return /\.(tsx?|ts)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
    });
  }

  it("'accent' tonu yalnız ui/basic.tsx tür tanımlarında geçer; durum, rol ve sayı rozetleri hiçbir yerde mor seçmez", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const hits = sources(root)
      .filter((f) => /["']accent["']/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(root.length).replaceAll("\\", "/"));
    // YZ içeriği mor sınıfları (.ai-*, .cite-link) CSS'tedir; bileşenlerde tone="accent" gerekirse listeye gerekçesiyle eklenir.
    expect(hits).toEqual(["ui/basic.tsx"]);
  });
});
