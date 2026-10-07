export const DEFAULT_RETURN = "/dashboard";

export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return DEFAULT_RETURN;
  try {
    // Check decoded characters too: browsers normalize slashes and dot segments.
    const decoded = decodeURIComponent(value);
    if (/^\/\/|\\|[\u0000-\u001f\u007f]/.test(decoded)) return DEFAULT_RETURN;
    const url = new URL(decoded, "https://return.invalid");
    if (url.origin !== "https://return.invalid" || url.pathname.startsWith("//") || /^\/(sign-in|sign-up|sso-callback)/.test(url.pathname)) return DEFAULT_RETURN;
    return value;
  } catch {
    return DEFAULT_RETURN;
  }
}
