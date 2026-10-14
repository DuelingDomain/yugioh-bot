import { expect, it } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination";
import nextConfig from "../next.config";

it("routes analytics assets and event ingestion to their EU hosts without matching other paths", async () => {
  const configured = await nextConfig.rewrites?.();
  const rules = Array.isArray(configured) ? configured : configured?.beforeFiles ?? [];
  function destination(pathname: string) {
    for (const rule of rules) {
      const params = getPathMatch(rule.source)(pathname);
      if (params) {
        const { newUrl, parsedDestination } = prepareDestination({ destination: rule.destination, params, query: {}, appendParamsToQuery: false });
        return new URL(`${parsedDestination.protocol}//${parsedDestination.hostname}${newUrl}`).href;
      }
    }
    return null;
  }
  expect(destination("/ingest/static/array.js")).toBe("https://eu-assets.i.posthog.com/static/array.js");
  expect(destination("/ingest/static/a/b.js")).toBe("https://eu-assets.i.posthog.com/static/a/b.js");
  expect(destination("/ingest/i/v0/e/")).toBe("https://eu.i.posthog.com/i/v0/e");
  expect(destination("/ingest/flags")).toBe("https://eu.i.posthog.com/flags");
  expect(destination("/ingest")).toBe("https://eu.i.posthog.com/");
  expect(destination("/ingestx/static/array.js")).toBeNull();
  expect(destination("/ingest-static/array.js")).toBeNull();
});
