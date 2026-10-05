// Tartışma bileşenlerinin SAF mantığı (birim testli; bkz. discussionLogic.test.ts): tek satır istatistik, köprü skoru notu,
// yazma kutusunun kapısı (anonim / doğrulanmamış / kapalı) ve açık-kapalı kararı. Bileşenler (Discussion, Composer,
// MessageItem) yalnız çizer; metin ve karar burada durur.
import { STANCE_LABELS, type MessageView, type Stance, type UserStatus } from "@forum/shared";

export const STANCE_ORDER: readonly Stance[] = ["pro", "con", "neutral", "question"];

export type StanceCounts = Record<Stance, number>;

/** 12 satırı aşan mesaj gövdesi ClampText ile kısaltılır (dar ve geniş ekranda aynı). */
export const MESSAGE_CLAMP_LINES = 12;

/** Karar ile gizlenen (hidden) ya da kişisel veri nedeniyle mühürlenen (sealed) mesaj. */
const isConcealed = (m: Pick<MessageView, "visibility">) => m.visibility === "hidden" || m.visibility === "sealed";

/** Görünür mesajların tutum sayıları ve karar ile gizlenen mesaj sayısı (daraltılmış mesajlar görünürdür). */
export function discussionStats(messages: readonly Pick<MessageView, "stance" | "visibility">[]): { counts: StanceCounts; hidden: number } {
  const counts: StanceCounts = { pro: 0, con: 0, neutral: 0, question: 0 };
  let hidden = 0;
  for (const m of messages) {
    if (isConcealed(m)) hidden++;
    else counts[m.stance]++;
  }
  return { counts, hidden };
}

/** Tek satır istatistik: 'Lehte 2 · Aleyhte 1 · Soru 1'. Sıfırlar yazılmaz; karar ile gizlenen varsa sona eklenir. */
export function stanceSummary(counts: StanceCounts, hidden = 0): string {
  const parts = STANCE_ORDER.filter((s) => counts[s] > 0).map((s) => `${STANCE_LABELS[s]} ${counts[s]}`);
  if (hidden > 0) parts.push(`Karar ile gizlenen ${hidden}`);
  return parts.join(" · ");
}

/**
 * Köprü skoru notu ('Tartışma kuralları ve köprü skoru' açılırında). Skor hiçbir mesajda yoksa (en az iki anlamlı görüş
 * grubu oluşmadıysa) nedenini söyler; mesaj yoksa ya da skor hesaplanmışsa null.
 */
export function bridgeNote(messageCount: number, anyBridge: boolean): string | null {
  if (messageCount < 1 || anyBridge) return null;
  return "Bu tartışmada köprü skoru henüz yok: en az iki anlamlı görüş grubu oluşunca hesaplanır.";
}

// ───────────────────────── Yazma kutusu ─────────────────────────

export type ComposerMode = "new" | "reply" | "edit";

/** Yazma kutusunun kapısı: açık değilse tek cümlelik not gösterilir. */
export type ComposerGate = { kind: "open" } | { kind: "anonymous" } | { kind: "blocked"; text: string } | { kind: "closed"; text: string };

export const UNVERIFIED_NOTE = "Hesabınız henüz doğrulanmadı; kayıt memuru doğruladıktan sonra mesaj yazabilir ve katılım bildirebilirsiniz.";
const SUSPENDED_NOTE = "Hesabınız askıya alındığı için mesaj yazamaz ve katılım bildiremezsiniz.";
const REJECTED_NOTE = "Kaydınız onaylanmadığı için mesaj yazamaz ve katılım bildiremezsiniz.";

/** Doğrulanmamış hesabın notu: bekleyen, askıdaki ve reddedilen hesap ayrı söylenir (ilki bugünkü metindir). */
export function blockedNote(status: UserStatus | null | undefined): string {
  if (status === "suspended") return SUSPENDED_NOTE;
  if (status === "rejected") return REJECTED_NOTE;
  return UNVERIFIED_NOTE;
}

