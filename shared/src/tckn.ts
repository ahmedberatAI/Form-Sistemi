// T.C. Kimlik Numarası algoritmik doğrulaması.
// DİKKAT: Bu yalnızca biçim kontrolüdür; kimlik DOĞRULAMASI değildir (kayıt memuru yüz yüze doğrular).

export function isValidTckn(input: string): boolean {
  const s = (input ?? "").replace(/\D/g, "");
  if (s.length !== 11 || s[0] === "0") return false;
  const d = s.split("").map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  if (d10 !== d[9]) return false;
  const d11 = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d11 === d[10];
}

export function maskTckn(input: string): string {
  const s = (input ?? "").replace(/\D/g, "");
  if (s.length !== 11) return "***********";
  return s.slice(0, 3) + "******" + s.slice(9);
}

/** Geçerli bir TCKN üretir (yalnızca demo / test verisi için). */
export function generateTckn(first9: string): string {
  const d = first9.replace(/\D/g, "").slice(0, 9).padEnd(9, "1").split("").map(Number);
  if (d[0] === 0) d[0] = 1;
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  const d11 = (d.reduce((a, b) => a + b, 0) + d10) % 10;
  return d.join("") + String(d10) + String(d11);
}

/** Yaş hesabı (tam yıl), referans zamanına göre. */
export function ageOn(birthDate: string, at: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) return -1;
  const ref = new Date(at);
  let age = ref.getUTCFullYear() - Number(m[1]);
  const md = (ref.getUTCMonth() + 1) * 100 + ref.getUTCDate();
  if (md < Number(m[2]) * 100 + Number(m[3])) age--;
  return age;
}
