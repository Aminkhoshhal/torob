import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
let keyPromise: Promise<Buffer> | undefined;
async function key() {
  return (keyPromise ??= (async () => {
    if (process.env.CONNECTOR_ENCRYPTION_KEY) {
      const b = Buffer.from(process.env.CONNECTOR_ENCRYPTION_KEY, "base64");
      if (b.length !== 32)
        throw new Error(
          "CONNECTOR_ENCRYPTION_KEY must be base64-encoded 32 bytes",
        );
      return b;
    }
    if (
      process.env.NODE_ENV === "production" &&
      process.env.APP_ENV !== "local"
    )
      throw new Error("CONNECTOR_ENCRYPTION_KEY is required");
    const dir = process.env.LOCAL_DATA_DIR || ".data";
    await mkdir(dir, { recursive: true });
    const path = dir + "/connector-key";
    try {
      return await readFile(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const b = randomBytes(32);
      try {
        await writeFile(path, b, { mode: 0o600, flag: "wx" });
        return b;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST")
          return readFile(path);
        throw e;
      }
    }
  })());
}
export async function encrypt(value: unknown, org: string, store: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", await key(), iv);
  cipher.setAAD(Buffer.from(org + ":" + store));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}
export async function decrypt<T>(
  value: string,
  org: string,
  store: string,
): Promise<T> {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1") throw new Error("Unsupported credential version");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    await key(),
    Buffer.from(iv, "base64url"),
  );
  cipher.setAAD(Buffer.from(org + ":" + store));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(data, "base64url")),
      cipher.final(),
    ]).toString(),
  );
}