/**
 * Sıra bugünküyle aynıdır: oturum yok → anonim; V yetkisi yok → doğrulanmamış; yazma kapalı (taslak, arşiv) → gerekçe
 * (düzenlemede kapalılık sayılmaz, çünkü yazar kendi mesajını yine düzenleyebilir).
 */
export function composerGate(o: {
  user: { status: UserStatus } | null;
  canVerify: boolean;
  closedReason?: string | null;
  mode: ComposerMode;
}): ComposerGate {
  if (!o.user) return { kind: "anonymous" };
  if (!o.canVerify) return { kind: "blocked", text: blockedNote(o.user.status) };
  if (o.closedReason && o.mode !== "edit") return { kind: "closed", text: o.closedReason };
  return { kind: "open" };
}

/**
 * Yazma formu açık mı? Yanıt ve düzenleme her zaman açıktır. Yeni mesaj: metin yazılmışsa açık kalır; yoksa kullanıcı
 * düğmeye dokunduysa (`choice`) onun seçimi, dokunmadıysa görünüm yoğunluğunun varsayılanı ('Tam' → açık) geçerlidir.
 */
export function composerIsOpen(o: { mode: ComposerMode; hasText: boolean; choice: boolean | null; defaultOpen: boolean }): boolean {
  if (o.mode !== "new") return true;
  if (o.hasText) return true;
  return o.choice ?? o.defaultOpen;
}

// ───────────────────────── Uzun tartışma: kararlı nesneler ve sayfalama ─────────────────────────

/** Uzun tartışmada ilk çizilen ileti dizisi (kök mesaj) sayısı; fazlası "Daha fazla göster" ile açılır. */
export const ROOT_PAGE_SIZE = 50;

export interface MessageCache {
  key: string;
  byId: Map<string, { sig: string; m: MessageView }>;
  last: MessageView[] | null;
}

export const newMessageCache = (key: string): MessageCache => ({ key, byId: new Map(), last: null });

/**
 * Yoklamada DEĞİŞMEYEN mesajın önceki nesnesini korur (memo'lu MessageItem yeniden çizilmez). Hiçbir mesaj değişmediyse önceki
 * dizinin kendisi döner (dizi kimliği aynı: üst bileşene "mesajlar değişti" bildirilmez). Saf değil: önbelleği günceller.
 */
export function stabilizeMessages(cache: MessageCache, next: readonly MessageView[]): MessageView[] {
  let changed = cache.last === null || cache.last.length !== next.length;
  const seen = new Set<string>();
  const out = next.map((m, i) => {
    seen.add(m.id);
    const sig = JSON.stringify(m);
    const prev = cache.byId.get(m.id);
    if (prev && prev.sig === sig) {
      if (!changed && cache.last![i] !== prev.m) changed = true;
      return prev.m;
    }
    changed = true;
    cache.byId.set(m.id, { sig, m });
    return m;
  });
  for (const id of cache.byId.keys()) if (!seen.has(id)) cache.byId.delete(id);
  if (!changed && cache.last) return cache.last;
  cache.last = out;
  return out;
}

/** Mesajın bağlı olduğu kök mesajın (ileti dizisinin) `roots` içindeki sırası; mesaj yoksa -1. */
export function rootIndexOf(id: string, roots: readonly Pick<MessageView, "id">[], byId: ReadonlyMap<string, Pick<MessageView, "parentId">>): number {
  let cur = id;
  for (let guard = 0; guard < 10_000; guard++) {
    const parent = byId.get(cur)?.parentId;
    if (!parent || !byId.has(parent)) break;
    cur = parent;
  }
  return roots.findIndex((r) => r.id === cur);
}

/** Gösterilecek kök sayısı: sayfa sınırı; derin bağlantı (?mesaj=) ya da alıntı hedefinin dizisini de içerecek kadar genişler. */
export function visibleRootCount(total: number, limit: number, mustIncludeIndex = -1): number {
  return Math.min(total, Math.max(limit, mustIncludeIndex + 1));
}
