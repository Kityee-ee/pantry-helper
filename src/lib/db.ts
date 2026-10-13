import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type Category =
  | "low_stock"
  | "new_request"
  | "maintenance"
  | "complaint"
  | "other";

export type EntryStatus = "open" | "done";

export interface Entry {
  id: number;
  text: string;
  category: Category;
  status: EntryStatus;
  created_at: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = process.env.DATABASE_PATH ?? path.join(DATA_DIR, "pantry.db");

let db: DatabaseSync | undefined;

function open(): DatabaseSync {
  if (db) return db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      text       TEXT    NOT NULL,
      category   TEXT    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'open',
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
  return db;
}

export function listEntries(): Entry[] {
  return open()
    .prepare("SELECT * FROM entries ORDER BY created_at DESC, id DESC")
    .all() as unknown as Entry[];
}

export function createEntry(text: string, category: Category): Entry {
  const d = open();
  const result = d
    .prepare("INSERT INTO entries (text, category) VALUES (?, ?)")
    .run(text, category);
  return d
    .prepare("SELECT * FROM entries WHERE id = ?")
    .get(result.lastInsertRowid) as unknown as Entry;
}

export function updateEntryStatus(id: number, status: EntryStatus): Entry | undefined {
  const d = open();
  d.prepare("UPDATE entries SET status = ? WHERE id = ?").run(status, id);
  return d.prepare("SELECT * FROM entries WHERE id = ?").get(id) as unknown as Entry | undefined;
}
