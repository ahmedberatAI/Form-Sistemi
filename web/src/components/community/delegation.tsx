// Vekâlet bileşenleri: kapsam seçimi, üye arama, yeni vekâlet formu ve verdiğim vekâletler tablosu.
// Vekâlet "kimin tercihinin uygulanacağını" belirler; kimse 1'den fazla sayılmaz (ALGORITMA §5).
import { useEffect, useId, useState, type FormEvent } from "react";
import type { DelegationView, PublicUser } from "@forum/shared";
import { ApiError, errorMessage } from "../../api/client";
import { delegate, listUsers, revokeDelegation } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { useOntology } from "../../lib/categories";
import { useDebounced } from "../../lib/hooks";
import { Alert, Button, Icon, RadioGroup, Select, Spinner, Table, Time, useConfirm, useToast, UserStatusBadge } from "../../ui";
import { UserLink } from "../UserLink";
import "./community.css";

export const GENERAL_SCOPE = "*";

/** Kapsam metni: "*" → "Genel (tüm konular)", kategori → "Çevre › Enerji" */
export function useScopeLabel(): (scope: string) => string {
  const { categoryPath } = useOntology();
  return (scope) => (scope === GENERAL_SCOPE ? "Genel (tüm konular)" : categoryPath(scope));
}

