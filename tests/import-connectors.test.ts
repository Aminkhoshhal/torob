import { test } from "node:test";
import assert from "node:assert/strict";
import { createConnector, detectPlatform } from "../lib/imports/connectors";
import { isPublicIP, validateUrl, type Transport } from "../lib/imports/http";
import { encrypt, decrypt } from "../lib/imports/crypto";
import { scoreCandidate } from "../lib/imports/matching";
import { amount } from "../lib/imports/normalize";
import type { Config } from "../lib/imports/types";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
process.env.LOCAL_DATA_DIR = mkdtempSync(tmpdir() + "/pricepilot-crypto-");
const config: Config = {
  platform: "woocommerce",
  domain: "https://shop.example.com",
  currency: "IRT",
  credentials: { key: "test-key", secret: "test-secret" },
};
const response = (data: unknown, headers: Record<string, string> = {}) => ({
  data,
  headers: new Headers(headers),
  status: 200,
});
test("WooCommerce follows pages and checkpoints individual variant pages", async () => {
  const seen: string[] = [];
  const http: Transport = async (u) => {
    seen.push(u.pathname + u.search);
    if (u.pathname.endsWith("/variations"))
      return response([
        {
          id: 21,
          price: "150",
          regular_price: "170",
          sale_price: "150",
          sku: "v",
          stock_quantity: 2,
          stock_status: "instock",
          attributes: [{ name: "color", option: "black" }],
        },
      ]);
    if (u.searchParams.get("page") === "2")
      return response(
        [
          {
            id: 3,
            name: "new",
            price: "200",
            stock_quantity: 1,
            stock_status: "instock",
          },
        ],
        { "x-wp-totalpages": "2" },
      );
    return response(
      [
        {
          id: 1,
          name: "simple",
          price: "100",
          stock_quantity: 4,
          stock_status: "instock",
        },
        {
          id: 2,
          type: "variable",
          name: "phone",
          attributes: [],
          categories: [{ name: "phones" }],
        },
      ],
      { "x-wp-totalpages": "2", "x-wp-total": "3" },
    );
  };
  const c = createConnector(config, http);
  let cursor = {};
  const items = [];
  for (let i = 0; i < 10; i++) {
    const r = await c.page(cursor, "2026-01-01T00:00:00Z");
    items.push(...r.products);
    if (!r.next) break;
    cursor = r.next;
  }
  assert.deepEqual(
    items.map((p) => p.externalId),
    ["1", "2:21", "3"],
  );
  assert.equal(items[1].parentId, "2");
  assert.equal(items[1].salePrice, 150);
  assert.ok(seen.some((s) => s.includes("modified_after=")));
  assert.equal(items[1].attributes.color, "black");
});
test("unknown inventory never fabricates positive stock", async () => {
  const c = createConnector(config, async () =>
    response([
      {
        id: 1,
        name: "x",
        price: "10",
        stock_status: "instock",
        stock_quantity: null,
      },
    ]),
  );
  assert.equal((await c.page({}, null)).products[0].stock, 0);
});
test("custom mappings import nested variants and cursor pagination", async () => {
  const c = createConnector(
    {
      ...config,
      platform: "custom",
      custom: {
        endpoint: "/catalog",
        auth: "bearer",
        itemsPath: "result.items",
        pageParam: "cursor",
        sizeParam: "size",
        pageSize: 100,
        pagination: "cursor",
        nextCursorPath: "result.next",
        fields: {
          id: "id",
          title: "name",
          price: "price",
          stock: "qty",
          variants: "variants",
        },
      },
      credentials: { token: "test" },
    },
    async (u, init) => {
      assert.equal(init?.headers?.Authorization, "Bearer test");
      return response({
        result: {
          items: [
            {
              id: "parent",
              name: "Phone",
              variants: [
                { id: "red", price: 20, qty: 3 },
                { id: "blue", price: 30, qty: 1 },
              ],
            },
          ],
          next: "opaque",
        },
      });
    },
  );
  const r = await c.page({}, null);
  assert.deepEqual(
    r.products.map((p) => p.externalId),
    ["parent:red", "parent:blue"],
  );
  assert.equal(r.next?.after, "opaque");
  await assert.rejects(c.page({ after: "opaque" }, null), /PAGINATION_STALLED/);
});
test("cross-origin custom endpoints cannot receive credentials", () =>
  assert.throws(
    () =>
      createConnector({
        ...config,
        platform: "custom",
        custom: {
          endpoint: "https://evil.example.com/api",
          auth: "none",
          itemsPath: "items",
          pageParam: "page",
          sizeParam: "size",
          pageSize: 100,
          pagination: "page",
          fields: { id: "id", title: "title", price: "price" },
        },
      }),
    /CROSS_ORIGIN_ENDPOINT/,
  ));
