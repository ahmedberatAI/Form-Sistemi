// Giriş noktası — entegrasyon aşamasında doldurulacak (app.ts).
import { openDb } from "./db";
import { loadConfig } from "./core/config";
const cfg = loadConfig();
const db = openDb(cfg.dbPath);
console.log("Şema hazır:", db.get("SELECT value FROM meta WHERE key='schema_version'"));
