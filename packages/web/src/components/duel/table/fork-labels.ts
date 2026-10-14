"use client";

import { createContext, useContext } from "react";

/**
 * True inside a replay fork. A fork has no "you": the camera sits on one seat and another seat acts, so a "You" label
 * would land on two different seats. Every seat is named instead, and the seat that answers is tagged "Acting".
 * The room provides it around the live shells; previews and ordinary tables read false.
 */
export const ForkLabelsContext = createContext(false);

export function useForkLabels(): boolean {
  return useContext(ForkLabelsContext);
}
