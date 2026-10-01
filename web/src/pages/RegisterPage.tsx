import { useState } from "react";
import { Link } from "react-router-dom";
import type { Me } from "@forum/shared";
import { useAuth } from "../auth/AuthContext";
import { RegistrationForm } from "../components/RegistrationForm";
import { Alert, Card, KeyValue, LinkButton, PageHeader, UserStatusBadge } from "../ui";

function PendingScreen({ me }: { me: Me }) {
  return (
    <div className="page page-narrow">
      <PageHeader title="Kaydınız alındı" subtitle="Kayıt memuru onayı bekleniyor." />
      <Card tone="success">
        <div className="stack">
          <Alert tone="success" title={`Hoş geldiniz, @${me.nickname}!`}>
            Hesabınız oluşturuldu ve oturumunuz açıldı. Kimliğiniz kayıt memurunca doğrulanınca öneri verebilir, destekleyebilir ve (açık rıza
            verdiyseniz) oy kullanabilirsiniz.
          </Alert>
          <KeyValue
            items={[
              { label: "Takma ad", value: `@${me.nickname}` },
              { label: "Durum", value: <UserStatusBadge status={me.status} /> },
              { label: "Siyasi görüş verisi rızası", value: me.politicalConsent ? "Verildi (oy kullanabilirsiniz)" : "Verilmedi (oy kullanamazsınız)" },
              { label: "Yapay zekâ analizi rızası", value: me.aiConsent ? "Verildi" : "Verilmedi" },
            ]}
          />
          <h2 className="h3">Sırada ne var?</h2>
          <ol className="steps">
            <li>Kayıt memuru başvurunuzu inceler; gerekirse kimlik belgenizle yüz yüze doğrulama yapar.</li>
            <li>Onaylanınca bildirim alırsınız ve hesabınız “Doğrulanmış” olur.</li>
            <li>Bu sürede konuları, önerileri ve tartışmaları okuyabilirsiniz.</li>
          </ol>
          <p className="muted small">Rızalarınızı Profil sayfasından istediğiniz zaman değiştirebilirsiniz.</p>
          <div className="row">
            <LinkButton to="/" variant="primary">
              Ana sayfaya git
            </LinkButton>
            <LinkButton to="/konular">Konulara göz at</LinkButton>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function RegisterPage() {
  const auth = useAuth();
  const [registered, setRegistered] = useState<Me | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (registered) return <PendingScreen me={auth.user ?? registered} />;

  if (auth.user && !submitting) {
    return (
      <div className="page page-narrow">
        <PageHeader title="Kayıt ol" />
        <Alert tone="info" title="Zaten oturum açtınız">
          @{auth.user.nickname} olarak oturum açık. Yeni bir hesap oluşturmak için önce çıkış yapın. Her kişi yalnızca bir hesapla katılabilir.
        </Alert>
        <div className="row mt">
          <LinkButton to="/" variant="primary">
            Ana sayfa
          </LinkButton>
          <LinkButton to="/profil">Profil</LinkButton>
        </div>
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      <PageHeader
        title="Kayıt ol"
        subtitle={
          <>
            Zaten hesabınız var mı? <Link to="/giris">Giriş yapın</Link>.
          </>
        }
      />
      <RegistrationForm
        mode="self"
        onSubmit={async (input) => {
          setSubmitting(true);
          try {
            const me = await auth.register(input);
            setRegistered(me);
            window.scrollTo(0, 0);
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </div>
  );
}
