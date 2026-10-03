import net from "node:net";
import { isProcessAlive, readPid } from "./pid.mjs";

export function assertSupervisorStopped(pidFile) {
  const pid = readPid(pidFile);
  if (pid !== undefined && isProcessAlive(pid)) {
    throw new Error(`Stack supervisor ${pid} is running (${pidFile}). Stop it before preparing or starting this stack.`);
  }
}

export async function assertPortsFree(ports, livePorts) {
  const values = Object.values(ports);
  // Reject live ports before probing any of them.
  for (const port of values) {
    if (livePorts.includes(port)) throw new Error(`Port ${port} belongs to the live stack. Pick another E2E port.`);
  }
  for (const port of values) {
    const free = await new Promise((done) => {
      const probe = net.createServer();
      probe.once("error", () => done(false));
      probe.listen(port, () => probe.close(() => done(true)));
    });
    if (!free) throw new Error(`Port ${port} is already in use. Stop the old E2E stack first.`);
  }
}

export async function assertStackStopped(pidFile, ports, livePorts) {
  assertSupervisorStopped(pidFile);
  await assertPortsFree(ports, livePorts);
}
