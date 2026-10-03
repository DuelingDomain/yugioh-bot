"use client";

import { useEffect, useState } from "react";

export function DashboardDate() {
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    setToday(new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }));
  }, []);

  return <p className="page-sub">{today}</p>;
}
