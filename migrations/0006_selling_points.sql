-- Zones inside or across branches (lobby, cashier, warehouse) so a broadcast can target more than
-- "one branch" or "one TV".
CREATE TABLE device_groups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#0f766e',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_device_groups_tenant ON device_groups(tenant_id);
ALTER TABLE devices ADD COLUMN group_id TEXT REFERENCES device_groups(id) ON DELETE SET NULL;

-- Opening hours: outside them the TV shows a closed screen instead of the schedule.
ALTER TABLE branches ADD COLUMN hours_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE branches ADD COLUMN open_time TEXT;
ALTER TABLE branches ADD COLUMN close_time TEXT;
ALTER TABLE branches ADD COLUMN closed_text TEXT;
