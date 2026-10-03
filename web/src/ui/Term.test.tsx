// Term: kapalıyken tek bir terim düğmesi (aria-haspopup=dialog), pencere gövdesi (günlük karşılık, tanım, sembol, 'Yönetmelikte ›'),
// bilinmeyen kimlikte düz metin, TierBadge ve HashText açıklamaları. Sunucu tarafı çizimle denetlenir (DOM gerekmez); açık pencere
// document.body'ye taşındığı için (createPortal) burada çizilmez, içeriği TermBody ile sınanır.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { TIER_LABELS, type Tier } from "@forum/shared";
import { describe, expect, it } from "vitest";
import { GLOSSARY, getTerm, type TermId } from "../lib/glossary";
import { TierBadge } from "./badges";
import { hashTitle, HashText } from "./HashText";
import { Modal } from "./Modal";
import { formTermLinkMode, NEW_TAB_NOTE, Term, TermBody, termLinkAttrs, TermLinksProvider, type TermLinkMode } from "./Term";

const render = (el: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);
/** Etiketleri atar ve HTML varlıklarını (&#x27; vb.) çözer: görünen düz metin. */
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const buttons = (html: string) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], text: text(m[2]) }));

describe("Term (kapalı)", () => {
  it("terim ekranda aynen yazılır; tek bir düğme, aria-haspopup=dialog, masaüstü ipucu günlük karşılık", () => {
    const html = render(
      <p>
        Gerekli <Term id="kopru-testi">köprü testi</Term> geçilmedi.
      </p>,
    );
    expect(text(html)).toBe("Gerekli köprü testi geçilmedi.");
    const b = buttons(html);
    expect(b).toHaveLength(1);
    expect(b[0].text).toBe("köprü testi");
    expect(b[0].attrs).toContain('type="button"');
    expect(b[0].attrs).toContain('class="term"');
    expect(b[0].attrs).toContain('aria-haspopup="dialog"');
    expect(b[0].attrs).toContain(`title="Günlük dille: ${getTerm("kopru-testi").plain}"`);
    // pencere yalnız açılınca çizilir: kapalıyken <dialog> ve başlık yok
    expect(html).not.toContain("<dialog");
    expect(html).not.toContain("<h2");
  });

  it("children verilmezse sözlükteki terim yazılır; className eklenir", () => {
    const html = render(<Term id="onay-esigi" className="ek" />);
    expect(buttons(html)[0].text).toBe("Onay eşiği");
    expect(html).toContain('class="term ek"');
  });

  it("bilinmeyen kimlik (tür denetimini aşan çağrı) düz metindir; düğme yok", () => {
    const html = render(<Term id={"olmayan-terim" as TermId}>düz metin</Term>);
    expect(html).toBe("düz metin");
  });

  it("aria-expanded taşımaz (açılan şey modal penceredir, katlanan bölüm değil)", () => {
    expect(render(<Term id="makbuz">makbuz</Term>)).not.toContain("aria-expanded");
  });

  it("sözlükteki her terim varsayılan adıyla çizilir ve yasak düğme adı alt dizelerini içermez", () => {
    for (const e of GLOSSARY) {
      const b = buttons(render(<Term id={e.id} />));
      expect(b, e.id).toHaveLength(1);
      expect(b[0].text, e.id).toBe(e.term);
    }
  });
});

