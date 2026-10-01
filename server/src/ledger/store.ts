// Her doğrulayıcının KENDİ blok deposu. Bellek kipinde yalnız RAM; kalıcı kipte ayrı bir SQLite dosyası
// (${dataDir}/ledger/<nodeId>.db). Bloklar ve küçük durum kayıtları (konsensüs kilidi, havuz) tutulur.
// Kayıtlar silinmez: onarım "INSERT OR REPLACE" ile aynı yüksekliği yeniden yazar.
import { Db } from "../db";
import type { StoredBlock } from "./types";

export interface BlockStore {
  readonly persistent: boolean;
  height(): number;
  /** Depodaki nesneyi döner (kopya değil). Çağıran değiştirmemeli; değiştirecekse put() ile yazmalı. */
  get(height: number): StoredBlock | null;
  append(block: StoredBlock): void;
  /** Mevcut yüksekliği yeniden yazar (kurcalama demosu / onarım). */
  put(block: StoredBlock): void;
  getState(key: string): string | null;
  setState(key: string, value: string): void;
  close(): void;
}

export class MemoryBlockStore implements BlockStore {
  readonly persistent: boolean = false;
  protected blocks: StoredBlock[] = [];
  protected state = new Map<string, string>();

  height(): number {
    return this.blocks.length;
  }
  get(height: number): StoredBlock | null {
    return this.blocks[height - 1] ?? null;
  }
  append(block: StoredBlock): void {
    if (block.header.height !== this.blocks.length + 1) throw new Error(`Blok yüksekliği sıra dışı: ${block.header.height}`);
    this.blocks.push(block);
  }
  put(block: StoredBlock): void {
    const h = block.header.height;
    if (h < 1 || h > this.blocks.length) throw new Error(`Yeniden yazılacak blok yok: ${h}`);
    this.blocks[h - 1] = block;
  }
  getState(key: string): string | null {
    return this.state.get(key) ?? null;
  }
  setState(key: string, value: string): void {
    this.state.set(key, value);
  }
  close(): void {}
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS blocks (
  height INTEGER PRIMARY KEY,
  hash TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS node_state (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);`;

/** SQLite üzerine yazan, okumaları bellekten yapan depo. */
export class SqliteBlockStore extends MemoryBlockStore {
  override readonly persistent: boolean = true;
  private db: Db | null;

  constructor(path: string) {
    super();
    this.db = new Db(path);
    // WAL + NORMAL: süreç çökmesine dayanıklı; ani güç kesintisinde son birkaç yazım kaybolabilir (demo).
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec(SCHEMA);
    for (const r of this.db.all<{ height: number; data: string }>("SELECT height, data FROM blocks ORDER BY height")) {
      if (r.height !== this.blocks.length + 1) break; // boşluktan sonrası güvenilmez; eşlerden senkronlanır
      this.blocks.push(JSON.parse(r.data) as StoredBlock);
    }
    for (const r of this.db.all<{ k: string; v: string }>("SELECT k, v FROM node_state")) this.state.set(r.k, r.v);
  }

  override append(block: StoredBlock): void {
    super.append(block);
    this.db?.run("INSERT OR REPLACE INTO blocks(height, hash, data) VALUES (?, ?, ?)", block.header.height, block.header.hash, JSON.stringify(block));
  }
  override put(block: StoredBlock): void {
    super.put(block);
    this.db?.run("INSERT OR REPLACE INTO blocks(height, hash, data) VALUES (?, ?, ?)", block.header.height, block.header.hash, JSON.stringify(block));
  }
  override setState(key: string, value: string): void {
    super.setState(key, value);
    this.db?.run("INSERT OR REPLACE INTO node_state(k, v) VALUES (?, ?)", key, value);
  }
  override close(): void {
    this.db?.close();
    this.db = null;
  }
}
