/**
 * `<UserProfile/>` in the site's dark sheet: the `.ms` tokens as plain colours (Clerk needs real values, not
 * `var()`), violet for the primary action and the gold hairline for borders. No Clerk CSS is copied; `elements`
 * only flattens the card so it sits on the page floor like the other sections.
 */
export const clerkAppearance = {
  variables: {
    colorPrimary: "#9b7eff",
    colorPrimaryForeground: "#0a0716",
    colorBackground: "#0a1120",
    colorForeground: "#efe7d5",
    colorMutedForeground: "#958f81",
    colorMuted: "#0e1729",
    colorNeutral: "#efe7d5",
    colorInput: "#0e1729",
    colorInputForeground: "#efe7d5",
    colorBorder: "#b5996357",
    colorRing: "#ddd2ff",
    colorDanger: "#e45a4d",
    colorSuccess: "#86cfa1",
    colorWarning: "#e4b64f",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: { width: "100%" },
    cardBox: { width: "100%", maxWidth: "100%", boxShadow: "none", border: "1px solid #b5996357", borderRadius: "0.5rem" },
    card: { boxShadow: "none" },
  },
} as const;
