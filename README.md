# Get Shit Done — Cloudflare Worker + D1

Quadrant-based to-do list (1/5/15/60 min buckets), backed by a Cloudflare D1
database. Each person creates their own account (username + password) and
only ever sees their own tasks.

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
If you already ran the old single-list schema against this database, drop
those tables first (D1 console or `wrangler d1 execute`):
```sql
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS meta;
```
Then load the new schema:
```bash
npx wrangler d1 execute gsd-db --file=./schema.sql
```
Or paste `schema.sql` into the D1 dashboard's console and run it (one
statement at a time if the console chokes on multiple statements pasted at
once).

### 3. Set the session secret
Sessions are signed with HMAC using a secret only the Worker knows — this
has to be set as a **secret**, not a plain variable, so it never ends up in
your repo:
```bash
npx wrangler secret put SESSION_SECRET
```
It'll prompt you for a value — paste in any long random string (a password
generator output works fine, 32+ characters).

If you're deploying purely through the dashboard's git integration without
touching the CLI, you can also set this under Worker → **Settings** →
**Variables and Secrets** → **Add** → mark it as **Secret**, name it
`SESSION_SECRET`.

### 4. Deploy
If you're connecting this repo to a Worker via the CF dashboard's Git
integration, it'll auto-detect `wrangler.toml` and deploy on push — just make
sure the D1 database is bound under **Settings → Bindings** on the Worker if it
doesn't pick it up automatically from the toml file.

If deploying manually instead:
```bash
npx wrangler deploy
```

### 5. Open it
Your Worker's `*.workers.dev` URL (or custom domain if you attach one) serves
the app directly. First screen is sign up / log in — each person creates their
own account and from then on only sees their own list.

## Notes
- Each user has their own account and only ever sees their own tasks — signup
  requires a username (2-40 chars) and password (8+ chars).
- Passwords are hashed with PBKDF2 (100,000 iterations, SHA-256) before being
  stored — never stored in plain text.
- Sessions are an HTTP-only cookie signed with `SESSION_SECRET`, valid 30 days.
- "Start New Day" (manual button) and automatic rollover (triggered the first
  time a user loads the page on a new calendar day) both clear that user's
  completed tasks and mark their unfinished ones with a rollover flag (↺).
- All state lives in D1, not the browser — closing the tab, clearing browser
  data, or switching devices doesn't touch it, as long as you log back in.
