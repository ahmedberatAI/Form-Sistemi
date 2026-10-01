// Hedef çözümlemesi: bir ifadenin KİME yöneldiğini belirleyen çevrimdışı kurallar.
// - Nefret söylemi: korunan grup adıyla aynı cümlede geçen genel bir sözcük yetmez; ifade gruba bitişik bir niteleme,
//   grubu doğrudan hedef alan bir dışlama fiili ya da açık bir düşmanlık çağrısı olmalıdır.
// - Hakaret: bir projeyi, kararı ya da kurumu "aptalca" bulmak sert ama meşru eleştiridir; yalnız kişiye yönelen sözcük sayılır.
// Kurallar belirlenimcidir (aynı metin → aynı sonuç) ve yalnızca danışma niteliğinde etiket üretir.
import {
  CRITIQUE_OBJECT_NOUNS,
  GROUP_HEAD_NOUNS,
  HATE_EPITHETS,
  HATE_EXCLUSION,
  HATE_FILLERS,
  HATE_NEGATORS,
  HATE_STRONG,
  INSULT_FILLERS,
  INSULT_WORDS,
  OBJECT_CAPABLE_INSULTS,
  PERSON_NOUNS,
  PROTECTED_GROUPS,
} from "./lexicons";
import { findPhrase, normalizeTr, sentences, stemMatch, type Token } from "./text";

export interface Span {
  start: number;
  end: number;
}

const SOFTEN: Record<string, string> = { ç: "c", p: "b", t: "d", k: "ğ" };
const norm = (xs: string[]): string[] => xs.map(normalizeTr);
const GROUPS = norm(PROTECTED_GROUPS);
const HEADS = norm(GROUP_HEAD_NOUNS);
const PERSONS = norm(PERSON_NOUNS);
const OBJECTS = norm(CRITIQUE_OBJECT_NOUNS);
const OBJECT_CAPABLE = new Set(norm(OBJECT_CAPABLE_INSULTS));
const INSULT_SINGLE = norm(INSULT_WORDS).filter((w) => !w.includes(" "));
const HATE_SKIP = new Set(norm(HATE_FILLERS));
const PREDICATE_SKIP = new Set([...HATE_SKIP, "çok", "zaten", "hep", "birer", "tam", "resmen", "gerçekten", "aslında", "ise", "bence"]);
const NEGATORS = new Set(norm(HATE_NEGATORS));
const INSULT_SKIP = new Set(norm(INSULT_FILLERS));

/** Anahtar kelimenin belirteçte kök olarak geçtiği yerden sonra kalan ek ("göçmenlerin" / "göçmen" → "lerin"). */
function suffixAfter(token: string, keyword: string): string | null {
  if (token.startsWith(keyword)) return token.slice(keyword.length);
  const last = keyword[keyword.length - 1];
  if (keyword.length >= 3 && SOFTEN[last]) {
    const soft = keyword.slice(0, -1) + SOFTEN[last];
    if (token.startsWith(soft)) return token.slice(soft.length);
  }
  return null;
}

const anyStem = (token: string, list: string[], strict = false): boolean => list.some((k) => stemMatch(token, k, strict));

/** İki belirteç arasında cümle ya da yan cümle sınırı var mı? */
function boundaryBetween(text: string, left: Token, right: Token): boolean {
  return /[.!?;:\n]/u.test(text.slice(left.end, right.start));
}

/** Fiilimsi ("kalmasını", "hissetmesini", "gelmeyi", "yapmak", "olduğunu") — dışlama fiilinin nesnesi bir eylemdir, grup değil. */
const isVerbalNoun = (t: string): boolean => /(m[ae]s[ıi]n?[ıiae]?|m[ae]y[ıi]|m[ae]k|d[ıiuü]ğ[ıiuü]n[ıiuü]?|[ae]c[ae]ğ[ıiuü]n[ıiuü]?)$/u.test(t);

/** Yer/yön bildiren hâl ekli ad ("mahalleye", "okuldan", "parkta") — dışlama fiiliyle grup arasında atlanabilir. */
const isPlaceAdverbial = (t: string): boolean => t.length >= 4 && !isVerbalNoun(t) && /([dt][ae]n?|y?[ae])$/u.test(t);

interface GroupHit {
  /** Cümle belirteç dizisindeki konum */
  i: number;
  /** İlgi hâli ("kadınların", "göçmenlerin"): grup bir eylemin sahibidir, dışlama fiilinin doğrudan nesnesi değildir. */
  genitive: boolean;
}

function groupAt(tok: string): GroupHit["genitive"] | null {
  let found = false;
  let genitive = false;
  for (const g of GROUPS) {
    if (!stemMatch(tok, g, true)) continue;
    found = true;
    const rest = suffixAfter(tok, g) ?? "";
    if (/^(l[ae]r)?(n?[ıiuü]n)$/u.test(rest)) genitive = true;
  }
  return found ? genitive : null;
}

