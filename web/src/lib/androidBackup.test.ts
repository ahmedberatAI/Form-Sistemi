// #184 + #228: Android otomatik yedeği oturum belirtecini ve oy makbuzlarını (seçim + tuz) dışarı taşımamalıdır.
import { describe, expect, it } from "vitest";
import manifest from "../../android/app/src/main/AndroidManifest.xml?raw";
import backupRules from "../../android/app/src/main/res/xml/backup_rules.xml?raw";
import extractionRules from "../../android/app/src/main/res/xml/data_extraction_rules.xml?raw";

const DOMAINS = ["root", "file", "database", "sharedpref", "external"];

describe("Android yedekleme ayarları", () => {
  it("allowBackup kapalı ve yedek kuralları bildirilmiş", () => {
    expect(manifest).toMatch(/android:allowBackup="false"/);
    expect(manifest).not.toMatch(/android:allowBackup="true"/);
    expect(manifest).toContain('android:fullBackupContent="@xml/backup_rules"');
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
  });

  it("kurallar SharedPreferences dahil tüm alanları hem bulut yedeğinden hem cihaz aktarımından hariç tutar", () => {
    for (const d of DOMAINS) {
      expect(backupRules, `backup_rules ${d}`).toContain(`<exclude domain="${d}" path="." />`);
      const cloud = /<cloud-backup>([\s\S]*?)<\/cloud-backup>/.exec(extractionRules)?.[1] ?? "";
      const transfer = /<device-transfer>([\s\S]*?)<\/device-transfer>/.exec(extractionRules)?.[1] ?? "";
      expect(cloud, `cloud-backup ${d}`).toContain(`<exclude domain="${d}" path="." />`);
      expect(transfer, `device-transfer ${d}`).toContain(`<exclude domain="${d}" path="." />`);
    }
    // Hiçbir kural veri alanı eklemez (include yok)
    for (const xml of [backupRules, extractionRules]) expect(xml).not.toMatch(/<include\b/);
  });
});
