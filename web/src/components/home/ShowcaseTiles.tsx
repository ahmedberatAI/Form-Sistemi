// Ana sayfa vitrini "Neyi doğrulayabilirsiniz?": sistemin altı bileşeni (defter, oy doğrulama, bilirkişi, yapay zekâ, graf,
// yönetmelik) canlı bilgisiyle ve bir dokunuşla (yedincisi, azınlık koruması, Topluluk durumu'ndadır). Başlığın yanındaki
// 'Gösterim rehberi ›' yedisini sırayla gösteren 'Keşfet ve doğrula' sayfasının rehber bölümüne gider. Eski sistem şeridinin
// bütün bilgisi burada kalır: saat ve ölçek, ileri alma, YZ kipi ve modeli, defter yüksekliği ve doğrulayıcı sağlığı,
// yönetmelik sürümü, üye sayıları, istemci sürümü. Saniyelik saat yalnız alt satırı yeniden çizer.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Dashboard, SystemInfo } from "@forum/shared";
import { formatDateTime, formatDuration, formatNumber } from "../../lib/format";
import { useNow } from "../../lib/hooks";
import { routes } from "../../lib/routes";
import { Button, cx, Icon, Section, type IconName } from "../../ui";
import "./home.css";

/** Zaman ölçeği metni: 1 → "gerçek zamanlı", 600 → "demo: 1 saat = 6 dakika". */
export function scaleText(scale: number): string {
  if (!scale || scale === 1) return "gerçek zamanlı";
  const sec = 3600 / scale;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : formatNumber(n, 1));
  return sec >= 60 ? `demo: 1 saat = ${fmt(sec / 60)} dakika` : `demo: 1 saat = ${fmt(sec)} saniye`;
}

export interface ShowcaseTile {
  key: string;
  label: string;
  icon: IconName;
  value: ReactNode;
  hint?: ReactNode;
  /** Verilmezse karo bağlantı değildir */
  to?: string;
  /** Yapay zekâ karosu (mor yalnız yapay zekâ içindir) */
  ai?: boolean;
}

type ShowcaseData = Pick<Dashboard, "ledger" | "members">;

/** Altı karo, canlı bilgisiyle. Sistem bilgisi henüz yoksa karolar yine çizilir (yalnız canlı değer yerine genel ifade gelir). */
export function showcaseTiles(system: SystemInfo | null, dashboard?: Pick<Dashboard, "ledger">): ShowcaseTile[] {
  const ledger = system?.ledger ?? dashboard?.ledger;
  const ledgerOk = ledger ? ledger.healthy >= ledger.validators : true;
  const ledgerHint = ledger ? `${ledger.healthy}/${ledger.validators} doğrulayıcı sağlıklı` : undefined;
  return [
    {
      key: "defter",
      label: "Defter",
      icon: "ledger",
      to: routes.ledger(),
      value: ledger ? `${formatNumber(ledger.height)}. blok` : "dağıtık defter",
      hint: ledgerHint ? (
        ledgerOk ? (
          ledgerHint
        ) : (
          <span className="showcase-warn">
            <span aria-hidden="true">⚠ </span>
            <span className="sr-only">Uyarı: </span>
            {ledgerHint}
          </span>
        )
      ) : undefined,
    },
    { key: "oy", label: "Oy doğrulama", icon: "verify", to: routes.verifyVote(), value: "makbuzla, cihazınızda" },
    { key: "bilirkisi", label: "Bilirkişiler", icon: "experts", to: routes.experts(), value: "kurayla seçilir", hint: "danışman niteliğinde" },
    {
      key: "yz",
      label: "Yapay zekâ",
      icon: "ai",
      ai: true,
      value: !system ? "—" : system.aiMode === "claude" ? "Claude" : "Çevrimdışı",
      hint: `${system?.aiMode === "claude" ? system.aiModel : "kural tabanlı sezgisel mod"} · danışma niteliğinde`,
    },
    { key: "graf", label: "Graf", icon: "graph", to: routes.graph(), value: "görüş kümeleri" },
    { key: "yonetmelik", label: "Yönetmelik", icon: "book", to: routes.ontology(), value: system ? `sürüm ${system.bylawVersion}` : "ontoloji", hint: "ontoloji ile denetlenir" },
  ];
}

function Tile({ tile: t }: { tile: ShowcaseTile }) {
  const cls = cx("showcase-tile", t.ai && "showcase-tile-ai");
  const inner = (
    <>
      <span className="showcase-label">
        <Icon name={t.icon} size={14} />
        {t.label}
        {t.to ? <Icon name="chevronRight" size={14} className="showcase-go" /> : null}
      </span>
      <span className="showcase-value">{t.value}</span>
      {t.hint ? <span className="showcase-hint">{t.hint}</span> : null}
    </>
  );
  return t.to ? (
    <Link className={cls} to={t.to}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

const membersText = (m: SystemInfo["members"]) => `${formatNumber(m.verified)} doğrulanmış, ${formatNumber(m.pending)} bekleyen üye`;

/** Alt satır: simüle saat (ölçek ve ileri alma), üye sayıları ve istemci sürümü. useNow(1000) yalnız burada çalışır. */
function SystemLine({ system, members, onRetry }: { system: SystemInfo | null; members?: SystemInfo["members"]; onRetry?: () => void }) {
  const now = useNow(1000);
  if (!system) {
    return (
      <div className="showcase-line showcase-line-empty" role="status">
        <span>Sistem bilgisi alınamadı.{members ? ` ${membersText(members)}.` : ""}</span>
        {onRetry ? (
          <Button size="sm" variant="ghost" icon="refresh" onClick={onRetry}>
            Yenile
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <p className="showcase-line">
      Simüle saat <time dateTime={new Date(now).toISOString()}>{formatDateTime(now, true)}</time> ({scaleText(system.timeScale)}
      {system.clockOffsetMs > 0 ? `; yönetici ${formatDuration(system.clockOffsetMs, false)} ileri aldı` : ""}) · {membersText(system.members)} · v
      {system.version}
    </p>
  );
}

export interface ShowcaseTilesProps {
  /** Sunucunun sistem bilgisi (useAuth().system); henüz yoksa null */
  system: SystemInfo | null;
  /** Ana sayfa verisi: sistem bilgisi yokken defter ve üye sayıları buradan gelir */
  dashboard?: ShowcaseData;
  /** Sistem bilgisi alınamadıysa "Yenile" düğmesi */
  onRetry?: () => void;
}

export function ShowcaseTiles({ system, dashboard, onRetry }: ShowcaseTilesProps) {
  return (
    <Section
      id="vitrin"
      title="Neyi doğrulayabilirsiniz?"
      actions={
        // Yedi bileşeni sırayla gösteren 'Keşfet ve doğrula' sayfasının rehber bölümü (sayfa bir gezinme öğesi değildir).
        <Link to={routes.kesfet({ bolum: "rehber" })} className="home-inline-link small">
          Gösterim rehberi <Icon name="chevronRight" size={14} />
        </Link>
      }
    >
      <ul className="showcase-tiles">
        {showcaseTiles(system, dashboard).map((t) => (
          <li key={t.key}>
            <Tile tile={t} />
          </li>
        ))}
      </ul>
      <SystemLine system={system} members={dashboard?.members} onRetry={onRetry} />
    </Section>
  );
}
