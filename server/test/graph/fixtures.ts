// Graf testleri için doğrudan tablo satırı ekleyen yardımcılar (öneri, oy, sayım, küme anlık görüntüsü).
import type { DecisionOutcome } from "@forum/shared";
import type { Db } from "../../src/db";
import { newId } from "../../src/core/ids";

const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);

export function addProposal(db: Db, authorId: string, status = "enacted", id: string = newId()): string {
  db.run(
    "INSERT INTO proposals(id, seq, kind, title, body, author_id, status, created_at, updated_at) VALUES (?, ?, 'topic', ?, ?, ?, ?, ?, ?)",
    id,
    db.nextSeq("proposals"),
    "Deneme önerisi",
    "Metin",
    authorId,
    status,
    T0,
    T0,
  );
  return id;
}

export function addBallot(db: Db, proposalId: string, userId: string, choice: "yes" | "no" | "abstain", opts: { at?: number; round?: number } = {}): void {
  const at = opts.at ?? T0;
  db.run(
    "INSERT INTO ballots(proposal_id, round, user_id, ballot_id, choice, salt, commitment, cast_at, updated_at) VALUES (?, ?, ?, ?, ?, 's', 'c', ?, ?)",
    proposalId,
    opts.round ?? 1,
    userId,
    newId(),
    choice,
    at,
    at,
  );
}

export function addTally(db: Db, proposalId: string, outcome: DecisionOutcome, round = 1, at = T0 + 1000): void {
  db.run(
    "INSERT INTO tallies(id, proposal_id, round, result, created_at) VALUES (?, ?, ?, ?, ?)",
    newId(),
    proposalId,
    round,
    JSON.stringify({ algoVersion: "KC-1.0", round, outcome }),
    at,
  );
}

export function addSnapshot(
  db: Db,
  assignments: Record<string, string>,
  coords: Record<string, [number, number]> = {},
  opts: { seed?: string; at?: number } = {},
): string {
  const id = newId();
  const sizes: Record<string, number> = {};
  for (const c of Object.values(assignments)) sizes[c] = (sizes[c] ?? 0) + 1;
  db.run(
    `INSERT INTO cluster_snapshots(id, algo, params, seed, input_hash, output_hash, k, silhouette, assignments, coords, sizes, clustered_total, created_at)
     VALUES (?, 'pca2-kmeans-silhouette/1', '{}', ?, 'in', 'out', ?, 0.5, ?, ?, ?, ?, ?)`,
    id,
    opts.seed ?? "anlik-goruntu-tohumu",
    Object.keys(sizes).length,
    JSON.stringify(assignments),
    JSON.stringify(coords),
    JSON.stringify(sizes),
    Object.keys(assignments).length,
    opts.at ?? T0,
  );
  return id;
}

export function addExpert(db: Db, userId: string, status = "active"): void {
  db.run("INSERT INTO experts(user_id, domains, credentials, status, created_at) VALUES (?, '[]', 'belge', ?, ?)", userId, status, T0);
}

export { T0 };
