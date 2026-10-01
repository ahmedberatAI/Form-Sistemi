// Kimlik ve gizlilik yardımcıları: takma ad tekillik anahtarı, benzerlik iskeleti, herkese açık katılım günü.
// Sunucu (kayıt, giriş, arama, takma ad değişikliği) ve istemci aynı kuralı kullanır. Saf fonksiyonlardır.

/**
 * Takma ad tekillik ve arama anahtarı: NFKC → kırpma → tr-TR küçük harf → I/ı/İ/i katlaması.
 *
 * Yalnızca tr-TR küçültmesi yetmez: ASCII büyük "I" Türkçe kurala göre "ı" olur, bu yüzden "YONETICI" ile
 * "yonetici" farklı anahtar alırdı (taklit riski). Noktalı ve noktasız i bu yüzden tek harfe ("i") katlanır.
 */
export function nicknameKey(nickname: string): string {
  return String(nickname ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/i̇/g, "i")
    .replace(/ı/g, "i");
}

/** Benzerlik iskeletinde birbirinin yerine geçebilen karakterler (Türkçe harf, şapka, benzer rakam). */
const SKELETON_MAP: Readonly<Record<string, string>> = {
  ç: "c",
  ğ: "g",
  ö: "o",
  ş: "s",
  ü: "u",
  â: "a",
  î: "i",
  û: "u",
  "0": "o",
  "1": "i",
  l: "i", // büyük "I" ile küçük "l" çoğu yazı tipinde aynı görünür ("Iale" ~ "lale")
};

/**
 * Takma ad benzerlik iskeleti (UTS #39 "confusable skeleton" fikrinin sade bir uyarlaması): tekillik anahtarına ek olarak
 * Türkçe harfler ASCII karşılığına (ş→s, ç→c, ğ→g, ö→o, ü→u), şapkalı harfler düz harfe, 0→o, 1 ve l→i eşlenir;
 * ayraçlar (. _ -) atılır. İskeleti aynı olan iki takma ad birbirinin taklidi sayılır: "yonetici", "Yönetici",
 * "y0netici", "yonetici_" ve "YONETICI" aynı iskelete sahiptir.
 */
export function nicknameSkeleton(nickname: string): string {
  let out = "";
  for (const ch of nicknameKey(nickname)) out += SKELETON_MAP[ch] ?? ch;
  return out.replace(/[._-]/g, "");
}

const DAY_MS = 86_400_000;
/** Türkiye saati (UTC+3, yaz saati uygulaması yok). */
const TR_OFFSET_MS = 3 * 3_600_000;

/**
 * Herkese açık katılım tarihi: kayıt anı Türkiye saatine göre günün başına yuvarlanır. Tam zaman damgası herkese
 * açık verilmez; aksi hâlde defterdeki üyelik olaylarıyla zaman eşleştirmesi yapılarak takma ad ↔ memberRef bağı
 * kurulabilirdi (KVKK.md §4.3).
 */
export function publicJoinDay(createdAt: number): number {
  const t = Number(createdAt);
  if (!Number.isFinite(t)) return t;
  return Math.floor((t + TR_OFFSET_MS) / DAY_MS) * DAY_MS - TR_OFFSET_MS;
}
