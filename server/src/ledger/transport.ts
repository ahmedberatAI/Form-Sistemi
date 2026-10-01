// Doğrulayıcılar arası mesaj ağı soyutlaması ve bellek içi uygulaması.
// Bellek içi ağ her mesajı alıcı başına kopyalar (structuredClone): düğümler nesne paylaşmaz,
// tıpkı ayrı makinelerdeymiş gibi. Gecikme, titreşim ve kayıp tohumlu RNG ile enjekte edilebilir.
import { createRng, type Rng } from "@forum/shared";
import type { NetMessage } from "./types";

export type MessageHandler = (from: string, msg: NetMessage) => void;

export interface Transport {
  attach(nodeId: string, handler: MessageHandler): void;
  detach(nodeId: string): void;
  send(from: string, to: string, msg: NetMessage): void;
  broadcast(from: string, msg: NetMessage): void;
  /** Bekleyen tüm teslimatları iptal eder. */
  close(): void;
}

export interface LinkConditions {
  /** Sabit gecikme (ms) */
  delayMs?: number;
  /** 0..jitterMs arası ek rastgele gecikme (sıra bozulabilir) */
  jitterMs?: number;
  /** [0,1] mesaj kaybı olasılığı */
  dropRate?: number;
}

export class MemoryTransport implements Transport {
  private readonly handlers = new Map<string, MessageHandler>();
  private readonly timeouts = new Set<NodeJS.Timeout>();
  private readonly immediates = new Set<NodeJS.Immediate>();
  private readonly links = new Map<string, LinkConditions>();
  private conditions: LinkConditions;
  private readonly rng: Rng;
  private closed = false;
  readonly stats = { sent: 0, delivered: 0, dropped: 0 };

  constructor(opts: LinkConditions & { seed?: string } = {}) {
    const { seed, ...conditions } = opts;
    this.conditions = conditions;
    this.rng = createRng(seed ?? "defter-ağı");
  }

  /** Tüm bağlantılar ya da (from → to) bağlantısı için ağ koşullarını ayarlar. */
  setConditions(c: LinkConditions, from?: string, to?: string): void {
    if (from === undefined && to === undefined) {
      this.conditions = c;
      this.links.clear();
    } else {
      this.links.set(`${from ?? "*"}>${to ?? "*"}`, c);
    }
  }

  private conditionsFor(from: string, to: string): LinkConditions {
    return this.links.get(`${from}>${to}`) ?? this.links.get(`${from}>*`) ?? this.links.get(`*>${to}`) ?? this.conditions;
  }

  attach(nodeId: string, handler: MessageHandler): void {
    this.handlers.set(nodeId, handler);
  }

  detach(nodeId: string): void {
    this.handlers.delete(nodeId);
  }

  send(from: string, to: string, msg: NetMessage): void {
    if (this.closed || from === to || !this.handlers.has(to)) return;
    this.stats.sent++;
    const c = this.conditionsFor(from, to);
    if (c.dropRate && this.rng.next() < c.dropRate) {
      this.stats.dropped++;
      return;
    }
    const copy = structuredClone(msg);
    const delay = (c.delayMs ?? 0) + (c.jitterMs ? this.rng.int(Math.floor(c.jitterMs) + 1) : 0);
    const deliver = () => {
      if (this.closed) return;
      const h = this.handlers.get(to);
      if (!h) return;
      this.stats.delivered++;
      try {
        h(from, copy);
      } catch (e) {
        // Bir düğümdeki hata ağı durdurmamalı; ama gizlenmemeli.
        console.error(`[defter] ${to} mesajı işlerken hata:`, e);
      }
    };
    if (delay > 0) {
      const t = setTimeout(() => {
        this.timeouts.delete(t);
        deliver();
      }, delay);
      this.timeouts.add(t);
    } else {
      const im = setImmediate(() => {
        this.immediates.delete(im);
        deliver();
      });
      this.immediates.add(im);
    }
  }

  broadcast(from: string, msg: NetMessage): void {
    for (const to of this.handlers.keys()) if (to !== from) this.send(from, to, msg);
  }

  close(): void {
    this.closed = true;
    for (const t of this.timeouts) clearTimeout(t);
    for (const im of this.immediates) clearImmediate(im);
    this.timeouts.clear();
    this.immediates.clear();
    this.handlers.clear();
  }

  pendingDeliveries(): number {
    return this.timeouts.size + this.immediates.size;
  }
}
