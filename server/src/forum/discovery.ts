// Keşif: önerili arama ("Hızlı bul"), Listem (saved_items) ve kişisel sıralama (sinyal toplama + saf rankForUser).
//
// Gizlilik (docs/KVKK.md, docs/ALGORITMA.md "Kişisel sıralama"):
//   - Sinyal sorgusu YALNIZ şu tablolara bakar: proposals (yazarlık), saved_items (listeye ekleme), proposal_sponsors (destekleme),
//     messages (mesaj yazma; tutum/stance okunmaz). Oy (ballots), seçmen listesi (eligible_voters), itiraz (objections), azınlık
//     raporu (minority_reports) ve ileti destekleri (message_endorsements) OKUNMAZ — testler bu dosyanın kaynağını da tarar.
//   - Hukuki sebep açık rızadır (KVKK md. 6/3-a): siyasi görüş rızası olmayan ya da "Kişisel sıralama" tercihini kapatan üyede
//     hiçbir sinyal okunmaz ve sıra varsayılandır (son açılanlar tek başına gelse bile).
//   - "Son açılanlar" istemcinin cihazında tutulur; yalnız istek BAŞLIĞIYLA (X-Forum-Recent; adres satırında değil: vekil
//     günlüklerine düşmesin) gelir, yalnız o isteğin hesabında kullanılır, saklanmaz.
//   - Listem kayıtları yalnız sahibine görünür; denetim günlüğüne yazılmaz (kişisel tercih); KVKK dökümüne girer; hesap silmede silinir.
//   - Sinyal önbelleği (yalnız süreç belleği): en çok SIGNAL_CACHE_TTL_MS (simüle ve gerçek saatle) geçerlidir; süresi dolanlar her
//     çağrıda ve sunucunun düzenli temizliğinde (sweepCache) atılır; hesap silme, başvuru reddi ve bayat başvuru imhası kaydı
//     kimlik servisinin onErased kancasıyla hemen düşürür.
import {
  CATEGORY_VOCAB,
  REC_PARAMS,
  SAVED_ITEMS_MAX,
  SEARCH_LIMIT_MAX,
  SEARCH_MIN_CHARS,
  SEARCH_QUERY_MAX,
  buildInterestProfile,
  compareSearchHits,
  fy,
  matchTitle,
  parseSearchRef,
  proposalMatchesQuery,
  rankForUser,
  searchKey,
  type CategoryNode,
  type DashboardOpenProposal,
  type InterestProfile,
  type PersonalizedProposalList,
  type ProposalKind,
  type ProposalStatus,
  type ProposalSummary,
  type RankReason,
  type RecCategory,
  type RecScoreWeights,
  type RecSignal,
  type SavedItem,
  type SavedList,
  type SavedState,
  type SavedTargetType,
  type SearchHit,
  type SearchMatch,
  type SearchResponse,
} from "@forum/shared";
import type { AuthUser } from "../core/contracts";
import { notFound, unprocessable } from "../core/errors";
import type { DiscoveryService, Viewer } from "../core/forum-contracts";
import { json } from "../db";
import { isSavedBy } from "./detail";
import { ACTIVE_SQL, isActive, jsonList, safe, type ForumCore, type TopicRow } from "./util";
import { proposalSummaries, querySummaries, SUMMARY_COLUMNS, topicSummaries, type SummaryRow } from "./views";

/** Kullanıcı başına sinyal önbelleğinin ömrü (ms; hem simüle hem gerçek saatle) ve en çok kaç kullanıcı tutulacağı. */
export const SIGNAL_CACHE_TTL_MS = 60_000;
const SIGNAL_CACHE_MAX = 1000;

interface SignalRow {
  kind: "author" | "saved" | "sponsor" | "message";
  target_type: "proposal" | "topic";
  target_id: string;
  at: number;
  categories: string | null;
}

