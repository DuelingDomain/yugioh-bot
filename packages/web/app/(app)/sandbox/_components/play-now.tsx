"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { StatusLine, SvButton } from "@/components/sheet";
import { PageFrame } from "@/components/decks/page-frame";
import { startSandbox } from "@/components/sandbox/api";
import type { ScenarioData } from "../_lib/load";
import styles from "./sandbox.module.css";

/** The share link page (`/sandbox/<id>?play=1`). It starts the duel once, then replaces itself with the duel room. */
export function PlayNow({ scenario }: { scenario: ScenarioData }) {
  const router = useRouter();
  const started = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    // Strict mode runs effects twice in dev. The ref keeps it to one duel per attempt.
    if (started.current) return;
    started.current = true;
    startSandbox({ board: scenario.board, run: scenario.run, scenarioId: scenario.id })
      .then(({ slug }) => router.replace(`/duels/${slug}`))
      .catch((e: unknown) => setError(e instanceof Error && e.message ? e.message : "Could not start this scenario."));
  }, [attempt, router, scenario]);

  function retry() {
    started.current = false;
    setError(null);
    setAttempt((n) => n + 1);
  }

  return (
    <PageFrame title={scenario.name} sub="Starting the duel" back={{ href: "/sandbox", label: "Back to scenarios" }}>
      <div className={styles.playNow}>
        {error ? (
          <>
            <div role="alert"><StatusLine tone="block">{error}</StatusLine></div>
            <div className={styles.playActs}>
              <SvButton variant="primary" onClick={retry}>Try again</SvButton>
              <SvButton as="a" href={`/sandbox/${scenario.id}`} variant="ghost">Open in builder</SvButton>
            </div>
          </>
        ) : (
          <p role="status">Starting {scenario.name}…</p>
        )}
      </div>
    </PageFrame>
  );
}
