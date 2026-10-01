// Yapay zekâ: kip bilgisi ve yazarın bir YZ çıktısını onaylaması (YZ yalnız danışmandır; durum değiştirmez).
import type { FastifyInstance } from "fastify";
import type { AiAnalysisInfo } from "@forum/shared";
import { requireVerified } from "../auth";
import { aiApproveBody, idParams } from "../schemas";
import type { RouteDeps } from "../types";
import { parseBody, parseParams } from "../validation";

export function registerAiRoutes(app: FastifyInstance, { services }: RouteDeps): void {
  const { ai, forum } = services;

  app.get("/api/ai/status", async (): Promise<{ mode: "claude" | "offline"; model: string }> => ({ mode: ai.mode(), model: ai.model() }));

  app.post("/api/ai/analyses/:id/approve", async (req): Promise<AiAnalysisInfo> => {
    const user = requireVerified(req);
    const { id } = parseParams(idParams, req.params);
    const { draftIndex } = parseBody(aiApproveBody, req.body);
    return forum.proposals.approveAi(user, id, draftIndex);
  });
}