describe("Term penceresi (TermBody + Modal)", () => {
  it("günlük karşılık önce, tanım sonra; sembol ve yönetmelik bağlantısı varsa yazılır", () => {
    const e = getTerm("onay-esigi");
    const html = render(<TermBody entry={e} />);
    expect(text(html).indexOf("Günlük dille:")).toBeLessThan(text(html).indexOf(e.definition));
    expect(text(html)).toContain(`Günlük dille: ${e.plain}.`);
    expect(text(html)).toContain(e.definition);
    expect(text(html)).toContain("Sembol: τ");
    expect(text(html)).toContain(e.bylawLink!.label);
    const link = /<a\b[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/.exec(html);
    expect(link?.[1]).toBe("/yonetmelik?sekme=maddeler");
    expect(link?.[2]).toBe("Yönetmelikte ›");
  });

  it("sembolü ve dayanağı olmayan terimde yalnız karşılık ile tanım çıkar (bağlantı yok)", () => {
    const e = getTerm("p-g");
    expect(e.bylawLink).toBeUndefined();
    const html = render(<TermBody entry={e} />);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("Sembol:");
    expect(text(html)).toContain(e.definition);
  });

  it("Modal sheet olarak çizilir: başlık terimin kendisi, kapatma düğmesi Modal'ın", () => {
    const e = getTerm("tofu");
    const html = render(
      <Modal open onClose={() => undefined} title={e.term} size="sm" sheet>
        <TermBody entry={e} />
      </Modal>,
    );
    expect(html).toContain("modal-sheet");
    expect(html).toContain("modal-sm");
    expect(html).toMatch(new RegExp(`<h2[^>]*class="modal-title"[^>]*>${e.term.replace(/[()]/g, "\\$&")}</h2>`));
    expect(html).toContain('aria-label="Kapat"');
  });

  it("'Yönetmelikte ›' ve 'Sözlükte ›' adları yasak alt dizeleri içermez", () => {
    for (const bad of ["Destekle", "Oyumu ver", "Daha fazla", "Sayımı kendim doğrulayayım", "Kapat", "Gerekçe", "Açıklama", "Azınlık raporu", "Düğüm"]) {
      expect("Yönetmelikte ›".toLocaleLowerCase("tr-TR")).not.toContain(bad.toLocaleLowerCase("tr-TR"));
      expect("Sözlükte ›".toLocaleLowerCase("tr-TR")).not.toContain(bad.toLocaleLowerCase("tr-TR"));
    }
  });

  it("glossaryLink: 'Sözlükte ›' terimin Keşfet sözlüğündeki yerine gider (varsayılan kapalı)", () => {
    const e = getTerm("p-g");
    const on = render(<TermBody entry={e} glossaryLink />);
    const link = /<a\b[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/.exec(on);
    expect(link?.[1]).toBe("/kesfet?bolum=terim-p-g");
    expect(link?.[2]).toBe("Sözlükte ›");
    // Yönetmelik dayanağı olan terimde iki bağlantı vardır: önce yönetmelik, sonra sözlük
    const both = [...render(<TermBody entry={getTerm("onay-esigi")} glossaryLink />).matchAll(/<a\b[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
    expect(both).toEqual(["Yönetmelikte ›", "Sözlükte ›"]);
    expect(render(<TermBody entry={e} />)).not.toContain("<a ");
  });
});

describe("bağlantı kipi: yalnız bellekte tutulan formun yanında pencere sayfadan çıkarmaz", () => {
  const anchors = (html: string) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ attrs: m[1], text: text(m[2]) }));
  const body = (mode: TermLinkMode) =>
    render(
      <TermLinksProvider mode={mode}>
        <TermBody entry={getTerm("onay-esigi")} glossaryLink />
      </TermLinksProvider>,
    );

  it("kip: web'de yeni sekme, yerel uygulamada bağlantısız; varsayılan aynı sekme", () => {
    expect(formTermLinkMode(false)).toBe("newTab");
    expect(formTermLinkMode(true)).toBe("none");
    expect(termLinkAttrs("page")).toEqual({ note: false });
    expect(termLinkAttrs("newTab")).toEqual({ target: "_blank", rel: "noopener", note: true });
    expect(termLinkAttrs("none")).toBeNull();
  });

  it("page (varsayılan): iki bağlantı aynı sekmede, adlar aynen ('Yönetmelikte ›', 'Sözlükte ›')", () => {
    const a = anchors(body("page"));
    expect(a.map((x) => x.text)).toEqual(["Yönetmelikte ›", "Sözlükte ›"]);
    for (const x of a) expect(x.attrs).not.toContain("target=");
  });

  it("newTab: aynı sekmede açılan bağlantı kalmaz; ikisi de yeni sekmede ve adlarında not var", () => {
    const a = anchors(body("newTab"));
    expect(a).toHaveLength(2);
    for (const x of a) {
      expect(x.attrs).toContain('target="_blank"');
      expect(x.attrs).toContain('rel="noopener"');
      expect(x.text).toContain(NEW_TAB_NOTE);
    }
    expect(a[0].attrs).toContain('href="/yonetmelik?sekme=maddeler"');
    expect(a[1].attrs).toContain('href="/kesfet?bolum=terim-onay-esigi"');
  });

  it("none: bağlantı yok; dayanak madde düz metin olarak kalır, tanım aynen", () => {
    const html = body("none");
    expect(anchors(html)).toHaveLength(0);
    const e = getTerm("onay-esigi");
    expect(text(html)).toContain(e.bylawLink!.label);
    expect(text(html)).toContain(e.definition);
    expect(text(html)).not.toContain("Sözlükte");
    expect(text(html)).not.toContain("Yönetmelikte ›");
  });
});

describe("TierBadge açıklaması", () => {
  it("explain yokken bugünkü rozet: düğme yok, title katmanın adı", () => {
    const html = render(<TierBadge tier="T1" />);
    expect(buttons(html)).toHaveLength(0);
    expect(html).toContain('title="Nitelikli karar"');
    expect(text(html)).toBe(`T1 · ${TIER_LABELS.T1}`);
  });

  it("explain: rozet katmanın sözlük penceresini açan düğme olur; ton ve metin aynı, bilgi simgesi eklenir", () => {
    for (const tier of Object.keys(TIER_LABELS) as Tier[]) {
      const html = render(<TierBadge tier={tier} explain />);
      const b = buttons(html);
      expect(b, tier).toHaveLength(1);
      expect(b[0].attrs).toContain("term-badge");
      expect(b[0].attrs).toContain('aria-haspopup="dialog"');
      expect(b[0].text, tier).toBe(`${tier} · ${TIER_LABELS[tier]}`);
      expect(html).toContain(`badge-${tier === "T3" ? "danger" : "neutral"}`);
      expect(html).toContain("<svg"); // bilgi simgesi
      expect(b[0].attrs).toContain(`title="Günlük dille: ${getTerm(`katman-${tier.toLowerCase()}` as TermId).plain}"`);
    }
  });

  it("explain + neutral: T3 de gri; explain + short: ipucu katmanın adı kalır, ad yalnızca kısaltma", () => {
    expect(render(<TierBadge tier="T3" explain neutral />)).toContain("badge-neutral");
    const short = render(<TierBadge tier="T2" short explain />);
    expect(buttons(short)[0].text).toBe("T2");
    expect(short).toContain(`title="${TIER_LABELS.T2}"`);
  });

  it("katman yoksa explain yok sayılır (düz 'Katman belirlenmedi' rozeti)", () => {
    expect(buttons(render(<TierBadge tier={null} explain />))).toHaveLength(0);
  });
});

describe("HashText açıklaması ('özet' = parmak izi)", () => {
  const hash = "ab".repeat(32);

  it("fare ipucu 'parmak izi' der; görünen metin ve kopyala düğmesi aynen kalır", () => {
    expect(hashTitle(hash)).toBe(`Özet (parmak izi): ${hash}`);
    const html = render(<HashText hash={hash} label="Girdi özeti" />);
    expect(html).toContain(`title="Özet (parmak izi): ${hash}"`);
    expect(html).toContain(`aria-label="Girdi özeti: ${hash}"`);
    expect(text(html)).toContain(hash.slice(0, 10));
    const b = buttons(html);
    expect(b).toHaveLength(1);
    expect(b[0].attrs).toContain('aria-label="Girdi özeti kopyala"');
  });

  it("varsayılan kopyala adı 'Özeti kopyala' aynen kalır", () => {
    expect(render(<HashText hash={hash} />)).toContain('aria-label="Özeti kopyala"');
  });

  it("explain: yanına 'Özet nedir?' terim düğmesi gelir", () => {
    const b = buttons(render(<HashText hash={hash} explain />));
    expect(b).toHaveLength(2);
    expect(b[1].attrs).toContain("term-info");
    expect(b[1].text).toBe("Özet nedir?");
  });

  it("özet olmayan değer (digest=false: imza, açık anahtar, oy pusulası kimliği): ipucu değerin kendisidir, 'Özet' denmez", () => {
    const sig = "cd".repeat(32);
    for (const label of ["İmza", "Açık anahtar", "Oy pusulası kimliği"]) {
      const html = render(<HashText hash={sig} label={label} digest={false} />);
      expect(html, label).toContain(`title="${sig}"`);
      expect(html, label).not.toContain("parmak izi");
      expect(html, label).toContain(`aria-label="${label}: ${sig}"`);
      expect(html, label).toContain(`aria-label="${label} kopyala"`);
    }
  });

  it("hash yoksa tire; explain düğme eklemez", () => {
    expect(render(<HashText hash={null} explain />)).toBe('<span class="muted">—</span>');
  });
});
