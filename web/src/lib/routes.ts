// Uygulama içi yol üreticileri (Türkçe rotalar) ve bildirim bağlantısı normalleştirme.

export const routes = {
  home: () => "/",
  login: () => "/giris",
  register: () => "/kayit",
  topics: () => "/konular",
  topic: (id: string) => `/konular/${encodeURIComponent(id)}`,
  proposals: () => "/oneriler",
  newProposal: (q?: { kind?: string; parentTopicId?: string; messageId?: string }) => {
    const sp = new URLSearchParams();
    if (q?.kind) sp.set("tur", q.kind);
    if (q?.parentTopicId) sp.set("konu", q.parentTopicId);
    if (q?.messageId) sp.set("mesaj", q.messageId);
    const s = sp.toString();
    return "/oneriler/yeni" + (s ? "?" + s : "");
  },
  /** `bolum` verilirse bağlantı o çapadaki kartı açar, oraya kaydırır ve odağı taşır (lib/sectionParam.ts: ?bolum=). */
  proposal: (id: string, q?: { bolum?: string }) => `/oneriler/${encodeURIComponent(id)}` + (q?.bolum ? `?bolum=${encodeURIComponent(q.bolum)}` : ""),
  verifyVote: (q?: { proposalId?: string }) => "/oy-dogrula" + (q?.proposalId ? `?oneri=${encodeURIComponent(q.proposalId)}` : ""),
  experts: () => "/bilirkisiler",
  profile: () => "/profil",
  user: (id: string) => `/uyeler/${encodeURIComponent(id)}`,
  registrar: () => "/kayit-memuru",
  admin: () => "/yonetim",
  notifications: () => "/bildirimler",
  settings: () => "/ayarlar",
  graph: () => "/graf",
  ledger: () => "/defter",
  block: (height: number) => `/defter/blok/${height}`,
  tx: (hash: string) => `/defter/islem/${encodeURIComponent(hash)}`,
  ontology: () => "/yonetmelik",
  /**
   * 'Keşfet ve doğrula': yedi bileşen, gösterim rehberi, temel ilkeler ve sözlük (gezinme öğesi değil; vitrin, alt bilgi ve
   * 'Daha fazla'dan). `bolum` verilirse o bölüme ya da sözlük terimine (`terim-<kimlik>`) kaydırır (lib/sectionParam.ts).
   */
  kesfet: (q?: { bolum?: string }) => "/kesfet" + (q?.bolum ? `?bolum=${encodeURIComponent(q.bolum)}` : ""),
};

const SEGMENT_MAP: Record<string, string> = {
  proposals: "oneriler",
  topics: "konular",
  users: "uyeler",
  experts: "bilirkisiler",
  notifications: "bildirimler",
  ledger: "defter",
  ontology: "yonetmelik",
  registrar: "kayit-memuru",
  admin: "yonetim",
  profile: "profil",
  settings: "ayarlar",
  graph: "graf",
};

/**
 * Sunucudan gelen bağlantıyı uygulama içi yola çevirir.
 * Kabul edilenler: "/oneriler/abc", "#/oneriler/abc", "/proposals/abc", "/api/proposals/abc",
 * "/ledger/txs/<hash>" → "/defter/islem/<hash>", "/ledger/blocks/5" → "/defter/blok/5".
 * Dış bağlantı (http…) ise { external: url } döner.
 */
export function toAppPath(link: string | null | undefined): { path: string } | { external: string } | null {
  if (!link) return null;
  let l = link.trim();
  if (/^https?:\/\//i.test(l)) {
    try {
      const u = new URL(l);
      if (u.origin !== window.location.origin) return { external: l };
      l = u.hash ? u.hash : u.pathname + u.search;
    } catch {
      return { external: l };
    }
  }
  if (l.startsWith("#")) l = l.slice(1);
  if (!l.startsWith("/")) l = "/" + l;
  l = l.replace(/^\/api(?=\/)/, "");
  const m = /^\/ledger\/(txs|tx|blocks|block)\/([^/?#]+)/.exec(l);
  if (m) return { path: m[1].startsWith("tx") ? routes.tx(decodeURIComponent(m[2])) : routes.block(Number(m[2])) };
  const parts = l.split("/");
  if (parts[1] && SEGMENT_MAP[parts[1]]) parts[1] = SEGMENT_MAP[parts[1]];
  return { path: parts.join("/") };
}
