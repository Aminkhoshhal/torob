import { normalizePersian } from "../pricing";
import type { ImportedProduct } from "./types";
export type Candidate = {
  url: string;
  title: string;
  brand?: string;
  model?: string;
  barcode?: string;
  attributes: Record<string, string>;
};
const keys: Record<string, string> = {
  حافظه: "storage",
  "حافظه داخلی": "storage",
  ظرفیت: "capacity",
  رنگ: "color",
  گارانتی: "warranty",
  مدل: "model",
  حجم: "capacity",
  "storage capacity": "storage",
};
function canonical(a: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) {
    const nk = normalizePersian(k);
    out[keys[nk] || nk] = normalizePersian(v).replace(/[۰-۹]/g, (c) =>
      String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)),
    );
  }
  return out;
}
export function scoreCandidate(
  p: Pick<
    ImportedProduct,
    "title" | "brand" | "model" | "barcode" | "attributes"
  >,
  c: Candidate,
) {
  const norm = (s: string) =>
    normalizePersian(s).replace(/[۰-۹]/g, (c) =>
      String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)),
    );
  const a = canonical(p.attributes),
    b = canonical(c.attributes);
  const critical = ["storage", "capacity", "color", "warranty", "model"];
  const conflicts = critical.filter((k) => a[k] && b[k] && a[k] !== b[k]);
  for (const k of ["brand", "model", "barcode"] as const)
    if (p[k] && c[k] && norm(p[k]!) !== norm(c[k]!)) conflicts.push(k);
  const tokens = (t: string) =>
    new Set(
      norm(t)
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean),
    );
  const left = tokens(p.title),
    right = tokens(c.title);
  const digitTokens = (s: Set<string>) => [...s].filter((t) => /\d/.test(t));
  const numbersA = digitTokens(left),
    numbersB = digitTokens(right);
  if (
    numbersA.some((n) => !numbersB.includes(n)) &&
    numbersB.some((n) => !numbersA.includes(n))
  )
    conflicts.push("model_tokens");
  if (conflicts.length)
    return { confidence: 0, approved: false, reasons: conflicts };
  const similarity =
    [...left].filter((t) => right.has(t)).length /
    Math.max(1, new Set([...left, ...right]).size);
  const sameModel = !!p.model && !!c.model && norm(p.model) === norm(c.model);
  const sameBrand = !!p.brand && !!c.brand && norm(p.brand) === norm(c.brand);
  const sameBarcode = !!p.barcode && p.barcode === c.barcode;
  const complete = critical.every((k) => !a[k] || !!b[k]);
  const identity =
    sameBarcode ||
    (sameModel && sameBrand && critical.some((k) => a[k] && b[k]));
  const confidence =
    identity && complete && similarity >= 0.8
      ? sameBarcode
        ? 99
        : 96
      : Math.min(
          94,
          Math.round(
            similarity * 65 + (sameModel ? 20 : 0) + (sameBrand ? 9 : 0),
          ),
        );
  return {
    confidence,
    approved: confidence >= 95 && complete && identity,
    reasons: complete ? [] : ["missing_critical_attributes"],
  };
}
