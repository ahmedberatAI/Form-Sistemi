// Görüş kümesi renkleri ve şekilleri (graf ve görüş haritası ortak kullanır).
// Renkler CSS değişkenlerindedir (community.css); tuval çizimi için güncel tema değerleri okunur.
import { useEffect, useState } from "react";
import { clusterLabel } from "@forum/shared";

export const CLUSTER_SLOTS = 5;
export type ClusterShape = "circle" | "square" | "triangle" | "diamond" | "cross";
const SHAPES: ClusterShape[] = ["circle", "square", "triangle", "diamond", "cross"];

/** "g2" → 2; kümelenmemiş → null */
export function clusterIndex(clusterId: string | null | undefined): number | null {
  if (!clusterId) return null;
  const n = Number(clusterId.replace(/^g/, ""));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function clusterVar(clusterId: string | null | undefined): string {
  const i = clusterIndex(clusterId);
  return i === null ? "--viz-none" : `--viz-c${i % CLUSTER_SLOTS}`;
}

/** SVG/CSS için: "var(--viz-c0)" */
export function clusterColorCss(clusterId: string | null | undefined): string {
  return `var(${clusterVar(clusterId)})`;
}

/** Renk tek başına kimlik taşımasın diye ikincil kodlama (şekil). */
export function clusterShape(clusterId: string | null | undefined): ClusterShape {
  const i = clusterIndex(clusterId);
  return i === null ? "circle" : SHAPES[i % SHAPES.length];
}

export { clusterLabel };

export function readCssVar(name: string, fallback = "#888888"): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Tema değişince (data-theme ya da sistem ayarı) artan sayaç: tuval renklerini yeniden okumak için. */
export function useThemeVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((x) => x + 1);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener?.("change", bump);
    return () => {
      mo.disconnect();
      mq?.removeEventListener?.("change", bump);
    };
  }, []);
  return v;
}

/** SVG şekil yolu (merkez cx,cy; yarıçap r). */
export function shapePath(shape: ClusterShape, cx: number, cy: number, r: number): string {
  switch (shape) {
    case "square":
      return `M${cx - r * 0.88},${cy - r * 0.88}h${r * 1.76}v${r * 1.76}h${-r * 1.76}Z`;
    case "triangle":
      return `M${cx},${cy - r * 1.1}L${cx + r},${cy + r * 0.75}L${cx - r},${cy + r * 0.75}Z`;
    case "diamond":
      return `M${cx},${cy - r * 1.15}L${cx + r * 1.15},${cy}L${cx},${cy + r * 1.15}L${cx - r * 1.15},${cy}Z`;
    case "cross": {
      const a = r * 0.38;
      const b = r * 1.05;
      return `M${cx - a},${cy - b}h${2 * a}v${b - a}h${b - a}v${2 * a}h${a - b}v${b - a}h${-2 * a}v${a - b}h${a - b}v${-2 * a}h${b - a}Z`;
    }
    default:
      return `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
  }
}

/** Tuvalde şekil çizimi (PeopleGraph). */
export function drawShape(ctx: CanvasRenderingContext2D, shape: ClusterShape, x: number, y: number, r: number): void {
  ctx.beginPath();
  switch (shape) {
    case "square":
      ctx.rect(x - r * 0.88, y - r * 0.88, r * 1.76, r * 1.76);
      break;
    case "triangle":
      ctx.moveTo(x, y - r * 1.1);
      ctx.lineTo(x + r, y + r * 0.75);
      ctx.lineTo(x - r, y + r * 0.75);
      ctx.closePath();
      break;
    case "diamond":
      ctx.moveTo(x, y - r * 1.15);
      ctx.lineTo(x + r * 1.15, y);
      ctx.lineTo(x, y + r * 1.15);
      ctx.lineTo(x - r * 1.15, y);
      ctx.closePath();
      break;
    case "cross": {
      const a = r * 0.38;
      const b = r * 1.05;
      ctx.moveTo(x - a, y - b);
      ctx.lineTo(x + a, y - b);
      ctx.lineTo(x + a, y - a);
      ctx.lineTo(x + b, y - a);
      ctx.lineTo(x + b, y + a);
      ctx.lineTo(x + a, y + a);
      ctx.lineTo(x + a, y + b);
      ctx.lineTo(x - a, y + b);
      ctx.lineTo(x - a, y + a);
      ctx.lineTo(x - b, y + a);
      ctx.lineTo(x - b, y - a);
      ctx.lineTo(x - a, y - a);
      ctx.closePath();
      break;
    }
    default:
      ctx.arc(x, y, r, 0, 2 * Math.PI);
  }
}

/** Lejant için küçük SVG simge. */
export function ClusterGlyph({ clusterId, size = 14 }: { clusterId: string | null | undefined; size?: number }) {
  const r = size / 2 - 1.5;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
      <path d={shapePath(clusterShape(clusterId), size / 2, size / 2, r)} style={{ fill: clusterColorCss(clusterId) }} />
    </svg>
  );
}
