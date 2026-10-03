"use client";

import { createContext, useContext } from "react";
import type { LiveNow } from "./shell-model";

export interface ShellContextValue {
  /** Opens the phone menu. Pass the element that was pressed so focus can return to it. */
  openMenu: (trigger: HTMLElement | null) => void;
  menuOpen: boolean;
  live: LiveNow | null;
}

const NOOP: ShellContextValue = { openMenu: () => {}, menuOpen: false, live: null };

export const ShellContext = createContext<ShellContextValue>(NOOP);

export function useShell(): ShellContextValue {
  return useContext(ShellContext);
}
