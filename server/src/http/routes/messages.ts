// Tartışma: başlıklar (konu/öneri), mesaj gönderme (kişisel veri → 422), düzenleme, sürümler, destek, cevap hakkı,
// denetçinin gizli metni okuması (erişim kaydı).
import type { FastifyInstance } from "fastify";
import type {
  HiddenMessageResponse,
  MessagePrecheckResponse,
  MessageVersionView,
  MessageView,
  ThreadResponse,
} from "@forum/shared";
import { requireRole, requireVerified } from "../auth";
import { editMessageBody, endorseBody, idParams, messagePrecheckBody, postMessageBody, rebuttalBody, threadParams } from "../schemas";
import type { RouteDeps } from "../types";
import { parseBody, parseParams } from "../validation";

export function registerMessageRoutes(app: FastifyInstance, { services }: RouteDeps): void {
  const { messages } = services.forum;
  const mid = (params: unknown) => parseParams(idParams, params).id;

  app.get("/api/threads/:type/:id", async (req): Promise<ThreadResponse> => {
    const { type, id } = parseParams(threadParams, req.params);
    return { threadType: type, threadId: id, messages: messages.list(type, id, req.user) };
  });

  app.post("/api/threads/:type/:id", async (req): Promise<MessageView> => {
    const user = requireVerified(req);
    const { type, id } = parseParams(threadParams, req.params);
    const body = parseBody(postMessageBody, req.body);
    return messages.post(user, type, id, body);
  });

  app.post("/api/messages/precheck", async (req): Promise<MessagePrecheckResponse> => {
    const user = requireVerified(req);
    const { body } = parseBody(messagePrecheckBody, req.body);
    return messages.precheck(user, body);
  });

  app.get("/api/messages/:id", async (req): Promise<MessageView> => messages.get(mid(req.params), req.user));

  app.patch("/api/messages/:id", async (req): Promise<MessageView> => {
    const user = requireVerified(req);
    const id = mid(req.params);
    const { body, acknowledgePii } = parseBody(editMessageBody, req.body);
    return messages.edit(user, id, body, acknowledgePii);
  });

  // Gizli/mühürlü mesajlarda sürümleri yalnız denetçi görür (servis görüntüleyene göre karar verir).
  app.get("/api/messages/:id/versions", async (req): Promise<MessageVersionView[]> => messages.versions(req.user, mid(req.params)));

  app.post("/api/messages/:id/endorse", async (req): Promise<MessageView> => {
    const user = requireVerified(req);
    const id = mid(req.params);
    const { value } = parseBody(endorseBody, req.body);
    return messages.endorse(user, id, value);
  });

  app.post("/api/messages/:id/rebuttal", async (req): Promise<MessageView> => {
    const user = requireVerified(req);
    const id = mid(req.params);
    const { body } = parseBody(rebuttalBody, req.body);
    return messages.rebuttal(user, id, body);
  });

  app.get("/api/messages/:id/hidden", async (req): Promise<HiddenMessageResponse> => {
    const user = requireRole(req, "auditor");
    return messages.readHidden(user, mid(req.params));
  });
}
