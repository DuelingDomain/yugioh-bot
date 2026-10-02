"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { DUEL_BANLIST_OPTIONS } from "@yugidraft/shared/duels";
import { DuelRulesFields } from "./duel-rules-fields";
import { DeadlinePicker } from "./deadline-picker";
import { buildRulesPayload, defaultDuelRulesValue } from "./duel-rules";
import { formatClosesAt, formatName, sizeTable, type TournamentFormat } from "./create-tournament-model";
import styles from "./create-tournament-form.module.css";

const FORMAT_CHOICES: ReadonlyArray<{ value: TournamentFormat; title: string; body: string }> = [
  {
    value: "round_robin",
    title: "Round robin",
    body: "Everyone plays everyone once. Matches can be played in any order.",
  },
  {
    value: "single_elim",
    title: "Single elimination",
    body: "Lose once and you're out. Each round is paired when the last one ends.",
  },
];

/**
 * The new tournament form. Render it inside a `SheetRoot`; the page supplies the header,
 * breadcrumb and station track, this supplies the ruled sections and the summary.
 */
export function CreateTournamentForm() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [format, setFormat] = React.useState<TournamentFormat>("round_robin");
  const [deadline, setDeadline] = React.useState<Date | null>(null);
  const [confirmHours, setConfirmHours] = React.useState("");
  const [rules, setRules] = React.useState(defaultDuelRulesValue);
  const [submitting, setSubmitting] = React.useState(false);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const nameRef = React.useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setNameError("Give the tournament a name.");
      nameRef.current?.focus();
      return;
    }
    setNameError(null);

    setSubmitting(true);
    try {
      const res = await fetch("/api/tournaments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          format,
          deadlineAt: deadline ? deadline.toISOString() : null,
          reportConfirmWindowHours: confirmHours.trim() ? Number(confirmHours) : null,
          ...buildRulesPayload(rules),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to create tournament");
      }

      const tournament = await res.json();
      if (tournament.webSlug) {
        router.push(`/tournament/${tournament.webSlug}`);
      } else {
        router.push("/tournaments");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  const table = sizeTable(format);
  const banlistLabel = DUEL_BANLIST_OPTIONS.find((o) => o.id === rules.banlist)?.label ?? rules.banlist;
  const turnLabel = rules.turnSeconds === 0 ? "Unlimited" : rules.turnSeconds % 60 === 0 ? `${rules.turnSeconds / 60} min` : `${rules.turnSeconds} sec`;
  const hoursLabel = confirmHours.trim() ? `${confirmHours.trim()} hours` : "24 hours";

  return (
    <>
      <form className="mk" onSubmit={handleSubmit} noValidate>
        <div className="mk-secs">
          <section className="mk-sec" aria-labelledby="mk-ev">
            <div className="mk-side">
              <h2 id="mk-ev">Event</h2>
              <p>Players see this name in Discord and on the web.</p>
            </div>
            <div className="fields">
              <div className="wide">
                <label className="label" htmlFor="tournament-name">
                  Tournament name
                </label>
                <input
                  ref={nameRef}
                  className={`input${nameError ? " bad" : ""}`}
                  id="tournament-name"
                  type="text"
                  value={name}
                  placeholder="Friday Night Duels"
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameError ? "tournament-name-error" : undefined}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (nameError) setNameError(null);
                  }}
                />
                {nameError && (
                  <p className="ferr" id="tournament-name-error">
                    <CircleAlert className="ic sm" aria-hidden="true" />
                    {nameError}
                  </p>
                )}
              </div>
              <fieldset className={`wide ${styles.fieldset}`}>
                <legend className="label">Format</legend>
                <div className="opts">
                  {FORMAT_CHOICES.map((choice) => (
                    <label className={`opt ${styles.opt}`} key={choice.value}>
                      <input
                        type="radio"
                        name="tournament-format"
                        value={choice.value}
                        checked={format === choice.value}
                        onChange={() => setFormat(choice.value)}
                      />
                      <b>{choice.title}</b>
                      <span>{choice.body}</span>
                    </label>
                  ))}
                </div>
                <table className={styles.ladder}>
                  <caption>{table.caption}</caption>
                  <thead>
                    <tr>
                      <th scope="row">Players</th>
                      {table.players.map((n) => (
                        <td key={n}>{n}</td>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Matches</th>
                      {table.matches.map((n, i) => (
                        <td key={i}>{n}</td>
                      ))}
                    </tr>
                    {table.rounds && (
                      <tr>
                        <th scope="row">Rounds</th>
                        {table.rounds.map((n, i) => (
                          <td key={i}>{n}</td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
                {format === "single_elim" && (
                  <p className="hint" style={{ marginTop: 8 }}>
                    Join order sets round 1: first joined plays last joined.
                  </p>
                )}
              </fieldset>
            </div>
          </section>

          <section className="mk-sec" aria-labelledby="mk-m">
            <div className="mk-side">
              <h2 id="mk-m">Match</h2>
              <p>Every online duel in this tournament uses these. They lock when the first duel opens.</p>
            </div>
            <DuelRulesFields idPrefix="tournament-rules" value={rules} onChange={setRules} />
          </section>

          <section className="mk-sec" aria-labelledby="mk-t">
            <div className="mk-side">
              <h2 id="mk-t">Timing</h2>
              <p>Both can be changed later from the tournament page.</p>
            </div>
            <div className="fields">
              <div className="wide">
                <DeadlinePicker idPrefix="tournament-deadline" value={deadline} onChange={setDeadline} />
              </div>
              <div className="wide">
                <label className="label" htmlFor="tournament-confirm-hours">
                  Confirm window
                </label>
                <div className={styles.hours}>
                  <input
                    className="input"
                    style={{ maxWidth: 110 }}
                    id="tournament-confirm-hours"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={720}
                    value={confirmHours}
                    placeholder="24"
                    onChange={(e) => setConfirmHours(e.target.value)}
                  />
                  <span>hours</span>
                </div>
                <p className="hint">
                  A reported result counts if the opponent doesn&apos;t answer in time. 1 to 720 hours; 24 if left empty.
                </p>
              </div>
            </div>
          </section>
        </div>

        <aside className="sum" aria-label="Tournament summary">
          <div className="card">
            <p className="card-kind">
              {formatName(format)} · Best of {rules.bestOf}
            </p>
            <p className={`sum-name${name.trim() ? "" : ` ${styles.unnamed}`}`}>{name.trim() || "Untitled tournament"}</p>
            <dl className="rows">
              <div>
                <dt>Duel mode</dt>
                <dd>{rules.mode === "domain" ? "Domain" : "Normal"}</dd>
              </div>
              <div>
                <dt>Banlist</dt>
                <dd>{banlistLabel}</dd>
              </div>
              <div>
                <dt>Turn time</dt>
                <dd>{turnLabel}</dd>
              </div>
              <div>
                <dt>Closes</dt>
                <dd>{deadline ? formatClosesAt(deadline) : "No deadline"}</dd>
              </div>
              <div>
                <dt>Confirm window</dt>
                <dd>{hoursLabel}</dd>
              </div>
            </dl>
            <ol className="next" aria-label="What happens next">
              <li>You get a lobby with an invite link. You&apos;re in it as a player, and can leave.</li>
              <li>Players join and register their decks.</li>
              <li>You press Start. Pairings are made then, and nobody else can join.</li>
            </ol>
            {error && (
              <div className={`banner banner-bad ${styles.sumBanner}`} role="alert">
                <CircleAlert className="ic" aria-hidden="true" />
                <span>
                  <strong>Couldn&apos;t create the tournament.</strong> The server said: {error}
                </span>
              </div>
            )}
            <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={submitting} aria-busy={submitting || undefined}>
              Create tournament
            </button>
          </div>
        </aside>
      </form>
    </>
  );
}
