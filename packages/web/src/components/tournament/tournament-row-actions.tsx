"use client";

import { DuelAction, SvButton } from "@/components/sheet";
import { useOptionalRouter } from "./use-optional-router";
import { useMatchActions } from "./matches/use-match-actions";
import type { RowAction } from "./tournaments-list-model";
import styles from "./tournament-row.module.css";

/**
 * The one duel action of a list row. Open duel and Watch are links. Start duel, Confirm and Deny
 * call the same endpoints as the tournament page (through its `useMatchActions` hook), and
 * a failure shows under the buttons. Put it above the row's stretched link.
 */
export function TournamentRowAction({ action, tournamentSlug }: { action: RowAction; tournamentSlug: string | null }) {
  if (action.kind === "open") return <DuelAction kind="open" href={action.href} />;
  if (action.kind === "watch") return <DuelAction kind="watch" href={action.href} />;
  // The match endpoints are addressed by the tournament's web slug. Older tournaments have none.
  if (!tournamentSlug) return null;
  return <MatchButtons action={action} tournamentSlug={tournamentSlug} />;
}

function MatchButtons({ action, tournamentSlug }: { action: Extract<RowAction, { kind: "start" | "confirm" }>; tournamentSlug: string }) {
  const router = useOptionalRouter();
  const actions = useMatchActions(action.match, tournamentSlug, () => router?.refresh());
  const busy = actions.loading !== null;
  return (
    <div className={styles.actionWrap}>
      <div className={styles.actionBtns}>
        {action.kind === "start" ? (
          <DuelAction kind="start" onClick={actions.start} disabled={busy} />
        ) : (
          <>
            <SvButton variant="primary" onClick={actions.approve} disabled={busy}>
              Confirm
            </SvButton>
            <SvButton variant="danger" onClick={actions.deny} disabled={busy}>
              Deny
            </SvButton>
          </>
        )}
      </div>
      {actions.error && (
        <p role="alert" className={styles.actionError}>
          {actions.error}
        </p>
      )}
    </div>
  );
}
