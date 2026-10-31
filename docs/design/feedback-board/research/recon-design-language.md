## 1. Color tokens and typography

**Global palette.** Exact `@theme` declarations:

| Tokens | Values |
|---|---|
| `--color-bg-deep`, `--color-bg-surface`, `--color-bg-elevated` | `#0A0E1A`, `#141929`, `#1E2440` |
| `--color-text-primary`, `--color-text-secondary` | `#E8ECF4`, `#8892B0` |
| `--color-accent-primary`, `--color-accent-secondary` | `#7C3AED`, `#A78BFA` |
| `--color-accent-cta`, `--color-accent-gold`, `--color-accent-success` | `#F43F5E`, `#F59E0B`, `#10B981` |
| `--color-border` | `#2A3150` |
| `--shadow-card` | `0 10px 30px -5px rgb(0 0 0 / 0.5)` |

[globals.css:3–23](../../../../packages/web/app/globals.css:3)

**Actual list-page palette:** `SheetRoot` imports scoped `.ms` styles. Use these for the shell and named list pages:

```css
--ground: #070b15;
--panel: #0a1120;
--panel-2: #0e1729;
--panel-3: #132037;
--ink: #efe7d5;
--ink-2: #c3bba8;
--ink-3: #958f81;
--ink-4: #5f5c57;
--pen: #9b7eff;
--pen-ink: #c6b6ff;
--pen-fill: #5733d1;
--pen-soft: rgb(155 126 255 / 0.13);
--chain: #e4b64f;
--chain-ink: #f4d690;
--chain-soft: rgb(228 182 79 / 0.11);
--loss: #e45a4d;
--loss-ink: #ff9489;
--ok: #86cfa1;
--rule-rgb: 181 153 99;
--rule-a: 0.34;
--gold: rgb(var(--rule-rgb));
--gold-ink: #dcc58f;
--floor: #050811;
--beam: 198 182 255;
```

Borders: `--rule:rgb(var(--rule-rgb) / var(--rule-a))`; `--rule-hi` substitutes `calc(var(--rule-a) * 1.9)`; `--rule-lo` substitutes `calc(var(--rule-a) * 0.5)`. [match-sheet.css:76–147](../../../../packages/web/src/styles/match-sheet.css:76)

**Fonts:** root loads Russo One `"400"` and Chakra Petch `["400","600","700"]`; global display/body map respectively to them. The app layout adds `AppShell`, without another font loader. [root layout:15–27](../../../../packages/web/app/layout.tsx:15), [app layout:15–22](../../../../packages/web/app/(app)/layout.tsx:15)

Inside `SheetRoot`, display is **Oxanium**, UI/body **Sofia Sans Semi Condensed**, numerals **Sofia Sans Extra Condensed**, annotations **Newsreader italic**. All use `latin`, `display:"swap"`; these loaders omit explicit weights. Body is `14px/1.45`. [SheetRoot:18](../../../../packages/web/src/components/sheet/sheet-root.tsx:18), [fonts.ts:11–36](../../../../packages/web/src/components/duel/fonts.ts:11), [match-sheet.css:114–123](../../../../packages/web/src/styles/match-sheet.css:114)

Typography specimens:

- Page title: `600 19px/1.2 var(--f-display)`; section heading: `600 21px/1.2 var(--f-display)`. At container `max-width:760px`, sizes become `17px` and `19px`. [match-sheet.css:2394–2418](../../../../packages/web/src/styles/match-sheet.css:2394)
- Tournament name: `600 18px/1.25 var(--f-display)`, becoming `17px` at container `max-width:620px`. [tournament-row.module.css:9–60](../../../../packages/web/src/components/tournament/tournament-row.module.css:9)
- Draft names: `17px`, `600`; cube names: `600 17px/1.3 var(--f-ui)`. [match-sheet.css:2466](../../../../packages/web/src/styles/match-sheet.css:2466), [cubes.module.css:19](../../../../packages/web/src/components/cubes/cubes.module.css:19)

No light-mode overrides found. Global `:root` blocks contain layer/motion variables; HTML declares `color-scheme:dark`, and root layout sets `dark`. [.impeccable.md:12](../../../../.impeccable.md:12) promises light support, but current implementation remains dark. [globals.css:36–113](../../../../packages/web/app/globals.css:36), [layout.tsx:44](../../../../packages/web/app/layout.tsx:44)

## 2. App shell

**Desktop:** fixed left sidebar, `width:236px`, collapsed `68px`, `z-index:30`, background `var(--panel)`; main margin matches those widths. Brand row: `height:67px`, `padding:0 6px 0 20px`, followed by a light rule. Mark: `28px`; wordmark: `600 16px/1 var(--f-display)`, with "Domain" gold. Reuse `BrandMark`'s supplied SVG paths. [shell.module.css:27–118](../../../../packages/web/src/components/layout/shell.module.css:27), [main:756](../../../../packages/web/src/components/layout/shell.module.css:756), [brand-mark.tsx:4–6](../../../../packages/web/src/components/layout/brand-mark.tsx:4)

