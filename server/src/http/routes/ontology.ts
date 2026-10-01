// Ontoloji (yönetmelik): genel bakış, sürümler, Turtle dökümü, yama doğrulama.
import type { FastifyInstance } from "fastify";
import type { AuditReport, BylawVersionInfo, OntologyOverview } from "@forum/shared";
import { requireVerified } from "../auth";
import { turtleQuery, validatePatchBody } from "../schemas";
import type { RouteDeps } from "../types";
import { parseBody, parseQuery } from "../validation";

export function registerOntologyRoutes(app: FastifyInstance, { services }: RouteDeps): void {
  const { ontology } = services;

  app.get("/api/ontology", async (): Promise<OntologyOverview> => ({
    version: ontology.current(),
    categories: ontology.categories(),
    rights: ontology.rights(),
    articles: ontology.articles(),
    deletionGrounds: ontology.deletionGrounds(),
    objectionGrounds: ontology.objectionGrounds(),
    contentLabels: ontology.contentLabels(),
    tiers: ontology.tiers(),
    params: ontology.adjustableParams(),
  }));

  app.get("/api/ontology/versions", async (): Promise<BylawVersionInfo[]> => ontology.versions());

  app.get("/api/ontology/turtle", async (req, reply) => {
    const { version } = parseQuery(turtleQuery, req.query);
    const ttl = ontology.exportTurtle(version);
    return reply.type("text/turtle; charset=utf-8").send(ttl);
  });

  app.post("/api/ontology/validate-patch", async (req): Promise<AuditReport> => {
    requireVerified(req);
    const { patch } = parseBody(validatePatchBody, req.body);
    return ontology.validatePatch(patch);
  });
}