/** Çok sözcüklü bir nitelemenin `st[i]`den başlayarak eşleşmesi; son sözcükte çoğul ve ek-fiil ("pistir", "hainler") kabul edilir. */
function epithetAt(st: Token[], i: number, phrase: string): number {
  const words = normalizeTr(phrase).split(" ");
  if (i + words.length > st.length) return -1;
  for (let j = 0; j < words.length - 1; j++) if (st[i + j].norm !== words[j]) return -1;
  const last = st[i + words.length - 1].norm;
  const rest = suffixAfter(last, words[words.length - 1]);
  if (rest === null) return -1;
  return /^(l[ae]r)?([dt][ıiuü]r)?(l[ae]r)?$/u.test(rest) ? i + words.length - 1 : -1;
}

function negatedAfter(st: Token[], end: number): boolean {
  for (let k = end + 1; k <= end + 3 && k < st.length; k++) if (NEGATORS.has(st[k].norm)) return true;
  return false;
}

/** Yüklem konumundaki niteleme yan cümleyi bitirmeli: "göçmenler pis." / "… hain, …" — "kadınlar da hayvan sahibi" değil. */
const CLAUSE_TAIL = new Set(["gibi", "gibiler", "bunlar", "hepsi", "zaten", "işte"]);
function endsClause(text: string, st: Token[], e: number): boolean {
  const next = st[e + 1];
  return !next || /[,;:.!?\n]/u.test(text.slice(st[e].end, next.start)) || CLAUSE_TAIL.has(next.norm) || NEGATORS.has(next.norm);
}

export interface HateFinding {
  spans: Span[];
  evidence: string[];
  /** Sinyal sayısı (cümle × kalıp); güven buna göre artar */
  signals: number;
  /** En az bir hedefli (bitişik niteleme ya da doğrudan dışlama) sinyal var mı? */
  targeted: boolean;
}

/** Korunan gruba yönelik nefret söylemi; yalnız hedefli kalıplar ve açık düşmanlık çağrıları. */
export function detectHate(text: string, tokens: Token[]): HateFinding {
  const out: HateFinding = { spans: [], evidence: [], signals: 0, targeted: false };
  for (const s of sentences(text)) {
    const st = tokens.filter((t) => t.start >= s.start && t.end <= s.end);
    const groups: GroupHit[] = [];
    st.forEach((t, i) => {
      const g = groupAt(t.norm);
      if (g !== null) groups.push({ i, genitive: g });
    });
    if (!groups.length) continue;
    const quote = (a: number, b: number) => text.slice(st[a].start, st[b].end);
    const found: string[] = [];
    let targeted = false;

    // 1) Açık düşmanlık çağrısı: grup adıyla aynı cümlede geçmesi yeter.
    for (const p of HATE_STRONG) {
      const h = findPhrase(st, p, { strict: true })[0];
      if (h) {
        found.push(`${quote(groups[0].i, groups[0].i)} … ${quote(h[0], h[1])}`);
        break;
      }
    }

    // 2) Bitişik aşağılayıcı niteleme: "pis göçmenler" (sıfat) ya da "göçmenler (hep) pistir" (yüklem).
    for (const g of groups) {
      let hit: [number, number] | null = null;
      for (const p of HATE_EPITHETS) {
        const words = normalizeTr(p).split(" ").length;
        const attrStart = g.i - words;
        if (attrStart >= 0) {
          const e = epithetAt(st, attrStart, p);
          if (e === g.i - 1 && !negatedAfter(st, g.i)) hit = [attrStart, g.i];
        }
        if (hit) break;
        let k = g.i + 1;
        while (k < st.length && k <= g.i + 3 && PREDICATE_SKIP.has(st[k].norm)) k++;
        if (k < st.length && k <= g.i + 3) {
          const e = epithetAt(st, k, p);
          if (e >= 0 && endsClause(text, st, e) && !negatedAfter(st, e)) hit = [g.i, e];
        }
        if (hit) break;
      }
      if (hit) {
        found.push(quote(hit[0], hit[1]));
        targeted = true;
        break;
      }
    }

    // 3) Doğrudan dışlama: grup (ya da "göçmen çocuklar" gibi grup + baş ad) fiilin hemen öncesinde; araya yalnız
    //    belirteç/yer bildiren sözcükler girebilir. İlgi hâlindeki grup ve fiilimsi nesne ("… kalmasını istemiyoruz") sayılmaz.
    const isGroup = new Map(groups.map((g) => [g.i, g] as const));
    let excluded = false;
    for (const p of HATE_EXCLUSION) {
      for (const [a, b] of findPhrase(st, p, { strict: true })) {
        let target = -1;
        for (let k = a - 1, steps = 0; k >= 0 && steps < 4; k--, steps++) {
          const t = st[k].norm;
          const g = isGroup.get(k);
          if (g) {
            // "Biz kadınlar artık istemiyoruz": grup öznedir (konuşanın kendisi), dışlanan değil.
            const subject = k > 0 && ["biz", "bizler", "siz", "sizler"].includes(st[k - 1].norm);
            if (!g.genitive && !subject) target = k;
            break;
          }
          if (anyStem(t, HEADS, true)) {
            const prev = isGroup.get(k - 1);
            const rest = HEADS.map((h) => suffixAfter(t, h)).find((r) => r !== null) ?? "";
            if (prev && !prev.genitive && !/^(l[ae]r)?(n?[ıiuü]n)$/u.test(rest)) target = k - 1;
            break;
          }
          if (HATE_SKIP.has(t) || isPlaceAdverbial(t)) continue;
          break;
        }
        if (target >= 0) {
          found.push(quote(target, b));
          targeted = excluded = true;
          break;
        }
      }
      if (excluded) break;
    }

    if (found.length) {
      out.spans.push({ start: s.start, end: s.end });
      out.evidence.push(...found);
      out.signals += found.length;
      out.targeted ||= targeted;
    }
  }
  return out;
}

