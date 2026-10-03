import { StageLine } from "@/components/sheet";
import { PageFrame } from "@/components/dashboard/page-frame";
import { CreateTournamentForm } from "@/components/tournament/create-tournament-form";
import styles from "../tournaments.module.css";

export default function NewTournamentPage() {
  return (
    <PageFrame
      back={{ href: "/tournaments", label: "All tournaments" }}
      title="New tournament"
      sub="You get a lobby and an invite link. Nothing starts until you press Start."
    >
      <div className={styles.steps}>
        <StageLine
          label="Where creating leads"
          steps={[
            { label: "Create", state: "now" },
            { label: "Lobby", state: "next" },
            { label: "Play", state: "next" },
            { label: "Final", state: "next" },
          ]}
        />
        <p className={styles.stepsNote}>After you create it, you get a lobby with an invite link.</p>
      </div>
      <CreateTournamentForm />
    </PageFrame>
  );
}
