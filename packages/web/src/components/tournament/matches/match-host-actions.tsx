"use client";

import { AlertCircle, RotateCcw } from "lucide-react";
import { MatchButton } from "./match-controls";
import type { matchView } from "./match-model";
import type { MatchActions } from "./use-match-actions";
import styles from "./matches.module.css";

type HostControlsProps = { view: ReturnType<typeof matchView>; actions: MatchActions };

export function MatchHostControls({ view, actions, inline = false }: HostControlsProps & { inline?: boolean }) {
  if ((view.canReopen && actions.reopening) || (!view.canSetResult && !view.canReopen)) return null;
  const controls = (
    <>
      {view.canSetResult && (
        <MatchButton variant="quiet" small disabled={actions.loading !== null} onClick={actions.openResult}>
          Set result
        </MatchButton>
      )}
      {view.canReopen && (
        <MatchButton variant="quiet" small disabled={actions.loading !== null} onClick={actions.openReopen}>
          <RotateCcw className="ic sm" aria-hidden="true" />Reopen
        </MatchButton>
      )}
    </>
  );
  return inline ? controls : <div className="m-host"><span className="lbl">Organizer</span>{controls}</div>;
}

export function MatchReopenPanel({ view, actions }: HostControlsProps) {
  if (!view.canReopen || !actions.reopening) return null;
  return (
    <div className="report">
      <div className="banner banner-warn">
        <AlertCircle className="ic" aria-hidden="true" />
        <div><strong>Reopen this match?</strong> The result is cleared and the match goes back to not started. Either player can then play or report it again.</div>
      </div>
      <div className={`acts ${styles.reopenActs}`}>
        <MatchButton variant="quiet" small onClick={actions.cancelReopen}>Keep result</MatchButton>
        <MatchButton variant="danger" small disabled={actions.loading !== null} onClick={actions.reopen}>Reopen match</MatchButton>
      </div>
    </div>
  );
}
