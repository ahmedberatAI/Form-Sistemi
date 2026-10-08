// "Son açılanlar" deposu: yalnız bu cihazda, oturum sahibine göre anahtarlı, en çok 20, yeniden eskiye, tekrarsız, yalnız UUID;
// oturum yokken okunmaz/yazılmaz; çıkışta silinir; bozuk kayıt ya da erişilemeyen depo hiçbir zaman fırlatmaz. Ayrıca 'Size göre'
// seçiminin hatırlanması (lib/personalSort) ve etkin sıralamanın çözümü.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memoryDeviceStore, setDeviceStoreForTests, type DeviceStore } from "./deviceStore";
import { DEFAULT_SORT, PERSONAL_SORT, rememberedPersonalSort, rememberPersonalSort, resolveListSort, sortOptions, sortPrefKey } from "./personalSort";
import { clearRecentOpened, getRecentOpened, isProposalId, parseRecent, pushRecent, recentKey, recordOpened, RECENT_MAX, setRecentOwner } from "./recentOpened";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

let store: ReturnType<typeof memoryDeviceStore>;

beforeEach(() => {
  store = memoryDeviceStore();
  setDeviceStoreForTests(store);
  setRecentOwner(null);
});
afterEach(() => {
  setDeviceStoreForTests(null);
  setRecentOwner(null);
});

describe("saf yardımcılar", () => {
  it("en çok 20 (sunucunun recent üst sınırı)", () => {
    expect(RECENT_MAX).toBe(20);
  });

  it("isProposalId yalnız UUID kabul eder", () => {
    expect(isProposalId(A)).toBe(true);
    expect(isProposalId(A.toUpperCase())).toBe(true);
    for (const bad of ["", "abc", "1", `${A},${B}`, null, 5, undefined, `${A} `]) expect(isProposalId(bad), String(bad)).toBe(false);
  });

  it("parseRecent: bozuk/boş/dizi olmayan kayıt boş liste; UUID olmayan ve yinelenen atılır; 20'de kesilir", () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent("")).toEqual([]);
    expect(parseRecent("{bozuk")).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
    expect(parseRecent(JSON.stringify([A, "x", 3, A, B, null]))).toEqual([A, B]);
    const many = Array.from({ length: 30 }, (_, i) => uuid(i));
    expect(parseRecent(JSON.stringify(many))).toEqual(many.slice(0, 20));
  });

  it("pushRecent: başa alır, eski yerini siler, 20'de keser; geçersiz kimlik listeyi değiştirmez", () => {
    expect(pushRecent([], A)).toEqual([A]);
    expect(pushRecent([A, B], B)).toEqual([B, A]);
    expect(pushRecent([A], "geçersiz")).toEqual([A]);
    const many = Array.from({ length: 20 }, (_, i) => uuid(i));
    const next = pushRecent(many, uuid(99));
    expect(next).toHaveLength(20);
    expect(next[0]).toBe(uuid(99));
    expect(next).not.toContain(uuid(19)); // en eskisi düşer
  });
});

