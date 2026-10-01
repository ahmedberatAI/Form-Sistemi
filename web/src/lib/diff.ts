// İki metin arasında fark (LCS). Satır düzeyi ve kelime düzeyi.
// Çıktı: { type: "same" | "add" | "del", text }[]  (ardışık aynı türler birleştirilmiş).

export type DiffType = "same" | "add" | "del";

export interface DiffPart {
  type: DiffType;
  text: string;
}

/** Satır düzeyi fark satırı; değişen satır çiftlerinde kelime düzeyi ayrıntı (`words`) bulunur. */
export interface DiffLine {
  type: DiffType;
  text: string;
  /** Yalnızca bir "del" satırının hemen karşılığı olan "add" satırında (ve tersi): satır içi kelime farkı */
  words?: DiffPart[];
}

const MAX_CELLS = 4_000_000;

/** Genel LCS farkı: token dizileri üzerinde. */
function diffTokens(a: string[], b: string[]): { type: DiffType; token: string }[] {
  // Ortak önek / sonek kırp (performans)
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: { type: DiffType; token: string }[] = [];
  for (let i = 0; i < start; i++) out.push({ type: "same", token: a[i] });
  const ma = a.slice(start, endA);
  const mb = b.slice(start, endB);
  const n = ma.length;
  const m = mb.length;
  if (n === 0 || m === 0 || n * m > MAX_CELLS) {
    // Çok büyükse kaba fark: hepsi silindi + hepsi eklendi
    for (const t of ma) out.push({ type: "del", token: t });
    for (const t of mb) out.push({ type: "add", token: t });
  } else {
    // dp[i][j] = ma[i..] ve mb[j..] için LCS uzunluğu
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = ma[i] === mb[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (ma[i] === mb[j]) {
        out.push({ type: "same", token: ma[i] });
        i++;
        j++;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
        out.push({ type: "del", token: ma[i++] });
      } else {
        out.push({ type: "add", token: mb[j++] });
      }
    }
    while (i < n) out.push({ type: "del", token: ma[i++] });
    while (j < m) out.push({ type: "add", token: mb[j++] });
  }
  for (let i = endA; i < a.length; i++) out.push({ type: "same", token: a[i] });
  return out;
}

function splitLines(s: string): string[] {
  if (!s) return [];
  return s.replace(/\r\n?/g, "\n").split("\n");
}

/** Kelime ve boşlukları ayrı token yapar (boşluklar korunur, metin birebir yeniden kurulabilir). */
function splitWords(s: string): string[] {
  return s.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
}

function merge(parts: { type: DiffType; token: string }[], sep: string): DiffPart[] {
  const out: DiffPart[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && last.type === p.type) last.text += sep + p.token;
    else out.push({ type: p.type, text: p.token });
  }
  return out;
}

/** Kelime düzeyi fark (satır içi vurgulama için). Ardışık aynı türler birleştirilir. */
export function diffWords(a: string, b: string): DiffPart[] {
  return merge(diffTokens(splitWords(a), splitWords(b)), "");
}

/** Satır düzeyi fark: her eleman TEK satırdır (birleştirilmez). */
export function diffLines(a: string, b: string): DiffPart[] {
  return diffTokens(splitLines(a), splitLines(b)).map((p) => ({ type: p.type, text: p.token }));
}

/**
 * Satır + kelime düzeyi fark. Ardışık "del" bloğu ile hemen ardından gelen "add" bloğu satır satır
 * eşleştirilir ve eşleşen satırlara `words` (kelime farkı) eklenir.
 */
export function diffText(a: string, b: string): DiffLine[] {
  const lines = diffLines(a, b);
  const out: DiffLine[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type !== "del") {
      out.push({ ...lines[i] });
      i++;
      continue;
    }
    const dels: string[] = [];
    while (i < lines.length && lines[i].type === "del") dels.push(lines[i++].text);
    const adds: string[] = [];
    while (i < lines.length && lines[i].type === "add") adds.push(lines[i++].text);
    const pairs = Math.min(dels.length, adds.length);
    for (let k = 0; k < dels.length; k++) {
      out.push(k < pairs ? { type: "del", text: dels[k], words: diffWords(dels[k], adds[k]).filter((p) => p.type !== "add") } : { type: "del", text: dels[k] });
    }
    for (let k = 0; k < adds.length; k++) {
      out.push(k < pairs ? { type: "add", text: adds[k], words: diffWords(dels[k], adds[k]).filter((p) => p.type !== "del") } : { type: "add", text: adds[k] });
    }
  }
  return out;
}

/** Fark istatistiği (ör. "+3 / −1 satır"). */
export function diffStats(lines: DiffPart[] | DiffLine[]): { added: number; removed: number; same: number } {
  let added = 0;
  let removed = 0;
  let same = 0;
  for (const l of lines) {
    if (l.type === "add") added++;
    else if (l.type === "del") removed++;
    else same++;
  }
  return { added, removed, same };
}
