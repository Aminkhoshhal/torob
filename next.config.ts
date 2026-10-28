import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@electric-sql/pglite", "pg", "undici"],
  poweredByHeader: false,
};
export default config;
