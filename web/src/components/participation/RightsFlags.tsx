// Hak etkisi bayrakları ("yalnızca yükseltme", ALGORITMA §12.11): herkes ekleyebilir, yalnızca ilgili alandaki
// bilirkişi ya da yönetici kaldırabilir. Bayrak katmanı en fazla T1'e yükseltir ve bilirkişiyi zorunlu kılar; öneriyi geçersiz kılamaz.
import { useState } from "react";
import type { ProposalDetail } from "@forum/shared";
import { flagRight } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { useOntology } from "../../lib/categories";
import { useAction } from "../../lib/useAsync";
import { Badge, Button, RadioGroup, Select } from "../../ui";
import { SubHeading } from "./common";

export function RightsFlags({ proposal: p, onUpdated, showHeading = true }: { proposal: ProposalDetail; onUpdated: (p: ProposalDetail) => void; showHeading?: boolean }) {
  const auth = useAuth();
  const { ontology, rightLabel } = useOntology();
  const [right, setRight] = useState("");
  const [direction, setDirection] = useState<"restrict" | "expand">("restrict");
  const [open, setOpen] = useState(false);
  const affected = p.audit?.rightsAffected ?? [];
  const editable = p.status === "sponsoring" || p.status === "deliberation";
  const canRemove = editable && (auth.isExpert || auth.isAdmin);

  const add = useAction(() => flagRight(p.id, { right, direction }), {
    success: "Hak etkisi bayrağı eklendi; denetim yeniden hesaplandı.",
    onSuccess: (d) => {
      setOpen(false);
      setRight("");
      onUpdated(d);
    },
  });
  const remove = useAction((iri: string) => flagRight(p.id, { right: iri, direction: "restrict", remove: true }), {
    success: "Bayrak kaldırıldı; denetim yeniden hesaplandı.",
    onSuccess: onUpdated,
  });

  return (
    <div className="stack-sm">
      {showHeading ? <SubHeading>Hak etkisi</SubHeading> : null}
      {affected.length ? (
        <ul className="chips plain-list" aria-label="Etkilenen temel haklar">
          {affected.map((r) => (
            <li key={r} className="row">
              <Badge tone="warning" icon="warning">
                {rightLabel(r)}
              </Badge>
              {canRemove ? (
                <Button size="sm" variant="ghost" loading={remove.loading} onClick={() => void remove.run(r)}>
                  Kaldır
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">Bu öneri için bir temel hak kısıtlaması işaretlenmedi.</p>
      )}
      {editable && auth.can("V") ? (
        open ? (
          <form
            className="stack-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void add.run();
            }}
          >
            <Select
              label="Etkilenen temel hak"
              placeholder="Seçin…"
              required
              value={right}
              onChange={(e) => setRight(e.target.value)}
              options={(ontology?.rights ?? []).map((r) => ({ value: r.iri, label: r.label }))}
              hint={(ontology?.rights ?? []).find((r) => r.iri === right)?.description}
            />
            <RadioGroup<"restrict" | "expand">
              label="Etki yönü"
              layout="inline"
              value={direction}
              onChange={setDirection}
              options={[
                { value: "restrict", label: "Kısıtlıyor" },
                { value: "expand", label: "Genişletiyor" },
              ]}
            />
            <p className="small muted">
              Yalnızca yükseltme: bayrak kararı en fazla T1 (nitelikli) katmanına yükseltir, uyarı üretir ve bilirkişi görüşünü zorunlu kılar; öneriyi geçersiz (T3)
              yapamaz. Bayrağı yalnızca ilgili alandaki bilirkişi ya da yönetici kaldırabilir.
            </p>
            <div className="form-actions">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Vazgeç
              </Button>
              <Button type="submit" variant="primary" loading={add.loading} disabled={!right}>
                Bayrağı ekle
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button size="sm" icon="warning" onClick={() => setOpen(true)}>
              Hak etkisi bayrağı ekle
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}
