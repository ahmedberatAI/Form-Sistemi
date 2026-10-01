// Hak etkisi bayrakları ("yalnızca yükseltme", ALGORITMA §12.11): herkes ekleyebilir, yalnızca ilgili alandaki
// bilirkişi ya da yönetici kaldırabilir. Bayrak katmanı en fazla T1'e yükseltir ve bilirkişiyi zorunlu kılar; öneriyi geçersiz kılamaz.
// Bayraklar (hak, yön) çiftine göre gruplanır; kaldırma bayrağın KENDİ yönüyle yapılır ("genişletiyor" bayrağı "kısıtlıyor" diye silinmez).
import { useState } from "react";
import type { ProposalDetail, ProposalRightsFlag, RightsFlagSource } from "@forum/shared";
import { flagRight } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { useOntology } from "../../lib/categories";
import { useAction } from "../../lib/useAsync";
import { Badge, Button, RadioGroup, Select } from "../../ui";
import { SubHeading } from "./common";

type Direction = ProposalRightsFlag["direction"];

const DIRECTION_LABELS: Record<Direction, string> = { restrict: "Kısıtlıyor", expand: "Genişletiyor" };
const SOURCE_LABELS: Record<RightsFlagSource, string> = { author: "yazar", expert: "bilirkişi", member: "üye", ai: "yapay zekâ (danışma)" };
const SOURCE_ORDER: RightsFlagSource[] = ["author", "expert", "member", "ai"];

export interface RightsFlagGroup {
  right: string;
  direction: Direction;
  sources: RightsFlagSource[];
}

/** (hak, yön) çiftine göre gruplar; ilk görülme sırası korunur, kaynaklar sabit sırada. */
export function groupRightsFlags(flags: readonly ProposalRightsFlag[]): RightsFlagGroup[] {
  const out: RightsFlagGroup[] = [];
  for (const f of flags) {
    let g = out.find((x) => x.right === f.right && x.direction === f.direction);
    if (!g) out.push((g = { right: f.right, direction: f.direction, sources: [] }));
    if (!g.sources.includes(f.source)) g.sources.push(f.source);
  }
  for (const g of out) g.sources.sort((a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b));
  return out;
}

export function RightsFlags({ proposal: p, onUpdated, showHeading = true }: { proposal: ProposalDetail; onUpdated: (p: ProposalDetail) => void; showHeading?: boolean }) {
  const auth = useAuth();
  const { ontology, rightLabel } = useOntology();
  const [right, setRight] = useState("");
  const [direction, setDirection] = useState<"restrict" | "expand">("restrict");
  const [open, setOpen] = useState(false);
  // Eski sunucu `rightsFlags` göndermezse denetim raporundaki hak listesine (yön/kaynak bilinmeden) düşülür.
  const groups = p.rightsFlags
    ? groupRightsFlags(p.rightsFlags)
    : (p.audit?.rightsAffected ?? []).map((r): RightsFlagGroup => ({ right: r, direction: "restrict", sources: [] }));
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
  const remove = useAction((g: RightsFlagGroup) => flagRight(p.id, { right: g.right, direction: g.direction, remove: true }), {
    success: "Bayrak kaldırıldı; denetim yeniden hesaplandı.",
    onSuccess: onUpdated,
  });

  return (
    <div className="stack-sm">
      {showHeading ? <SubHeading>Hak etkisi</SubHeading> : null}
      {groups.length ? (
        <ul className="plain-list stack-sm" aria-label="Hak etkisi bayrakları">
          {groups.map((g) => (
            <li key={`${g.right}|${g.direction}`} className="row">
              <Badge tone={g.direction === "restrict" ? "warning" : "info"} icon={g.direction === "restrict" ? "warning" : "info"}>
                {rightLabel(g.right)}
              </Badge>
              <span className="small">{DIRECTION_LABELS[g.direction]}</span>
              {g.sources.length ? (
                <span className="small muted">
                  İşaretleyen:{" "}
                  {g.sources.map((s, i) => (
                    <span key={s} {...(s === "ai" ? { "data-ai-generated": "true", title: "Yapay zekâ ile üretildi · danışma niteliğindedir" } : {})}>
                      {i ? ", " : ""}
                      {SOURCE_LABELS[s]}
                    </span>
                  ))}
                </span>
              ) : null}
              {canRemove ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={remove.loading}
                  aria-label={`${rightLabel(g.right)} (${DIRECTION_LABELS[g.direction].toLocaleLowerCase("tr-TR")}) bayrağını kaldır`}
                  onClick={() => void remove.run(g)}
                >
                  Kaldır
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">Bu öneri için bir hak etkisi bayrağı işaretlenmedi.</p>
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
