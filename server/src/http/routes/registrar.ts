// Kayıt memuru: bekleyen başvurular, kişisel veri görüntüleme (amaç zorunlu, erişim kaydı), doğrulama, yüz yüze kayıt,
// kimlik verisi düzeltme talepleri (amaç belirterek inceleme + karar).
import type { FastifyInstance } from "fastify";
import type { CorrectionRequestView, CorrectionReview, Me, PendingUser, PiiRecord, RegistrationInput } from "@forum/shared";
import { requireRole } from "../auth";
import { correctionDecisionBody, correctionListQuery, idParams, piiBody, registrationBody, verifyUserBody } from "../schemas";
import type { RouteDeps } from "../types";
import { parseBody, parseParams, parseQuery } from "../validation";

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

  // ── Kimlik verisi düzeltme talepleri (KVKK md. 11/1-d) ──

  app.get("/api/registrar/corrections", async (req): Promise<CorrectionRequestView[]> => {
    const actor = requireRole(req, "registrar", "auditor");
    const { status } = parseQuery(correctionListQuery, req.query);
    return identity.listCorrections(actor.id, status ?? "pending");
  });

  app.post("/api/registrar/corrections/:id/review", async (req): Promise<CorrectionReview> => {
    const actor = requireRole(req, "registrar", "auditor");
    const { id } = parseParams(idParams, req.params);
    const { purpose } = parseBody(piiBody, req.body);
    // Erişim kaydı (pii_access_log + denetim günlüğü) kimlik modülünde, değerler çözülmeden ÖNCE yazılır.
    return identity.reviewCorrection(actor.id, id, purpose);
  });

  app.post("/api/registrar/corrections/:id/decide", async (req): Promise<CorrectionRequestView> => {
    const actor = requireRole(req, "registrar");
    const { id } = parseParams(idParams, req.params);
    const body = parseBody(correctionDecisionBody, req.body);
    return identity.decideCorrection(actor.id, id, body.decision, body.note);
  });
}
