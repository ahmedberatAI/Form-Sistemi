// Sürüm geçmişi + iki sürüm arasında fark görünümü (öneri sürümleri ve konu revizyonları için ortak).
// Sürüm listesi hep görünür; fark görünümü "Sürümleri karşılaştır" açılırındadır (diffDefaultOpen ile açık başlatılabilir).
import { useEffect, useState, type ReactNode } from "react";
import { DiffView, Details, HashText, RadioGroup, Select, Time } from "../../ui";
import "./participation.css";

export interface VersionEntry {
  version: number;
  title: string;
  body: string;
  createdAt: number;
  contentHash: string;
  /** Sürümü kim/ne üretti (ör. yazar, kabul edilen öneri, karar) */
  note?: ReactNode;
}

export interface VersionHistoryProps {
  versions: VersionEntry[];
  current: number;
  /** Bölüm/erişilebilir ad öneki: "Öneri", "Konu" */
  label?: string;
  /**
   * Fark görünümü ("Sürümleri karşılaştır") ilk çizimde açık mı? Varsayılan false: kapalı başlar, 1 dokunuşla açılır.
   * false iken 'Tam' görünümde yine açık gelir (Details'in genel kuralı).
   */
  diffDefaultOpen?: boolean;
}

const dayMonth = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });
const dayMonthYear = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric" });

/**
 * Kart başlığının yanındaki hüküm: "2 sürüm · son değişiklik 10 Eyl" (tek sürümde "1 sürüm · değişiklik yok").
 * `now` (sunucu saati) verilirse ve son sürüm başka bir yıldaysa yıl da yazılır.
 */
export function versionHistorySummary(versions: Pick<VersionEntry, "createdAt">[], now?: number): string {
  const n = versions.length;
  if (!n) return "Sürüm kaydı yok";
  if (n === 1) return "1 sürüm · değişiklik yok";
  const last = Math.max(...versions.map((v) => v.createdAt));
  const otherYear = now !== undefined && new Date(last).getFullYear() !== new Date(now).getFullYear();
  return `${n} sürüm · son değişiklik ${(otherYear ? dayMonthYear : dayMonth).format(last)}`;
}

export function VersionHistory({ versions, current, label = "Metin", diffDefaultOpen = false }: VersionHistoryProps) {
  const sorted = versions.slice().sort((a, b) => a.version - b.version);
  const latest = sorted[sorted.length - 1]?.version ?? current;
  const [from, setFrom] = useState<number>(sorted.length > 1 ? sorted[sorted.length - 2].version : latest);
  const [to, setTo] = useState<number>(latest);
  const [mode, setMode] = useState<"lines" | "inline">("lines");

  useEffect(() => {
    setTo(latest);
    setFrom(sorted.length > 1 ? sorted[sorted.length - 2].version : latest);
    // yalnızca yeni sürüm gelince sıfırla
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest]);

  if (!sorted.length) return <p className="muted small">Sürüm kaydı yok.</p>;

  const a = sorted.find((v) => v.version === from);
  const b = sorted.find((v) => v.version === to);
  const options = sorted.map((v) => ({ value: String(v.version), label: `Sürüm ${v.version}${v.version === current ? " (güncel)" : ""}` }));

  return (
    <div className="stack">
      <ol className="version-list">
        {sorted
          .slice()
          .reverse()
          .map((v) => (
            <li key={v.version} className={v.version === current ? "version-item is-current" : "version-item"}>
              <div className="row-between">
                <strong>
                  Sürüm {v.version}
                  {v.version === current ? <span className="muted small"> · güncel</span> : null}
                </strong>
                <Time at={v.createdAt} mode="both" className="small muted" />
              </div>
              <div className="small">{v.title}</div>
              {v.note ? <div className="small muted">{v.note}</div> : null}
              <div className="small muted">
                Özet <HashText hash={v.contentHash} chars={8} copy={false} label="İçerik özeti" />
              </div>
            </li>
          ))}
      </ol>

      {sorted.length > 1 ? (
        // open yalnız true iken verilir: undefined → 'Tam' görünümde açık, 'sade'de kapalı.
        <Details summary="Sürümleri karşılaştır" open={diffDefaultOpen ? true : undefined} className="version-compare">
          <div className="stack-sm">
            <div className="form-grid">
              <Select label="Eski sürüm" value={String(from)} onChange={(e) => setFrom(Number(e.target.value))} options={options} />
              <Select label="Yeni sürüm" value={String(to)} onChange={(e) => setTo(Number(e.target.value))} options={options} />
            </div>
            <RadioGroup<"lines" | "inline">
              label="Fark görünümü"
              layout="inline"
              value={mode}
              onChange={setMode}
              options={[
                { value: "lines", label: "Satır satır" },
                { value: "inline", label: "Tek akış" },
              ]}
            />
            {a && b ? (
              <>
                {a.title !== b.title ? (
                  <div className="small">
                    <strong>Başlık:</strong> <DiffView before={a.title} after={b.title} mode="inline" label="Başlık farkı" />
                  </div>
                ) : null}
                <DiffView before={a.body} after={b.body} mode={mode} context={mode === "lines" ? 2 : undefined} label={`${label}: sürüm ${a.version} → ${b.version} farkı`} />
              </>
            ) : null}
          </div>
        </Details>
      ) : (
        <p className="small muted">Henüz tek sürüm var; düzenlendikçe farklar burada görünür.</p>
      )}
    </div>
  );
}
