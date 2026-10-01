// Kategori (uzmanlık alanı) etiketleri: ontolojiden Türkçe ad, kökten yol title'da.
import { useOntology } from "../../lib/categories";

export function DomainChips({ domains, empty = "—" }: { domains: string[]; empty?: string }) {
  const { categoryLabel, categoryPath } = useOntology();
  if (!domains.length) return <span className="muted">{empty}</span>;
  return (
    <span className="chips">
      {domains.map((d) => (
        <span className="chip" key={d} title={categoryPath(d)}>
          {categoryLabel(d)}
        </span>
      ))}
    </span>
  );
}

export default DomainChips;
