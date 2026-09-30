# Production Operations Checklist

## Before First Deploy

- Create a Discord test server.
- Create the Discord application and bot user.
- Copy the bot token, client ID, and client secret.
- Invite the bot with minimal required permissions.
- Create `.env` on the host from `.env.example` and fill in all values.
- Generate `NEXTAUTH_SECRET`: `openssl rand -base64 32`
- Generate `WS_INTERNAL_SECRET`, `BOT_ANNOUNCE_SECRET`, and `DUEL_INTERNAL_SECRET`: `openssl rand -hex 32`
- Set `NEXTAUTH_URL` and `NEXT_PUBLIC_WS_URL` to your VM IP or domain.
- Set Discord OAuth redirect URI: `http://<IP>/api/auth/callback/discord`
- Confirm `DATABASE_PATH` points inside the mounted `data/` directory.
- Confirm `DISCORD_REMINDER_CHANNEL_ID` points at the reminder channel.
- Confirm `REMINDER_CRON` and `REMINDER_TIMEZONE` match the server's expected reminder time.
- Ensure VM firewall allows TCP ports 22, 80, 443 (both OS-level and cloud-level). Do not expose 4003.
- Add GitHub Actions secrets (`VM_HOST`, `VM_USER`, `VM_SSH_PRIVATE_KEY`, `VM_PORT`).

## Deploy Smoke Test

- First production start of the duel engine should go through the `main` deploy workflow so the pinned `data/duel-engine` bundle is installed. Do not hand-run `duel:prepare` on the ARM VM (no emsdk).
- Run `docker compose -f docker-compose.yml up -d --build` only after that bundle exists, or let the workflow start Compose.
- Run `docker compose -f docker-compose.yml logs -f` and confirm bot, ws, duel, web, and caddy start.
- Confirm `duel` logs: `Private server listening` and no rewrite of `data/bot.sqlite`.
- Visit `http://<IP>` and confirm the web dashboard loads.
- Click "Sign in with Discord" and confirm OAuth works.
- In Discord, run `/stats` and confirm the bot responds.
- Run a test `/duel`, `/approve`, and `/rankings` flow.
- Create a test `/event`, join, start, and show it.

## Ongoing Operations

- Review logs after each deploy: `docker compose -f docker-compose.yml logs --tail=50`
- Back up `./data/bot.sqlite` daily. The deploy job never overwrites it; engine files live only under `data/duel-engine`.
- Copy backups off the VM periodically.
- Keep the host OS patched: `apt update && apt upgrade -y`
- Rotate secrets if ever exposed.
- Do not run multiple bot replicas against the same SQLite file.
- Restarting `duel` does not regenerate the resource bundle. Deploy stops `web` during the bundle guard, refuses a different engine bundle while `duels.status = 'active'` (duel stays up; `web` is started again), and fails closed on a locked/corrupt DB. Drain in-flight tables before a bundleVersion change.

## Discord Notes

- Guild commands update faster and are better during development.
- Global commands can take longer to propagate.
- The bot needs permission to send messages in the reminder channel.
