# Dueling Domain sign-in design

A is the chosen design (owner, 2026-10-06)

This is the finished HTML/CSS specification. Port A faithfully; the Discord-only implementation brief overrides the mock where it removes email authentication or changes access-error copy and links.

## Files and folders

- `a/`: chosen **Sealed pack** concept. `index.html` supplies the page and pack markup; `style.css` supplies the layout, backdrop, typography and responsive rules; `pack.css` supplies the foil pack and its sealed/open motion.
- `b/`, `c/`: rejected concepts, retained as design history.
- `shared/`: common tokens and form styles in `base.css`, mock-only step scaffolding in `forms.js`, and the two original card backs. Do not port the scaffolding to the application.
- `shared/fonts/`: Chakra Petch 400/500/600/700 and Russo One 400 WOFF2 files, with their OFL licenses.
- `shared/logo/`: SVG lockup and mark assets. A uses inline symbols, including `dd-clip` and `dd-glint` for the pack mark.
- `reference/`: `all-steps.dom.html` is the rendered A step markup. Each `section.scr[data-screen]` is a stable reference for a future auth adapter.
- `shots/`: target renders at 1440 × 900 and 390 × 844. Today's implementation follows `a-signin-*`, `a-err-service-*` and `a-err-invite-*`, with the brief's Discord-only changes.
- `workshop.html`: comparison page and design rationale, retained as a record.
- `review/`: the owner's mock-vs-build review page for PRs #208 and #209 (static; open with any local server).

## Step index

Every step uses `.scr`, `.eyebrow`, `h1.ttl`, `[data-slot="form"]`, and `.foot-links[data-slot="foot"]`. Steps with introductory copy also use `.lede`. The title accepts `<em>` for the gold accent. `data-clerk` values below are integration hooks in the reference, not a requirement to ship the mock state machine.

| `data-screen` | Purpose and stable classes | `data-clerk` hooks |
| --- | --- | --- |
| `signin` | Identifier: `.form`, `.btn.btn-alt`, `.fine`, `.or`, `.field`, `#f-email[name="identifier"]`, `.btn.btn-primary` | `sign-in-start`, `oauth-discord` |
| `password` | Password: `.idrow .v`, `.field`, `.input-wrap.has-btn`, `#f-pw`, `.reveal[data-reveal]`, `.hint`, `.alt-links .link` | `sign-in-password` |
| `code` | Check your email: `.otp[data-otp]`, `.cell.on`, `.cell.filled`, `.otp-in#f-code`, `#code-help`, `.resend[data-resend]`, `[data-count]`, `.alt-links` | `verify-email-code` |
| `newpw` | New password and confirmation: `.field`, `.input-wrap.has-btn`, `#f-np[name="newPassword"]`, `#f-np2[name="confirm"]`, `.reveal`, `.hint` | `reset-password` |
| `invite` | Create account: `.input-wrap.locked`, readonly `#f-iem[name="emailAddress"]`, `.lockic`, `#f-un[name="username"]`, `#f-cp`, `.check input[name="legal"]`, `.check .box`, `.captcha-slot#clerk-captcha`, `.fine` | `sign-up-continue`, `captcha`, `oauth-discord` |
| `err-username` | Create account with taken username: same structure as `invite`, plus `.field.invalid`, `#f-un[aria-invalid="true"]`, `.ferr#f-un-err[role="alert"]` | `sign-up-continue`, `captcha`, `oauth-discord` |
| `err-invite` | Identifier not invited: `.form`, `.note-box .k`, `.note-box .v [data-email]`, waitlist `.btn.btn-primary`, retry `.btn.btn-alt` | `identifier-not-found` |
| `err-signup` | Sign-up without an invite: `.form`, waitlist `.btn.btn-primary`, retry `.btn.btn-alt` | `sign-up-no-invite` |
| `err-password` | Wrong password: password structure plus `.field.invalid`, `.ferr#f-pw-err[role="alert"]` and `#f-pw[aria-invalid="true"]` | `sign-in-password` |
| `err-banned` | Account unavailable: `.form`, `.btn.btn-alt`; title has no emphasis on “sign in” | `account-locked` |
| `err-service` | Sign-in with service error: identifier structure plus `.banner[role="alert"]` above Discord | `sign-in-start`, `oauth-discord` |
| `signing` | Signing in: `.form`, `.signing[role="status"]`, `.spinner` | None; session created, redirect pending |
| `success` | Signed in, pack open: `.form`, `.done-row[role="status"]`, `.done-gem`, `.done-t`, `.done-s`; A toggles `.pack.is-open.mark-play` and the hint's `.t1`/`.t2` | None; session active, redirect pending |

The create-account consent checkbox links to `https://duelingdomain.com/terms` and `https://duelingdomain.com/privacy` in both the scaffolding and reference DOM. Production marketing links remain conditional on the server's `MARKETING_URL` until the domain cutover.

## Application CSS map

The application styles live in `packages/web/src/components/auth/sign-in-shell.module.css`. Source order is shared base, pack, then A layout, as in the mock. CSS Modules scope the original class names. The following table accounts for the mock's blocks; later email-auth controls remain documented here instead of being shipped unused.

