// ?bolum=<çapa> derin bağlantısının saf yardımcıları ve routes.proposal(id, { bolum }). Bkz. lib/sectionParam.ts.
import { describe, expect, it } from "vitest";
import { routes, toAppPath } from "./routes";
import { parseSectionParam, SECTION_PARAM, sectionSearch, stripSectionParam } from "./sectionParam";

describe("parseSectionParam", () => {
  it("planın çapa kimliklerini kabul eder", () => {
    for (const a of ["eylem", "sonuclar", "dogrula", "bilirkisi", "yz", "tartisma", "kanitlar", "ontoloji", "kura-kaniti", "a_b-9"]) {
      expect(parseSectionParam(a)).toBe(a);
    }
  });

  it("boş, null ve güvensiz değerleri reddeder", () => {
    for (const bad of [null, undefined, "", " ", "1abc", "-x", "a b", "a.b", "a/b", "a#b", "a<b", "ş", "x".repeat(65), "<script>"]) {
      expect(parseSectionParam(bad)).toBeNull();
    }
    expect(parseSectionParam("x".repeat(64))).toBe("x".repeat(64));
  });
});

describe("stripSectionParam", () => {
  it("yalnız bolum'u siler; mesaj ve diğer parametreler kalır", () => {
    const p = new URLSearchParams("mesaj=m1&bolum=eylem&sekme=acik");
    const out = stripSectionParam(p);
    expect(out.get(SECTION_PARAM)).toBeNull();
    expect(out.get("mesaj")).toBe("m1");
    expect(out.get("sekme")).toBe("acik");
  });

  it("girdiyi değiştirmez ve parametre yoksa aynı içeriği verir", () => {
    const p = new URLSearchParams("bolum=yz");
    stripSectionParam(p);
    expect(p.get("bolum")).toBe("yz");
    expect(stripSectionParam(new URLSearchParams("a=1")).toString()).toBe("a=1");
  });

  it("özel parametre adıyla da çalışır", () => {
    expect(stripSectionParam(new URLSearchParams("kisim=x&bolum=y"), "kisim").toString()).toBe("bolum=y");
  });
});

describe("sectionSearch ve routes.proposal", () => {
  it("sectionSearch geçerli çapayı ?bolum=… yapar, geçersizde boş döner", () => {
    expect(sectionSearch("eylem")).toBe("?bolum=eylem");
    expect(sectionSearch("a b")).toBe("");
    expect(sectionSearch(null)).toBe("");
  });

  it("routes.proposal(id) eskisi gibi çalışır", () => {
    expect(routes.proposal("abc")).toBe("/oneriler/abc");
    expect(routes.proposal("a b/c")).toBe("/oneriler/a%20b%2Fc");
    expect(routes.proposal("abc", {})).toBe("/oneriler/abc");
    expect(routes.proposal("abc", { bolum: "" })).toBe("/oneriler/abc");
  });

  it("routes.proposal(id, { bolum }) çapayı sorguya yazar ve sectionParam bunu geri okur", () => {
    const to = routes.proposal("abc-123", { bolum: "sonuclar" });
    expect(to).toBe("/oneriler/abc-123?bolum=sonuclar");
    const search = to.slice(to.indexOf("?"));
    expect(parseSectionParam(new URLSearchParams(search).get(SECTION_PARAM))).toBe("sonuclar");
  });

  it("çapa kodlanır (sorguyu bozamaz)", () => {
    expect(routes.proposal("x", { bolum: "a&b=c" })).toBe("/oneriler/x?bolum=a%26b%3Dc");
  });

  it("sunucudan gelen bolum'lu bağlantı toAppPath'ten sorgusuyla geçer", () => {
    expect(toAppPath("/proposals/abc?bolum=eylem")).toEqual({ path: "/oneriler/abc?bolum=eylem" });
  });
});
