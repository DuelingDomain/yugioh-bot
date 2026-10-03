import { TierName } from "@/components/sheet";

/** Shown when you are signed in but have no player yet. */
export function WelcomePanel() {
  return (
    <section className="panel db-hello" aria-labelledby="db-hello-t">
      <div>
        <h2 id="db-hello-t">Your first match puts you on the board</h2>
        <p>Everything here starts in Discord. Join something on the server and this page fills in.</p>
        <ol className="db-steps">
          <li>
            Join a tournament
            <small><code className="cmd">/event join</code>{" "}or open one from Tournaments</small>
          </li>
          <li>
            Join a draft
            <small><code className="cmd">/draft join</code>{" "}or pick one from Drafts</small>
          </li>
          <li>
            Challenge someone
            <small><code className="cmd">/duel</code>{" "}with their name</small>
          </li>
        </ol>
      </div>
      <div className="db-start">
        <TierName tier="Silver" />
        <span className="elo">1000</span>
        <p>Everyone starts at 1000 Elo, which is Silver. Gold starts at 1100.</p>
      </div>
    </section>
  );
}
