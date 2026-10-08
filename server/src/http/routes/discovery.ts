// Keşif: önerili arama ("Hızlı bul") ve Listem ("Listeme ekle"). Kişisel sıralama /api/proposals?sort=sana-gore ve /api/dashboard'dadır.
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { SavedList, SavedState, SearchResponse } from "@forum/shared";
import { requireUser } from "../auth";
import { RECENT_HEADER, recentHeader, savedParams, searchQuery } from "../schemas";
import type { RouteDeps } from "../types";
import { parseParams, parseQuery } from "../validation";

/**
 * "Son açılanlar" istek başlığı (X-Forum-Recent; en çok 20 UUID, virgülle): yoksa undefined. Geçersizse 400 validation
 * (details.recent). Değer yalnız o isteğin sıralamasında kullanılır; saklanmaz ve (başlık olduğu için) istek günlüklerine düşmez.
 */
export function recentFromHeader(req: FastifyRequest): string[] | undefined {
  const raw = req.headers[RECENT_HEADER];
  const value = Array.isArray(raw) ? raw.join(",") : raw;
  return parseQuery(recentHeader, value === undefined ? {} : { recent: value }).recent;
}

export function registerDiscoveryRoutes(app: FastifyInstance, { services }: RouteDeps): void {
  const { discovery } = services.forum;

  // Herkese açık; oturum varsa görüntüleyenin kendi taslakları da aranır (başkasının taslağı hiç görünmez).
  app.get("/api/search", async (req): Promise<SearchResponse> => {
    const { q, limit } = parseQuery(searchQuery, req.query);
    return discovery.search(q, limit, req.user);
  });

  // Listem yalnız sahibine görünür: başka bir üyenin listesini okuyan bir uç YOKTUR.
  app.get("/api/me/saved", async (req): Promise<SavedList> => discovery.saved(requireUser(req).id));

  app.put("/api/me/saved/:type/:id", async (req): Promise<SavedState> => {
    const user = requireUser(req);
    const { type, id } = parseParams(savedParams, req.params);
    return discovery.setSaved(user, type, id, true);
  });

  app.delete("/api/me/saved/:type/:id", async (req): Promise<SavedState> => {
    const user = requireUser(req);
    const { type, id } = parseParams(savedParams, req.params);
    return discovery.setSaved(user, type, id, false);
  });
}
