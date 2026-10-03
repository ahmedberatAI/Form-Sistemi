// Görev deposu: oturumdaki üyenin bekleyen işleri (GET /api/me/tasks; Ana sayfadaki 'Sizi bekleyenler' ile aynı sunucu kuralı).
// Ana sayfaya girmeden de güncel kalır: AuthProvider açılışta, girişte, 60 sn'lik okunmamış yoklamasıyla birlikte ve sekmeye
// dönünce doldurur; AppLayout sayfa değişince (veri bayatsa) yeniler; oturum değişince ya da kapanınca boşaltılır.
// Okuyanlar: kabuktaki 'Ana sayfa' sayı rozeti (useTaskCount) ve öneri kartındaki 'Sizden bekleniyor' satırı (useProposalExpectations).
// Karar mantığı sunucuda kalır: istemci yalnız görev bağlantısından (/oneriler/<id>) öneri kimliğini ayrıştırır, kural tahmin etmez.
// Saf yardımcılar React'tan bağımsızdır ve birim testlidir (taskStore.test.ts).
import { useMemo, useSyncExternalStore } from "react";
import type { DashboardTask } from "@forum/shared";
import { toAppPath } from "./routes";

// ───────────── Saf yardımcılar ─────────────

/** Rozette yazılan en büyük sayı; fazlası "99+". */
export const TASK_BADGE_MAX = 99;

/** Rozet metni: 0 ya da geçersizse null (rozet çizilmez), 100 ve üstü "99+". */
export function countBadgeText(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > TASK_BADGE_MAX ? `${TASK_BADGE_MAX}+` : String(Math.floor(n));
}

/** Ekran okuyucu açıklaması ('Ana sayfa' bağlantısının adı değişmez; bu metin aria-describedby ile bağlanır). Ana sayfa selamıyla aynı söz dizimi. */
export function taskCountText(n: number): string {
  return `${Math.max(0, Math.floor(n))} iş sizi bekliyor`;
}

const PROPOSAL_PATH = /^\/oneriler\/([^/?#]+)\/?(?:[?#].*)?$/;

/** Görev bağlantısındaki öneri kimliği ("/oneriler/<id>", "/proposals/<id>", "#/oneriler/<id>"); öneri dışı bağlantıda null. */
export function taskProposalId(task: Pick<DashboardTask, "link">): string | null {
  const target = toAppPath(task.link);
  if (!target || !("path" in target)) return null;
  const m = PROPOSAL_PATH.exec(target.path);
  if (!m || m[1] === "yeni") return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** Öneri kartında gösterilen görev türleri (kayıt memuru görevi bir öneriye bağlı değildir). */
export type ExpectationKind = Exclude<DashboardTask["kind"], "registrar">;

/**
 * 'Sizden bekleniyor: …' etiketleri. Ana sayfa görev satırlarıyla aynı dil; kısa ad (kartta yer dar). Hiçbiri e2e'nin ayrılmış
 * adlarını ('Destekle', 'Oyumu ver', 'Daha fazla', 'Kapat' …) içermez.
 */
export const EXPECTATION_LABELS: Record<ExpectationKind, string> = {
  vote: "Oy",
  sponsor: "Destek",
  object: "İtiraz hakkı",
  reconciliation: "Azınlık raporu",
  expert: "Bilirkişi görevi",
  author: "Yazar işlemi",
};

/** Etiketlerin kartta yazılış sırası (eylem önce, süreli işler önde). */
export const EXPECTATION_ORDER: readonly ExpectationKind[] = ["vote", "sponsor", "object", "reconciliation", "expert", "author"];

export interface Expectation {
  kind: ExpectationKind;
  label: string;
}

/** Bir öneri için bekleyen işler: tür başına bir kez, EXPECTATION_ORDER sırasıyla. Kimlik boşsa ya da görev yoksa boş dizi. */
export function proposalExpectations(tasks: readonly Pick<DashboardTask, "kind" | "link">[], proposalId: string | null | undefined): Expectation[] {
  if (!proposalId || !tasks.length) return [];
  const kinds = new Set<ExpectationKind>();
  for (const t of tasks) {
    if (t.kind === "registrar" || !(t.kind in EXPECTATION_LABELS)) continue;
    if (taskProposalId(t) === proposalId) kinds.add(t.kind);
  }
  return EXPECTATION_ORDER.filter((k) => kinds.has(k)).map((kind) => ({ kind, label: EXPECTATION_LABELS[kind] }));
}

/** Kartta görünen metin: "Oy", "Oy · Bilirkişi görevi". */
export function expectationText(list: readonly Expectation[]): string {
  return list.map((e) => e.label).join(" · ");
}

/** İki görev listesi aynı mı (tür, bağlantı, başlık, süre ve sıra)? Aynıysa depo yeniden çizdirmez. */
export function sameTasks(a: readonly DashboardTask[], b: readonly DashboardTask[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((t, i) => t.kind === b[i].kind && t.link === b[i].link && t.title === b[i].title && t.dueAt === b[i].dueAt);
}

/** Son yüklemeden bu yana `maxAgeMs` geçtiyse (ya da hiç yüklenmediyse) true. */
export function isStale(loadedAt: number | null, now: number, maxAgeMs: number): boolean {
  return loadedAt === null || now - loadedAt >= maxAgeMs;
}

// ───────────── Depo (useSyncExternalStore) ─────────────

const NO_TASKS: readonly DashboardTask[] = Object.freeze([]);

let tasks: readonly DashboardTask[] = NO_TASKS;
// Son başarılı yükleme (Date.now). Anlık görüntünün parçası değildir: yalnız zaman değişince abonelere bildirim gitmez.
let loadedAt: number | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of Array.from(listeners)) l();
}

/** Güncel görev listesi (değişmez dizi; içerik değişmedikçe aynı başvuru). */
export function getTasks(): readonly DashboardTask[] {
  return tasks;
}

/** Son başarılı yükleme zamanı (ms) ya da null. */
export function getTasksLoadedAt(): number | null {
  return loadedAt;
}

export function subscribeTasks(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Sunucudan gelen listeyi yazar. İçerik aynıysa aboneler yeniden çizilmez (yalnız yükleme zamanı güncellenir). */
export function setTasks(next: readonly DashboardTask[], at: number = Date.now()): void {
  loadedAt = at;
  if (sameTasks(tasks, next)) return;
  tasks = Object.freeze(next.slice());
  emit();
}

/** Oturum kapanınca ya da değişince: liste boşalır, yükleme zamanı silinir. */
export function clearTasks(): void {
  loadedAt = null;
  if (tasks === NO_TASKS) return;
  tasks = NO_TASKS;
  emit();
}

/** Bekleyen iş sayısı (kabuk rozeti). */
export function useTaskCount(): number {
  return useSyncExternalStore(subscribeTasks, () => tasks.length, () => tasks.length);
}

/** Öneri kartı için 'Sizden bekleniyor' listesi; oturum yoksa ya da iş yoksa boş. */
export function useProposalExpectations(proposalId: string): Expectation[] {
  const list = useSyncExternalStore(subscribeTasks, getTasks, getTasks);
  return useMemo(() => proposalExpectations(list, proposalId), [list, proposalId]);
}
