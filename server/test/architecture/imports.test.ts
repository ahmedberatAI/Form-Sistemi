// Mimari sınır testi (#91, #171, #240): import ifadelerini tarayıp katman yönlerini zorlar.
// Kurallar kaynak dosyalardaki gerçek import'lardan okunur; yeni bir ihlal bu testi kırar. İstisnalar aşağıda gerekçesiyle belirtilmiştir.
//   1. shared/src, server ya da web'den hiçbir şey içe aktarmaz (paylaşılan çekirdek bağımsızdır).
//   2. server/src/forum, ../ai iç yapısını içe aktarmaz (YZ'ye yalnız core sözleşmeleri / AiRecordSink üzerinden erişir).
//   3. server/src/http/routes yalnız servisleri/sözleşmeleri/yardımcıları kullanır: doğrudan SQL katmanını (../../db) ve node:sqlite'ı
//      içe aktarmaz (yalnız `import type` serbest); core/ dışındaki modüllere yalnızca aşağıdaki kayıtlı saf yardımcılar için erişir.
//   4. web/src/ui ve web/src/lib, web/src/pages ya da web/src/components içe aktarmaz (alt katman üst katmana bağlanmaz).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");

interface Imp {
  /** Kaynaktaki ham belirteç. */
  spec: string;
  /** Göreli ise depo köküne göre normalize yol (ör. "server/src/db/index"); değilse null. */
  target: string | null;
  /** import type / export type ya da yalnız `type X` belirteçleri: çalışma zamanında silinir. */
  typeOnly: boolean;
}

/** Yorum satırlarını ve blok yorumlarını ayıklar (yorumdaki örnek import'lar sayılmasın). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Bir kaynak metindeki import / export-from / dinamik import ifadeleri. `file` göreli çözümleme içindir (depo köküne göre). */
export function parseImports(source: string, file: string): Imp[] {
  const src = stripComments(source);
  const out: Imp[] = [];
  const resolveSpec = (spec: string): string | null =>
    spec.startsWith(".") ? relative(ROOT, resolve(dirname(join(ROOT, file)), spec)).split(sep).join("/") : null;

  const statement = /(?:^|[\n;])\s*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']/g;
  for (const m of src.matchAll(statement)) {
    const clause = m[3];
    const braces = /^\{([\s\S]*)\}$/.exec(clause.trim());
    const allInlineType = !!braces && braces[1].split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "));
    out.push({ spec: m[4], target: resolveSpec(m[4]), typeOnly: !!m[2] || allInlineType });
  }
  for (const m of src.matchAll(/(?:^|[\n;])\s*import\s*["']([^"']+)["']/g)) out.push({ spec: m[1], target: resolveSpec(m[1]), typeOnly: false });
  for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push({ spec: m[1], target: resolveSpec(m[1]), typeOnly: false });
  return out;
}

function listSources(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    if (name === "node_modules" || name === "dist") continue;
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...listSources(rel));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(rel);
  }
  return out;
}

const within = (target: string | null, dir: string): boolean => target !== null && (target === dir || target.startsWith(`${dir}/`));

/** Kuralı dizindeki her dosyaya uygular; her ihlal "dosya → belirteç (neden)" olarak döner. */
function violations(dir: string, rule: (imp: Imp, file: string) => string | null): string[] {
  const files = listSources(dir);
  expect(files.length, `${dir} altında kaynak bulunamadı (tarama boş geçiyor olabilir)`).toBeGreaterThan(0);
  const out: string[] = [];
  for (const file of files) {
    for (const imp of parseImports(readFileSync(join(ROOT, file), "utf8"), file)) {
      const why = rule(imp, file);
      if (why) out.push(`${file} → ${imp.spec} (${why})`);
    }
  }
  return out;
}

describe("mimari: import yönleri", () => {
  it("shared/src server ya da web'den hiçbir şey içe aktarmaz", () => {
    const bad = violations("shared/src", (imp) => {
      if (/^@forum\/(server|web|e2e)(\/|$)/.test(imp.spec)) return "paylaşılan çekirdek uygulamalara bağlanamaz";
      if (imp.target !== null && !within(imp.target, "shared/src")) return "shared/src dışına çıkıyor";
      return null;
    });
    expect(bad).toEqual([]);
  });

  it("server/src/forum ../ai iç yapısını içe aktarmaz (yalnız core sözleşmeleri)", () => {
    const bad = violations("server/src/forum", (imp) => (within(imp.target, "server/src/ai") ? "YZ iç yapısı; AiRecordSink/AiService sözleşmesi core'dan gelir" : null));
    expect(bad).toEqual([]);
  });

  // İstisnalar (neden): ikisi de durumsuz, saf yardımcı işlevlerdir (SQL/servis durumu yok); servis katmanına taşımak yapay bir sarmalayıcı olurdu.
  //   - forum/lifecycle: failedProposalIds (Transition dizisinden başarısız kimlikleri süzer)
  //   - forum/clusters: anonymizeClusterView (küme görünümünden kimlik izlerini kaldırır — KVKK)
  const PURE_HELPERS = new Set(["server/src/forum/lifecycle", "server/src/forum/clusters"]);

  it("server/src/http/routes doğrudan SQL katmanına bağlanmaz; yalnız servis/sözleşme/yardımcı", () => {
    const bad = violations("server/src/http/routes", (imp) => {
      if (/^node:sqlite$/.test(imp.spec)) return "ham SQLite";
      if (imp.target === null) return null; // fastify, zod, @forum/shared, node:* ...
      if (within(imp.target, "server/src/db")) return imp.typeOnly ? null : "doğrudan SQL katmanı; sorgu bir servise taşınmalı";
      if (within(imp.target, "server/src/http") || within(imp.target, "server/src/core")) return null;
      if (PURE_HELPERS.has(imp.target)) return null;
      return "servis/sözleşme dışı modül (core sözleşmeleri üzerinden kullanın)";
    });
    expect(bad).toEqual([]);
  });

  it("web/src/ui ve web/src/lib, pages ya da components içe aktarmaz", () => {
    for (const dir of ["web/src/ui", "web/src/lib"]) {
      const bad = violations(dir, (imp) => {
        if (within(imp.target, "web/src/pages") || within(imp.target, "web/src/components")) return "alt katman üst katmanı içe aktaramaz";
        return null;
      });
      expect(bad).toEqual([]);
    }
  });
});

describe("mimari: tarayıcının kendisi", () => {
  const f = "server/src/http/routes/x.ts";
  it("çok satırlı, tür-yalnız, yan etkili ve dinamik import'ları ayıklar; yorumdakileri saymaz", () => {
    const src = [
      '// import { gizli } from "../../db";',
      '/* import yok from "../../ai"; */',
      'import type { A } from "../../db";',
      'import { type B, type C } from "../../db/index";',
      "import {",
      "  json,",
      "  type Db,",
      '} from "../../db";',
      'import "./yanetki";',
      'export { z } from "../types";',
      'const m = await import("../../ai");',
    ].join("\n");
    const imps = parseImports(src, f);
    expect(imps.map((i) => [i.target, i.typeOnly])).toEqual([
      ["server/src/db", true],
      ["server/src/db/index", true],
      ["server/src/db", false],
      ["server/src/http/types", false],
      ["server/src/http/routes/yanetki", false],
      ["server/src/ai", false],
    ]);
  });

  it("ihlal örneği yakalanır: routes içinde doğrudan db import'u", () => {
    const [imp] = parseImports('import { json } from "../../db";', f);
    expect(within(imp.target, "server/src/db") && !imp.typeOnly).toBe(true);
  });
});
