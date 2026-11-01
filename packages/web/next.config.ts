import { withSentryConfig } from "@sentry/nextjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const worktreeRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: { turbopackFileSystemCacheForBuild: process.env.NEXT_BUILD_FS_CACHE === "1" },
  env: { NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT ?? "", NEXT_PUBLIC_SENTRY_RELEASE: process.env.SENTRY_RELEASE ?? "" },
  poweredByHeader: false,
  // The "N" badge covers the corner of the board in screenshots and in the 3D mode preview (dev only; no effect in a build).
  devIndicators: false,
  ...(process.env.E2E_NEXT_DIST_DIR ? { distDir: process.env.E2E_NEXT_DIST_DIR } : {}),
  // Parent-repo lockfile made Next trace standalone under
  // .next/standalone/.worktrees/domain-multiplayer/... so Docker
  // `node packages/web/server.js` would miss the emitted server.
  outputFileTracingRoot: worktreeRoot,
  // Local recognition assets are prepared separately and served only by the gated lab.
  outputFileTracingExcludes: { "/*": ["../../data/vision/**/*"] },
  transpilePackages: ["@yugidraft/shared", "@yugidraft/vision"],
  serverExternalPackages: ["better-sqlite3", "sharp"],
  images: { unoptimized: true },
  // Cross-origin isolation for the card reader's threaded WASM. Keep Clerk's OAuth popups and YouTube embeds on all other pages unaffected.
  // The lab and its worker use require-corp. Remote tables use credentialless so Clerk avatars, scripts and any other
  // cross-origin image without a CORP header still load (they are fetched without cookies).
  async headers() {
    const coop = { key: "Cross-Origin-Opener-Policy", value: "same-origin" };
    return [
      { source: "/dev/vision-lab/:path*", headers: [coop, { key: "Cross-Origin-Embedder-Policy", value: "require-corp" }] },
      { source: "/duels/remote/:slug/cam", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "private, no-store" }] },
      { source: "/duels/remote/:slug", headers: [coop, { key: "Cross-Origin-Embedder-Policy", value: "credentialless" }] },
    ];
  },
};

const org = process.env.SENTRY_ORG?.trim();
const project = process.env.SENTRY_PROJECT?.split(",").map(project => project.trim()).filter(Boolean);
const authToken = process.env.SENTRY_AUTH_TOKEN?.trim();
const generateSourceMaps = process.env.SENTRY_GENERATE_SOURCEMAPS === "1";
const uploadSourceMaps = process.env.SENTRY_UPLOAD_SOURCEMAPS === "1" && !!org && !!project?.length && !!authToken;

export default withSentryConfig(nextConfig, {
  ...(uploadSourceMaps ? { org, project, authToken } : {}),
  silent: true,
  sourcemaps: { disable: !generateSourceMaps && !uploadSourceMaps, deleteSourcemapsAfterUpload: uploadSourceMaps },
  release: { create: false, finalize: false },
});
