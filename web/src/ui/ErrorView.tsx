// Hata gösterimi: ApiError (status, code, message, details) okunur biçimde; tekrar dene düğmesi.
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ApiError, errorMessage } from "../api/client";
import { Alert, Button } from "./basic";

const CODE_TITLES: Record<string, string> = {
  network: "Bağlantı hatası",
  timeout: "Zaman aşımı",
  unreachable: "Sunucuya ulaşılamıyor",
  unauthorized: "Oturum gerekli",
  forbidden: "Yetki yok",
  not_found: "Bulunamadı",
  validation: "Geçersiz bilgi",
  rate_limited: "Çok fazla istek",
  login_locked: "Giriş geçici olarak durduruldu",
  not_verified: "Kimlik doğrulaması gerekiyor",
  idempotency_in_progress: "İşlem sürüyor",
  pii_detected: "Kişisel veri tespit edildi",
  invalid_state: "İşlem bu aşamada yapılamaz",
  version_conflict: "Sürüm çakışması",
  not_eligible: "Uygun değilsiniz",
};

/** details içinden insan okunur satırlar çıkarır (zod issues, { field: msg } nesneleri, metin dizileri). */
export function describeDetails(details: unknown): string[] {
  if (details == null) return [];
  if (typeof details === "string") return [details];
  if (Array.isArray(details)) {
    return details
      .map((d) => {
        if (typeof d === "string") return d;
        if (d && typeof d === "object") {
          const o = d as { path?: unknown; message?: unknown; field?: unknown };
          const path = Array.isArray(o.path) ? o.path.join(".") : typeof o.field === "string" ? o.field : "";
          const msg = typeof o.message === "string" ? o.message : "";
          return [path, msg].filter(Boolean).join(": ");
        }
        return "";
      })
      .filter(Boolean)
      .slice(0, 10);
  }
  if (typeof details === "object") {
    const o = details as Record<string, unknown>;
    if (Array.isArray(o.issues)) return describeDetails(o.issues);
    if (Array.isArray(o.reasons)) return describeDetails(o.reasons);
    return Object.entries(o)
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .map(([k, v]) => `${k}: ${String(v)}`)
      .slice(0, 10);
  }
  return [];
}

export interface ErrorViewProps {
  error: unknown;
  title?: ReactNode;
  onRetry?: () => void;
  /** Ayrıntı satırlarını gösterme */
  compact?: boolean;
}

export function ErrorView({ error, title, onRetry, compact }: ErrorViewProps) {
  const api = error instanceof ApiError ? error : null;
  const heading = title ?? (api ? CODE_TITLES[api.code] ?? "İşlem başarısız" : "Bir hata oluştu");
  const lines = !compact && api ? describeDetails(api.details) : [];
  const isNetwork = api && (api.isNetwork || api.code === "unreachable" || api.code === "bad_response");
  const location = useLocation();
  const needsLogin = api?.status === 401 && api.code === "unauthorized" && location.pathname !== "/giris";
  return (
    <Alert
      tone="error"
      title={heading}
      actions={
        onRetry || isNetwork || needsLogin ? (
          <>
            {onRetry ? (
              <Button size="sm" icon="refresh" onClick={onRetry}>
                Tekrar dene
              </Button>
            ) : null}
            {isNetwork ? (
              <Link className="btn btn-ghost btn-sm" to="/ayarlar">
                Sunucu ayarları
              </Link>
            ) : null}
            {needsLogin ? (
              <Link className="btn btn-primary btn-sm" to="/giris" state={{ from: location.pathname + location.search }}>
                Giriş yap
              </Link>
            ) : null}
          </>
        ) : undefined
      }
    >
      <p>{errorMessage(error)}</p>
      {lines.length ? (
        <ul className="error-details">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : null}
      {api && !compact && api.status > 0 ? (
        <p className="error-code">
          Kod: <code>{api.code}</code> · HTTP {api.status}
        </p>
      ) : null}
    </Alert>
  );
}
