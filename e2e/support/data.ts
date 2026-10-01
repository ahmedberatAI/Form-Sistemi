// Test verisi üreteçleri: benzersiz takma ad, algoritmaya uygun (uydurma) T.C. kimlik numarası, iletişim bilgileri.
// Uydurma kimlik bilgileri yalnızca kimlik kasasına gider; testler bunların hiçbir herkese açık yerde görünmediğini de denetler.

/** 11 haneli, algoritma denetiminden geçen uydurma T.C. kimlik numarası (shared/src/tckn.ts ile aynı kural). */
export function fakeTckn(seed: number): string {
  const digits = String(100_000_000 + (Math.abs(seed) % 899_999_999)).slice(0, 9).split("").map(Number);
  if (digits[0] === 0) digits[0] = 1;
  const odd = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const even = digits[1] + digits[3] + digits[5] + digits[7];
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  const d11 = (digits.reduce((a, b) => a + b, 0) + d10) % 10;
  return digits.join("") + String(d10) + String(d11);
}

export interface NewMember {
  nickname: string;
  password: string;
  firstName: string;
  lastName: string;
  tckn: string;
  birthDate: string;
  email: string;
  phone: string;
  il: string;
  ilce: string;
  mahalle: string;
  acikAdres: string;
}

/** Her çalıştırmada farklı (tohumdaki hesaplarla çakışmayan) yeni üye bilgileri. */
export function newMember(prefix = "deneme"): NewMember {
  const n = Date.now() % 1_000_000_000;
  const tag = n.toString(36);
  return {
    nickname: `${prefix}_${tag}`,
    password: "Deneme2026!",
    firstName: "Gülşen",
    lastName: "Öztürkoğlu",
    tckn: fakeTckn(n * 7 + 13),
    birthDate: "1991-04-23",
    email: `${prefix}.${tag}@ornek.test`,
    phone: `0532${String(n % 10_000_000).padStart(7, "0")}`,
    il: "Ankara",
    ilce: "Çankaya",
    mahalle: "Kızılay",
    acikAdres: "Deneme Sokak No: 5 Daire: 3",
  };
}
