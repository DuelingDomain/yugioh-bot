"use client";

import Link from "next/link";
import { CircleAlert, RotateCw } from "lucide-react";
import { SheetRoot } from "@/components/sheet";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SheetRoot>
      <div className="nf">
        <p className="nf-code">
          <CircleAlert className="ic" style={{ color: "var(--loss-ink)" }} aria-hidden="true" />
          Error
        </p>
        <h1 className="t-title">This page hit a problem</h1>
        <p>
          Nothing you did caused it, and nothing was saved or lost. Try again, and if it keeps happening, send the
          reference below to whoever runs the bot.
        </p>
        <div className="acts">
          <button className="btn btn-primary" type="button" onClick={() => reset()}>
            <RotateCw className="ic" aria-hidden="true" />
            Try again
          </button>
          <Link className="btn btn-quiet" href="/dashboard">
            Back to dashboard
          </Link>
        </div>
        {error.digest ? <p className="ref">Reference {error.digest}</p> : null}
      </div>
    </SheetRoot>
  );
}
