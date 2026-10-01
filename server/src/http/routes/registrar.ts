// Kayıt memuru: bekleyen başvurular, kişisel veri görüntüleme (amaç zorunlu, erişim kaydı), doğrulama, yüz yüze kayıt.
import type { FastifyInstance } from "fastify";
import type { Me, PendingUser, PiiRecord, RegistrationInput } from "@forum/shared";
import { requireRole } from "../auth";
import { idParams, piiBody, registrationBody, verifyUserBody } from "../schemas";
import type { RouteDeps } from "../types";
import { parseBody, parseParams } from "../validation";

export function registerRegistrarRoutes(app: FastifyInstance, { services }: RouteDeps): void {
  const { identity } = services;

  app.get("/api/registrar/pending", async (req): Promise<PendingUser[]> => {
    requireRole(req, "registrar", "auditor");
    return identity.listPending().map((u) => ({ id: u.id, nickname: u.nickname, createdAt: u.createdAt }));
  });

  app.post("/api/registrar/users/:id/pii", async (req): Promise<PiiRecord> => {
    const actor = requireRole(req, "registrar", "auditor");
    const { id } = parseParams(idParams, req.params);
    const { purpose } = parseBody(piiBody, req.body);
    // Erişim kaydı (pii_access_log + denetim günlüğü) kimlik modülünde yazılır.
    return identity.getPii(actor.id, id, purpose);
  });

  app.post("/api/registrar/users/:id/verify", async (req): Promise<Me> => {
    const actor = requireRole(req, "registrar");
    const { id } = parseParams(idParams, req.params);
    const body = parseBody(verifyUserBody, req.body);
    return identity.verify(actor.id, id, body.decision, body.note);
  });

  app.post("/api/registrar/users", async (req): Promise<{ user: Me }> => {
    const actor = requireRole(req, "registrar");
    const input = parseBody(registrationBody, req.body) as unknown as RegistrationInput;
    const { user } = await identity.createByRegistrar(actor.id, input);
    return { user };
  });
}
