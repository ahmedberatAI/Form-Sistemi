// Sıcak sorgular için indeksler (#295, #296): EXPLAIN QUERY PLAN'da tablo taraması (SCAN <tablo>) olmamalı.
import { describe, expect, it } from "vitest";
import { migrate, openMemoryDb } from "../../src/db";
import { SIGNAL_SQL } from "../../src/forum/discovery";

const db = openMemoryDb();
const plan = (sql: string, params: (string | number)[]): string =>
  db
    .all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...params)
    .map((r) => r.detail)
    .join(" | ");

describe("sorgu indeksleri", () => {
  const cases: [string, string, string, (string | number)[]][] = [
    ["öneri özetleri", "idx_audit_action_target", "SELECT target, meta FROM audit_log WHERE action = ? AND target IN (SELECT 'proposal:' || value FROM json_each(?))", ["a", "[]"]],
    ["yönetici denetim görünümü", "idx_audit_at", "SELECT * FROM audit_log ORDER BY at DESC LIMIT 50", []],
    ["dışa aktarım (target)", "idx_audit_target_at", "SELECT * FROM audit_log WHERE target = ?", ["x"]],
    ["markOverdue", "idx_expert_assign_status_due", "SELECT * FROM expert_assignments WHERE status IN ('invited','accepted') AND due_at < ?", [1]],
    ["uzman atamaları", "idx_expert_assign_expert", "SELECT * FROM expert_assignments WHERE expert_id = ?", ["x"]],
    ["panel atamaları", "idx_expert_assign_panel", "SELECT * FROM expert_assignments WHERE panel_id = ?", ["x"]],
    ["öneri atamaları", "idx_expert_assign_proposal", "SELECT * FROM expert_assignments WHERE proposal_id = ?", ["x"]],
    ["raporlar", "idx_expert_reports_proposal", "SELECT * FROM expert_reports WHERE proposal_id = ?", ["x"]],
    ["sorular", "idx_expert_questions_proposal", "SELECT * FROM expert_questions WHERE proposal_id = ?", ["x"]],
    ["paneller", "idx_expert_panels_proposal", "SELECT * FROM expert_panels WHERE proposal_id = ? ORDER BY round", ["x"]],
    ["azınlık raporları", "idx_minority_reports_proposal", "SELECT * FROM minority_reports WHERE proposal_id = ?", ["x"]],
    ["öneriye gelen öneriler", "idx_suggestions_proposal", "SELECT * FROM proposal_suggestions WHERE proposal_id = ? AND status = 'open'", ["x"]],
    ["profil ileti sayısı", "idx_messages_author", "SELECT COUNT(*) FROM messages WHERE author_id = ?", ["x"]],
    ["üyenin önerileri", "idx_proposals_author", "SELECT * FROM proposals WHERE author_id = ?", ["x"]],
    ["üyenin oyları", "idx_ballots_user", "SELECT * FROM ballots WHERE user_id = ?", ["x"]],
    ["doğrulanmış üye sayısı", "idx_users_status", "SELECT COUNT(*) FROM users WHERE status = 'verified'", []],
    ["oturum iptali", "idx_sessions_user", "SELECT * FROM sessions WHERE user_id = ?", ["x"]],
    ["vekâletler", "idx_edges_type_revoked", "SELECT * FROM graph_edges WHERE type = 'DELEGATES_TO' AND revoked_at IS NULL", []],
    ["bildirim listesi", "idx_notifications_created", "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC", ["x"]],
    ["kişisel sıra: üyenin destekledikleri", "idx_sponsors_user", "SELECT proposal_id, at FROM proposal_sponsors WHERE user_id = ? AND at >= ?", ["x", 0]],
    ["Listem", "idx_saved_items_user_created", "SELECT target_type, target_id, created_at FROM saved_items WHERE user_id = ? ORDER BY created_at DESC", ["x"]],
  ];

  it.each(cases)("%s: %s kullanılır", (_ad, index, sql, params) => {
    const p = plan(sql, params);
    expect(p).toContain(index);
    // Çıplak tablo taraması ("SCAN tablo" ve ardından INDEX yok) olmamalı; "SCAN … USING INDEX" (ör. ORDER BY için) kabul.
    expect(p).not.toMatch(/SCAN (?!json_each)\w+(?! USING)(\s|\||$)/);
  });

  it("kişisel sıranın tek toplama sorgusu: her kaynak tablo indeksle aranır (yalnız ara sonuç 's' taranır)", () => {
    const p = plan(SIGNAL_SQL, ["x", 0]);
    for (const idx of ["idx_proposals_author", "idx_saved_items_user_created", "idx_sponsors_user", "idx_messages_author"]) expect(p).toContain(idx);
    expect(p.split(" | ").filter((d) => d.startsWith("SCAN"))).toEqual(["SCAN s"]);
  });

  it("mevcut (indeksleri olmayan) veritabanları bir sonraki migrate'te indeksleri alır", () => {
    const old = openMemoryDb();
    old.exec("DROP INDEX idx_audit_action_target; DROP INDEX idx_expert_assign_status_due;");
    const has = (n: string) => old.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'index' AND name = ?", n) !== undefined;
    expect(has("idx_audit_action_target")).toBe(false);
    migrate(old);
    migrate(old); // yinelenen çalıştırma zararsız
    expect(has("idx_audit_action_target")).toBe(true);
    expect(has("idx_expert_assign_status_due")).toBe(true);
  });
});
