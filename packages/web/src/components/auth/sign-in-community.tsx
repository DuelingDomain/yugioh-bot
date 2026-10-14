import { DiscordGlyph } from "./discord-glyph";
import { DISCORD_INVITE_URL, TRAILER_WATCH_URL } from "./community-links";
import styles from "./sign-in-shell.module.css";

/**
 * Community links under the form. This is deliberately plain text beside the card, not a button: it must not read as a
 * second sign-in route next to "Continue with Discord". The trailer link shows only where the side panel with the
 * trailer facade is hidden (phones and narrow windows).
 */
export function SignInCommunity() {
  return (
    <div className={styles.community} data-slot="community">
      <p>
        <span>Chat with other duelists?</span>{" "}
        <a className={styles["community-link"]} href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">
          <DiscordGlyph />
          <span>Join our Discord</span>
          <span className={styles.sr}> (opens in a new tab)</span>
        </a>
      </p>
      <p className={styles["trailer-fallback"]}>
        <a className={styles["community-link"]} href={TRAILER_WATCH_URL} target="_blank" rel="noopener noreferrer">
          <span>Watch the trailer</span>
          <span className={styles.sr}> (opens in a new tab)</span>
        </a>
      </p>
    </div>
  );
}
