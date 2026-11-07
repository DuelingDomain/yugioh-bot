import { Video } from "lucide-react";
import styles from "@/components/draft/visibility/visibility.module.css";
import type { TournamentDetail } from "./types";

/** A small "Remote" tag for a Remote tournament's page bar. It draws nothing for an online one. */
export function RemoteBadge({ duelType }: { duelType?: TournamentDetail["duelType"] }) {
  if (duelType !== "remote") return null;
  return (
    <span className={styles.badge} data-testid="remote-badge" title="Played with real cards on camera">
      <Video size={12} aria-hidden="true" />
      Remote
    </span>
  );
}
