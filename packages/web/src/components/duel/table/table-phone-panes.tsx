"use client";

import type { ReactNode } from "react";
import { Sheet } from "@/components/ui/sheet";
import { mobilePanes, SidePanel, SideTabs, type SidePane } from "../side-panel";
import roomStyles from "../room.module.css";

/** Phone tabs share the shell's pane selection, inspector and live draft. Masters exists only for Domain. */
export function TablePhonePanes({ domain, pane, onSelect, open, onClose, unread, card, log, settings, masters }: {
  domain: boolean;
  pane: SidePane;
  onSelect: (pane: SidePane) => void;
  open: boolean;
  onClose: () => void;
  unread: number;
  card: ReactNode;
  log: ReactNode;
  settings: ReactNode;
  masters: ReactNode;
}) {
  return <>
    <div className={roomStyles.mobileBar}>
      <SideTabs mobile panes={mobilePanes(domain)} selected={pane} unread={unread} onSelect={onSelect} />
    </div>
    <Sheet open={open} onClose={onClose} title={pane === "log" ? "Duel log" : pane === "settings" ? "Settings" : pane === "masters" ? "Deck Masters" : "Card"}>
      <SidePanel pane="card" selected={pane} semantic={false}>{card}</SidePanel>
      <SidePanel pane="log" selected={pane} semantic={false} keepMounted>{log}</SidePanel>
      <SidePanel pane="settings" selected={pane} semantic={false}>{settings}</SidePanel>
      {domain ? <SidePanel pane="masters" selected={pane} semantic={false}><div className={roomStyles.mastersSheet}>{masters}</div></SidePanel> : null}
    </Sheet>
  </>;
}
