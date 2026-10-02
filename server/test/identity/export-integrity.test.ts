// #5 + #202: KVKK dökümü üyenin kendi görüş kümesi atamasını içerir (başkasınınkini değil) ve SQL hatasında
// sessizce boş bölüm döndürmek yerine hata verir (eksik döküm "tam" diye denetim kaydına yazılmaz).
import { describe, expect, it } from "vitest";
import { insertUser } from "../helpers/fakes";
import { addProposal, addSnapshot, T0 } from "../graph/fixtures";
import { regInput, setup } from "./fixtures";

describe("KVKK dökümü: görüş kümesi", () => {
  it("üyenin kendi kümesi ve konumu dökümde; başka üyenin ataması yok; en son anlık görüntü kullanılır", async () => {
    const { identity, ctx } = setup();
    const { user } = await identity.register(regInput());
    const other = insertUser(ctx.db, { nickname: "baska-uye" });
    const loner = insertUser(ctx.db, { nickname: "kumesiz" });

    // Küme anlık görüntüsü henüz yok → bölüm boş (null)
    expect((identity.exportOwnData(user.id) as Record<string, unknown>).opinionCluster).toBeNull();

    addSnapshot(ctx.db, { [user.id]: "g9", [other]: "g8" }, { [user.id]: [9, 9], [other]: [8, 8] }, { at: T0 });
    const latest = addSnapshot(ctx.db, { [user.id]: "g1", [other]: "g2" }, { [user.id]: [0.25, -0.5], [other]: [7, 7] }, { at: T0 + 1000 });

    const d = identity.exportOwnData(user.id) as { opinionCluster: Record<string, unknown> };
    expect(d.opinionCluster).toEqual({ snapshotId: latest, snapshotAt: T0 + 1000, clusterId: "g1", position: [0.25, -0.5] });
    const raw = JSON.stringify(d);
    expect(raw).not.toContain(other);
    expect(raw).not.toContain("g2");
    expect(raw).not.toContain("g9");

    // Kümelenmemiş üye: anlık görüntü var ama atama yok
    const none = identity.exportOwnData(loner) as { opinionCluster: Record<string, unknown> };
    expect(none.opinionCluster).toMatchObject({ snapshotId: latest, clusterId: null, position: null });
  });

  it("uygun seçmen kayıtları dökümde listelenir", async () => {
    const { identity, ctx } = setup();
    const { user } = await identity.register(regInput());
    const p1 = addProposal(ctx.db, user.id, "voting");
    const p2 = addProposal(ctx.db, user.id, "voting");
    ctx.db.run("INSERT INTO eligible_voters(proposal_id, user_id) VALUES (?, ?)", p1, user.id);
    const d = identity.exportOwnData(user.id) as { eligibleVoterRolls: string[] };
    expect(d.eligibleVoterRolls).toEqual([p1]);
    expect(d.eligibleVoterRolls).not.toContain(p2);
  });
});

describe("KVKK dökümü: SQL hatası sessizce yutulmaz", () => {
  it("bölüm sorgusu başarısızsa döküm hata verir, hata denetime yazılır, 'identity.export' yazılmaz", async () => {
    const { identity, ctx } = setup();
    const { user } = await identity.register(regInput());
    expect(identity.exportOwnData(user.id)).toBeTruthy(); // sağlam şemada çalışır
    const exports = () => ctx.db.all("SELECT 1 FROM audit_log WHERE action = 'identity.export'").length;
    const before = exports();

    ctx.db.exec("DROP TABLE notifications");
    expect(() => identity.exportOwnData(user.id)).toThrow(/KVKK dökümü oluşturulamadı: "notifications"/);
    expect(exports()).toBe(before);
    const failed = ctx.db.get<{ meta: string }>("SELECT meta FROM audit_log WHERE action = 'identity.export_failed'");
    expect(JSON.parse(failed!.meta)).toEqual({ table: "notifications" });
  });
});
