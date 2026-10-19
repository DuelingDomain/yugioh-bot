"use client";

import { useEffect, useState } from "react";
import { ago } from "@/lib/admin-console/format";

/** "Updated 12s ago". Re-renders itself every 5 seconds; the panel does not re-render. */
export function UpdatedLine({ fetchedAt, stale = false }: { fetchedAt: number | null; stale?: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [fetchedAt]);
  if (fetchedAt === null) return <span>Loading</span>;
  return <span>{stale ? "Out of date, last update " : "Updated "}{ago(fetchedAt, now ?? fetchedAt)}</span>;
}
