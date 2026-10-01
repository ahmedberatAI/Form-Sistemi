// Rota korumaları: oturum / yetki / rol gerektiren sayfalar.
import type { ReactNode } from "react";
import type { Role } from "@forum/shared";
import { Navigate, useLocation } from "react-router-dom";
import { Alert, EmptyState, ErrorView, LinkButton, Spinner } from "../ui";
import { useAuth, type Permission } from "./AuthContext";

const PERM_TEXT: Record<Permission, string> = {
  U: "Bu sayfa için oturum açmanız gerekiyor.",
  V: "Bu işlem yalnızca kimliği kayıt memurunca doğrulanmış üyelere açıktır.",
  VV: "Bu işlem yalnızca oy kullanabilen üyelere açıktır (doğrulanmış, 18 yaşından büyük ve siyasi görüş verisi için açık rıza vermiş).",
  R: "Bu sayfa yalnızca kayıt memurlarına açıktır.",
  D: "Bu sayfa yalnızca denetçilere açıktır.",
  A: "Bu sayfa yalnızca yöneticilere açıktır.",
  E: "Bu sayfa yalnızca etkin bilirkişilere açıktır.",
};

function Forbidden({ message }: { message: string }) {
  return (
    <div className="page">
      <EmptyState title="Erişim yetkiniz yok" icon="warning" action={<LinkButton to="/">Ana sayfaya dön</LinkButton>}>
        <p>{message}</p>
      </EmptyState>
    </div>
  );
}

/**
 * Oturum ister; giriş yoksa /giris'e yönlendirir (dönüş adresi state.from'da).
 * perm verilirse (ör. "V") yetkisi olmayan kullanıcıya açıklama gösterir.
 */
export function RequireAuth({ children, perm }: { children: ReactNode; perm?: Permission }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading) return <Spinner block label="Oturum yükleniyor…" />;
  if (!auth.user) {
    if (auth.token && auth.connectionError) {
      return (
        <div className="page">
          <ErrorView error={auth.connectionError} onRetry={() => void auth.refresh().catch(() => undefined)} />
        </div>
      );
    }
    return <Navigate to="/giris" replace state={{ from: location.pathname + location.search }} />;
  }
  if (perm && !auth.can(perm)) {
    if (perm === "V" || perm === "VV") {
      return (
        <div className="page">
          <Alert tone="warning" title="Bu işlem için doğrulanmış üyelik gerekiyor">
            {PERM_TEXT[perm]}
            {auth.user.status === "pending" ? " Hesabınız kayıt memuru onayını bekliyor." : null}
          </Alert>
        </div>
      );
    }
    return <Forbidden message={PERM_TEXT[perm]} />;
  }
  return <>{children}</>;
}

/** Rollerden en az birini ister (yönetici her zaman geçer). */
export function RequireRole({ children, roles }: { children: ReactNode; roles: Role[] }) {
  const auth = useAuth();
  return (
    <RequireAuth>
      {auth.isAdmin || roles.some((r) => auth.hasRole(r)) ? children : <Forbidden message={`Bu sayfa yalnızca şu rollere açıktır: ${roles.map(roleName).join(", ")}.`} />}
    </RequireAuth>
  );
}

function roleName(r: Role): string {
  return { member: "üye", registrar: "kayıt memuru", auditor: "denetçi", admin: "yönetici" }[r];
}
