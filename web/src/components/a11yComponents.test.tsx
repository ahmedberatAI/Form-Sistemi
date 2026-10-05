// Erişilebilirlik bileşen sözleşmeleri (sunucu tarafı çizim, DOM'suz):
//  • 2.4.3: yüklenen düğme yerel `disabled` olmaz (odak belgeye düşmesin); aria-disabled + aria-busy, tıklama yok sayılır.
//  • 4.1.3: liste sayfalarının durum bölgesi (role=status) sürekli DOM'da.
//  • 2.1.1: kaydırılabilir yük kutusu klavyeyle odaklanabilir, adlandırılmış bölge.
//  • 2.4.2/1.3.1: bulunamayan sayfa/öneri/konu/üye ekranında görünür h1.
//  • 1.3.1/3.3.1: kategori seçicinin hata iletisi grubun açıklamasına bağlı.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { NotFound } from "../App";
import { CategoryPicker } from "./CategoryPicker";
import { DetailLevelProvider } from "../lib/detailLevel";
import { listStatusMessage } from "../pages/ProposalsPage";
import { Button, LiveStatus, ScrollPre } from "../ui/basic";
import { PageErrorView } from "../ui/ErrorView";
import { ToastProvider } from "../ui/Toast";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: null, can: () => false, now: () => Date.UTC(2026, 9, 5) }),
  useServerNow: () => () => Date.UTC(2026, 9, 5),
}));

const render = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <DetailLevelProvider>
      <ToastProvider>
        <MemoryRouter>{el}</MemoryRouter>
      </ToastProvider>
    </DetailLevelProvider>,
  );

describe("Button: yüklenirken odak düğmede kalır", () => {
  it("loading → aria-busy + aria-disabled, yerel disabled YOK (disabled ile birlikte verilse de)", () => {
    for (const html of [renderToStaticMarkup(<Button loading>Oyumu ver</Button>), renderToStaticMarkup(<Button loading disabled>Oyumu ver</Button>)]) {
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('aria-disabled="true"');
      expect(html).not.toMatch(/\sdisabled=""/);
    }
  });

  it("yüklenmiyorsa disabled eskisi gibi yereldir; aria-disabled eklenmez", () => {
    const html = renderToStaticMarkup(<Button disabled>Gönder</Button>);
    expect(html).toMatch(/\sdisabled=""/);
    expect(html).not.toContain("aria-disabled");
  });

  it("yüklenirken tıklama (ve formun Enter ile örtük gönderimi) yok sayılır", () => {
    const onClick = vi.fn();
    const busy = Button({ loading: true, onClick, children: "Kaydet", type: "submit" }) as React.ReactElement<{ onClick: (e: { preventDefault: () => void }) => void }>;
    const preventDefault = vi.fn();
    busy.props.onClick({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
    const idle = Button({ onClick, children: "Kaydet" }) as React.ReactElement<{ onClick: unknown }>;
    expect(idle.props.onClick).toBe(onClick);
  });
});

describe("LiveStatus ve liste durum iletisi", () => {
  it("bölge her zaman DOM'da: role=status, aria-live=polite (içerik sonradan yazılır)", () => {
    const html = renderToStaticMarkup(<LiveStatus message="Süzgece uyan öneri yok" />);
    expect(html).toBe('<div class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>');
    expect(renderToStaticMarkup(<LiveStatus message="3 öneri listeleniyor" delayMs={0} />)).toContain(">3 öneri listeleniyor<");
  });

  it("listStatusMessage: yüklenmeden boş; sonuç yoksa boş durumun başlığı; varsa sayı", () => {
    const base = { noun: "öneri", emptyTitle: "Süzgece uyan öneri yok" };
    expect(listStatusMessage({ ...base, loaded: false, count: 0, filtered: true })).toBe("");
    expect(listStatusMessage({ ...base, loaded: true, count: 0, filtered: true })).toBe("Süzgece uyan öneri yok");
    expect(listStatusMessage({ ...base, loaded: true, count: 4, filtered: true })).toBe("4 öneri süzgece uyuyor");
    expect(listStatusMessage({ ...base, loaded: true, count: 12, filtered: false })).toBe("12 öneri listeleniyor");
  });
});

describe("ScrollPre: kaydırılabilir yük kutusu klavyeyle erişilebilir", () => {
  it("tabindex=0, role=region ve ad taşır", () => {
    const html = renderToStaticMarkup(<ScrollPre label="İşlem yükü (JSON)">{'{"a":1}'}</ScrollPre>);
    expect(html).toBe('<pre class="sy-pre" tabindex="0" role="region" aria-label="İşlem yükü (JSON)">{&quot;a&quot;:1}</pre>');
  });
});

describe("bulunamayan ekranlar görünür h1 taşır", () => {
  it("bilinmeyen adres: h1 'Sayfa bulunamadı'", () => {
    const html = render(<NotFound />);
    expect(html).toContain('<h1 class="page-title">Sayfa bulunamadı</h1>');
  });

  it("öneri/konu/üye: 404'te '<Konu> bulunamadı', başka hatada '<Konu> yüklenemedi' (hata ayrıntısı korunur)", () => {
    const nf = render(<PageErrorView subject="Öneri" error={new ApiError(404, "not_found", "Öneri bulunamadı.")} onRetry={() => undefined} />);
    expect(nf).toContain('<h1 class="page-title">Öneri bulunamadı</h1>');
    expect(nf).toContain('role="alert"');
    expect(render(<PageErrorView subject="Konu" error={new ApiError(404, "not_found", "x")} />)).toContain("<h1 class=\"page-title\">Konu bulunamadı</h1>");
    expect(render(<PageErrorView subject="Üye" error={new ApiError(503, "unreachable", "x")} />)).toContain("<h1 class=\"page-title\">Üye yüklenemedi</h1>");
  });
});

describe("CategoryPicker: hata iletisi gruba bağlı", () => {
  it("hata varken fieldset aria-describedby ipucu VE hata kimliğini içerir; hata öğesi o kimliği taşır", () => {
    const html = render(<CategoryPicker value={[]} onChange={() => undefined} hint="En az bir kategori" error="En az bir kategori seçin." required />);
    const describedBy = /<fieldset[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1] ?? "";
    const ids = describedBy.split(" ");
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/-hint$/);
    expect(ids[1]).toMatch(/-err$/);
    expect(html).toContain(`<div class="field-error" id="${ids[1]}" role="alert">En az bir kategori seçin.</div>`);
  });

  it("hata yokken yalnız ipucu bağlanır", () => {
    const html = render(<CategoryPicker value={[]} onChange={() => undefined} hint="İpucu" />);
    expect(/<fieldset[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1]).toMatch(/-hint$/);
  });
});
