import { authenticate } from "@/lib/auth";
import { query } from "@/lib/db";
import { decrypt } from "@/lib/imports/crypto";
import { validateUrl, request } from "@/lib/imports/http";
import type { Config } from "@/lib/imports/types";
export const runtime = "nodejs";
export async function GET(
  req: Request,
  context: { params: Promise<{ segments: string[] }> },
) {
  const user = await authenticate(req);
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { segments } = await context.params;
  const [storeId, productId, imageId] = segments;
  if (
    segments.length !== 3 ||
    !/^\d+$/.test(productId) ||
    !/^\d+$/.test(imageId)
  )
    return new Response("Invalid image", { status: 400 });
  const [c] = await query(
    "SELECT c.* FROM store_connections c JOIN stores s ON s.id=c.store_id AND s.organization_id=c.organization_id WHERE c.store_id=$1 AND c.organization_id=$2 AND s.platform='prestashop'",
    [storeId, user.organization_id],
  );
  if (!c) return new Response("Not found", { status: 404 });
  try {
    const config = await decrypt<Config>(
      c.config_ciphertext,
      user.organization_id,
      storeId,
    );
    const base = validateUrl(config.domain);
    const u = new URL(
      base.pathname.replace(/\/$/, "") +
        `/api/images/products/${productId}/${imageId}`,
      base,
    );
    validateUrl(u.href, base.origin);
    const r = await request(u, {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(config.credentials.key + ":").toString("base64"),
      },
      responseType: "binary",
    });
    const type = r.headers.get("content-type")?.split(";")[0] || "";
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type))
      return new Response("Unsupported image", { status: 415 });
    return new Response(new Uint8Array(r.data), {
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Image unavailable", { status: 502 });
  }
}
