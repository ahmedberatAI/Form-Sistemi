// Rozet bütçesi bileşen düzeyinde (src/README.md › Görsel dil): nesne (kart, satır, hüküm) başına en çok 1 renkli durum rozeti.
// Sunucu tarafı çizimle denetlenir (DOM gerekmez). Rozet tonlarının kendisi ve tema kontrastı ui/visualLanguage.test.tsx'tedir
// (ui katmanı bileşenleri içe aktaramaz: server/test/architecture).
import { renderToStaticMarkup } from "react-dom/server";
import type { ObjectionEvaluation } from "@forum/shared";
import { describe, expect, it } from "vitest";
import { ObjectionVerdict } from "./participation/ObjectionPanel";
import { TxTypeBadge, TxTypeBadges, txTypeTone } from "./system/marks";

const toneOf = (html: string): string[] => [...html.matchAll(/class="badge badge-([a-z]+)/g)].map((m) => m[1]);

describe("rozet bütçesi: nesne başına en çok 1 renkli rozet", () => {
  const colored = (html: string) => toneOf(html).filter((t) => t !== "neutral");

  it("itiraz hükmü: geçerli ve güçlü itirazda da tek renkli rozet geçerlilik hükmüdür; kural ve 'Güçlü itiraz' gri", () => {
    const ev = (over: Partial<ObjectionEvaluation>) =>
      ({ valid: true, rule: "cluster", strong: true, signers: 7, explanation: "Açıklama.", perCluster: [], crossClusterRequired: 5, ...over }) as ObjectionEvaluation;
    for (const e of [ev({}), ev({ rule: "cross_cluster" }), ev({ valid: false, rule: null, strong: false })]) {
      const html = renderToStaticMarkup(<ObjectionVerdict evaluation={e} />);
      expect(colored(html).length, JSON.stringify(e)).toBeLessThanOrEqual(1);
    }
    const strong = renderToStaticMarkup(<ObjectionVerdict evaluation={ev({})} />);
    expect(colored(strong)).toEqual(["warning"]);
    // e2e 04'ün aradığı metinler aynen
    expect(strong).toContain("İtiraz geçerli — uzlaşma turu");
    expect(strong).toContain("Küme kuralı (a)");
    expect(strong).toContain("Güçlü itiraz");
  });

  it("defter işlem türü bir sınıflandırmadır: rozet gri; yalnız hatalı doğrulayıcı kanıtı (EVIDENCE) kırmızı ve simgeli", () => {
    for (const t of ["VOTE_COMMIT", "BALLOT_REVEAL", "TALLY", "PHASE_CHANGED", "MESSAGE_HIDDEN", "MEMBER_ERASED", "BYLAW_VERSION", "OBJECTION", "BILINMEYEN"])
      expect(txTypeTone(t), t).toBe("neutral");
    expect(txTypeTone("EVIDENCE")).toBe("danger");
    expect(renderToStaticMarkup(<TxTypeBadge type="EVIDENCE" />)).toContain("<svg");
    // Blok satırı: birçok tür yan yana; renkli rozet en çok bir
    expect(colored(renderToStaticMarkup(<TxTypeBadges types={["PHASE_CHANGED", "TALLY", "OBJECTION", "TALLY", "VOTE_COMMIT"]} />))).toEqual([]);
    expect(colored(renderToStaticMarkup(<TxTypeBadges types={["PHASE_CHANGED", "EVIDENCE", "MESSAGE_HIDDEN"]} />))).toEqual(["danger"]);
  });
});
