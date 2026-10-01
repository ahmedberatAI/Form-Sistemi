// İnsanlar grafı (react-force-graph-2d, tuval). Ağır olduğu için GraphPage bunu React.lazy ile yükler.
// Gizlilik: siyasi görüş özel nitelikli veridir (KVKK md. 6); düğümler kümeye göre RENKLENDİRİLMEZ (sunucu da başkalarının kümesini vermez).
// Tek renk düğüm, boyut = PageRank, koyu halka = bilirkişi, kesikli kırmızı halka = sahte hesap şüphesi, mavi halka + "Siz" = kendi düğümünüz.
// Düğüm etiketleri tuvale düz metin olarak çizilir (HTML araç ipucu kullanılmaz).
import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";
import type { EdgeType, GraphVisEdge, GraphVisNode } from "@forum/shared";
import { Button } from "../../ui";
import { readCssVar, useThemeVersion } from "./vizColors";
import "./community.css";

type GNode = NodeObject<GraphVisNode & { r: number }>;
type GLink = LinkObject<GNode, { type: EdgeType; weight: number }>;

export interface PeopleGraphProps {
  nodes: GraphVisNode[];
  edges: GraphVisEdge[];
  selectedId?: string | null;
  meId?: string | null;
  onSelect: (n: GraphVisNode | null) => void;
}

const LINK_DASH: Partial<Record<EdgeType, number[]>> = { VOUCHES: [4, 3], REPLIED_TO: [1, 3] };

export default function PeopleGraph({ nodes, edges, selectedId, meId, onSelect }: PeopleGraphProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<GraphVisNode | null>(null);
  const fitted = useRef(false);
  const themeV = useThemeVersion();

  // Kapsayıcı genişliğine göre yeniden boyutlandır (360 px'de taşma yok).
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const height = Math.round(Math.max(300, Math.min(560, width * 0.75)));

  const colors = useMemo(() => {
    void themeV;
    return {
      node: readCssVar("--viz-c0", "#2a78d6"),
      edge: readCssVar("--viz-edge", "#b7bfcb"),
      ring: readCssVar("--viz-ring", "#18202b"),
      surface: readCssVar("--surface", "#ffffff"),
      text: readCssVar("--text", "#18202b"),
      danger: readCssVar("--danger", "#b91c1c"),
      primary: readCssVar("--primary", "#1d4ed8"),
    };
  }, [themeV]);

  const data = useMemo(() => {
    const maxPr = Math.max(1e-9, ...nodes.map((n) => n.pagerank || 0));
    const ns: GNode[] = nodes.map((n) => ({ ...n, x: undefined, y: undefined, r: 3.5 + 7 * Math.sqrt(Math.max(0, n.pagerank || 0) / maxPr) }));
    const ids = new Set(ns.map((n) => n.id));
    const ls: GLink[] = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target).map((e) => ({ source: e.source, target: e.target, type: e.type, weight: e.weight }));
    fitted.current = false;
    return { nodes: ns, links: ls };
  }, [nodes, edges]);

  const fit = () => fgRef.current?.zoomToFit(400, 24);

  return (
    <div className="cm-graph-box" ref={boxRef}>
      {width > 0 ? (
        <ForceGraph2D<GNode, { type: EdgeType; weight: number }>
          ref={fgRef}
          graphData={data}
          width={width}
          height={height}
          backgroundColor={colors.surface}
          nodeId="id"
          cooldownTicks={150}
          onEngineStop={() => {
            if (!fitted.current) {
              fitted.current = true;
              fit();
            }
          }}
          nodeVal={(n) => n.r}
          nodeCanvasObject={(n, ctx, scale) => {
            const x = n.x ?? 0;
            const y = n.y ?? 0;
            const r = n.r;
            const isSel = n.id === selectedId;
            const isHover = hover?.id === n.id;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, 2 * Math.PI);
            ctx.fillStyle = colors.node;
            ctx.fill();
            ctx.lineWidth = 1.5 / scale;
            ctx.strokeStyle = colors.surface;
            ctx.stroke();
            if (n.isExpert) {
              ctx.beginPath();
              ctx.arc(x, y, r + 2.5, 0, 2 * Math.PI);
              ctx.lineWidth = 1.6;
              ctx.strokeStyle = colors.ring;
              ctx.stroke();
            }
            if (n.sybilFlag) {
              ctx.beginPath();
              ctx.setLineDash([2, 2]);
              ctx.arc(x, y, r + (n.isExpert ? 5 : 3), 0, 2 * Math.PI);
              ctx.lineWidth = 1.6;
              ctx.strokeStyle = colors.danger;
              ctx.stroke();
              ctx.setLineDash([]);
            }
            if (isSel || n.id === meId) {
              ctx.beginPath();
              ctx.arc(x, y, r + 7, 0, 2 * Math.PI);
              ctx.lineWidth = 2;
              ctx.strokeStyle = colors.primary;
              ctx.stroke();
            }
            if (isSel || isHover || n.id === meId || scale > 2.2) {
              const fs = Math.max(10 / scale, 2.5);
              ctx.font = `600 ${fs}px system-ui, sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              const label = (n.id === meId ? "Siz · @" : "@") + n.label;
              ctx.lineWidth = 3 / scale;
              ctx.strokeStyle = colors.surface;
              ctx.strokeText(label, x, y + r + 3);
              ctx.fillStyle = colors.text;
              ctx.fillText(label, x, y + r + 3);
            }
          }}
          nodePointerAreaPaint={(n, color, ctx) => {
            ctx.beginPath();
            ctx.arc(n.x ?? 0, n.y ?? 0, n.r + 4, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
          }}
          linkColor={() => colors.edge}
          linkWidth={(l) => (l.type === "DELEGATES_TO" ? 2 : 1)}
          linkLineDash={(l) => LINK_DASH[l.type] ?? null}
          linkDirectionalArrowLength={(l) => (l.type === "DELEGATES_TO" ? 5 : 3)}
          linkDirectionalArrowRelPos={1}
          linkDirectionalArrowColor={() => colors.edge}
          onNodeHover={(n) => setHover(n ? (n as GraphVisNode) : null)}
          onNodeClick={(n) => onSelect(n as GraphVisNode)}
          onBackgroundClick={() => onSelect(null)}
          enableNodeDrag
        />
      ) : null}
      {hover ? (
        <div className="cm-graph-hover" aria-hidden="true">
          <strong>@{hover.label}</strong>
          {hover.id === meId ? " · siz" : ""}
          {hover.isExpert ? " · bilirkişi" : ""}
          {hover.sybilFlag ? " · sahte hesap şüphesi" : ""}
        </div>
      ) : null}
      <div className="cm-graph-tools">
        <Button size="sm" onClick={fit}>
          Sığdır
        </Button>
      </div>
    </div>
  );
}