test("public address validation rejects private, reserved, mapped and loopback ranges", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "100.64.1.1",
    "192.168.1.1",
    "::1",
    "::ffff:8.8.8.8",
    "2001:db8::1",
  ])
    assert.equal(isPublicIP(ip), false, ip);
  assert.equal(isPublicIP("8.8.8.8"), true);
  assert.equal(isPublicIP("2606:4700:4700::1111"), true);
  for (const u of [
    "http://example.com",
    "https://127.0.0.1",
    "https://user:pass@example.com",
    "https://shop.local",
    "https://shop.example.com:8443",
  ])
    assert.throws(() => validateUrl(u));
});
test("connection detection uses public WordPress namespaces without credentials", async () =>
  assert.equal(
    (
      await detectPlatform(config.domain, async () =>
        response({ namespaces: ["wp/v2", "wc/v3"] }),
      )
    ).platform,
    "woocommerce",
  ));
test("credentials are authenticated and bound to tenant and store", async () => {
  const encrypted = await encrypt({ token: "secret-value" }, "tenant", "store");
  assert.ok(!encrypted.includes("secret-value"));
  assert.deepEqual(await decrypt(encrypted, "tenant", "store"), {
    token: "secret-value",
  });
  await assert.rejects(decrypt(encrypted, "other-tenant", "store"));
  await assert.rejects(
    decrypt(encrypted.slice(0, -3) + "abc", "tenant", "store"),
  );
});
test("matching rejects variants and missing critical attributes", () => {
  const p = {
    title: "Samsung S24 256 black",
    model: "S24",
    brand: "Samsung",
    barcode: "111",
    attributes: { storage: "256", color: "black" },
  };
  assert.equal(
    scoreCandidate(p, { ...p, url: "https://torob.com/p/a/" }).approved,
    true,
  );
  assert.equal(
    scoreCandidate(p, {
      ...p,
      attributes: { storage: "128", color: "black" },
      url: "https://torob.com/p/b/",
    }).confidence,
    0,
  );
  assert.equal(
    scoreCandidate(p, { ...p, attributes: {}, url: "https://torob.com/p/a/" })
      .approved,
    false,
  );
  assert.equal(
    scoreCandidate(
      { ...p, model: undefined, barcode: undefined, brand: undefined },
      {
        ...p,
        model: undefined,
        barcode: undefined,
        brand: undefined,
        url: "https://torob.com/p/a/",
      },
    ).approved,
    false,
  );
});
test("prices convert exact Rial units and reject fractional Toman", () => {
  assert.equal(amount("14900000", "IRR"), 1490000);
  assert.throws(() => amount("11", "IRR"));
  assert.throws(() => amount("NaN", "IRT"));
});
test("Shopify opaque cursors and access errors are handled", async () => {
  const c = createConnector(
    {
      ...config,
      platform: "shopify",
      domain: "https://merchant.myshopify.com",
      currency: "IRR",
      credentials: { token: "token" },
    },
    async (_, init) => {
      assert.match(init!.body!, /productVariants/);
      return response({
        data: {
          shop: { currencyCode: "IRR" },
          productVariants: {
            nodes: [
              {
                id: "gid://shopify/ProductVariant/1",
                title: "Default Title",
                sku: "SKU",
                price: "1000",
                inventoryQuantity: 4,
                selectedOptions: [],
                product: {
                  id: "gid://shopify/Product/1",
                  title: "Phone",
                  status: "ACTIVE",
                  images: { nodes: [] },
                },
              },
            ],
            pageInfo: { hasNextPage: true, endCursor: "next" },
          },
        },
      });
    },
  );
  const p = await c.page({}, null);
  assert.equal(p.products[0].price, 100);
  assert.equal(p.next?.after, "next");
});
test("PrestaShop keyset pagination resolves combination attributes and decimal impacts", async () => {
  const c = createConnector(
    { ...config, platform: "prestashop", storeId: "store" },
    async (u) => {
      const resource = u.pathname.split("/api/")[1];
      if (resource === "products") {
        if (u.searchParams.get("filter[id]") === "[2,999999999]")
          return response({ products: [] });
        return response({
          products: [
            {
              id: 1,
              name: [{ value: "Shirt" }],
              price: "10",
              active: "1",
              manufacturer_name: "Brand",
              associations: { combinations: [{ id: 2 }], images: [{ id: 4 }] },
            },
          ],
        });
      }
      if (resource === "combinations")
        return response({
          combinations: [
            {
              id: 2,
              id_product: 1,
              price: "2",
              reference: "SHIRT-BLUE",
              associations: { product_option_values: [{ id: 3 }] },
            },
          ],
        });
      if (resource === "stock_availables")
        return response({ stock_availables: [{ quantity: 5 }] });
      if (resource === "product_option_values/3")
        return response({
          product_option_value: {
            id_attribute_group: 6,
            name: [{ value: "Blue" }],
          },
        });
      if (resource === "product_options/6")
        return response({ product_option: { name: [{ value: "Color" }] } });
      throw new Error("Unexpected fixture request " + resource);
    },
  );
  const first = await c.page({}, null);
  assert.deepEqual(first.products, []);
  const second = await c.page(first.next!, null);
  assert.equal(second.products[0].externalId, "1:2");
  assert.equal(second.products[0].price, 12);
  assert.equal(second.products[0].attributes.Color, "Blue");
  assert.equal(second.products[0].images[0], "/api/import-images/store/1/4");
  assert.equal((await c.page(second.next!, null)).next, null);
});