Navigation order and Lucide icons:

| Group | Items |
|---|---|
| Unlabelled | Dashboard — `LayoutDashboard` |
| `Compete` | Tournaments — `Trophy`; Drafts — `Layers`; Duels — `Swords`; Leaderboard — `Medal` |
| `Build` | Decks — `Library`; Cubes — `Boxes` |
| `Admin` | Admin console — `Gauge`; Card data — `DatabaseZap`; Bug reports — `Bug` |
| Foot | Account — `UserCog` |

Admin group is conditional on `isAdmin`. [shell-model.ts:6–24](../../../../packages/web/src/components/layout/shell-model.ts:6), [nav-items.ts:10–21](../../../../packages/web/src/lib/nav-items.ts:10)

Nav padding: `12px 12px 8px`; group gap `2px`; group headings `39px`, labels `500 12.5px/1.2 var(--f-ui)`. Rows: `height:40px`, `padding:0 12px`, `gap:12px`, radius `8px`, font `500 14.5px/1.2 var(--f-ui)`; icons `20px`. Hover fill: `rgb(255 255 255 / 0.04)`. Active fill: `var(--pen-soft)`; left bar `2px`, top/bottom `9px`, shadow `0 0 8px rgb(155 126 255 / 0.55)`. [shell.module.css:189–324](../../../../packages/web/src/components/layout/shell.module.css:189)

**Live row:** directly below Dashboard, between light rules. Own duel wins: "Your duel", opponent/presence text, "Open duel"; otherwise "Live now" and duel count. Nothing appears without live data. Row: `min-height:52px`, `padding:6px 12px`, radius `8px`; sidebar left padding `18px`, gap `18px`. [nav-list.tsx:24–36](../../../../packages/web/src/components/layout/nav-list.tsx:24), [shell-model.ts:129–154](../../../../packages/web/src/components/layout/shell-model.ts:129), [shell.module.css:419–440](../../../../packages/web/src/components/layout/shell.module.css:419)

**Foot:** Account link, account-menu seat, Terms/Privacy. Seat: `min-height:56px`, padding `8px 4px`, radius `10px`; violet monogram ring `36px`, name above tier/Elo. [sidebar.tsx:86–92](../../../../packages/web/src/components/layout/sidebar.tsx:86), [shell.module.css:487–563](../../../../packages/web/src/components/layout/shell.module.css:487), [monogram:2428–2431](../../../../packages/web/src/styles/match-sheet.css:2428)

**Phone, `max-width:820px`:** sidebar disappears; sticky top bar has `height:56px`, padding `0 8px 0 6px`, Menu control, page title and account ring. Drawer: `width:min(320px,86vw)`, `z-index:60`; scrim `rgb(2 4 10 / 0.7)`; nav rows `48px`, text `16px`. Pages owning a page bar hide the shell top bar and append Menu to their actions. [shell.module.css:260–262](../../../../packages/web/src/components/layout/shell.module.css:260), [phone/drawer:833–913](../../../../packages/web/src/components/layout/shell.module.css:833), [PageFrame:19–23](../../../../packages/web/src/components/dashboard/page-frame.tsx:19)

## 3. List-page patterns