/**
 * TEK toplama sorgusu: görüntüleyenin pencere içindeki yazarlık, destekleme ve mesaj sinyalleri + listesindeki TÜM kayıtlar
 * ("Listenizde" gerekçesi pencereden bağımsızdır; profile yalnız pencere içindekiler girer — pencereyi saf işlev uygular) ve
 * hedeflerin kategorileri. ?1 = kullanıcı, ?2 = pencere başlangıcı.
 */
export const SIGNAL_SQL = `
WITH s(kind, target_type, target_id, at) AS (
  SELECT 'author', 'proposal', id, created_at FROM proposals WHERE author_id = ?1 AND created_at >= ?2
  UNION ALL SELECT 'saved', target_type, target_id, created_at FROM saved_items WHERE user_id = ?1
  UNION ALL SELECT 'sponsor', 'proposal', proposal_id, at FROM proposal_sponsors WHERE user_id = ?1 AND at >= ?2
  UNION ALL SELECT 'message', thread_type, thread_id, created_at FROM messages WHERE author_id = ?1 AND created_at >= ?2
)
SELECT s.kind, s.target_type, s.target_id, s.at,
       CASE s.target_type WHEN 'proposal' THEN p.categories WHEN 'topic' THEN t.categories END AS categories
  FROM s
  LEFT JOIN proposals p ON s.target_type = 'proposal' AND p.id = s.target_id
  LEFT JOIN topics t ON s.target_type = 'topic' AND t.id = s.target_id`;

/** Sıralanacak hafif öneri bilgisi (ProposalSummary ya da SummaryRow'dan). */
interface RankInput {
  id: string;
  seq: number;
  categories: readonly string[];
  createdAt: number;
  phaseEndsAt: number | null;
  status: string;
}

interface RankedRef {
  id: string;
  score: number | null;
  reason: RankReason | null;
}

/** Görüntüleyenin bu istekteki sıralama bağlamı (yalnız profil doluysa kurulur). */
interface RankContext {
  now: number;
  profile: InterestProfile;
  categories: RecCategory[];
  /** Listesindeki öneriler ("Listenizde") */
  saved: ReadonlySet<string>;
  /** Zaten katıldığı (yazdığı, desteklediği, mesaj yazdığı) öneriler: ilgi terimi 0 */
  engaged: ReadonlySet<string>;
}

const fromRow = (r: SummaryRow): RankInput => ({
  id: r.id,
  seq: Number(r.seq),
  categories: json<string[]>(r.categories, []),
  createdAt: Number(r.created_at),
  phaseEndsAt: r.phase_ends_at === null ? null : Number(r.phase_ends_at),
  status: r.status,
});

const fromSummary = (s: ProposalSummary): RankInput => ({
  id: s.id,
  seq: s.seq,
  categories: s.categories,
  createdAt: s.createdAt,
  phaseEndsAt: s.phaseEndsAt,
  status: s.status,
});

/** Ana sayfa "Şu an açık"ın varsayılan sırası (SQL: ORDER BY COALESCE(phase_ends_at, 9e15) ASC, seq DESC) — iki yer aynı sırayı kullanır. */
const OPEN_ORDER_SQL = "ORDER BY COALESCE(p.phase_ends_at, 9e15) ASC, p.seq DESC";
const openOrder = (a: RankInput, b: RankInput): number => (a.phaseEndsAt ?? 9e15) - (b.phaseEndsAt ?? 9e15) || b.seq - a.seq;

const unranked = (inputs: readonly { id: string }[]): RankedRef[] => inputs.map((x) => ({ id: x.id, score: null, reason: null }));

