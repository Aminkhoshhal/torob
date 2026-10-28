import { test, after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { query, transaction, id } from "../lib/db";
import {
  connectStore,
  processOne,
  controlStore,
  enqueue,
  claim,
  applyPage,
  connectionOverview,
} from "../lib/imports/service";
import { decrypt } from "../lib/imports/crypto";
import {
  ConnectorError,
  type Config,
  type Connector,
  type ImportedProduct,
  type ConnectionInput,
} from "../lib/imports/types";
const dir = mkdtempSync(tmpdir() + "/pricepilot-sync-");
process.env.LOCAL_DATA_DIR = dir;
const org = id(),
  other = id(),
  actor = id();
const product = (n: number, price = 100): ImportedProduct => ({
  externalId: String(n),
  title: "Product " + n,
  sku: "DUPLICATE-SKU",
  price,
  stock: 3,
  availability: "available",
  regularPrice: null,
  salePrice: null,
  description: "",
  images: [],
  categories: [],
  attributes: {},
});
let catalog = [product(1), product(2), product(3)];
let calls = 0;
let fail = false;
const factory = (): Connector => ({
  incremental: true,
  async page(cursor) {
    calls++;
    if (fail) throw new ConnectorError("RATE_LIMITED", true, 15);
    const page = Number(cursor.page || 1);
    const products = catalog.slice((page - 1) * 2, page * 2);
    return {
      products,
      next: page * 2 < catalog.length ? { page: page + 1 } : null,
      total: catalog.length,
    };
  },
});
const input: ConnectionInput = {
  name: "Connected store",
  domain: "https://shop.example.com",
  platform: "woocommerce",
  currency: "IRT",
  credentials: { key: "credential-key", secret: "credential-secret" },
  intervalMinutes: 15,
};
after(async () => {
  const state = globalThis as any;
  const c = await state.pricepilotDB;
  if (c?.local) await c.local.close();
  await rm(dir, { recursive: true, force: true });
});
test("durable catalog pipeline: tenant isolation, retries, pause fencing, incremental and soft deletion", async () => {
  for (const oid of [org, other]) {
    await query(
      "INSERT INTO organizations(id,name,plan,subscription_until) VALUES($1,$2,$3,now()+interval '30 days')",
      [oid, "Test " + oid, "business"],
    );
  }
  const { storeId } = await connectStore(org, actor, input, factory);
  assert.equal((await connectionOverview(other)).stores.length, 0);
  const [cipher] = await query(
    "SELECT config_ciphertext FROM store_connections WHERE store_id=$1",
    [storeId],
  );
  assert.ok(!cipher.config_ciphertext.includes("credential"));
  assert.equal(
    (await decrypt<Config>(cipher.config_ciphertext, org, storeId)).credentials
      .key,
    "credential-key",
  );
  await processOne(factory);
  let rows = await query("SELECT * FROM products WHERE organization_id=$1", [
    org,
  ]);
  assert.equal(rows.length, 2);
  assert.equal(
    new Set(rows.map((r) => r.sku)).size,
    1,
    "duplicate source SKUs do not collide across stable external IDs",
  );
  await controlStore(org, actor, storeId, "pause");
  assert.equal(await processOne(factory), false);
  await controlStore(org, actor, storeId, "resume");
  await processOne(factory);
  rows = await query("SELECT * FROM products WHERE organization_id=$1", [org]);
  assert.equal(rows.length, 3);
  let [conn] = await query(
    "SELECT * FROM store_connections WHERE store_id=$1",
    [storeId],
  );
  assert.ok(conn.last_success_at);
  assert.ok(conn.checkpoint);
  assert.ok(conn.next_sync_at > conn.last_success_at);
  await enqueue(org, storeId, true);
  const inFlight = await claim();
  assert.ok(inFlight);
  await controlStore(org, actor, storeId, "pause");
  assert.equal(
    await applyPage(inFlight!, { products: [product(4)], next: null }),
    false,
    "pause fences already fetched responses",
  );
  assert.equal(
    (
      await query(
        "SELECT * FROM products WHERE external_id=$1 AND store_id=$2",
        ["4", storeId],
      )
    ).length,
    0,
  );
  await controlStore(org, actor, storeId, "resume");
  fail = true;
  await processOne(factory);
  const [failedRun] = await query(
    "SELECT * FROM sync_runs WHERE store_id=$1 AND status='retry'",
    [storeId],
  );
  assert.equal(failedRun.error_code, "RATE_LIMITED");
  assert.equal(
    (
      await query(
        "SELECT count(*) AS n FROM products WHERE organization_id=$1",
        [org],
      )
    )[0].n,
    3,
  );
  const [stillConn] = await query(
    "SELECT * FROM store_connections WHERE store_id=$1",
    [storeId],
  );
  assert.equal(String(stillConn.checkpoint), String(conn.checkpoint));
  fail = false;
  await query("UPDATE sync_runs SET next_attempt_at=now() WHERE id=$1", [
    failedRun.id,
  ]);
  catalog = [product(1, 120), product(2), product(3)];
  await processOne(factory);
  await processOne(factory);
  rows = await query("SELECT * FROM products WHERE organization_id=$1", [org]);
  assert.equal(rows.length, 3);
  assert.equal(Number(rows.find((r) => r.external_id === "1")!.price), 120);
  await assert.rejects(
    controlStore(other, actor, storeId, "pause"),
    /STORE_NOT_FOUND/,
  );
  assert.equal((await connectionOverview(org)).stores[0].paused, false);
  catalog = [product(1, 120), product(2)];
  for (let i = 0; i < 2; i++) {
    await enqueue(org, storeId, true);
    await processOne(factory);
  }
  const [missing] = await query(
    "SELECT * FROM products WHERE store_id=$1 AND external_id=$2",
    [storeId, "3"],
  );
  assert.equal(missing.availability, "unavailable");
  assert.equal(missing.stock, 0);
  assert.ok(missing.id, "missing products remain persisted");
  catalog = [product(1, 120), product(2), product(3)];
  await enqueue(org, storeId, true);
  await processOne(factory);
  await processOne(factory);
  const [restored] = await query("SELECT * FROM products WHERE id=$1", [
    missing.id,
  ]);
  assert.equal(restored.availability, "available");
  assert.equal(restored.stock, 3);
  // The next page can be reclaimed after worker death; the previous lease cannot commit.
  await enqueue(org, storeId, true);
  const old = await claim();
  await query(
    "UPDATE sync_runs SET lease_until=now()-interval '1 minute' WHERE id=$1",
    [old!.id],
  );
  const recovered = await claim();
  assert.ok(recovered);
  assert.notEqual(old!.lease_token, recovered!.lease_token);
  assert.equal(await applyPage(old!, { products: [], next: null }), false);
  await applyPage(recovered!, { products: catalog, next: null });
  assert.ok(calls > 5);
  assert.equal(
    (await query("SELECT * FROM products WHERE organization_id=$1", [other]))
      .length,
    0,
  );
});
test("imports 2,505 products in resumable pages with deduplicated jobs and quota rollback", async () => {
  const bigOrg = id();
  await query(
    "INSERT INTO organizations(id,name,plan,subscription_until) VALUES($1,'Large shop','business',now()+interval '30 days')",
    [bigOrg],
  );
  await query("UPDATE plans SET product_limit=3000 WHERE id='business'");
  let sinceSeen: string | null = null;
  const bigFactory = (): Connector => ({
    incremental: true,
    async page(c, since) {
      sinceSeen = since;
      const offset = Number(c.offset || 0);
      return {
        products: Array.from({ length: Math.min(100, 2505 - offset) }, (_, i) =>
          product(offset + i + 1),
        ),
        next: offset + 100 < 2505 ? { offset: offset + 100 } : null,
        total: 2505,
      };
    },
  });
  const { storeId } = await connectStore(bigOrg, actor, input, bigFactory);
  const jobs = await Promise.all(
    Array.from({ length: 4 }, () => enqueue(bigOrg, storeId)),
  );
  assert.equal(new Set(jobs).size, 1);
  for (let i = 0; i < 26; i++) await processOne(bigFactory);
  const [count] = await query(
    "SELECT count(*) AS n FROM products WHERE organization_id=$1",
    [bigOrg],
  );
  assert.equal(count.n, 2505);
  let [run] = await query(
    "SELECT * FROM sync_runs WHERE store_id=$1 ORDER BY started_at DESC LIMIT 1",
    [storeId],
  );
  assert.equal(run.status, "succeeded");
  assert.equal(run.processed, 2505);
  await enqueue(bigOrg, storeId);
  await processOne(bigFactory);
  assert.ok(
    sinceSeen,
    "incremental run sends last successful overlap watermark",
  );
  await controlStore(bigOrg, actor, storeId, "pause");
  // Rotation fences any old lease and retains product identity; secrets are not returned by the overview.
  await connectStore(
    bigOrg,
    actor,
    {
      ...input,
      existingStoreId: storeId,
      credentials: { key: "new-key", secret: "new-secret" },
    },
    bigFactory,
  );
  const publicData = await connectionOverview(bigOrg);
  assert.ok(!JSON.stringify(publicData).includes("new-secret"));
  assert.ok(!JSON.stringify(publicData).includes("config_ciphertext"));
  await query("UPDATE plans SET product_limit=2505 WHERE id='business'");
  const overFactory = (): Connector => ({
    incremental: true,
    async page() {
      return { products: [product(1, 999), product(3000)], next: null };
    },
  });
  await processOne(overFactory);
  [run] = await query(
    "SELECT * FROM sync_runs WHERE store_id=$1 ORDER BY started_at DESC LIMIT 1",
    [storeId],
  );
  assert.equal(run.status, "failed");
  assert.equal(run.error_code, "PRODUCT_LIMIT_REACHED");
  const [unchanged] = await query(
    "SELECT price FROM products WHERE organization_id=$1 AND external_id='1'",
    [bigOrg],
  );
  assert.equal(
    Number(unchanged.price),
    100,
    "whole page rolls back when quota is exceeded",
  );
});
test("webhooks verify raw HMAC signatures and deduplicate delivery without cross-tenant effects", async () => {
  const { POST } = await import("../app/api/webhooks/[storeId]/route");
  const { encrypt } = await import("../lib/imports/crypto");
  const { createHmac } = await import("node:crypto");
  const { storeId } = await connectStore(org, actor, input, factory);
  const secret = "fixture-webhook-secret";
  await query(
    "UPDATE store_connections SET webhook_secret_ciphertext=$1 WHERE store_id=$2",
    [await encrypt(secret, org, storeId), storeId],
  );
  const raw = JSON.stringify({ id: 1, name: "changed" });
  const signature = createHmac("sha256", secret).update(raw).digest("base64");
  const request = (sig: string) =>
    new Request("http://localhost/api/webhooks/" + storeId, {
      method: "POST",
      headers: { "x-wc-webhook-signature": sig },
      body: raw,
    });
  const ctx = { params: Promise.resolve({ storeId }) };
  assert.equal((await POST(request("wrong"), ctx)).status, 401);
  assert.equal((await POST(request(signature), ctx)).status, 200);
  assert.equal((await POST(request(signature), ctx)).status, 200);
  const [receipt] = await query(
    "SELECT count(*) AS n FROM webhook_receipts WHERE store_id=$1",
    [storeId],
  );
  assert.equal(receipt.n, 1);
  assert.equal((await connectionOverview(other)).stores.length, 0);
});

test("authorized matching pipeline saves only an unambiguous verified identity and blocks provider handoff", async () => {
  const { matchOne } = await import("../lib/imports/worker");
  process.env.DISCOVERY_API_URL = "https://authorized.example.com/discover";
  await query(
    "UPDATE matching_jobs SET next_attempt_at=now()+interval '1 day'",
  );
  const [p] = await query(
    "SELECT * FROM products WHERE organization_id=$1 LIMIT 1",
    [org],
  );
  await query(
    "UPDATE products SET title='Samsung S24 256 black',brand='Samsung',model='S24',barcode='1234567890123',attributes=$1,match_verified=false,torob_url=NULL WHERE id=$2",
    [JSON.stringify({ storage: "256", color: "black" }), p.id],
  );
  await query(
    "UPDATE matching_jobs SET status='awaiting_source',next_attempt_at=now(),attempts=0 WHERE product_id=$1",
    [p.id],
  );
  const candidate = {
    url: "https://torob.com/p/real-fixture/",
    title: "Samsung S24 256 black",
    brand: "Samsung",
    model: "S24",
    barcode: "1234567890123",
    attributes: { storage: "256", color: "black" },
  };
  await matchOne(async () => ({
    data: { candidates: [candidate] },
    headers: new Headers(),
    status: 200,
  }));
  const [matched] = await query("SELECT * FROM products WHERE id=$1", [p.id]);
  assert.equal(matched.match_verified, true);
  assert.equal(matched.match_confidence, 99);
  const [job] = await query("SELECT * FROM matching_jobs WHERE product_id=$1", [
    p.id,
  ]);
  assert.equal(job.status, "awaiting_competitor_provider");
  assert.equal(
    (await query("SELECT * FROM recommendations WHERE product_id=$1", [p.id]))
      .length,
    0,
    "no fabricated competitor data or recommendations",
  );
  await query(
    "UPDATE products SET match_verified=false,torob_url=NULL WHERE id=$1",
    [p.id],
  );
  await query(
    "UPDATE matching_jobs SET status='awaiting_source',next_attempt_at=now() WHERE product_id=$1",
    [p.id],
  );
  await matchOne(async () => ({
    data: {
      candidates: [
        candidate,
        { ...candidate, url: "https://torob.com/p/ambiguous-fixture/" },
      ],
    },
    headers: new Headers(),
    status: 200,
  }));
  assert.equal(
    (await query("SELECT * FROM products WHERE id=$1", [p.id]))[0]
      .match_verified,
    false,
    "ambiguous high-scoring candidates still require review",
  );
  delete process.env.DISCOVERY_API_URL;
});
