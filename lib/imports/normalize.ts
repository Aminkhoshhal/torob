import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import { ConnectorError, type ImportedProduct } from "./types";
export function amount(raw: unknown, currency: string) {
  try {
    if (typeof raw !== "string" && typeof raw !== "number") throw 0;
    const d = new Decimal(raw);
    const n = currency === "IRR" ? d.div(10) : d;
    if (!n.isInteger() || !n.isFinite() || n.lt(0) || n.gt(100_000_000_000))
      throw 0;
    return n.toNumber();
  } catch {
    throw new ConnectorError("INVALID_PRICE_OR_CURRENCY");
  }
}
export function stock(raw: unknown, available = true) {
  if (raw === null || raw === undefined) return 0;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) return 0;
  return available ? n : 0;
}
export function safeImages(raw: unknown) {
  return (Array.isArray(raw) ? raw : [])
    .map((v) => (typeof v === "string" ? v : v?.src || v?.url || ""))
    .filter((v) => {
      try {
        return new URL(v).protocol === "https:";
      } catch {
        return false;
      }
    })
    .slice(0, 30);
}
export function plain(raw: unknown) {
  return String(raw ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20000);
}
export function valueAt(obj: any, path?: string): any {
  if (!path) return undefined;
  return path
    .split(".")
    .reduce(
      (v, k) =>
        v && Object.prototype.hasOwnProperty.call(v, k) ? v[k] : undefined,
      obj,
    );
}
export function stableJSON(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJSON).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + stableJSON(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function fingerprint(p: ImportedProduct) {
  return createHash("sha256").update(stableJSON(p)).digest("hex");
}
export function validProduct(p: ImportedProduct) {
  if (
    !p.externalId ||
    p.externalId.length > 200 ||
    !p.title ||
    p.title.length > 1000 ||
    !Number.isSafeInteger(p.price) ||
    p.price < 0 ||
    !Number.isSafeInteger(p.stock) ||
    p.stock < 0
  )
    throw new ConnectorError("INVALID_PRODUCT");
  return p;
}
