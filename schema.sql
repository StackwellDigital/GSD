-- Fresh schema for multi-user Get Shit Done.
-- If you already have the old single-list tasks/meta tables, drop them first:
--   DROP TABLE IF EXISTS tasks;
--   DROP TABLE IF EXISTS meta;
-- (Fine to lose the old test data -- it was just for wiring things up.)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_active_date TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  quadrant TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  rollover INTEGER NOT NULL DEFAULT 0,
  created_date TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
