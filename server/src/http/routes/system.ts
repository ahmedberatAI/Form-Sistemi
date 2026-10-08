// Sistem: sağlık, sistem bilgisi, pano.
import type { FastifyInstance } from "fastify";
import type { Dashboard, SystemInfo } from "@forum/shared";
import { dashboardQuery } from "../schemas";
import type { RouteDeps } from "../types";
import { parseQuery } from "../validation";
import { recentFromHeader } from "./discovery";

export function registerSystemRoutes(app: FastifyInstance, { services }: RouteDeps): void {
  const { forum } = services;

  app.get("/api/health", async (): Promise<{ ok: true }> => ({ ok: true }));

  app.get("/api/system", async (): Promise<SystemInfo> => forum.community.systemInfo());

  // X-Forum-Recent: istemcinin cihazındaki son açılanlar (yalnız "Şu an açık" kişisel sırasının geçici girdisi; saklanmaz).
  // Sorgu dizesindeki ?recent= reddedilir (adres satırı vekil günlüklerine düşer).
  app.get("/api/dashboard", async (req): Promise<Dashboard> => {
    parseQuery(dashboardQuery, req.query);
    return forum.community.dashboard(req.user, { recent: recentFromHeader(req) ?? [] });
  });
}
