import type { FastifyInstance } from "fastify";
import type { RouteDeps } from "../types";
import { registerAdminRoutes } from "./admin";
import { registerAiRoutes } from "./ai";
import { registerAuthRoutes } from "./auth";
import { registerDiscoveryRoutes } from "./discovery";
import { registerExpertRoutes } from "./experts";
import { registerGraphRoutes } from "./graph";
import { registerLedgerRoutes } from "./ledger";
import { registerMeRoutes } from "./me";
import { registerMessageRoutes } from "./messages";
import { registerOntologyRoutes } from "./ontology";
import { registerProposalRoutes } from "./proposals";
import { registerRegistrarRoutes } from "./registrar";
import { registerSystemRoutes } from "./system";
import { registerTopicRoutes } from "./topics";
import { registerUserRoutes } from "./users";

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  registerSystemRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerMeRoutes(app, deps);
  registerRegistrarRoutes(app, deps);
  registerAdminRoutes(app, deps);
  registerUserRoutes(app, deps);
  registerOntologyRoutes(app, deps);
  registerProposalRoutes(app, deps);
  registerTopicRoutes(app, deps);
  registerDiscoveryRoutes(app, deps);
  registerMessageRoutes(app, deps);
  registerExpertRoutes(app, deps);
  registerGraphRoutes(app, deps);
  registerLedgerRoutes(app, deps);
  registerAiRoutes(app, deps);
}
