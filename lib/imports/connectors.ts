import Decimal from "decimal.js";
import {
  ConnectorError,
  type Config,
  type Connector,
  type Cursor,
  type ImportedProduct,
  type Page,
} from "./types";
import { request, validateUrl, type Transport } from "./http";
import {
  amount,
  stock,
  safeImages,
  plain,
  valueAt,
  validProduct,
} from "./normalize";
const MAX_PAGES = 100000;
function array(v: unknown): any[] {
  if (!Array.isArray(v)) throw new ConnectorError("INVALID_API_SCHEMA");
  return v;
}
function date(v: unknown) {
  if (!v) return undefined;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}
function attributes(rows: any[]) {
  const a: Record<string, string> = {};
  for (const r of rows) {
    if (r?.name)
      a[plain(r.name)] = plain(
        r.option ??
          (Array.isArray(r.options) ? r.options.join(" / ") : r.value),
      );
  }
  return a;
}
export function createConnector(
  config: Config,
  http: Transport = request,
): Connector {
  const base = validateUrl(config.domain);
  const creds = config.credentials;
  const endpoint = (path: string) => {
    const u = new URL(path, base);
    validateUrl(u.href, base.origin);
    return u;
  };
  if (!["IRT", "IRR"].includes(config.currency))
    throw new ConnectorError("UNSUPPORTED_CURRENCY_USE_IRT_OR_IRR");
  if (config.platform === "woocommerce") {
    if (!creds.key || !creds.secret)
      throw new ConnectorError("WOOCOMMERCE_KEYS_REQUIRED");
    const headers = {
      Authorization:
        "Basic " +
        Buffer.from(creds.key + ":" + creds.secret).toString("base64"),
    };
    const get = (path: string) =>
      http(
        endpoint(base.pathname.replace(/\/$/, "") + "/wp-json/wc/v3/" + path),
        { headers },
      );
    const convert = (p: any, parent?: any): ImportedProduct => {
      if (p.id === undefined || typeof (parent?.name || p.name) !== "string")
        throw new ConnectorError("INVALID_API_SCHEMA");
      const available =
        (p.stock_status === "instock" || p.stock_status === "onbackorder") &&
        (parent?.status ?? p.status ?? "publish") === "publish";
      const attrs = attributes([
        ...(parent?.attributes || []),
        ...(p.attributes || []),
      ]);
      return validProduct({
        externalId: parent ? `${parent.id}:${p.id}` : String(p.id),
        parentId: parent ? String(parent.id) : undefined,
        title: plain(
          parent
            ? parent.name +
                " " +
                Object.values(attributes(p.attributes || [])).join(" / ")
            : p.name,
        ),
        sku: String(p.sku || ""),
        barcode: p.global_unique_id || undefined,
        brand: (p.brands || parent?.brands || [])[0]?.name,
        description: plain(p.description || parent?.description),
        categories: (p.categories || parent?.categories || []).map((c: any) =>
          plain(c.name),
        ),
        images: safeImages(p.images || (p.image ? [p.image] : parent?.images)),
        attributes: attrs,
        model: attrs.model || attrs["مدل"],
        price: amount(p.price, config.currency),
        regularPrice: p.regular_price
          ? amount(p.regular_price, config.currency)
          : null,
        salePrice: p.sale_price ? amount(p.sale_price, config.currency) : null,
        stock: stock(p.stock_quantity, available),
        availability: available ? "available" : "unavailable",
        updatedAt: date(
          p.date_modified_gmt ? p.date_modified_gmt + "Z" : undefined,
        ),
      });
    };
    return {
      incremental: true,
      async page(cursor, since) {
        const page = Number(cursor.page || 1);
        if (page > MAX_PAGES) throw new ConnectorError("PAGINATION_LIMIT");
        // Variations are separate page jobs so a parent with thousands of variants remains resumable.
        if (cursor.parent) {
          const variationPage = Number(cursor.variationPage || 1);
          const r = await get(
            `products/${cursor.parent.id}/variations?per_page=100&page=${variationPage}&orderby=id&order=asc`,
          );
          const rows = array(r.data);
          const products = rows
            .filter((p) => p.price !== "" && p.price !== undefined)
            .map((p) => convert(p, cursor.parent));
          const next =
            rows.length === 100
              ? { ...cursor, variationPage: variationPage + 1 }
              : { page, index: Number(cursor.index || 0) + 1 };
          return { products, next };
        }
        const params = new URLSearchParams({
          per_page: "50",
          page: String(page),
          orderby: "id",
          order: "asc",
          status: "any",
        });
        if (since)
          params.set("modified_after", since.replace(/\.\d{3}Z$/, "Z"));
        const r = await get("products?" + params);
        const rows = array(r.data);
        const index = Number(cursor.index || 0);
        const products: ImportedProduct[] = [];
        for (let i = index; i < rows.length; i++) {
          const p = rows[i];
          if (p.type === "variable")
            return {
              products,
              next: {
                page,
                index: i,
                parent: {
                  id: p.id,
                  name: p.name,
                  status: p.status,
                  attributes: p.attributes,
                  categories: p.categories,
                  images: p.images,
                  description: p.description,
                  brands: p.brands,
                },
                variationPage: 1,
              },
              total: Number(r.headers.get("x-wp-total")) || undefined,
            };
          if (p.price !== "" && p.price !== undefined)
            products.push(convert(p));
        }
        const totalPages = Number(r.headers.get("x-wp-totalpages"));
        return {
          products,
          next: totalPages
            ? page < totalPages
              ? { page: page + 1 }
              : null
            : rows.length === 50
              ? { page: page + 1 }
              : null,
          total: Number(r.headers.get("x-wp-total")) || undefined,
        };
      },
    };
  }
  if (config.platform === "shopify") {
    if (!base.hostname.endsWith(".myshopify.com") || base.pathname !== "/")
      throw new ConnectorError("SHOPIFY_MYSHOPIFY_DOMAIN_REQUIRED");
    if (!creds.token) throw new ConnectorError("SHOPIFY_TOKEN_REQUIRED");
    return {
      incremental: true,
      async page(cursor, since) {
        const query = `query Catalog($after:String,$filter:String){shop{currencyCode} productVariants(first:100,after:$after,query:$filter,sortKey:ID){pageInfo{hasNextPage endCursor} nodes{id title sku barcode price compareAtPrice inventoryQuantity selectedOptions{name value} product{id title descriptionHtml vendor productType status updatedAt images(first:20){nodes{url}}}}}}`;
        const r = await http(endpoint("/admin/api/2026-10/graphql.json"), {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": creds.token!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query,
            variables: {
              after: cursor.after || null,
              filter: since ? `updated_at:>=${since}` : null,
            },
          }),
        });
        if (r.data.errors?.length)
          throw new ConnectorError("SHOPIFY_SCOPE_OR_QUERY_ERROR");
        const d = r.data.data;
        if (!d?.productVariants?.pageInfo)
          throw new ConnectorError("INVALID_API_SCHEMA");
        if (d.shop.currencyCode !== (config.currency === "IRR" ? "IRR" : "IRT"))
          throw new ConnectorError("STORE_CURRENCY_MISMATCH");
        const products = array(d.productVariants.nodes).map((v) => {
          const p = v.product;
          const available = p.status === "ACTIVE";
          const a = attributes(
            (v.selectedOptions || []).map((o: any) => ({
              name: o.name,
              value: o.value,
            })),
          );
          return validProduct({
            externalId: v.id,
            parentId: p.id,
            title: plain(
              p.title + (v.title === "Default Title" ? "" : " " + v.title),
            ),
            sku: v.sku || "",
            barcode: v.barcode || undefined,
            brand: p.vendor,
            description: plain(p.descriptionHtml),
            categories: p.productType ? [p.productType] : [],
            images: safeImages(p.images?.nodes),
            attributes: a,
            model: a.model,
            price: amount(v.price, config.currency),
            regularPrice: v.compareAtPrice
              ? amount(v.compareAtPrice, config.currency)
              : null,
            salePrice: v.compareAtPrice
              ? amount(v.price, config.currency)
              : null,
            stock: stock(v.inventoryQuantity, available),
            availability: available ? "available" : "unavailable",
            updatedAt: date(p.updatedAt),
          });
        });
        const pi = d.productVariants.pageInfo;
        if (pi.hasNextPage && (!pi.endCursor || pi.endCursor === cursor.after))
          throw new ConnectorError("PAGINATION_STALLED");
        return {
          products,
          next: pi.hasNextPage ? { after: pi.endCursor } : null,
        };
      },
    };
  }
  if (config.platform === "prestashop") {
    if (!creds.key) throw new ConnectorError("PRESTASHOP_KEY_REQUIRED");
    const headers = {
      Authorization: "Basic " + Buffer.from(creds.key + ":").toString("base64"),
    };
    const get = (resource: string, params: Record<string, string> = {}) => {
      const u = endpoint(base.pathname.replace(/\/$/, "") + "/api/" + resource);
      u.search = new URLSearchParams({
        output_format: "JSON",
        ...params,
      }).toString();
      return http(u, { headers });
    };
    const localized = (v: any) =>
      Array.isArray(v) ? plain(v[0]?.value) : plain(v);
    const cache = new Map<string, any>();
    async function resource(type: string, singular: string, id: unknown) {
      if (!/^\d+$/.test(String(id)))
        throw new ConnectorError("INVALID_EXTERNAL_ID");
      const key = type + "/" + id;
      if (!cache.has(key)) {
        const r = await get(key);
        if (!r.data[singular]) throw new ConnectorError("INVALID_API_SCHEMA");
        cache.set(key, r.data[singular]);
      }
      return cache.get(key);
    }
    async function meta(p: any) {
      const categories = [];
      for (const c of p.associations?.categories || [])
        categories.push(
          localized((await resource("categories", "category", c.id)).name),
        );
      const a: Record<string, string> = {};
      for (const f of p.associations?.product_features || []) {
        const group = await resource(
          "product_features",
          "product_feature",
          f.id,
        );
        const value = await resource(
          "product_feature_values",
          "product_feature_value",
          f.id_feature_value,
        );
        a[localized(group.name)] = localized(value.value);
      }
      return { categories, attributes: a };
    }
    async function convert(
      p: any,
      v: any | null,
      metadata: any,
    ): Promise<ImportedProduct> {
      const stockResult = await get("stock_availables", {
        display: "full",
        "filter[id_product]": `[${p.id}]`,
        "filter[id_product_attribute]": `[${v?.id || 0}]`,
        limit: "100",
      });
      const inventory =
        stockResult.data.stock_availables === undefined
          ? []
          : array(stockResult.data.stock_availables);
      const a = { ...metadata.attributes };
      for (const option of v?.associations?.product_option_values || []) {
        const value = await resource(
          "product_option_values",
          "product_option_value",
          option.id,
        );
        const group = await resource(
          "product_options",
          "product_option",
          value.id_attribute_group,
        );
        a[localized(group.name)] = localized(value.name);
      }
      const available = String(p.active) === "1";
      let price;
      try {
        price = amount(
          new Decimal(p.price).plus(v?.price || 0).toString(),
          config.currency,
        );
      } catch {
        throw new ConnectorError("INVALID_PRICE_OR_CURRENCY");
      }
      const imageIds = v?.associations?.images?.length
        ? v.associations.images
        : p.associations?.images || [];
      return validProduct({
        externalId: v ? `${p.id}:${v.id}` : String(p.id),
        parentId: v ? String(p.id) : undefined,
        title:
          localized(p.name) + (v ? " " + Object.values(a).join(" / ") : ""),
        sku: String(v?.reference || p.reference || ""),
        barcode: String(v?.ean13 || p.ean13 || "") || undefined,
        description: localized(p.description),
        brand: p.manufacturer_name || undefined,
        categories: metadata.categories,
        images: config.storeId
          ? imageIds
              .filter((img: any) => /^\d+$/.test(String(img.id)))
              .map(
                (img: any) =>
                  `/api/import-images/${config.storeId}/${p.id}/${img.id}`,
              )
          : [],
        attributes: a,
        model: a.model || a["مدل"],
        price,
        regularPrice: price,
        salePrice: null,
        stock: stock(
          inventory.reduce(
            (n: number, s: any) => n + Math.max(0, Number(s.quantity) || 0),
            0,
          ),
          available,
        ),
        availability: available ? "available" : "unavailable",
        updatedAt: date(p.date_upd),
      });
    }
    return {
      incremental: true,
      async page(cursor, since) {
        if (cursor.parent) {
          const p = cursor.parent;
          const lastCombination = Number(cursor.lastCombination || 0);
          const result = await get("combinations", {
            display: "full",
            "filter[id_product]": `[${p.id}]`,
            "filter[id]": `[${lastCombination + 1},999999999]`,
            sort: "[id_ASC]",
            limit: "100",
          });
          const rows =
            result.data.combinations === undefined
              ? []
              : array(result.data.combinations);
          const products: ImportedProduct[] = [];
          for (const v of rows)
            products.push(await convert(p, v, cursor.metadata));
          const last = Number(rows.at(-1)?.id || lastCombination);
          if (rows.length && last <= lastCombination)
            throw new ConnectorError("PAGINATION_STALLED");
          return {
            products,
            next:
              rows.length === 100
                ? { ...cursor, lastCombination: last }
                : { lastId: Number(p.id) },
          };
        }
        const lastId = Number(cursor.lastId || 0);
        const params: Record<string, string> = {
          display: "full",
          sort: "[id_ASC]",
          limit: "1",
          "filter[id]": `[${lastId + 1},999999999]`,
        };
        if (since) {
          params["filter[date_upd]"] =
            `[${since.slice(0, 19).replace("T", " ")},9999-12-31 23:59:59]`;
          params.date = "1";
        }
        const r = await get("products", params);
        const rows =
          r.data.products === undefined ? [] : array(r.data.products);
        if (!rows.length) return { products: [], next: null };
        const p = rows[0];
        if (Number(p.id) <= lastId)
          throw new ConnectorError("PAGINATION_STALLED");
        const metadata = await meta(p);
        if (p.associations?.combinations?.length)
          return {
            products: [],
            next: { parent: p, metadata, lastCombination: 0 },
          };
        return {
          products: [await convert(p, null, metadata)],
          next: { lastId: Number(p.id) },
        };
      },
    };
  }
  const c = config.custom!;
  if (!c) throw new ConnectorError("CUSTOM_MAPPING_REQUIRED");
  if (c.pagination === "cursor" && !c.nextCursorPath)
    throw new ConnectorError("NEXT_CURSOR_PATH_REQUIRED");
  const url = endpoint(c.endpoint);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (c.auth === "basic") {
    if (!creds.key || !creds.secret)
      throw new ConnectorError("BASIC_CREDENTIALS_REQUIRED");
    headers.Authorization =
      "Basic " + Buffer.from(creds.key + ":" + creds.secret).toString("base64");
  }
  if (c.auth === "bearer") {
    if (!creds.token) throw new ConnectorError("TOKEN_REQUIRED");
    headers.Authorization = "Bearer " + creds.token;
  }
  if (c.auth === "header") {
    const header = c.headerName || "";
    if (
      !header ||
      /^(host|cookie|set-cookie|proxy-.*|connection|content-length|transfer-encoding|forwarded|x-forwarded-.*)$/i.test(
        header,
      ) ||
      !creds.token
    )
      throw new ConnectorError("UNSAFE_AUTH_HEADER");
    headers[header] = creds.token;
  }
  function convert(raw: any, parent?: any): ImportedProduct {
    const get = (key: keyof typeof c.fields) =>
      valueAt(raw, c.fields[key]) ??
      (parent ? valueAt(parent, c.fields[key]) : undefined);
    const ext = valueAt(raw, c.fields.id);
    if (ext === undefined || ext === null || typeof ext === "object")
      throw new ConnectorError("MISSING_EXTERNAL_ID");
    const available =
      get("available") !== false &&
      get("available") !== 0 &&
      get("available") !== "unavailable";
    const attrs = get("attributes");
    const a: Record<string, string> = {};
    if (attrs && typeof attrs === "object")
      for (const [k, v] of Object.entries(attrs)) a[plain(k)] = plain(v);
    return validProduct({
      externalId: parent
        ? String(valueAt(parent, c.fields.id)) + ":" + ext
        : String(ext),
      parentId: parent ? String(valueAt(parent, c.fields.id)) : undefined,
      title: plain(get("title")),
      sku: String(get("sku") || ""),
      barcode: get("barcode") ? String(get("barcode")) : undefined,
      brand: get("brand") ? plain(get("brand")) : undefined,
      model: get("model") ? plain(get("model")) : undefined,
      description: plain(get("description")),
      categories: Array.isArray(get("categories"))
        ? get("categories").map((v: any) => plain(v.name ?? v))
        : [],
      images: safeImages(get("images")),
      attributes: a,
      price: amount(get("price"), config.currency),
      regularPrice:
        get("regularPrice") != null
          ? amount(get("regularPrice"), config.currency)
          : null,
      salePrice:
        get("salePrice") != null
          ? amount(get("salePrice"), config.currency)
          : null,
      stock: stock(get("stock"), available),
      availability: available ? "available" : "unavailable",
      updatedAt: date(get("updatedAt")),
    });
  }
  return {
    incremental: !!c.modifiedParam,
    async page(cursor, since) {
      const page = Number(cursor.page || 1);
      if (page > MAX_PAGES) throw new ConnectorError("PAGINATION_LIMIT");
      const u = new URL(url);
      u.searchParams.set(c.sizeParam, String(c.pageSize));
      if (c.pagination === "page")
        u.searchParams.set(c.pageParam, String(page));
      else if (cursor.after)
        u.searchParams.set(c.pageParam, String(cursor.after));
      if (since && c.modifiedParam) u.searchParams.set(c.modifiedParam, since);
      const r = await http(u, { headers });
      const rows = array(c.itemsPath ? valueAt(r.data, c.itemsPath) : r.data);
      const products: ImportedProduct[] = [];
      for (const row of rows) {
        const variants = valueAt(row, c.fields.variants);
        if (Array.isArray(variants) && variants.length)
          for (const v of variants) products.push(convert(v, row));
        else products.push(convert(row));
      }
      let next: Cursor | null = null;
      if (c.pagination === "cursor") {
        const after = valueAt(r.data, c.nextCursorPath);
        if (after !== null && after !== undefined && after !== "") {
          if (String(after) === String(cursor.after))
            throw new ConnectorError("PAGINATION_STALLED");
          next = { after: String(after), page: page + 1 };
        }
      } else if (rows.length === c.pageSize) next = { page: page + 1 };
      return { products, next };
    },
  };
}
export async function detectPlatform(
  domain: string,
  http: Transport = request,
) {
  const u = validateUrl(domain);
  if (u.hostname.endsWith(".myshopify.com"))
    return { platform: "shopify", message: "Shopify Admin API" };
  try {
    const r = await http(
      new URL(u.pathname.replace(/\/$/, "") + "/wp-json/", u),
    );
    const namespaces = r.data?.namespaces;
    if (Array.isArray(namespaces) && namespaces.includes("wc/v3"))
      return { platform: "woocommerce", message: "WooCommerce REST API v3" };
    if (Array.isArray(namespaces))
      return {
        platform: "wordpress",
        message:
          "وردپرس بدون WooCommerce API شناسایی شد؛ REST API پیش‌فرض وردپرس کاتالوگ فروش ندارد.",
      };
  } catch (e) {
    if (
      e instanceof ConnectorError &&
      [
        "PRIVATE_DESTINATION",
        "DESTINATION_NOT_APPROVED",
        "UNSAFE_DESTINATION",
      ].includes(e.code)
    )
      throw e;
  }
  return {
    platform: "custom",
    message: "پلتفرم قابل تشخیص نیست؛ نوع فروشگاه یا نگاشت API را انتخاب کنید.",
  };
}
