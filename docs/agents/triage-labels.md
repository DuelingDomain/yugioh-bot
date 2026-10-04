# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Reports from the in-app "Report bug" button

Players send bug reports from the "Report bug" button in the web app. Each report becomes a GitHub issue with the labels
`bug`, `needs-triage` and `from-app`. The app never marks a report as valid. A human decides.

Before a report is sent, the app checks it. The text needs at least 20 characters and 4 words, and "What did you expect?" is
required. A known problem (list in `packages/web/src/lib/bug-reports/known-limits.ts`) is shown to the player first. Open
`from-app` issues that look the same are also shown. If the player says "Yes, same bug", the app saves the report and adds
a "+1 from Report #N" comment to that issue. It does not open a new issue.

How to triage a `needs-triage` + `from-app` issue:

1. Open the replay link in the issue (sign-in is needed) and read the recent log. Find the report in the database with the
   `Report #N` number in the issue if you need the full text.
2. Valid bug: remove `needs-triage` and add `ready-for-agent` when the issue is fully specified (or `ready-for-human`).
   An agent fixes only issues with `ready-for-agent`.
3. Not a bug, or not reproducible: add `invalid`, write one short reason as a comment, and close the issue.
4. Same as another issue: add `duplicate`, write a comment with a link to the other issue, and close it.
5. Need more detail from the player: add `needs-info` and ask in a comment. The issue has no player name, so ask in Discord.
6. A new known problem that gets many reports: add an entry to `known-limits.ts` so players see it before they send.

Comments with "+1 from Report #N" add more reports to the same issue. They are a sign that the bug is common. Do not close
the issue because of them.

The labels `from-app`, `invalid` and `duplicate` must exist in the repository. Create them once in GitHub (Issues, Labels)
if they are missing. Without the `from-app` label the app cannot find open issues for the duplicate check, and it falls back
to the reports saved in its own database.

