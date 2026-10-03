/** Joins class names, dropping falsy values. No Tailwind merging, so `sv-*` names are never rewritten. */
export function sv(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}
