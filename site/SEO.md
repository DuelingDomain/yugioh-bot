# Dueling Domain search foundation

Target people planning a card night with friends. These are relevance targets, not measured volume or ranking promises.

| Query | Copy that supports it |
| --- | --- |
| online card game draft with friends | Title, hero intro and “Draft night”: live card drafts with friends. |
| cube draft online | “Draft night”: live cube/theme drafts, passing packs and a pick clock. |
| browser card duel simulator | Title and “No install”: browser duels with a rules engine. |
| draft night online | “Draft night”, the group-focused intro and the three alpha steps. |
| deck master format | “Domain format”: a Deck Master in its own zone in 1v1 games. |

Keep the current hero and useful descriptions; avoid repeating every query verbatim. Privacy supports trust, not acquisition. Exclude third-party franchise/product names, character/card names, official art and affiliation claims from copy, metadata, URLs and schema. Keep the owner-approved footer disclaimer. No fabricated reviews, ratings, traffic or competitive exclusivity claims.

The home page includes `WebSite`, `Organization` and `WebApplication`. The app has `GameApplication`, `Web browser`, a zero-price CAD offer limited to the closed alpha, and `creativeWorkStatus: Closed alpha`. [LimitedAvailability](https://schema.org/LimitedAvailability) describes invitations in waves; [PreOrder](https://schema.org/PreOrder) implies an order, which the waitlist does not take. No release date or guaranteed access is implied.

Launch checklist:

- Owner: finish domain cutover and privacy confirmations; run `python3 site/src/self-host-fonts.py` on a machine with HTTPS access. Then run static, routing and browser checks in `README.md`.
- Owner: create Google Search Console Domain and Bing Webmaster properties. Add each tool's exact verification DNS TXT record in Namecheap; retain it after verification. Do not add tracking scripts.
- Submit `https://duelingdomain.com/sitemap.xml` to both tools. Inspect `/` and `/privacy`, verify canonical selection and successful indexing. The private app stays excluded from search.
- Check the 1200×630 OG preview in social link debuggers and validate JSON-LD. A valid graph alone does not guarantee rich results.
- Measure mobile performance after deployment: [Core Web Vitals](https://web.dev/articles/vitals) at the 75th percentile: LCP ≤2.5s, INP ≤200ms, CLS ≤0.1. Use lab checks initially; field data takes time. Check cold-cache fonts, poster lazy loading and layout shifts.
- Earn relevant links: pin the site in our Discord server; share useful draft-night walkthroughs on relevant Reddit and cube communities with moderator permission and clear project disclosure. Avoid mass posting or bought links.
- Keep sitemap `lastmod` dates tied to actual content changes. Review invite availability and alpha pricing when the product moves beyond the closed alpha.
