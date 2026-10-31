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
  // Bridge discovery runs on the duel host; barrel exports must not trace its data into web.
  outputFileTracingExcludes: {
    "/*": ["../shared/data/effects/tags.jsonl.gz", "../shared/data/effects/bridge-mechanic-facts.json",
      "../shared/data/staples/bridge-observations.json"],
  },
  transpilePackages: ["@yugidraft/shared"],
  serverExternalPackages: ["better-sqlite3", "sharp"],
  images: { unoptimized: true },
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
