import type { Release } from "../services/releases.js";
import type { EmailRecipient } from "./audience.js";
import type { EmailConfig } from "./storage.js";

export interface EmailMessage { from: string; to: string[]; reply_to: string; subject: string; html: string; text: string; headers: Record<string, string> }
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const htmlText = (text: string): string => escapeHtml(text).replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>");
const plainText = (text: string): string => text.replace(/\*\*/g, "");
const headings = { new: "New", improvements: "Improvements", cards: "Card data", fixes: "Fixes", howto: "How to use" };
export function renderReleaseEmail(release: Release, recipient: EmailRecipient, config: EmailConfig, unsubscribeUrl: string): EmailMessage {
  const home = new URL(config.webUrl);
  if (!["https:", "http:"].includes(home.protocol) || home.username || home.password) throw new Error("Invalid mail WEB_URL");
  const signIn = new URL(recipient.variant === "members" ? "/sign-in" : "/sign-up", home).href;
  const intro = recipient.variant === "members" ? "Here is what is new in Dueling Domain."
    : recipient.inviteUrl ? "You are still invited to Dueling Domain — here is your existing invite."
    : recipient.variant === "waitlist" ? "Here is the latest Dueling Domain alpha news. If you are awaiting approval, you remain on the waitlist."
    : "Here is the latest Dueling Domain alpha news. Join us or sign in to check your access.";
  const cta = recipient.inviteUrl ? "Accept your invitation" : recipient.variant === "members" ? "Open Dueling Domain" : "Join or sign in";
  const href = recipient.inviteUrl ?? signIn;
  // No pixels, scripts, remote assets or rewritten links. Disable tracking on the Resend sending domain too.
  const link = (url: string, text: string) => `<a href="${escapeHtml(url)}" data-resend-no-track="true">${escapeHtml(text)}</a>`;
  const text = [plainText(release.title), intro, ...release.sections.flatMap(section => [headings[section.kind], ...section.items.map(item => `• ${plainText(item)}`)]),
    `${cta}: ${href}`, `Updates: ${home.href}`, "Dueling Domain alpha release news", config.postalAddress, `Unsubscribe: ${unsubscribeUrl}`].join("\n\n");
  const html = `<!doctype html><html><body><h1>${htmlText(release.title)}</h1><p>${escapeHtml(intro)}</p>${release.sections.map(section =>
    `<h2>${headings[section.kind]}</h2><ul>${section.items.map(item => `<li>${htmlText(item)}</li>`).join("")}</ul>`).join("")}<p>${link(href, cta)}</p><p>${link(home.href, "Updates")}</p><footer><p>Dueling Domain alpha release news</p><p>${escapeHtml(config.postalAddress)}</p><p>${link(unsubscribeUrl, "Unsubscribe")}</p></footer></body></html>`;
  return { from: config.from, to: [recipient.email], reply_to: config.replyTo, subject: plainText(release.title).replace(/[\r\n]/g, " "), html, text,
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
}
