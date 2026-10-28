# Automatic store catalog import and synchronization

## Merchant workflow

1. Start the application with `npm ci` and `npm run dev`. The in-app durable worker starts automatically; no second terminal is needed for local embedded PostgreSQL.
2. Register and activate a sandbox subscription (the existing billing milestone remains sandbox-only).
3. Open **فروشگاه‌ها → اتصال فروشگاه**, enter the public HTTPS store URL, and detect/select the platform.
4. Provide read-only API credentials and confirm the API currency (IRR or IRT). No store administrator password is requested. The server verifies a catalog request and a variation page when applicable before saving the connection.
5. Click **آزمون اتصال و واردسازی خودکار**. The entire available catalog is imported in resumable page jobs subject to subscription quotas. Each source variant becomes an independent local product.
6. Watch progress, set a 15/30/60/180/360/720/1440-minute interval, pause/resume, refresh, or rotate credentials. Search/filter the paginated product catalog. You never enter individual products for a supported connection.

**Price publishing remains disabled.** These connectors read the store; importing a catalog does not authorize outbound price changes. Purchase costs unknown to the provider remain zero, so the existing safe-pricing engine blocks recommendations until valid cost data is available. Billing and manual competitor inputs elsewhere in the app remain sandbox features.

## Platform capabilities and limitations

| Platform    | Authentication / API                                                             | Import / changes                                                                                                                                                           | Important limits                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WooCommerce | HTTPS Basic using REST consumer key + secret, `wc/v3`, Read permission           | Paginated products, independently paginated variations, SKU/GTIN, categories, attributes, images, descriptions, regular/sale/current prices, stock, modification watermark | Requires current WooCommerce REST v3 and public permalink/API access. Unmanaged/unknown stock is conservatively zero, never fabricated. Draft/trash products are not considered available. Variation-only changes that do not update the parent timestamp are repaired by daily full reconciliation or signed webhooks.                                                                                                                                                                 |
| WordPress   | WooCommerce REST or a documented custom catalog API                              | WordPress detection identifies REST namespaces                                                                                                                             | Core `wp/v2/posts` is not an ecommerce catalog. WordPress without a catalog plugin requires the custom REST adapter.                                                                                                                                                                                                                                                                                                                                                                    |
| Shopify     | GraphQL Admin API 2026-10, Admin token with `read_products` and `read_inventory` | Opaque variant cursors, product identity, brand, SKU/barcode, selected options, images, prices, inventory, `updated_at` search                                             | Use the canonical `*.myshopify.com` domain. This Iranian pricing application accepts IRR/IRT only; Shopify foreign-currency stores require an explicit FX policy before import. Product type is captured as a category; taxonomy and per-location inventory accounting are not implemented. Optional webhook authentication requires the app's actual client secret.                                                                                                                    |
| PrestaShop  | HTTPS Webservice key as Basic username, JSON output                              | ID keyset pagination, product features, categories, brand, stock, individually paginated combinations and option labels; authenticated image proxy                         | GET scopes: `products`, `combinations`, `stock_availables`, `categories`, `product_features`, `product_feature_values`, `product_options`, `product_option_values`, `images`. Prices are **base, tax-exclusive** plus combination impacts. Customer-group discounts, specific-price rules and tax-inclusive checkout prices are not supported; sale price remains unknown. Requires JSON-capable Webservice. Use an authorized custom API with final sell prices if these rules matter. |
| Custom REST | None, Basic, Bearer, or named API-key header                                     | Configurable same-origin path, dotted JSON field paths, numbered or cursor pagination, variants, optional modified-since query                                             | Stable IDs are mandatory. For cursor APIs configure `nextCursorPath`. An empty `itemsPath` selects a top-level array. Mapping applies to variant objects with parent fallback. Variant IDs are qualified by parent ID. No cross-origin pagination links, credential-bearing URLs, unsafe headers, or arbitrary scripts are accepted.                                                                                                                                                    |
| Sazito      | No verified native catalog API in this implementation                            | Clear unsupported state                                                                                                                                                    | Do not invent endpoints or ask for admin passwords. Obtain official API/authorized connector documentation from Sazito; configure the custom REST adapter only when those capabilities are provided.                                                                                                                                                                                                                                                                                    |

Native adapters have been validated with deterministic API fixtures, not live merchant stores. Live authorization, installed platform versions/plugins and scopes must be verified with the merchant's connection test. The application does not claim that every platform's installed plugins share a common API.

Official references inspected:

