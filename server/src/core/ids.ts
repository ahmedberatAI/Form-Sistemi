import { randomBytes, randomUUID } from "node:crypto";

export const newId = (): string => randomUUID();
/** 32 bayt rastgele tuz (hex) */
export const newSalt = (): string => randomBytes(32).toString("hex");
