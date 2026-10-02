// IRI güvenliği: kullanıcıdan gelen IRI'ler Turtle'a yazılmadan önce katı biçim denetiminden geçer.
// Turtle IRIREF'inde boşluk/kontrol karakterleri ile < > " { } | ^ ` \ bulunamaz; bunlardan biri yazıcıda kaçışsız
// kalırsa üçlü enjeksiyonu (ör. `...#X> <p> <o> . <s2> ...`) ya da ayrıştırılamayan bir A-kutusu üretir.
import { FY_NS } from "@forum/shared";

/** Kaçışsız yazılamayan karakterler: kontrol/boşluk (0x00-0x20, 0x7f-0x9f) ile < > " { } | ^ ` \ */
const UNSAFE_CHAR = /[\x00-\x20\x7f-\x9f<>"{}|^`\\]/;
/** Yeni terim (kategori, madde, kural) yerel adı: yalnız harf, rakam, alt çizgi ve tire. */
const LOCAL_NAME = /^[A-Za-z0-9_-]{1,100}$/;

/** Turtle IRIREF'inde kaçışsız yazılamayan bir karakter içeriyor mu? */
export function hasUnsafeIriChars(value: string): boolean {
  return UNSAFE_CHAR.test(value);
}

/** Verilen değer, Turtle'a kaçışsız yazılabilecek güvenli, mutlak bir http(s) IRI'si mi? */
export function isSafeIri(value: unknown): value is string {
  return typeof value === "string" && value.length <= 300 && /^https?:\/\/./.test(value) && !UNSAFE_CHAR.test(value);
}

/** Yamayla yeni oluşturulacak terimlerin IRI'si: yönetmelik ad alanında ve güvenli bir yerel adla. */
export function isNewTermIri(value: unknown): value is string {
  return isSafeIri(value) && value.startsWith(FY_NS) && LOCAL_NAME.test(value.slice(FY_NS.length));
}