- https://woocommerce.github.io/woocommerce-rest-api-docs/
- https://shopify.dev/docs/api/admin-graphql/latest/queries/productVariants
- https://github.com/PrestaShop/docs/blob/master/webservice/tutorials/advanced-use/additional-list-parameters.md
- https://github.com/PrestaShop/docs/blob/master/webservice/resources/products.md
- https://barchin.net/actors/torob-product-sellers — returned HTTP 403 during this implementation; live actor schema/billing could not be verified.

## Custom REST mapping example

The wizard provides a starting template. Configure it once using the merchant API documentation:

```json
{
  "endpoint": "/api/products",
  "auth": "bearer",
  "itemsPath": "data.items",
  "pagination": "cursor",
  "pageParam": "cursor",
  "sizeParam": "limit",
  "pageSize": 100,
  "nextCursorPath": "data.next_cursor",
  "modifiedParam": "modified_since",
  "fields": {
    "id": "id",
    "title": "name",
    "price": "price",
    "regularPrice": "regular_price",
    "salePrice": "sale_price",
    "sku": "sku",
    "barcode": "barcode",
    "stock": "quantity",
    "available": "available",
    "brand": "brand",
    "model": "model",
    "description": "description",
    "categories": "categories",
    "images": "images",
    "attributes": "attributes",
    "variants": "variants",
    "updatedAt": "updated_at"
  }
}
```

The endpoint must be on the entered store origin. Prices use integer Toman storage; Rial is divided by exactly 10 with decimal arithmetic. Fractional Toman, negative, non-finite and oversized prices fail validation rather than being silently rounded or converted with an invented exchange rate. Availability uses booleans or `unavailable`; stock quantities must be nonnegative integers.

## Background processing and recovery

- PostgreSQL tables hold connections, runs, cursors, errors and seen identities. Unique active-job and imported-identity indexes prevent overlapping store jobs and duplicate products. Merchant SKU is not used as the import identity because multiple legitimate variants can share a SKU.
- A page is committed atomically with its cursor, counters, product changes and matching queue. A crash replays only the uncommitted page. Product-limit failures roll back the whole page; upgrade and refresh to retry.
- Workers claim jobs using `FOR UPDATE SKIP LOCKED`, a random lease token and a 120-second lease. Heartbeats extend active leases. Pause, reconnect and recovered leases fence stale results. No database transaction remains open during remote API requests.
- Timeouts, 429 and server errors retry up to five times with backoff, jitter and numeric Retry-After. The next scheduled cycle can recover a subsequently restored provider. Authentication/schema/unsafe-destination errors require intervention.
- Successful runs alone advance a five-minute-overlap watermark. Incremental adapters send it to their supported modified filter. Custom APIs without a modified filter receive full scans. A full reconciliation runs at least daily, and refresh/webhooks request full scans. Webhooks received during an active run request a follow-up scan rather than being dropped.
- Missing products are never permanently deleted. A record is conservatively marked unavailable only after absence from two complete, successful full scans. Incomplete, failed or paused scans do not mark missing records. A reappearing record restores availability even if its source content is unchanged.
- There is no universal consistent snapshot across remote store APIs. Catalog mutation while numbered pages are being read can cause temporary skips; overlap, repeated reconciliation and stable source identities converge on the catalog. Full deletion confirmation is deliberately conservative.
- The 3-second dashboard poll reports committed progress, not fabricated counts. Unknown total sizes use an indeterminate bar. Native Woo totals count parents while local products include variants; percentages are approximate and capped below 100 until successful completion.

For production, use shared PostgreSQL (`DATABASE_URL`) and a persistent Node server. Multiple PostgreSQL workers can claim independent jobs. Run `npm run worker` for separate worker processes with `IMPORT_WORKER_ENABLED=true`, and set the web service's flag to false if using dedicated workers. **Do not run a separate worker against local `.data/postgres`**; PGlite is a single-process local development database. Horizontal worker execution and live PostgreSQL deployment have not been load-tested here. Serverless processes with no persistent worker will not provide scheduled synchronization.

## Encryption, network policy and credentials

- Generate `CONNECTOR_ENCRYPTION_KEY` once as base64-encoded 32 random bytes. AES-256-GCM authenticates each encrypted config with tenant ID and store ID as associated data. Ciphertexts cannot be moved between tenants. Credentials never appear in overview, catalog, progress or error responses.
- Local development generates a key file with restrictive permissions at `.data/connector-key`. Production requires an explicit key. Back up the key and database together; key rotation needs deliberate re-encryption, not simply replacing the variable. The UI's **کلید جدید** retests and replaces a store's API credentials, retaining product IDs and fencing old jobs. Changing platform/domain requires a new store connection.
- Production requires `CONNECTOR_ALLOWED_HOSTS`, an exact administrator-controlled hostname list. Include the discovery host if enabled. Public HTTPS only: no raw IPs, embedded user credentials, nonstandard ports, cross-origin custom paths or redirects. DNS results are screened for private/reserved networks; direct connections pin the validated address. Managed proxy traffic retains session proxy and CA settings. The production network proxy/firewall must also deny private destinations and DNS rebinding; application DNS checks alone cannot pin the proxy's remote resolution.
- Logs contain stable error codes rather than provider responses, credential values or request headers. The health endpoint does not reveal configuration secrets.

