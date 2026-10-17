import { useCallback, useMemo, useState } from "react";

export interface DrawerBinding {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Keeps at most one edge drawer open in a room. Spread `bind(id)` onto an `EdgeDrawer`: opening one
 * closes the one that was open. `closeAll` is for a prompt that needs the whole field (a target pick).
 */
export function useExclusiveDrawers<K extends string>() {
  const [openId, setOpenId] = useState<K | null>(null);
  const bind = useCallback(
    (id: K): DrawerBinding => ({
      open: openId === id,
      onOpenChange: (open) => setOpenId((current) => (open ? id : current === id ? null : current)),
    }),
    [openId],
  );
  const closeAll = useCallback(() => setOpenId(null), []);
  return useMemo(() => ({ openId, bind, closeAll }), [openId, bind, closeAll]);
}
