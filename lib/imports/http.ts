import { lookup } from "node:dns/promises";
import { isIP, BlockList } from "node:net";
import { Agent, EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import { ConnectorError } from "./types";
const blocked = new BlockList();
for (const [ip, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as [string, number][])
  blocked.addSubnet(ip, prefix);
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
const reserved6 = new BlockList();
reserved6.addSubnet("2001::", 23, "ipv6");
reserved6.addSubnet("2001:db8::", 32, "ipv6");
reserved6.addSubnet("2002::", 16, "ipv6");
reserved6.addSubnet("3fff::", 20, "ipv6");
export function isPublicIP(ip: string) {
  const v = isIP(ip);
  return v === 4
    ? !blocked.check(ip, "ipv4")
    : v === 6 && global6.check(ip, "ipv6") && !reserved6.check(ip, "ipv6");
}
export function validateUrl(raw: string, origin?: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ConnectorError("INVALID_URL");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.hash ||
    (u.port && u.port !== "443") ||
    isIP(u.hostname) ||
    u.hostname.endsWith(".") ||
    !u.hostname.includes(".") ||
    u.hostname.endsWith(".local") ||
    u.hostname.endsWith(".internal") ||
    u.hostname === "metadata.google.internal"
  )
    throw new ConnectorError("UNSAFE_DESTINATION");
  if (origin && u.origin !== origin)
    throw new ConnectorError("CROSS_ORIGIN_ENDPOINT");
  const allowed = process.env.CONNECTOR_ALLOWED_HOSTS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV === "production" && !allowed?.length)
    throw new ConnectorError("ADMIN_HOST_ALLOWLIST_REQUIRED");
  if (allowed?.length && !allowed.includes(u.hostname))
    throw new ConnectorError("DESTINATION_NOT_APPROVED");
  return u;
}
export type HttpResult = {
  data: any;
  headers: { get(name: string): string | null };
  status: number;
};
export type Transport = (
  url: URL,
  init?: {
    headers?: Record<string, string>;
    method?: string;
    body?: string;
    responseType?: "binary";
  },
) => Promise<HttpResult>;
export const request: Transport = async (url, init = {}) => {
  validateUrl(url.href);
  let addresses;
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new ConnectorError("DNS_FAILED", true);
  }
  if (!addresses.length || addresses.some((a) => !isPublicIP(a.address)))
    throw new ConnectorError("PRIVATE_DESTINATION");
  // Pin direct connections to the validated address. The managed proxy handles its own DNS;
  // production additionally requires a server-controlled exact hostname allowlist.
  const address = addresses[0];
  const dispatcher =
    process.env.HTTPS_PROXY || process.env.https_proxy
      ? new EnvHttpProxyAgent()
      : new Agent({
          connect: {
            lookup: ((_: string, options: any, cb: any) =>
              options?.all
                ? cb(null, [address])
                : cb(null, address.address, address.family)) as any,
          },
        });
  try {
    const { responseType, ...fetchInit } = init;
    const r = await undiciFetch(url, {
      ...fetchInit,
      dispatcher,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    if (r.status >= 300 && r.status < 400) {
      await r.body?.cancel();
      throw new ConnectorError("REDIRECT_NOT_ALLOWED");
    }
    if (!r.ok) {
      await r.body?.cancel();
      const retryAfter = Math.min(
        3600,
        Math.max(0, Number(r.headers.get("retry-after")) || 0),
      );
      throw new ConnectorError(
        r.status === 401 || r.status === 403
          ? "API_PERMISSION_DENIED"
          : r.status === 429
            ? "RATE_LIMITED"
            : "PROVIDER_HTTP_" + r.status,
        r.status === 429 || r.status >= 500,
        retryAfter,
      );
    }
    const reader = r.body?.getReader();
    if (!reader) throw new ConnectorError("EMPTY_RESPONSE");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8_000_000) {
        await reader.cancel();
        throw new ConnectorError("RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
    if (responseType === "binary")
      return {
        data: Buffer.concat(chunks),
        headers: r.headers,
        status: r.status,
      };
    let data;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      throw new ConnectorError("INVALID_JSON");
    }
    return { data, headers: r.headers, status: r.status };
  } catch (e) {
    if (e instanceof ConnectorError) throw e;
    throw new ConnectorError("NETWORK_OR_TIMEOUT", true);
  } finally {
    await dispatcher.close();
  }
};
