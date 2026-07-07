CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  quadrant TEXT NOT NULL,       -- '1', '5', '15', or '60'
  done INTEGER NOT NULL DEFAULT 0,
  rollover INTEGER NOT NULL DEFAULT 0,
  created_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
