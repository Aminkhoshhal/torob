import { z } from "zod";
export const intervals = [15, 30, 60, 180, 360, 720, 1440] as const;
const fieldPath = z
  .string()
  .regex(/^[A-Za-z0-9_.-]{1,120}$/)
  .refine(
    (s) =>
      !s
        .split(".")
        .some((p) => ["__proto__", "constructor", "prototype"].includes(p)),
  );
export const customSchema = z.object({
  endpoint: z.string().min(1).max(500),
  auth: z.enum(["none", "basic", "bearer", "header"]),
  headerName: z
    .string()
    .regex(/^[A-Za-z0-9-]+$/)
    .optional(),
  itemsPath: z
    .union([fieldPath, z.literal("")])
    .optional()
    .default("items"),
  pageParam: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .default("page"),
  sizeParam: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .default("per_page"),
  pageSize: z.number().int().min(1).max(250).default(100),
  pagination: z.enum(["page", "cursor"]).default("page"),
  nextCursorPath: fieldPath.optional(),
  modifiedParam: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .optional(),
  fields: z.object({
    id: fieldPath,
    title: fieldPath,
    price: fieldPath,
    sku: fieldPath.optional(),
    stock: fieldPath.optional(),
    available: fieldPath.optional(),
    description: fieldPath.optional(),
    brand: fieldPath.optional(),
    model: fieldPath.optional(),
    barcode: fieldPath.optional(),
    images: fieldPath.optional(),
    categories: fieldPath.optional(),
    attributes: fieldPath.optional(),
    regularPrice: fieldPath.optional(),
    salePrice: fieldPath.optional(),
    updatedAt: fieldPath.optional(),
    variants: fieldPath.optional(),
  }),
});
export const connectSchema = z.object({
  existingStoreId: z.string().uuid().optional(),
  name: z.string().min(2).max(100),
  domain: z.string().url().max(500),
  platform: z.enum([
    "auto",
    "woocommerce",
    "wordpress",
    "shopify",
    "prestashop",
    "custom",
    "sazito",
  ]),
  currency: z.enum(["IRT", "IRR", "USD", "EUR"]).default("IRT"),
  intervalMinutes: z
    .number()
    .refine((v) => intervals.includes(v as any))
    .default(60),
  credentials: z
    .object({
      key: z.string().max(4000).optional(),
      secret: z.string().max(4000).optional(),
      token: z.string().max(4000).optional(),
      webhookSecret: z.string().max(4000).optional(),
    })
    .default({}),
  custom: customSchema.optional(),
});
export type ConnectionInput = z.infer<typeof connectSchema>;
export type Config = Omit<ConnectionInput, "name" | "intervalMinutes"> & {
  storeId?: string;
  platform: Exclude<
    ConnectionInput["platform"],
    "auto" | "wordpress" | "sazito"
  >;
};
export type Cursor = Record<string, any>;
export type ImportedProduct = {
  externalId: string;
  parentId?: string;
  title: string;
  sku: string;
  barcode?: string;
  brand?: string;
  model?: string;
  description: string;
  categories: string[];
  images: string[];
  attributes: Record<string, string>;
  price: number;
  regularPrice: number | null;
  salePrice: number | null;
  stock: number;
  availability: "available" | "unavailable";
  updatedAt?: string;
};
export type Page = {
  products: ImportedProduct[];
  next: Cursor | null;
  total?: number;
  invalid?: number;
};
export interface Connector {
  page(cursor: Cursor, since: string | null): Promise<Page>;
  incremental: boolean;
}
export class ConnectorError extends Error {
  constructor(
    public code: string,
    public retryable = false,
    public retryAfter = 0,
  ) {
    super(code);
  }
}
