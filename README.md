# Pantry Helper

Free-text entry box for office pantry feedback. Each entry is automatically
categorised (low stock, new request, maintenance, complaint, other) and listed
so it can be actioned and marked done.

## Stack

- Next.js 16 (App Router, TypeScript, Tailwind)
- SQLite via Node's built-in `node:sqlite` (no native build step)
- Rule-based categorisation in `src/lib/categorise.ts`, with a single
  `categorise()` entry point where an AI call can be added later

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000. The database is created at `data/pantry.db` on
first request (override with `DATABASE_PATH`). The `data/` folder is
git-ignored.

## Layout

```
src/
  app/
    page.tsx                  entry form + list (client component)
    api/entries/route.ts      GET list, POST create (categorises)
    api/entries/[id]/route.ts PATCH status (open | done)
  lib/
    db.ts                     SQLite open + queries
    categorise.ts             keyword rules + categorise() hook
```

## API

| Method | Path                | Body                     | Result            |
| ------ | ------------------- | ------------------------ | ----------------- |
| GET    | `/api/entries`      |                          | `Entry[]`         |
| POST   | `/api/entries`      | `{ "text": string }`     | `Entry` (201)     |
| PATCH  | `/api/entries/:id`  | `{ "status": "open" \| "done" }` | `Entry` |
