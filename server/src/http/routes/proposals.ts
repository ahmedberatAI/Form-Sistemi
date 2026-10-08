// Öneriler: liste, ön denetim, oluşturma, sürümler, destek, öneriler (suggestion), hak bayrağı, oy, itiraz,
// azınlık raporu, bilirkişi talebi/sorusu, bülten, seçmen listesi, YZ özet/köprü taslakları.
import type { FastifyInstance } from "fastify";
import type {
  AiAnalysisInfo,
  BallotReceipt,
  BulletinResponse,
  CreateProposalRequest,
  ExpertQuestion,
  MinorityReport,
  PersonalizedProposalList,
  PrecheckResponse,
  ProposalDetail,
  ProposalSummary,
  Suggestion,
  VoterListResponse,
} from "@forum/shared";
import { requireUser, requireVerified, requireVoter } from "../auth";
import {
  createProposalBody,
  expertQuestionBody,
  expertRequestBody,
  idParams,
  minorityReportBody,
  objectionBody,
  proposalListQuery,
  rightsFlagBody,
  suggestionBody,
  suggestionDecisionBody,
  suggestionParams,
  updateProposalBody,
  voteBody,
} from "../schemas";
import type { RouteDeps } from "../types";
import { parseBody, parseParams, parseQuery, validationError } from "../validation";
import { recentFromHeader } from "./discovery";

export function registerProposalRoutes(app: FastifyInstance, { services }: RouteDeps): void {
  const proposals = services.forum.proposals;
  const discovery = services.forum.discovery;
  const pid = (params: unknown) => parseParams(idParams, params).id;

  // sort=sana-gore: aynı küme (aynı süzgeç ve limit), kişisel sırada → PersonalizedProposalList; aksi halde ProposalSummary[].
  // Son açılanlar yalnız X-Forum-Recent başlığıyla (sorgu dizesindeki recent 400).
  app.get("/api/proposals", async (req): Promise<ProposalSummary[] | PersonalizedProposalList> => {
    const { sort, ...query } = parseQuery(proposalListQuery, req.query);
    const recent = recentFromHeader(req);
    if (recent !== undefined && sort !== "sana-gore") {
      throw validationError({ recent: "Son açılanlar (X-Forum-Recent) yalnız sort=sana-gore ile birlikte gönderilebilir." });
    }
    if (query.mine) requireUser(req);
    const list = proposals.list(query, req.user);
    return sort === "sana-gore" ? discovery.personalize(req.user, list, recent ?? []) : list;
  });

  app.post("/api/proposals/precheck", async (req): Promise<PrecheckResponse> => {
    const user = requireVerified(req);
    const body: CreateProposalRequest = parseBody(createProposalBody, req.body);
    return proposals.precheck(user, body);
  });

  app.post("/api/proposals", async (req): Promise<ProposalDetail> => {
    const user = requireVerified(req);
    const body: CreateProposalRequest = parseBody(createProposalBody, req.body);
    return proposals.create(user, body);
  });

  // Oylama sürerken sonuçlar servis tarafından gizlenir (yalnız katılım).
  app.get("/api/proposals/:id", async (req): Promise<ProposalDetail> => proposals.get(pid(req.params), req.user));

  app.patch("/api/proposals/:id", async (req): Promise<ProposalDetail> => {
    const user = requireVerified(req);
    const id = pid(req.params);
    const body = parseBody(updateProposalBody, req.body);
    return proposals.update(user, id, body);
  });

  app.post("/api/proposals/:id/submit", async (req): Promise<ProposalDetail> => {
    const user = requireVerified(req);
    return proposals.submit(user, pid(req.params));
  });

  app.post("/api/proposals/:id/sponsor", async (req): Promise<ProposalDetail> => {
    const user = requireVerified(req);
    return proposals.sponsor(user, pid(req.params));
  });

  app.post("/api/proposals/:id/withdraw", async (req): Promise<ProposalDetail> => {
    const user = requireVerified(req);
    return proposals.withdraw(user, pid(req.params));
  });

  app.post("/api/proposals/:id/suggestions", async (req): Promise<Suggestion> => {
    const user = requireVerified(req);
    const id = pid(req.params);
    const { body } = parseBody(suggestionBody, req.body);
    return proposals.suggest(user, id, body);
  });

  app.post("/api/proposals/:id/suggestions/:sid/decide", async (req): Promise<ProposalDetail> => {
    const user = requireVerified(req);
    const { id, sid } = parseParams(suggestionParams, req.params);
    const { decision } = parseBody(suggestionDecisionBody, req.body);
    return proposals.decideSuggestion(user, id, sid, decision);
  });

  app.post("/api/proposals/:id/rights-flags", async (req): Promise<ProposalDetail> => {
    const user = requireVerified(req);
    const id = pid(req.params);
    const body = parseBody(rightsFlagBody, req.body);
    return proposals.flagRight(user, id, body);
  });

  app.post("/api/proposals/:id/vote", async (req): Promise<BallotReceipt> => {
    const user = requireVoter(req);
    const id = pid(req.params);
    const { choice } = parseBody(voteBody, req.body);
    return proposals.vote(user, id, choice);
  });

  app.get("/api/proposals/:id/receipts", async (req): Promise<BallotReceipt[]> => {
    const user = requireUser(req);
    return proposals.receipts(user, pid(req.params));
  });

  app.post("/api/proposals/:id/objections", async (req): Promise<ProposalDetail> => {
    const user = requireVoter(req);
    const id = pid(req.params);
    const body = parseBody(objectionBody, req.body);
    return proposals.object(user, id, body);
  });

  app.post("/api/proposals/:id/minority-reports", async (req): Promise<MinorityReport> => {
    const user = requireVoter(req);
    const id = pid(req.params);
    const { body } = parseBody(minorityReportBody, req.body);
    return proposals.minorityReport(user, id, body);
  });

  app.post("/api/proposals/:id/expert-request", async (req): Promise<ProposalDetail> => {
    const user = requireVerified(req);
    const id = pid(req.params);
    const { kind } = parseBody(expertRequestBody, req.body);
    return proposals.requestExpert(user, id, kind);
  });

  app.post("/api/proposals/:id/expert-questions", async (req): Promise<ExpertQuestion> => {
    const user = requireVerified(req);
    const id = pid(req.params);
    const { body } = parseBody(expertQuestionBody, req.body);
    return proposals.expertQuestion(user, id, body);
  });

  app.get("/api/proposals/:id/bulletin", async (req): Promise<BulletinResponse> => proposals.bulletin(pid(req.params)));

  app.get("/api/proposals/:id/voters", async (req): Promise<VoterListResponse> => proposals.voters(pid(req.params)));

  app.post("/api/proposals/:id/ai/summary", async (req): Promise<AiAnalysisInfo> => {
    const user = requireVerified(req);
    return proposals.aiSummary(user, pid(req.params));
  });

  app.post("/api/proposals/:id/ai/bridging", async (req): Promise<AiAnalysisInfo> => {
    const user = requireVerified(req);
    return proposals.aiBridging(user, pid(req.params));
  });
}
