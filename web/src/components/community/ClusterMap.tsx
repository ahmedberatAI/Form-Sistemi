// Görüş haritası: PCA düzlemindeki üyeler (küme rengi + şekil), küme merkezleri ve doğrudan etiketler.
// Gizlilik: sunucu noktaları anonim gönderir (userId/nickname yalnız görüntüleyenin kendi noktasında dolu);
// harita yalnızca sizin noktanızı "Siz" olarak işaretler.
import { useEffect, useRef, useState } from "react";
import type { ClusterSnapshotView } from "@forum/shared";
import { formatNumber } from "../../lib/format";
import { Table } from "../../ui";
import { ClusterGlyph, clusterColorCss, clusterLabel, clusterShape, shapePath } from "./vizColors";
import "./community.css";

const PAD = 36;

/** Değer aralığını genişletir: tek noktaya çöken eksen ortalanır, kenarlarda pay bırakılır. */
function range(values: number[]): [number, number] {
  let lo = Math.min(...values, 0);
  let hi = Math.max(...values, 0);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const m = (hi - lo) * 0.08;
  return [lo - m, hi + m];
}

export function ClusterMap({ snapshot, meId }: { snapshot: ClusterSnapshotView; meId?: string | null }) {
  // viewBox kapsayıcının gerçek piksel genişliğinde: metin her ekranda okunur boyutta kalır, 360 px'de taşmaz.
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setW(Math.max(240, el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = Math.round(Math.max(240, Math.min(460, W * 0.68)));

  const [minX, maxX] = range([...snapshot.points.map((p) => p.x), ...snapshot.clusters.map((c) => c.centroid[0])]);
  const [minY, maxY] = range([...snapshot.points.map((p) => p.y), ...snapshot.clusters.map((c) => c.centroid[1])]);
  const sx = (x: number) => PAD + ((x - minX) / (maxX - minX)) * (W - 2 * PAD);
  const sy = (y: number) => H - PAD - ((y - minY) / (maxY - minY)) * (H - 2 * PAD);
  const me = meId ? snapshot.points.find((p) => p.userId && p.userId === meId) : undefined;
  const labelRight = (x: number) => sx(x) < W * 0.6;

  return (
    <figure className="cm-map stack-sm">
      <div ref={boxRef} className="cm-map-box">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Görüş haritası: ${snapshot.points.length} anonim üye, ${snapshot.k} küme`}>
          <line className="cm-map-axis" x1={PAD / 2} x2={W - PAD / 2} y1={sy(0)} y2={sy(0)} />
          <line className="cm-map-axis" y1={PAD / 2} y2={H - PAD / 2} x1={sx(0)} x2={sx(0)} />
          {snapshot.points.map((p, i) => (
            <path key={i} className="cm-map-point" d={shapePath(clusterShape(p.clusterId), sx(p.x), sy(p.y), 5.5)} style={{ fill: clusterColorCss(p.clusterId) }}>
              <title>{me === p ? `Siz — ${clusterLabel(p.clusterId)}` : `Anonim üye — ${clusterLabel(p.clusterId)}`}</title>
            </path>
          ))}
          {snapshot.clusters.map((c) => (
            <g key={c.clusterId}>
              <path className="cm-map-centroid" d={shapePath(clusterShape(c.clusterId), sx(c.centroid[0]), sy(c.centroid[1]), 10)} style={{ fill: clusterColorCss(c.clusterId) }}>
                <title>{`${c.label} merkezi — ${c.size} üye`}</title>
              </path>
              <text
                className="cm-map-label"
                x={sx(c.centroid[0]) + (labelRight(c.centroid[0]) ? 15 : -15)}
                y={sy(c.centroid[1]) + 20}
                textAnchor={labelRight(c.centroid[0]) ? "start" : "end"}
              >
                {c.label} ({c.size})
              </text>
            </g>
          ))}
          {me ? (
            <g>
              <circle className="cm-map-me" cx={sx(me.x)} cy={sy(me.y)} r={14} />
              <text className="cm-map-label" x={sx(me.x)} y={sy(me.y) - 19} textAnchor="middle">
                Siz
              </text>
            </g>
          ) : null}
        </svg>
      </div>
      <figcaption>
        <ul className="cm-legend" aria-label="Lejant">
          {snapshot.clusters.map((c) => (
            <li key={c.clusterId}>
              <ClusterGlyph clusterId={c.clusterId} /> {c.label} ({c.size})
            </li>
          ))}
          <li>
            <svg width="14" height="14" aria-hidden="true">
              <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>{" "}
            büyük simge = küme merkezi
          </li>
        </ul>
      </figcaption>
      <Table
        caption="Kümeler (tablo görünümü)"
        rows={snapshot.clusters}
        rowKey={(c) => c.clusterId}
        columns={[
          { key: "l", header: "Küme", render: (c) => <span className="row"><ClusterGlyph clusterId={c.clusterId} /> {c.label}</span> },
          { key: "n", header: "Üye", align: "right", render: (c) => c.size },
          { key: "x", header: "Merkez (x, y)", align: "right", render: (c) => `${formatNumber(c.centroid[0], 2)}; ${formatNumber(c.centroid[1], 2)}` },
        ]}
      />
    </figure>
  );
}

export default ClusterMap;
