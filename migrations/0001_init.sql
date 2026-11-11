CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  brand_color TEXT NOT NULL DEFAULT '#0f766e',
  logo_version INTEGER NOT NULL DEFAULT 0,
  alert_threshold INTEGER NOT NULL DEFAULT 3,
  created_at INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '[]',
  is_owner INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_roles_tenant ON roles(tenant_id);

CREATE TABLE memberships (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX idx_memberships_user ON memberships(user_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  pending_2fa INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE login_attempts (
  email TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts ON login_attempts(email, at);

CREATE TABLE branches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_branches_tenant ON branches(tenant_id);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_devices_tenant ON devices(tenant_id);

CREATE TABLE pairings (
  code TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL UNIQUE,
  device_id TEXT,
  device_token TEXT,
  expires_at INTEGER NOT NULL
);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'upload',
  r2_key TEXT,
  upload_id TEXT,
  youtube_id TEXT,
  mime TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  duration REAL,
  width INTEGER,
  height INTEGER,
  has_thumb INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_media_tenant ON media(tenant_id, created_at);

CREATE TABLE playlists (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_playlists_tenant ON playlists(tenant_id);

CREATE TABLE playlist_items (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, position)
);

CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_ids TEXT NOT NULL DEFAULT '[]',
  days TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
  start_time TEXT NOT NULL,
  end_time TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_schedules_tenant ON schedules(tenant_id);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_tenant ON audit_logs(tenant_id, created_at);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_notifications_tenant ON notifications(tenant_id, created_at);

CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_push_tenant ON push_subscriptions(tenant_id);
