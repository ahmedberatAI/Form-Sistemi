// zod ile istek doğrulaması: Türkçe hata iletileri ve `{error:{code:"validation", details:{alan: ileti}}}` biçimi.
import { z } from "zod";
import { AppError } from "../core/errors";

const trLocale = z.locales.tr();

const TYPE_NAMES: Record<string, string> = {
  string: "metin",
  number: "sayı",
  int: "tam sayı",
  bigint: "tam sayı",
  boolean: "doğru/yanlış değeri",
  array: "liste",
  object: "nesne",
  date: "tarih",
  null: "boş değer",
  nan: "sayı",
};

const typeName = (t: string): string => TYPE_NAMES[t] ?? t;

function sizeUnit(origin: string): "karakter" | "öğe" | null {
  if (origin === "string") return "karakter";
  if (origin === "array" || origin === "set") return "öğe";
  return null;
}

/** Varsayılan (teknik) zod iletilerinin yerine kullanıcıya gösterilebilir Türkçe iletiler. */
export const turkishErrorMap: z.core.$ZodErrorMap = (iss) => {
  switch (iss.code) {
    case "invalid_type":
      if (iss.input === undefined) return "Bu alan zorunludur.";
      return `Geçersiz değer: ${typeName(String(iss.expected))} bekleniyordu.`;
    case "too_small": {
      const min = Number(iss.minimum);
      const unit = sizeUnit(iss.origin);
      if (unit === "karakter" && min === 1) return "Bu alan boş bırakılamaz.";
      if (unit) return `En az ${min} ${unit} ${unit === "öğe" ? "içermelidir" : "olmalıdır"}.`;
      return iss.inclusive === false ? `${min} değerinden büyük olmalıdır.` : `En az ${min} olmalıdır.`;
    }
    case "too_big": {
      const max = Number(iss.maximum);
      const unit = sizeUnit(iss.origin);
      if (unit) return `En fazla ${max} ${unit} ${unit === "öğe" ? "içerebilir" : "olabilir"}.`;
      return iss.inclusive === false ? `${max} değerinden küçük olmalıdır.` : `En fazla ${max} olabilir.`;
    }
    case "invalid_value":
      return `Geçersiz seçenek. Geçerli değerler: ${iss.values.map((v) => JSON.stringify(v)).join(", ")}.`;
    case "invalid_union":
      return "Geçersiz değer.";
    case "invalid_format":
      return "Geçersiz biçim.";
    case "unrecognized_keys":
      return `Tanınmayan alan: ${iss.keys.join(", ")}.`;
    case "not_multiple_of":
      return `${String(iss.divisor)} değerinin katı olmalıdır.`;
    default:
      return trLocale.localeError(iss);
  }
};

/** Sorunları alan yolu (`address.il` gibi) → ilk ileti biçimine indirger. Kök sorunlar `_` anahtarına yazılır. */
export function fieldErrors(issues: readonly z.core.$ZodIssue[], prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const iss of issues) {
    const path = iss.path.map(String).join(".");
    const key = prefix ? (path ? `${prefix}.${path}` : prefix) : path || "_";
    if (!(key in out)) out[key] = iss.message;
  }
  return out;
}

export function validationError(details: Record<string, string>): AppError {
  const keys = Object.keys(details);
  let message: string;
  if (keys.length === 1) message = keys[0] === "_" ? details[keys[0]] : `${keys[0]}: ${details[keys[0]]}`;
  else message = `İstekte ${keys.length} hatalı alan var.`;
  return new AppError(400, "validation", message, details);
}

export function isZodError(e: unknown): e is z.core.$ZodError {
  return e instanceof z.core.$ZodError || (e instanceof Error && e.name === "ZodError" && Array.isArray((e as { issues?: unknown }).issues));
}

/** Şemaya göre ayrıştırır; başarısızsa 400 `validation` fırlatır. */
export function parseWith<S extends z.ZodType>(schema: S, input: unknown, prefix = ""): z.output<S> {
  const r = schema.safeParse(input, { error: turkishErrorMap });
  if (!r.success) throw validationError(fieldErrors(r.error.issues, prefix));
  return r.data;
}

export const parseBody = <S extends z.ZodType>(schema: S, body: unknown): z.output<S> => parseWith(schema, body ?? {});
export const parseQuery = <S extends z.ZodType>(schema: S, query: unknown): z.output<S> => parseWith(schema, query ?? {});
export const parseParams = <S extends z.ZodType>(schema: S, params: unknown): z.output<S> => parseWith(schema, params ?? {});
