// Graf görselleştirme, graf istatistikleri ve görüş kümesi anlık görüntüleri.
import type { FastifyInstance } from "fastify";
import type { ClusterSnapshotView, EdgeType, GraphStats, GraphVisEdge, GraphVisNode } from "@forum/shared";
import type { AuthUser } from "../../core/contracts";
import { notFound } from "../../core/errors";
import { hasRole } from "../auth";
import { graphQuery, idParams } from "../schemas";
import type { RouteDeps } from "../types";
import { parseParams, parseQuery } from "../validation";

/** Özel nitelikli kenarlar (aile/iş/hane yakınlık beyanı) yalnız denetçi ve yöneticiye gösterilir. */
const PRIVATE_EDGE_TYPES: readonly EdgeType[] = ["RELATED_TO"];

const canSeePrivate = (user: AuthUser | null): boolean => !!user && user.status === "verified" && hasRole(user, "auditor");

export function registerGraphRoutes(app: FastifyInstance, { services }: RouteDeps): void {
  const { graph, forum } = services;

  app.get("/api/graph", async (req): Promise<{ nodes: GraphVisNode[]; edges: GraphVisEdge[] }> => {
    const { types, limit } = parseQuery(graphQuery, req.query);
    const includePrivate = canSeePrivate(req.user);
    const includeEdgeTypes = types && !includePrivate ? types.filter((t) => !PRIVATE_EDGE_TYPES.includes(t)) : types;
    // includePrivate sözleşme tipinde yok; graf modülü ek alan olarak okur (yoksa özel kenarlar hiç verilmez).
    const opts: Parameters<typeof graph.visualization>[0] & { includePrivate: boolean } = { includeEdgeTypes, limit, includePrivate };
    const { nodes, edges } = graph.visualization(opts);
    // Siyasi görüş özel nitelikli veridir (KVKK md. 6): kişinin görüş kümesi, oy uzlaşısı topluluğu ve görüş
    // koordinatları yalnız KENDİSİNE gösterilir; herkese açık grafta düğümler yalnız sosyal ilişkileri taşır.
    const viewerId = req.user?.id ?? null;
    const safeNodes = nodes.map((n) => (n.id === viewerId ? n : { ...n, cluster: null, community: null, x: undefined, y: undefined }));
    return { nodes: safeNodes, edges: includePrivate ? edges : edges.filter((e) => !PRIVATE_EDGE_TYPES.includes(e.type)) };
  });

  app.get("/api/graph/stats", async (): Promise<GraphStats> => graph.stats());

  app.get("/api/clusters/latest", async (req): Promise<ClusterSnapshotView | null> => {
    const snap = forum.clusters.latest();
    return snap ? anonymizeSnapshot(snap, req.user) : null;
  });

  app.get("/api/clusters/:id", async (req): Promise<ClusterSnapshotView> => {
    const { id } = parseParams(idParams, req.params);
    const snap = forum.clusters.get(id);
    if (!snap) throw notFound("Görüş kümesi anlık görüntüsü");
    return anonymizeSnapshot(snap, req.user);
  });
}

/**
 * Görüş haritası anonimdir: noktalar küme ve koordinat taşır, kimlik taşımaz (yalnız görüntüleyenin kendi noktası
 * işaretlenir). Sıra kimliğe göre değil koordinata göre — sıralamadan kimlik çıkarılamasın.
 */
function anonymizeSnapshot(snap: ClusterSnapshotView, viewer: AuthUser | null): ClusterSnapshotView {
  const points = snap.points
    .map((p) => (viewer && p.userId === viewer.id ? p : { ...p, userId: "", nickname: "" }))
    .sort((a, b) => a.clusterId.localeCompare(b.clusterId) || a.x - b.x || a.y - b.y);
  return { ...snap, points };
}
