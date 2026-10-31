import Database from "better-sqlite3";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { migrate } from "@yugidraft/shared/db";
import { importBridgeArtifact } from "@yugidraft/shared/cards/effects";
import { CAPABILITY_KEYS, displayBridgeGroups, resolveBridgeGroup, type ArchetypeBridge, type BridgeFormat, type CapabilityKey } from "@yugidraft/shared/cards/effects";
import { createBridgeService } from "@yugidraft/shared/services";

export function bridgeCli(args: string[]): unknown {
  const option = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
  const format = option("--format") ?? "advanced";
  if (format !== "advanced" && format !== "genesys") throw new Error("--format must be advanced or genesys");
  const positional = args.filter((arg, i) => !arg.startsWith("--") && (i === 0 || !args[i - 1]!.startsWith("--")));
  const path = option("--database"), db = path ? new Database(path, { readonly: true, fileMustExist: true }) : new Database(":memory:");
  try {
    if (!path) { migrate(db); importBridgeArtifact(db); }
    const service = createBridgeService(db), [command, rawA, rawB] = positional;
    const canonical = (name: string | undefined) => name === undefined ? undefined : resolveBridgeGroup(name, service.rankingContext().groups) ?? name;
    const a = command === "needs" || command === "provides" ? rawA : canonical(rawA), b = canonical(rawB);
    if (command === "needs" || command === "provides") {
      if (!CAPABILITY_KEYS.includes(a as CapabilityKey)) throw new Error(`Unknown capability; choose from ${CAPABILITY_KEYS.join(", ")}`);
      return service.capabilities(a as CapabilityKey, command).filter(row => row.card.formats.includes("TCG"));
    }
    if (command === "from" && a) return option("--to") ? service.explain(a, canonical(option("--to"))!, format) : service.bridgesFrom(a, format, Number(option("--limit") ?? 4));
    if (command === "explain" && a && b) return service.explain(a, b, format);
    if (command === "path" && a && b) {
      const hops = Number(option("--hops") ?? 3);
      if (!Number.isInteger(hops) || hops < 1 || hops > 3) throw new Error("--hops must be 1, 2 or 3");
      const queue: { source: string; edges: ArchetypeBridge[] }[] = [{ source: a, edges: [] }], visited = new Set([a.toLowerCase()]);
      for (let i = 0; i < queue.length; i++) {
        const current = queue[i]!;
        if (current.edges.length >= hops) continue;
        const direct = service.explain(current.source, b, format);
        if (direct) return { source: a, target: b, format, hops: current.edges.length + 1, edges: [...current.edges, direct], warning: "Each edge is validated separately; combined lock and resource compatibility has not been verified" };
        for (const edge of service.bridgesFrom(current.source, format, 25)) if (!visited.has(edge.target.toLowerCase())) {
          visited.add(edge.target.toLowerCase()); queue.push({ source: edge.target, edges: [...current.edges, edge] });
        }
      }
      return null;
    }
    throw new Error('Usage: bridges from "X" [--to "Y"] [--format genesys] [--limit 4] | needs KEY | provides KEY | path "X" "Y" --hops 3 | explain "X" "Y" [--database PATH]');
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(displayBridgeGroups(bridgeCli(process.argv.slice(2))), null, 2)); }
  catch (error) { console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; }
}