- **Frame/header:** floor background; body padding `28px 32px 56px`, becoming `20px 16px 48px` at container `max-width:620px`. Page bar: minimum `68px`, padding `12px 28px`, panel background, `1px solid var(--rule-lo)` bottom border; at container `max-width:760px`: minimum `56px`, padding `8px 16px`. [page-frame.module.css:3–16](../../../../packages/web/src/components/dashboard/page-frame.module.css:3), [match-sheet.css:2394–2407](../../../../packages/web/src/styles/match-sheet.css:2394)
- **Floor rows:** bottom border `1px solid var(--rule-lo)`; inner padding `10px 12px`, gap `0 14px`; phone padding `9px 4px`, gap `4px 12px`. Yours uses `var(--pen-soft)`; hover border becomes `rgb(var(--beam) / 0.3)`. Tournament rows override block padding to `14px`, phone `10px`. [match-sheet.css:2457–2475](../../../../packages/web/src/styles/match-sheet.css:2457), [tournament-row.module.css:5–50](../../../../packages/web/src/components/tournament/tournament-row.module.css:5)
- **Cards:** shared `.card`: gap `18px`, padding `22px`, border `1px solid var(--rule)`, radius `12px`, background `linear-gradient(180deg,rgb(19 32 55 / 0.55),rgb(10 17 32 / 0.86))`. Named lists primarily use floor rows. [match-sheet.css:490](../../../../packages/web/src/styles/match-sheet.css:490)
- **Buttons:** `SvButton` variants are `primary`, `ghost`, `danger`, `quiet`; outlined secondary actions use `ghost`. Base: height `40px`, padding `0 18px`, gap `8px`, border `1px solid transparent`, radius `8px`, font `600 15.5px/1 var(--f-ui)`. Primary fill `var(--pen-fill)`, hover `#6642e0`; ghost border `var(--rule)`, hover `var(--rule-hi)`; danger border `rgb(228 90 77 / 0.65)`, text `var(--loss-ink)`, hover `rgb(228 90 77 / 0.1)`. Flat, no glow. [sv-buttons.tsx:6–26](../../../../packages/web/src/components/sheet/sv-buttons.tsx:6), [match-sheet.css:2597–2607](../../../../packages/web/src/styles/match-sheet.css:2597)
- **Chips:** height `24px`, padding `0 10px`, gap `6px`, border `1px solid var(--rule-lo)`, radius `999px`, size `12.5px`. Draft skin overrides height `28px`, padding `0 11px`, size `13.5px`, transparent background. [match-sheet.css:201–216](../../../../packages/web/src/styles/match-sheet.css:201), [draft-frame.module.css:95–96](../../../../packages/web/src/components/draft/draft-frame.module.css:95)
- **Segmented/tabs:** `.seg` border `1px solid var(--rule)`, radius `8px`; buttons minimum `36px`, padding `0 16px`, size `14.5px`; selected weight `600`, fill `var(--pen-soft)`. Shared `.tab`: height `44px`, padding `0 14px`, size `14.5px`; selected underline height `2px`. [match-sheet.css:228–246](../../../../packages/web/src/styles/match-sheet.css:228), [tabs:331–348](../../../../packages/web/src/styles/match-sheet.css:331)
- **Inputs/labels:** height `42px`, padding `0 12px`, border `1px solid var(--rule-lo)`, radius `7px`, panel-2 background, size `15px`; focus shadow `0 0 0 3px rgb(155 126 255 / 0.22)`. Labels `12.5px`, margin-bottom `6px`. Draft skin: floor background, radius `8px`, focus shadow `0 0 0 1px var(--pen)`; labels `14px`. [match-sheet.css:259–261](../../../../packages/web/src/styles/match-sheet.css:259), [draft-frame.module.css:87–92](../../../../packages/web/src/components/draft/draft-frame.module.css:87)
- **Empty states:** headline/action followed by open activities or faded ghost rows. Hero gap `14px`, maximum `660px`; title `600 clamp(24px,3.4cqi,32px)/1.15 var(--f-display)`; lede maximum `56ch`, line-height `1.55`. [empty-states.module.css:1–8](../../../../packages/web/src/components/empty-states/empty-states.module.css:1)
- **Load more:** ghost button, minimum width `140px`; foot margin-top `16px`, gap `10px`; phone button width `100%`. [load-more.tsx:43–58](../../../../packages/web/src/components/paged-list/load-more.tsx:43), [load-more.module.css:2–16](../../../../packages/web/src/components/paged-list/load-more.module.css:2)
- **MetaLine:** wrapping flex, column-gap `11px`, row-gap `4px`, margin-left `-14px`; each dot has margin-right `11px`, with clipping suppressing leading separators. [meta-line.module.css:1–5](../../../../packages/web/src/components/meta-line/meta-line.module.css:1)
- **Rank:** `RankBadge` uses `rounded-full font-semibold`; small sizing `px-2.5 py-0.5 text-xs gap-1.5`, large `px-3 py-1 text-sm gap-2`; gem `15`/`22`; background `${visual.color}18`, border `1px solid ${visual.color}40`. Colors: Bronze `#d6a06a`, Silver `#cbd5e1`, Gold `#f5c451`, Platinum `#7dd3fc`, Diamond `#a78bfa`. [rank-badge.tsx:48–85](../../../../packages/web/src/components/rank/rank-badge.tsx:48), [rank-visuals.ts:14–20](../../../../packages/web/src/components/rank/rank-visuals.ts:14)
- **TierLine:** wrapper `14px`; track `1px`, top `6px`; fill `3px`, top `5px`, radius `2px`; node `10px`, top `2px`, border `2px solid var(--tier)`, floor background. Sheet Diamond uses `#dbe6ff`. [tier-line.module.css:1–36](../../../../packages/web/src/components/rank/tier-line.module.css:1), [match-sheet.css:103–109](../../../../packages/web/src/styles/match-sheet.css:103)

## 4. "Obsidian Arena" direction

Binding direction: navy-black obsidian, fine antique-gold lines, restrained purple active/selected states; rejected: slate-blue, temple/tomb scenery, generic AI dashboards. [PRODUCT.md:36–42](../../../../packages/web/PRODUCT.md:36)

Today this means the scoped floor/panel palette, antique-gold rule tokens, violet selection fills and flat controls above. Design intent favors functional density and minimal chrome; excludes glassmorphism. [.impeccable.md:9–13](../../../../.impeccable.md:9)

The referenced `designs/duel-ui/nexus-classic/` directory was not found. Existing `docs/design` explicitly says shipped code is the source; its Solid Vision concept labels obsidian, antique gold and restrained purple separately. [design README:3](../../../../docs/design/README.md:3), [concept CSS:5–24](../../../../docs/design/duel-3d-mode/concept/solid-vision/styles.css:5)