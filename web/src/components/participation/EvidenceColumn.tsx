// "Kanıtlar ve denetim" sütunu (id="kanitlar"): masaüstünde ana akışın sağında, telefonda tartışmadan SONRA. İçindeki
// denetim kartları Faz 1'de katlanabilir oldu (kapalıyken başlığın yanında tek satırlık hüküm); bu sütun onları sıralar ve
// başlıktaki tek düğmeyle hepsini açar ya da katlar ("Tümünü aç" / "Tümünü katla" — 'Kapat' sözcüğü bilinçli olarak
// kullanılmaz: e2e'deki /Kapat/ seçicileriyle çakışmasın). Düğme etiketi kartların gerçek durumunu izler (kullanıcı tek tek
// açıp kapatsa da doğru kalır). Kart gövdeleri her durumda DOM'da kalır.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useDetailLevel } from "../../lib/detailLevel";
import { Button, setSectionsOpen } from "../../ui";
import "./proposal-page.css";

/** Sütundaki kartların çapaları (aynı zamanda kart id'leri). */
export type EvidenceKey = "butunluk" | "ontoloji" | "destekciler" | "evreler" | "parametreler" | "surumler" | "defter";

/**
 * Kartların sırası. 'Uyarı yalnız gerektiğinde bağırır': bütünlük uyarısı varsa en üstte (açık gelir); yönetmeliğe aykırılık
 * ya da ihlal varsa ontoloji denetimi Destekçiler'in önüne çıkar (açık ve kırmızı gelir). Olağan sıra: Destekçiler (hep açık) ·
 * zaman çizelgesi · ontoloji denetimi · karar parametreleri · sürüm geçmişi · defter kayıtları.
 */
export function evidenceOrder(o: { integrity: boolean; auditProblem: boolean }): EvidenceKey[] {
  const keys: EvidenceKey[] = [];
  if (o.integrity) keys.push("butunluk");
  if (o.auditProblem) keys.push("ontoloji");
  keys.push("destekciler", "evreler");
  if (!o.auditProblem) keys.push("ontoloji");
  keys.push("parametreler", "surumler", "defter");
  return keys;
}

const COLLAPSIBLE = ".card-collapsible";

/** Kökteki katlanabilir kartların hepsi açık mı? Hiç katlanabilir kart yoksa null. */
export function allSectionsOpen(root: ParentNode): boolean | null {
  if (!root.querySelector(COLLAPSIBLE)) return null;
  return !root.querySelector(`${COLLAPSIBLE}:not(.is-open)`);
}

/** "Tümünü aç" / "Tümünü katla" düğmesinin etiketi. */
export function toggleAllLabel(allOpen: boolean): string {
  return allOpen ? "Tümünü katla" : "Tümünü aç";
}

export interface EvidenceColumnProps {
  children: ReactNode;
  id?: string;
  title?: string;
}

export function EvidenceColumn({ children, id = "kanitlar", title = "Kanıtlar ve denetim" }: EvidenceColumnProps) {
  const hid = useId();
  const ref = useRef<HTMLElement>(null);
  const { full } = useDetailLevel();
  // İlk çizimde ölçüm yok: 'Tam' görünümde kartlar açık, 'Sade'de en az biri kapalı gelir. Sonra gerçek durum izlenir.
  const [allOpen, setAllOpen] = useState<boolean | null>(full);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setAllOpen(allSectionsOpen(el));
    measure();
    if (typeof MutationObserver === "undefined") return;
    // Kart açılıp kapanınca sınıfı (.is-open) değişir; kart eklenip kalkınca (ör. bütünlük uyarısı gelince) alt ağaç değişir.
    const mo = new MutationObserver(measure);
    mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  return (
    <aside className="stack evidence" id={id} aria-labelledby={hid} ref={ref}>
      <div className="evidence-head">
        <h2 className="evidence-title" id={hid}>
          {title}
        </h2>
        {allOpen !== null ? (
          <Button
            size="sm"
            variant="ghost"
            className="evidence-toggle"
            onClick={() => {
              if (ref.current) setSectionsOpen(ref.current, !allOpen);
            }}
          >
            {toggleAllLabel(allOpen)}
          </Button>
        ) : null}
      </div>
      {children}
    </aside>
  );
}
