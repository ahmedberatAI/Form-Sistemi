// Ana sayfa › 'Sizi bekleyenler (n)': yalnız görev varsa çizilir. Görevler sunucudan gelir ve öneri sayfasındaki bayraklarla
// aynı kurala bağlıdır (server/src/forum/eligibility.ts); istemci kural tahmini yapmaz, yalnız bağlantıyı panele yöneltir:
// öneri görevleri ?bolum=eylem (oy, destek, itiraz, uzlaşma, taslak ve metin önerileri), bilirkişi görevi ?bolum=bilirkisi.
// En yakın 3 görev görünür; kalanı 'Tümünü göster (n)' ile açılır ('Tam' görünümde hepsi açık gelir). Satırın tamamı bağlantıdır.
// Görev yoksa yerinde role göre tek satırlık ipucu durur (RoleHint).
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { DashboardTask } from "@forum/shared";
import { useDetailLevel } from "../../lib/detailLevel";
import { routes, toAppPath } from "../../lib/routes";
import { Button, Card, Countdown, cx, Icon, type IconName } from "../../ui";
import "./home.css";

/** Görevin rengi: mavi = yapılacak iş (şu an), turuncu = dikkat (itiraz ve uzlaşma süreleri). */
export type TaskTone = "now" | "attention";

export const TASK_META: Record<DashboardTask["kind"], { icon: IconName; label: string; tone: TaskTone }> = {
  vote: { icon: "vote", label: "Oy ver", tone: "now" },
  sponsor: { icon: "users", label: "Destek ol", tone: "now" },
  object: { icon: "warning", label: "İtiraz hakkı", tone: "attention" },
  expert: { icon: "experts", label: "Bilirkişi görevi", tone: "now" },
  registrar: { icon: "registrar", label: "Kayıt memuru onayı", tone: "now" },
  author: { icon: "proposals", label: "Yazar", tone: "now" },
  reconciliation: { icon: "users", label: "Uzlaşma", tone: "attention" },
};

/** İlk bakışta görünen görev sayısı. */
export const TASKS_SHOWN = 3;

