// Hesabım: profil, rızalar, şifre, KVKK (döküm / kripto-imha), vekâletler, bildirimler, görevler.
import type { FastifyInstance } from "fastify";
import type {
  CorrectionRequestInput,
  CorrectionRequestView,
  DashboardTask,
  DelegationView,
  Me,
  MyAssignment,
  MyDelegations,
  NotificationList,
  OkResponse,
  PublicUser,
} from "@forum/shared";
import type { OntologyService } from "../../core/contracts";
import { AppError, badRequest } from "../../core/errors";
import { requireExpert, requireUser, requireVerified } from "../auth";
import { changeNicknameBody, changePasswordBody, consentsBody, correctionBody, delegateBody, eraseBody, idParams, markReadBody, notificationsQuery } from "../schemas";
import type { RouteDeps } from "../types";
import { parseBody, parseParams, parseQuery } from "../validation";

/** Kripto-imha onayı: kullanıcı tam olarak bunu yazmalıdır (NFC karşılaştırma). */
export const ERASE_CONFIRMATION = "SİL";

function categoryIris(ontology: OntologyService): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: ReturnType<OntologyService["categories"]>) => {
    for (const n of nodes) {
      out.add(n.iri);
      walk(n.children);
    }
  };
  walk(ontology.categories());
  return out;
}

