// Konular: düz liste (istemci parentId ile ağaç kurar) ve ayrıntı.
import type { FastifyInstance } from "fastify";
import type { TopicDetail, TopicSummary } from "@forum/shared";
import { idParams } from "../schemas";
import type { RouteDeps } from "../types";
import { parseParams } from "../validation";

export function registerTopicRoutes(app: FastifyInstance, { services }: RouteDeps): void {
  const { topics } = services.forum;

  app.get("/api/topics", async (): Promise<TopicSummary[]> => topics.list());

  app.get("/api/topics/:id", async (req): Promise<TopicDetail> => topics.get(parseParams(idParams, req.params).id, req.user));
}