const PROPOSAL_PATH = /^\/oneriler\/([^/?#]+)\/?$/;

/**
 * Görevin uygulama içi hedefi. Öneri bağlantısı ilgili panele yönelir: bilirkişi görevi ?bolum=bilirkisi, diğerleri ?bolum=eylem.
 * Öneri dışı bağlantılar (ör. /kayit-memuru) olduğu gibi kalır; dış ya da boş bağlantı için null (satır düz metin olur).
 */
export function taskHref(task: Pick<DashboardTask, "kind" | "link">): string | null {
  const target = toAppPath(task.link);
  if (!target || !("path" in target)) return null;
  const m = PROPOSAL_PATH.exec(target.path);
  if (!m || m[1] === "yeni") return target.path;
  return routes.proposal(decodeURIComponent(m[1]), { bolum: task.kind === "expert" ? "bilirkisi" : "eylem" });
}

function TaskRow({ task }: { task: DashboardTask }) {
  const m = TASK_META[task.kind] ?? TASK_META.author;
  const href = taskHref(task);
  // Parçalar arasındaki {" "} boşlukları düzende görünmez; bağlantının erişilebilir adında sözcükleri ayırır.
  const inner = (
    <>
      <span className="home-task-main">
        <span className={cx("home-task-kind", `home-task-kind-${m.tone}`)}>
          <Icon name={m.icon} size={14} />
          {m.label}
        </span>{" "}
        <span className="home-task-sep" aria-hidden="true">
          ·
        </span>{" "}
        <span className="home-task-title">{task.title}</span>
      </span>{" "}
      {task.dueAt ? <Countdown to={task.dueAt} prefix="Kalan" className="home-task-due" /> : null}
      {href ? <Icon name="chevronRight" size={16} className="home-task-go" /> : null}
    </>
  );
  return href ? (
    <Link className="home-task" to={href}>
      {inner}
    </Link>
  ) : (
    <div className="home-task">{inner}</div>
  );
}

export function TaskList({ tasks }: { tasks: DashboardTask[] }) {
  const { full } = useDetailLevel();
  // null: kullanıcı dokunmadı → görünüm yoğunluğuna uyar ('Tam' kipte hepsi açık)
  const [choice, setChoice] = useState<boolean | null>(null);
  const expanded = choice ?? full;
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const focusRevealed = useRef(false);

  // 'Tümünü göster'den sonra odak, yeni görünen ilk göreve taşınır (klavye ve ekran okuyucu yerini kaybetmez).
  useEffect(() => {
    if (!expanded || !focusRevealed.current) return;
    focusRevealed.current = false;
    const li = listRef.current?.children[TASKS_SHOWN] as HTMLElement | undefined;
    if (!li) return;
    const target = li.querySelector<HTMLElement>("a[href]") ?? li;
    if (target === li) li.tabIndex = -1;
    target.focus();
  }, [expanded]);

  if (!tasks.length) return null;
  const hasMore = tasks.length > TASKS_SHOWN;
  return (
    <Card title={`Sizi bekleyenler (${tasks.length})`} className="home-tasks">
      <ul className="home-task-list" id={listId} ref={listRef}>
        {tasks.map((t, i) => (
          <li key={`${t.kind}-${t.link}-${i}`} hidden={!expanded && i >= TASKS_SHOWN}>
            <TaskRow task={t} />
          </li>
        ))}
      </ul>
      {hasMore ? (
        <Button
          size="sm"
          variant="ghost"
          className="home-tasks-toggle"
          aria-expanded={expanded}
          aria-controls={listId}
          icon={expanded ? undefined : "chevronDown"}
          onClick={() => {
            focusRevealed.current = !expanded;
            setChoice(!expanded);
          }}
        >
          {expanded ? "Listeyi kısalt" : `Tümünü göster (${tasks.length})`}
        </Button>
      ) : null}
    </Card>
  );
}

// ───────────── Görev yokken role göre ipucu ─────────────

export interface RoleHintInput {
  /** auth.can("A") */
  admin: boolean;
  /** auth.can("V"): doğrulanmış üye */
  member: boolean;
  /** Süren bütün evrelerdeki öneri sayısı (pano bilinmiyorsa null) */
  open: number | null;
  /** Tartışmadaki öneri sayısı */
  deliberation: number;
}

export interface RoleHintSpec {
  text: string;
  link: { label: string; to: string };
}

/** Görev yokken tek satırlık ipucu: yönetici → simüle saat; doğrulanmış üye → öneri aç / tartışmalara katıl; diğerleri → son kararlar. */
export function roleHint({ admin, member, open, deliberation }: RoleHintInput): RoleHintSpec {
  if (admin) return { text: "Süreleri ilerletmek için simüle saati ileri alın.", link: { label: "Yönetim", to: routes.admin() } };
  if (member) {
    if (open === 0) return { text: "İlk öneriyi siz açın.", link: { label: "Öneri aç", to: routes.newProposal() } };
    if (deliberation > 0) return { text: "Tartışmadaki önerilere görüş yazabilirsiniz.", link: { label: "Tartışmadakiler", to: `${routes.proposals()}?sekme=tartisma` } };
    return { text: "Açık önerileri inceleyin ya da yeni bir öneri açın.", link: { label: "Öneri aç", to: routes.newProposal() } };
  }
  return { text: "Son kararlara göz atın.", link: { label: "Sonuçlanan öneriler", to: `${routes.proposals()}?sekme=sonuc` } };
}

export function RoleHint({ hint }: { hint: RoleHintSpec }) {
  return (
    <p className="home-hint">
      <span>{hint.text}</span>{" "}
      <Link to={hint.link.to} className="home-inline-link">
        {hint.link.label} <Icon name="chevronRight" size={14} />
      </Link>
    </p>
  );
}
