import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Alert, Button, Card, ErrorView, Input, PageHeader } from "../ui";

export default function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ login?: string; password?: string }>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (auth.user && !busy) return <Navigate to={from && from !== "/giris" ? from : "/"} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!login.trim()) errs.login = "Takma adınızı ya da e-posta adresinizi girin.";
    if (!password) errs.password = "Şifrenizi girin.";
    setErrors(errs);
    if (errs.login || errs.password) return;
    setBusy(true);
    setError(null);
    try {
      await auth.login({ login: login.trim(), password });
      navigate(from && from !== "/giris" ? from : "/", { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <div className="page page-narrow">
      <PageHeader title="Giriş yap" subtitle="Forum Sistemi hesabınızla oturum açın." />
      {from ? (
        <Alert tone="info">
          Devam etmek için oturum açmanız gerekiyor.
        </Alert>
      ) : null}
      <Card>
        <form className="stack" onSubmit={submit} noValidate>
          <Input
            label="Takma ad ya da e-posta"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            error={errors.login}
            required
            autoFocus
          />
          <Input
            label="Şifre"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            required
          />
          {error ? <ErrorView error={error} title={error instanceof ApiError && error.code === "login_locked" ? "Giriş geçici olarak durduruldu" : "Giriş yapılamadı"} compact /> : null}
          <Button type="submit" variant="primary" block loading={busy}>
            Giriş yap
          </Button>
        </form>
      </Card>
      <div className="stack mt">
        <p>
          Hesabınız yok mu? <Link to="/kayit">Kayıt olun</Link>. Kayıttan sonra kimliğiniz kayıt memurunca doğrulanır.
        </p>
        <p className="muted small">
          Sunucuya bağlanamıyorsanız <Link to="/ayarlar">Ayarlar</Link> sayfasından sunucu adresini kontrol edin.
        </p>
      </div>
    </div>
  );
}
