// Additive, repeatable migration; existing sandbox records remain intact.
export const importSchema = `
CREATE TABLE IF NOT EXISTS store_connections (
 store_id text PRIMARY KEY, organization_id text NOT NULL, config_ciphertext text NOT NULL,
 interval_minutes integer NOT NULL DEFAULT 60 CHECK(interval_minutes IN (15,30,60,180,360,720,1440)),
 paused boolean NOT NULL DEFAULT false, connected_at timestamptz NOT NULL DEFAULT now(),
 last_success_at timestamptz, next_sync_at timestamptz NOT NULL DEFAULT now(), last_full_at timestamptz,
 checkpoint timestamptz, last_error text, webhook_secret_ciphertext text,
 FOREIGN KEY(store_id,organization_id) REFERENCES stores(id,organization_id));
ALTER TABLE store_connections ADD COLUMN IF NOT EXISTS refresh_requested boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS sync_runs (
 id text PRIMARY KEY,store_id text NOT NULL,organization_id text NOT NULL,
 mode text NOT NULL CHECK(mode IN ('full','incremental')),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','paused','retry','succeeded','failed')),
 cursor jsonb NOT NULL DEFAULT '{}', processed integer NOT NULL DEFAULT 0,
 new_count integer NOT NULL DEFAULT 0,updated_count integer NOT NULL DEFAULT 0,unchanged_count integer NOT NULL DEFAULT 0,
 failed_count integer NOT NULL DEFAULT 0,total_estimate integer,attempts integer NOT NULL DEFAULT 0,
 lease_token text,lease_until timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,error_code text,
 FOREIGN KEY(store_id,organization_id) REFERENCES stores(id,organization_id));
CREATE UNIQUE INDEX IF NOT EXISTS sync_one_active_store ON sync_runs(store_id) WHERE status IN ('queued','running','paused','retry');
CREATE INDEX IF NOT EXISTS sync_runs_queue ON sync_runs(status,next_attempt_at,lease_until);
CREATE TABLE IF NOT EXISTS sync_errors(id text PRIMARY KEY,run_id text NOT NULL REFERENCES sync_runs(id),organization_id text NOT NULL,external_id text,code text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sync_seen(run_id text NOT NULL REFERENCES sync_runs(id),external_id text NOT NULL,PRIMARY KEY(run_id,external_id));
CREATE TABLE IF NOT EXISTS webhook_receipts(store_id text NOT NULL REFERENCES store_connections(store_id),event_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(store_id,event_id));
CREATE TABLE IF NOT EXISTS matching_jobs(product_id text PRIMARY KEY,organization_id text NOT NULL,status text NOT NULL DEFAULT 'awaiting_source',attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,lease_token text,error_code text,updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(product_id,organization_id) REFERENCES products(id,organization_id));
CREATE TABLE IF NOT EXISTS matching_candidates(id text PRIMARY KEY,product_id text NOT NULL,organization_id text NOT NULL,url text NOT NULL,title text NOT NULL,score integer NOT NULL,details jsonb NOT NULL,status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(product_id,url),FOREIGN KEY(product_id,organization_id) REFERENCES products(id,organization_id));
ALTER TABLE products ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS source_sku text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS parent_external_id text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS categories jsonb NOT NULL DEFAULT '[]';
ALTER TABLE products ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]';
ALTER TABLE products ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}';
ALTER TABLE products ADD COLUMN IF NOT EXISTS regular_price bigint;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_price bigint;
ALTER TABLE products ADD COLUMN IF NOT EXISTS availability text NOT NULL DEFAULT 'available';
ALTER TABLE products ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE products ADD COLUMN IF NOT EXISTS missing_full_count integer NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS match_confidence integer;
ALTER TABLE products ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_organization_id_store_id_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS imported_product_identity ON products(organization_id,store_id,external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS manual_product_sku ON products(organization_id,store_id,sku) WHERE external_id IS NULL;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_price_check;
ALTER TABLE products ADD CONSTRAINT products_price_check CHECK(price>=0);
`;
