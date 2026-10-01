// Bilirkişi: liste, başvuru, yönetici kararı ve yaptırım, görev yanıtı ve rapor, hukuki nitelendirme denetimi.
import type { FastifyInstance } from "fastify";
import { aiLabel, type ExpertInfo, type ExpertPanelInfo, type ExpertReportView, type LintResponse } from "@forum/shared";
import { requireExpert, requireRole, requireUser, requireVerified } from "../auth";
import {
  assignmentRespondBody,
  expertApplyBody,
  expertDecisionBody,
  expertReportBody,
  expertSanctionBody,
  expertsQuery,
  idParams,
  lintBody,
  userIdParams,
} from "../schemas";
import type { RouteDeps } from "../types";
import { parseBody, parseParams, parseQuery } from "../validation";

export function registerExpertRoutes(app: FastifyInstance, { services }: RouteDeps): void {
  const { experts, ai, clock } = services;

  app.get("/api/experts", async (req): Promise<ExpertInfo[]> => {
    const { status, domain } = parseQuery(expertsQuery, req.query);
    // Yeterlilik beyanı (credentials) yalnız yönetici/kayıt memuru/denetçi ve bilirkişinin kendisine; diğerlerine null.
    const viewer = req.user?.status === "verified" ? { id: req.user.id, roles: req.user.roles } : null;
    return experts.list({ status, domain }, viewer);
  });

  app.post("/api/experts/apply", async (req): Promise<ExpertInfo> => {
    const user = requireVerified(req);
    const { domains, credentials } = parseBody(expertApplyBody, req.body);
    return experts.apply(user.id, domains, credentials);
  });

  app.post("/api/experts/:userId/decide", async (req): Promise<ExpertInfo> => {
    const actor = requireRole(req, "admin");
    const { userId } = parseParams(userIdParams, req.params);
    const { decision, note } = parseBody(expertDecisionBody, req.body);
    return experts.decideApplication(actor.id, userId, decision, note);
  });

  app.post("/api/experts/:userId/sanction", async (req): Promise<ExpertInfo> => {
    const actor = requireRole(req, "admin");
    const { userId } = parseParams(userIdParams, req.params);
    const { action, note } = parseBody(expertSanctionBody, req.body);
    return experts.sanction(actor.id, userId, action, note);
  });

  app.post("/api/experts/assignments/:id/respond", async (req): Promise<ExpertPanelInfo> => {
    const user = requireExpert(req, experts);
    const { id } = parseParams(idParams, req.params);
    const { decision, reason } = parseBody(assignmentRespondBody, req.body);
    return experts.respond(id, user.id, decision, reason);
  });

  app.post("/api/experts/assignments/:id/report", async (req): Promise<ExpertReportView> => {
    const user = requireExpert(req, experts);
    const { id } = parseParams(idParams, req.params);
    const body = parseBody(expertReportBody, req.body);
    return experts.submitReport(id, user.id, body);
  });

  app.post("/api/experts/lint", async (req): Promise<LintResponse> => {
    const user = requireUser(req);
    const { text } = parseBody(lintBody, req.body);
    // YZ rızası yoksa metin yurt dışına gönderilmez: çevrimdışı sezgisel denetim.
    const r = await ai.lintExpertReport(text, { forceOffline: !user.aiConsent });
    return { issues: r.issues, offline: r.offline, model: r.model, aiLabel: aiLabel(r.model, clock.now()) };
  });
}
