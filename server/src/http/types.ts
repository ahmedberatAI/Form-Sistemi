// HTTP katmanının ortak tipleri: bileşim kökünün ürettiği servis kümesi ve rota bağımlılıkları.
import type { onRequestHookHandler } from "fastify";
import type { AuditLogger } from "../core/audit";
import type { Clock } from "../core/clock";
import type { Config } from "../core/config";
import type {
  AiRecordSink,
  AiService,
  AuthUser,
  CoreContext,
  ExpertService,
  GovernanceMath,
  GraphService,
  IdentityService,
  LedgerService,
  Notifier,
  OntologyService,
} from "../core/contracts";
import type { ForumServices } from "../core/forum-contracts";

export interface AppServices {
  ctx: CoreContext;
  clock: Clock;
  ledger: LedgerService;
  ontology: OntologyService;
  graph: GraphService;
  math: GovernanceMath;
  identity: IdentityService;
  ai: AiService;
  aiSink: AiRecordSink;
  experts: ExpertService;
  notifier: Notifier;
  audit: AuditLogger;
  forum: ForumServices;
}

/** Hız sınırı ayarları (istek/dakika/IP). `false`: tamamen kapalı (yalnız testler). */
export type RateLimitOptions = { global?: number; auth?: number } | false;

export interface HttpOptions {
  logger?: boolean;
  rateLimit?: RateLimitOptions;
}

export interface RouteDeps {
  services: AppServices;
  config: Config;
  /** /api/auth/* uçları için ortak (daha sıkı) hız sınırlayıcı; hız sınırı kapalıysa boş. */
  authLimiter: onRequestHookHandler[];
}

declare module "fastify" {
  interface FastifyRequest {
    /** Bearer belirteciyle doğrulanmış kullanıcı (oturum yoksa null). */
    user: AuthUser | null;
    /** İstekteki ham belirteç (çıkış ve şifre değişikliğinde oturumu korumak için). */
    authToken: string | null;
  }
}
