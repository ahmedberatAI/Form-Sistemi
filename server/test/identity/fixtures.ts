// Kimlik testleri için ortak kurulum.
import { generateTckn, type RegistrationInput } from "@forum/shared";
import { createAuditLogger } from "../../src/core/audit";
import { MemoryNotifier } from "../../src/core/notifier";
import { createIdentityService, type IdentityDeps } from "../../src/identity";
import { FakeLedger, insertUser, makeCtx } from "../helpers/fakes";

let seq = 0;

export function regInput(over: Partial<RegistrationInput> = {}): RegistrationInput {
  seq++;
  return {
    nickname: `kullanici${seq}`,
    password: "Gizli1234",
    firstName: "Ayşe",
    lastName: "Yılmaz",
    tckn: generateTckn(String(100000000 + seq * 7919)),
    birthDate: "1990-05-15",
    email: `ayse${seq}@ornek.com.tr`,
    phone: "0532 123 45 67",
    address: { il: "Ankara", ilce: "Çankaya", mahalle: "Kızılay Mahallesi", acikAdres: `Atatürk Bulvarı No: ${seq} Daire 4`, postaKodu: "06420" },
    kvkkNoticeAccepted: true,
    politicalConsent: true,
    aiConsent: false,
    ...over,
  };
}

/** opts: gerçek duvar saati (bekleyen başvuru imhası, giriş kilidi) ve giriş kilidi ayarları; verilmezse Date.now ve varsayılanlar. */
export function setup(opts: Pick<IdentityDeps, "realNow" | "loginThrottle" | "onErased"> = {}) {
  const ctx = makeCtx();
  const ledger = new FakeLedger(ctx.clock);
  const notifier = new MemoryNotifier();
  const audit = createAuditLogger(ctx);
  const identity = createIdentityService(ctx, { ledger, notifier, audit, ...opts });
  const registrarId = insertUser(ctx.db, { nickname: "memur", roles: ["member", "registrar"] });
  const adminId = insertUser(ctx.db, { nickname: "yonetici", roles: ["member", "admin"] });
  const auditorId = insertUser(ctx.db, { nickname: "denetci", roles: ["member", "auditor"] });
  const memberId = insertUser(ctx.db, { nickname: "siradan" });
  return { ctx, ledger, notifier, audit, identity, registrarId, adminId, auditorId, memberId };
}

export async function expectAppError(p: Promise<unknown> | (() => unknown), status: number, code?: string) {
  let err: unknown;
  try {
    if (typeof p === "function") await p();
    else await p;
  } catch (e) {
    err = e;
  }
  const e = err as { name?: string; status?: number; code?: string; message?: string; details?: unknown };
  if (!e || e.name !== "AppError") throw new Error(`AppError bekleniyordu, alınan: ${String(err)}`);
  if (e.status !== status || (code && e.code !== code)) {
    throw new Error(`Beklenen ${status}/${code ?? "*"}, alınan ${e.status}/${e.code}: ${e.message}`);
  }
  return e as { status: number; code: string; message: string; details?: Record<string, string> };
}

/** Veritabanındaki tüm tabloların tüm satırlarını tek bir metne döker (düz metin taraması için). */
export function dumpDb(ctx: ReturnType<typeof makeCtx>): string {
  const tables = ctx.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
  return tables.map((t) => JSON.stringify(ctx.db.all(`SELECT * FROM "${t.name}"`))).join("\n");
}

export function insertMessage(ctx: ReturnType<typeof makeCtx>, authorId: string, body: string): string {
  const id = `m-${authorId.slice(0, 8)}-${ctx.db.nextSeq("messages")}`;
  ctx.db.run(
    `INSERT INTO messages(id, seq, thread_type, thread_id, author_id, body, content_salt, content_hash, created_at, updated_at)
     VALUES (?, ?, 'topic', 't1', ?, ?, 'tuz', 'ozet', ?, ?)`,
    id,
    ctx.db.nextSeq("messages"),
    authorId,
    body,
    ctx.clock.now(),
    ctx.clock.now(),
  );
  return id;
}
