export const DEFAULT_REPORT_CONFIRM_HOURS = 24;

// Accepted bounds for a per-tournament confirm window (hours). 720h = 30 days.
export const MIN_REPORT_CONFIRM_HOURS = 1;
export const MAX_REPORT_CONFIRM_HOURS = 720;

// A cube is a quantity list: one card can be in it many times. The upper bound only guards
// against abuse. The three-copy deck rule is per player, not per cube (see drafts.ts).
export const MIN_CUBE_COPIES = 1;
export const MAX_CUBE_COPIES = 99;
export const DEFAULT_CUBE_COPIES = 3;
