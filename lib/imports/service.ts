import { query, transaction, id, audit, type DB, type Row } from "../db";
import { encrypt, decrypt } from "./crypto";
import {
  connectSchema,
  ConnectorError,
  type Config,
  type ConnectionInput,
  type Connector,
  type Page,
} from "./types";
import { createConnector, detectPlatform } from "./connectors";
import { fingerprint, stableJSON } from "./normalize";
export type Factory = (config: Config) => Connector;
export async function connectStore(
  org: string,
  actor: string,
  input: ConnectionInput,
  factory: Factory = createConnector,
) {
  const v = connectSchema.parse(input);
  if (new URL(v.domain).search)
    throw new ConnectorError("STORE_URL_QUERY_NOT_ALLOWED");
  if (v.existingStoreId) {
    const [old] = await query(
      "SELECT s.domain FROM stores s JOIN store_connections c ON c.store_id=s.id AND c.organization_id=s.organization_id WHERE s.id=$1 AND s.organization_id=$2",
      [v.existingStoreId, org],
    );
    if (!old) throw new ConnectorError("STORE_NOT_FOUND");
    if (new URL(old.domain).href !== new URL(v.domain).href)
      throw new ConnectorError("DOMAIN_CHANGE_REQUIRES_NEW_STORE");
  }
  let platform = v.platform;
  if (platform === "auto")
    platform = (await detectPlatform(v.domain)).platform as typeof platform;
  if (platform === "wordpress") platform = "woocommerce";
  if (platform === "sazito")
    throw new ConnectorError("SAZITO_OFFICIAL_API_NOT_VERIFIED");
  if (platform === "auto")
    throw new ConnectorError("PLATFORM_SELECTION_REQUIRED");
  const storeId = v.existingStoreId || id();
  const config = {
    storeId,
    domain: v.domain,
    platform,
    currency: v.currency,
    credentials: v.credentials,
    custom: v.custom,
  } as Config;
  // A read-only real catalog request verifies read scopes, schema and currency. Never request write permissions.
  const connector = factory(config);
  const preview = await connector.page({}, null);
  if (preview.next?.parent) await connector.page(preview.next, null);
  const cipher = await encrypt(config, org, storeId);
  await transaction(async (db) => {
    const [o] = (
      await db.query(
        "SELECT o.*,p.store_limit FROM organizations o JOIN plans p ON p.id=o.plan WHERE o.id=$1 FOR UPDATE OF o",
        [org],
      )
    ).rows;
    if (!o?.subscription_until || new Date(o.subscription_until) <= new Date())
      throw new ConnectorError("SUBSCRIPTION_REQUIRED");
    const [n] = (
      await db.query(
        "SELECT count(*) AS n FROM stores WHERE organization_id=$1",
        [org],
      )
    ).rows;
    if (!v.existingStoreId && Number(n.n) >= o.store_limit)
      throw new ConnectorError("STORE_LIMIT_REACHED");
    if (v.existingStoreId) {
      const changed = await db.query(
        "UPDATE stores SET name=$1,domain=$2 WHERE id=$3 AND organization_id=$4 AND platform=$5 RETURNING id",
        [v.name, new URL(v.domain).href, storeId, org, platform],
      );
      if (!changed.rows.length)
        throw new ConnectorError("PLATFORM_CHANGE_REQUIRES_NEW_STORE");
      await db.query(
        "UPDATE sync_runs SET status='failed',error_code='CONNECTION_REPLACED',lease_token=NULL WHERE store_id=$1 AND organization_id=$2 AND status IN ('queued','running','paused','retry')",
        [storeId, org],
      );
      await db.query(
        "UPDATE store_connections SET config_ciphertext=$1,interval_minutes=$2,paused=false,last_error=NULL,next_sync_at=now() WHERE store_id=$3 AND organization_id=$4",
        [cipher, v.intervalMinutes, storeId, org],
      );
    } else {
      await db.query(
        "INSERT INTO stores(id,organization_id,name,platform,domain,status) VALUES($1,$2,$3,$4,$5,'connected')",
        [storeId, org, v.name, platform, new URL(v.domain).href],
      );
      await db.query(
        "INSERT INTO store_connections(store_id,organization_id,config_ciphertext,interval_minutes) VALUES($1,$2,$3,$4)",
        [storeId, org, cipher, v.intervalMinutes],
      );
    }
    await db.query(
      "INSERT INTO sync_runs(id,store_id,organization_id,mode,total_estimate) VALUES($1,$2,$3,'full',$4)",
      [id(), storeId, org, preview.total ?? null],
    );
    await audit(db, org, actor, "store.api_connected", { storeId, platform });
  });
  return { storeId, platform, previewCount: preview.products.length };
}
export async function enqueue(
  org: string,
  store: string,
  forceFull = false,
  db?: DB,
) {
  const go = async (d: DB) => {
    await d.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [org]);
    const [c] = (
      await d.query(
        "SELECT * FROM store_connections WHERE store_id=$1 AND organization_id=$2 FOR UPDATE",
        [store, org],
      )
    ).rows;
    if (!c) throw new ConnectorError("STORE_NOT_FOUND");
    if (c.paused) throw new ConnectorError("SYNC_PAUSED");
    const active = await d.query(
      "SELECT id FROM sync_runs WHERE store_id=$1 AND organization_id=$2 AND status IN ('queued','running','retry','paused')",
      [store, org],
    );
    if (active.rows.length) {
      if (forceFull)
        await d.query(
          "UPDATE store_connections SET refresh_requested=true WHERE store_id=$1 AND organization_id=$2",
          [store, org],
        );
      return active.rows[0].id;
    }
    const full =
      forceFull ||
      c.refresh_requested ||
      !c.last_full_at ||
      Date.now() - new Date(c.last_full_at).getTime() > 86400000;
    const rid = id();
    await d.query(
      "UPDATE store_connections SET refresh_requested=false WHERE store_id=$1 AND organization_id=$2",
      [store, org],
    );
    await d.query(
      "INSERT INTO sync_runs(id,store_id,organization_id,mode) VALUES($1,$2,$3,$4)",
      [rid, store, org, full ? "full" : "incremental"],
    );
    return rid;
  };
  return db ? go(db) : transaction(go);
}
export async function controlStore(
  org: string,
  actor: string,
  store: string,
  action: "pause" | "resume" | "refresh",
  interval?: number,
) {
  await transaction(async (db) => {
    await db.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
      org,
    ]);
    const [c] = (
      await db.query(
        "SELECT * FROM store_connections WHERE store_id=$1 AND organization_id=$2 FOR UPDATE",
        [store, org],
      )
    ).rows;
    if (!c) throw new ConnectorError("STORE_NOT_FOUND");
    if (interval !== undefined)
      await db.query(
        "UPDATE store_connections SET interval_minutes=$1 WHERE store_id=$2 AND organization_id=$3",
        [interval, store, org],
      );
    if (action === "pause") {
      await db.query(
        "UPDATE store_connections SET paused=true WHERE store_id=$1 AND organization_id=$2",
        [store, org],
      );
      // Fences an in-flight request; its result cannot commit after pause.
      await db.query(
        "UPDATE sync_runs SET status='paused',lease_token=NULL,lease_until=NULL WHERE store_id=$1 AND organization_id=$2 AND status IN ('queued','running','retry')",
        [store, org],
      );
    } else {
      await db.query(
        "UPDATE store_connections SET paused=false,next_sync_at=now() WHERE store_id=$1 AND organization_id=$2",
        [store, org],
      );
      await db.query(
        "UPDATE sync_runs SET status='queued',next_attempt_at=now(),lease_token=NULL,lease_until=NULL WHERE store_id=$1 AND organization_id=$2 AND status='paused'",
        [store, org],
      );
      await enqueue(org, store, action === "refresh", db);
    }
    await audit(db, org, actor, "store.sync_" + action, {
      storeId: store,
      interval,
    });
  });
}
export async function scheduleDue() {
  const stores = await query(
    `SELECT c.store_id,c.organization_id FROM store_connections c JOIN organizations o ON o.id=c.organization_id WHERE NOT c.paused AND c.next_sync_at<=now() AND o.subscription_until>now() LIMIT 100`,
  );
  for (const s of stores)
    try {
      await enqueue(s.organization_id, s.store_id);
    } catch (e) {
      if (!(e instanceof ConnectorError)) throw e;
    }
}
export async function claim(): Promise<Row | null> {
  return transaction(async (db) => {
    const [r] = (
      await db.query(
        `SELECT r.* FROM sync_runs r JOIN store_connections c ON c.store_id=r.store_id AND c.organization_id=r.organization_id JOIN organizations o ON o.id=r.organization_id WHERE NOT c.paused AND o.subscription_until>now() AND ((r.status IN ('queued','retry') AND r.next_attempt_at<=now()) OR (r.status='running' AND r.lease_until<now())) ORDER BY r.next_attempt_at LIMIT 1 FOR UPDATE OF r SKIP LOCKED`,
      )
    ).rows;
    if (!r) return null;
    const token = id();
    await db.query(
      "UPDATE sync_runs SET status='running',lease_token=$1,lease_until=now()+interval '120 seconds' WHERE id=$2",
      [token, r.id],
    );
    return { ...r, lease_token: token };
  });
}
export async function applyPage(run: Row, page: Page) {
  return transaction(async (db) => {
    await db.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
      run.organization_id,
    ]);
    const [r] = (
      await db.query(
        "SELECT * FROM sync_runs WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        [run.id, run.organization_id],
      )
    ).rows;
    if (!r || r.lease_token !== run.lease_token || r.status !== "running")
      return false;
    const [connection] = (
      await db.query(
        "SELECT * FROM store_connections WHERE store_id=$1 AND organization_id=$2 FOR UPDATE",
        [r.store_id, r.organization_id],
      )
    ).rows;
    if (connection.paused) return false;
    const [org] = (
      await db.query(
        "SELECT o.*,p.product_limit FROM organizations o JOIN plans p ON p.id=o.plan WHERE o.id=$1 FOR UPDATE OF o",
        [r.organization_id],
      )
    ).rows;
    if (
      !org.subscription_until ||
      new Date(org.subscription_until) <= new Date()
    )
      throw new ConnectorError("SUBSCRIPTION_REQUIRED");
    let added = 0,
      updated = 0,
      unchanged = 0;
    for (const p of page.products) {
      const seen = await db.query(
        "INSERT INTO sync_seen(run_id,external_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING external_id",
        [r.id, p.externalId],
      );
      if (!seen.rows.length) continue;
      const [existing] = (
        await db.query(
          "SELECT * FROM products WHERE organization_id=$1 AND store_id=$2 AND external_id=$3 FOR UPDATE",
          [r.organization_id, r.store_id, p.externalId],
        )
      ).rows;
      const hash = fingerprint(p);
      if (!existing) {
        const [n] = (
          await db.query(
            "SELECT count(*) AS n FROM products WHERE organization_id=$1",
            [r.organization_id],
          )
        ).rows;
        if (Number(n.n) >= org.product_limit)
          throw new ConnectorError("PRODUCT_LIMIT_REACHED");
      }
      const pid = existing?.id || id();
      const identityChanged =
        !!existing &&
        (existing.title !== p.title ||
          existing.brand !== (p.brand || null) ||
          existing.model !== (p.model || null) ||
          existing.barcode !== (p.barcode || null) ||
          stableJSON(existing.attributes) !== stableJSON(p.attributes));
      if (!existing)
        await db.query(
          "INSERT INTO products(id,organization_id,store_id,title,sku,cost,price,stock,external_id) VALUES($1,$2,$3,$4,$5,0,$6,$7,$8)",
          [
            pid,
            r.organization_id,
            r.store_id,
            p.title,
            p.sku || p.externalId,
            p.price,
            p.stock,
            p.externalId,
          ],
        );
      if (!existing || existing.content_hash !== hash) {
        await db.query(
          `UPDATE products SET title=$1,source_sku=$2,parent_external_id=$3,barcode=$4,brand=$5,model=$6,description=$7,categories=$8,images=$9,attributes=$10,price=$11,regular_price=$12,sale_price=$13,stock=$14,availability=$15,content_hash=$16,source_updated_at=$17,last_synced_at=now(),missing_full_count=0,match_verified=CASE WHEN $18 THEN false ELSE match_verified END,match_confidence=CASE WHEN $18 THEN NULL ELSE match_confidence END,torob_url=CASE WHEN $18 THEN NULL ELSE torob_url END WHERE id=$19 AND organization_id=$20`,
          [
            p.title,
            p.sku,
            p.parentId || null,
            p.barcode || null,
            p.brand || null,
            p.model || null,
            p.description,
            JSON.stringify(p.categories),
            JSON.stringify(p.images),
            JSON.stringify(p.attributes),
            p.price,
            p.regularPrice,
            p.salePrice,
            p.stock,
            p.availability,
            hash,
            p.updatedAt || null,
            identityChanged,
            pid,
            r.organization_id,
          ],
        );
        if (existing) updated++;
        else added++;
        if (identityChanged)
          await db.query(
            "DELETE FROM matching_candidates WHERE product_id=$1 AND organization_id=$2",
            [pid, r.organization_id],
          );
        if (!existing || identityChanged)
          await db.query(
            "INSERT INTO matching_jobs(product_id,organization_id,status) VALUES($1,$2,'awaiting_source') ON CONFLICT(product_id) DO UPDATE SET status='awaiting_source',next_attempt_at=now(),attempts=0,lease_token=NULL,updated_at=now()",
            [pid, r.organization_id],
          );
      } else {
        unchanged++;
        await db.query(
          "UPDATE products SET last_synced_at=now(),missing_full_count=0,availability=$3,stock=$4 WHERE id=$1 AND organization_id=$2",
          [pid, r.organization_id, p.availability, p.stock],
        );
      }
    }
    if (
      page.next &&
      page.products.length > 0 &&
      added + updated + unchanged === 0
    )
      throw new ConnectorError("PAGINATION_STALLED");
    const done = page.next === null;
    await db.query(
      `UPDATE sync_runs SET status=$1,cursor=$2,processed=processed+$3,new_count=new_count+$4,updated_count=updated_count+$5,unchanged_count=unchanged_count+$6,total_estimate=COALESCE($7,total_estimate),lease_token=NULL,lease_until=NULL,attempts=0,completed_at=CASE WHEN $8 THEN now() ELSE NULL END WHERE id=$9`,
      [
        done ? "succeeded" : "queued",
        JSON.stringify(page.next || {}),
        added + updated + unchanged,
        added,
        updated,
        unchanged,
        page.total ?? null,
        done,
        r.id,
      ],
    );
    if (done) {
      // Never hard-delete. Absence becomes unavailable only after two fully successful full scans.
      if (r.mode === "full")
        await db.query(
          `UPDATE products SET missing_full_count=missing_full_count+1,availability=CASE WHEN missing_full_count>=1 THEN 'unavailable' ELSE availability END,stock=CASE WHEN missing_full_count>=1 THEN 0 ELSE stock END WHERE organization_id=$1 AND store_id=$2 AND external_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sync_seen s WHERE s.run_id=$3 AND s.external_id=products.external_id)`,
          [r.organization_id, r.store_id, r.id],
        );
      // Overlap protects updates happening during pagination. Failed runs never advance this watermark.
      await db.query(
        `UPDATE store_connections SET last_success_at=now(),last_full_at=CASE WHEN $1 THEN now() ELSE last_full_at END,checkpoint=$2::timestamptz-interval '5 minutes',next_sync_at=CASE WHEN refresh_requested THEN now() ELSE now()+interval_minutes*interval '1 minute' END,last_error=NULL WHERE store_id=$3 AND organization_id=$4`,
        [r.mode === "full", r.started_at, r.store_id, r.organization_id],
      );
      await db.query("DELETE FROM sync_seen WHERE run_id=$1", [r.id]);
      await audit(db, r.organization_id, "worker", "store.sync_completed", {
        storeId: r.store_id,
        runId: r.id,
      });
    }
    return true;
  });
}
export async function processOne(factory: Factory = createConnector) {
  const run = await claim();
  if (!run) return false;
  const heartbeat = setInterval(() => {
    void query(
      "UPDATE sync_runs SET lease_until=now()+interval '120 seconds' WHERE id=$1 AND lease_token=$2 AND status='running'",
      [run.id, run.lease_token],
    ).catch(() => {});
  }, 20000);
  try {
    const [c] = await query(
      "SELECT * FROM store_connections WHERE store_id=$1 AND organization_id=$2",
      [run.store_id, run.organization_id],
    );
    const config = await decrypt<Config>(
      c.config_ciphertext,
      run.organization_id,
      run.store_id,
    );
    const connector = factory(config);
    const since =
      run.mode === "incremental" && connector.incremental && c.checkpoint
        ? new Date(c.checkpoint).toISOString()
        : null;
    const page = await connector.page(run.cursor, since);
    await applyPage(run, page);
  } catch (error) {
    const e =
      error instanceof ConnectorError
        ? error
        : new ConnectorError("IMPORT_INTERNAL_ERROR", true);
    const attempts = Number(run.attempts) + 1;
    const retry = e.retryable && attempts <= 5;
    const delay = Math.max(
      e.retryAfter,
      Math.min(
        3600,
        Math.pow(2, attempts) * 10 + Math.floor(Math.random() * 10),
      ),
    );
    await transaction(async (db) => {
      await db.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        run.organization_id,
      ]);
      const result = await db.query(
        "UPDATE sync_runs SET status=$1,error_code=$2,attempts=$3,failed_count=failed_count+1,lease_token=NULL,lease_until=NULL,next_attempt_at=now()+$4*interval '1 second' WHERE id=$5 AND organization_id=$6 AND lease_token=$7 RETURNING id",
        [
          retry ? "retry" : "failed",
          e.code,
          attempts,
          delay,
          run.id,
          run.organization_id,
          run.lease_token,
        ],
      );
      if (!result.rows.length) return;
      await db.query(
        "INSERT INTO sync_errors(id,run_id,organization_id,code) VALUES($1,$2,$3,$4)",
        [id(), run.id, run.organization_id, e.code],
      );
      await db.query(
        "UPDATE store_connections SET last_error=$1,next_sync_at=now()+interval '1 hour' WHERE store_id=$2 AND organization_id=$3",
        [e.code, run.store_id, run.organization_id],
      );
    });
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
export async function connectionOverview(org: string) {
  const stores = await query(
    `SELECT s.id,s.name,s.platform,s.domain,s.status,c.interval_minutes,c.paused,c.last_success_at,c.next_sync_at,c.last_error,c.last_full_at,(SELECT count(*) FROM products p WHERE p.store_id=s.id AND p.organization_id=s.organization_id) AS product_count,(SELECT count(*) FROM products p WHERE p.store_id=s.id AND p.organization_id=s.organization_id AND NOT p.match_verified) AS awaiting_match FROM stores s JOIN store_connections c ON c.store_id=s.id AND c.organization_id=s.organization_id WHERE s.organization_id=$1 ORDER BY s.created_at DESC`,
    [org],
  );
  const runs = await query(
    "SELECT id,store_id,mode,status,processed,new_count,updated_count,unchanged_count,failed_count,total_estimate,started_at,completed_at,error_code,next_attempt_at FROM sync_runs WHERE organization_id=$1 ORDER BY started_at DESC LIMIT 50",
    [org],
  );
  const errors = await query(
    "SELECT e.code,e.created_at,e.run_id FROM sync_errors e WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 20",
    [org],
  );
  const [runStats] = await query(
    "SELECT count(*) FILTER(WHERE status='failed') AS failed FROM sync_runs WHERE organization_id=$1",
    [org],
  );
  const matchingStats = await query(
    "SELECT status,count(*) AS total FROM matching_jobs WHERE organization_id=$1 GROUP BY status",
    [org],
  );
  const matchingErrors = await query(
    "SELECT error_code AS code,updated_at AS created_at FROM matching_jobs WHERE organization_id=$1 AND error_code IS NOT NULL ORDER BY updated_at DESC LIMIT 10",
    [org],
  );
  return {
    stores,
    runs,
    errors: [...errors, ...matchingErrors],
    runStats,
    matchingStats,
    matchingAvailable: !!process.env.DISCOVERY_API_URL,
    competitorAvailable: false,
  };
}
