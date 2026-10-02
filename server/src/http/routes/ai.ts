// Yapay zekâ: kip bilgisi ve yazarın bir YZ çıktısını onaylaması (YZ yalnız danışmandır; durum değiştirmez).
import type { FastifyInstance } from "fastify";
import type { AiAnalysisInfo } from "@forum/shared";
import type { AiHealth } from "../../core/contracts";
import { requireVerified } from "../auth";
import { aiApproveBody, idParams } from "../schemas";
import type { RouteDeps } from "../types";
import { parseBody, parseParams } from "../validation";

type AiStatus = { mode: "claude" | "offline"; model: string } & Partial<AiHealth>;

export function registerAiRoutes(app: FastifyInstance, { services }: RouteDeps): void {
  const { ai, forum } = services;

  // Claude kipinde ayrıca sağlık alanları döner (degraded/failures/lastError/lastErrorAt/lastOkAt): çağrılar sessizce
  // çevrimdışı sezgisele düşüyorsa operatör bunu görebilsin. Çevrimdışı kipte yanıt eskisi gibidir.
  app.get("/api/ai/status", async (): Promise<AiStatus> => {
    const mode = ai.mode();
    const base = { mode, model: ai.model() };
    const health = mode === "claude" ? ai.health?.() : undefined;
    return health ? { ...base, ...health } : base;
  });

  app.post("/api/ai/analyses/:id/approve", async (req): Promise<AiAnalysisInfo> => {
    const user = requireVerified(req);
    const { id } = parseParams(idParams, req.params);
    const { draftIndex } = parseBody(aiApproveBody, req.body);
    return forum.proposals.approveAi(user, id, draftIndex);
  });
}
