// Bu cihazda, oturum sahibine göre anahtarlı küçük kayıtlar için eşzamanlı depo (web ve Android WebView'da localStorage).
// Kişisel sıralamanın cihazda kalan iki girdisi bunu kullanır: "son açılanlar" (lib/recentOpened) ve 'Size göre' seçiminin
// hatırlanması (lib/personalSort). Hiçbir işlev fırlatmaz: depo erişilemezse (gizli pencere, engelli site verisi, sunucu tarafı
// çizim ve birim testi) okuma boş döner, yazma sessizce atlanır; arayüz yalnız varsayılan davranışa döner.

/** localStorage'ın kullanılan alt kümesi (birim testlerde bellek içi bir sahte verilir). */
export interface DeviceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let override: DeviceStore | null = null;

/** YALNIZ testler için: depoyu değiştirir (null → gerçek localStorage). */
export function setDeviceStoreForTests(store: DeviceStore | null): void {
  override = store;
}

/** Etkin depo; yoksa null. */
export function deviceStore(): DeviceStore | null {
  if (override) return override;
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readDevice(key: string): string | null {
  try {
    return deviceStore()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeDevice(key: string, value: string): void {
  try {
    deviceStore()?.setItem(key, value);
  } catch {
    /* kota dolu ya da depo kapalı: bu oturumda varsayılan davranış */
  }
}

export function removeDevice(key: string): void {
  try {
    deviceStore()?.removeItem(key);
  } catch {
    /* yok say */
  }
}

/** Bellek içi depo (testler ve sunucu tarafı çizim için). */
export function memoryDeviceStore(): DeviceStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}