export function createDiscoveryService(core: ForumCore): DiscoveryService {
  const { db, deps } = core;
  /** Kullanıcı → sinyal satırları; `at` simüle saat, `real` gerçek saat (ikisinden biri dolunca geçersiz). */
  const cache = new Map<string, { at: number; real: number; rows: SignalRow[] }>();

  const fresh = (entry: { at: number; real: number }, now: number, real: number): boolean =>
    now >= entry.at && now - entry.at < SIGNAL_CACHE_TTL_MS && real >= entry.real && real - entry.real < SIGNAL_CACHE_TTL_MS;

  /** Süresi dolan kayıtları atar (bellekte eski sinyal kalmasın); her çağrıda ve düzenli temizlikte çalışır (en çok 1000 kayıt). */
  function sweep(): void {
    const now = core.now();
    const real = Date.now();
    for (const [key, entry] of cache) if (!fresh(entry, now, real)) cache.delete(key);
  }

  function invalidate(userId: string): void {
    cache.delete(userId);
  }

  function signalRows(userId: string): SignalRow[] {
    sweep();
    const hit = cache.get(userId);
    if (hit) return hit.rows;
    const now = core.now();
    const rows = db.all<SignalRow>(SIGNAL_SQL, userId, now - REC_PARAMS.windowMs);
    // Ekleme sırası = hesaplama sırası: sınırı aşınca en eskiler atılır.
    for (const key of cache.keys()) {
      if (cache.size < SIGNAL_CACHE_MAX) break;
      cache.delete(key);
    }
    cache.set(userId, { at: now, real: Date.now(), rows });
    return rows;
  }

  /** Ontolojinin kategori ağacı düz liste olarak (yürürlükteki yönetmelik; okunamazsa sabit kelime dağarcığı). */
  function categoryList(): RecCategory[] {
    const out: RecCategory[] = [];
    const walk = (nodes: CategoryNode[]): void => {
      for (const n of nodes) {
        out.push({ iri: n.iri, label: n.label, parent: n.parent });
        walk(n.children);
      }
    };
    const tree = safe(() => deps.ontology.categories(), null);
    if (tree && tree.length > 0) walk(tree);
    else for (const c of CATEGORY_VOCAB) out.push({ iri: fy(c.local), label: c.label, parent: c.parent ? fy(c.parent) : null });
    return out;
  }

  /** İstekle gelen son açılanlar → "open" sinyalleri (yalnız görüntüleyenin görebildiği öneriler; saklanmaz). */
  function openSignals(viewer: AuthUser, recent: readonly string[]): RecSignal[] {
    const ids = [...new Set(recent)].slice(0, REC_PARAMS.maxRecent);
    if (ids.length === 0) return [];
    return db
      .all<{ id: string; categories: string }>(
        "SELECT id, categories FROM proposals WHERE id IN (SELECT value FROM json_each(?)) AND (status <> 'draft' OR author_id = ?)",
        jsonList(ids),
        viewer.id,
      )
      .map((r) => ({ kind: "open" as const, target: `proposal:${r.id}`, categories: json<string[]>(r.categories, []), at: null }));
  }

  /**
   * Kişisel sıralamaya izin var mı (her istekte veritabanından; rıza geri alınınca hemen geçerli): siyasi görüş açık rızası
   * (KVKK md. 6/3-a; öneri, destek ve mesaj kayıtları uygulamanın envanterinde özel nitelikli veridir) VE "Kişisel sıralama" tercihi açık.
   */
  function rankingAllowed(userId: string): boolean {
    const u = db.get<{ political_consent: number; personal_ranking: number }>("SELECT political_consent, personal_ranking FROM users WHERE id = ?", userId);
    return !!u && Number(u.political_consent) === 1 && Number(u.personal_ranking) === 1;
  }

  /** Sıralama bağlamı; oturum yoksa, izin yoksa ya da ilgi profili boşsa (soğuk başlangıç) null. İzin yoksa hiçbir sinyal okunmaz. */
  function contextFor(viewer: Viewer, recent: readonly string[]): RankContext | null {
    if (!viewer || !rankingAllowed(viewer.id)) return null;
    const now = core.now();
    const rows = signalRows(viewer.id);
    const signals: RecSignal[] = rows.map((r) => ({
      kind: r.kind,
      target: `${r.target_type}:${r.target_id}`,
      categories: json<string[]>(r.categories, []),
      at: Number(r.at),
    }));
    signals.push(...openSignals(viewer, recent));
    const categories = categoryList();
    const profile = buildInterestProfile(signals, categories, now);
    if (Object.keys(profile.weights).length === 0) return null;
    const proposalRows = rows.filter((r) => r.target_type === "proposal");
    return {
      now,
      profile,
      categories,
      saved: new Set(proposalRows.filter((r) => r.kind === "saved").map((r) => r.target_id)),
      engaged: new Set(proposalRows.filter((r) => r.kind !== "saved").map((r) => r.target_id)),
    };
  }

  /** Bir grubu (aynı ağırlıklarla) kişisel sıraya dizer; küme aynı kalır. */
  function rankGroup(ctx: RankContext, inputs: readonly RankInput[], score: RecScoreWeights): RankedRef[] {
    if (inputs.length === 0) return [];
    return rankForUser({
      profile: ctx.profile,
      categories: ctx.categories,
      now: ctx.now,
      score,
      candidates: inputs.map((x) => ({
        id: x.id,
        categories: x.categories,
        createdAt: x.createdAt,
        phaseEndsAt: x.phaseEndsAt,
        active: isActive(x.status),
        saved: ctx.saved.has(x.id),
        engaged: ctx.engaged.has(x.id),
      })),
    }).items;
  }

  /**
   * Kişisel sıra (küme aynı; hiçbir öğe düşmez): önce süren (açık) öneriler — ana sayfa "Şu an açık"la AYNI girdi sırası ve
   * ağırlıklarla, yani Açık sekmesi panoyla birebir aynı sırayı verir — sonra diğerleri (girdi sırası, genel ağırlıklar).
   * Bağlam yoksa girdi sırası, personalized: false.
   */
  function rank(viewer: Viewer, inputs: RankInput[], recent: readonly string[]): { personalized: boolean; items: RankedRef[] } {
    const ctx = contextFor(viewer, recent);
    if (!ctx) return { personalized: false, items: unranked(inputs) };
    const open = inputs.filter((x) => isActive(x.status)).sort(openOrder);
    const rest = inputs.filter((x) => !isActive(x.status));
    return { personalized: true, items: [...rankGroup(ctx, open, REC_PARAMS.scoreOpen), ...rankGroup(ctx, rest, REC_PARAMS.score)] };
  }

  function proposalVisible(id: string, viewerId: string): boolean {
    const p = db.get<{ status: string; author_id: string }>("SELECT status, author_id FROM proposals WHERE id = ?", id);
    return !!p && (p.status !== "draft" || p.author_id === viewerId);
  }

  /**
   * Öneri sonuçları ve Öneriler sayfasının aynı terimle göstereceği öneri sayısı (`total`; shared proposalMatchesQuery: numara,
   * başlık ya da yazar). Sonuç satırları yalnız numara ve başlık eşleşmeleridir.
   */
  function searchProposals(q: string, ref: ReturnType<typeof parseSearchRef>, titles: boolean, viewerId: string | null): { hits: SearchHit[]; total: number } {
    type Row = { id: string; seq: number; kind: ProposalKind; title: string; status: ProposalStatus; created_at: number; nickname: string | null };
    const base = "SELECT p.id, p.seq, p.kind, p.title, p.status, p.created_at, u.nickname FROM proposals p LEFT JOIN users u ON u.id = p.author_id";
    const visible = "(p.status <> 'draft' OR p.author_id = ?)";
    const rows =
      titles || !ref
        ? db.all<Row>(`${base} WHERE ${visible}`, viewerId)
        : ref.kind === "topic"
          ? []
          : db.all<Row>(`${base} WHERE p.seq = ? AND ${visible}`, ref.seq, viewerId);
    const hits: SearchHit[] = [];
    let total = 0;
    for (const r of rows) {
      if (proposalMatchesQuery({ seq: Number(r.seq), title: r.title, authorNickname: r.nickname }, q)) total++;
      const match: SearchMatch | null = ref && ref.kind !== "topic" && Number(r.seq) === ref.seq ? "ref" : titles ? matchTitle(r.title, q) : null;
      if (!match) continue;
      hits.push({
        type: "proposal",
        id: r.id,
        seq: Number(r.seq),
        title: r.title,
        kind: r.kind,
        status: r.status,
        match,
        open: r.status === "draft" || isActive(r.status),
        createdAt: Number(r.created_at),
      });
    }
    return { hits, total };
  }

  function searchTopics(q: string, ref: ReturnType<typeof parseSearchRef>, titles: boolean): SearchHit[] {
    type Row = { id: string; seq: number; title: string; status: "active" | "archived"; created_at: number };
    const rows =
      titles || !ref
        ? db.all<Row>("SELECT id, seq, title, status, created_at FROM topics")
        : ref.kind === "proposal"
          ? []
          : db.all<Row>("SELECT id, seq, title, status, created_at FROM topics WHERE seq = ?", ref.seq);
    const out: SearchHit[] = [];
    for (const r of rows) {
      const match: SearchMatch | null = ref && ref.kind !== "proposal" && Number(r.seq) === ref.seq ? "ref" : titles ? matchTitle(r.title, q) : null;
      if (!match) continue;
      out.push({ type: "topic", id: r.id, seq: Number(r.seq), title: r.title, status: r.status, match, open: r.status === "active", createdAt: Number(r.created_at) });
    }
    return out;
  }

  return {
    search(rawQ: string, rawLimit: number | undefined, viewer: Viewer): SearchResponse {
      const q = String(rawQ ?? "").trim().slice(0, SEARCH_QUERY_MAX);
      const limit = Math.min(SEARCH_LIMIT_MAX, Math.max(1, Math.floor(Number(rawLimit) || SEARCH_LIMIT_MAX)));
      const ref = parseSearchRef(q);
      if (!ref && searchKey(q).length < SEARCH_MIN_CHARS) return { q, items: [], total: { proposals: 0, topics: 0 } };
      // Açık numara ("#K12", "T-3", "#12") yalnız numarayla; yalın rakamlar ("2026") başlıklarda da aranır.
      const titles = !ref || !ref.explicit;
      const proposals = searchProposals(q, ref, titles, viewer?.id ?? null);
      const topics = searchTopics(q, ref, titles);
      const items = [...proposals.hits, ...topics].sort(compareSearchHits).slice(0, limit);
      return { q, items, total: { proposals: proposals.total, topics: topics.length } };
    },

    saved(userId: string): SavedList {
      const rows = db.all<{ target_type: SavedTargetType; target_id: string; created_at: number }>(
        "SELECT target_type, target_id, created_at FROM saved_items WHERE user_id = ? ORDER BY created_at DESC, target_type, target_id",
        userId,
      );
      const pIds = rows.filter((r) => r.target_type === "proposal").map((r) => r.target_id);
      const tIds = rows.filter((r) => r.target_type === "topic").map((r) => r.target_id);
      const proposals = new Map(
        (pIds.length ? querySummaries(core, "p.id IN (SELECT value FROM json_each(?)) AND (p.status <> 'draft' OR p.author_id = ?)", [jsonList(pIds), userId]) : []).map(
          (s) => [s.id, s] as const,
        ),
      );
      const topics = new Map(
        (tIds.length ? topicSummaries(core, db.all<TopicRow>("SELECT * FROM topics WHERE id IN (SELECT value FROM json_each(?))", jsonList(tIds))) : []).map(
          (t) => [t.id, t] as const,
        ),
      );
      const items: SavedItem[] = [];
      for (const r of rows) {
        const savedAt = Number(r.created_at);
        if (r.target_type === "proposal") {
          const proposal = proposals.get(r.target_id);
          if (proposal) items.push({ type: "proposal", id: r.target_id, savedAt, proposal });
        } else {
          const topic = topics.get(r.target_id);
          if (topic) items.push({ type: "topic", id: r.target_id, savedAt, topic });
        }
      }
      return { items };
    },

    setSaved(actor: AuthUser, type: SavedTargetType, id: string, saved: boolean): SavedState {
      if (!saved) {
        // İdempotent; hedefin varlığı denetlenmez ve belli edilmez (başkasının taslağı için de aynı yanıt).
        db.run("DELETE FROM saved_items WHERE user_id = ? AND target_type = ? AND target_id = ?", actor.id, type, id);
        invalidate(actor.id);
        return { type, id, saved: false, savedAt: null };
      }
      if (type === "proposal" ? !proposalVisible(id, actor.id) : !db.get("SELECT 1 AS x FROM topics WHERE id = ?", id)) {
        throw notFound(type === "proposal" ? "Öneri" : "Konu");
      }
      const state = core.tx((): SavedState => {
        const existing = db.get<{ created_at: number }>(
          "SELECT created_at FROM saved_items WHERE user_id = ? AND target_type = ? AND target_id = ?",
          actor.id,
          type,
          id,
        );
        if (existing) return { type, id, saved: true, savedAt: Number(existing.created_at) };
        const count = Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM saved_items WHERE user_id = ?", actor.id)?.c ?? 0);
        if (count >= SAVED_ITEMS_MAX) {
          throw unprocessable("saved_limit", `Listenizde en çok ${SAVED_ITEMS_MAX} kayıt olabilir; yenisini eklemek için listeden birini çıkarın.`, {
            max: SAVED_ITEMS_MAX,
          });
        }
        const now = core.now();
        db.run("INSERT INTO saved_items(user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)", actor.id, type, id, now);
        return { type, id, saved: true, savedAt: now };
      });
      invalidate(actor.id);
      return state;
    },

    isSaved(userId: string, type: SavedTargetType, id: string): boolean {
      return isSavedBy(core, userId, type, id);
    },

    personalize(viewer: Viewer, items: ProposalSummary[], recent: readonly string[] = []): PersonalizedProposalList {
      const ranked = rank(viewer, items.map(fromSummary), recent);
      const byId = new Map(items.map((s) => [s.id, s] as const));
      return { personalized: ranked.personalized, items: ranked.items.map((e) => ({ ...byId.get(e.id)!, score: e.score, reason: e.reason })) };
    },

    openForDashboard(viewer: Viewer, limit: number, recent: readonly string[] = []): { personalized: boolean; items: DashboardOpenProposal[] } {
      const n = Math.max(1, Math.floor(limit));
      const ctx = contextFor(viewer, recent);
      if (ctx) {
        // Tüm açık öneriler hafif satırlarla sıralanır (kişisel listenin açık bölümüyle aynı girdi sırası ve ağırlıklar);
        // özet (toplu sayımlar) yalnız gösterilecek ilk `limit` için kurulur.
        const rows = db.all<SummaryRow>(`SELECT ${SUMMARY_COLUMNS} FROM proposals p WHERE p.status IN ${ACTIVE_SQL} ${OPEN_ORDER_SQL}`);
        const top = rankGroup(ctx, rows.map(fromRow), REC_PARAMS.scoreOpen).slice(0, n);
        const byId = new Map(rows.map((r) => [r.id, r] as const));
        const summaries = proposalSummaries(
          core,
          top.map((e) => byId.get(e.id)!),
        );
        return { personalized: true, items: summaries.map((s, i) => ({ ...s, score: top[i].score, reason: top[i].reason })) };
      }
      return { personalized: false, items: querySummaries(core, `p.status IN ${ACTIVE_SQL}`, [], `${OPEN_ORDER_SQL} LIMIT ${n}`) };
    },

    forgetCache(userId: string): void {
      invalidate(userId);
    },

    sweepCache(): void {
      sweep();
    },

    signalCacheSize(): number {
      return cache.size;
    },
  };
}
