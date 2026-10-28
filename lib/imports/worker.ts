import { query, transaction, id } from "../db";
import { processOne, scheduleDue } from "./service";
import { scoreCandidate, type Candidate } from "./matching";
import { request, validateUrl, type Transport } from "./http";
import { z } from "zod";
import { ConnectorError } from "./types";
const candidateSchema = z.object({
  url: z
    .string()
    .url()
    .refine((raw) => {
      try {
        const u = new URL(raw);
        return (
          u.protocol === "https:" &&
          u.hostname === "torob.com" &&
          /^\/p\/[^/]+/.test(u.pathname) &&
          !u.username &&
          !u.password &&
          !u.port
        );
      } catch {
        return false;
      }
    }),
  title: z.string().min(1).max(1000),
  brand: z.string().optional(),
  model: z.string().optional(),
  barcode: z.string().optional(),
  attributes: z.record(z.string(), z.string()),
});
export async function matchOne(http: Transport = request) {
  if (!process.env.DISCOVERY_API_URL) return false;
  const token = id();
  const job = await transaction(async (db) => {
    const [r] = (
      await db.query(
        `SELECT j.* FROM matching_jobs j JOIN organizations o ON o.id=j.organization_id JOIN products p ON p.id=j.product_id AND p.organization_id=j.organization_id WHERE o.subscription_until>now() AND NOT p.match_verified AND j.attempts<5 AND j.next_attempt_at<=now() AND (j.status IN ('awaiting_source','retry') OR (j.status='running' AND j.lease_until<now())) LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,
      )
    ).rows;
    if (!r) return null;
    await db.query(
      "UPDATE matching_jobs SET status='running',lease_token=$1,lease_until=now()+interval '90 seconds',attempts=attempts+1 WHERE product_id=$2",
      [token, r.product_id],
    );
    return r;
  });
  if (!job) return false;
  try {
    const [p] = await query(
      "SELECT * FROM products WHERE id=$1 AND organization_id=$2",
      [job.product_id, job.organization_id],
    );
    const u = validateUrl(process.env.DISCOVERY_API_URL);
    const r = await http(u, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.DISCOVERY_API_TOKEN
          ? { Authorization: "Bearer " + process.env.DISCOVERY_API_TOKEN }
          : {}),
      },
      body: JSON.stringify({
        title: p.title,
        brand: p.brand,
        model: p.model,
        barcode: p.barcode,
        sku: p.source_sku,
        attributes: p.attributes,
      }),
    });
    const candidates = z
      .object({ candidates: z.array(candidateSchema).max(30) })
      .parse(r.data).candidates;
    const scored = candidates
      .map((c) => ({
        candidate: c,
        ...scoreCandidate(
          {
            title: p.title,
            brand: p.brand,
            model: p.model,
            barcode: p.barcode,
            attributes: p.attributes,
          },
          c,
        ),
      }))
      .sort((a, b) => b.confidence - a.confidence);
    // Ambiguity between distinct URLs always requires review, even at a high absolute score.
    const best = scored[0];
    const approved =
      !!best?.approved &&
      (!scored[1] || best.confidence - scored[1].confidence >= 5);
    await transaction(async (db) => {
      const [current] = (
        await db.query(
          "SELECT content_hash,match_verified FROM products WHERE id=$1 AND organization_id=$2 FOR UPDATE",
          [p.id, p.organization_id],
        )
      ).rows;
      const [lock] = (
        await db.query(
          "SELECT * FROM matching_jobs WHERE product_id=$1 AND organization_id=$2 FOR UPDATE",
          [p.id, p.organization_id],
        )
      ).rows;
      if (
        !lock ||
        lock.lease_token !== token ||
        current.content_hash !== p.content_hash ||
        current.match_verified
      )
        return;
      for (const item of scored)
        await db.query(
          "INSERT INTO matching_candidates(id,product_id,organization_id,url,title,score,details,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(product_id,url) DO UPDATE SET score=excluded.score,details=excluded.details,status=excluded.status",
          [
            id(),
            p.id,
            p.organization_id,
            item.candidate.url,
            item.candidate.title,
            item.confidence,
            JSON.stringify(item.candidate),
            approved && item === best ? "approved" : "review",
          ],
        );
      if (approved)
        await db.query(
          "UPDATE products SET torob_url=$1,match_verified=true,match_confidence=$2 WHERE id=$3 AND organization_id=$4",
          [best.candidate.url, best.confidence, p.id, p.organization_id],
        );
      await db.query(
        "UPDATE matching_jobs SET status=$1,lease_token=NULL,lease_until=NULL,error_code=NULL,updated_at=now() WHERE product_id=$2 AND organization_id=$3",
        [
          approved ? "awaiting_competitor_provider" : "manual_review",
          p.id,
          p.organization_id,
        ],
      );
    });
  } catch (e) {
    const code =
      e instanceof ConnectorError
        ? e.code
        : "DISCOVERY_SCHEMA_OR_REQUEST_FAILED";
    await query(
      "UPDATE matching_jobs SET status='retry',error_code=$1,next_attempt_at=now()+interval '15 minutes',lease_token=NULL,lease_until=NULL WHERE product_id=$2 AND organization_id=$3 AND lease_token=$4",
      [code, job.product_id, job.organization_id, token],
    );
  }
  return true;
}
const globalState = globalThis as typeof globalThis & {
  importWorker?: ReturnType<typeof setInterval>;
  importBusy?: boolean;
};
export async function tick() {
  if (globalState.importBusy) return;
  globalState.importBusy = true;
  try {
    await scheduleDue();
    for (let i = 0; i < 5; i++) {
      if (!(await processOne())) break;
    }
    await matchOne();
  } catch {
    console.error("Import worker tick failed; durable jobs will retry.");
  } finally {
    globalState.importBusy = false;
  }
}
export function startWorker() {
  if (globalState.importWorker || process.env.IMPORT_WORKER_ENABLED === "false")
    return;
  globalState.importWorker = setInterval(() => void tick(), 3000);
  globalState.importWorker.unref();
  void tick();
}
