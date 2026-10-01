// Sürüm geçmişi + iki sürüm arasında fark görünümü (öneri sürümleri ve konu revizyonları için ortak).
import { useEffect, useState, type ReactNode } from "react";
import { DiffView, HashText, RadioGroup, Select, Time } from "../../ui";

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
}

export function VersionHistory({ versions, current, label = "Metin" }: VersionHistoryProps) {
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
      ) : (
        <p className="small muted">Henüz tek sürüm var; düzenlendikçe farklar burada görünür.</p>
      )}
    </div>
  );
}
