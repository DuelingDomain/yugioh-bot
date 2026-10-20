/** The configured public origin of this site (WEB_URL). Throws when it is missing or unsafe. */
export function webOrigin(): string {
  const value = process.env.WEB_URL;
  if (!value) throw new Error("WEB_URL is not set");
  const url = new URL(value);
  if (url.username || url.password || !["https:", "http:"].includes(url.protocol)) throw new Error("WEB_URL is not usable");
  return url.origin;
}
