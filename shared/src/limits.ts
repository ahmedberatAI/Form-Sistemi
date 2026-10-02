// Metin alanı uzunluk sınırlarının TEK kaynağı: arayüz (maxLength/ipucu), HTTP şeması (zod) ve alan servisleri
// aynı değerleri kullanır; böylece bir katmanın kabul ettiği girdiyi diğeri reddetmez.
// min yoksa alan için alt sınır servis kuralı değil, "boş olmasın" (HTTP) düzeyindedir.
export const TEXT_LIMITS = {
  /** Metin önerisi (öneri gövdesi PROPOSAL_TEXT_LIMITS.bodyMax ile uyumlu: 20000). */
  suggestion: { min: 10, max: 20_000 },
  /** İtiraz gerekçesi açıklaması. */
  objection: { min: 20, max: 2_000 },
  /** Azınlık raporu. */
  minorityReport: { min: 50, max: 5_000 },
  /** Bilirkişiye sorulan soru. */
  expertQuestion: { min: 10, max: 1_000 },
  /** Bilirkişi başvurusundaki yeterlilik açıklaması. */
  expertCredentials: { min: 3, max: 5_000 },
  /** Bilirkişinin görevden çekinme gerekçesi. */
  expertRecuseReason: { max: 1_000 },
  /** Bilirkişi raporu: gerekçeli metin, tek bir risk, tek bir soru yanıtı, karşı görüş. */
  expertReportBody: { min: 50, max: 20_000 },
  expertReportRisk: { max: 1_000 },
  expertReportAnswer: { max: 5_000 },
  expertReportDissent: { max: 10_000 },
} as const;
