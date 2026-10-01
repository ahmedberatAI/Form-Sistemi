// Görüş haritası: PCA düzlemindeki üyeler (küme rengi + şekil), küme merkezleri ve doğrudan etiketler.
// Gizlilik: başka üyelerin takma adı haritada gösterilmez; yalnızca sizin noktanız "Siz" olarak işaretlenir.
import type { ClusterSnapshotView } from "@forum/shared";
import { formatNumber } from "../../lib/format";
import { Table } from "../../ui";
import { ClusterGlyph, clusterColorCss, clusterLabel, clusterShape, shapePath } from "./vizColors";
import "./community.css";

const W = 600;
const H = 420;
const PAD = 28;

export function ClusterMap({ snapshot, meId }: { snapshot: ClusterSnapshotView; meId?: string | null }) {
  const xs = [...snapshot.points.map((p) => p.x), ...snapshot.clusters.map((c) => c.centroid[0])];
  const ys = [...snapshot.points.map((p) => p.y), ...snapshot.clusters.map((c) => c.centroid[1])];
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 0);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 0);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const sx = (x: number) => PAD + ((x - minX) / spanX) * (W - 2 * PAD);
  const sy = (y: number) => H - PAD - ((y - minY) / spanY) * (H - 2 * PAD);
  const me = meId ? snapshot.points.find((p) => p.userId === meId) : undefined;

  return (
    <figure className="cm-map stack-sm">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Görüş haritası: ${snapshot.points.length} üye, ${snapshot.k} küme`}>
        <line className="cm-map-axis" x1={PAD} x2={W - PAD} y1={sy(0)} y2={sy(0)} />
        <line className="cm-map-axis" y1={PAD} y2={H - PAD} x1={sx(0)} x2={sx(0)} />
        {snapshot.points.map((p) => (
          <path key={p.userId} className="cm-map-point" d={shapePath(clusterShape(p.clusterId), sx(p.x), sy(p.y), 5.5)} style={{ fill: clusterColorCss(p.clusterId) }}>
            <title>{p.userId === meId ? `Siz — ${clusterLabel(p.clusterId)}` : clusterLabel(p.clusterId)}</title>
          </path>
        ))}
        {snapshot.clusters.map((c) => (
          <g key={c.clusterId}>
            <path className="cm-map-centroid" d={shapePath(clusterShape(c.clusterId), sx(c.centroid[0]), sy(c.centroid[1]), 10)} style={{ fill: clusterColorCss(c.clusterId) }}>
              <title>{`${c.label} merkezi — ${c.size} üye`}</title>
            </path>
            <text className="cm-map-label" x={sx(c.centroid[0]) + 14} y={sy(c.centroid[1]) + 4}>
              {c.label}
            </text>
          </g>
        ))}
        {me ? (
          <g>
            <circle className="cm-map-me" cx={sx(me.x)} cy={sy(me.y)} r={11} />
            <text className="cm-map-label" x={sx(me.x)} y={sy(me.y) - 15} textAnchor="middle">
              Siz
            </text>
          </g>
        ) : null}
      </svg>
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
