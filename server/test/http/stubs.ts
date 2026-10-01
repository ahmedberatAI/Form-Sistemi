// HTTP katmanı birim testleri için sahte servis kümesi: tanımlanmayan her metot çağrıldığında açık bir hata fırlatır.
import type { Me, Role } from "@forum/shared";
import { createAuditLogger } from "../../src/core/audit";
import type { Config } from "../../src/core/config";
import type { AuthUser, IdentityService } from "../../src/core/contracts";
import type { ForumServices } from "../../src/core/forum-contracts";
import { MemoryNotifier } from "../../src/core/notifier";
import { buildServer } from "../../src/http";
import type { AppServices, HttpOptions } from "../../src/http/types";
import { makeCtx, type TestCtx } from "../helpers/fakes";

export class NotStubbed extends Error {}

export function stub<T extends object>(name: string, impl: Partial<T> = {}): T {
  return new Proxy(impl as T, {
    get(target, prop) {
      if (prop in target) return (target as Record<PropertyKey, unknown>)[prop];
      if (prop === "then" || typeof prop === "symbol") return undefined;
      return () => {
        throw new NotStubbed(`${name}.${String(prop)} bu testte tanımlı değil`);
      };
    },
  });
}

export interface FakeUser extends AuthUser {
  token: string;
}

export function fakeUser(nickname: string, opts: Partial<AuthUser> = {}): FakeUser {
  return {
    id: `u-${nickname}`,
    nickname,
    roles: ["member"] as Role[],
    status: "verified",
    isAdult: true,
    politicalConsent: true,
    aiConsent: false,
    ...opts,
    token: `tok-${nickname}`,
  };
}

export const meOf = (u: AuthUser): Me => ({
  id: u.id,
  nickname: u.nickname,
  status: u.status,
  roles: u.roles,
  isExpert: false,
  expertDomains: [],
  reputation: 0,
  joinedAt: 0,
  isAdult: u.isAdult,
  aiConsent: u.aiConsent,
  politicalConsent: u.politicalConsent,
});

export interface StubOverrides {
  identity?: Partial<IdentityService>;
  forum?: { [K in keyof ForumServices]?: Partial<ForumServices[K]> };
  ledger?: Partial<AppServices["ledger"]>;
  ontology?: Partial<AppServices["ontology"]>;
  graph?: Partial<AppServices["graph"]>;
  ai?: Partial<AppServices["ai"]>;
  experts?: Partial<AppServices["experts"]>;
}

export interface StubApp {
  services: AppServices;
  ctx: TestCtx;
  notifier: MemoryNotifier;
  users: Map<string, FakeUser>;
  addUser(u: FakeUser): FakeUser;
  auth(u: FakeUser): { authorization: string };
}

export function stubServices(o: StubOverrides = {}, config: Partial<Config> = {}): StubApp {
  const ctx = makeCtx(config);
  const users = new Map<string, FakeUser>();
  const notifier = new MemoryNotifier();
  const identity = stub<IdentityService>("identity", {
    authenticate: (token) => {
      const u = users.get(token);
      if (!u) return null;
      const { token: _t, ...auth } = u;
      return auth;
    },
    ...o.identity,
  });
  const f = o.forum ?? {};
  const forum: ForumServices = {
    proposals: stub("forum.proposals", f.proposals),
    topics: stub("forum.topics", f.topics),
    messages: stub("forum.messages", f.messages),
    clusters: stub("forum.clusters", f.clusters),
    community: stub("forum.community", f.community),
    lifecycle: stub("forum.lifecycle", f.lifecycle),
  };
  const services: AppServices = {
    ctx,
    clock: ctx.clock,
    ledger: stub("ledger", o.ledger),
    ontology: stub("ontology", o.ontology),
    graph: stub("graph", o.graph),
    math: stub("math"),
    identity,
    ai: stub("ai", o.ai),
    aiSink: stub("aiSink"),
    experts: stub("experts", o.experts),
    notifier,
    audit: createAuditLogger(ctx),
    forum,
  };
  return {
    services,
    ctx,
    notifier,
    users,
    addUser(u) {
      users.set(u.token, u);
      return u;
    },
    auth: (u) => ({ authorization: `Bearer ${u.token}` }),
  };
}

export async function stubServer(s: StubApp, opts: HttpOptions = { rateLimit: false }) {
  return buildServer(s.services, s.ctx.config, opts);
}