export function registerMeRoutes(app: FastifyInstance, { services }: RouteDeps): void {
  const { identity, forum, graph, ontology, experts, notifier } = services;

  app.get("/api/me", async (req): Promise<Me> => forum.community.me(requireUser(req).id));

  app.patch("/api/me/consents", async (req): Promise<Me> => {
    const user = requireUser(req);
    const body = parseBody(consentsBody, req.body);
    identity.setConsents(user.id, body);
    return forum.community.me(user.id);
  });

  app.post("/api/me/password", async (req): Promise<OkResponse> => {
    const user = requireUser(req);
    const body = parseBody(changePasswordBody, req.body);
    // Mevcut oturum açık kalır; diğer tüm oturumlar kapatılır.
    await identity.changePassword(user.id, body.oldPassword, body.newPassword, req.authToken ?? undefined);
    return { ok: true };
  });

  // Takma ad değişikliği: şifre teyidi, tekillik + benzerlik denetimi, 30 günde bir, denetim kaydı.
  app.patch("/api/me/nickname", async (req): Promise<Me> => {
    const user = requireUser(req);
    const body = parseBody(changeNicknameBody, req.body);
    await identity.changeNickname(user.id, body.nickname, body.password);
    return forum.community.me(user.id);
  });

  app.get("/api/me/export", async (req, reply): Promise<Record<string, unknown>> => {
    const user = requireUser(req);
    reply.header("content-disposition", 'attachment; filename="kvkk-verilerim.json"');
    return identity.exportOwnData(user.id);
  });

  app.post("/api/me/erase", async (req): Promise<OkResponse> => {
    const user = requireUser(req);
    const body = parseBody(eraseBody, req.body);
    if (body.confirm.normalize("NFC") !== ERASE_CONFIRMATION) {
      const msg = `Hesabınızı silmek için onay alanına tam olarak "${ERASE_CONFIRMATION}" yazmalısınız.`;
      throw badRequest("validation", msg, { confirm: msg });
    }
    if (!(await identity.verifyPassword(user.id, body.password))) {
      throw new AppError(400, "wrong_password", "Şifre hatalı.", { password: "Şifre hatalı." });
    }
    // Aktif vekâletler geri alınır (kenarlar silinmez). Bu kişiye verilmiş vekâletler de düşer; verenlere haber verilir.
    for (const d of graph.delegations(user.id)) graph.revokeDelegation(d.id, user.id);
    for (const d of graph.delegations().filter((x) => x.to === user.id)) {
      graph.revokeDelegation(d.id, d.from);
      notifier.notify(d.from, {
        kind: "delegation_revoked",
        title: "Vekâletiniz düştü",
        body: "Vekâlet verdiğiniz üye hesabını kapattığı için bu vekâlet geri alındı. Dilerseniz başka bir üyeye vekâlet verebilirsiniz.",
        link: "/profil",
      });
    }
    await identity.eraseSelf(user.id);
    return { ok: true };
  });

  // KVKK md. 11/1-d: kimlik verisi düzeltme talebi (kayıt memuru inceler; değerler şifreli saklanır, günlüğe yazılmaz).
  app.post("/api/me/corrections", async (req): Promise<CorrectionRequestView> => {
    const user = requireUser(req);
    const body = parseBody(correctionBody, req.body) as unknown as CorrectionRequestInput;
    return identity.requestCorrection(user.id, body);
  });

  app.get("/api/me/corrections", async (req): Promise<CorrectionRequestView[]> => identity.myCorrections(requireUser(req).id));

  app.post("/api/me/corrections/:id/withdraw", async (req): Promise<CorrectionRequestView> => {
    const user = requireUser(req);
    const { id } = parseParams(idParams, req.params);
    return identity.withdrawCorrection(user.id, id);
  });

  app.get("/api/me/delegations", async (req): Promise<MyDelegations> => forum.community.delegations(requireUser(req).id));

  app.post("/api/me/delegations", async (req): Promise<DelegationView> => {
    const user = requireVerified(req);
    const body = parseBody(delegateBody, req.body);
    if (body.scope !== "*" && !categoryIris(ontology).has(body.scope)) {
      const msg = 'Vekâlet kapsamı "*" (genel) ya da yönetmelikte tanımlı bir kategori olmalıdır.';
      throw badRequest("invalid_scope", msg, { scope: msg });
    }
    return graph.delegate(user.id, body.to, body.scope, body.rank);
  });

  app.delete("/api/me/delegations/:id", async (req): Promise<OkResponse> => {
    const user = requireUser(req);
    const { id } = parseParams(idParams, req.params);
    graph.revokeDelegation(id, user.id);
    return { ok: true };
  });

  app.get("/api/me/following", async (req): Promise<PublicUser[]> => forum.community.following(requireUser(req).id));

  app.get("/api/me/notifications", async (req): Promise<NotificationList> => {
    const user = requireUser(req);
    const q = parseQuery(notificationsQuery, req.query);
    const { items, unread } = forum.community.notifications(user.id, { unreadOnly: q.unread === true });
    return { items, unread };
  });

  app.post("/api/me/notifications/read", async (req): Promise<OkResponse> => {
    const user = requireUser(req);
    const body = parseBody(markReadBody, req.body);
    forum.community.markRead(user.id, body.ids && body.ids.length ? body.ids : undefined);
    return { ok: true };
  });

  app.get("/api/me/tasks", async (req): Promise<DashboardTask[]> => forum.community.tasks(requireUser(req)));

  app.get("/api/me/assignments", async (req): Promise<MyAssignment[]> => {
    const user = requireExpert(req, experts);
    const proposals = new Map<string, { title: string; seq: number }>();
    const proposalOf = (id: string) => {
      let p = proposals.get(id);
      if (!p) {
        try {
          const d = forum.proposals.get(id, user);
          p = { title: d.title, seq: d.seq };
        } catch {
          p = { title: "", seq: 0 };
        }
        proposals.set(id, p);
      }
      return p;
    };
    return experts.assignmentsFor(user.id).map((a) => {
      const p = proposalOf(a.proposalId);
      const questions = (experts.panel(a.proposalId)?.questions ?? []).map((q) => ({ id: q.id, body: q.body, minorityGuaranteed: q.minorityGuaranteed }));
      return {
        assignmentId: a.assignmentId,
        proposalId: a.proposalId,
        proposalTitle: p.title,
        proposalSeq: p.seq,
        status: a.status,
        dueAt: a.dueAt,
        questions,
      };
    });
  });
}