export interface InsultFinding {
  spans: Span[];
  quotes: string[];
  /** Nesneye (proje, karar, kurum) yönelik olduğu için sayılmayan ifadeler — yalnız gerekçede anılır. */
  objectDirected: string[];
}

/** Hakaret sözcüğü bir nesneyi mi niteliyor? Kişiye yönelikse (varsayılan) false. */
function objectDirected(text: string, tokens: Token[], a: number, b: number, word: string): boolean {
  const lastWord = word.split(" ").pop()!;
  const rest = suffixAfter(tokens[b].norm, lastWord) ?? "";
  // "aptalsın", "aptallar": kişiye yönelik çekim ekleri.
  if (/^(s[ıiuü]n|s[ıiuü]n[ıiuü]z|l[ae]r)/u.test(rest)) return false;
  // "aptalca", "salakça", "salaklık": davranış ya da fikir nitelemesi.
  if (/^([cç][ae]|l[ıiuü][kğ])/u.test(rest)) return true;
  // İleriye bak (virgülde durur): "aptal (ve saçma) bir proje", "aptal belediye düzeni", "aptal kişisel veri politikası";
  // "aptal belediye başkanı", "aptal kişiler", "aptal mısın" ise kişidir. Ad öbeğinde en çok iki niteleyici atlanır.
  for (let k = b + 1, unknown = 0; k < tokens.length && unknown <= 2; k++) {
    if (/[,.!?;:\n]/u.test(text.slice(tokens[k - 1].end, tokens[k].start))) break;
    const t = tokens[k].norm;
    if (k === b + 1 && /^m[ıiuü]s[ıiuü]n/u.test(t)) return false;
    // "aptal yerine koymak" deyimi: birine hakaret değil, saygısızlıktan yakınma.
    if (k === b + 1 && t === "yerine" && /^koy/u.test(tokens[k + 1]?.norm ?? "")) return true;
    if (INSULT_SKIP.has(t) || anyStem(t, INSULT_SINGLE)) continue;
    if (anyStem(t, PERSONS)) return false;
    if (anyStem(t, OBJECTS)) {
      const next = tokens[k + 1];
      return !(next && !boundaryBetween(text, tokens[k], next) && anyStem(next.norm, PERSONS));
    }
    unknown++;
  }
  // Geriye bak: "bu karar (gerçekten çok) aptal" yüklemi; "bunu savunan herkes aptal" ise kişidir.
  for (let k = a - 1; k >= 0 && k >= a - 4; k--) {
    if (boundaryBetween(text, tokens[k], tokens[k + 1])) break;
    const t = tokens[k].norm;
    if (INSULT_SKIP.has(t) || anyStem(t, INSULT_SINGLE)) continue;
    if (anyStem(t, PERSONS)) return false;
    if (anyStem(t, OBJECTS)) return true;
    break;
  }
  return false;
}

/** Kişiye yönelik hakaret sözcükleri; nesneye yönelik sert eleştiri ayrıca döndürülür ama etiketlenmez. */
export function detectInsults(text: string, tokens: Token[]): InsultFinding {
  const out: InsultFinding = { spans: [], quotes: [], objectDirected: [] };
  for (const w of INSULT_WORDS) {
    const wn = normalizeTr(w);
    for (const [a, b] of findPhrase(tokens, w)) {
      const s = { start: tokens[a].start, end: tokens[b].end };
      if (out.spans.some((x) => x.start === s.start && x.end === s.end)) continue;
      const q = text.slice(s.start, s.end);
      if (OBJECT_CAPABLE.has(wn) && objectDirected(text, tokens, a, b, wn)) {
        if (!out.objectDirected.includes(q)) out.objectDirected.push(q);
        continue;
      }
      out.spans.push(s);
      out.quotes.push(q);
    }
  }
  return out;
}
