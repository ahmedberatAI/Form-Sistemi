// Ana sayfa › Topluluk durumu: evrelere göre öneri sayıları tek sarmalı satırda bağlantılı haplar (eski Pano'nun 9 kutusu).
// Sıfır olanlar soluk ama görünür ve erişilebilir kalır; bağlantılar Öneriler sayfasının ?sekme= değerlerini aynen kullanır.
// Renk rolleri: mavi şu an süren evre, turuncu dikkat (itiraz/uzlaşma), yeşil ve kırmızı sonuç; sayı her zaman metinle birlikte.
import { Link } from "react-router-dom";
import type { Dashboard, ProposalStatus } from "@forum/shared";
import { formatNumber } from "../../lib/format";
import { routes } from "../../lib/routes";
import { cx } from "../../ui";
import "./home.css";

export type PillTone = "neutral" | "now" | "attention" | "success" | "danger";

export interface CountPillSpec {
  key: string;
  label: string;
  /** Kısa etiketin açılımı (ipucu) */
  title?: string;
  count: number;
  to: string;
  tone: PillTone;
}

const OPEN_PHASES: ProposalStatus[] = ["sponsoring", "deliberation", "voting", "objection_window", "reconciliation", "revote"];

const PHASES: { label: string; title?: string; statuses: ProposalStatus[]; tab: string; tone: PillTone }[] = [
  { label: "Destek bekleyen", statuses: ["sponsoring"], tab: "destek", tone: "now" },
  { label: "Tartışmada", statuses: ["deliberation"], tab: "tartisma", tone: "now" },
  { label: "Oylamada", statuses: ["voting", "revote"], tab: "oylama", tone: "now" },
  { label: "İtiraz ve uzlaşma", statuses: ["objection_window", "reconciliation"], tab: "itiraz", tone: "attention" },
  { label: "Kabul", title: "Kabul edilen öneriler", statuses: ["enacted"], tab: "kabul", tone: "success" },
  { label: "Red/aykırı", title: "Reddedilen ya da yönetmeliğe aykırı bulunan öneriler", statuses: ["rejected", "inadmissible"], tab: "red", tone: "danger" },
];

/** Panonun dokuz sayısı: açık öneri toplamı, altı evre, yürürlükteki konu (doğrulanmış üye sayısı vitrin satırındadır). */
export function countPillSpecs(d: Pick<Dashboard, "counts" | "topics">): CountPillSpec[] {
  const sum = (ss: ProposalStatus[]) => ss.reduce((n, s) => n + (d.counts[s] ?? 0), 0);
  return [
    { key: "acik", label: "Açık öneri", title: "Süren bütün evreler", count: sum(OPEN_PHASES), to: routes.proposals(), tone: "neutral" },
    ...PHASES.map((p) => ({ key: p.tab, label: p.label, title: p.title, count: sum(p.statuses), to: `${routes.proposals()}?sekme=${p.tab}`, tone: p.tone })),
    { key: "konu", label: "Yürürlükteki konu", count: d.topics, to: routes.topics(), tone: "neutral" },
  ];
}

export function CountPills({ dashboard }: { dashboard: Pick<Dashboard, "counts" | "topics"> }) {
  return (
    <ul className="count-pills" aria-label="Öneri ve konu sayıları">
      {countPillSpecs(dashboard).map((p) => (
        <li key={p.key}>
          <Link className={cx("count-pill", `count-pill-${p.tone}`, p.count === 0 && "is-zero")} to={p.to} title={p.title}>
            <span>{p.label}</span>
            <span className="count-pill-n">{formatNumber(p.count)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
