// Kimlik: kayıt, giriş, çıkış. /api/auth/* uçları ortak sıkı hız sınırını kullanır.
import type { FastifyInstance, RouteShorthandOptions } from "fastify";
import type { AuthResponse, OkResponse, RegistrationInput } from "@forum/shared";
import { requireUser } from "../auth";
import { loginBody, registrationBody } from "../schemas";
import type { RouteDeps } from "../types";
import { parseBody } from "../validation";

export function registerAuthRoutes(app: FastifyInstance, { services, authLimiter }: RouteDeps): void {
  const { identity } = services;
  const limited: RouteShorthandOptions = { onRequest: authLimiter, config: { rateLimit: false } };

  app.post("/api/auth/register", limited, async (req): Promise<AuthResponse> => {
    const input = parseBody(registrationBody, req.body) as unknown as RegistrationInput;
    await identity.register(input);
    // Kayıt yalnız kullanıcıyı döndürür; doğrulama bekleyen üye de oturum açabilir (durum: pending).
    const { token, user } = await identity.login(String(input.nickname), String(input.password));
    return { token, user };
  });

  app.post("/api/auth/login", limited, async (req): Promise<AuthResponse> => {
    const { login, password } = parseBody(loginBody, req.body);
    const { token, user } = await identity.login(login, password);
    return { token, user };
  });

  app.post("/api/auth/logout", limited, async (req): Promise<OkResponse> => {
    requireUser(req);
    if (req.authToken) identity.logout(req.authToken);
    return { ok: true };
  });
}
