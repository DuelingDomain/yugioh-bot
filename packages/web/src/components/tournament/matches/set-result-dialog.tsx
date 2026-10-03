"use client";

import { useId, useLayoutEffect, useRef } from "react";
import { AlertCircle } from "lucide-react";
import { RankGem, SheetPortal } from "@/components/sheet";
import { isSeriesOpen, seriesScore } from "../duel-rules";
import type { PlayerRatings } from "../sheet-contracts";
import type { Match } from "../types";
import { MatchButton, MatchError } from "./match-controls";
import type { MatchActions } from "./use-match-actions";
import styles from "./matches.module.css";

type DialogProps = { match: Match; ratings: PlayerRatings; bestOf: number; actions: MatchActions };

/** The portal mounts after the first render, so the focus trap lives in the body it renders. */
export function SetResultDialog(props: DialogProps) {
  return <SheetPortal><DialogBody {...props} /></SheetPortal>;
}

function DialogBody({ match, ratings, bestOf, actions }: DialogProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(actions.closeResult);
  close.current = actions.closeResult;

  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = dialog.current!;
    const focusable = () => {
      const elements = Array.from(node.querySelectorAll<HTMLElement>('button, input, a[href], [tabindex="0"]'))
        .filter(element => !element.matches(":disabled") && !(element instanceof HTMLInputElement && element.type === "hidden"))
        .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      // Native Tab visits one radio in a group: the checked option, or the first.
      return elements.filter(element => {
        if (!(element instanceof HTMLInputElement) || element.type !== "radio") return true;
        const group = elements.filter((other): other is HTMLInputElement => other instanceof HTMLInputElement && other.type === "radio" && other.name === element.name);
        return element === (group.find(other => other.checked) ?? group[0]);
      });
    };
    focusable()[0]?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (event.key === "Tab") {
        const elements = focusable(), first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    function focusin(event: FocusEvent) {
      if (!node.contains(event.target as Node)) focusable()[0]?.focus();
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", focusin);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("focusin", focusin);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const live = isSeriesOpen(match.series);
  const [one, two] = match.series ? seriesScore(match.series, match) : [0, 0];
  const leader = one > two ? match.playerOneName : match.playerTwoName;
  return <div className={styles.overlay}>
    <div ref={dialog} className="dialog cfm" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div><h3 id={titleId}>Set the result</h3><p className="sub">{match.playerOneName} vs {match.playerTwoName} · Best of {match.series?.bestOf ?? bestOf} · organizer decision</p></div>
      <fieldset className="pick">
        <legend className="label">Who won the match?</legend>
        {[
          { id: match.playerOneId, name: match.playerOneName },
          { id: match.playerTwoId, name: match.playerTwoName },
        ].map(player => player.id === null ? null : <label key={player.id}>
          <input type="radio" name={`result-winner-${titleId}`} value={player.id} checked={actions.winner === player.id} onChange={() => actions.setWinner(player.id)} aria-label={player.name ?? "Opponent"} />
          <RankGem tier={ratings.get(player.id)?.rank ?? "none"} />{player.name}
          {ratings.has(player.id) && <span className="elo">{ratings.get(player.id)!.rating}</span>}
        </label>)}
      </fieldset>
      {live && <div className="banner banner-warn"><AlertCircle className="ic" aria-hidden="true" /><div>
        This cancels the online duel in progress, which {one === two ? "is tied" : `${leader} leads`} <strong>{Math.max(one, two)}–{Math.min(one, two)}</strong>.
      </div></div>}
      <MatchError error={actions.resultError} />
      <div className="acts">
        <MatchButton variant="quiet" onClick={actions.closeResult}>Cancel</MatchButton>
        <MatchButton variant={live ? "danger" : "primary"} disabled={actions.winner === null || actions.loading !== null} onClick={actions.recordResult}>{live ? "End duel and record" : "Record result"}</MatchButton>
      </div>
    </div>
  </div>;
}
