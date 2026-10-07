"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { FloorList, FloorRow, SvButton } from "@/components/sheet";
import { useSignOut } from "./sign-out";
import styles from "./account-page.module.css";

/** The account page's one Sign out control. It runs the same sign-out as the account menu. */
export function SignOutRow() {
  const signOut = useSignOut();
  const [busy, setBusy] = useState(false);
  return (
    <FloorList>
      <FloorRow className={styles.row}>
        <div className="sv-cell-grow">
          <p className={styles.rowTitle}>Sign out</p>
          <p className={styles.rowNote}>Ends your session in this browser. Other devices stay signed in.</p>
        </div>
        <span className="sv-cell-end">
          <SvButton
            variant="quiet"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => {
              setBusy(true);
              signOut().catch(() => setBusy(false));
            }}
          >
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </SvButton>
        </span>
      </FloorRow>
    </FloorList>
  );
}
