// ALGORITMA.md §5: vekâlet (likit demokrasi) çözümü — SAF ve BELİRLENİMCİ.
//
// Yorumlar (belgelenmiş):
// - Arama sırası: her düğümde kapsam sırası (önerinin kategorileri en özelden genele, sonra "*"),
//   kapsam içinde rank ↑ (eşitlikte oluşturma zamanı, sonra kenar kimliği). Zincir derinlik öncelikli izlenir;
//   bir dal H adımda doğrudan oy veren delegeye ulaşmazsa sıradaki tercihe geçilir. Atanan oy, bu sıradaki
//   İLK doğrudan oy veren delegenin oyudur (en fazla H adım; u → d1 bir adımdır).
// - Uygun seçmen (E) olmayan delege, kenarı hiç yokmuş gibi atlanır: ne oy kaynağıdır ne de zincirin ara halkası.
//   Gerekçe (§1): oylamaya yalnızca E katılır; ör. DEL'de hariç tutulan mesaj yazarı ya da askıdaki üye,
//   kendi vekâlet tercihleriyle başkalarının oyunu da yönlendiremez. Kişi sıradaki tercihine düşer.
// - Döngüler yol üzerindeki ziyaret kümesiyle kesilir.
// - Yük (load) zincirin sonundaki, oyu uygulanan delegeye yazılır. Sınır aşılırsa sıralama, delegatörün
//   KENDİ ilk adım vekâletinin oluşturma zamanı, sonra kullanıcı kimliğidir; taşanlar `unrouted` olur
//   (başka delegeye kaydırılmaz — §5.4 "oyları kullanılmamış olur").
// - E dışındaki kişilerin doğrudan oyları sayılmaz.
// - `delegateOf` (delegatör → oyu uygulanan delege) aynı aramanın yan ürünüdür; sunucu "oyumu kim kullandı" izini
//   (myEffectiveVia) bundan alır. Böylece iz ile sayım asla ayrışmaz (ikinci bir arama kopyası yoktur).
import type { EffectiveVote, VoteChoice } from "@forum/shared";
import type { DelegationEdge } from "../core/contracts";

export interface ResolveInput {
  eligible: string[];
  direct: Map<string, VoteChoice>;
  delegations: DelegationEdge[];
  scopeOrder: string[];
  cap: number;
  maxHops: number;
  clusterOf: (userId: string) => string | null;
}

export interface ResolveOutput {
  votes: EffectiveVote[];
  unrouted: string[];
  capped: string[];
  loads: Record<string, number>;
  /** Vekâletle sayılan her oy için delegatör → oyu uygulanan delege (yalnız sunucuda; defterde yok). */
  delegateOf: Record<string, string>;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Kapsam sırasını normalleştirir: tekrarlar atılır, "*" her zaman en sona konur. */
export function normalizeScopeOrder(scopeOrder: string[]): string[] {
  const out: string[] = [];
  for (const s of scopeOrder) if (s !== "*" && !out.includes(s)) out.push(s);
  out.push("*");
  return out;
}

/** Önerinin kategorilerinden kapsam sırası: derinlik ↓ (en özel önce), eşitlikte IRI ↑, sonra "*". */
export function scopeOrderFor(categories: string[], depth: (iri: string) => number): string[] {
  const uniq = [...new Set(categories.filter((c) => c !== "*"))];
  const d = new Map(uniq.map((c) => [c, depth(c)]));
  uniq.sort((a, b) => d.get(b)! - d.get(a)! || cmp(a, b));
  return [...uniq, "*"];
}

export function resolveEffectiveVotes(input: ResolveInput): ResolveOutput {
  const eligible = new Set(input.eligible);
  const users = [...eligible].sort(cmp);
  const scopes = normalizeScopeOrder(input.scopeOrder);
  const scopeIdx = new Map(scopes.map((s, i) => [s, i]));
  const maxHops = Math.max(0, Math.floor(input.maxHops));
  const cap = Math.max(0, Math.floor(input.cap));
  const hasDirect = (u: string) => eligible.has(u) && input.direct.has(u);

  const out = new Map<string, DelegationEdge[]>();
  for (const e of input.delegations) {
    if (!scopeIdx.has(e.scope) || e.from === e.to) continue;
    let list = out.get(e.from);
    if (!list) out.set(e.from, (list = []));
    list.push(e);
  }
  for (const list of out.values()) {
    list.sort(
      (a, b) =>
        scopeIdx.get(a.scope)! - scopeIdx.get(b.scope)! || a.rank - b.rank || a.createdAt - b.createdAt || cmp(a.id, b.id),
    );
  }

  const path = new Set<string>();
  /** x düğümüne `hops` adımda ulaşıldı; tercih sırasıyla ilk doğrudan oy veren delegeyi bulur. */
  const dfs = (x: string, hops: number): string | null => {
    for (const e of out.get(x) ?? []) {
      const d = e.to;
      if (path.has(d) || !eligible.has(d)) continue;
      if (hasDirect(d)) return d;
      if (hops + 1 < maxHops) {
        path.add(d);
        const r = dfs(d, hops + 1);
        path.delete(d);
        if (r) return r;
      }
    }
    return null;
  };

  const votes: EffectiveVote[] = [];
  const demand = new Map<string, { userId: string; createdAt: number }[]>();
  for (const u of users) {
    const choice = input.direct.get(u);
    if (choice !== undefined) {
      votes.push({ voterKey: u, choice, via: "direct", clusterId: input.clusterOf(u) });
      continue;
    }
    if (maxHops < 1) continue;
    path.clear();
    path.add(u);
    for (const e of out.get(u) ?? []) {
      const d = e.to;
      if (!eligible.has(d)) continue;
      let terminal: string | null = null;
      if (hasDirect(d)) terminal = d;
      else if (maxHops > 1) {
        path.add(d);
        terminal = dfs(d, 1);
        path.delete(d);
      }
      if (terminal) {
        let list = demand.get(terminal);
        if (!list) demand.set(terminal, (list = []));
        list.push({ userId: u, createdAt: e.createdAt });
        break;
      }
    }
  }

  const unrouted: string[] = [];
  const capped: string[] = [];
  const loads: Record<string, number> = {};
  const delegateOf: Record<string, string> = {};
  for (const t of [...demand.keys()].sort(cmp)) {
    const reqs = demand.get(t)!.sort((a, b) => a.createdAt - b.createdAt || cmp(a.userId, b.userId));
    const routed = reqs.slice(0, cap);
    const choice = input.direct.get(t)!;
    for (const r of routed) {
      votes.push({ voterKey: r.userId, choice, via: "delegated", clusterId: input.clusterOf(r.userId) });
      delegateOf[r.userId] = t;
    }
    if (routed.length > 0) loads[t] = routed.length;
    if (reqs.length > cap) {
      capped.push(t);
      for (const r of reqs.slice(cap)) unrouted.push(r.userId);
    }
  }
  votes.sort((a, b) => cmp(a.voterKey, b.voterKey));
  unrouted.sort(cmp);
  return { votes, unrouted, capped, loads, delegateOf };
}
