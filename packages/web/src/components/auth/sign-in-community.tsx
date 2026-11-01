import { DiscordGlyph } from "./discord-glyph";
import { DISCORD_INVITE_URL } from "./community-links";
import { TrailerWatchLink } from "./trailer-watch-link";
import styles from "./sign-in-shell.module.css";

/**
 * Community links under the form. This is deliberately plain text beside the card, not a button: it must not read as a
 * second sign-in route next to "Continue with Discord". The trailer link shows only where the side panel with the
 * trailer thumbnail is hidden (phones and narrow windows). Both open the same overlay.
 */
export function SignInCommunity() {
  return (
    <div className={styles.community} data-slot="community">
      <p>
        <span>Chat with other duelists?</span>{" "}
        <a className={styles["community-link"]} href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">
          <DiscordGlyph />
          <span>Join the Dueling Domain Discord server</span>
          <span className={styles.sr}> (opens in a new tab)</span>
        </a>
      </p>
      <p className={styles["trailer-fallback"]}>
        <TrailerWatchLink />
      </p>
    </div>
  );
}