## Signed webhooks

After connecting WooCommerce/custom APIs, the wizard displays a webhook endpoint and one-time signing secret. Configure product create/update/delete events in the merchant's authorized administration interface. The handler verifies HMAC-SHA256 over exact raw bytes, with a Base64 signature in `X-WC-Webhook-Signature`, `X-Shopify-Hmac-Sha256` or `X-PricePilot-Signature`. Shopify uses the actual app client secret supplied at connection, not a generated arbitrary secret. Payloads are size-limited and repeated deliveries deduplicated. Signed events trigger an authoritative catalog rescan; unsigned payload fields never directly change local prices. The local app URL must be externally reachable over HTTPS to receive real provider webhooks. Scheduled polling still works without webhooks.

## Authorized Torob discovery and pricing handoff

`DISCOVERY_API_URL` is an optional **operator-supplied, authorized** discovery service; `DISCOVERY_API_TOKEN` is optional bearer authentication. The service receives a POST with merchant title, SKU, brand, model, barcode and attributes and must return:

```json
{
  "candidates": [
    {
      "url": "https://torob.com/p/real-product-id/",
      "title": "Canonical product title",
      "brand": "Brand",
      "model": "Model",
      "barcode": "GTIN",
      "attributes": {
        "storage": "256",
        "color": "black",
        "warranty": "18 months"
      }
    }
  ]
}
```

Only actual returned URLs on `https://torob.com/p/` are accepted. The deterministic Persian-normalized matcher checks identity and critical storage, capacity, color, warranty/model attributes. Conflicts reject the candidate. Missing critical information, title-only similarity and close competing candidates cannot auto-approve. High-confidence unambiguous identities are saved and queued as `awaiting_competitor_provider`; ambiguous matches appear for explicit merchant review in product details. Attribute/identity changes invalidate old matches. This is an explainable rule matcher, **not a falsely claimed embedding/AI model**; no semantic model is configured in this milestone.

Without the discovery source, products remain `awaiting_source` and the dashboard explains why. Barchin's existing-product seller actor is not used as a discovery API. **Billable Barchin execution, response normalization, API cost reservations and automatic competitor-to-pricing handoff remain blocked** until its official schema/billing units and credentials can be verified. No competitor offers are fabricated and no billable calls are made. Live store price publishing is outside these read-only connectors and remains disabled.

## API endpoints

All `/api/imports*` data/control routes require an authenticated tenant session. Writes require owner/admin/manager and existing CSRF/content-type checks. Viewers may read only.

- `GET /api/imports`: tenant-safe connections, runs, counters, errors and capability states.
- `POST /api/imports/detect`: `{domain}`; public platform discovery without API credentials.
- `POST /api/imports/connect`: wizard connection config; verifies permissions then encrypts secrets and queues a full import. `existingStoreId` rotates an owned connection's credentials.
- `POST /api/imports/control`: `{storeId,action:"pause"|"resume"|"refresh",intervalMinutes?}`.
- `GET /api/imports/products?page=1&search=&filter=all&store=`: 50-row server-side catalog pages. Filters: `all`, `imported`, `review`, `matched`, `unavailable`.
- `GET /api/imports/candidates?productId=`: tenant-scoped matching candidates.
- `POST /api/webhooks/:storeId`: provider-authenticated signed webhook endpoint.
- `GET /api/import-images/:storeId/:productId/:imageId`: authenticated, tenant-scoped PrestaShop image proxy; API credentials stay on the server.

## Verification

```sh
npm run typecheck
npm test
# Against the running local app:
npm run smoke
npm run test:browser
# Stop next dev before building:
npm run build
```

Tests use isolated PostgreSQL-compatible PGlite databases and explicit API fixtures. They cover 2,505-product pagination, duplicate SKUs/jobs, quota rollback, encryption/AAD, tenant isolation, retry checkpoints, stale lease rejection, pause/resume, soft removal/restoration, HMAC deduplication, source variants and SSRF address filtering. Browser tests distinguish mocked progress fixtures from the real sandbox merchant journey. No test claims live merchant/Barchin integration verification.
