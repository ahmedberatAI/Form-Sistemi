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

/** Kalıcı simüle saat durumu (meta.sim_clock). */
export interface SimClockState {
  simNow: number;
  advancedTotal: number;
  /**
   * Çalışırken yazılan kayıtlarda: bir sonraki kalıcılaştırmaya dek verilebilecek en geç simüle zaman (kira). Sert kapanışta
   * (çökme, taskkill /F) son kayıttan sonra verilen zaman damgaları bunu aşamaz. Düzgün kapanışta yazılmaz (saat tam kaydedilir).
   */
  leaseUntil?: number;
}

/**
 * Yeniden açılışta simüle saatin başlayacağı an (#281). Saat ASLA geri gitmez: kayıtlı an, kira üst sınırı ve veritabanındaki
 * en son olay zamanının (+1 ms) en büyüğü. Kayıt yoksa (ilk açılış) gerçek saatten başlar; yine de mevcut kayıtların gerisine düşmez.
 * Düzgün kapanıştan sonra kayıtlı an aynen sürer (sunucu kapalıyken simüle zaman ilerlemez).
 */
export function resumeSimTime(saved: SimClockState | null, latestRecorded: number | null, realNow: number): number {
  const candidates = [saved ? saved.simNow : realNow];
  if (saved && typeof saved.leaseUntil === "number" && Number.isFinite(saved.leaseUntil)) candidates.push(saved.leaseUntil);
  if (latestRecorded !== null && Number.isFinite(latestRecorded)) candidates.push(latestRecorded + 1);
  return Math.max(...candidates);
}

/**
 * Hızlandırılmış simüle saat (demo): simüle zaman gerçek zamandan `scale` kat hızlı akar
 * (TIME_SCALE=60 → 1 saat = 1 dakika). Süreler ALGORITMA.md'deki gerçek saat değerleriyle hesaplanır;
 * takvim tutarlı kalır (ör. 72 saatlik tartışma gerçek zamanda 72 dakika sürer).
 * Sunucu kapalıyken simüle zaman ilerlemez: kalıcılık için `snapshot()` meta tablosuna yazılır ve
 * yeniden başlatmada `startSim` olarak verilir.
 * Çalışırken de geri gitmez: duvar saati geri adım atarsa (ör. işletim sisteminin zaman eşitlemesi) hesaplanan an son verilen
 * andan küçük olur; o zaman son an verilir (saat, duvar saati yeniden yetişene dek durur). Yoksa TIME_SCALE ile çarpılan geri
 * adım yeni kayıtlara mevcutlardan eski zaman damgası verdirir ve "en son kayıt" sıralamaları bozulurdu.
 */
export class ScaledClock implements Clock {
  private simAnchor: number;
  private realAnchor: number;
  private advanced: number;
  /** Şimdiye dek verilen en büyük an (monotonluk). */
  private last = Number.NEGATIVE_INFINITY;
  constructor(
    private readonly opts: {
      scale: number;
      startSim: number;
      advancedTotal?: number;
      /**
       * false: advance() saati ileri alır ama "yönetici ileri aldı" toplamına (advancedTotal) eklenmez.
       * Tohum verisi gibi senaryo motorları zamanı böyle ilerletir; varsayılan true.
       */
      countAdvances?: boolean;
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
    const t = Math.floor(this.simAnchor + (this.real() - this.realAnchor) * this.opts.scale);
    if (t > this.last) this.last = t;
    return this.last;
  }
  advance(ms: number): void {
    if (!(ms > 0)) throw new Error("advance: ms > 0 olmalı");
    this.simAnchor += ms;
    // Saat (geri adım yüzünden) son verilen anda bekliyorsa da ileri alma tam ms kadar etkili olur.
    if (Number.isFinite(this.last)) this.last += ms;
    if (this.opts.countAdvances !== false) this.advanced += ms;
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
