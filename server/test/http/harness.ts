// Gerçek bileşim köküyle (createApp) entegrasyon testleri için yardımcılar: fastify.inject, ağ portu açılmaz.
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { generateTckn, type AuthResponse, type Me, type RegistrationInput, type Role } from "@forum/shared";
import { createApp, type App } from "../../src/app";
import { ManualClock } from "../../src/core/clock";
import { testConfig, type Config } from "../../src/core/config";

export interface Harness extends App {
  clock: ManualClock;
  req(method: InjectOptions["method"], url: string, opts?: { token?: string | null; body?: unknown; headers?: Record<string, string> }): Promise<LightMyRequestResponse>;
  /** 2xx bekler ve JSON gövdeyi döndürür; değilse ayrıntılı hata fırlatır. */
  ok<T = unknown>(method: InjectOptions["method"], url: string, opts?: { token?: string | null; body?: unknown; headers?: Record<string, string> }): Promise<T>;
  /** Yeni üye kaydı (HTTP) → AuthResponse (durum pending). */
  register(nickname: string, over?: Partial<RegistrationInput>): Promise<AuthResponse>;
  /** Doğrudan doğrulanmış üye (kayıt memuru "Üyeyi sisteme gir") + giriş. */
  member(nickname: string, over?: Partial<RegistrationInput>): Promise<{ token: string; user: Me }>;
  login(nickname: string): Promise<{ token: string; user: Me }>;
  /** Kendi kendine kayıt + doğrudan veritabanında rol/doğrulama (yalnız testlerde ilk personel için). */
  staff(nickname: string, roles: Role[]): Promise<{ token: string; user: Me }>;
}

export const PASSWORD = "Guvenli-Sifre-2026";
let seq = 0;

export function registrationInput(nickname: string, over: Partial<RegistrationInput> = {}): RegistrationInput {
  seq++;
  const n = String(seq).padStart(4, "0");
  return {
    nickname,
    password: PASSWORD,
    firstName: "Deneme",
    lastName: "Kullanıcı",
    tckn: generateTckn(`1${n}${String(seq * 37).padStart(4, "0")}`.slice(0, 9)),
    birthDate: "1990-05-17",
    email: `${nickname.toLowerCase()}.${n}@ornek.org`,
    phone: `0555${String(1000000 + seq).slice(-7)}`,
    address: { il: "Ankara", ilce: "Çankaya", mahalle: "Kızılay", acikAdres: `Deneme Sokak No: ${seq}` },
    kvkkNoticeAccepted: true,
    politicalConsent: true,
    aiConsent: false,
    ...over,
  };
}

export async function boot(config: Partial<Config> = {}, opts: { rateLimit?: { global?: number; auth?: number } | false } = {}): Promise<Harness> {
  const clock = new ManualClock();
  const created = await createApp(testConfig({ dataDir: ":memory:", dbPath: ":memory:", ledgerBlockIntervalMs: 5, ...config }), {
    clock,
    startTimers: false,
    aiClient: null,
    rateLimit: opts.rateLimit ?? false,
  });
  const { app, services } = created;
  let registrarToken: string | null = null;

  const req: Harness["req"] = (method, url, o = {}) => {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.token) headers.authorization = `Bearer ${o.token}`;
    return app.inject({ method, url, headers, payload: o.body === undefined ? undefined : (o.body as InjectOptions["payload"]) });
  };
  const ok: Harness["ok"] = async <T>(method: InjectOptions["method"], url: string, o: { token?: string | null; body?: unknown; headers?: Record<string, string> } = {}) => {
    const r = await req(method, url, o);
    if (r.statusCode < 200 || r.statusCode >= 300) throw new Error(`${method} ${url} → ${r.statusCode}: ${r.body}`);
    return (r.body ? r.json() : undefined) as T;
  };
  const login = (nickname: string) => ok<{ token: string; user: Me }>("POST", "/api/auth/login", { body: { login: nickname, password: PASSWORD } });
  const register = (nickname: string, over?: Partial<RegistrationInput>) =>
    ok<AuthResponse>("POST", "/api/auth/register", { body: registrationInput(nickname, over) });

  const staff = async (nickname: string, roles: Role[]) => {
    const { user } = await register(nickname);
    services.ctx.db.run(
      "UPDATE users SET status = 'verified', verified_at = ?, roles = ? WHERE id = ?",
      clock.now(),
      JSON.stringify(Array.from(new Set<Role>(["member", ...roles]))),
      user.id,
    );
    return login(nickname);
  };

  const member = async (nickname: string, over?: Partial<RegistrationInput>) => {
    if (!registrarToken) registrarToken = (await staff("kayit_memuru", ["registrar"])).token;
    await ok("POST", "/api/registrar/users", { token: registrarToken, body: registrationInput(nickname, over) });
    return login(nickname);
  };

  return { ...created, clock, req, ok, register, member, login, staff };
}
