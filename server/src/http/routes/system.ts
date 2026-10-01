// Sistem: sağlık, sistem bilgisi, pano.
import type { FastifyInstance } from "fastify";
import type { Dashboard, SystemInfo } from "@forum/shared";
import type { RouteDeps } from "../types";

export function registerSystemRoutes(app: FastifyInstance, { services }: RouteDeps): void {
  const { forum } = services;

  app.get("/api/health", async (): Promise<{ ok: true }> => ({ ok: true }));

  app.get("/api/system", async (): Promise<SystemInfo> => forum.community.systemInfo());

  app.get("/api/dashboard", async (req): Promise<Dashboard> => forum.community.dashboard(req.user));
}
