import path from "node:path";
import type { NextConfig } from "next";

// The repo keeps one .env at the root (shared with the worker and docker compose).
try {
  process.loadEnvFile(path.resolve(process.cwd(), "../../.env"));
} catch {
  // No root .env (CI, Vercel): environment variables come from the platform.
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@vidora/core", "@vidora/db"],
  serverExternalPackages: ["postgres"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
