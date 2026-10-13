#!/usr/bin/env python3
"""Check production gameplay before a staging or production deploy. Read counts only."""
import argparse
from contextlib import closing
from pathlib import Path
import sqlite3
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("--force", choices=("true", "false"), default="false")
    parser.add_argument("--target", choices=("production", "staging"), default="production")
    parser.add_argument("--live-only", action="store_true",
                        help="Block production only on live duels/openings and active drafts; report rounds and series")
    parser.add_argument("--wait-seconds", type=int, default=0,
                        help="Wait up to this many seconds for idle gameplay (default: refuse immediately)")
    args = parser.parse_args()
    if args.wait_seconds < 0:
        parser.error("--wait-seconds must be nonnegative")
    if args.force == "true":
        print("Force set: skipping the gameplay activity guard. Engine preflight still applies.")
        return 0

    label = "Staging deploy skipped" if args.target == "staging" else "Production deploy refused"
    names = ["duels", "drafts"]
    query = """
        select
            (select count(*) from duels where status = 'active'
                or (status = 'lobby' and opening_json is not null)),
            (select count(*) from drafts where status = 'active')
    """
    if args.target == "production":
        names.extend(("tournament_rounds", "series"))
        query += """,
            (select count(*) from (
                select tm.tournament_id, tm.round_number
                from tournament_matches tm
                join tournaments t on t.id = tm.tournament_id
                where t.status = 'active' and tm.status in ('open', 'pending_approval')
                group by tm.tournament_id, tm.round_number
            )),
            (select count(*) from duel_series where status in ('active', 'between_games'))
        """

    deadline = time.monotonic() + args.wait_seconds
    while True:
        try:
            # Reopen on each check to see a fresh committed WAL snapshot without migrations.
            with closing(sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True, timeout=1)) as db:
                db.execute("pragma query_only=on")
                counts = db.execute(query).fetchone()
        except (OSError, sqlite3.Error) as error:
            print(f"{label}: cannot read gameplay activity ({error}).", file=sys.stderr)
            return 1

        blocking_count = 2 if args.live_only else len(names)
        activity = [f"{name}={count}" for name, count in zip(names, counts)]
        summary = " ".join(activity[:blocking_count])
        if len(activity) > blocking_count:
            summary += " (not blocking: " + " ".join(activity[blocking_count:]) + ")"
        print("Production activity: " + summary, flush=True)
        if not any(counts[:blocking_count]):
            return 0
        remaining = deadline - time.monotonic()
        if remaining > 0:
            pause = min(120, remaining)
            print(f"Production busy; rechecking in {pause:.0f} seconds ({remaining:.0f} seconds left).", flush=True)
            time.sleep(pause)
            continue
        if args.wait_seconds:
            print(f"{label}: gameplay is still active after waiting {args.wait_seconds} seconds. "
                  "Retry with a manual Deploy or the next merge; live games were left running.", file=sys.stderr)
            return 1
        if args.target == "staging":
            print(f"{label}: production is busy.", file=sys.stderr)
        else:
            print(f"{label}: gameplay is active. Wait for downtime, or explicitly set force.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
