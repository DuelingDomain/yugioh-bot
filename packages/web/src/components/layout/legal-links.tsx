import { PRIVACY_URL, TERMS_URL } from "@/components/auth/legal-links";
import styles from "./shell.module.css";

/**
 * Terms and Privacy. Both pages live on the marketing site; the app hosts neither. Used in the
 * account menu, the account page and the shell footer, so the wording and the links stay in one place.
 * Inside a `role="menu"` pass `menu`, so each link is a menu item the arrow keys reach.
 */
export function LegalLinks({ className, menu = false, onNavigate }: { className?: string; menu?: boolean; onNavigate?: () => void }) {
  const role = menu ? "menuitem" : undefined;
  return (
    <span className={[styles.legal, className].filter(Boolean).join(" ")} role={menu ? "none" : undefined}>
      <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" role={role} onClick={onNavigate}>Terms</a>
      <span aria-hidden="true">·</span>
      <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" role={role} onClick={onNavigate}>Privacy</a>
    </span>
  );
}
