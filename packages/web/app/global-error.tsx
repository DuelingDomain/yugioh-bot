"use client";

import { useEffect } from "react";
import { report } from "@yugidraft/shared/observability";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { report(error); }, [error]);
  return <html lang="en"><body><main>
    <h1>Something went wrong</h1>
    <button onClick={reset}>Try again</button>
  </main></body></html>;
}
