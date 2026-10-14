/** Community and launch-trailer links shared with the marketing site (site/public/index.html). */
export const DISCORD_INVITE_URL = "https://discord.gg/sUSmbRbBUm";

export const TRAILER_YOUTUBE_ID = "9CahDbFr0jA";
export const TRAILER_WATCH_URL = `https://www.youtube.com/watch?v=${TRAILER_YOUTUBE_ID}`;
/** Privacy-enhanced mode. Only the facade click may load this, so the app CSP frame-src names this host. */
export const TRAILER_EMBED_URL = `https://www.youtube-nocookie.com/embed/${TRAILER_YOUTUBE_ID}?autoplay=1&rel=0&playsinline=1`;
export const TRAILER_POSTER_SRC = "/sign-in/arena-poster.webp";
