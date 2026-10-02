// Görüş kümeleri (ALGORITMA.md §9): kapanmış önerilerin son turundaki doğrudan oylarından PCA + k-means anlık görüntüsü.
import { clusterLabel, hashCanonical, sha256Hex, type ClusterSnapshotView } from "@forum/shared";
import { DAY } from "../core/clock";
import type { ClusterComputation, VoteMatrixEntry } from "../core/contracts";
import type { ClusterService } from "../core/forum-contracts";
import { newId } from "../core/ids";
import { json } from "../db";
import { jsonList, type ForumCore } from "./util";

/** Asgari hesap yaşı: yeni doğrulanmış hesaplar kümeleme girdisine katılmaz (küme manipülasyonuna karşı). */
export const MIN_ACCOUNT_AGE_MS = 3 * DAY;

interface SnapshotRow {
  id: string;
  algo: string;
  params: string;
  seed: string;
  input_hash: string;
  output_hash: string;
  k: number;
  silhouette: number;
  assignments: string;
  coords: string;
  sizes: string;
  clustered_total: number;
  ledger_tx: string | null;
  created_at: number;
}

/** Sayım için çözülmüş anlık görüntü. */
export interface SnapshotData {
  id: string;
  k: number;
  sizes: Record<string, number>;
  clusteredTotal: number;
  assignments: Record<string, string>;
  outputHash: string;
}

export interface ClusterServiceImpl extends ClusterService {
  data(snapshotId: string): SnapshotData | null;
}

const finite = (x: number): number => (Number.isFinite(x) ? x : 0);

/**
 * Görüş haritası anonimdir (KVKK md. 6: siyasi görüş özel nitelikli veridir): noktalar küme ve koordinat taşır, kimlik
 * taşımaz; yalnız görüntüleyenin kendi noktası (varsa) işaretlenir. Sıra kimliğe göre değil kümeye ve koordinata göre —
 * sıralamadan kimlik çıkarılamasın. Kimlikli görünümü yalnız servisin iç `latest()`/`get()` çağrıları üretir;
 * HTTP'ye çıkan her görünüm (grafik uçları dahil) bu işlevden geçmelidir.
 */
export function anonymizeClusterView(snap: ClusterSnapshotView, viewerId: string | null = null): ClusterSnapshotView {
  const points = snap.points
    .map((p) => (viewerId && p.userId === viewerId ? p : { ...p, userId: "", nickname: "" }))
    .sort((a, b) => a.clusterId.localeCompare(b.clusterId) || a.x - b.x || a.y - b.y);
  return { ...snap, points };
}

