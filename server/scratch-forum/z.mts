import { z } from "zod";
const s = z.object({ title: z.string().min(5, "Başlık en az 5 karakter olmalıdır."), n: z.number().int().min(1), k: z.enum(["a","b"]), arr: z.array(z.string()).min(1), o: z.object({ x: z.string() }).nullish() });
const r = s.safeParse({ title: "ab", n: 0, k: "c", arr: [], o: { x: 1 } }, { error: (iss) => { console.log("ISS", JSON.stringify({ code: iss.code, path: (iss as any).path, origin: (iss as any).origin, min: (iss as any).minimum, exp: (iss as any).expected, vals: (iss as any).values })); return undefined; } });
console.log(JSON.stringify(r.error!.issues, null, 0));
