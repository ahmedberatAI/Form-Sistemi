// users satırı ↔ PublicUser / Me dönüşümleri ve oy yeterliliği.
import { publicJoinDay, type Me, type PublicUser, type Role, type UserStatus } from "@forum/shared";
import type { AuthUser } from "../core/contracts";
import { json, type Db } from "../db";

export const ALL_ROLES: readonly Role[] = ["member", "registrar", "auditor", "admin"];

export interface UserRow {
  id: string;
  nickname: string;
  nickname_norm: string;
  password_hash: string;
  roles: string;
  status: UserStatus;
  is_adult: number;
  region_il: string | null;
  region_ilce: string | null;
  political_consent: number;
  ai_consent: number;
  /** Kişisel sıralama tercihi (şema sürümü 4; varsayılan 1 = açık) */
  personal_ranking: number;
  kvkk_notice_at: number | null;
  created_at: number;
  verified_at: number | null;
  verified_by: string | null;
  reputation: number;
}

export interface ExpertRowLike {
  status: string;
  domains: string;
}

export function parseRoles(raw: unknown): Role[] {
  const arr = json<unknown[]>(typeof raw === "string" ? raw : null, []);
  const set = new Set<Role>(["member"]);
  for (const r of arr) if (typeof r === "string" && (ALL_ROLES as readonly string[]).includes(r)) set.add(r as Role);
  return ALL_ROLES.filter((r) => set.has(r));
}

export function hasAnyRole(roles: readonly Role[], wanted: readonly Role[]): boolean {
  return wanted.some((r) => roles.includes(r));
}

export function toPublicUser(
  row: Pick<UserRow, "id" | "nickname" | "status" | "roles" | "reputation" | "created_at">,
  expert?: ExpertRowLike | null,
): PublicUser {
  // Hesabı kapanmış (silinmiş/reddedilmiş) üye hiçbir rolde görünmez; bilirkişi kaydı kapatılmamış eski veride de.
  const active = expert?.status === "active" && row.status !== "erased" && row.status !== "rejected";
  return {
    id: row.id,
    nickname: row.nickname,
    status: row.status,
    roles: parseRoles(row.roles),
    isExpert: active,
    expertDomains: active ? json<string[]>(expert!.domains, []) : [],
    reputation: Number(row.reputation ?? 0),
    // Herkese açık katılım tarihi güne yuvarlanır: tam an, defterdeki üyelik olaylarıyla eşleştirilmesin (KVKK.md §4.3).
    joinedAt: publicJoinDay(Number(row.created_at)),
  };
}

export function toMe(row: UserRow, expert?: ExpertRowLike | null): Me {
  return {
    ...toPublicUser(row, expert),
    joinedAt: Number(row.created_at), // yalnız sahibine: tam kayıt anı
    isAdult: row.is_adult === 1,
    aiConsent: row.ai_consent === 1,
    politicalConsent: row.political_consent === 1,
    personalRanking: row.personal_ranking !== 0,
    regionIl: row.region_il,
    regionIlce: row.region_ilce,
  };
}

export function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    nickname: row.nickname,
    roles: parseRoles(row.roles),
    status: row.status,
    isAdult: row.is_adult === 1,
    politicalConsent: row.political_consent === 1,
    aiConsent: row.ai_consent === 1,
  };
}

/** Oy kullanabilir mi: doğrulanmış + reşit + siyasi görüş açık rızası. */
export function isVoter(user: AuthUser): boolean {
  return user.status === "verified" && user.isAdult && user.politicalConsent;
}

export function loadUserRow(db: Db, userId: string): UserRow | undefined {
  return db.get<UserRow>("SELECT * FROM users WHERE id = ?", userId);
}

export function loadExpertRow(db: Db, userId: string): ExpertRowLike | null {
  return db.get<ExpertRowLike>("SELECT status, domains FROM experts WHERE user_id = ?", userId) ?? null;
}

/** Kolaylık: users + experts satırlarından PublicUser (yoksa null). */
export function loadPublicUser(db: Db, userId: string): PublicUser | null {
  const row = loadUserRow(db, userId);
  return row ? toPublicUser(row, loadExpertRow(db, userId)) : null;
}
