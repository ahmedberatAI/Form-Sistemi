// Kullanıcılar ve sosyal graf ilişkileri: arama, profil, takip, kefalet, çıkar çatışması beyanı (ve bunların geri alınması).
// Kenarlar asla silinmez: geri alma revoked_at doldurur. Yalnız kenarı oluşturan üye kendi kefaletini/beyanını geri alabilir.
import type { FastifyInstance } from "fastify";
import type { PublicProfile, PublicUser } from "@forum/shared";
import type { AuthUser } from "../../core/contracts";
import { forbidden } from "../../core/errors";
import { requireUser, requireVerified } from "../auth";
import { idParams, relateBody, unrelateQuery, usersQuery, vouchBody } from "../schemas";
import type { RouteDeps } from "../types";
import { parseBody, parseParams, parseQuery } from "../validation";

type RelationKind = "family" | "business" | "household";
const RELATION_KINDS: readonly RelationKind[] = ["family", "business", "household"];
const kindOf = (meta: Record<string, unknown> | null): RelationKind | null => {
  const k = meta?.kind;
  return typeof k === "string" && (RELATION_KINDS as readonly string[]).includes(k) ? (k as RelationKind) : null;
};

export function registerUserRoutes(app: FastifyInstance, { services }: RouteDeps): void {
  const { forum, graph, audit } = services;

  /** Profil + görüntüleyenin KENDİ yakınlık beyanları (relatedByMe): arayüz yalnız bunlara "geri al" gösterir. */
  const profile = (id: string, viewer: AuthUser | null): PublicProfile => {
    const p = forum.community.publicProfile(id, viewer);
    if (!viewer || !p.viewer) return p;
    const mine = graph
      .listEdges({ src: viewer.id, dst: id, type: "RELATED_TO" })
      .map((e) => kindOf(e.meta))
      .filter((k): k is RelationKind => k !== null);
    return { ...p, viewer: { ...p.viewer, relatedByMe: [...new Set(mine)] } };
  };

  app.get("/api/users", async (req): Promise<PublicUser[]> => {
    const { q, limit } = parseQuery(usersQuery, req.query);
    return forum.community.searchUsers(q ?? "", limit);
  });

  app.get("/api/users/:id", async (req): Promise<PublicProfile> => {
    const { id } = parseParams(idParams, req.params);
    return profile(id, req.user);
  });

  app.post("/api/users/:id/follow", async (req): Promise<PublicProfile> => {
    const user = requireVerified(req);
    const { id } = parseParams(idParams, req.params);
    graph.follow(user.id, id);
    return profile(id, user);
  });

  app.delete("/api/users/:id/follow", async (req): Promise<PublicProfile> => {
    const user = requireVerified(req);
    const { id } = parseParams(idParams, req.params);
    graph.unfollow(user.id, id);
    return profile(id, user);
  });

  app.post("/api/users/:id/vouch", async (req): Promise<PublicProfile> => {
    const user = requireVerified(req);
    const { id } = parseParams(idParams, req.params);
    const { level } = parseBody(vouchBody, req.body);
    graph.vouch(user.id, id, level);
    return profile(id, user);
  });

  // Kefaleti geri al: yalnız görüntüleyenin (src) bu kişiye verdiği aktif kefalet; yoksa işlem yok (idempotent).
  // Oturum yeterlidir (askıya alınmış üye de kendi kefaletini geri alabilir).
  app.delete("/api/users/:id/vouch", async (req): Promise<PublicProfile> => {
    const user = requireUser(req);
    const { id } = parseParams(idParams, req.params);
    const mine = graph.listEdges({ src: user.id, dst: id, type: "VOUCHES" });
    for (const e of mine) graph.revokeEdge(e.id);
    if (mine.length) audit.log(user.id, "graph.vouch_revoked", id, { edges: mine.length });
    return profile(id, user);
  });

  app.post("/api/users/:id/relate", async (req): Promise<PublicProfile> => {
    const user = requireVerified(req);
    const { id } = parseParams(idParams, req.params);
    const { kind } = parseBody(relateBody, req.body);
    graph.relate(user.id, id, kind);
    return profile(id, user);
  });

  // Yakınlık beyanını geri al (?kind= verilmezse bu kişiye dair tüm kendi beyanları). Yalnız beyan eden geri alabilir:
  // karşı tarafın beyanı geri alınamaz (403). Beyanlar herkese açık değildir; geri alma da yalnız denetim günlüğünde
  // (yönetici/denetçi) görünür — bilirkişi çıkar çatışması denetimini etkilediği için kayıt altındadır.
  app.delete("/api/users/:id/relate", async (req): Promise<PublicProfile> => {
    const user = requireUser(req);
    const { id } = parseParams(idParams, req.params);
    const { kind } = parseQuery(unrelateQuery, req.query);
    const matches = (meta: Record<string, unknown> | null) => {
      const k = kindOf(meta);
      return k !== null && (kind === undefined || k === kind);
    };
    const mine = graph.listEdges({ src: user.id, dst: id, type: "RELATED_TO" }).filter((e) => matches(e.meta));
    if (mine.length === 0) {
      const theirs = graph.listEdges({ src: id, dst: user.id, type: "RELATED_TO" }).filter((e) => matches(e.meta));
      if (theirs.length > 0) throw forbidden("Bu yakınlık beyanını karşı taraf yaptı; bir beyanı yalnızca beyan eden üye geri alabilir.");
      return profile(id, user);
    }
    for (const e of mine) graph.revokeEdge(e.id);
    // Hedef = beyan eden (karşı tarafın KVKK dökümüne düşmesin: beyan ona açık değildir); diğer üye meta'da.
    audit.log(user.id, "graph.relation_revoked", user.id, { other: id, kinds: [...new Set(mine.map((e) => kindOf(e.meta)))].sort() });
    return profile(id, user);
  });
}