describe("cihazdaki liste (oturum sahibine göre)", () => {
  it("oturum yokken okunmaz ve yazılmaz", () => {
    recordOpened(A);
    expect(getRecentOpened()).toEqual([]);
    expect(store.map.size).toBe(0);
  });

  it("anahtar `forum.sonAcilanlar:<kullanıcı>`; yeniden eskiye, tekrarsız", () => {
    setRecentOwner("u1");
    recordOpened(A);
    recordOpened(B);
    recordOpened(A);
    expect(getRecentOpened()).toEqual([A, B]);
    expect(recentKey("u1")).toBe("forum.sonAcilanlar:u1");
    expect(JSON.parse(store.map.get("forum.sonAcilanlar:u1")!)).toEqual([A, B]);
  });

  it("UUID olmayan kimlik kaydedilmez (sunucu isteği 400 ile reddederdi)", () => {
    setRecentOwner("u1");
    recordOpened("../../etc");
    recordOpened("");
    expect(getRecentOpened()).toEqual([]);
  });

  it("en çok 20 tutulur", () => {
    setRecentOwner("u1");
    for (let i = 0; i < 25; i++) recordOpened(uuid(i));
    const list = getRecentOpened();
    expect(list).toHaveLength(20);
    expect(list[0]).toBe(uuid(24));
    expect(list.at(-1)).toBe(uuid(5));
  });

  it("üyeler birbirinin listesini görmez; çıkışta yalnız sahibinin listesi silinir", () => {
    setRecentOwner("u1");
    recordOpened(A);
    setRecentOwner("u2");
    recordOpened(B);
    expect(getRecentOpened()).toEqual([B]);
    clearRecentOpened(); // u2 çıkış yaptı
    expect(getRecentOpened()).toEqual([]);
    setRecentOwner("u1");
    expect(getRecentOpened()).toEqual([A]);
    clearRecentOpened("u1");
    expect(store.map.size).toBe(0);
  });

  it("depo erişilemezse (gizli pencere, engelli site verisi) fırlatmaz; liste boş sayılır", () => {
    const broken: DeviceStore = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    setDeviceStoreForTests(broken);
    setRecentOwner("u1");
    expect(() => recordOpened(A)).not.toThrow();
    expect(getRecentOpened()).toEqual([]);
    expect(() => clearRecentOpened()).not.toThrow();
  });

  it("bozuk kayıt fırlatmaz ve üzerine doğru liste yazılır", () => {
    setRecentOwner("u1");
    store.map.set(recentKey("u1"), "[bozuk");
    expect(getRecentOpened()).toEqual([]);
    recordOpened(A);
    expect(getRecentOpened()).toEqual([A]);
  });
});

describe("Sırala: 'Size göre' (varsayılan değişmez)", () => {
  it("seçenekler: ziyaretçide 4, üyede 'Size göre' varsayılanın hemen altında", () => {
    expect(sortOptions(false).map((o) => o.label)).toEqual(["En yeni", "Süresi en yakın", "En çok mesaj", "En eski"]);
    expect(sortOptions(true).map((o) => o.label)).toEqual(["En yeni", "Size göre", "Süresi en yakın", "En çok mesaj", "En eski"]);
    expect(sortOptions(true)[1].value).toBe("sana-gore");
    expect(PERSONAL_SORT).toBe("sana-gore");
    expect(DEFAULT_SORT).toBe("yeni");
  });

  it("varsayılan her zaman 'En yeni'; 'Size göre' yalnız seçilip hatırlandıysa ya da adreste varsa", () => {
    expect(resolveListSort(null, { loggedIn: true, remembered: false })).toBe("yeni");
    expect(resolveListSort(null, { loggedIn: false, remembered: false })).toBe("yeni");
    expect(resolveListSort(null, { loggedIn: true, remembered: true })).toBe("sana-gore");
    expect(resolveListSort("sana-gore", { loggedIn: true, remembered: false })).toBe("sana-gore");
  });

  it("adresteki ?sirala= önce gelir; geçersiz değer yok sayılır; ziyaretçide 'Size göre' varsayılana döner", () => {
    expect(resolveListSort("sure", { loggedIn: true, remembered: true })).toBe("sure");
    expect(resolveListSort("xyz", { loggedIn: true, remembered: true })).toBe("sana-gore");
    expect(resolveListSort("xyz", { loggedIn: true, remembered: false })).toBe("yeni");
    expect(resolveListSort("sana-gore", { loggedIn: false, remembered: true })).toBe("yeni");
    expect(resolveListSort(null, { loggedIn: false, remembered: true })).toBe("yeni");
  });

  it("seçim üye başına bu cihazda hatırlanır; başka sıralama seçilince unutulur; oturum yoksa yazılmaz", () => {
    expect(rememberedPersonalSort("u1")).toBe(false);
    rememberPersonalSort("u1", true);
    expect(store.map.get(sortPrefKey("u1"))).toBe("sana-gore");
    expect(sortPrefKey("u1")).toBe("forum.oneriSirasi:u1");
    expect(rememberedPersonalSort("u1")).toBe(true);
    expect(rememberedPersonalSort("u2")).toBe(false);
    rememberPersonalSort("u1", false);
    expect(rememberedPersonalSort("u1")).toBe(false);
    rememberPersonalSort(null, true);
    expect(rememberedPersonalSort(null)).toBe(false);
    expect(store.map.size).toBe(0);
  });
});
