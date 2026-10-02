// Uygulama içi bildirimler (notifications tablosu).
import type { CoreContext, Notifier } from "./contracts";
import { newId } from "./ids";

export class DbNotifier implements Notifier {
  constructor(private readonly ctx: Pick<CoreContext, "db" | "clock">) {}

  notify(userId: string, n: { kind: string; title: string; body: string; link?: string | null }): void {
    this.ctx.db.run(
      "INSERT INTO notifications(id, user_id, kind, title, body, link, read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
      newId(),
      userId,
      n.kind,
      n.title,
      n.body,
      n.link ?? null,
      this.ctx.clock.now(),
    );
  }

  /**
   * Aynı bildirimi birden çok kişiye gönderir (yinelenenler atlanır). Tüm satırlar TEK ifade/işlemle yazılır:
   * alıcı başına otomatik işlem (her biri fsync) 1 Hz yaşam döngüsü zamanlayıcısını saniyelerce bloklayabilirdi.
   */
  notifyMany(userIds: Iterable<string>, n: { kind: string; title: string; body: string; link?: string | null }): void {
    const seen = new Set<string>();
    const rows: [string, string][] = [];
    for (const u of userIds) {
      if (seen.has(u)) continue;
      seen.add(u);
      rows.push([newId(), u]);
    }
    if (rows.length === 0) return;
    const now = this.ctx.clock.now();
    this.ctx.db.tx(() => {
      this.ctx.db.run(
        "INSERT INTO notifications(id, user_id, kind, title, body, link, read, created_at) " +
          "SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), ?, ?, ?, ?, 0, ? FROM json_each(?)",
        n.kind,
        n.title,
        n.body,
        n.link ?? null,
        now,
        JSON.stringify(rows),
      );
    });
  }
}

/** Testler için: bildirimleri bellekte toplar. */
export class MemoryNotifier implements Notifier {
  readonly sent: { userId: string; kind: string; title: string; body: string; link?: string | null }[] = [];
  notify(userId: string, n: { kind: string; title: string; body: string; link?: string | null }): void {
    this.sent.push({ userId, ...n });
  }
  notifyMany(userIds: Iterable<string>, n: { kind: string; title: string; body: string; link?: string | null }): void {
    for (const u of new Set(userIds)) this.notify(u, n);
  }
}
