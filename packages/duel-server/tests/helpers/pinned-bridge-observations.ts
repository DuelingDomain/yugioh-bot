const artifactUrl = new URL("../../../shared/data/staples/bridge-observations.json", import.meta.url);
const fixtureUrl = new URL("../fixtures/bridge-observations.json", import.meta.url);

/** Replay the co-play pairs and Ashtra sample from 225d838bf through the real observation loader. */
export function withPinnedBridgeObservations(fs: typeof import("node:fs")) {
  return {
    ...fs,
    readFileSync(path: Parameters<typeof fs.readFileSync>[0], ...args: unknown[]) {
      if (String(path) === artifactUrl.href) return fs.readFileSync(fixtureUrl);
      return (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...args);
    },
  };
}
