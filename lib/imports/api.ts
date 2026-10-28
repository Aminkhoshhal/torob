import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "../db";
import { connectSchema, intervals, ConnectorError } from "./types";
import { connectStore, connectionOverview, controlStore } from "./service";
import { detectPlatform } from "./connectors";
import { encrypt } from "./crypto";
import { randomBytes } from "node:crypto";
export const messages: Record<string, string> = {
  SAZITO_OFFICIAL_API_NOT_VERIFIED:
    "دسترسی رسمی کاتالوگ سازیتو تأیید نشده است. از سازیتو مستندات و دسترسی مجاز API بگیرید و اتصال REST را با نگاشت رسمی تنظیم کنید.",
  API_PERMISSION_DENIED:
    "API دسترسی خواندن کاتالوگ را نداد. کلید و مجوز محصولات را بررسی کنید.",
  SHOPIFY_MYSHOPIFY_DOMAIN_REQUIRED:
    "برای Shopify دامنه اصلی با پسوند myshopify.com را وارد کنید.",
  SHOPIFY_SCOPE_OR_QUERY_ERROR:
    "دسترسی read_products و read_inventory یا سازگاری نسخه API شاپیفای را بررسی کنید.",
  UNSUPPORTED_CURRENCY_USE_IRT_OR_IRR:
    "این نسخه کاتالوگ ریالی یا تومانی را پشتیبانی می‌کند؛ تبدیل ارز خارجی نیاز به سیاست نرخ ارز دارد.",
  PRIVATE_DESTINATION: "آدرس‌های شبکه داخلی و محلی مجاز نیستند.",
  UNSAFE_DESTINATION: "دامنه عمومی HTTPS بدون پورت و اطلاعات ورود وارد کنید.",
  SUBSCRIPTION_REQUIRED: "ابتدا یک اشتراک فعال کنید.",
  STORE_LIMIT_REACHED: "ظرفیت فروشگاه طرح تکمیل شده است.",
  PRODUCT_LIMIT_REACHED:
    "ظرفیت محصول طرح تکمیل است؛ طرح را ارتقا دهید و واردسازی را ادامه دهید.",
  STORE_NOT_FOUND: "اتصال فروشگاه یافت نشد.",
  SYNC_PAUSED: "همگام‌سازی متوقف است؛ ادامه را انتخاب کنید.",
  ADMIN_HOST_ALLOWLIST_REQUIRED:
    "مدیر سرویس باید دامنه فروشگاه را در تنظیمات اتصال مجاز کند.",
  DESTINATION_NOT_APPROVED: "دامنه فروشگاه در فهرست مجاز مدیر سرویس نیست.",
  INVALID_API_SCHEMA:
    "پاسخ API با ساختار کاتالوگ سازگار نیست. مسیر و نگاشت فیلدها را بررسی کنید.",
  INVALID_PRICE_OR_CURRENCY:
    "واحد یا مقدار قیمت معتبر نیست. واحد ریال/تومان را بررسی کنید.",
  CUSTOM_MAPPING_REQUIRED: "برای API اختصاصی، مسیر و نگاشت فیلدها لازم است.",
  NETWORK_OR_TIMEOUT: "ارتباط با API برقرار نشد یا زمان درخواست به پایان رسید.",
  REDIRECT_NOT_ALLOWED:
    "API به آدرس دیگری هدایت می‌شود. آدرس نهایی و مستقیم HTTPS را وارد کنید.",
  RATE_LIMITED: "محدودیت درخواست API؛ تلاش مجدد خودکار زمان‌بندی شده است.",
};
export async function importAPI(
  req: Request,
  route: string,
  user: Record<string, any>,
) {
  const org = user.organization_id;
  if (route === "imports" && req.method === "GET")
    return NextResponse.json(await connectionOverview(org));
  if (route === "imports/products" && req.method === "GET") {
    const u = new URL(req.url);
    const page = Math.max(
      1,
      Math.min(10000, Number(u.searchParams.get("page")) || 1),
    );
    const search = (u.searchParams.get("search") || "").slice(0, 200);
    const filter = u.searchParams.get("filter") || "all";
    const store = u.searchParams.get("store") || "";
    const condition = `p.organization_id=$1 AND (p.title ILIKE $2 OR p.sku ILIKE $2 OR p.source_sku ILIKE $2) AND ($3='' OR p.store_id=$3) AND ($4='all' OR ($4='review' AND NOT p.match_verified) OR ($4='matched' AND p.match_verified) OR ($4='unavailable' AND p.availability='unavailable') OR ($4='imported' AND p.external_id IS NOT NULL))`;
    const params = [org, "%" + search + "%", store, filter];
    const [count] = await query(
      "SELECT count(*) AS n FROM products p WHERE " + condition,
      params,
    );
    const products = await query(
      "SELECT p.*,s.name AS store_name FROM products p JOIN stores s ON s.id=p.store_id AND s.organization_id=p.organization_id WHERE " +
        condition +
        " ORDER BY p.created_at DESC,p.id LIMIT 50 OFFSET $5",
      [...params, (page - 1) * 50],
    );
    return NextResponse.json({
      products,
      total: Number(count.n),
      page,
      pageSize: 50,
    });
  }
  if (route === "imports/candidates" && req.method === "GET") {
    const productId = new URL(req.url).searchParams.get("productId");
    return NextResponse.json({
      candidates: await query(
        "SELECT id,url,title,score,status,details FROM matching_candidates WHERE product_id=$1 AND organization_id=$2 ORDER BY score DESC",
        [productId, org],
      ),
    });
  }
  if (!route.startsWith("imports/")) return null;
  if (!["owner", "admin", "manager"].includes(user.role))
    return NextResponse.json(
      { error: "دسترسی مدیر فروشگاه لازم است." },
      { status: 403 },
    );
  try {
    if (route === "imports/detect" && req.method === "POST") {
      const v = z
        .object({ domain: z.string().url().max(500) })
        .parse(await req.json());
      return NextResponse.json(await detectPlatform(v.domain));
    }
    if (route === "imports/connect" && req.method === "POST") {
      const v = connectSchema.parse(await req.json());
      const result = await connectStore(org, user.id, v);
      const webhookSecret =
        result.platform === "shopify"
          ? v.credentials.webhookSecret || null
          : randomBytes(32).toString("hex");
      if (webhookSecret)
        await query(
          "UPDATE store_connections SET webhook_secret_ciphertext=$1 WHERE store_id=$2 AND organization_id=$3",
          [
            await encrypt(webhookSecret, org, result.storeId),
            result.storeId,
            org,
          ],
        );
      return NextResponse.json({
        ...result,
        webhookSecret,
        message:
          "اتصال خواندن محصولات تأیید شد؛ واردسازی در پس‌زمینه آغاز می‌شود.",
      });
    }
    if (route === "imports/control" && req.method === "POST") {
      const v = z
        .object({
          storeId: z.string().uuid(),
          action: z.enum(["pause", "resume", "refresh"]),
          intervalMinutes: z
            .number()
            .refine((n) => intervals.includes(n as any))
            .optional(),
        })
        .parse(await req.json());
      await controlStore(org, user.id, v.storeId, v.action, v.intervalMinutes);
      return NextResponse.json({ ok: true });
    }
  } catch (e) {
    if (e instanceof ConnectorError)
      return NextResponse.json(
        {
          error: messages[e.code] || "اتصال انجام نشد: " + e.code,
          code: e.code,
        },
        { status: e.code === "STORE_NOT_FOUND" ? 404 : 400 },
      );
    if (e instanceof z.ZodError)
      return NextResponse.json(
        {
          error: "اطلاعات اتصال یا نگاشت API معتبر نیست.",
          fields: e.issues.map((i) => i.path.join(".")),
        },
        { status: 400 },
      );
    throw e;
  }
  return NextResponse.json({ error: "مسیر یافت نشد." }, { status: 404 });
}
