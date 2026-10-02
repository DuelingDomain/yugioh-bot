import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const worktreeRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const nextConfig: NextConfig = {
  output: "standalone",
  ...(process.env.E2E_NEXT_DIST_DIR ? { distDir: process.env.E2E_NEXT_DIST_DIR } : {}),
  // Parent-repo lockfile made Next trace standalone under
  // .next/standalone/.worktrees/domain-multiplayer/... so Docker
  // `node packages/web/server.js` would miss the emitted server.
  outputFileTracingRoot: worktreeRoot,
  transpilePackages: ["@yugidraft/shared"],
  serverExternalPackages: ["better-sqlite3", "sharp"],
  images: {
    // Card art is immutable — cache optimized variants for a year instead of
    // the 60s default so previews stay warm. WebP only: AVIF's slower cold
    // encode is exactly the cold-start cost we are trying to reduce.
    minimumCacheTTL: 31536000,
    formats: ["image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.ygoprodeck.com",
        pathname: "/images/cards/**",
      },
      {
        protocol: "https",
        hostname: "images.ygoprodeck.com",
        pathname: "/images/cards_small/**",
      },
    ],
  },
};

export default nextConfig;
