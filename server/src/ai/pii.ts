// Kişisel veri tespiti ve maskeleme. Claude'a giden HER metin önce buradan geçer.
import { isValidTckn } from "@forum/shared";
import type { PiiFinding } from "../core/contracts";

type Kind = PiiFinding["kind"];

const PRIORITY: Record<Kind, number> = { iban: 0, tckn: 1, email: 2, phone: 3, address: 4 };

export const PII_PLACEHOLDER: Record<Kind, string> = {
  tckn: "[TCKN]",
  iban: "[IBAN]",
  phone: "[TELEFON]",
  email: "[E-POSTA]",
  address: "[ADRES]",
};

/** İlk/son birkaç karakter dışındaki harf ve rakamları * ile örter (boşluklar korunur). */
export function maskValue(value: string, kind: Kind): string {
  const [head, tail] = kind === "tckn" ? [3, 2] : kind === "iban" ? [4, 2] : value.length >= 8 ? [2, 2] : value.length >= 4 ? [1, 1] : [0, 0];
  return [...value]
    .map((ch, i) => (i < head || i >= value.length - tail || /\s/.test(ch) ? ch : "*"))
    .join("");
}

interface Candidate {
  kind: Kind;
  start: number;
  end: number;
}

function collect(re: RegExp, text: string, kind: Kind, accept: (m: RegExpExecArray) => boolean = () => true): Candidate[] {
  const out: Candidate[] = [];
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    if (accept(m)) out.push({ kind, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const RE_TCKN = /(?<![\d])[1-9]\d{2}[ .-]?\d{3}[ .-]?\d{3}[ .-]?\d{2}(?![\d])/g;
const RE_IBAN = /(?<![\p{L}\p{N}])TR[ ]?\d{2}(?:[ ]?\d{4}){5}[ ]?\d{2}(?!\d)/giu;
const RE_EMAIL = /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
const RE_PHONE_PREFIXED = /(?<![\d+])(?:\+\s?90|0090|0)[\s.-]?\(?[2-5]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)/g;
const RE_PHONE_BARE = /(?<![\d+])\(?5\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)/g;

const ADDRESS_MARKERS = /(?<![\p{L}\p{N}])(mah\.|mahallesi|mh\.|sok\.|sk\.|sokak|sokağı|cad\.|cd\.|caddesi|bulvarı|blv\.|no\s*:|daire|apt\.?|apartmanı)(?![\p{L}])/giu;
const STRONG_MARKER = /^(mah\.|mahallesi|mh\.|sok\.|sk\.|sokak|sokağı|cad\.|cd\.|caddesi|bulvarı|blv\.|no\s*:)$/iu;

function addressCandidates(text: string): Candidate[] {
  const marks: { start: number; end: number; marker: string }[] = [];
  let m: RegExpExecArray | null;
  ADDRESS_MARKERS.lastIndex = 0;
  while ((m = ADDRESS_MARKERS.exec(text))) marks.push({ start: m.index, end: m.index + m[0].length, marker: m[0].toLocaleLowerCase("tr-TR") });
  if (marks.length === 0) return [];
  const groups: (typeof marks)[] = [];
  for (const mk of marks) {
    const g = groups[groups.length - 1];
    if (g && mk.start - g[g.length - 1].end <= 40) g.push(mk);
    else groups.push([mk]);
  }
  const out: Candidate[] = [];
  for (const g of groups) {
    const distinct = new Set(g.map((x) => x.marker.replace(/\s+/g, "")));
    const after = text.slice(g[g.length - 1].end, g[g.length - 1].end + 20);
    const numberAfter = /^\s*:?\s*\d/.test(after);
    const strong = g.some((x) => STRONG_MARKER.test(x.marker.replace(/\s+/g, "")));
    if (!(distinct.size >= 2 || (strong && numberAfter))) continue;
    // Başlangıç: ilk işaretten önceki ad (ör. "Atatürk Mah.", "Gül Sokak"): büyük harfli en fazla iki sözcük, yoksa bir sözcük.
    let start = g[0].start;
    const before = text.slice(Math.max(0, start - 40), start);
    const bw = /((?:[\p{Lu}\p{N}][\p{L}\p{N}]*\.?\s+){1,2})$/u.exec(before) ?? /([\p{L}\p{N}]+\.?\s+)$/u.exec(before);
    if (bw) start -= bw[1].length;
    let end = g[g.length - 1].end;
    const tail = /^\s*:?\s*\d+(?:\s*[/\-]\s*\d+)?(?:\s*(?:daire|d\.|kat)\s*:?\s*\d+)?/iu.exec(text.slice(end));
    if (tail) end += tail[0].length;
    out.push({ kind: "address", start, end });
  }
  return out;
}

/** TCKN, IBAN, telefon, e-posta ve adres bulguları — çakışmasız ve konuma göre sıralı. */
export function detectPii(text: string): PiiFinding[] {
  if (!text) return [];
  const cands: Candidate[] = [
    ...collect(RE_IBAN, text, "iban"),
    ...collect(RE_TCKN, text, "tckn", (m) => isValidTckn(m[0])),
    ...collect(RE_EMAIL, text, "email"),
    ...collect(RE_PHONE_PREFIXED, text, "phone"),
    ...collect(RE_PHONE_BARE, text, "phone"),
    ...addressCandidates(text),
  ];
  cands.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || b.end - b.start - (a.end - a.start) || a.start - b.start);
  const accepted: Candidate[] = [];
  for (const c of cands) {
    if (accepted.some((a) => c.start < a.end && a.start < c.end)) continue;
    accepted.push(c);
  }
  accepted.sort((a, b) => a.start - b.start);
  return accepted.map((c) => ({ ...c, masked: maskValue(text.slice(c.start, c.end), c.kind) }));
}

/** Bulguları yer tutucularla değiştirir ("[TCKN]" …). */
export function redactPii(text: string, findings: PiiFinding[] = detectPii(text)): string {
  let out = "";
  let pos = 0;
  for (const f of findings) {
    out += text.slice(pos, f.start) + PII_PLACEHOLDER[f.kind];
    pos = f.end;
  }
  return out + text.slice(pos);
}

const MENTION = /(?<![\p{L}\p{N}_.])@([\p{L}\p{N}_][\p{L}\p{N}_.-]*[\p{L}\p{N}_]|[\p{L}\p{N}_])/gu;

/**
 * Takma ad maskeleyici: "@takma_ad" kalıplarını tutarlı K-kodlarıyla değiştirir.
 * `next` mevcut en büyük K numarasından sonra başlar; aynı takma ad aynı kodu alır.
 */
export class PseudonymMasker {
  private map = new Map<string, string>();
  constructor(private next = 1) {}
  mask(text: string): string {
    return text.replace(MENTION, (_all, name: string) => {
      const key = name.toLocaleLowerCase("tr-TR");
      let code = this.map.get(key);
      if (!code) {
        code = `K${this.next++}`;
        this.map.set(key, code);
      }
      return "@" + code;
    });
  }
}

/** Claude'a gönderilecek metni hazırlar: önce kişisel veri, sonra @takma_ad maskelenir. */
export function sanitizeForModel(text: string, masker: PseudonymMasker = new PseudonymMasker()): string {
  return masker.mask(redactPii(text ?? ""));
}
