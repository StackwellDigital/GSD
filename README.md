# Get Shit Done — Cloudflare Worker + D1

Quadrant-based to-do list (1/5/15/60 min buckets), backed by a Cloudflare D1
database so it's shared and persists no matter who opens it or on what device.

## Folder structure
```
gsd-cloudflare/
├── wrangler.toml      # Worker config (D1 binding + static assets)
├── schema.sql         # D1 table definitions
├── src/
│   └── index.js       # Worker: serves the API + static frontend
└── public/
    └── index.html      # Frontend (fetches from /api/*)
```

## Setup

### 1. Create the D1 database
Via CLI:
```bash
npx wrangler d1 create gsd-db
```
This prints a `database_id` — paste it into `wrangler.toml` in place of
`REPLACE_WITH_YOUR_DATABASE_ID`.

If you'd rather do this from the CF dashboard: Workers & Pages → D1 → Create
database, name it `gsd-db`, then copy the ID it shows you into `wrangler.toml`.

### 2. Load the schema
```bash
npx wrangler d1 execute gsd-db --file=./schema.sql
```
Or paste the contents of `schema.sql` into the D1 dashboard's console and run it.

### 3. Deploy
If you're connecting this repo to a Worker via the CF dashboard's Git
integration, it'll auto-detect `wrangler.toml` and deploy on push — just make
sure the D1 database is bound under **Settings → Bindings** on the Worker if it
doesn't pick it up automatically from the toml file.

If deploying manually instead:
```bash
npx wrangler deploy
```

### 4. Open it
Your Worker's `*.workers.dev` URL (or custom domain if you attach one) serves
the app directly — no separate frontend hosting needed.

## Notes
- No login/auth — it's a shared list, anyone with the link can read and edit it.
- "Start New Day" (manual button) and automatic rollover (triggered the first
  time anyone loads the page on a new calendar day) both clear completed tasks
  and mark unfinished ones with a rollover flag (↺).
- All state lives in D1, not the browser — closing the tab, clearing browser
  data, or switching devices doesn't touch it.
