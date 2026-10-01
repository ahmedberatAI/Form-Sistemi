// Simüle edilebilir saat. Demo için yönetici zamanı ileri alabilir; tüm modüller Date.now() yerine bunu kullanır.
export interface Clock {
  now(): number;
  /** Saati ms kadar ileri alır (geri alınamaz). */
  advance(ms: number): void;
  offset(): number;
}

export class SimClock implements Clock {
  private off: number;
  constructor(
    initialOffset = 0,
    private readonly base: () => number = () => Date.now(),
    private readonly onChange?: (offset: number) => void,
  ) {
    this.off = initialOffset;
  }
  now(): number {
    return this.base() + this.off;
  }
  advance(ms: number): void {
    if (!(ms > 0)) throw new Error("advance: ms > 0 olmalı");
    this.off += ms;
    this.onChange?.(this.off);
  }
  offset(): number {
    return this.off;
  }
}

/** Testler için tamamen elle ilerletilen saat. */
export class ManualClock implements Clock {
  constructor(private t = Date.UTC(2026, 9, 1, 9, 0, 0)) {}
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(t: number): void {
    this.t = t;
  }
  offset(): number {
    return 0;
  }
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/**
 * Hızlandırılmış simüle saat (demo): simüle zaman gerçek zamandan `scale` kat hızlı akar
 * (TIME_SCALE=60 → 1 saat = 1 dakika). Süreler ALGORITMA.md'deki gerçek saat değerleriyle hesaplanır;
 * takvim tutarlı kalır (ör. 72 saatlik tartışma gerçek zamanda 72 dakika sürer).
 * Sunucu kapalıyken simüle zaman ilerlemez: kalıcılık için `snapshot()` meta tablosuna yazılır ve
 * yeniden başlatmada `startSim` olarak verilir.
 */
export class ScaledClock implements Clock {
  private simAnchor: number;
  private realAnchor: number;
  private advanced: number;
  constructor(
    private readonly opts: {
      scale: number;
      startSim: number;
      advancedTotal?: number;
      realNow?: () => number;
      onChange?: (state: { simNow: number; advancedTotal: number }) => void;
    },
  ) {
    if (!(opts.scale > 0)) throw new Error("ScaledClock: scale > 0 olmalı");
    this.simAnchor = opts.startSim;
    this.realAnchor = this.real();
    this.advanced = opts.advancedTotal ?? 0;
  }
  private real(): number {
    return (this.opts.realNow ?? Date.now)();
  }
  now(): number {
    return Math.floor(this.simAnchor + (this.real() - this.realAnchor) * this.opts.scale);
  }
  advance(ms: number): void {
    if (!(ms > 0)) throw new Error("advance: ms > 0 olmalı");
    this.simAnchor += ms;
    this.advanced += ms;
    this.opts.onChange?.(this.snapshot());
  }
  /** Yönetici tarafından toplam ileri alınan süre (ms) */
  offset(): number {
    return this.advanced;
  }
  scale(): number {
    return this.opts.scale;
  }
  snapshot(): { simNow: number; advancedTotal: number } {
    return { simNow: this.now(), advancedTotal: this.advanced };
  }
}
