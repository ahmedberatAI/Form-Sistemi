// crash-recovery.test.ts için alt süreç (test dosyası değildir). Uygulamayı açar, defter çoğunluğunu kırar (blok işlenemez), bir
// doğrudan defter gönderimi ve bir forum kaydı yazar (kayıt + giden kutusu satırı aynı DB işleminde; ertelenmiş gönderim hiç
// çalışmaz), sonra kendini SIGKILL ile öldürür: kapanış adımları (havuz kalıcılığı, saatin tam kaydı, kilidin bırakılması) ÇALIŞMAZ.
// Kullanım: node --import tsx test/ledger/hard-kill-child.ts <veri-klasörü>
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import { testConfig } from "../../src/core/config";
import { recordOutbox } from "../../src/ledger/outbox";
import { prepareTx } from "../../src/ledger/tx";

const dir = process.argv[2];
if (!dir) throw new Error("veri klasörü verilmedi");
const config = testConfig({ dataDir: dir, dbPath: join(dir, "forum.db"), timeScale: 60, ledgerBlockIntervalMs: 5 });
const { services } = await createApp(config, { startTimers: false, aiClient: null, logger: false, rateLimit: false });
await services.ledger.flush(20_000); // kurucu yönetmelik kaydı işlensin
services.ledger.setFault("v2", "crash");
services.ledger.setFault("v3", "crash");

const direct = services.ledger.submit("DELEGATION", { delegationId: "son-an", scope: "*" }).txHash;
const at = services.clock.now();
const forum = prepareTx("DELEGATION", { delegationId: "forum-kaydi", scope: "*" });
const db = services.ctx.db;
db.tx(() => {
  db.run(
    "INSERT INTO graph_runs(id, algo, version, params, seed, input_hash, output_hash, result, ledger_tx, created_at) VALUES ('son-kayit', 'a', '1', '{}', NULL, 'i', 'o', '{}', ?, ?)",
    forum.hash,
    at,
  );
  recordOutbox(db, { hash: forum.hash, type: "DELEGATION", payload: forum.payload, nonce: forum.nonce, submittedAt: at });
});

writeFileSync(join(dir, "child.json"), JSON.stringify({ direct, forum: forum.hash, at, pid: process.pid }));
process.kill(process.pid, "SIGKILL");
