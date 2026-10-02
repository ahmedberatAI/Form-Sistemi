// Ana sayfa › Azınlık koruması: kalıcı kaybeden küme göstergesi ("Çoğunluk tiranlığı erken uyarısı") tek satır hükme iner;
// kümeler, uyarı eşiği ve açıklama bir dokunuşla açılır. Uyarı varsa bölüm kendiliğinden açık ve uyarı tonunda gelir.
// Bir kümenin durumu tek kuraldan (community/loserStatus.ts) türetilir; Graf › İstatistikler aynı kuralı kullanır.
import { Link } from "react-router-dom";
import { LOSER_MIN_DECISIONS, LOSER_WARN_SHARE, type Dashboard } from "@forum/shared";
import { loserStatus } from "../community/loserStatus";
import { formatPercent } from "../../lib/format";
import { routes } from "../../lib/routes";
import { Alert, Badge, cx, Details, ProgressBar } from "../../ui";
import "./home.css";

export type MinorityItems = Dashboard["permanentLoser"];

export type MinorityTone = "warning" | "ok" | "pending";

export interface MinorityVerdict {
  tone: MinorityTone;
  /** Kapalı başlıkta görünen tek satır hüküm (renk her zaman ✔/⚠ ve sözcükle birlikte) */
  text: string;
  warnCount: number;
}

export function minorityVerdict(items: MinorityItems): MinorityVerdict {
  const warnCount = items.filter((x) => loserStatus(x) === "warning").length;
  if (warnCount) {
    const who = warnCount === 1 ? "Bir" : String(warnCount);
    return { tone: "warning", text: `⚠ ${who} görüş kümesi kararların çoğunda kaybediyor`, warnCount };
  }
  if (items.some((x) => loserStatus(x) !== "insufficient")) {
    return { tone: "ok", text: `✔ Kalıcı kaybeden küme yok · ${items.length} küme izleniyor`, warnCount };
  }
  return { tone: "pending", text: "Henüz yeterli karar yok", warnCount };
}

export function MinorityProtection({ items }: { items: MinorityItems }) {
  const verdict = minorityVerdict(items);
  const warn = verdict.tone === "warning";
  return (
    <Details
      id="azinlik"
      className={cx("minority", warn && "minority-warn")}
      summary="Azınlık koruması"
      meta={<span className={`minority-verdict minority-verdict-${verdict.tone}`}>{verdict.text}</span>}
      open={warn ? true : undefined}
    >
      <div className="stack-sm">
        <p className="small mt-0">
          <strong>Çoğunluk tiranlığı erken uyarısı</strong> (kalıcı kaybeden küme göstergesi). Her görüş kümesi için, sonuçlanan kararların yüzde kaçında
          kümenin kendi çoğunluğunun aksi yönünde karar çıktığını gösterir. Bir küme sürekli kaybediyorsa çoğunluk azınlığı tüketiyor olabilir. Gösterge
          yalnızca bilgi içindir; hiçbir kararı değiştirmez.
        </p>
        <p className="small muted mt-0">
          Uyarı eşiği: kaybedilen karar payı {formatPercent(LOSER_WARN_SHARE)} ve en az {LOSER_MIN_DECISIONS} karar; daha az kararda “Yetersiz veri” gösterilir.
        </p>
        {!items.length ? (
          <p className="muted small mt-0">Henüz görüş kümesi oluşmadı ya da sonuçlanan karar yok.</p>
        ) : (
          <ul className="loser-list">
            {items.map((x) => {
              const status = loserStatus(x);
              return (
                <li key={x.clusterId}>
                  <div className="row-between">
                    <strong>{x.label}</strong>
                    {status === "warning" ? (
                      <Badge tone="danger" icon="warning">
                        Uyarı
                      </Badge>
                    ) : status === "insufficient" ? (
                      <Badge tone="neutral">Yetersiz veri</Badge>
                    ) : (
                      <Badge tone="success">Olağan</Badge>
                    )}
                  </div>
                  <ProgressBar
                    label="Kaybedilen karar payı"
                    value={x.lostShare}
                    valueText={`${formatPercent(x.lostShare)} · ${x.decisions} karar`}
                    tone={status === "warning" ? "danger" : x.lostShare >= 0.5 ? "warning" : "success"}
                    marker={LOSER_WARN_SHARE}
                    markerLabel={`Uyarı eşiği ${formatPercent(LOSER_WARN_SHARE)}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {warn ? (
          <Alert tone="warning">
            Köprü testi, azınlık itirazı ve uzlaşma turları bu kümenin sesini korumak içindir. Tartışmalarda bu kümenin görüşlerini aramak ve köprü
            kuran metinler önermek dengeyi güçlendirir.
          </Alert>
        ) : null}
        <Link to={routes.graph()} className="small">
          Görüş kümelerini ve grafı incele
        </Link>
      </div>
    </Details>
  );
}
