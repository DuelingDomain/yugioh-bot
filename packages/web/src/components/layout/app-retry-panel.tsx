"use client";

import { RotateCw } from "lucide-react";
import { EmptyField } from "@/components/layout/empty-field";
import { SheetRoot, SvButton } from "@/components/sheet";

/**
 * Shown inside the shell when the session could not be loaded (the identity service answered 503).
 * Signing in again would not help, so the one action is to ask again.
 */
export function AppRetryPanel() {
  return (
    <SheetRoot>
      <div role="alert" data-testid="app-retry-panel">
        <EmptyField
          code="Error"
          title="Your account didn’t load"
          actions={
            <SvButton variant="primary" onClick={() => window.location.reload()}>
              <RotateCw size={16} aria-hidden="true" />
              Try again
            </SvButton>
          }
        >
          We couldn&apos;t load your account. Try again in a moment.
        </EmptyField>
      </div>
    </SheetRoot>
  );
}