export function createClusterService(core: ForumCore): ClusterServiceImpl {
  const { db } = core;
  const cache = new Map<string, SnapshotData>();

  function row(id: string): SnapshotRow | undefined {
    return db.get<SnapshotRow>("SELECT * FROM cluster_snapshots WHERE id = ?", id);
  }
  function latestRow(): SnapshotRow | undefined {
    return db.get<SnapshotRow>("SELECT * FROM cluster_snapshots ORDER BY created_at DESC, rowid DESC LIMIT 1");
  }

  function view(r: SnapshotRow): ClusterSnapshotView {
    const assignments = json<Record<string, string>>(r.assignments, {});
    const coords = json<Record<string, [number, number]>>(r.coords, {});
    const sizes = json<Record<string, number>>(r.sizes, {});
    const users = Object.keys(assignments);
    const nick = core.nicknames(users);
    const sums = new Map<string, { x: number; y: number; n: number }>();
    for (const u of users) {
      const g = assignments[u];
      const c = coords[u] ?? [0, 0];
      const s = sums.get(g) ?? { x: 0, y: 0, n: 0 };
      s.x += c[0];
      s.y += c[1];
      s.n++;
      sums.set(g, s);
    }
    const clusterIds = [...new Set([...Object.keys(sizes), ...sums.keys()])].sort(
      (a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")) || (a < b ? -1 : a > b ? 1 : 0),
    );
    const round = (x: number) => Math.round(x * 1e6) / 1e6;
    return {
      id: r.id,
      k: Number(r.k),
      silhouette: Number(r.silhouette),
      members: Number(r.clustered_total),
      createdAt: Number(r.created_at),
      seed: r.seed,
      inputHash: r.input_hash,
      ledgerTx: r.ledger_tx,
      clusters: clusterIds.map((g) => {
        const s = sums.get(g);
        return {
          clusterId: g,
          label: clusterLabel(g),
          size: sizes[g] ?? s?.n ?? 0,
          centroid: s && s.n > 0 ? [round(s.x / s.n), round(s.y / s.n)] : [0, 0],
        };
      }),
      points: users
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map((u) => ({ userId: u, nickname: nick.get(u) ?? "", clusterId: assignments[u], x: coords[u]?.[0] ?? 0, y: coords[u]?.[1] ?? 0 })),
    };
  }

  function data(id: string): SnapshotData | null {
    const hit = cache.get(id);
    if (hit) return hit;
    const r = row(id);
    if (!r) return null;
    const d: SnapshotData = {
      id: r.id,
      k: Number(r.k),
      sizes: json<Record<string, number>>(r.sizes, {}),
      clusteredTotal: Number(r.clustered_total),
      assignments: json<Record<string, string>>(r.assignments, {}),
      outputHash: r.output_hash,
    };
    cache.set(id, d);
    return d;
  }

  /** Kapanmış (enacted/rejected) önerilerin SON turundaki doğrudan oyları; yalnız yeterince eski doğrulanmış hesaplar. */
  function entries(now: number): VoteMatrixEntry[] {
    const rows = db.all<{ proposal_id: string; user_id: string; choice: string }>(
      `SELECT b.proposal_id, b.user_id, b.choice
         FROM ballots b
         JOIN proposals p ON p.id = b.proposal_id AND p.status IN ('enacted', 'rejected')
         JOIN (SELECT proposal_id, MAX(round) AS r FROM ballots GROUP BY proposal_id) lr
           ON lr.proposal_id = b.proposal_id AND lr.r = b.round
         JOIN users u ON u.id = b.user_id AND u.status = 'verified' AND u.verified_at IS NOT NULL AND u.verified_at <= ?
        ORDER BY b.user_id, b.proposal_id`,
      now - MIN_ACCOUNT_AGE_MS,
    );
    return rows.map((r) => ({ userId: r.user_id, proposalId: r.proposal_id, value: r.choice === "yes" ? 1 : r.choice === "no" ? -1 : 0 }));
  }

  const service: ClusterServiceImpl = {
    async snapshot(reason: string): Promise<ClusterSnapshotView> {
      const now = core.now();
      const list = entries(now);
      const seed = sha256Hex(core.deps.ledger.latestBlock().hash + "|cluster|" + now);
      let comp: ClusterComputation = core.deps.math.computeClusters(list, seed);
      if (!(comp.k >= 1)) {
        // Soğuk başlangıç (girdi yok ya da kimse yeterli oy vermemiş): K=1, köprü testi uygulanmaz.
        const { algo, silhouette, assignments, coords, sizes, clusteredTotal, excluded } = comp;
        comp = { ...comp, k: 1, outputHash: hashCanonical({ algo, k: 1, silhouette, assignments, coords, sizes, clusteredTotal, excluded }) };
      }
      const last = latestRow();
      // Yeniden hesaplama sonucu kimlik taşımaz (anonim görünüm); kimlikli görünüm yalnız latest()/get() ile iç kullanım içindir.
      if (last && last.input_hash === comp.inputHash) return anonymizeClusterView(view(last));

      const id = newId();
      const silhouette = finite(comp.silhouette);
      core.tx(() => {
        db.run(
          `INSERT INTO cluster_snapshots(id, algo, params, seed, input_hash, output_hash, k, silhouette, assignments, coords, sizes, clustered_total, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          comp.algo,
          JSON.stringify({ reason, minAccountAgeDays: 3, entries: list.length, excluded: comp.excluded.length }),
          comp.seed,
          comp.inputHash,
          comp.outputHash,
          comp.k,
          silhouette,
          JSON.stringify(comp.assignments),
          JSON.stringify(comp.coords),
          JSON.stringify(comp.sizes),
          comp.clusteredTotal,
          now,
        );
        const tx = core.submit("CLUSTER_SNAPSHOT", {
          snapshotId: id,
          algo: comp.algo,
          k: comp.k,
          silhouette,
          inputHash: comp.inputHash,
          outputHash: comp.outputHash,
          seed: comp.seed,
          sizes: comp.sizes,
        });
        db.run("UPDATE cluster_snapshots SET ledger_tx = ? WHERE id = ?", tx, id);
      });
      return anonymizeClusterView(view(row(id)!));
    },

    latest(): ClusterSnapshotView | null {
      const r = latestRow();
      return r ? view(r) : null;
    },

    get(id: string): ClusterSnapshotView | null {
      const r = row(id);
      return r ? view(r) : null;
    },

    clusterOf(snapshotId: string, userId: string): string | null {
      return data(snapshotId)?.assignments[userId] ?? null;
    },

    sizes(snapshotId: string) {
      const d = data(snapshotId);
      if (!d) return { k: 1, sizes: {}, clusteredTotal: 0, hash: "" };
      return { k: d.k, sizes: { ...d.sizes }, clusteredTotal: d.clusteredTotal, hash: d.outputHash };
    },

    data,
  };
  return service;
}

/** Son anlık görüntüdeki kümeler: userId → clusterId (birden çok kullanıcı için tek sorgu). */
export function latestClusterOf(core: ForumCore, userIds: string[]): Map<string, string | null> {
  const out = new Map<string, string | null>(userIds.map((u) => [u, null]));
  const r = core.db.get<{ assignments: string }>("SELECT assignments FROM cluster_snapshots ORDER BY created_at DESC, rowid DESC LIMIT 1");
  if (!r || userIds.length === 0) return out;
  const a = json<Record<string, string>>(r.assignments, {});
  for (const u of userIds) out.set(u, a[u] ?? null);
  return out;
}

export { jsonList };
