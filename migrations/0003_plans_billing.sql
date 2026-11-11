-- NULL on a paid plan means it never lapses (set by hand by the operator).
ALTER TABLE tenants ADD COLUMN plan_expires_at INTEGER;

-- Videos played straight from an external address (kind = 'link'); nothing is stored for them.
ALTER TABLE media ADD COLUMN url TEXT;

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  months INTEGER NOT NULL,
  days INTEGER NOT NULL,
  price INTEGER NOT NULL,
  unique_code INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  created_by TEXT,
  created_by_name TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  claimed_at INTEGER,
  decided_at INTEGER,
  decided_by TEXT
);
CREATE INDEX idx_orders_tenant ON orders(tenant_id, created_at);
CREATE INDEX idx_orders_status ON orders(status, created_at);
-- The transferred amount is the only thing tying a payment to an order, so open orders never share one.
CREATE UNIQUE INDEX idx_orders_open_amount ON orders(amount) WHERE status = 'pending';
