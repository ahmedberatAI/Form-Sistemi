import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compactIri } from "@forum/shared";
import { SERVER_ROOT } from "../../src/core/config";
import { BylawModel } from "../../src/ontology/model";
import { parseTurtle } from "../../src/ontology/rdf";

const DIR = join(SERVER_ROOT, "ontology");
const model = new BylawModel(parseTurtle(readFileSync(join(DIR, "fy-schema.ttl"), "utf8")), parseTurtle(readFileSync(join(DIR, "yonetmelik.ttl"), "utf8")));
const doc = readFileSync(join(SERVER_ROOT, "..", "docs", "YONETMELIK.md"), "utf8");

describe("docs/YONETMELIK.md yönetmelikle (sürüm 1) uyumlu", () => {
  it("her maddenin numarası, metni ve koruma düzeyi belgede birebir yer alır", () => {
    const P = { Degistirilemez: "**Değiştirilemez**", Nitelikli: "Nitelikli", Olagan: "Olağan" };
    for (const a of model.sortedArticles()) {
      expect(doc, a.number).toContain(`- **${a.number}** · ${P[a.protection]} · \`${compactIri(a.iri)}\``);
      expect(doc, a.number).toContain(a.text);
    }
  });

  it("her kategori, kural ve parametre taşıyıcısı belgede anılır", () => {
    for (const c of model.categories.values()) expect(doc, c.iri).toContain(`**${c.label}** (\`${compactIri(c.iri)}\`)`);
    for (const h of model.holders.values()) expect(doc, h.iri).toContain(compactIri(h.iri));
    for (const g of model.deletionGrounds.values()) expect(doc).toContain(compactIri(g.iri));
  });
});
