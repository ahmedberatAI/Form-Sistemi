// Graf görselleştirme, graf istatistikleri ve görüş kümesi anlık görüntüleri.
import type { FastifyInstance } from "fastify";
import type { ClusterSnapshotView, EdgeType, GraphStats, GraphVisEdge, GraphVisNode } from "@forum/shared";
import type { AuthUser } from "../../core/contracts";
import { notFound } from "../../core/errors";
import { anonymizeClusterView } from "../../forum/clusters";
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
    // Görünürlük politikası GraphService.visualization içinde uygulanır (özel kenar yalnız includePrivate ile, siyasi görüş
    // alanları yalnız viewerId'nin kendi düğümünde). Aşağıdaki süzgeçler yalnız savunma derinliği içindir.
    const viewerId = req.user?.id ?? null;
    const { nodes, edges } = graph.visualization({ includeEdgeTypes, limit, includePrivate, viewerId });
    const safeNodes = nodes.map((n) => (n.id === viewerId ? n : { ...n, cluster: null, community: null, x: undefined, y: undefined }));
    return { nodes: safeNodes, edges: includePrivate ? edges : edges.filter((e) => !PRIVATE_EDGE_TYPES.includes(e.type)) };
  });

  app.get("/api/graph/stats", async (): Promise<GraphStats> => graph.stats());

  app.get("/api/clusters/latest", async (req): Promise<ClusterSnapshotView | null> => {
    const snap = forum.clusters.latest();
    return snap ? anonymizeClusterView(snap, req.user?.id ?? null) : null;
  });

  app.get("/api/clusters/:id", async (req): Promise<ClusterSnapshotView> => {
    const { id } = parseParams(idParams, req.params);
    const snap = forum.clusters.get(id);
    if (!snap) throw notFound("Görüş kümesi anlık görüntüsü");
    return anonymizeClusterView(snap, req.user?.id ?? null);
  });
}
