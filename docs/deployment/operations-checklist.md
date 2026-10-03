# Production Operations Checklist

## Before First Deploy

- Create a Discord test server.
- Create the Discord application and bot user.
- Copy the bot token, client ID, and client secret.
- Invite the bot with minimal required permissions.
- Configure the [production environment and secrets](vm-runbook.md#create-env).
- Configure DNS per [server setup](vm-runbook.md#create-the-server).
- Recreate containers after environment changes per [environment setup](vm-runbook.md#create-env).
- Register the [Discord OAuth redirect](vm-runbook.md#discord-oauth-redirect).
- Confirm `DATABASE_PATH` points inside the mounted `data/` directory.
- Confirm `DISCORD_REMINDER_CHANNEL_ID` points at the reminder channel.
- Confirm `REMINDER_CRON` and `REMINDER_TIMEZONE` match the server's expected reminder time.
- Apply the [cloud firewall rules](vm-runbook.md#create-the-server).
- Add [GitHub Actions secrets](vm-runbook.md#github-actions-secrets).

## Deploy Smoke Test

- First production start of the duel engine should go through the `main` deploy workflow so the pinned `data/duel-engine` bundle is installed. Do not hand-run `duel:prepare` on the ARM VM (no emsdk).
- Run `docker compose -f docker-compose.yml up -d --build` only after that bundle exists, or let the workflow start Compose.
- Run `docker compose -f docker-compose.yml logs -f` and confirm bot, ws, duel, web, and caddy start.
- Confirm `duel` logs: `Private server listening` and no rewrite of `data/bot.sqlite`.
- Complete the [deployment smoke test and browser verification](vm-runbook.md#verify).
- Click "Sign in with Discord" and confirm OAuth works.
- In Discord, run `/stats` and confirm the bot responds.
- Run a test `/duel`, `/approve`, and `/rankings` flow.
- Create a test `/event`, join, start, and show it.

## Ongoing Operations

- Review logs after each deploy: `docker compose -f docker-compose.yml logs --tail=50`
- Back up `./data/bot.sqlite` daily. The deploy job never overwrites it; engine files live only under `data/duel-engine`.
- Keep backups on the VM and remove any previously configured workstation pulls and retained local copies per the [backup runbook](vm-runbook.md#backups).
- Keep the host OS patched: `apt update && apt upgrade -y`
- Rotate secrets if ever exposed.
- Do not run multiple bot replicas against the same SQLite file.
- Restarting `duel` does not regenerate the resource bundle. Deploy stops `web` during the bundle guard, refuses a different engine bundle while `duels.status = 'active'` (duel stays up; `web` is started again), and fails closed on a locked/corrupt DB. Drain in-flight tables before a bundleVersion change.

## Discord Notes

- Guild commands update faster and are better during development.
- Global commands can take longer to propagate.
- The bot needs permission to send messages in the reminder channel.
