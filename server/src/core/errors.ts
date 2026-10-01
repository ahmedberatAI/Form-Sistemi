// Uygulama hataları: HTTP durum kodu + makine kodu + Türkçe mesaj.
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (code: string, msg: string, details?: unknown) => new AppError(400, code, msg, details);
export const unauthorized = (msg = "Oturum açmanız gerekiyor.") => new AppError(401, "unauthorized", msg);
export const forbidden = (msg = "Bu işlem için yetkiniz yok.") => new AppError(403, "forbidden", msg);
export const notFound = (what = "Kayıt") => new AppError(404, "not_found", `${what} bulunamadı.`);
export const conflict = (code: string, msg: string, details?: unknown) => new AppError(409, code, msg, details);
export const unprocessable = (code: string, msg: string, details?: unknown) => new AppError(422, code, msg, details);
