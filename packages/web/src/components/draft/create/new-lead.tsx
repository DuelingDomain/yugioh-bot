import type { ReactNode } from "react";
import { StageLine } from "@/components/sheet";
import { Pieces } from "../draft-frame";
import styles from "./create.module.css";

/** The shared stage line for the new draft screens: Create is where you are, then lobby, draft and deck building. */
export function NewDraftLead({ pieces, note }: { pieces: [string, string]; note?: ReactNode }) {
  return (
    <div className={styles.lead}>
      <StageLine
        label="Where creating leads"
        steps={[
          { label: "Create", state: "now" },
          { label: "Lobby", state: "next" },
          { label: "Draft", state: "next" },
          { label: "Build deck", state: "next" },
        ]}
      />
      <Pieces items={[{ key: "a", content: pieces[0], strong: true }, { key: "b", content: pieces[1] }]} />
      {note != null && <p className={styles.leadNote}>{note}</p>}
    </div>
  );
}
