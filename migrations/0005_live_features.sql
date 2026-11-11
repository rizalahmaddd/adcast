-- Running text shown under whatever is playing, set per branch and optionally overridden per broadcast.
ALTER TABLE branches ADD COLUMN ticker_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE branches ADD COLUMN ticker_text TEXT;
ALTER TABLE branches ADD COLUMN ticker_speed INTEGER NOT NULL DEFAULT 120;
ALTER TABLE branches ADD COLUMN ticker_bg TEXT NOT NULL DEFAULT '#000000';

-- Degrees clockwise. 0 is the normal landscape screen.
ALTER TABLE devices ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0;

-- Inclusive local calendar dates (YYYY-MM-DD). NULL on either side means no bound.
ALTER TABLE media ADD COLUMN start_date TEXT;
ALTER TABLE media ADD COLUMN end_date TEXT;

-- One active announcement per business. It lives apart from broadcasts so stopping it restores what was playing.
CREATE TABLE announcements (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  text TEXT NOT NULL,
  bg TEXT NOT NULL DEFAULT '#b91c1c',
  target_type TEXT NOT NULL,
  target_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  created_by TEXT,
  created_by_name TEXT
);
