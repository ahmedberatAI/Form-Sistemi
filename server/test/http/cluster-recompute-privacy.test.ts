// Regresyon (#154, #172): yönetici "kümeleri yeniden hesapla" yanıtı da anonimdir; kimlik ve takma ad sızmaz.
import { afterEach, describe, expect, it } from "vitest";
import type { ClusterSnapshotView } from "@forum/shared";
import { anonymizeClusterView } from "../../src/forum/clusters";
import { boot, type Harness } from "./harness";

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

describe("http: yönetici küme yeniden hesaplama gizliliği", () => {
  it("POST /api/admin/clusters/recompute kimlik ve takma ad döndürmez", async () => {
    h = await boot();
    const admin = await h.staff("yonetici_kume", ["admin"]);
    const a = await h.member("Ayse_Gizli");
    const b = await h.member("Bora_Gizli");
    // İlk hesaplama anlık görüntüyü oluşturur; aynı girdi için ikinci çağrı mevcut satırı döndürür — satıra üye yerleştirilir.
    await h.ok<ClusterSnapshotView>("POST", "/api/admin/clusters/recompute", { token: admin.token });
    const db = h.services.ctx.db;
    const last = db.get<{ id: string }>("SELECT id FROM cluster_snapshots ORDER BY created_at DESC, rowid DESC LIMIT 1")!;
    db.run(
      "UPDATE cluster_snapshots SET assignments = ?, coords = ?, sizes = ?, clustered_total = 2 WHERE id = ?",
      JSON.stringify({ [a.user.id]: "g0", [b.user.id]: "g1" }),
      JSON.stringify({ [a.user.id]: [0.1, 0.2], [b.user.id]: [0.9, -0.4] }),
      JSON.stringify({ g0: 1, g1: 1 }),
      last.id,
    );

    const r = await h.req("POST", "/api/admin/clusters/recompute", { token: admin.token });
    expect(r.statusCode).toBe(200);
    const snap = r.json() as ClusterSnapshotView;
    expect(snap.points).toHaveLength(2);
    expect(snap.points.every((p) => p.userId === "" && p.nickname === "")).toBe(true);
    expect(r.body).not.toContain(a.user.id);
    expect(r.body).not.toContain(b.user.id);
    expect(r.body).not.toContain("Ayse_Gizli");
    expect(r.body).not.toContain("Bora_Gizli");

    // Herkese açık uçla aynı gizlilik: yönetici de olsa başkasının noktası tanınmaz
    const pub = await h.ok<ClusterSnapshotView>("GET", "/api/clusters/latest", { token: admin.token });
    expect(pub.points.every((p) => p.userId === "")).toBe(true);
  });

  it("anonymizeClusterView yalnız görüntüleyenin kendi noktasını korur", () => {
    const snap = {
      id: "s",
      points: [
        { userId: "u1", nickname: "bir", clusterId: "g0", x: 2, y: 0 },
        { userId: "u2", nickname: "iki", clusterId: "g0", x: 1, y: 0 },
      ],
    } as unknown as ClusterSnapshotView;
    expect(anonymizeClusterView(snap).points.map((p) => p.userId)).toEqual(["", ""]);
    expect(anonymizeClusterView(snap, "u1").points.map((p) => p.userId)).toEqual(["", "u1"]);
  });
});
