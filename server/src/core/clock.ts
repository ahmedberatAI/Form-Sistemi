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
