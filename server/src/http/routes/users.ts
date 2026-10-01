// Kullanıcılar ve sosyal graf ilişkileri: arama, profil, takip, kefalet, çıkar çatışması beyanı.
import type { FastifyInstance } from "fastify";
import type { PublicProfile, PublicUser } from "@forum/shared";
import { requireVerified } from "../auth";
import { idParams, relateBody, usersQuery, vouchBody } from "../schemas";
import type { RouteDeps } from "../types";
import { parseBody, parseParams, parseQuery } from "../validation";

export function registerUserRoutes(app: FastifyInstance, { services }: RouteDeps): void {
  const { forum, graph } = services;

  app.get("/api/users", async (req): Promise<PublicUser[]> => {
    const { q, limit } = parseQuery(usersQuery, req.query);
    return forum.community.searchUsers(q ?? "", limit);
  });

  app.get("/api/users/:id", async (req): Promise<PublicProfile> => {
    const { id } = parseParams(idParams, req.params);
    return forum.community.publicProfile(id, req.user);
  });

  app.post("/api/users/:id/follow", async (req): Promise<PublicProfile> => {
    const user = requireVerified(req);
    const { id } = parseParams(idParams, req.params);
    graph.follow(user.id, id);
    return forum.community.publicProfile(id, user);
  });

  app.delete("/api/users/:id/follow", async (req): Promise<PublicProfile> => {
    const user = requireVerified(req);
    const { id } = parseParams(idParams, req.params);
    graph.unfollow(user.id, id);
    return forum.community.publicProfile(id, user);
  });

  app.post("/api/users/:id/vouch", async (req): Promise<PublicProfile> => {
    const user = requireVerified(req);
    const { id } = parseParams(idParams, req.params);
    const { level } = parseBody(vouchBody, req.body);
    graph.vouch(user.id, id, level);
    return forum.community.publicProfile(id, user);
  });

  app.post("/api/users/:id/relate", async (req): Promise<PublicProfile> => {
    const user = requireVerified(req);
    const { id } = parseParams(idParams, req.params);
    const { kind } = parseBody(relateBody, req.body);
    graph.relate(user.id, id, kind);
    return forum.community.publicProfile(id, user);
  });
}
