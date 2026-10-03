// Konular ve konu ayrıntısı sayfalarının saf mantığı (Faz 3 / madde 4): tek satır sayaçlar, 'Süz' açılırının hükmü,
// ağaç satırındaki kategori ve sürüm kuralları, açık önerilerin tür dökümü, sürüm geçmişi hükmü ve derin bağlantı çapaları.
// Bileşenler yalnız çizer; kurallar burada birim testlidir (topicsLogic.test.ts).
import type { ProposalKind, TopicRevision, TopicSummary } from "@forum/shared";
import { routes } from "../../lib/routes";

// ───────────── Konular sayfası: tek satır sayaçlar ─────────────

export interface TopicCounter {
  key: "roots" | "subs" | "messages" | "open";
  label: string;
  count: number;
  /** Yalnız gidecek yeri olan sayaç bağlantıdır (Öneriler sayfası); ötekiler düz sayıdır. */
  to?: string;
}

/**
 * Yürürlükteki (arşivlenmemiş) konulardan dört sayaç: ana konu, alt konu, mesaj ve konulara açık öneri. Eski dört kutunun aynı
 * sayıları ve etiketleri; yalnız gösterim tek satıra indi. Arşivlenen konular sayılmaz (eskiden de sayılmıyordu).
 */
export function topicCounters(topics: readonly TopicSummary[]): TopicCounter[] {
  const active = topics.filter((t) => t.status === "active");
  return [
    { key: "roots", label: "Ana konu", count: active.filter((t) => !t.parentId).length },
    { key: "subs", label: "Alt konu", count: active.filter((t) => !!t.parentId).length },
    { key: "messages", label: "Mesaj", count: active.reduce((s, t) => s + t.messageCount, 0) },
    { key: "open", label: "Konulara açık öneri", count: active.reduce((s, t) => s + t.openProposalCount, 0), to: routes.proposals() },
  ];
}

// ───────────── Konular sayfası: 'Süz' açılırı ─────────────

/** Telefonda Kategori ve Arşiv süzgeçleri 'Süz' açılırına girer (list-filters'ın üç sütuna geçtiği 640 px'in altı). */
export const TOPICS_NARROW_QUERY = "(max-width: 639px)";

/** Etkin süzgeç sayısı (kategori seçili mi, arşivlenenler gösteriliyor mu). Arama kutusu açılırın dışındadır, sayılmaz. */
export function topicFilterCount(f: { category: string; showArchived: boolean }): number {
  return (f.category ? 1 : 0) + (f.showArchived ? 1 : 0);
}

/** Açılırın özet satırı: 'Süz' ya da 'Süz (2 etkin)'. Etkin süzgeç kapalı açılırda da görünür kalır. */
export function topicFilterSummary(active: number): string {
  return active > 0 ? `Süz (${active} etkin)` : "Süz";
}

// ───────────── Konu ağacı satırı ─────────────

/** Ağaç satırında görünen en çok kategori; kalanı '+n' olur (öneri kartıyla aynı kural). */
export const MAX_TREE_CATEGORIES = 2;

export function splitCategories<T>(categories: readonly T[], max: number = MAX_TREE_CATEGORIES): { shown: T[]; hidden: T[] } {
  return { shown: categories.slice(0, max), hidden: categories.slice(max) };
}

/** 'sürüm n' rozeti yalnız konu en az bir kez değiştiyse görünür (ilk sürüm olağan durumdur, bilgi taşımaz). */
export function showVersionBadge(version: number): boolean {
  return version > 1;
}

// ───────────── Konu ayrıntısı ─────────────

/** Sayfa içi derin bağlantı çapaları (`?bolum=<çapa>`; lib/sectionParam.ts). 'tartisma' Discussion bileşeninin kendi kimliğidir. */
export const TOPIC_ANCHORS = {
  text: "konu-metni",
  open: "acik-oneriler",
  discussion: "tartisma",
  children: "alt-konular",
  versions: "surumler",
} as const;

/**
 * Telefonda tartışmanın ALTINDAKİ çapalar (Alt konular, Sürüm geçmişi): tartışma yüklenip yüksekliği oturmadan kaydırılırsa
 * hedef aşağı kayar ve görünür alanın dışında kalır. Bu çapalar tartışma gelince çalışır; gelmezse (hata) THREAD_WAIT_MS sonra.
 * Tartışmanın üstündeki çapalar (metin, açık öneriler) ve 'tartisma' beklemez.
 */
export function sectionWaitsForThread(anchor: string | null | undefined): boolean {
  return anchor === TOPIC_ANCHORS.children || anchor === TOPIC_ANCHORS.versions;
}

export const THREAD_WAIT_MS = 4000;

/** Aynı konunun bir bölümüne giden bağlantı (telefonda sayfanın altındaki Alt konular'a tek dokunuş). */
export function topicSectionHref(topicId: string, anchor: string): string {
  return `${routes.topic(topicId)}?bolum=${encodeURIComponent(anchor)}`;
}

// Açık önerilerin tür dökümü: 'konuya açık' türler önce (düzenleme, alt konu, silme), sonra olağan dışı olanlar.
const OPEN_KIND_ORDER: ProposalKind[] = ["amendment", "subtopic", "deletion", "topic", "regulation"];
const OPEN_KIND_NOUN: Record<ProposalKind, string> = {
  amendment: "düzenleme teklifi",
  subtopic: "alt konu önerisi",
  deletion: "silme talebi",
  topic: "yeni konu önerisi",
  regulation: "yönetmelik değişikliği",
};

/** "2 düzenleme teklifi · 1 alt konu önerisi" (boşsa boş dize). Kart başlığındaki sayıyı türlerine ayırır. */
export function openProposalKinds(proposals: readonly { kind: ProposalKind }[]): string {
  const counts = new Map<ProposalKind, number>();
  for (const p of proposals) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
  return OPEN_KIND_ORDER.filter((k) => counts.has(k))
    .map((k) => `${counts.get(k)} ${OPEN_KIND_NOUN[k]}`)
    .join(" · ");
}

const dayMonth = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });
const dayMonthYear = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric" });

/**
 * 'Sürüm geçmişi (n)' kartının kapalıyken görünen hükmü (sayı başlıktadır): "Güncel sürüm 3 · son değişiklik 10 Eyl",
 * tek sürümde "Tek sürüm · değişiklik yok". `now` (sunucu saati) verilir ve son değişiklik başka bir yıldaysa yıl da yazılır.
 */
export function revisionsSummary(revisions: readonly Pick<TopicRevision, "version" | "createdAt">[], now?: number): string {
  if (!revisions.length) return "Sürüm kaydı yok";
  const latest = revisions.reduce((a, b) => (b.version > a.version ? b : a));
  if (revisions.length === 1) return "Tek sürüm · değişiklik yok";
  const last = Math.max(...revisions.map((r) => r.createdAt));
  const otherYear = now !== undefined && new Date(last).getFullYear() !== new Date(now).getFullYear();
  return `Güncel sürüm ${latest.version} · son değişiklik ${(otherYear ? dayMonthYear : dayMonth).format(last)}`;
}
