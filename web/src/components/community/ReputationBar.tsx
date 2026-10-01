// Bilirkişi itibarı (0–1) çubuğu: değer metin olarak da yazılır.
import { formatNumber } from "../../lib/format";
import { ProgressBar } from "../../ui";

export function ReputationBar({ value, label = "İtibar" }: { value: number; label?: string }) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return (
    <div className="cm-rep">
      <ProgressBar value={v} label={label} valueText={formatNumber(v, 2)} tone={v >= 0.75 ? "success" : v >= 0.5 ? "primary" : "warning"} />
    </div>
  );
}

export default ReputationBar;
