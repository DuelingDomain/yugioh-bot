/** Untrusted display context must never add an email disclosure or Markdown layout. */
export function discordContextText(value: string): string {
  return value.replace(/[^\s<>]+@[^\s<>]+/g, "[email hidden]")
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ")
    .replace(/[\\`*_{}\[\]<>|~]/g, "\\$&")
    .replace(/:\/\//g, "\\:\\/\\/");
}
