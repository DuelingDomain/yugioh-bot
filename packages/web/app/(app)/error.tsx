"use client";

import { RotateCw } from "lucide-react";
import { EmptyField } from "@/components/layout/empty-field";
import { SheetRoot, SvButton } from "@/components/sheet";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SheetRoot>
      <EmptyField
        code="Error"
        title="This page hit a problem"
        reference={error.digest}
        actions={
          <>
            <SvButton variant="primary" onClick={() => reset()}>
              <RotateCw size={16} aria-hidden="true" />
              Try again
            </SvButton>
            <SvButton as="a" href="/dashboard" variant="ghost">
              Back to dashboard
            </SvButton>
          </>
        }
      >
        Nothing you did caused it, and nothing was saved or lost. Try again, and if it keeps happening, send the
        reference below to whoever runs the bot.
      </EmptyField>
    </SheetRoot>
  );
}
