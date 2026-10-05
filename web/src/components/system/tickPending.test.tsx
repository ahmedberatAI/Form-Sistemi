// Yönetici "ileri al" / "zamanlayıcıyı çalıştır" isteği süre bütçesini (≈20 sn) aşınca sunucu `pending: true` döner ve kalan
// geçişleri zamanlayıcıya bırakır. Ekran bunu söylemeli; aksi halde yönetici "geçiş yok" sanıp işlemi bitmiş zanneder.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { TickResponse } from "@forum/shared";
import { TICK_PENDING_NOTE, TransitionsList } from "./marks";

const html = (res: TickResponse) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <TransitionsList result={res} />
    </MemoryRouter>,
  );

const transition = { proposalId: "p1", seq: 7, from: "deliberation", to: "voting", reason: "Tartışma süresi doldu" } as const;

describe("TransitionsList: pending (süre bütçesi doldu)", () => {
  it("pending yoksa uyarı da yoktur", () => {
    expect(html({ transitions: [], now: 0 })).toContain("Bu adımda evre değişikliği olmadı.");
    expect(html({ transitions: [transition], now: 0 })).not.toContain(TICK_PENDING_NOTE);
  });

  it("pending: true → 'Geçişler sürüyor' uyarısı (geçiş listesiyle birlikte ya da tek başına)", () => {
    const withList = html({ transitions: [transition], now: 0, pending: true });
    expect(withList).toContain("Geçişler sürüyor");
    expect(withList).toContain(TICK_PENDING_NOTE);
    expect(withList).toContain("#K-7");
    const empty = html({ transitions: [], now: 0, pending: true });
    expect(empty).toContain(TICK_PENDING_NOTE);
    expect(empty).not.toContain("Bu adımda evre değişikliği olmadı.");
    expect(empty).toMatch(/role="alert"/);
  });
});
