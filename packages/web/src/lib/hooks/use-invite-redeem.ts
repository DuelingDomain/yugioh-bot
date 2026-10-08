"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { readInviteParam, signInHref, stripInviteParam, type InviteApi, type RedeemResult } from "@/lib/invite-link";

export type InvitePhase =
  | { step: "checking" }
  | { step: "redeeming" }
  | { step: "ready" }
  | { step: "failed"; result: Exclude<RedeemResult, { kind: "ok" } | { kind: "unauthorized" } | { kind: "not-found" }> };

/**
 * The `?invite=` landing, for any page that shows a draft or tournament. It runs before anything protected loads:
 *
 * 1. Capture the `invite` value. (A signed-out visitor never gets here: the proxy sends them to sign-in and back to
 *    this same address, query included.)
 * 2. Redeem it with POST /invite. The page is not mounted, so no detail and no live connection are requested until
 *    it answers.
 * 3. On success, remove only the `invite` parameter from the address, without a new history entry.
 * 4. Report `ready`, and the page reads the event itself. Redeeming does not take a seat.
 *
 * A wrong, reset or unknown code is removed too, then the page's own request checks existing access and gives its
 * generic 404 when needed. Too many tries (429) stops and waits for `retry`: nothing here retries by itself. An address
 * without `invite` is ready on the next tick.
 */
export function useInviteRedeem(api: InviteApi, slug: string): { phase: InvitePhase; retry: () => void } {
  const router = useRouter();
  // The redeem effect reads the router through a ref, so a router that changes identity never runs it again.
  const routerRef = React.useRef(router);
  routerRef.current = router;
  const [phase, setPhase] = React.useState<InvitePhase>({ step: "checking" });
  // Bumped by retry to run the redeem once more. The code is read from the address each time.
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    const code = readInviteParam();
    if (code === null) {
      setPhase((current) => (current.step === "ready" ? current : { step: "ready" }));
      return;
    }
    let live = true;
    setPhase({ step: "redeeming" });
    void api.redeem(slug, code).then((result) => {
      if (!live) return;
      if (result.kind === "ok" || result.kind === "not-found") {
        stripInviteParam();
        setPhase({ step: "ready" });
      } else if (result.kind === "unauthorized") {
        // The session ended: sign in again and come back to this exact address, invite included.
        routerRef.current.push(signInHref());
      } else {
        setPhase({ step: "failed", result });
      }
    });
    return () => {
      live = false;
    };
  }, [api, slug, attempt]);

  const retry = React.useCallback(() => setAttempt((n) => n + 1), []);
  return { phase, retry };
}

/** The "wait about N seconds" line of a rate-limit answer. */
export function waitLine(result: { kind: string; retryAfter?: number | null }): string {
  const wait = result.kind === "rate-limited" ? result.retryAfter ?? null : null;
  return `Too many invite links were tried just now.${wait ? ` Wait about ${wait} ${wait === 1 ? "second" : "seconds"}, then try again.` : " Wait a few seconds, then try again."}`;
}
