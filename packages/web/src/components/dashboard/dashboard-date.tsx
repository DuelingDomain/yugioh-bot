"use client";

import { useEffect, useState } from "react";

/** Today's date for the page bar. It fills in after mount so the server and client markup agree. */
export function DashboardDate() {
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    setToday(new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }));
  }, []);

  return <span data-testid="dashboard-date">{today}</span>;
}