| Mock block | Application destination or disposition |
| --- | --- |
| `base.css` font faces | `auth/fonts.ts` uses `next/font/local`; all five WOFF2 files and both OFL texts are in `auth/fonts/`. Variables are applied only to the shell. |
| `base.css` tokens, document defaults, focus, hidden, skip | Start of `sign-in-shell.module.css`, scoped to `.a-page`; native link underlines are restored after the application's global reset. |
| `base.css` `.form`, buttons, `.fine` | Same named module rules, used by the Discord form and panel actions. Button transitions retain only `transform`, following the brief's motion limit; hover border/shadow values are unchanged. |
| `base.css` `.banner` | Same module rules for bad notices. The added `[data-tone="info"]` variant uses neutral surface, border and text tokens. `.code` retains the diagnostic label and small text line. |
| `base.css` `.spinner`, `dd-spin` | Same module rules for the existing Discord pending state. |
| `base.css` `.foot-links`, `.legal` | Same module rules, rendered by `SignInStep` and `SignInFootLinks`; marketing links are conditional. |
| `base.css` fields, reveal, hints, field errors, locked inputs, generic links, dividers, identifier row, consent, CAPTCHA, OTP, resend, signing row, note box, screen-reader utility | Ported for the step cards (PR 2, Task 3a). Field parts (`.field`, `.input-wrap`, `.reveal`, `.hint`, `.ferr`, locked input, `.idrow`, `.check`, `.captcha-slot`, `.otp`, `.resend`, `.signing`, `.note-box`) are in `steps.module.css`, rendered by `fields.tsx`. Generic `.sr`, `.link`, `.alt-links` and `.or` are in `sign-in-shell.module.css` next to the buttons. The framed CAPTCHA placeholder is preview-only; the live mount is an empty `#clerk-captcha` that Clerk fills. |
| `base.css` mock strip and non-shot body padding | Not ported: workshop controls only. |
| `base.css` reduced motion | Scoped blanket animation/transition stop at the end of the module, plus the static spinner. |
| `pack.css` clip polygons, entry, bob, tilt layers, perspective, pack sizing/shadow | Same module rules. The client `PackTilt` supplies only pointer input; the pack markup remains server-rendered. |
| `pack.css` foil, holo sweep, pointer light, crimps, band, face, type, glyph, glint, ribbon, tag, edge | Same module rules, with all supplied sizes, colors, timing and easing retained. |
| `pack.css` card backs, rays, burst, open state, mark entrance and tear/burst/rays keyframes | Same module rules; `packState="open"` adds `.is-open.mark-play`. The current login route always leaves the pack sealed. |
| `pack.css` `.hero-stage`, `.is-done`, `.pack--sm`, `.gave` | Not ported: unused marketing variants. A has its own `.a-stage`. |
| `a/style.css` page, background, rings/spin, ghosts/drift, dust/rise | Same module rules; 14 dust particles use A's deterministic formula on the server. |
| `a/style.css` wrap, nav, lockup, chip/pulse, back link | Same module rules and inline SVG geometry; the unset marketing URL produces an unlinked lockup. |
| `a/style.css` grid, form column, step entrance, eyebrow, title/emphasis, lede, form/footer rhythm, alternate-button surface | Same module rules, consumed by `SignInShell`, `SignInStep` and `SignInErrorPanel`. |
| `a/style.css` stage, hint, error shadow, success bob stop, final ray mask | Same module rules. Document-wide state selectors become shell `data-tone` and `data-pack-state` selectors. Open state swaps `.t1`/`.t2` and hides the hint icon. |
| `a/style.css` signing tremble/charge and `.done-*` success content | `.done-*` ported to `sign-in-shell.module.css` (used by `SuccessStep`); `packState="open"` plays the pack tear, burst, rays and card fan. Signing tremble/charge is not ported. |
| `a/style.css` both 900px media blocks | Same module rules, including the final 22px stage margin and 64px page padding correction. |
| `a/style.css` reduced-motion settled frame | Same module rules; pointer transforms are also reset when motion is reduced. |

The brief intentionally removes the identifier field, divider and email Continue button, changes access-error wording/actions, and hides marketing links until configured. Those changes alter form height compared with the archived shots; the remaining spacing and proportions keep the mock values. The info palette and diagnostic line extend a mock that only supplied the bad banner. Browser comparison remains the owner's visual check.

## Design fix

Error titles must not put alarming words in the gold `<em>` emphasis. Emphasise only neutral or positive words, such as “alpha”. In `err-banned`, “sign in” is plain title text. The archived screenshots predate this correction.

## Decisions and notes

- The `err-banned` screen's contact route is `support@duelingdomain.com`, shown as a `mailto:support@duelingdomain.com` link on its secondary `.btn.btn-alt` action with the visible text “Contact support” (owner, 2026-10-06).
- The supplied A mock contains `.pack-hit`, `.pack-tilt`, and `--sx`/`--sy` lighting styles, but no pointer handler or tilt angles/easing. The application adds a small fine-pointer-only handler; that interaction cannot be compared exactly with the supplied mock. All supplied CSS motion values remain the reference.
