import type { ReactNode } from "react";
import { Globe, Lock } from "lucide-react";
import { VISIBILITY_HELP, VISIBILITY_LABEL, type Visibility } from "@/lib/invite-link";
import styles from "./visibility.module.css";

/** A small Private or Open tag for the lobby header. It draws nothing when the server sent no visibility. */
export function VisibilityBadge({ visibility }: { visibility?: Visibility }) {
  if (!visibility) return null;
  const Icon = visibility === "private" ? Lock : Globe;
  return (
    <span className={styles.badge} data-visibility={visibility} title={VISIBILITY_HELP[visibility]}>
      <Icon size={12} aria-hidden="true" />
      {VISIBILITY_LABEL[visibility]}
    </span>
  );
}

/** The second line of a lobby's page bar: the draft name (when the title is not the name) and the badge. */
export function LobbyBarSub({ name, visibility }: { name?: ReactNode; visibility?: Visibility }) {
  if (!visibility) return name ?? null;
  return (
    <span className={styles.barSub}>
      {name != null && <span className={styles.barName}>{name}</span>}
      <VisibilityBadge visibility={visibility} />
    </span>
  );
}
