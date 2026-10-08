# Dueling Domain Clerk emails

Branded set for the nine Clerk emails a player can receive. Workshop page: `/tmp/alpha-access-pr2-evidence/clerk-email-brand/review.html` (before and after, 600 and 390, light and dark client).

## Templates

| Slug | Subject |
| --- | --- |
| `waitlist_confirmation` | You're on the Dueling Domain waitlist |
| `waitlist_invitation` | Your Dueling Domain invite |
| `invitation` | Your Dueling Domain invite |
| `verification_code` | {{otp_code}} is your Dueling Domain verification code |
| `reset_password_code` | {{otp_code}} is your Dueling Domain password reset code |
| `password_changed` | Your Dueling Domain password was changed |
| `primary_email_address_changed` | Your Dueling Domain email address was changed |
| `new_device_sign_in` | New sign in to your Dueling Domain account |
| `account_locked` | Your Dueling Domain account is locked |

Skipped (not reachable in our flows): `magic_link_*` (email sign-in strategies are empty, verification is `email_code` only), `mfa_enabled` (MFA off), `passkey_added/removed` (passkeys off), `password_removed` (password is required), `billing_*` and `commerce_*` (billing off), `opaque_token_*` and `waitlist_entry_created` (sent to the app owner, not to players).

## Design

- Dark card (#141929, 1px #2A3150) on the app navy (#0A0E1A). Gold (#C9A45C) is only the eyebrow label, the callout bar and the code. Purple is only the button and the small fallback link.
- Every layer has an explicit background colour (page, card, code panel, rows, button), the head declares `color-scheme: dark light`, and there is no background image, so clients have nothing to flip. Dark clients leave it alone.
- Logo: the live `https://duelingdomain.com/logo-512.png` at 44px (its tile is the page navy, so it sits flat) beside a live-text wordmark that still shows with images blocked. No new image is needed, so there is no URL to swap after merge. To use another file, pass `--logo-url` to `build.py`.
- Headings use Russo One where the client loads web fonts (Apple Mail, iOS Mail) and fall back to Arial Black, Segoe UI, then a bold sans. Body is Chakra Petch with the same kind of fallback. Fonts load from `https://duelingdomain.com/fonts/`.
- Card is 560px max, `width:100%` under 600px, and the button goes full width at phone size. Outlook gets a 560px ghost table.
- The ticket URL is never printed. Under a button there is one line ("Button not working? Open your invite") linking to the same `{{action_url}}`.
- Footer on every email says why the player got it and gives support@duelingdomain.com.

## Files

- `tools/build.py` holds the copy and layout for all nine and writes everything below. Edit it, then rerun it.
- `<slug>.body.html` is the HTML Clerk sends. This is canonical.
- `<slug>.markup.html` is a best-effort Revolvapp version so the dashboard editor opens on a similar design. If anyone re-saves a template in the dashboard, Clerk recompiles `body` from the markup and drops the dark-mode meta, the web fonts and the Outlook wrapper, so edit here and re-apply instead.
- `subjects.json`, `requests/<slug>.put.json` (the exact PUT body: `name`, `subject`, `markup`, `body`).
- `tools/clerk_preview.py` renders every template through Clerk's preview endpoint (nothing is saved). `tools/build_review.py` and `tools/shoot.mjs` build and photograph the workshop page.

## Apply

Run from a directory linked to the Clerk app (`packages/web` of a checkout). Dev first, check it, then prod only after approval.

```bash
cd packages/web
../../docs/design/clerk-email/tools/apply.sh dev
../../docs/design/clerk-email/tools/apply.sh prod
```

Each call is `clerk api --instance <dev|prod> -X PUT /templates/email/<slug> --file docs/design/clerk-email/requests/<slug>.put.json --yes`. The PUT does not send `from_email_name`, `reply_to_email_name` or `delivered_by_clerk`, and the stored values stay as they were. Revert one template with `POST /templates/email/<slug>/revert`, or re-PUT the saved copy of the old template.
