"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { SvButton } from "@/components/sheet";
import { readInviteParam, redeemDraftInvite, signInHref, stripInviteParam, type RedeemResult } from "@/lib/draft-invite";
import { DraftFrame } from "./draft-frame";
import { DraftState } from "./draft-state";
import styles from "./draft-state.module.css";

type Phase =
  | { step: "checking" }
  | { step: "redeeming" }
  | { step: "ready" }
  | { step: "failed"; result: Exclude<RedeemResult, { kind: "ok" } | { kind: "unauthorized" }> };

/**
 * The `?invite=` landing of /draft/[slug]. It runs before anything protected loads:
 *
 * 1. Capture the `invite` value. (A signed-out visitor never gets here: the proxy sends them to sign-in and back to
 *    this same address, query included.)
 * 2. Redeem it with POST /invite. No draft detail and no connection token are requested until it answers.
 * 3. On success, remove only the `invite` parameter from the address, without a new history entry.
 * 4. Mount the page, which reads the draft and shows the lobby. Redeeming does not take a seat; the lobby offers Join
 *    when the server says `canJoin`.
 *
 * A wrong, reset or unknown code is the same "Draft not found" as a missing draft. Too many tries (429) stops and
 * offers a manual retry: nothing here retries by itself. An address without `invite` mounts the page on the next tick.
 */
export function DraftInviteGate({ slug, children }: { slug: string; children: React.ReactNode }) {
  const router = useRouter();
  const [phase, setPhase] = React.useState<Phase>({ step: "checking" });
  // Bumped by Try again to run the redeem once more. The code is read from the address each time.
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    const code = readInviteParam();
    if (code === null) {
      setPhase({ step: "ready" });
      return;
    }
    let live = true;
    setPhase({ step: "redeeming" });
    void redeemDraftInvite(slug, code).then((result) => {
      if (!live) return;
      if (result.kind === "ok") {
        stripInviteParam();
        setPhase({ step: "ready" });
      } else if (result.kind === "unauthorized") {
        // The session ended: sign in again and come back to this exact address, invite included.
        router.push(signInHref());
      } else {
        setPhase({ step: "failed", result });
      }
    });
    return () => {
      live = false;
    };
  }, [slug, attempt, router]);

  if (phase.step === "ready") return <>{children}</>;
  if (phase.step === "failed") {
    if (phase.result.kind === "not-found") return <DraftState slug={slug} error={{ status: 404 }} onRetry={() => {}} />;
    const limited = phase.result.kind === "rate-limited";
    const wait = phase.result.kind === "rate-limited" ? phase.result.retryAfter : null;
    return (
      <DraftFrame title="Draft">
        <div className={styles.state}>
          <p className={styles.code}>{limited ? "Slow down" : "Error"}</p>
          <h2 className={styles.title}>{limited ? "Try again in a moment" : "This invite didn't open"}</h2>
          <p className={styles.text}>
            {limited
              ? `Too many invite links were tried just now.${wait ? ` Wait about ${wait} ${wait === 1 ? "second" : "seconds"}, then try again.` : " Wait a few seconds, then try again."}`
              : "Nothing was changed. Check your connection and try again."}
          </p>
          <div className={styles.acts}>
            <SvButton variant="primary" onClick={() => setAttempt((n) => n + 1)}>
              <RotateCw size={16} aria-hidden="true" />Try again
            </SvButton>
            <SvButton as="a" href="/drafts" variant="ghost">Drafts</SvButton>
          </div>
        </div>
      </DraftFrame>
    );
  }
  return (
    <DraftFrame title="Draft">
      <p className={styles.loading} role="status" aria-label="Loading draft">
        {phase.step === "redeeming" ? "Opening your invite…" : "Loading draft…"}
      </p>
    </DraftFrame>
  );
}
