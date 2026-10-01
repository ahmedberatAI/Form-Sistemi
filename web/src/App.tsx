// Yönlendirme. HashRouter: Capacitor (file/http://localhost kökeni) ve sunucunun SPA geri dönüşüyle sorunsuz.
// Sayfalar tembel yüklenir (ilk paket küçük kalır; graf kütüphanesi yalnızca /graf'ta iner).
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { RequireAuth, RequireRole } from "./auth/guards";
import { AppLayout } from "./components/layout/AppLayout";
import { EmptyState, LinkButton, Spinner } from "./ui";

const page = (load: () => Promise<{ default: ComponentType }>) => lazy(load);

const HomePage = page(() => import("./pages/HomePage"));
const LoginPage = page(() => import("./pages/LoginPage"));
const RegisterPage = page(() => import("./pages/RegisterPage"));
const TopicsPage = page(() => import("./pages/TopicsPage"));
const TopicDetailPage = page(() => import("./pages/TopicDetailPage"));
const ProposalsPage = page(() => import("./pages/ProposalsPage"));
const NewProposalPage = page(() => import("./pages/NewProposalPage"));
const ProposalDetailPage = page(() => import("./pages/ProposalDetailPage"));
const VerifyVotePage = page(() => import("./pages/VerifyVotePage"));
const ExpertsPage = page(() => import("./pages/ExpertsPage"));
const ProfilePage = page(() => import("./pages/ProfilePage"));
const UserPage = page(() => import("./pages/UserPage"));
const RegistrarPage = page(() => import("./pages/RegistrarPage"));
const AdminPage = page(() => import("./pages/AdminPage"));
const NotificationsPage = page(() => import("./pages/NotificationsPage"));
const SettingsPage = page(() => import("./pages/SettingsPage"));
const GraphPage = page(() => import("./pages/GraphPage"));
const LedgerPage = page(() => import("./pages/LedgerPage"));
const BlockPage = page(() => import("./pages/BlockPage"));
const TxPage = page(() => import("./pages/TxPage"));
const OntologyPage = page(() => import("./pages/OntologyPage"));

function NotFound() {
  return (
    <div className="page">
      <EmptyState title="Sayfa bulunamadı" icon="warning" action={<LinkButton to="/">Ana sayfaya dön</LinkButton>}>
        <p>Aradığınız adres mevcut değil ya da taşınmış olabilir.</p>
      </EmptyState>
    </div>
  );
}

const auth = (el: ReactNode, perm?: Parameters<typeof RequireAuth>[0]["perm"]) => <RequireAuth perm={perm}>{el}</RequireAuth>;

export default function App() {
  return (
    <HashRouter>
      <AppLayout>
        <Suspense fallback={<Spinner block label="Sayfa yükleniyor…" />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/giris" element={<LoginPage />} />
            <Route path="/kayit" element={<RegisterPage />} />
            <Route path="/konular" element={<TopicsPage />} />
            <Route path="/konular/:id" element={<TopicDetailPage />} />
            <Route path="/oneriler" element={<ProposalsPage />} />
            <Route path="/oneriler/yeni" element={auth(<NewProposalPage />)} />
            <Route path="/oneriler/:id" element={<ProposalDetailPage />} />
            <Route path="/oy-dogrula" element={<VerifyVotePage />} />
            <Route path="/bilirkisiler" element={<ExpertsPage />} />
            <Route path="/profil" element={auth(<ProfilePage />)} />
            <Route path="/uyeler/:id" element={<UserPage />} />
            <Route
              path="/kayit-memuru"
              element={
                <RequireRole roles={["registrar", "auditor"]}>
                  <RegistrarPage />
                </RequireRole>
              }
            />
            <Route
              path="/yonetim"
              element={
                <RequireRole roles={["admin", "auditor"]}>
                  <AdminPage />
                </RequireRole>
              }
            />
            <Route path="/bildirimler" element={auth(<NotificationsPage />)} />
            <Route path="/ayarlar" element={<SettingsPage />} />
            <Route path="/graf" element={<GraphPage />} />
            <Route path="/defter" element={<LedgerPage />} />
            <Route path="/defter/blok/:height" element={<BlockPage />} />
            <Route path="/defter/islem/:hash" element={<TxPage />} />
            <Route path="/yonetmelik" element={<OntologyPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </AppLayout>
    </HashRouter>
  );
}
