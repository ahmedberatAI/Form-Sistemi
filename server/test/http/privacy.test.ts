// Herkese açık uçlarda görüş (siyasi görüş = özel nitelikli veri) ve oy gizliliği.
import { afterEach, describe, expect, it } from "vitest";
import { publicJoinDay, type ClusterSnapshotView, type GraphVisNode, type PublicUser } from "@forum/shared";
import { boot, type Harness } from "./harness";

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

function insertSnapshot(hh: Harness, assignments: Record<string, string>): void {
  const coords: Record<string, [number, number]> = {};
  let i = 0;
  for (const u of Object.keys(assignments)) coords[u] = [i++, -i];
  const sizes: Record<string, number> = {};
  for (const g of Object.values(assignments)) sizes[g] = (sizes[g] ?? 0) + 1;
  hh.services.ctx.db.run(
    `INSERT INTO cluster_snapshots(id, algo, params, seed, input_hash, output_hash, k, silhouette, assignments, coords, sizes, clustered_total, created_at)
     VALUES ('snap-test', 'test', '{}', 'tohum', 'girdi', 'cikti', 2, 0.5, ?, ?, ?, ?, ?)`,
    JSON.stringify(assignments),
    JSON.stringify(coords),
    JSON.stringify(sizes),
    Object.keys(assignments).length,
    hh.clock.now(),
  );
}

describe("http: görüş ve oy gizliliği", () => {
  it("görüş haritası anonimdir; kişi yalnız kendi noktasını tanır", async () => {
    h = await boot();
    const a = await h.member("Ayse_Gizli");
    const b = await h.member("Bora_Gizli");
    insertSnapshot(h, { [a.user.id]: "g0", [b.user.id]: "g1" });

    const anon = await h.ok<ClusterSnapshotView>("GET", "/api/clusters/latest");
    expect(anon.points).toHaveLength(2);
    expect(anon.points.every((p) => p.userId === "" && p.nickname === "")).toBe(true);

    const mine = await h.ok<ClusterSnapshotView>("GET", "/api/clusters/latest", { token: a.token });
    expect(mine.points.filter((p) => p.userId === a.user.id)).toHaveLength(1);
    expect(mine.points.some((p) => p.userId === b.user.id)).toBe(false);
  });

  it("graf düğümlerinde küme/topluluk/koordinat yalnız görüntüleyenin kendisine", async () => {
    h = await boot();
    const a = await h.member("Cem_Gizli");
    const b = await h.member("Defne_Gizli");
    insertSnapshot(h, { [a.user.id]: "g0", [b.user.id]: "g1" });
    await h.ok("POST", `/api/users/${b.user.id}/follow`, { token: a.token });

    const { nodes } = await h.ok<{ nodes: GraphVisNode[] }>("GET", "/api/graph", { token: a.token });
    const other = nodes.find((n) => n.id === b.user.id)!;
    expect(other.cluster).toBeNull();
    expect(other.community).toBeNull();
    expect(other.x).toBeUndefined();
    const self = nodes.find((n) => n.id === a.user.id)!;
    expect(self.cluster).toBe("g0");

    const pub = await h.ok<{ nodes: GraphVisNode[] }>("GET", "/api/graph");
    expect(pub.nodes.every((n) => n.cluster === null && n.community === null)).toBe(true);
  });

  it("üyelik defter kayıtları zaman taşımaz; herkese açık katılım tarihi güne yuvarlanır (takma ad ↔ memberRef eşleştirilemez)", async () => {
    h = await boot();
    h.clock.advance(5 * 3_600_000 + 4321);
    const a = await h.member("Ece_Zaman");
    h.clock.advance(7_000);
    const b = await h.member("Fuat_Zaman");
    await h.services.ledger.flush();
    const txs = await h.ok<{ payload: Record<string, unknown> }[]>("GET", "/api/ledger/txs?type=MEMBER_REGISTERED&limit=50");
    expect(txs.length).toBeGreaterThanOrEqual(2);
    for (const t of txs) expect(Object.keys(t.payload)).toEqual(["memberRef"]);

    const users = await h.ok<PublicUser[]>("GET", "/api/users?limit=50");
    const pubA = users.find((u) => u.id === a.user.id)!;
    const pubB = users.find((u) => u.id === b.user.id)!;
    expect(pubA.joinedAt).toBe(publicJoinDay(a.user.joinedAt));
    expect(pubA.joinedAt).not.toBe(a.user.joinedAt); // Me (sahibine) tam an, herkese açık yanıt gün başı
    expect(pubA.joinedAt).toBe(pubB.joinedAt); // aynı gün kaydolanlar ayırt edilemez
    expect((await h.ok<PublicUser>("GET", `/api/users/${a.user.id}`)).joinedAt).toBe(pubA.joinedAt);
  });
});
