import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { query, transaction } from "@/lib/db";
import { decrypt } from "@/lib/imports/crypto";
import { enqueue } from "@/lib/imports/service";
import { limit } from "@/lib/auth";
export const runtime = "nodejs";
export async function POST(
  req: Request,
  context: { params: Promise<{ storeId: string }> },
) {
  const { storeId } = await context.params;
  const [c] = await query(
    "SELECT c.*,s.platform FROM store_connections c JOIN stores s ON s.id=c.store_id WHERE c.store_id=$1",
    [storeId],
  );
  if (!c?.webhook_secret_ciphertext)
    return new Response("Not found", { status: 404 });
  if (!(await limit("webhook:" + storeId, 300)))
    return new Response("Rate limit", { status: 429 });
  const reader = req.body?.getReader();
  if (!reader) return new Response("Body required", { status: 400 });
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 1_000_000) {
      await reader.cancel();
      return new Response("Too large", { status: 413 });
    }
    parts.push(value);
  }
  const body = Buffer.concat(parts);
  const secret = await decrypt<string>(
    c.webhook_secret_ciphertext,
    c.organization_id,
    storeId,
  );
  const header =
    c.platform === "woocommerce"
      ? "x-wc-webhook-signature"
      : c.platform === "shopify"
        ? "x-shopify-hmac-sha256"
        : "x-pricepilot-signature";
  const supplied = Buffer.from(req.headers.get(header) || "", "base64");
  const expected = createHmac("sha256", secret).update(body).digest();
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return new Response("Invalid signature", { status: 401 });
  const event = createHash("sha256").update(body).digest("hex");
  await transaction(async (db) => {
    await db.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
      c.organization_id,
    ]);
    const [current] = (
      await db.query(
        "SELECT paused FROM store_connections WHERE store_id=$1 AND organization_id=$2 FOR UPDATE",
        [storeId, c.organization_id],
      )
    ).rows;
    const r = await db.query(
      "INSERT INTO webhook_receipts(store_id,event_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id",
      [storeId, event],
    );
    if (r.rows.length && !current.paused)
      await enqueue(c.organization_id, storeId, true, db);
  });
  return Response.json({ accepted: true });
}
