// Yönetim: simüle saat, zamanlayıcı, kümeler, roller, denetim günlüğü, defter demosu bağlantısı.
// Denetçi (yönetici değilse) yalnızca denetim günlüğünü görür.
import { useAuth } from "../auth/AuthContext";
import { AuditLogView, ClockPanel, RoleManager } from "../components/system/AdminPanels";
import "../components/system/system.css";
import { useQueryState } from "../lib/hooks";
import { routes } from "../lib/routes";
import { Alert, Card, LinkButton, PageHeader, Tabs } from "../ui";

type TabId = "saat" | "roller" | "gunluk" | "defter";

export default function AdminPage() {
  const auth = useAuth();
  const isAdmin = auth.can("A");
  const [tabRaw, setTab] = useQueryState("sekme", "saat");

  if (!isAdmin) {
    return (
      <div className="page">
        <PageHeader title="Denetim günlüğü" subtitle="Denetçi olarak yetkili işlemleri ve kişisel veri erişimlerini inceleyebilirsiniz." />
        <Alert tone="info">Saat, zamanlayıcı ve rol yönetimi yalnızca yöneticilere açıktır.</Alert>
        <AuditLogView />
      </div>
    );
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: "saat", label: "Saat ve zamanlayıcı" },
    { id: "roller", label: "Roller" },
    { id: "gunluk", label: "Denetim günlüğü" },
    { id: "defter", label: "Defter demosu" },
  ];
  const tab = (tabs.some((t) => t.id === tabRaw) ? tabRaw : "saat") as TabId;

  return (
    <div className="page">
      <PageHeader title="Yönetim" subtitle="Demo ve işletim araçları. Her yönetim işlemi denetim günlüğüne yazılır." />
      <Tabs tabs={tabs} value={tab} onChange={(v) => setTab(v)} label="Yönetim bölümleri">
        {tab === "saat" ? (
          <ClockPanel />
        ) : tab === "roller" ? (
          <RoleManager />
        ) : tab === "gunluk" ? (
          <AuditLogView />
        ) : (
          <Card title="Dağıtık defter demosu" subtitle="Kurcalama tespiti, onarım ve hata enjeksiyonu araçları Defter sayfasındadır.">
            <div className="stack">
              <ol className="sy-steps">
                <li>Bir doğrulayıcı düğümde bir bloğu kurcalayın; zincir doğrulaması o düğümde ✘ verir (blok özeti ve imzalar tutmaz).</li>
                <li>Düğümü onarın; sağlıklı düğümlerden kopyalanan bloklarla doğrulama yeniden ✔ olur.</li>
                <li>Bir düğümü çökertin ya da bizans (kötü niyetli) moduna alın; 4 düğümden biri hatalıyken (f = 1) bloklar üretilmeye devam eder.</li>
              </ol>
              <div className="row">
                <LinkButton variant="primary" icon="ledger" to={`${routes.ledger()}?sekme=demo`}>
                  Kurcalama ve hata enjeksiyonu
                </LinkButton>
                <LinkButton to={`${routes.ledger()}?sekme=dogrulama`}>Zincir doğrulama</LinkButton>
              </div>
            </div>
          </Card>
        )}
      </Tabs>
    </div>
  );
}
