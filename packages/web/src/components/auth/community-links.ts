/** Community and launch-trailer links shared with the marketing site (site/public/index.html). */
export const DISCORD_INVITE_URL = "https://discord.gg/sUSmbRbBUm";

export const TRAILER_YOUTUBE_ID = "9CahDbFr0jA";
export const TRAILER_WATCH_URL = `https://www.youtube.com/watch?v=${TRAILER_YOUTUBE_ID}`;
/** Privacy-enhanced mode. Only the facade click may load this, so the app CSP frame-src names this host. */
export const TRAILER_EMBED_URL = `https://www.youtube-nocookie.com/embed/${TRAILER_YOUTUBE_ID}?autoplay=1&rel=0&playsinline=1`;
export const TRAILER_POSTER_SRC = "/sign-in/arena-poster.webp";
export const TRAILER_TITLE = "Dueling Domain launch trailer (YouTube)";
/**
 * No allow-top-navigation: the frame must not be able to navigate the sign-in page. allow-popups-to-escape-sandbox lets the
 * YouTube logo and "Watch on YouTube" links open a working tab; without it the popup inherits the sandbox and fails to load.
 */
export const TRAILER_SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox";
