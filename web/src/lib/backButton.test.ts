// Android geri tuşunun sayfa içi adımları (lib/backButton.ts): önce açık pencere, sonra açık menü, sonra üst çubuktaki 'Hızlı bul'
// kutusunun açık sonuç listesi (≥ 720 px) kapanır; hiçbiri yoksa null (çağıran geri gider). Sahte belgeyle (DOM gerekmez).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeTopLayer, OPEN_MENU_SELECTOR, OPEN_QUICK_FIND_SELECTOR, type BackDom } from "./backButton";

class FakeKeyboardEvent extends Event {
  key: string;
  constructor(type: string, init: { key: string; bubbles?: boolean; cancelable?: boolean }) {
    super(type, init);
    this.key = init.key;
  }
}

beforeEach(() => vi.stubGlobal("KeyboardEvent", FakeKeyboardEvent));
afterEach(() => vi.unstubAllGlobals());

interface FakeEl {
  dispatched: Event[];
  dispatchEvent(e: Event): boolean;
  closest(sel: string): FakeEl | null;
  querySelector(sel: string): FakeEl | null;
}

function el(o: { closest?: Record<string, FakeEl>; children?: Record<string, FakeEl> } = {}): FakeEl {
  const e: FakeEl = {
    dispatched: [],
    dispatchEvent(ev) {
      e.dispatched.push(ev);
      return true;
    },
    closest: (sel) => o.closest?.[sel] ?? null,
    querySelector: (sel) => o.children?.[sel] ?? null,
  };
  return e;
}

function doc(parts: { dialogs?: FakeEl[]; menu?: boolean; popup?: FakeEl | null }): BackDom & { dispatched: Event[] } {
  const dispatched: Event[] = [];
  return {
    dispatched,
    querySelectorAll: (sel) => (sel === "dialog[open]" ? ((parts.dialogs ?? []) as unknown as Element[]) : []),
    querySelector: (sel) => {
      if (sel === OPEN_MENU_SELECTOR) return parts.menu ? ({} as Element) : null;
      if (sel === OPEN_QUICK_FIND_SELECTOR) return (parts.popup ?? null) as unknown as Element | null;
      return null;
    },
    dispatchEvent: (e) => {
      dispatched.push(e);
      return true;
    },
  };
}

/** Açık 'Hızlı bul' listesi: liste → .qf kapsayıcı → metin kutusu. */
function quickFind(): { popup: FakeEl; input: FakeEl } {
  const input = el();
  const root = el({ children: { "input.qf-input": input } });
  return { popup: el({ closest: { ".qf": root } }), input };
}

describe("Android geri tuşu: sayfa içi adımlar", () => {
  it("açık pencere varsa en üsttekine 'cancel' gönderilir (liste ve menü açık olsa da önce pencere)", () => {
    const [a, b] = [el(), el()];
    const qf = quickFind();
    const d = doc({ dialogs: [a, b], menu: true, popup: qf.popup });
    expect(closeTopLayer(d)).toBe("dialog");
    expect(a.dispatched).toEqual([]);
    expect(b.dispatched.map((e) => e.type)).toEqual(["cancel"]);
    expect(qf.input.dispatched).toEqual([]);
  });

  it("pencere yoksa açık menüye Esc gönderilir", () => {
    const d = doc({ menu: true });
    expect(closeTopLayer(d)).toBe("menu");
    expect(d.dispatched.map((e) => [e.type, (e as FakeKeyboardEvent).key])).toEqual([["keydown", "Escape"]]);
  });

  it("üst çubuktaki 'Hızlı bul' listesi açıksa kutuya Esc gönderilir (liste kapanır, sayfa değişmez)", () => {
    const qf = quickFind();
    const d = doc({ popup: qf.popup });
    expect(closeTopLayer(d)).toBe("quickfind");
    expect(qf.input.dispatched.map((e) => [e.type, (e as FakeKeyboardEvent).key, e.bubbles])).toEqual([["keydown", "Escape", true]]);
    expect(OPEN_QUICK_FIND_SELECTOR).toBe(".qf-inline .qf-popup:not([hidden])");
  });

  it("kapatılacak bir şey yoksa null (çağıran geçmişte geri gider)", () => {
    expect(closeTopLayer(doc({}))).toBeNull();
  });
});
