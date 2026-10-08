import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { fork } = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock("node:child_process", () => ({ fork }));
import { smokePrereleaseScripts } from "../scripts/prerelease-script-smoke.js";

type Plan = { delay?: number; action?: "hang" | "crash"; stderr?: string };
function workers(...plans: Plan[]) {
 const requests: number[][] = [];
 fork.mockImplementation(() => {
  const plan = plans.shift() ?? {};
  const child = Object.assign(new EventEmitter(), {
   stdout: { resume() {} }, stderr: new EventEmitter(), kill: vi.fn(),
   send({ codes }: { codes: number[] }) {
    requests.push(codes);
    setTimeout(() => {
     if(plan.stderr) child.stderr.emit("data",Buffer.from(plan.stderr));
     for(const code of codes) {
      child.emit("message",{kind:"active",code});
      if(plan.action === "hang") return;
      if(plan.action === "crash") { child.emit("exit",1,null); return; }
      child.emit("message",{kind:"checked",code,errors:[]});
     }
     child.emit("message",{kind:"done"});
    }, plan.delay ?? 0);
   },
  });
  return child;
 });
 return requests;
}
beforeEach(()=>{ vi.useFakeTimers(); fork.mockReset(); });
afterEach(()=>{ vi.useRealTimers(); vi.restoreAllMocks(); });
it("does not charge cold worker startup against the first card timeout",async()=>{
 workers({delay:100});
 const result=expect(smokePrereleaseScripts("unused",[1],{timeoutMs:10})).resolves.toEqual({checked:1,excluded:[]});
 await vi.runAllTimersAsync(); await result;
});
it.each(["hang","crash"] as const)("retries a transient %s in a fresh worker without an exclusion",async action=>{
 const requests=workers({action},{});
 const result=expect(smokePrereleaseScripts("unused",[1,2],{timeoutMs:10})).resolves.toEqual({checked:2,excluded:[]});
 await vi.runAllTimersAsync(); await result;
 expect(requests).toEqual([[1,2],[1,2]]);
});
it.each(["hang","crash"] as const)("records only a fixed reason after two %s failures and resumes later cards",async action=>{
 const requests=workers({action,stderr:"first random stderr"},{action,stderr:"different timing 55ms"},{});
 const result=expect(smokePrereleaseScripts("unused",[1,2],{timeoutMs:10})).resolves.toEqual({checked:2,excluded:[{code:1,errors:[action==="hang"?"card-timeout":"worker-crash"]}]});
 await vi.runAllTimersAsync(); await result;
 expect(requests).toEqual([[1,2],[1,2],[2]]);
});
it("uses a thirty-second default card timeout",async()=>{
 workers({action:"hang"},{});
 const result=smokePrereleaseScripts("unused",[1]);
 await vi.advanceTimersByTimeAsync(29_999); expect(fork).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1); await vi.runAllTimersAsync();
 expect(await result).toEqual({checked:1,excluded:[]});expect(fork).toHaveBeenCalledTimes(2);
});
it("aborts a crash attributed to a shared script without retrying or excluding cards",async()=>{
 const requests=workers({action:"crash",stderr:'[string "proc_shared.lua"]:1: core failure'},{});
 const result=smokePrereleaseScripts("unused",[1,2]).then(()=>undefined,error=>error as Error);
 await vi.runAllTimersAsync();
 expect((await result)?.message).toMatch(/infrastructure.*proc_shared.lua/i);
 expect(requests).toEqual([[1,2]]);
});
