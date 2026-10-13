"use client";

import { useEffect, useState } from "react";
import { savedHistoryHref } from "./history-filters";

/** The "Match history" link target of the replay page. It keeps the filters that were used in the list. */
export function useMatchHistoryHref(viewerId?: number | string): string {
  const [href, setHref] = useState("/duels?view=history");
  // Read after mount: session storage does not exist during server rendering.
  useEffect(() => { setHref(savedHistoryHref(viewerId)); }, [viewerId]);
  return href;
}
