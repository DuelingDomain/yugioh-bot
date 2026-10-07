import type { Metadata } from "next";
import { Suspense } from "react";
import { SheetRoot } from "@/components/sheet";
import { SignOutRow } from "@/components/account/sign-out-row";
import { LegalLinks } from "@/components/layout/legal-links";
import { DuelViewToggle } from "@/components/settings/duel-view-toggle";
import { isE2EAuthEnabled } from "@/lib/e2e-auth";
import { resolveSessionIdentity } from "@/lib/session-identity";
import styles from "@/components/account/account-page.module.css";
import { AccountPanel } from "./account-panel";

export const metadata: Metadata = { title: "Account | Dueling Domain" };

// E2E mode and the signed-in identity are read per request.
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const e2e = isE2EAuthEnabled();
  const result = await resolveSessionIdentity();
  const identity = result.ok ? result.identity : null;
  return (
    <SheetRoot>
      <header className="page-h sheet-head">
        <div>
          <h1 className="t-title">Account</h1>
          <p className="page-sub">How you sign in, the accounts connected to it, and options for this device</p>
        </div>
      </header>
      <div className="set-page">
        <section className="set-sec" aria-labelledby="set-account">
          <div className="set-intro">
            <h2 id="set-account">Sign-in and connected accounts</h2>
            <p>Your email, password and Discord connection. Connecting Discord brings back your past drafts and matches.</p>
          </div>
          <Suspense fallback={null}>
            <AccountPanel e2e={e2e} displayName={identity?.name ?? ""} email={identity?.email ?? null} />
          </Suspense>
        </section>
        <DuelViewToggle />
        <section className="set-sec" aria-labelledby="set-session">
          <div className="set-intro">
            <h2 id="set-session">This session</h2>
            <p>Sign out of Dueling Domain on this device.</p>
          </div>
          <SignOutRow />
        </section>
        <section className="set-sec" aria-labelledby="set-legal">
          <div className="set-intro">
            <h2 id="set-legal">Terms and privacy</h2>
            <p>These pages are on duelingdomain.com and open in a new tab.</p>
          </div>
          <div className={styles.legalRow}>
            <LegalLinks />
          </div>
        </section>
        {/* DeleteAccountSection mounts here */}
      </div>
    </SheetRoot>
  );
}