export function ScopeSelect({ value, onChange, label = "Kapsam", hint }: { value: string; onChange: (v: string) => void; label?: string; hint?: string }) {
  const { flat, loading } = useOntology();
  const options = [
    { value: GENERAL_SCOPE, label: "Genel (tüm konular) — *" },
    ...flat.map((c) => ({ value: c.iri, label: `${"  ".repeat(c.depth)}${c.depth ? "› " : ""}${c.label}` })),
  ];
  return (
    <Select
      label={label}
      hint={hint ?? (loading ? "Kategoriler yükleniyor…" : "Kategori kapsamlı vekâlet, o kategorideki (ve alt kategorilerindeki) önerilerde genel vekâletten önce uygulanır.")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={options}
    />
  );
}

/** Takma adla üye arama (yalnızca takma ad gösterilir). */
export function UserSearch({
  label = "Üye ara",
  selected,
  onSelect,
  excludeIds = [],
  onlyVerified = true,
}: {
  label?: string;
  selected: PublicUser | null;
  onSelect: (u: PublicUser | null) => void;
  excludeIds?: string[];
  onlyVerified?: boolean;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 300);
  const [results, setResults] = useState<PublicUser[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dq) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    listUsers({ q: dq, limit: 10 })
      .then((r) => {
        if (!cancelled) setResults(r.filter((u) => !excludeIds.includes(u.id)));
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq, excludeIds.join(",")]);

  if (selected) {
    return (
      <div className="field">
        <span className="field-label">{label}</span>
        <div className="cm-selected-user">
          <UserLink user={selected} />
          <Button size="sm" variant="ghost" icon="close" onClick={() => onSelect(null)}>
            Değiştir
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="cat-search">
        <Icon name="search" size={16} />
        <input
          id={id}
          className="input"
          type="search"
          placeholder="Takma ad yazın…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          aria-describedby={id + "-h"}
        />
      </div>
      <div className="field-hint" id={id + "-h"}>
        Yalnızca takma adlar aranır; kimlik bilgisi hiçbir zaman gösterilmez.
      </div>
      {loading ? <Spinner label="Aranıyor…" /> : null}
      {error ? <div className="field-error">{error}</div> : null}
      {results && !loading ? (
        results.length ? (
          <ul className="cm-user-results" aria-label="Arama sonuçları">
            {results.map((u) => {
              const disabled = onlyVerified && u.status !== "verified";
              return (
                <li key={u.id}>
                  <button type="button" className="cm-user-result" disabled={disabled} onClick={() => onSelect(u)} aria-pressed={false}>
                    <span className="truncate">@{u.nickname}</span>
                    {u.status !== "verified" ? <UserStatusBadge status={u.status} /> : u.isExpert ? <span className="muted small">bilirkişi</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted small">“{dq}” ile eşleşen üye bulunamadı.</p>
        )
      ) : null}
    </div>
  );
}

const RANK_OPTIONS = [
  { value: "1", label: "1. sıra", hint: "Öncelikli delege" },
  { value: "2", label: "2. sıra", hint: "1. sıradaki oy vermezse" },
  { value: "3", label: "3. sıra", hint: "1. ve 2. sıradakiler oy vermezse" },
] as const;

/** Yeni vekâlet formu. target verilirse delege sabittir (üye sayfası). */
export function DelegationForm({
  target,
  onCreated,
  submitLabel = "Vekâlet ver",
}: {
  target?: { id: string; nickname: string } | null;
  onCreated?: (d: DelegationView) => void;
  submitLabel?: string;
}) {
  const auth = useAuth();
  const toast = useToast();
  const scopeLabel = useScopeLabel();
  const [to, setTo] = useState<PublicUser | null>(null);
  const [scope, setScope] = useState<string>(GENERAL_SCOPE);
  const [rank, setRank] = useState<"1" | "2" | "3">("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const toId = target?.id ?? to?.id ?? null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!toId) {
      setError(new Error("Vekâlet vereceğiniz üyeyi seçin."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const d = await delegate({ to: toId, scope, rank: Number(rank) });
      toast.success(`@${d.toNickname} için vekâlet verildi (${scopeLabel(d.scope)}, ${d.rank}. sıra).`);
      if (!target) setTo(null);
      onCreated?.(d);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(errorMessage(err)));
    } finally {
      setBusy(false);
    }
  };

  if (!auth.can("V")) {
    return (
      <Alert tone="info" title="Vekâlet vermek için doğrulanmış üyelik gerekir">
        Kimliğiniz kayıt memurunca doğrulandıktan sonra vekâlet verebilirsiniz.
      </Alert>
    );
  }

  const isCycle = error instanceof ApiError && error.code === "delegation_cycle";

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {target ? null : <UserSearch label="Delege" selected={to} onSelect={setTo} excludeIds={auth.user ? [auth.user.id] : []} />}
      <div className="form-grid">
        <ScopeSelect value={scope} onChange={setScope} />
        <RadioGroup label="Sıra" value={rank} onChange={setRank} options={RANK_OPTIONS.map((o) => ({ ...o }))} layout="inline" />
      </div>
      <p className="small muted">
        Aynı kapsam ve sırada var olan vekâletiniz bu yenisiyle değiştirilir. Vekâlet zinciri en fazla 3 adım izlenir; doğrudan oy verirseniz vekâletiniz
        o oylamada askıya alınır.
      </p>
      {error ? (
        <Alert tone="error" title={isCycle ? "Vekâlet döngüsü" : "Vekâlet verilemedi"} onClose={() => setError(null)}>
          {error.message}
          {isCycle ? " Vekâlet zincirleri döngü oluşturamaz (ör. A → B → A); başka bir delege seçin." : null}
        </Alert>
      ) : null}
      <div className="form-actions">
        <Button type="submit" variant="primary" loading={busy} disabled={!toId}>
          {target ? `@${target.nickname} için ${submitLabel.toLocaleLowerCase("tr-TR")}` : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Verdiğim vekâletler (geri alma düğmeli). */
export function OutgoingDelegations({
  items,
  onRevoked,
  showDelegate = true,
  caption = "Verdiğim vekâletler",
}: {
  items: DelegationView[];
  onRevoked: (id: string) => void;
  showDelegate?: boolean;
  caption?: string;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const scopeLabel = useScopeLabel();
  const [busyId, setBusyId] = useState<string | null>(null);

  const revoke = async (d: DelegationView) => {
    const ok = await confirm({
      title: "Vekâleti geri al",
      message: `@${d.toNickname} için verdiğiniz “${scopeLabel(d.scope)}” kapsamlı ${d.rank}. sıra vekâlet geri alınacak. Kayıt silinmez; geri alındı olarak işaretlenir.`,
      confirmLabel: "Geri al",
      tone: "danger",
    });
    if (!ok) return;
    setBusyId(d.id);
    try {
      await revokeDelegation(d.id);
      toast.success("Vekâlet geri alındı.");
      onRevoked(d.id);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusyId(null);
    }
  };

  const sorted = [...items].sort((a, b) => (a.scope === b.scope ? a.rank - b.rank : a.scope === GENERAL_SCOPE ? 1 : b.scope === GENERAL_SCOPE ? -1 : a.scope.localeCompare(b.scope)));

  return (
    <Table
      caption={caption}
      rows={sorted}
      rowKey={(d) => d.id}
      columns={[
        ...(showDelegate ? [{ key: "to", header: "Delege", render: (d: DelegationView) => <span className="nowrap"><UserLink id={d.to} nickname={d.toNickname} /></span> }] : []),
        { key: "scope", header: "Kapsam", render: (d) => scopeLabel(d.scope) },
        { key: "rank", header: "Sıra", align: "center", className: "nowrap", render: (d) => `${d.rank}.` },
        { key: "at", header: "Verildi", hideOnMobile: true, render: (d) => <Time at={d.createdAt} /> },
        {
          key: "act",
          header: "İşlem",
          align: "right",
          render: (d) => (
            <Button size="sm" variant="ghost" className="nowrap" loading={busyId === d.id} onClick={() => void revoke(d)}>
              Geri al
            </Button>
          ),
        },
      ]}
    />
  );
}
